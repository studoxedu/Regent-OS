-- ============================================================================
-- phase31.sql — Fix Paydesk + tertiary CBT student access + Schedox; close leaks
-- (2026-07-18)
--
-- Three tertiary areas were non-functional; this migration repairs the two that
-- are bugs and lays the DB groundwork for the third (Schedox timetable builder,
-- whose UI ships in the same commit).
--
--   PAYDESK  — createInvoice/recordPayment/waiveInvoice all called the TERTIARY
--              flow_execute(p_capability,...) which authorises against
--              office_instances; tertiary schools are on K-12 memberships and
--              have zero office_instances, so every write threw. (waiveInvoice
--              swallowed the error, so it failed silently.) Same class of bug as
--              phase30/Senate. Fixed by adding fee branches to the K-12
--              flow_execute (see .qa-scratch/apply_phase31.mjs) reusing the
--              existing, correct _flow_fee_* handlers.
--
--   CBT      — cbt_tests' read policy only allowed school MEMBERS, but tertiary
--              students are deliberately membership-LESS (the app identifies them
--              via students.auth_user_id, see useAuth.get_student_context), so no
--              student could ever list a test. Fixed by adding a students-table
--              clause to the read policy + the two RPCs — NOT by giving students
--              memberships (that fights the app's student model). Also two
--              SECURITY DEFINER leaks: cbt_fetch_test / cbt_start_attempt did NO
--              school check, so any user with a test UUID could fetch/sit another
--              school's test.
--
--   SCHEDOX  — timetable_entries / exam_entries had te_auth / ee_auth
--              USING(true) WITH CHECK(true) leaks and no proper write path.
--              Scoped here; the creation UI is added in the frontend.
-- ============================================================================

-- ── 0. fee_invoices: allow student-based (tertiary) invoices ────────────────
-- enrollment_id was NOT NULL — fine for K-12 (all 1108 existing invoices are
-- enrollment-based) but it made tertiary student_id invoices impossible, so
-- _flow_fee_invoice_create threw 23502 on every tertiary invoice. Loosen it and
-- add a guard that every invoice carries exactly one of the two keys. All
-- existing rows have enrollment_id set, so the guard is satisfied on apply.
ALTER TABLE fee_invoices ALTER COLUMN enrollment_id DROP NOT NULL;

ALTER TABLE fee_invoices DROP CONSTRAINT IF EXISTS fee_invoices_subject_present;
ALTER TABLE fee_invoices ADD CONSTRAINT fee_invoices_subject_present
  CHECK (enrollment_id IS NOT NULL OR student_id IS NOT NULL);

-- ── 0b. Fix _flow_fee_payment_record: double-count + wrong recorded_by ──────
-- Two bugs:
--   (1) DOUBLE COUNT — an AFTER INSERT trigger (sync_invoice_status) already
--       sets fee_invoices.amount_paid = SUM(all payments). The handler ALSO ran
--       its own "amount_paid = amount_paid + v_amount" UPDATE, so every payment
--       counted twice (a 50k payment showed 100k paid). At a real institution
--       this corrupts all fee reconciliation. The handler must NOT touch the
--       invoice — the trigger is authoritative. It now just inserts and reads
--       the trigger-computed status back for its return value.
--   (2) recorded_by is a uuid FK to memberships (schema drift), not text; the
--       actor is a profile → goes in recorded_by_user_id (FK → profiles).
--       recorded_by (membership) stays NULL, matching all existing rows.
-- Tertiary-only handler (K-12 fees use the separate fee_records table).
CREATE OR REPLACE FUNCTION public._flow_fee_payment_record(p_payload jsonb, p_institution_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
    DECLARE
      v_invoice_id UUID;
      v_amount     NUMERIC;
      v_status     TEXT;
      v_pay_id     UUID;
    BEGIN
      v_invoice_id := (p_payload->>'invoice_id')::UUID;
      v_amount     := (p_payload->>'amount')::NUMERIC;
      IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'invoice_id required'; END IF;
      IF v_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

      INSERT INTO fee_payments (invoice_id, school_id, amount, receipt_ref, payment_method, recorded_by_user_id)
      VALUES (
        v_invoice_id, p_institution_id, v_amount,
        COALESCE(p_payload->>'receipt_ref', 'REC-' || to_char(now(), 'YYYYMMDD-HH24MI')),
        COALESCE(p_payload->>'payment_method', 'cash'),
        p_actor_id
      ) RETURNING id INTO v_pay_id;

      -- trg_sync_invoice has already recomputed amount_paid + status by now
      SELECT status INTO v_status FROM fee_invoices WHERE id = v_invoice_id;

      RETURN jsonb_build_object('payment_id', v_pay_id, 'new_status', v_status, 'ok', true);
    END;
    $function$;

-- ── 1. Paydesk fee capabilities ─────────────────────────────────────────────
-- Action names match exactly what Paydesk.tsx sends. school_admin covers the
-- tertiary VC demo path; bursar/finance_officer are the natural fee offices.
INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES ('fee.invoice_create'), ('fee.payment_record'), ('fee.waive')) AS a(action)
WHERE o.name IN ('school_admin', 'bursar', 'finance_officer')
  AND NOT EXISTS (
    SELECT 1 FROM capabilities c WHERE c.office_id = o.id AND c.action = a.action
  );

-- ── 2. CBT: let tertiary students see their school's published tests ────────
-- Tertiary students are deliberately membership-LESS — the app identifies them
-- via students.auth_user_id (see useAuth.get_student_context / useStudentContext),
-- NOT via memberships. But cbt_tests' read policy only allowed school MEMBERS,
-- so no student could ever list a test. Add a student clause (published-only)
-- keyed off the students table, matching the app's student model. Staff still
-- see drafts via the membership clause.
DROP POLICY IF EXISTS school_member_read_cbt_tests ON cbt_tests;
CREATE POLICY school_member_read_cbt_tests ON cbt_tests
  FOR SELECT USING (
    is_super_admin()
    OR school_id IN (
      SELECT m.school_id FROM memberships m
      WHERE m.profile_id = auth.uid() AND m.is_active = true
    )
    OR (
      status = 'published' AND EXISTS (
        SELECT 1 FROM students st
        WHERE st.auth_user_id = auth.uid()
          AND st.institution_id = cbt_tests.school_id
      )
    )
  );

-- ── 3. CBT: close the two SECURITY DEFINER leaks ────────────────────────────
-- Both add: caller must be super admin, the test's author, an active member of
-- the test's school, OR a student of that school (students are membership-less).
-- This closes the cross-tenant leak (any user with a UUID could fetch/sit any
-- school's test) without requiring students to have memberships.
CREATE OR REPLACE FUNCTION public.cbt_fetch_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_test      cbt_tests%ROWTYPE;
  v_questions JSONB;
BEGIN
  SELECT * INTO v_test FROM cbt_tests WHERE id = p_test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Test not found'; END IF;

  IF NOT (
    is_super_admin()
    OR v_test.created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM memberships m
               WHERE m.school_id = v_test.school_id
                 AND m.profile_id = auth.uid() AND m.is_active = true)
    OR EXISTS (SELECT 1 FROM students st
               WHERE st.auth_user_id = auth.uid()
                 AND st.institution_id = v_test.school_id)
  ) THEN
    RAISE EXCEPTION 'You do not have access to this test';
  END IF;

  IF v_test.status <> 'published' THEN RAISE EXCEPTION 'This test is not open'; END IF;
  IF v_test.starts_at IS NOT NULL AND now() < v_test.starts_at THEN RAISE EXCEPTION 'This test has not started yet'; END IF;
  IF v_test.ends_at   IS NOT NULL AND now() > v_test.ends_at   THEN RAISE EXCEPTION 'This test window has closed'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'ordinal', q.ordinal, 'prompt', q.prompt,
    'options', q.options, 'marks', q.marks
  ) ORDER BY q.ordinal), '[]'::jsonb)
  INTO v_questions
  FROM cbt_questions q WHERE q.test_id = p_test_id;

  RETURN jsonb_build_object(
    'id', v_test.id,
    'title', v_test.title,
    'instructions', v_test.instructions,
    'duration_minutes', v_test.duration_minutes,
    'show_results', v_test.show_results,
    'questions', v_questions
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cbt_start_attempt(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_test       cbt_tests%ROWTYPE;
  v_attempt    cbt_attempts%ROWTYPE;
  v_student_id UUID;
BEGIN
  SELECT * INTO v_test FROM cbt_tests WHERE id = p_test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Test not found'; END IF;

  IF NOT (
    is_super_admin()
    OR EXISTS (SELECT 1 FROM memberships m
               WHERE m.school_id = v_test.school_id
                 AND m.profile_id = auth.uid() AND m.is_active = true)
    OR EXISTS (SELECT 1 FROM students st
               WHERE st.auth_user_id = auth.uid()
                 AND st.institution_id = v_test.school_id)
  ) THEN
    RAISE EXCEPTION 'You do not have access to this test';
  END IF;

  IF v_test.status <> 'published' THEN RAISE EXCEPTION 'This test is not open'; END IF;
  IF v_test.starts_at IS NOT NULL AND now() < v_test.starts_at THEN RAISE EXCEPTION 'This test has not started yet'; END IF;
  IF v_test.ends_at   IS NOT NULL AND now() > v_test.ends_at   THEN RAISE EXCEPTION 'This test window has closed'; END IF;

  SELECT * INTO v_attempt FROM cbt_attempts
  WHERE test_id = p_test_id AND profile_id = auth.uid();

  IF FOUND THEN
    IF v_attempt.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'You have already submitted this test';
    END IF;
    RETURN jsonb_build_object('attempt_id', v_attempt.id, 'started_at', v_attempt.started_at);
  END IF;

  SELECT id INTO v_student_id FROM students WHERE auth_user_id = auth.uid();

  INSERT INTO cbt_attempts (test_id, profile_id, student_id)
  VALUES (p_test_id, auth.uid(), v_student_id)
  RETURNING * INTO v_attempt;

  RETURN jsonb_build_object('attempt_id', v_attempt.id, 'started_at', v_attempt.started_at);
END;
$function$;

-- ── 3b. Let tertiary students read their own school row ─────────────────────
-- schools had only membership/group/super read policies; membership-less
-- students got a 406 (0 rows) loading their own institution, leaving
-- activeSchool null across the student portal. Add a students-table clause.
DROP POLICY IF EXISTS schools_student_read ON schools;
CREATE POLICY schools_student_read ON schools
  FOR SELECT USING (
    id IN (
      SELECT st.institution_id FROM students st
      WHERE st.auth_user_id = auth.uid()
    )
  );

-- ── 4. Schedox: scope timetable_entries / exam_entries ──────────────────────
-- Reads: any active member of the school that owns the parent semester.
-- Writes: holders of structure.manage at that school (the tertiary registry
-- office), matching how course_offerings/venues are already governed.
DROP POLICY IF EXISTS te_auth ON timetable_entries;
DROP POLICY IF EXISTS te_school_read  ON timetable_entries;
DROP POLICY IF EXISTS te_school_write ON timetable_entries;

CREATE POLICY te_school_read ON timetable_entries
  FOR SELECT USING (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM semesters s
      JOIN memberships m ON m.school_id = s.school_id
      WHERE s.id = timetable_entries.semester_id
        AND m.profile_id = auth.uid() AND m.is_active = true
    )
  );

CREATE POLICY te_school_write ON timetable_entries
  FOR ALL USING (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM semesters s
      WHERE s.id = timetable_entries.semester_id
        AND has_school_capability(s.school_id, 'structure.manage')
    )
  ) WITH CHECK (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM semesters s
      WHERE s.id = timetable_entries.semester_id
        AND has_school_capability(s.school_id, 'structure.manage')
    )
  );

DROP POLICY IF EXISTS ee_auth ON exam_entries;
DROP POLICY IF EXISTS ee_school_read  ON exam_entries;
DROP POLICY IF EXISTS ee_school_write ON exam_entries;

CREATE POLICY ee_school_read ON exam_entries
  FOR SELECT USING (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM semesters s
      JOIN memberships m ON m.school_id = s.school_id
      WHERE s.id = exam_entries.semester_id
        AND m.profile_id = auth.uid() AND m.is_active = true
    )
  );

CREATE POLICY ee_school_write ON exam_entries
  FOR ALL USING (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM semesters s
      WHERE s.id = exam_entries.semester_id
        AND has_school_capability(s.school_id, 'structure.manage')
    )
  ) WITH CHECK (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM semesters s
      WHERE s.id = exam_entries.semester_id
        AND has_school_capability(s.school_id, 'structure.manage')
    )
  );
