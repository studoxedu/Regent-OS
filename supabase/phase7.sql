-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 7 MIGRATION
-- Capability-scoped RLS on shared operational tables
-- (announcements · staff/HR · payroll · library)
-- ═══════════════════════════════════════════════════════════
--
-- These tables are written directly by shared pages used from both K-12
-- and tertiary, and had only permissive SELECT policies. This extends
-- the phase6 pattern to them. Same safety property: policies are
-- ADDITIVE (permissive OR), so this can't break a currently-working
-- write; to actually tighten, any hand-added permissive write policy
-- must be dropped (run the pg_policies diagnostic first).
--
-- messages / conversation_participants / cbt_* already have their own
-- scoped policies from phase4 and are intentionally left alone.

-- ── 0. Helper: active (non-student) staff at a school ────────
-- Used for announcements, which any staff member may post to their own
-- school. (has_school_capability / has_any_capability / is_super_admin
-- come from phase6.)
CREATE OR REPLACE FUNCTION is_active_school_staff(p_school_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN offices o ON o.id = m.office_id
    WHERE m.profile_id = auth.uid()
      AND m.school_id   = p_school_id
      AND m.is_active   = true
      AND o.name       <> 'student'
  )
$$;
GRANT EXECUTE ON FUNCTION is_active_school_staff(UUID) TO authenticated;

-- ── 1. Capabilities for the specialised offices ──────────────
INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  -- HR / staff records
  ('head_teacher',    'staff.manage'),
  ('school_admin',    'staff.manage'),
  ('hr_officer',      'staff.manage'),
  -- Payroll
  ('head_teacher',    'payroll.manage'),
  ('bursar',          'payroll.manage'),
  ('school_admin',    'payroll.manage'),
  ('finance_officer', 'payroll.manage'),
  ('hr_officer',      'payroll.manage'),
  -- Library
  ('head_teacher',    'library.manage'),
  ('school_admin',    'library.manage'),
  ('library_officer', 'library.manage')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

-- ── 2. Write policies (FOR ALL; reads keep their SELECT policies) ──

-- Announcements — any active staff of the school
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_announcements ON announcements;
CREATE POLICY write_announcements ON announcements FOR ALL TO authenticated
  USING      (is_super_admin() OR is_active_school_staff(school_id))
  WITH CHECK (is_super_admin() OR is_active_school_staff(school_id));

-- Staff profiles & salary grades — staff.manage
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_staff_profiles ON staff_profiles;
CREATE POLICY write_staff_profiles ON staff_profiles FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'staff.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'staff.manage'));

ALTER TABLE salary_grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_salary_grades ON salary_grades;
CREATE POLICY write_salary_grades ON salary_grades FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'staff.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'staff.manage'));

-- Payroll — payroll.manage. payroll_entries has no school_id (child of
-- payroll_runs), so it uses the any-school capability check.
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_payroll_runs ON payroll_runs;
CREATE POLICY write_payroll_runs ON payroll_runs FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'payroll.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'payroll.manage'));

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_payroll_entries ON payroll_entries;
CREATE POLICY write_payroll_entries ON payroll_entries FOR ALL TO authenticated
  USING      (is_super_admin() OR has_any_capability('payroll.manage'))
  WITH CHECK (is_super_admin() OR has_any_capability('payroll.manage'));

-- Library — library.manage
ALTER TABLE library_books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_library_books ON library_books;
CREATE POLICY write_library_books ON library_books FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'library.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'library.manage'));

ALTER TABLE library_borrows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_library_borrows ON library_borrows;
CREATE POLICY write_library_borrows ON library_borrows FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'library.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'library.manage'));

SELECT 'phase7 done' AS status;
