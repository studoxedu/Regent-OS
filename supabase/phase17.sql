-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 17 MIGRATION
-- Fix: staff can't register students into course offerings
-- ═══════════════════════════════════════════════════════════
--
-- course_registrations has cr_student_rw (ALL, scoped to
-- student_id IN (SELECT students.id FROM students WHERE auth_user_id =
-- auth.uid())) and cr_lecturer_score (UPDATE, for score entry). Neither
-- covers the staff-facing path: src/pages/tertiary/CourseRegistration.tsx
-- (the registrar/school_admin "Add Registration" flow) inserts rows with
-- enrollment_id set and student_id left NULL — cr_student_rw's WITH CHECK
-- can never match a NULL student_id, so every staff-driven registration
-- insert/delete is blocked. 'course.register' is an existing capability
-- already held by school_admin (unused until now) — this wires it up,
-- scoped via offering_id -> semester_id -> school_id.
--
-- ⚠️ Known separate issue (not fixed here, needs a product decision):
-- CourseRegistration.tsx is built entirely around enrollment_id /
-- learner_enrollments, but the two real tertiary institutions
-- (Federal University of Studox, Studox Polytechnic) have their students
-- in the older students/admissions tables (registry.sql) with zero
-- learner_enrollments rows between them. This page is presently
-- unusable for real tenant data regardless of RLS — the "Add
-- Registration" learner picker has nothing to select from. This RLS fix
-- makes the write path correct for whenever that data-model gap is
-- resolved; it does not by itself make the page usable today.

CREATE POLICY write_course_registrations_staff ON course_registrations FOR ALL TO authenticated
  USING      (is_super_admin() OR EXISTS (
    SELECT 1 FROM course_offerings co
    JOIN semesters se ON se.id = co.semester_id
    WHERE co.id = course_registrations.offering_id
      AND has_school_capability(se.school_id, 'course.register')
  ))
  WITH CHECK (is_super_admin() OR EXISTS (
    SELECT 1 FROM course_offerings co
    JOIN semesters se ON se.id = co.semester_id
    WHERE co.id = course_registrations.offering_id
      AND has_school_capability(se.school_id, 'course.register')
  ));

SELECT 'phase17 done' AS status;
