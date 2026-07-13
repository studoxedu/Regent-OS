-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 14 MIGRATION
-- Fix: class assignment on learner_enrollments has never worked
-- ═══════════════════════════════════════════════════════════
--
-- Root cause: learner_enrollments has RLS enabled with exactly one policy,
-- "enrollments_school_members" (SELECT only, added outside the tracked
-- migrations — not found in any supabase/*.sql file). There has never
-- been an UPDATE policy. Three code paths do a direct
-- `.from('learner_enrollments').update({ class_id: ... })` — the inline
-- per-row class-select and the class-select in the Enroll modal
-- (src/pages/k12/Enrollment.tsx), plus the bulk CSV import's class
-- matching. All three silently no-op: the UPDATE call returns no error
-- (RLS just filters the row out of the update's WHERE-matched set), the
-- UI shows a fleeting "Saving…" and then reverts to "— unassigned —".
--
-- Net effect: a class can never actually be assigned to a learner via the
-- UI, in any school. This cascades into Attendance ("No learners in this
-- class" even when learners are enrolled there) and anything else scoped
-- by class_id.
--
-- Fix follows the established capability-scoped write pattern from
-- phase6.sql (k12_write_attendance etc.) — 'learner.enroll' is the same
-- capability that already gates the learner.enroll flow_execute action,
-- held by head_teacher and k12_registrar (phase5/phase8).

CREATE POLICY k12_write_learner_enrollments ON learner_enrollments FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'learner.enroll'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'learner.enroll'));

SELECT 'phase14 done' AS status;
