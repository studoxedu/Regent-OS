-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 20 MIGRATION
-- Fix: every table created in phase4.sql has zero table-level
-- grants to `authenticated` — messaging, CBT, guardian alerts,
-- and payment records have been completely non-functional
-- ═══════════════════════════════════════════════════════════
--
-- Root cause: phase4.sql (CREATE TABLE conversations,
-- conversation_participants, messages, cbt_tests, cbt_questions,
-- cbt_attempts, guardian_notifications, payment_transactions) never ran
-- a GRANT statement for these 8 tables. RLS policies for all of them
-- already exist and are correctly scoped (confirmed live) — but Postgres
-- checks base table privileges *before* RLS is ever evaluated, so every
-- one of these tables has been fully inaccessible to the `authenticated`
-- role regardless of what RLS says. Confirmed live via
-- has_table_privilege('authenticated', <table>, <priv>) — every
-- privilege on every one of these 8 tables is currently false.
--
-- Net effect, since phase4 was applied: the entire two-way messaging
-- feature, the entire CBT (computer-based testing) feature, guardian
-- attendance-alert notifications, and Paystack payment_transactions
-- records have been silently broken for every school on the platform.
-- This is a pure grant fix — RLS continues to do the actual
-- authorization narrowing exactly as already configured; this only
-- unblocks the base privilege check so RLS gets a chance to run at all.

GRANT SELECT, INSERT, UPDATE, DELETE ON conversations             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_participants  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages                   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cbt_tests                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cbt_questions              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cbt_attempts               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON guardian_notifications     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_transactions       TO authenticated;

SELECT 'phase20 done' AS status;
