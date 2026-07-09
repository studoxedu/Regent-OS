-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 6 MIGRATION
-- Enforce K-12 direct-write access by office capability (RLS)
-- ═══════════════════════════════════════════════════════════
--
-- Several K-12 pages write straight to the database (attendance, fees,
-- guardians) instead of going through flow_execute (which is
-- SECURITY DEFINER and already capability-checked). Those tables had
-- only permissive SELECT policies, so the office boundary was enforced
-- only in the UI. This migration adds capability-scoped WRITE policies
-- so the database itself is the boundary.
--
-- SAFETY: these policies are ADDITIVE. Postgres combines permissive
-- policies with OR, so adding them can never break a write that works
-- today — it only grants the capability-checked path. If a permissive
-- USING(true) write policy was ever added by hand, it must be dropped
-- for the tightening to bite (see the diagnostic in the handoff notes).

-- ── 0. Helpers ───────────────────────────────────────────────

-- Platform super admin (re-declared idempotently; matches run_superadmin.cjs)
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'super_admin'
  )
$$;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated;

-- Does the caller hold an active membership at this school whose office
-- has the given capability?
CREATE OR REPLACE FUNCTION has_school_capability(p_school_id UUID, p_action TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN capabilities c ON c.office_id = m.office_id
    WHERE m.profile_id = auth.uid()
      AND m.school_id   = p_school_id
      AND m.is_active   = true
      AND c.action      = p_action
  )
$$;
GRANT EXECUTE ON FUNCTION has_school_capability(UUID, TEXT) TO authenticated;

-- Guardians/guardian_links are shared across schools (no school_id), so
-- gate them on holding the capability at ANY active school.
CREATE OR REPLACE FUNCTION has_any_capability(p_action TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN capabilities c ON c.office_id = m.office_id
    WHERE m.profile_id = auth.uid()
      AND m.is_active   = true
      AND c.action      = p_action
  )
$$;
GRANT EXECUTE ON FUNCTION has_any_capability(TEXT) TO authenticated;

-- ── 1. Complete the capability rows the direct-write paths need ──
-- Head Teacher must be able to do everything; Exam Officer owns the
-- Academics section (which includes Attendance).

INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  ('head_teacher',     'attendance.record'),
  ('head_teacher',     'fee.payment.record'),
  ('k12_exam_officer', 'attendance.record')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

-- ── 2. Capability-scoped write policies ──────────────────────
-- FOR ALL covers insert/update/upsert/delete. Reads are unaffected:
-- the existing permissive SELECT policies remain and are OR'd in.

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_attendance ON attendance_records;
CREATE POLICY k12_write_attendance ON attendance_records FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'attendance.record'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'attendance.record'));

ALTER TABLE fee_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_fee_categories ON fee_categories;
CREATE POLICY k12_write_fee_categories ON fee_categories FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'fee.structure.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'fee.structure.manage'));

ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_fee_structures ON fee_structures;
CREATE POLICY k12_write_fee_structures ON fee_structures FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'fee.structure.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'fee.structure.manage'));

ALTER TABLE fee_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_fee_invoices ON fee_invoices;
CREATE POLICY k12_write_fee_invoices ON fee_invoices FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'fee.invoice.generate'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'fee.invoice.generate'));

ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_fee_payments ON fee_payments;
CREATE POLICY k12_write_fee_payments ON fee_payments FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'fee.payment.record'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'fee.payment.record'));

ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_guardians ON guardians;
CREATE POLICY k12_write_guardians ON guardians FOR ALL TO authenticated
  USING      (is_super_admin() OR has_any_capability('guardian.manage'))
  WITH CHECK (is_super_admin() OR has_any_capability('guardian.manage'));

ALTER TABLE guardian_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS k12_write_guardian_links ON guardian_links;
CREATE POLICY k12_write_guardian_links ON guardian_links FOR ALL TO authenticated
  USING      (is_super_admin() OR has_any_capability('guardian.manage'))
  WITH CHECK (is_super_admin() OR has_any_capability('guardian.manage'));

SELECT 'phase6 done' AS status;
