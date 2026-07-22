-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 39 MIGRATION
-- Hard department (HOD) / faculty (Dean) read scoping.
-- ═══════════════════════════════════════════════════════════
--
-- HOD and Dean are scoped overseers: a HOD may only READ their own
-- department's records; a Dean only their faculty's. Every OTHER role
-- (VC/school_admin, registrar, lecturer, exam officers, students, guardians,
-- proprietor, super_admin) is unaffected — the helpers return TRUE for anyone
-- who is not an active HOD/Dean, so the added RESTRICTIVE policies are a no-op
-- for them.
--
-- Enforcement = additive RESTRICTIVE SELECT policies (AND-ed with existing
-- permissive + tier_gate policies). Writes are unchanged — HOD/Dean already hold
-- no write capabilities beyond results approval + communication, so "view only"
-- is enforced at the capability layer; this migration governs what they can SEE.
--
-- All helpers are SECURITY DEFINER so they read memberships/departments/etc.
-- WITHOUT being filtered by these same policies (no recursion, no RLS-subquery
-- trap). Fail-closed: a HOD/Dean whose membership has no department/faculty set
-- sees nothing in the scoped tables (not everything).

-- ── Helpers ────────────────────────────────────────────────────
-- Row's department is within the caller's scope? (TRUE for non-HOD/Dean.)
CREATE OR REPLACE FUNCTION scope_ok_dept(p_dept uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM memberships m JOIN offices o ON o.id = m.office_id
                WHERE m.profile_id = auth.uid() AND m.is_active AND o.name IN ('hod','dean'))
    OR EXISTS (SELECT 1 FROM memberships m JOIN offices o ON o.id = m.office_id
               WHERE m.profile_id = auth.uid() AND m.is_active AND o.name = 'hod'
                 AND m.department_id = p_dept)
    OR EXISTS (SELECT 1 FROM memberships m JOIN offices o ON o.id = m.office_id
               JOIN departments d ON d.id = p_dept
               WHERE m.profile_id = auth.uid() AND m.is_active AND o.name = 'dean'
                 AND d.faculty_id = m.faculty_id)
$$;
GRANT EXECUTE ON FUNCTION scope_ok_dept(uuid) TO authenticated;

-- Row's faculty is within the caller's scope? (TRUE for non-HOD/Dean.)
CREATE OR REPLACE FUNCTION scope_ok_faculty(p_fac uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM memberships m JOIN offices o ON o.id = m.office_id
                WHERE m.profile_id = auth.uid() AND m.is_active AND o.name IN ('hod','dean'))
    OR EXISTS (SELECT 1 FROM memberships m JOIN offices o ON o.id = m.office_id
               JOIN departments d ON d.id = m.department_id
               WHERE m.profile_id = auth.uid() AND m.is_active AND o.name = 'hod'
                 AND d.faculty_id = p_fac)
    OR EXISTS (SELECT 1 FROM memberships m JOIN offices o ON o.id = m.office_id
               WHERE m.profile_id = auth.uid() AND m.is_active AND o.name = 'dean'
                 AND m.faculty_id = p_fac)
$$;
GRANT EXECUTE ON FUNCTION scope_ok_faculty(uuid) TO authenticated;

-- Resolvers for join-keyed tables.
CREATE OR REPLACE FUNCTION course_dept(p_course uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT department_id FROM courses WHERE id = p_course
$$;
GRANT EXECUTE ON FUNCTION course_dept(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION offering_dept(p_offering uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT c.department_id FROM course_offerings co JOIN courses c ON c.id = co.course_id
  WHERE co.id = p_offering
$$;
GRANT EXECUTE ON FUNCTION offering_dept(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION membership_dept(p_membership uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT department_id FROM memberships WHERE id = p_membership
$$;
GRANT EXECUTE ON FUNCTION membership_dept(uuid) TO authenticated;

-- ── RESTRICTIVE scope policies ─────────────────────────────────
DROP POLICY IF EXISTS dept_scope ON students;
CREATE POLICY dept_scope ON students AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(department_id));

DROP POLICY IF EXISTS dept_scope ON departments;
CREATE POLICY dept_scope ON departments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(id));

DROP POLICY IF EXISTS dept_scope ON courses;
CREATE POLICY dept_scope ON courses AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(department_id));

DROP POLICY IF EXISTS dept_scope ON faculties;
CREATE POLICY dept_scope ON faculties AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_faculty(id));

DROP POLICY IF EXISTS dept_scope ON course_offerings;
CREATE POLICY dept_scope ON course_offerings AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(course_dept(course_id)));

DROP POLICY IF EXISTS dept_scope ON course_registrations;
CREATE POLICY dept_scope ON course_registrations AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(offering_dept(offering_id)));

DROP POLICY IF EXISTS dept_scope ON timetable_entries;
CREATE POLICY dept_scope ON timetable_entries AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(offering_dept(offering_id)));

DROP POLICY IF EXISTS dept_scope ON exam_entries;
CREATE POLICY dept_scope ON exam_entries AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(offering_dept(offering_id)));

DROP POLICY IF EXISTS dept_scope ON staff_profiles;
CREATE POLICY dept_scope ON staff_profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR scope_ok_dept(membership_dept(membership_id)));

-- memberships: everyone must always see their OWN row (auth/self), then scope.
DROP POLICY IF EXISTS dept_scope ON memberships;
CREATE POLICY dept_scope ON memberships AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin()
     OR profile_id = auth.uid()
     OR scope_ok_dept(department_id)
     OR (faculty_id IS NOT NULL AND scope_ok_faculty(faculty_id)));

SELECT 'phase39 done' AS status;
