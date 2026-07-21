-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 33 MIGRATION
-- Complete proprietor / multi-branch read visibility.
-- ═══════════════════════════════════════════════════════════
--
-- phase32 gave the proprietor group-scoped READ on the four tables the
-- dashboard's summary query touches (learner_enrollments, fee_invoices,
-- audit_log, students) plus schools (schools_proprietor_read). That is enough
-- for the top-level dashboard but leaves gaps:
--   * memberships  → SchoolDetail "Staff Members" count read 0 for a proprietor
--   * ~28 other tenant tables → a group observer could not read results,
--     attendance, timetables, fee breakdowns, payroll, library, etc. across
--     branches, so "full visibility across campuses" was only partial.
--
-- This adds a uniform, ADDITIVE, read-only `<table>_group_observer` SELECT
-- policy to every tenant table that is otherwise scoped to a single school's
-- members, reusing the existing SECURITY DEFINER helper `proprietor_over_school`.
--
-- ADDITIVE by design: the hardened branch-isolation policies from phase26 are
-- left byte-for-byte untouched. Postgres OR's permissive policies, so this can
-- only GRANT the group observer extra read — it cannot widen anyone else's
-- access. Ordinary staff hold no group_id membership, so proprietor_over_school
-- returns false for them and their isolation is unchanged. Writes are untouched
-- (proprietor stays strictly read-only).
--
-- The four phase32 `prop_group_read` policies are folded into this uniform set
-- so there is a single mechanism and naming convention (no behaviour change —
-- same helper, same predicate).

-- Helper is unchanged from phase32; re-assert idempotently.
CREATE OR REPLACE FUNCTION public.proprietor_over_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
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

-- Retire the phase32 ad-hoc policies; the loop below re-creates equivalent
-- coverage under the uniform *_group_observer name.
DROP POLICY IF EXISTS prop_group_read ON learner_enrollments;
DROP POLICY IF EXISTS prop_group_read ON fee_invoices;
DROP POLICY IF EXISTS prop_group_read ON audit_log;
DROP POLICY IF EXISTS prop_group_read ON students;

DO $mig$
DECLARE
  -- table -> the column that identifies the owning school.
  -- schools itself is intentionally excluded (schools_proprietor_read already
  -- covers it, keyed on group_id directly).
  colmap jsonb := jsonb_build_object(
    -- keyed by school_id
    'academic_sessions','school_id', 'announcements','school_id',
    'attendance_records','school_id', 'audit_log','school_id',
    'cbt_tests','school_id', 'faculties','school_id',
    'fee_categories','school_id', 'fee_invoices','school_id',
    'fee_payments','school_id', 'fee_structures','school_id',
    'grade_scales','school_id', 'k12_academic_sessions','school_id',
    'k12_classes','school_id', 'k12_subjects','school_id',
    'k12_terms','school_id', 'k12_timetable_periods','school_id',
    'k12_timetable_slots','school_id', 'learner_enrollments','school_id',
    'library_books','school_id', 'library_borrows','school_id',
    'payroll_runs','school_id', 'salary_grades','school_id',
    'staff_profiles','school_id', 'semesters','school_id',
    'term_results','school_id', 'payment_transactions','school_id',
    'memberships','school_id',
    -- keyed by institution_id
    'admissions','institution_id', 'office_instances','institution_id',
    'students','institution_id', 'venues','institution_id',
    'boards','institution_id',
    -- keyed via parent payroll_runs
    'payroll_entries','__run__'
  );
  t   text;
  col text;
  pred text;
BEGIN
  FOR t, col IN SELECT * FROM jsonb_each_text(colmap) LOOP
    IF col = '__run__' THEN
      pred := 'run_id IN (SELECT pr.id FROM payroll_runs pr WHERE proprietor_over_school(pr.school_id))';
    ELSE
      pred := format('proprietor_over_school(%I)', col);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_group_observer', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      t || '_group_observer', t, pred
    );
    RAISE NOTICE 'phase33: group-observer read on %', t;
  END LOOP;
END $mig$;

SELECT 'phase33 done' AS status;
