-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 13 MIGRATION
-- Fix: in-app notification bell silently never worked
-- ═══════════════════════════════════════════════════════════
--
-- Root cause: `notifications` (phase2.sql) got RLS enabled with only
-- SELECT ("user_read_own_notifications") and UPDATE
-- ("user_update_own_notifications") policies — no INSERT policy was ever
-- added. Every call to notify() (src/lib/notifications.ts, used by
-- Enrollment, FeeManagement, tertiary ResultsPipeline) has been 403ing
-- since phase2. It's fire-and-forget (not awaited by callers), so the
-- failure was invisible in the UI — the calling action still succeeds,
-- the notification just never gets created.
--
-- Mirrors the existing "staff_insert_guardian_notifications" policy on
-- the sibling guardian_notifications table (phase4.sql): any authenticated
-- user can insert, since notify() is called on behalf of arbitrary
-- profile_id targets (e.g. notifying a different staff member), and reads
-- stay locked to the owning profile.

DROP POLICY IF EXISTS "authenticated_insert_notifications" ON notifications;
CREATE POLICY "authenticated_insert_notifications"
  ON notifications FOR INSERT TO authenticated WITH CHECK (true);

SELECT 'phase13 done' AS status;
