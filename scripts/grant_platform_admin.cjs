/**
 * Grants platform super_admin access to an email address — creating the
 * auth user if one doesn't exist yet (there is no self-signup flow in
 * the app; every account is provisioned server-side).
 *
 * Usage: SUPABASE_PAT=... node scripts/grant_platform_admin.cjs someone@example.com
 */
const https = require('https')

const PROJECT = 'fghdgtihpvaehykgqgro'
const PAT     = process.env.SUPABASE_PAT
const EMAIL   = (process.argv[2] || '').trim().toLowerCase()

if (!PAT) { console.error('Set SUPABASE_PAT in the environment first.'); process.exit(1) }
if (!EMAIL) { console.error('Usage: node scripts/grant_platform_admin.cjs someone@example.com'); process.exit(1) }

function dbQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(data) } })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function randomPassword() {
  return 'Admin@' + Math.random().toString(36).slice(-6) + Math.floor(Math.random() * 90 + 10)
}

async function main() {
  console.log(`\nGranting super_admin to ${EMAIL}...\n`)

  const existing = await dbQuery(`SELECT id FROM auth.users WHERE email = '${EMAIL}'`)
  let userId = Array.isArray(existing) && existing[0]?.id ? existing[0].id : null
  let tempPassword = null

  if (!userId) {
    tempPassword = randomPassword()
    const created = await dbQuery(`
      INSERT INTO auth.users (
        instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(), 'authenticated', 'authenticated',
        '${EMAIL}',
        crypt('${tempPassword}', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}', '{}',
        now(), now(),
        '', '', '', ''
      )
      RETURNING id;
    `)
    userId = Array.isArray(created) && created[0]?.id
    if (!userId) { console.error('Failed to create auth user:', JSON.stringify(created)); process.exit(1) }
    console.log('Created new auth user:', userId)

    await dbQuery(`
      INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        '${EMAIL}', '${userId}',
        jsonb_build_object('sub', '${userId}', 'email', '${EMAIL}'),
        'email', now(), now(), now()
      );
    `)
  } else {
    console.log('Found existing auth user:', userId)
  }

  const profile = await dbQuery(`
    INSERT INTO public.profiles (id, email, global_role)
    VALUES ('${userId}', '${EMAIL}', 'super_admin')
    ON CONFLICT (id) DO UPDATE SET global_role = 'super_admin'
    RETURNING id, email, global_role;
  `)
  console.log('Profile:', JSON.stringify(profile))

  console.log('\n✓ Done.')
  console.log(`  Login email: ${EMAIL}`)
  if (tempPassword) {
    console.log(`  Temp password: ${tempPassword}`)
    console.log('  (change this after first login — there is no self-service reset yet)')
  } else {
    console.log('  Existing password unchanged.')
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
