-- ============================================================================
-- phase32.sql — Proprietor (group) read access for the group dashboard
-- (2026-07-19)
--
-- A proprietor's membership carries a group_id and NO school_id, so the
-- school-membership-scoped SELECT policies from phase26 returned 0 rows for
-- them on learner_enrollments / fee_invoices / audit_log / students. The
-- /proprietor dashboard therefore showed 0 learners and ₦0 fees for a
-- 500-pupil school.
--
-- This adds additive, read-only SELECT policies scoped to the proprietor's OWN
-- group via a SECURITY DEFINER helper (so it does not hit the
-- RLS-subquery-RLS trap). Existing school-member access is unaffected —
-- multiple permissive policies are OR'd.
--
-- The companion frontend change points the dashboard at the tables that
-- actually hold the data: fee_invoices (not the empty legacy fee_records) for
-- fees, and students (not learner_enrollments) for tertiary head-count.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.proprietor_over_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM schools s
    JOIN memberships m ON m.group_id = s.group_id
    WHERE s.id = p_school_id
      AND m.profile_id = auth.uid()
      AND m.is_active = true
      AND m.group_id IS NOT NULL
  )
$$;

GRANT EXECUTE ON FUNCTION public.proprietor_over_school(uuid) TO authenticated;

-- learner_enrollments (K-12 head-count) — keyed by school_id
DROP POLICY IF EXISTS prop_group_read ON learner_enrollments;
CREATE POLICY prop_group_read ON learner_enrollments
  FOR SELECT USING (proprietor_over_school(school_id));

-- fee_invoices (fees for both K-12 and tertiary) — keyed by school_id
DROP POLICY IF EXISTS prop_group_read ON fee_invoices;
CREATE POLICY prop_group_read ON fee_invoices
  FOR SELECT USING (proprietor_over_school(school_id));

-- audit_log (group-wide activity stream) — keyed by school_id
DROP POLICY IF EXISTS prop_group_read ON audit_log;
CREATE POLICY prop_group_read ON audit_log
  FOR SELECT USING (proprietor_over_school(school_id));

-- students (tertiary head-count) — keyed by institution_id
DROP POLICY IF EXISTS prop_group_read ON students;
CREATE POLICY prop_group_read ON students
  FOR SELECT USING (proprietor_over_school(institution_id));
