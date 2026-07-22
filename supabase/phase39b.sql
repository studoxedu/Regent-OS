-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 39b
-- Staff directory read: let school members see colleague memberships
-- (so the Staff page works for VC/registrar/HOD/Dean, not just "yourself").
-- The phase39 dept_scope RESTRICTIVE then narrows HOD/Dean to their scope.
-- ═══════════════════════════════════════════════════════════
--
-- memberships previously had only self/super/group-observer SELECT policies, so
-- ordinary staff could not list colleagues. This adds a same-school read via a
-- SECURITY DEFINER helper (no cross-tenant leak, no RLS-subquery recursion).

CREATE OR REPLACE FUNCTION caller_in_school(p_school uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE profile_id = auth.uid() AND is_active = true AND school_id = p_school
  )
$$;
GRANT EXECUTE ON FUNCTION caller_in_school(uuid) TO authenticated;

DROP POLICY IF EXISTS memberships_school_read ON memberships;
CREATE POLICY memberships_school_read ON memberships FOR SELECT TO authenticated
  USING (school_id IS NOT NULL AND caller_in_school(school_id));

SELECT 'phase39b done' AS status;
