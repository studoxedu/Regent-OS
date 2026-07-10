-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 9 MIGRATION
-- Capability-scoped write policies for K-12 setup tables
-- ═══════════════════════════════════════════════════════════
--
-- Calendar / Classes / Timetable write directly to these tables, but
-- they had only SELECT policies — so under RLS every write was
-- default-denied and those pages could not create anything. This adds
-- Head-Teacher-capability-gated write policies (the Setup section is
-- head-only; Timetable is editable by whoever holds timetable.manage).
-- Purely additive: these tables had no write policy, so this ENABLES
-- the writes while scoping them. Depends on phase6 helpers.

ALTER TABLE k12_academic_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_k12_sessions ON k12_academic_sessions;
CREATE POLICY write_k12_sessions ON k12_academic_sessions FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'k12.session.create'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'k12.session.create'));

ALTER TABLE k12_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_k12_terms ON k12_terms;
CREATE POLICY write_k12_terms ON k12_terms FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'k12.term.create'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'k12.term.create'));

ALTER TABLE k12_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_k12_classes ON k12_classes;
CREATE POLICY write_k12_classes ON k12_classes FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'k12.class.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'k12.class.manage'));

ALTER TABLE k12_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_k12_subjects ON k12_subjects;
CREATE POLICY write_k12_subjects ON k12_subjects FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'k12.subject.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'k12.subject.manage'));

ALTER TABLE k12_timetable_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_k12_periods ON k12_timetable_periods;
CREATE POLICY write_k12_periods ON k12_timetable_periods FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'timetable.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'timetable.manage'));

ALTER TABLE k12_timetable_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_k12_slots ON k12_timetable_slots;
CREATE POLICY write_k12_slots ON k12_timetable_slots FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'timetable.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'timetable.manage'));

SELECT 'phase9 done' AS status;
