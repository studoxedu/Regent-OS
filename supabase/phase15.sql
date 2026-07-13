-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 15 MIGRATION
-- Security fix: tertiary structure tables had RLS fully disabled
-- ═══════════════════════════════════════════════════════════
--
-- academic_sessions, semesters, faculties, departments, grade_scales and
-- course_offerings all have relrowsecurity = false in production — RLS
-- was never turned on for them at all (not "misconfigured", genuinely
-- off). On a multi-tenant platform this means ANY authenticated user,
-- from ANY school, can currently read AND write any other school's
-- tertiary academic sessions, semesters, faculties, departments, grade
-- scales, and course offerings. There are two real, active tertiary
-- institutions on the platform today (Federal University of Studox,
-- Studox Polytechnic) whose data is exposed to each other and to every
-- other account right now.
--
-- Mirrors the phase6/phase9 pattern: capability-scoped writes via
-- has_school_capability(), permissive same-school reads via a
-- "school_member_read_*" policy (any active member of that school —
-- matches the existing pattern on attendance/fees/guardians/etc. — this
-- is a multi-tenant boundary fix, not a role-scoping change, so every
-- role that could read before within their own school can still read).
--
-- Capabilities used: 'session.create' and 'structure.manage' already
-- exist and are held by school_admin (checked live against the
-- capabilities table before writing this). departments and
-- course_offerings have no direct school_id column, so they're scoped
-- via their parent (faculty_id -> faculties.school_id,
-- semester_id -> semesters.school_id).
--
-- ⚠️ Because two real institutions are actively using these tables,
-- apply this only after confirming with the user, and re-verify their
-- tertiary dashboards/Structure/Sessions/Coredesk pages still load
-- immediately afterward.

-- ── academic_sessions ──────────────────────────────────────────
ALTER TABLE academic_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_academic_sessions ON academic_sessions;
CREATE POLICY school_member_read_academic_sessions ON academic_sessions FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (
    SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true
  ));
DROP POLICY IF EXISTS write_academic_sessions ON academic_sessions;
CREATE POLICY write_academic_sessions ON academic_sessions FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'session.create'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'session.create'));

-- ── semesters ──────────────────────────────────────────────────
ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_semesters ON semesters;
CREATE POLICY school_member_read_semesters ON semesters FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (
    SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true
  ));
DROP POLICY IF EXISTS write_semesters ON semesters;
CREATE POLICY write_semesters ON semesters FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'session.create'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'session.create'));

-- ── faculties ──────────────────────────────────────────────────
ALTER TABLE faculties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_faculties ON faculties;
CREATE POLICY school_member_read_faculties ON faculties FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (
    SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true
  ));
DROP POLICY IF EXISTS write_faculties ON faculties;
CREATE POLICY write_faculties ON faculties FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'structure.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'structure.manage'));

-- ── departments (scoped via parent faculty's school_id) ───────
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_departments ON departments;
CREATE POLICY school_member_read_departments ON departments FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM faculties f
    JOIN memberships m ON m.school_id = f.school_id
    WHERE f.id = departments.faculty_id AND m.profile_id = auth.uid() AND m.is_active = true
  ));
DROP POLICY IF EXISTS write_departments ON departments;
CREATE POLICY write_departments ON departments FOR ALL TO authenticated
  USING      (is_super_admin() OR EXISTS (
    SELECT 1 FROM faculties f WHERE f.id = departments.faculty_id
      AND has_school_capability(f.school_id, 'structure.manage')
  ))
  WITH CHECK (is_super_admin() OR EXISTS (
    SELECT 1 FROM faculties f WHERE f.id = departments.faculty_id
      AND has_school_capability(f.school_id, 'structure.manage')
  ));

-- ── grade_scales ───────────────────────────────────────────────
ALTER TABLE grade_scales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_grade_scales ON grade_scales;
CREATE POLICY school_member_read_grade_scales ON grade_scales FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (
    SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true
  ));
DROP POLICY IF EXISTS write_grade_scales ON grade_scales;
CREATE POLICY write_grade_scales ON grade_scales FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'structure.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'structure.manage'));

-- ── course_offerings (scoped via parent semester's school_id) ──
ALTER TABLE course_offerings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_course_offerings ON course_offerings;
CREATE POLICY school_member_read_course_offerings ON course_offerings FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM semesters s
    JOIN memberships m ON m.school_id = s.school_id
    WHERE s.id = course_offerings.semester_id AND m.profile_id = auth.uid() AND m.is_active = true
  ));
DROP POLICY IF EXISTS write_course_offerings ON course_offerings;
CREATE POLICY write_course_offerings ON course_offerings FOR ALL TO authenticated
  USING      (is_super_admin() OR EXISTS (
    SELECT 1 FROM semesters s WHERE s.id = course_offerings.semester_id
      AND has_school_capability(s.school_id, 'structure.manage')
  ))
  WITH CHECK (is_super_admin() OR EXISTS (
    SELECT 1 FROM semesters s WHERE s.id = course_offerings.semester_id
      AND has_school_capability(s.school_id, 'structure.manage')
  ));

SELECT 'phase15 done' AS status;
