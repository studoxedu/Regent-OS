-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 38 MIGRATION  (Tertiary org chart, stage 3)
-- Hierarchical results chain: dept → faculty → senate, department/faculty
-- scoped, with per-step reject and score-lock-after-submit.
-- ═══════════════════════════════════════════════════════════
--
-- New state machine on course_offerings.results_status:
--   draft -> submitted -> dept_verified -> dept_approved -> faculty_verified -> published
-- Roles (scope):
--   lecturer            submit            (own draft)
--   dept_exam_officer   dept_verify       (own department)   [exam_officer = institution-wide]
--   hod                 dept_approve      (own department)
--   faculty_exam_officer faculty_verify   (own faculty)
--   dean                publish           (own faculty)
--   senate_secretary    ratify            (institution — unchanged)
--   school_admin        any step          (bypasses scope)
-- Reject: any approver sends results ONE step back to the previous owner.
-- Scores: editable only while 'draft' (trg_lock_scores); a reject to draft re-opens.
--
-- The dispatcher below is the LIVE flow_execute with ONLY its results.* branches
-- replaced (verified by build_flow.mjs sanity checks); all other branches
-- (learner.*, fee.*, senate.ratify, results.finalize/reopen for K-12) are byte-identical.

BEGIN;

-- 1) Expand the status domain + migrate any legacy rows
DO $mig$ DECLARE cn text;
BEGIN
  SELECT conname INTO cn FROM pg_constraint
   WHERE conrelid='course_offerings'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) ILIKE '%results_status%';
  IF cn IS NOT NULL THEN EXECUTE format('ALTER TABLE course_offerings DROP CONSTRAINT %I', cn); END IF;
END $mig$;
UPDATE course_offerings SET results_status='dept_verified' WHERE results_status='verified';
UPDATE course_offerings SET results_status='dept_approved' WHERE results_status='approved';
ALTER TABLE course_offerings ADD CONSTRAINT offering_status
  CHECK (results_status IN ('draft','submitted','dept_verified','dept_approved','faculty_verified','published'));

-- 2) Retire obsolete result caps + install the hierarchical chain caps
DELETE FROM capabilities WHERE action IN ('results.verify','results.approve');
INSERT INTO capabilities (office_id, action)
SELECT o.id, v.action FROM (VALUES
  ('lecturer','results.submit'),
  ('school_admin','results.submit'),
  ('dept_exam_officer','results.dept_verify'),
  ('exam_officer','results.dept_verify'),
  ('school_admin','results.dept_verify'),
  ('hod','results.dept_approve'),
  ('school_admin','results.dept_approve'),
  ('faculty_exam_officer','results.faculty_verify'),
  ('school_admin','results.faculty_verify'),
  ('dean','results.publish'),
  ('school_admin','results.publish'),
  ('dept_exam_officer','results.reject'),
  ('exam_officer','results.reject'),
  ('hod','results.reject'),
  ('faculty_exam_officer','results.reject'),
  ('dean','results.reject'),
  ('school_admin','results.reject')
) v(office_name, action)
JOIN offices o ON o.name=v.office_name
WHERE NOT EXISTS (SELECT 1 FROM capabilities c WHERE c.office_id=o.id AND c.action=v.action);

-- 3) Rebuilt dispatcher
CREATE OR REPLACE FUNCTION public.flow_execute(p_action_type text, p_school_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_promoted  INTEGER := 0;
  v_graduated INTEGER := 0;
  v_skipped   INTEGER := 0;
  v_profile_id  uuid;
  v_membership  memberships%ROWTYPE;
  v_office_name text;
  v_has_cap     boolean;
  v_audit_id    uuid;
  v_audit_ref   text;
  v_result      jsonb := '{}';
  v_receipt_ref text;
  v_learner_id  text;
  v_enrollment  learner_enrollments%ROWTYPE;
  v_offering    course_offerings%ROWTYPE;
  v_off_dept    uuid;
  v_off_fac     uuid;
  v_cur_status  text;
  v_new_status  text;
BEGIN
  v_profile_id := auth.uid();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT m.* INTO v_membership
  FROM memberships m
  WHERE m.profile_id = v_profile_id
    AND m.school_id = p_school_id
    AND m.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: no active membership at school %', p_school_id;
  END IF;

  SELECT o.name INTO v_office_name
  FROM offices o WHERE o.id = v_membership.office_id;

  SELECT EXISTS (
    SELECT 1 FROM capabilities c
    WHERE c.office_id = v_membership.office_id
      AND c.action = p_action_type
  ) INTO v_has_cap;

  IF NOT v_has_cap THEN
    RAISE EXCEPTION 'Forbidden: office "%" does not hold capability "%"',
      v_office_name, p_action_type;
  END IF;

  CASE p_action_type

    WHEN 'learner.enroll' THEN
      v_learner_id := 'RGT-' || to_char(now(), 'YYYY') || '-' ||
                      lpad((nextval('learner_id_seq'))::text, 5, '0');

      WITH new_learner AS (
        INSERT INTO learners (learner_id, first_name, last_name, date_of_birth)
        VALUES (
          v_learner_id,
          p_payload->>'first_name',
          p_payload->>'last_name',
          (p_payload->>'date_of_birth')::date
        )
        RETURNING id
      )
      INSERT INTO learner_enrollments
        (learner_id, school_id, stage, guardian_consent_captured, guardian_consent_at)
      SELECT
        new_learner.id,
        p_school_id,
        p_payload->>'stage',
        COALESCE((p_payload->>'guardian_consent_captured')::boolean, false),
        CASE WHEN (p_payload->>'guardian_consent_captured')::boolean THEN now() END
      FROM new_learner
      RETURNING * INTO v_enrollment;

      v_result := jsonb_build_object(
        'learner_id', v_learner_id,
        'enrollment_id', v_enrollment.id,
        'entity_type', 'learner_enrollment',
        'entity_id', v_enrollment.id
      );

    WHEN 'results.finalize' THEN
      UPDATE term_results
      SET status = 'published', finalized_at = now(),
          scores = p_payload->'scores'
      WHERE enrollment_id = (p_payload->>'enrollment_id')::uuid
        AND academic_session = p_payload->>'academic_session'
        AND term = (p_payload->>'term')::int
        AND school_id = p_school_id;

      IF NOT FOUND THEN
        INSERT INTO term_results
          (enrollment_id, school_id, academic_session, term, scores, status, finalized_at)
        VALUES (
          (p_payload->>'enrollment_id')::uuid,
          p_school_id,
          p_payload->>'academic_session',
          (p_payload->>'term')::int,
          p_payload->'scores',
          'published',
          now()
        );
      END IF;

      v_result := jsonb_build_object(
        'entity_type', 'term_result',
        'enrollment_id', p_payload->>'enrollment_id'
      );

    WHEN 'results.reopen' THEN
      UPDATE term_results
      SET status = 'draft', finalized_at = null
      WHERE enrollment_id = (p_payload->>'enrollment_id')::uuid
        AND academic_session = p_payload->>'academic_session'
        AND term = (p_payload->>'term')::int
        AND school_id = p_school_id;

      v_result := jsonb_build_object(
        'entity_type', 'term_result',
        'correction_note', p_payload->>'correction_note'
      );

    WHEN 'results.submit' THEN
      -- Lecturer submits the draft for departmental verification. Scores lock
      -- on success (trg_lock_scores); a reject back to draft re-opens them.
      UPDATE course_offerings
      SET results_status = 'submitted'
      WHERE id = (p_payload->>'offering_id')::uuid
        AND results_status = 'draft'
      RETURNING * INTO v_offering;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Offering not found or not in draft status';
      END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id', v_offering.id);

    WHEN 'results.dept_verify' THEN
      SELECT c.department_id, d.faculty_id INTO v_off_dept, v_off_fac
        FROM course_offerings co JOIN courses c ON c.id = co.course_id
        JOIN departments d ON d.id = c.department_id
        WHERE co.id = (p_payload->>'offering_id')::uuid;
      IF v_office_name NOT IN ('school_admin','exam_officer')
         AND v_membership.department_id IS DISTINCT FROM v_off_dept THEN
        RAISE EXCEPTION 'Forbidden: those results are outside your department';
      END IF;
      UPDATE course_offerings SET results_status = 'dept_verified'
        WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'submitted';
      IF NOT FOUND THEN RAISE EXCEPTION 'Offering not awaiting departmental verification'; END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.dept_approve' THEN
      SELECT c.department_id, d.faculty_id INTO v_off_dept, v_off_fac
        FROM course_offerings co JOIN courses c ON c.id = co.course_id
        JOIN departments d ON d.id = c.department_id
        WHERE co.id = (p_payload->>'offering_id')::uuid;
      IF v_office_name <> 'school_admin'
         AND v_membership.department_id IS DISTINCT FROM v_off_dept THEN
        RAISE EXCEPTION 'Forbidden: those results are outside your department';
      END IF;
      UPDATE course_offerings SET results_status = 'dept_approved'
        WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'dept_verified';
      IF NOT FOUND THEN RAISE EXCEPTION 'Offering not awaiting departmental approval'; END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.faculty_verify' THEN
      SELECT c.department_id, d.faculty_id INTO v_off_dept, v_off_fac
        FROM course_offerings co JOIN courses c ON c.id = co.course_id
        JOIN departments d ON d.id = c.department_id
        WHERE co.id = (p_payload->>'offering_id')::uuid;
      IF v_office_name <> 'school_admin'
         AND v_membership.faculty_id IS DISTINCT FROM v_off_fac THEN
        RAISE EXCEPTION 'Forbidden: those results are outside your faculty';
      END IF;
      UPDATE course_offerings SET results_status = 'faculty_verified'
        WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'dept_approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'Offering not awaiting faculty verification'; END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.publish' THEN
      SELECT c.department_id, d.faculty_id INTO v_off_dept, v_off_fac
        FROM course_offerings co JOIN courses c ON c.id = co.course_id
        JOIN departments d ON d.id = c.department_id
        WHERE co.id = (p_payload->>'offering_id')::uuid;
      IF v_office_name <> 'school_admin'
         AND v_membership.faculty_id IS DISTINCT FROM v_off_fac THEN
        RAISE EXCEPTION 'Forbidden: those results are outside your faculty';
      END IF;
      UPDATE course_offerings SET results_status = 'published'
        WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'faculty_verified';
      IF NOT FOUND THEN RAISE EXCEPTION 'Offering not awaiting publication'; END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.reject' THEN
      -- Any approver may send results ONE step back to the previous owner to make
      -- changes. Office + scope required match the level being rejected.
      SELECT co.results_status, c.department_id, d.faculty_id
        INTO v_cur_status, v_off_dept, v_off_fac
        FROM course_offerings co JOIN courses c ON c.id = co.course_id
        JOIN departments d ON d.id = c.department_id
        WHERE co.id = (p_payload->>'offering_id')::uuid;

      IF v_cur_status = 'submitted' THEN
        v_new_status := 'draft';
        IF v_office_name NOT IN ('school_admin','exam_officer','dept_exam_officer') THEN
          RAISE EXCEPTION 'Forbidden: only the departmental verifier may reject here'; END IF;
        IF v_office_name NOT IN ('school_admin','exam_officer')
           AND v_membership.department_id IS DISTINCT FROM v_off_dept THEN
          RAISE EXCEPTION 'Forbidden: those results are outside your department'; END IF;
      ELSIF v_cur_status = 'dept_verified' THEN
        v_new_status := 'submitted';
        IF v_office_name NOT IN ('school_admin','hod') THEN
          RAISE EXCEPTION 'Forbidden: only the HOD may reject here'; END IF;
        IF v_office_name <> 'school_admin'
           AND v_membership.department_id IS DISTINCT FROM v_off_dept THEN
          RAISE EXCEPTION 'Forbidden: those results are outside your department'; END IF;
      ELSIF v_cur_status = 'dept_approved' THEN
        v_new_status := 'dept_verified';
        IF v_office_name NOT IN ('school_admin','faculty_exam_officer') THEN
          RAISE EXCEPTION 'Forbidden: only the faculty verifier may reject here'; END IF;
        IF v_office_name <> 'school_admin'
           AND v_membership.faculty_id IS DISTINCT FROM v_off_fac THEN
          RAISE EXCEPTION 'Forbidden: those results are outside your faculty'; END IF;
      ELSIF v_cur_status = 'faculty_verified' THEN
        v_new_status := 'dept_approved';
        IF v_office_name NOT IN ('school_admin','dean') THEN
          RAISE EXCEPTION 'Forbidden: only the Dean may reject here'; END IF;
        IF v_office_name <> 'school_admin'
           AND v_membership.faculty_id IS DISTINCT FROM v_off_fac THEN
          RAISE EXCEPTION 'Forbidden: those results are outside your faculty'; END IF;
      ELSE
        RAISE EXCEPTION 'Nothing to reject at status %', v_cur_status;
      END IF;

      UPDATE course_offerings SET results_status = v_new_status
        WHERE id = (p_payload->>'offering_id')::uuid;
      v_result := jsonb_build_object('entity_type','course_offering',
        'entity_id',(p_payload->>'offering_id')::uuid,
        'rejected_to', v_new_status,
        'rejection_note', p_payload->>'rejection_note');

    WHEN 'fee.record' THEN
      v_receipt_ref := 'RCP-' || lpad((nextval('audit_log_seq'))::text, 5, '0');
      INSERT INTO fee_records
        (enrollment_id, school_id, amount, description, academic_session, term, receipt_ref)
      VALUES (
        (p_payload->>'enrollment_id')::uuid,
        p_school_id,
        (p_payload->>'amount')::numeric,
        p_payload->>'description',
        p_payload->>'academic_session',
        (p_payload->>'term')::int,
        v_receipt_ref
      );
      v_result := jsonb_build_object(
        'receipt_ref', v_receipt_ref,
        'entity_type', 'fee_record'
      );

    WHEN 'learner.promote' THEN
      -- Class-aware promotion. payload: { enrollment_ids: [uuid, ...] }
      -- Only the ids passed are touched, so repeaters are simply left out.
      -- Graduation runs FIRST: once those rows are no longer 'active' the
      -- promote UPDATE below can't also move them.
      UPDATE learner_enrollments le
      SET status = 'graduated', exit_date = CURRENT_DATE
      FROM k12_classes kc
      WHERE le.class_id = kc.id
        AND kc.is_graduating_class = true
        AND le.school_id = p_school_id
        AND le.status = 'active'
        AND le.id IN (SELECT (jsonb_array_elements_text(p_payload->'enrollment_ids'))::uuid);
      GET DIAGNOSTICS v_graduated = ROW_COUNT;

      -- Promote into the class's configured next class. stage is taken from the
      -- DESTINATION class so stage and class can never disagree.
      UPDATE learner_enrollments le
      SET class_id = kc.next_class_id, stage = nc.stage
      FROM k12_classes kc
      JOIN k12_classes nc ON nc.id = kc.next_class_id
      WHERE le.class_id = kc.id
        AND le.school_id = p_school_id
        AND le.status = 'active'
        AND le.id IN (SELECT (jsonb_array_elements_text(p_payload->'enrollment_ids'))::uuid);
      GET DIAGNOSTICS v_promoted = ROW_COUNT;

      -- Anything left is in a class with no next class and no graduating flag:
      -- an unconfigured progression. Skip it loudly rather than silently
      -- graduating a whole school by accident.
      SELECT count(*) INTO v_skipped
      FROM learner_enrollments le
      JOIN k12_classes kc ON kc.id = le.class_id
      WHERE le.school_id = p_school_id
        AND le.status = 'active'
        AND kc.next_class_id IS NULL
        AND kc.is_graduating_class = false
        AND le.id IN (SELECT (jsonb_array_elements_text(p_payload->'enrollment_ids'))::uuid);

      v_result := jsonb_build_object(
        'entity_type','learner_enrollment',
        'promoted', v_promoted, 'graduated', v_graduated, 'skipped', v_skipped);

    WHEN 'learner.transfer.initiate' THEN
      UPDATE learner_enrollments
      SET status = 'transferred', exit_date = CURRENT_DATE
      WHERE id = (p_payload->>'enrollment_id')::uuid
        AND school_id = p_school_id;

      v_result := jsonb_build_object(
        'entity_type', 'learner_enrollment',
        'entity_id',   (p_payload->>'enrollment_id')::uuid,
        'destination', p_payload->>'destination_school_id'
      );

    WHEN 'senate.ratify' THEN
      IF NOT EXISTS (
        SELECT 1 FROM semesters s
        WHERE s.id = (p_payload->>'semester_id')::uuid
          AND s.school_id = p_school_id
      ) THEN
        RAISE EXCEPTION 'Semester does not belong to this school';
      END IF;

      v_result := _flow_senate_ratify(p_payload, p_school_id, v_profile_id);
      v_result := v_result || jsonb_build_object(
        'entity_type', 'senate_ratification',
        'entity_id',   v_result->>'ratification_id'
      );

    WHEN 'fee.invoice_create' THEN
      IF NOT EXISTS (
        SELECT 1 FROM students st
        WHERE st.id = (p_payload->>'student_id')::uuid
          AND st.institution_id = p_school_id
      ) THEN
        RAISE EXCEPTION 'Student does not belong to this school';
      END IF;
      v_result := _flow_fee_invoice_create(p_payload, p_school_id);

    WHEN 'fee.payment_record' THEN
      IF NOT EXISTS (
        SELECT 1 FROM fee_invoices fi
        WHERE fi.id = (p_payload->>'invoice_id')::uuid
          AND fi.school_id = p_school_id
      ) THEN
        RAISE EXCEPTION 'Invoice does not belong to this school';
      END IF;
      v_result := _flow_fee_payment_record(p_payload, p_school_id, v_profile_id);

    WHEN 'fee.waive' THEN
      IF NOT EXISTS (
        SELECT 1 FROM fee_invoices fi
        WHERE fi.id = (p_payload->>'invoice_id')::uuid
          AND fi.school_id = p_school_id
      ) THEN
        RAISE EXCEPTION 'Invoice does not belong to this school';
      END IF;
      v_result := _flow_fee_waive(p_payload);

    ELSE
      RAISE EXCEPTION 'Unknown action type: %', p_action_type;
  END CASE;

  v_audit_ref := 'AUD-' || to_char(now(), 'YYYYMMDD') || '-' ||
                 lpad((nextval('audit_log_seq'))::text, 4, '0');

  INSERT INTO audit_log
    (audit_ref, school_id, action_type, actor_profile_id, actor_office, payload)
  VALUES
    (v_audit_ref, p_school_id, p_action_type, v_profile_id, v_office_name, p_payload)
  RETURNING id INTO v_audit_id;

  INSERT INTO system_event (audit_log_id, event_type, entity_type, entity_id, delta)
  VALUES (
    v_audit_id,
    p_action_type,
    COALESCE(v_result->>'entity_type', 'unknown'),
    (v_result->>'entity_id')::uuid,
    v_result
  );

  RETURN jsonb_build_object(
    'ok',        true,
    'audit_ref', v_audit_ref,
    'action',    p_action_type,
    'result',    v_result
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

-- 4) Edit-before-submission: scores are editable only while the offering is 'draft'
CREATE OR REPLACE FUNCTION lock_scores_to_draft()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_status text; v_off uuid;
BEGIN
  v_off := COALESCE(NEW.offering_id, OLD.offering_id);
  SELECT results_status INTO v_status FROM course_offerings WHERE id = v_off;
  IF auth.uid() IS NOT NULL AND NOT is_super_admin() AND v_status IS DISTINCT FROM 'draft' THEN
    IF (TG_OP = 'INSERT' AND (NEW.ca_score IS NOT NULL OR NEW.exam_score IS NOT NULL OR NEW.grade IS NOT NULL))
       OR (TG_OP = 'UPDATE' AND (NEW.ca_score IS DISTINCT FROM OLD.ca_score
                              OR NEW.exam_score IS DISTINCT FROM OLD.exam_score
                              OR NEW.grade IS DISTINCT FROM OLD.grade)) THEN
      RAISE EXCEPTION 'Scores are locked: results are no longer in draft (status %)', v_status;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_lock_scores ON course_registrations;
CREATE TRIGGER trg_lock_scores BEFORE INSERT OR UPDATE ON course_registrations
  FOR EACH ROW EXECUTE FUNCTION lock_scores_to_draft();

COMMIT;
SELECT 'phase38 done' AS status;
