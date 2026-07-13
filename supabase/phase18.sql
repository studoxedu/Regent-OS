-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 18 MIGRATION
-- Fix: tertiary course creation is blocked; course reads are unscoped
-- ═══════════════════════════════════════════════════════════
--
-- courses has "Users manage own courses" (ALL, auth.uid() = user_id) —
-- a leftover policy shaped for a generic/unrelated single-user "my
-- courses" feature that doesn't match this app's actual courses table.
-- Structure.tsx's course-creation insert only ever sets department_id,
-- code, title, credit_units — never user_id — so that WITH CHECK can
-- never pass and every tertiary course creation is silently blocked.
-- (Same root-cause shape as phase17's course_registrations gap: a
-- policy scoped to a column the real write path never populates.)
--
-- courses_authenticated_read is USING(true) — fully open, same
-- cross-tenant gap as programs (phase16). Real course data exists at
-- both live institutions (24 + 12 rows, checked live) — tightening this
-- to same-school-only is safe since every legitimate reader is already
-- a member of the school whose courses they're viewing.
--
-- courses has no direct school_id — scoped via
-- department_id -> departments.faculty_id -> faculties.school_id.
-- Reuses the 'structure.manage' capability (same as faculties/
-- departments/programs).

DROP POLICY IF EXISTS courses_authenticated_read ON courses;
CREATE POLICY school_member_read_courses ON courses FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM departments d
    JOIN faculties f ON f.id = d.faculty_id
    JOIN memberships m ON m.school_id = f.school_id
    WHERE d.id = courses.department_id AND m.profile_id = auth.uid() AND m.is_active = true
  ));

CREATE POLICY write_courses_structure ON courses FOR ALL TO authenticated
  USING      (is_super_admin() OR EXISTS (
    SELECT 1 FROM departments d JOIN faculties f ON f.id = d.faculty_id
    WHERE d.id = courses.department_id AND has_school_capability(f.school_id, 'structure.manage')
  ))
  WITH CHECK (is_super_admin() OR EXISTS (
    SELECT 1 FROM departments d JOIN faculties f ON f.id = d.faculty_id
    WHERE d.id = courses.department_id AND has_school_capability(f.school_id, 'structure.manage')
  ));

SELECT 'phase18 done' AS status;
