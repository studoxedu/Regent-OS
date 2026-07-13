-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 12 MIGRATION
-- Fix: freshly seeded staff/student accounts could not log in
-- ═══════════════════════════════════════════════════════════
--
-- Root cause: create_staff_member() and create_student() insert directly
-- into auth.users but never set confirmation_token, recovery_token,
-- email_change_token_new, email_change, email_change_token_current,
-- phone_change, phone_change_token, reauthentication_token. Those columns
-- come out NULL. Supabase's GoTrue auth server scans them into Go string
-- fields on every password-grant login and 500s on NULL
-- ("converting NULL to string is unsupported"). Net effect: every account
-- created via Super Admin → Add Staff, or via tertiary student creation,
-- was created successfully but could never sign in.
--
-- This migration (a) backfills every already-affected row so existing
-- seeded accounts start working immediately, and (b) fixes both functions
-- so newly created accounts don't hit the same bug.

-- ── 1. Backfill existing broken accounts ──────────────────────
UPDATE auth.users SET
  confirmation_token          = COALESCE(confirmation_token, ''),
  recovery_token               = COALESCE(recovery_token, ''),
  email_change_token_new       = COALESCE(email_change_token_new, ''),
  email_change                 = COALESCE(email_change, ''),
  email_change_token_current   = COALESCE(email_change_token_current, ''),
  phone_change                 = COALESCE(phone_change, ''),
  phone_change_token           = COALESCE(phone_change_token, ''),
  reauthentication_token       = COALESCE(reauthentication_token, '')
WHERE confirmation_token        IS NULL
   OR recovery_token             IS NULL
   OR email_change_token_new     IS NULL
   OR email_change               IS NULL
   OR email_change_token_current IS NULL
   OR phone_change               IS NULL
   OR phone_change_token         IS NULL
   OR reauthentication_token     IS NULL;

-- ── 2. Fix create_staff_member() ──────────────────────────────
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
      created_at, updated_at, is_sso_user, deleted_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change,
      email_change_token_current, phone_change,
      phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      lower(p_email),
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name),
      now(), now(), false, null,
      '', '', '', '', '', '', '', ''
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

-- ── 3. Fix create_student() ────────────────────────────────────
CREATE OR REPLACE FUNCTION create_student(
  p_institution_id    UUID,
  p_first_name        TEXT,
  p_last_name         TEXT,
  p_middle_name       TEXT    DEFAULT NULL,
  p_date_of_birth     DATE    DEFAULT NULL,
  p_gender            TEXT    DEFAULT NULL,
  p_phone             TEXT    DEFAULT NULL,
  p_personal_email    TEXT    DEFAULT NULL,
  p_department_id     UUID    DEFAULT NULL,
  p_programme         TEXT    DEFAULT 'nd',
  p_session_id        UUID    DEFAULT NULL,
  p_admitted_by       UUID    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_dept_code      TEXT;
  v_inst_code      TEXT;
  v_reg_number     TEXT;
  v_temp_password  TEXT;
  v_email          TEXT;
  v_auth_user_id   UUID;
  v_student_id     UUID;
  v_year           INTEGER;
BEGIN
  SELECT COALESCE(code, '') INTO v_dept_code FROM departments WHERE id = p_department_id;
  SELECT COALESCE(code, 'STX') INTO v_inst_code FROM schools WHERE id = p_institution_id;
  v_year := EXTRACT(YEAR FROM now())::INTEGER;

  v_reg_number    := generate_reg_number(p_institution_id, v_year, v_dept_code);
  v_temp_password := upper(substring(encode(gen_random_bytes(4), 'hex'), 1, 4))
                     || lower(substring(encode(gen_random_bytes(4), 'hex'), 1, 4));
  v_email         := lower(replace(v_reg_number, '/', '-'))
                     || '@' || lower(v_inst_code) || '.regentos.ng';

  -- Create Supabase auth user
  INSERT INTO auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change,
    email_change_token_current, phone_change,
    phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated', 'authenticated',
    v_email,
    crypt(v_temp_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name, 'is_student', true),
    now(), now(),
    '', '', '', '', '', '', '', ''
  ) RETURNING id INTO v_auth_user_id;

  -- Matching identity row (email/password provider) — same shape as create_staff_member
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data,
    provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_email, v_auth_user_id,
    jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  -- Matching profile row (required for RLS and display)
  INSERT INTO profiles (id, email, first_name, last_name)
  VALUES (v_auth_user_id, v_email, p_first_name, p_last_name)
  ON CONFLICT (id) DO NOTHING;

  -- Student canonical record
  INSERT INTO students (
    institution_id, reg_number,
    first_name, last_name, middle_name,
    date_of_birth, gender, phone, personal_email,
    department_id, programme, admission_session_id,
    status, auth_user_id
  ) VALUES (
    p_institution_id, v_reg_number,
    p_first_name, p_last_name, p_middle_name,
    p_date_of_birth, p_gender, p_phone, p_personal_email,
    p_department_id, p_programme, p_session_id,
    'active', v_auth_user_id
  ) RETURNING id INTO v_student_id;

  -- Immutable admission record
  INSERT INTO admissions (
    student_id, institution_id, session_id,
    programme, department_id, admitted_by_user_id
  ) VALUES (
    v_student_id, p_institution_id, p_session_id,
    p_programme, p_department_id,
    COALESCE(p_admitted_by, v_auth_user_id)
  );

  RETURN jsonb_build_object(
    'student_id',    v_student_id,
    'reg_number',    v_reg_number,
    'temp_password', v_temp_password,
    'login_email',   v_email
  );
END;
$$;

SELECT 'phase12 done' AS status;
