-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 19 MIGRATION
-- Fix: venues (tertiary timetabling) has a fully open write policy
-- ═══════════════════════════════════════════════════════════
--
-- venues_auth is USING(true) WITH CHECK(true) — any authenticated user,
-- from any school, can currently create/edit/delete any other school's
-- venues (used by Schedox.tsx for timetabling). Scoped via the direct
-- institution_id column. Reuses 'structure.manage' (school_admin) —
-- the same capability already used for faculties/departments/courses/
-- programs, and the role that actually accesses Schedox for both real
-- institutions today. Note: 'timetable_officer' can also reach
-- Schedox.tsx per the sidebar, but holds no capability at all yet
-- (checked live) — that's a pre-existing gap in the office model, not
-- introduced by this migration, and no real account currently holds
-- that office, so it's not fixed here to keep this change minimal.

DROP POLICY IF EXISTS venues_auth ON venues;
CREATE POLICY school_member_read_venues ON venues FOR SELECT TO authenticated
  USING (is_super_admin() OR institution_id IN (
    SELECT school_id FROM memberships WHERE profile_id = auth.uid() AND is_active = true
  ));
CREATE POLICY write_venues_structure ON venues FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(institution_id, 'structure.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(institution_id, 'structure.manage'));

SELECT 'phase19 done' AS status;
