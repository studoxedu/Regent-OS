-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 23 MIGRATION
-- Fix: parent/guardian portal shows nothing (RLS blocks guardians)
-- ═══════════════════════════════════════════════════════════
--
-- The parent portal (src/pages/portal/ParentDashboard.tsx) authenticates
-- a guardian (a Supabase auth user with NO school membership) and reads:
--   guardians -> guardian_links -> learners -> learner_enrollments
--   -> term_results / fee_invoices / attendance_records
-- guardians, guardian_links, fee_invoices, attendance_records already
-- have permissive (USING true) SELECT policies, so a guardian can read
-- them. But learners, learner_enrollments and term_results all require an
-- active membership at the school (checked live) — which a guardian does
-- not have. Result: the dashboard can never resolve the learner's
-- enrollment, so schoolId is undefined and EVERY tab (results, fees,
-- attendance) renders empty. This is the app's most important sales
-- screen and it currently shows nothing.
--
-- Fix: add guardian-self SELECT policies on those three tables, scoped by
-- the guardian's email (auth.jwt() ->> 'email') matching a guardians row
-- linked to the learner. Mirrors the existing guardian_read_own_
-- notifications policy on guardian_notifications (same email-match
-- approach). SECURITY DEFINER helpers keep the cross-table checks out of
-- the policy body so they don't get silently filtered by the referenced
-- tables' own RLS. Purely additive — no existing staff/student access
-- changes.

-- ── Helper: does the calling guardian own this learner? ────────
CREATE OR REPLACE FUNCTION guardian_owns_learner(p_learner_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM guardian_links gl
    JOIN guardians g ON g.id = gl.guardian_id
    WHERE gl.learner_id = p_learner_id
      AND lower(g.email) = lower(auth.jwt() ->> 'email')
  )
$$;
GRANT EXECUTE ON FUNCTION guardian_owns_learner(UUID) TO authenticated;

-- ── Helper: does the calling guardian own this enrollment? ─────
CREATE OR REPLACE FUNCTION guardian_owns_enrollment(p_enrollment_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM learner_enrollments le
    JOIN guardian_links gl ON gl.learner_id = le.learner_id
    JOIN guardians g ON g.id = gl.guardian_id
    WHERE le.id = p_enrollment_id
      AND lower(g.email) = lower(auth.jwt() ->> 'email')
  )
$$;
GRANT EXECUTE ON FUNCTION guardian_owns_enrollment(UUID) TO authenticated;

-- ── Guardian read policies ─────────────────────────────────────
DROP POLICY IF EXISTS guardian_read_learners ON learners;
CREATE POLICY guardian_read_learners ON learners FOR SELECT TO authenticated
  USING (guardian_owns_learner(id));

DROP POLICY IF EXISTS guardian_read_enrollments ON learner_enrollments;
CREATE POLICY guardian_read_enrollments ON learner_enrollments FOR SELECT TO authenticated
  USING (guardian_owns_learner(learner_id));

DROP POLICY IF EXISTS guardian_read_term_results ON term_results;
CREATE POLICY guardian_read_term_results ON term_results FOR SELECT TO authenticated
  USING (guardian_owns_enrollment(enrollment_id));

SELECT 'phase23 done' AS status;
