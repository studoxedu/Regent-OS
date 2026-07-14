-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 26 MIGRATION
-- Close the cross-tenant READ leak.
-- ═══════════════════════════════════════════════════════════
--
-- ~25 tenant tables had SELECT policies of USING(true), i.e. any
-- authenticated user (from ANY school) could read every school's fees,
-- payroll, salaries, guardian PII, payment records, attendance, etc. via
-- the API. This scopes each to the caller's own school(s), while
-- PRESERVING the two legitimate no-membership readers:
--   * parent portal  (guardian, matched by auth.jwt() email)
--   * student portal (tertiary student, matched by students.auth_user_id)
--
-- Template/reference tables (capabilities, offices, office_types,
-- office_type_capabilities, education_levels, tert_capabilities) are left
-- open deliberately — they are global role/config data, not tenant data.
--
-- SECURITY DEFINER helpers are used wherever a policy must consult
-- another RLS-protected table, so the check isn't silently filtered by
-- that table's own RLS.

-- ── Helpers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION staff_shares_school_with_learner(p_learner_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM learner_enrollments le
    JOIN memberships m ON m.school_id = le.school_id
    WHERE le.learner_id = p_learner_id AND m.profile_id = auth.uid() AND m.is_active = true
  )
$$;
GRANT EXECUTE ON FUNCTION staff_shares_school_with_learner(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION staff_can_see_guardian(p_guardian_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM guardian_links gl
    JOIN learner_enrollments le ON le.learner_id = gl.learner_id
    JOIN memberships m ON m.school_id = le.school_id
    WHERE gl.guardian_id = p_guardian_id AND m.profile_id = auth.uid() AND m.is_active = true
  )
$$;
GRANT EXECUTE ON FUNCTION staff_can_see_guardian(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION guardian_owns_guardian_row(p_guardian_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM guardians g
    WHERE g.id = p_guardian_id AND lower(g.email) = lower(auth.jwt() ->> 'email')
  )
$$;
GRANT EXECUTE ON FUNCTION guardian_owns_guardian_row(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION member_of_office_instance_institution(p_oi UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_instances oi
    JOIN memberships m ON m.school_id = oi.institution_id
    WHERE oi.id = p_oi AND m.profile_id = auth.uid() AND m.is_active = true
  )
$$;
GRANT EXECUTE ON FUNCTION member_of_office_instance_institution(UUID) TO authenticated;

-- ── Group A: with school_id, staff (school member) only ────────
DROP POLICY IF EXISTS school_member_read_fee_cats     ON fee_categories;
CREATE POLICY school_member_read_fee_cats ON fee_categories FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_fee_structs   ON fee_structures;
CREATE POLICY school_member_read_fee_structs ON fee_structures FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_fee_payments  ON fee_payments;
CREATE POLICY school_member_read_fee_payments ON fee_payments FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_k12_sessions  ON k12_academic_sessions;
CREATE POLICY school_member_read_k12_sessions ON k12_academic_sessions FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_k12_classes   ON k12_classes;
CREATE POLICY school_member_read_k12_classes ON k12_classes FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_k12_subjects  ON k12_subjects;
CREATE POLICY school_member_read_k12_subjects ON k12_subjects FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_k12_terms     ON k12_terms;
CREATE POLICY school_member_read_k12_terms ON k12_terms FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_periods       ON k12_timetable_periods;
CREATE POLICY school_member_read_periods ON k12_timetable_periods FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS school_member_read_slots         ON k12_timetable_slots;
CREATE POLICY school_member_read_slots ON k12_timetable_slots FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_library_books          ON library_books;
CREATE POLICY school_member_read_library_books ON library_books FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_library_borrows        ON library_borrows;
CREATE POLICY school_member_read_library_borrows ON library_borrows FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_salary_grades          ON salary_grades;
CREATE POLICY school_member_read_salary_grades ON salary_grades FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_payroll_runs           ON payroll_runs;
CREATE POLICY school_member_read_payroll_runs ON payroll_runs FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_staff_profiles         ON staff_profiles;
CREATE POLICY school_member_read_staff_profiles ON staff_profiles FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_cbt_tests              ON cbt_tests;
CREATE POLICY school_member_read_cbt_tests ON cbt_tests FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS auth_read_announcements          ON announcements;
CREATE POLICY school_member_read_announcements ON announcements FOR SELECT TO authenticated
  USING (is_super_admin() OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

-- payroll_entries has no school_id → scope via its run
DROP POLICY IF EXISTS auth_read_payroll_entries        ON payroll_entries;
CREATE POLICY school_member_read_payroll_entries ON payroll_entries FOR SELECT TO authenticated
  USING (is_super_admin() OR run_id IN (
    SELECT pr.id FROM payroll_runs pr
    WHERE pr.school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true)));

-- ── Group B: staff (member) + parent/student self-access ───────
DROP POLICY IF EXISTS school_member_read_fee_invoices  ON fee_invoices;
CREATE POLICY school_member_read_fee_invoices ON fee_invoices FOR SELECT TO authenticated
  USING (is_super_admin()
     OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true)
     OR guardian_owns_enrollment(enrollment_id));      -- parent portal
-- (fi_student_read for tertiary student self already exists — left intact)

DROP POLICY IF EXISTS school_member_read_attendance    ON attendance_records;
CREATE POLICY school_member_read_attendance ON attendance_records FOR SELECT TO authenticated
  USING (is_super_admin()
     OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true)
     OR guardian_owns_enrollment(enrollment_id));      -- parent portal

DROP POLICY IF EXISTS auth_read_payment_transactions   ON payment_transactions;
CREATE POLICY read_payment_transactions ON payment_transactions FOR SELECT TO authenticated
  USING (is_super_admin()
     OR school_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true)
     OR profile_id = auth.uid()
     OR student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));

-- ── Group C: guardians / guardian_links (PII, no school_id) ────
DROP POLICY IF EXISTS school_member_read_guardians       ON guardians;
CREATE POLICY read_guardians ON guardians FOR SELECT TO authenticated
  USING (is_super_admin()
     OR staff_can_see_guardian(id)                              -- linked to my school's learner
     OR lower(email) = lower(auth.jwt() ->> 'email'));          -- guardian self

DROP POLICY IF EXISTS school_member_read_guardian_links  ON guardian_links;
CREATE POLICY read_guardian_links ON guardian_links FOR SELECT TO authenticated
  USING (is_super_admin()
     OR staff_shares_school_with_learner(learner_id)            -- staff at learner's school
     OR guardian_owns_guardian_row(guardian_id));               -- guardian self

-- ── Group D: tertiary students / admissions / office model ─────
DROP POLICY IF EXISTS students_read     ON students;
CREATE POLICY students_member_read ON students FOR SELECT TO authenticated
  USING (is_super_admin() OR institution_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));
-- (students_own_read / students_lecturer_read left intact)

DROP POLICY IF EXISTS admissions_read   ON admissions;
CREATE POLICY admissions_member_read ON admissions FOR SELECT TO authenticated
  USING (is_super_admin() OR institution_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));
-- (adm_self_read left intact)

DROP POLICY IF EXISTS oi_read ON office_instances;
CREATE POLICY office_instances_member_read ON office_instances FOR SELECT TO authenticated
  USING (is_super_admin() OR institution_id IN (SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true));

DROP POLICY IF EXISTS oa_read ON office_assignments;
CREATE POLICY office_assignments_read ON office_assignments FOR SELECT TO authenticated
  USING (is_super_admin() OR profile_id = auth.uid() OR member_of_office_instance_institution(office_instance_id));

DROP POLICY IF EXISTS od_read ON office_delegations;
CREATE POLICY office_delegations_read ON office_delegations FOR SELECT TO authenticated
  USING (is_super_admin() OR member_of_office_instance_institution(delegate_office_id));

SELECT 'phase26 done' AS status;
