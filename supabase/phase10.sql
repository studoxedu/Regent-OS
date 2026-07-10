-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 10 MIGRATION
-- Learner + Guardian NIN · admin-set password for seeded accounts
-- ═══════════════════════════════════════════════════════════

-- ── 1. NIN columns (Nigerian NIN = exactly 11 digits) ────────
-- learners.nin        = the learner's own NIN (may be null for young children)
-- learners.guardian_nin = a guardian's NIN, used when the learner has none
-- guardians.nin       = NIN on a full guardian record (Guardians page)
ALTER TABLE learners  ADD COLUMN IF NOT EXISTS nin TEXT;
ALTER TABLE learners  DROP CONSTRAINT IF EXISTS learners_nin_chk;
ALTER TABLE learners  ADD  CONSTRAINT learners_nin_chk  CHECK (nin IS NULL OR nin ~ '^[0-9]{11}$');

ALTER TABLE learners  ADD COLUMN IF NOT EXISTS guardian_nin TEXT;
ALTER TABLE learners  DROP CONSTRAINT IF EXISTS learners_guardian_nin_chk;
ALTER TABLE learners  ADD  CONSTRAINT learners_guardian_nin_chk CHECK (guardian_nin IS NULL OR guardian_nin ~ '^[0-9]{11}$');

ALTER TABLE guardians ADD COLUMN IF NOT EXISTS nin TEXT;
ALTER TABLE guardians DROP CONSTRAINT IF EXISTS guardians_nin_chk;
ALTER TABLE guardians ADD  CONSTRAINT guardians_nin_chk CHECK (nin IS NULL OR nin ~ '^[0-9]{11}$');

-- ── 2. Governed NIN update (learners have no school_id; gate via
--        the learner's enrollment + the learner.enroll capability) ──
DROP FUNCTION IF EXISTS set_learner_nin(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION set_learner_nin(
  p_learner_id   UUID,
  p_school_id    UUID,
  p_nin          TEXT,
  p_guardian_nin TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT (is_super_admin() OR has_school_capability(p_school_id, 'learner.enroll')) THEN
    RAISE EXCEPTION 'Forbidden: you cannot update learner records at this school';
  END IF;

  IF p_nin IS NOT NULL AND p_nin <> '' AND p_nin !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'Learner NIN must be exactly 11 digits';
  END IF;
  IF p_guardian_nin IS NOT NULL AND p_guardian_nin <> '' AND p_guardian_nin !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'Guardian NIN must be exactly 11 digits';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM learner_enrollments e
    WHERE e.learner_id = p_learner_id AND e.school_id = p_school_id
  ) THEN
    RAISE EXCEPTION 'Learner is not enrolled at this school';
  END IF;

  -- NULL arg = leave that column unchanged; '' = clear; digits = set.
  UPDATE learners
  SET nin          = CASE WHEN p_nin          IS NOT NULL THEN NULLIF(p_nin, '')          ELSE nin          END,
      guardian_nin = CASE WHEN p_guardian_nin IS NOT NULL THEN NULLIF(p_guardian_nin, '') ELSE guardian_nin END
  WHERE id = p_learner_id;

  RETURN jsonb_build_object('ok', true, 'learner_id', p_learner_id,
                            'nin', NULLIF(p_nin, ''), 'guardian_nin', NULLIF(p_guardian_nin, ''));
END $$;
GRANT EXECUTE ON FUNCTION set_learner_nin(UUID, UUID, TEXT, TEXT) TO authenticated;

-- ── 3. create_staff_member: optional admin-set password ──────
-- Drop the 5-arg version first so the new 6-arg default isn't an
-- ambiguous overload.
DROP FUNCTION IF EXISTS create_staff_member(text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION create_staff_member(
  p_email       TEXT,
  p_first_name  TEXT,
  p_last_name   TEXT,
  p_office_name TEXT,
  p_school_id   UUID,
  p_password    TEXT DEFAULT NULL      -- admin-supplied; NULL = auto-generate
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id       UUID;
  v_password      TEXT;
  v_office_id     UUID;
  v_membership_id UUID;
  v_is_new        BOOLEAN := false;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(p_email) LIMIT 1;

  IF v_user_id IS NULL THEN
    v_is_new := true;
    v_user_id := gen_random_uuid();

    IF p_password IS NOT NULL AND p_password <> '' THEN
      IF length(p_password) < 6 THEN
        RAISE EXCEPTION 'Password must be at least 6 characters';
      END IF;
      v_password := p_password;
    ELSE
      v_password := 'Staff@' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 3))
                    || floor(random() * 900 + 100)::text;
    END IF;

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, deleted_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      lower(p_email),
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name),
      now(), now(), false, null
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data,
      provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      lower(p_email), v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', lower(p_email)),
      'email', now(), now(), now()
    );
  END IF;

  INSERT INTO profiles (id, email, first_name, last_name)
  VALUES (v_user_id, lower(p_email), p_first_name, p_last_name)
  ON CONFLICT (id) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name  = COALESCE(EXCLUDED.last_name,  profiles.last_name);

  SELECT id INTO v_office_id FROM offices WHERE name = p_office_name LIMIT 1;
  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Office role not found: %', p_office_name;
  END IF;

  SELECT id INTO v_membership_id
  FROM memberships
  WHERE profile_id = v_user_id AND school_id = p_school_id AND office_id = v_office_id
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    INSERT INTO memberships (profile_id, school_id, office_id, is_active)
    VALUES (v_user_id, p_school_id, v_office_id, true)
    RETURNING id INTO v_membership_id;
  ELSE
    UPDATE memberships SET is_active = true WHERE id = v_membership_id;
  END IF;

  RETURN jsonb_build_object(
    'profile_id',    v_user_id,
    'membership_id', v_membership_id,
    'is_new_user',   v_is_new,
    'temp_password', CASE WHEN v_is_new THEN v_password ELSE NULL END,
    'email',         lower(p_email)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_staff_member(text, text, text, text, uuid, text) TO authenticated;

SELECT 'phase10 done' AS status;
