-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 16 MIGRATION
-- Security fix: learners (PII), system_event (audit trail), programs
-- had RLS completely disabled
-- ═══════════════════════════════════════════════════════════
--
-- Found via a full-schema sweep after phase15 (checking every public
-- table, not just ones the frontend writes to directly — a read-only
-- leak is still a leak).
--
-- learners: holds first_name/last_name/date_of_birth/nin/guardian_nin —
-- NIN is a Nigerian National Identity Number, i.e. government ID PII.
-- RLS was fully off: any authenticated user on the platform, from any
-- school, could read every learner's name, DOB and NIN across every
-- school. learners has no direct school_id (a learner ties to a school
-- via learner_enrollments, since transfers move a learner between
-- schools over time) so it's scoped via that join. All writes to
-- learners already go through SECURITY DEFINER paths (the learner.enroll
-- flow_execute action, and set_learner_nin() — see phase10.sql, which
-- already does its own has_school_capability check internally) — RLS
-- only needs a SELECT policy here, no write policy.
--
-- system_event: a per-action delta/event log keyed to audit_log_id.
-- audit_log itself is correctly RLS-scoped to school members
-- (audit_log_school_members), but this child table with the same kind
-- of sensitive payload (delta) had no RLS at all — every governance
-- event's detail was readable platform-wide despite the parent record
-- being properly protected. SELECT-only, scoped via audit_log_id ->
-- audit_log.school_id (no frontend writes to this table directly).
--
-- programs: tenant-specific degree programmes (department_id ->
-- faculties.school_id). Lower sensitivity than the above two but same
-- cross-tenant gap; included for consistency. SELECT-only (no frontend
-- write path found).

-- ── learners ───────────────────────────────────────────────────
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_learners ON learners;
CREATE POLICY school_member_read_learners ON learners FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM learner_enrollments le
    JOIN memberships m ON m.school_id = le.school_id
    WHERE le.learner_id = learners.id AND m.profile_id = auth.uid() AND m.is_active = true
  ));

-- ── system_event ───────────────────────────────────────────────
ALTER TABLE system_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_system_event ON system_event;
CREATE POLICY school_member_read_system_event ON system_event FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM audit_log al
    JOIN memberships m ON m.school_id = al.school_id
    WHERE al.id = system_event.audit_log_id AND m.profile_id = auth.uid() AND m.is_active = true
  ));

-- ── programs ───────────────────────────────────────────────────
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_member_read_programs ON programs;
CREATE POLICY school_member_read_programs ON programs FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM departments d
    JOIN faculties f ON f.id = d.faculty_id
    JOIN memberships m ON m.school_id = f.school_id
    WHERE d.id = programs.department_id AND m.profile_id = auth.uid() AND m.is_active = true
  ));

SELECT 'phase16 done' AS status;
