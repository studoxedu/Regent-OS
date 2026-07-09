const https = require('https')

const PROJECT = 'fghdgtihpvaehykgqgro'
const PAT     = process.env.SUPABASE_PAT

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
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function main() {
  // Step 1: create auth user via direct SQL (pgcrypto for password hashing)
  console.log('Creating auth user regentos.edu@gmail.com…')
  const createSQL = `
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'regentos.edu@gmail.com',
      crypt('Regentosedu2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now(),
      '', '', '', ''
    )
    RETURNING id, email;
  `
  const r1 = await dbQuery(createSQL)
  console.log('Auth user create:', JSON.stringify(r1))

  let userId = null
  if (Array.isArray(r1) && r1.length > 0 && r1[0]?.id) {
    userId = r1[0].id
    console.log('Created user ID:', userId)

    // Step 2: create profile row
    console.log('Creating profile…')
    const r2 = await dbQuery(`
      INSERT INTO public.profiles (id, email, global_role)
      VALUES ('${userId}', 'regentos.edu@gmail.com', 'super_admin')
      ON CONFLICT (id) DO UPDATE SET global_role = 'super_admin'
      RETURNING id, email, global_role;
    `)
    console.log('Profile:', JSON.stringify(r2))
  } else {
    // User might already exist, just find and update
    console.log('User may already exist — looking up by email in auth.users…')
    const r3 = await dbQuery(`SELECT id FROM auth.users WHERE email = 'regentos.edu@gmail.com'`)
    console.log('Auth lookup:', JSON.stringify(r3))
    if (Array.isArray(r3) && r3.length > 0) {
      userId = r3[0].id
      const r4 = await dbQuery(`
        INSERT INTO public.profiles (id, email, global_role)
        VALUES ('${userId}', 'regentos.edu@gmail.com', 'super_admin')
        ON CONFLICT (id) DO UPDATE SET global_role = 'super_admin'
        RETURNING id, email, global_role;
      `)
      console.log('Profile upsert:', JSON.stringify(r4))
    }
  }

  // Step 3: also update password if user already existed
  if (userId) {
    console.log('\nEnsuring password is set…')
    const r5 = await dbQuery(`
      UPDATE auth.users
      SET encrypted_password = crypt('Regentosedu2026!', gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at = now()
      WHERE id = '${userId}'
      RETURNING id;
    `)
    console.log('Password update:', JSON.stringify(r5))
  }

  console.log('\nDone. Login: regentos.edu@gmail.com / Regentosedu2026!')
}

main().catch(console.error)
