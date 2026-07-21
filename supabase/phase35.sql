-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 35 MIGRATION
-- Lock privileged school columns to the platform admin.
-- ═══════════════════════════════════════════════════════════
--
-- Test finding: the `schools_manager_update` policy lets any holder of the
-- `school.manage` capability (e.g. a tertiary school_admin / VC) UPDATE their
-- own schools row — INCLUDING `tier_id` and `group_id`. That means a school
-- could self-upgrade to Command (bypassing the phase34 tier gates) or attach
-- itself to a group. RLS can't do column-level restriction, so we enforce it
-- with a BEFORE UPDATE trigger: only the platform super_admin (or a backend /
-- service-role / migration context with no end-user JWT) may change tier_id or
-- group_id. Everything else about school-profile editing is unchanged.

CREATE OR REPLACE FUNCTION lock_privileged_school_cols()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tier_id IS DISTINCT FROM OLD.tier_id
      OR NEW.group_id IS DISTINCT FROM OLD.group_id)
     AND auth.uid() IS NOT NULL          -- a real end-user is acting (not service_role/backend)
     AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may change a school''s tier or group';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_lock_school_cols ON schools;
CREATE TRIGGER trg_lock_school_cols
  BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION lock_privileged_school_cols();

SELECT 'phase35 done' AS status;
