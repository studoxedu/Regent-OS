-- ============================================================================
-- phase30.sql — Fix the tertiary Senate page (2026-07-17)
--
-- The Senate page was stranded on the *other* governance system:
--   1. Ratification called the TERTIARY flow_execute(p_capability, p_payload,
--      p_office_id), which authorises against office_instances/office_assignments.
--      Real tertiary schools are seeded on the K-12 memberships model and have
--      zero office_instances, so senate.ratify ALWAYS threw
--      'unauthorized — capability not held'.
--   2. The audit trail read flow_log for capability LIKE 'result.%' (singular),
--      but the Results Pipeline writes 'results.%' (plural) to audit_log.
--      The two never intersected — the trail was permanently empty.
--   3. senate_ratifications had RLS policy sr_auth USING(true) WITH CHECK(true)
--      — a cross-tenant leak phase26 missed.
--
-- This migration moves Senate onto the K-12 governance model, which is what the
-- rest of the tertiary UI (Results Pipeline) already uses.
--
-- NOTE: the tertiary flow_execute(text,jsonb,uuid) overload is left untouched;
-- _flow_senate_ratify is shared by both and its logic is correct/reused as-is.
-- ============================================================================

-- ── 1. Capability: who may ratify ───────────────────────────────────────────
-- senate_secretary is the office the Sidebar already routes to /tertiary/senate.
-- school_admin (the VC) is included so a small institution needs no extra staff.
INSERT INTO capabilities (office_id, action)
SELECT o.id, 'senate.ratify'
FROM offices o
WHERE o.name IN ('senate_secretary', 'school_admin')
  AND NOT EXISTS (
    SELECT 1 FROM capabilities c
    WHERE c.office_id = o.id AND c.action = 'senate.ratify'
  );

-- ── 2. Tenant-scope senate_ratifications (was USING(true)) ──────────────────
-- Writes go exclusively through flow_execute -> _flow_senate_ratify, which is
-- SECURITY DEFINER and therefore bypasses RLS. So only a read policy is needed;
-- removing the blanket write policy closes the leak without breaking the app.
--
-- The inline memberships subquery is safe here (it does NOT hit the
-- RLS-subquery-RLS trap): memberships_self exposes rows where
-- profile_id = auth.uid(), which is exactly the set this filter needs.
DROP POLICY IF EXISTS sr_auth ON senate_ratifications;

DROP POLICY IF EXISTS sr_school_member_read ON senate_ratifications;
CREATE POLICY sr_school_member_read ON senate_ratifications
  FOR SELECT USING (
    is_super_admin() OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.school_id = senate_ratifications.school_id
        AND m.profile_id = auth.uid()
        AND m.is_active = true
    )
  );

-- ── 3. Add the senate.ratify branch to the K-12 flow_execute ────────────────
-- Applied as a surgical substring replacement against the LIVE definition in the
-- companion script (.qa-scratch/apply_phase30.mjs) — never reconstructed by hand.
-- The branch inserted immediately before the CASE's ELSE is:
--
--     WHEN 'senate.ratify' THEN
--       IF NOT EXISTS (
--         SELECT 1 FROM semesters s
--         WHERE s.id = (p_payload->>'semester_id')::uuid
--           AND s.school_id = p_school_id
--       ) THEN
--         RAISE EXCEPTION 'Semester does not belong to this school';
--       END IF;
--
--       v_result := _flow_senate_ratify(p_payload, p_school_id, v_profile_id);
--       v_result := v_result || jsonb_build_object(
--         'entity_type', 'senate_ratification',
--         'entity_id',   v_result->>'ratification_id'
--       );
--
-- The tenant check is new hardening: _flow_senate_ratify counts offerings by
-- semester_id alone, so without it a school_admin could ratify another school's
-- semester and write a row stamped with their own school_id.

-- ── 4. Repoint the audit trail at the table the pipeline actually writes ────
-- Signature changes (drops result/office_instance_id, adds actor_office), so the
-- old function must be dropped rather than replaced.
DROP FUNCTION IF EXISTS get_semester_audit_log(uuid);

CREATE FUNCTION get_semester_audit_log(p_semester_id uuid)
RETURNS TABLE (
  id           uuid,
  capability   text,
  actor_user_id uuid,
  actor_office text,
  created_at   timestamptz,
  payload      jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT al.id,
         al.action_type   AS capability,
         al.actor_profile_id AS actor_user_id,
         al.actor_office,
         al.created_at,
         al.payload
  FROM audit_log al
  WHERE al.action_type LIKE 'results.%'
    AND al.payload->>'offering_id' IN (
      SELECT co.id::text FROM course_offerings co WHERE co.semester_id = p_semester_id
    )
    -- SECURITY DEFINER bypasses RLS, so scope to the caller's school explicitly.
    AND (
      is_super_admin() OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.school_id = al.school_id
          AND m.profile_id = auth.uid()
          AND m.is_active = true
      )
    )
  ORDER BY al.created_at DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION get_semester_audit_log(uuid) TO authenticated;
