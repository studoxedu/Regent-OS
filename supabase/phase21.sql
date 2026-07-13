-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 21 MIGRATION
-- Fix: staff can't see colleagues' names anywhere
-- ═══════════════════════════════════════════════════════════
--
-- profiles has exactly two SELECT-capable policies: profiles_self
-- (id = auth.uid()) and profiles_super_read (super_admin only). Nobody
-- can read a colleague's profile row — confirmed live via RLS
-- simulation against a real school_admin at Federal University of
-- Studox: 0 other profiles visible, despite that school having 20+
-- staff/lecturer accounts.
--
-- This breaks every feature that shows a colleague's name, which turns
-- out to be widespread: StaffManagement.tsx (the staff directory itself
-- — embeds profile:profiles(*) for every membership row), Messages.tsx
-- (new-conversation staff picker, participant names, message sender
-- names). Given how many pages embed profiles this way, scope it once
-- at the table level rather than patching each call site: anyone who
-- shares an active membership at the same school can see each other's
-- basic profile.
--
-- First attempt at this policy (inline EXISTS joining memberships twice)
-- silently returned zero rows: the subquery's own read of *other* users'
-- membership rows is itself subject to memberships' RLS
-- (memberships_self: profile_id = auth.uid() only), so it could never
-- see "theirs". Same reason has_school_capability() below is
-- SECURITY DEFINER — a helper function bypasses the inner table's RLS
-- the way a plain subquery in a policy cannot.

CREATE OR REPLACE FUNCTION shares_active_school_with(p_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships mine
    JOIN memberships theirs ON theirs.school_id = mine.school_id
    WHERE mine.profile_id = auth.uid() AND mine.is_active = true
      AND theirs.profile_id = p_profile_id AND theirs.is_active = true
  )
$$;
GRANT EXECUTE ON FUNCTION shares_active_school_with(UUID) TO authenticated;

DROP POLICY IF EXISTS school_colleague_read_profiles ON profiles;
CREATE POLICY school_colleague_read_profiles ON profiles FOR SELECT TO authenticated
  USING (is_super_admin() OR shares_active_school_with(id));

SELECT 'phase21 done' AS status;
