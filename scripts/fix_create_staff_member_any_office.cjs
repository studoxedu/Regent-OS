/**
 * Patches create_staff_member so it can assign K12 offices
 * (head_teacher, class_teacher, bursar) too — the original version
 * only looked up offices where governance_mode = 'tertiary', which
 * silently failed ("Office role not found") for every K12 school.
 * Office names are unique across governance modes, so the mode filter
 * was never load-bearing — this just drops it.
 */
const https = require('https')
const PAT         = process.env.SUPABASE_PAT
const PROJECT_REF = 'fghdgtihpvaehykgqgro'

if (!PAT) { console.error('Set SUPABASE_PAT in the environment first.'); process.exit(1) }

function sql(q) {
  return new Promise((res, rej) => {
    const b = JSON.stringify({ query: q })
    const r = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) },
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => res(JSON.parse(d))) })
    r.on('error', rej); r.write(b); r.end()
  })
}

const FN = `
CREATE OR REPLACE FUNCTION create_staff_member(
  p_email       TEXT,
  p_first_name  TEXT,
  p_last_name   TEXT,
  p_office_name TEXT,
  p_school_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id       UUID;
  v_temp_password TEXT;
  v_office_id     UUID;
  v_membership_id UUID;
  v_is_new        BOOLEAN := false;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_is_new := true;
    v_user_id := gen_random_uuid();
    v_temp_password := 'Staff@' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 3))
                       || floor(random() * 900 + 100)::text;

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, deleted_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      lower(p_email),
      crypt(v_temp_password, gen_salt('bf')),
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

  -- No governance_mode filter: office names are unique platform-wide,
  -- so this now works for K12 offices (head_teacher, class_teacher,
  -- bursar) as well as tertiary ones.
  SELECT id INTO v_office_id
  FROM offices
  WHERE name = p_office_name
  LIMIT 1;

  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Office role not found: %', p_office_name;
  END IF;

  SELECT id INTO v_membership_id
  FROM memberships
  WHERE profile_id = v_user_id
    AND school_id  = p_school_id
    AND office_id  = v_office_id
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
    'temp_password', CASE WHEN v_is_new THEN v_temp_password ELSE NULL END,
    'email',         lower(p_email)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_staff_member TO authenticated;
`

async function main() {
  console.log('\n=== Patch create_staff_member (drop tertiary-only restriction) ===\n')
  const r = await sql(FN)
  if (r?.message?.includes('ERROR')) {
    console.error('  ✗ Failed:', r.message)
    process.exit(1)
  }
  console.log('  ✓ Function updated — K12 offices (head_teacher, class_teacher, bursar) now work too.')
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
