/**
 * Creates a school_admin user for FUSOX (Federal University of Regentos)
 */
const https = require('https')

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_KEY
const PAT         = process.env.SUPABASE_PAT
const PROJECT_REF = 'fghdgtihpvaehykgqgro'
const FUSOX_ID    = '7fe07e1c-1684-47c2-9c0f-656e34fbc9e4'

const ADMIN_EMAIL    = 'admin@fusox.edu.ng'
const ADMIN_PASSWORD = 'Fusox@Admin2026'
const FIRST_NAME     = 'FUSOX'
const LAST_NAME      = 'Admin'

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body)
    const r = https.request({
      ...opts,
      headers: { ...opts.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) },
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }))
    })
    r.on('error', reject); r.write(b); r.end()
  })
}

function sql(query) {
  return req({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/database/query`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PAT}` },
  }, { query }).then(r => {
    if (r.body?.message?.includes('ERROR')) throw new Error(r.body.message)
    return r.body
  })
}

async function main() {
  console.log('\n=== Create FUSOX Institutional Admin ===\n')

  // ── 1. Create auth user ────────────────────────────────────────
  console.log('Creating auth user…')
  const authRes = await req({
    hostname: `${PROJECT_REF}.supabase.co`,
    path: '/auth/v1/admin/users',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'apikey': SERVICE_ROLE },
  }, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: FIRST_NAME, last_name: LAST_NAME },
  })

  let userId = authRes.body.id

  if (!userId) {
    if (authRes.body.msg?.includes('already been registered') || authRes.body.code === 'email_exists') {
      console.log('  User already exists — fetching ID…')
      const listRes = await req({
        hostname: `${PROJECT_REF}.supabase.co`,
        path: `/auth/v1/admin/users?email=${encodeURIComponent(ADMIN_EMAIL)}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'apikey': SERVICE_ROLE },
      }, {})
      userId = listRes.body.users?.[0]?.id
    } else {
      throw new Error(`Auth API ${authRes.status}: ${JSON.stringify(authRes.body)}`)
    }
  }

  if (!userId) throw new Error('Could not get user ID')
  console.log(`  ✓ Auth user: ${userId}`)

  // ── 2. Upsert profile ─────────────────────────────────────────
  await sql(`
    INSERT INTO profiles (id, email, first_name, last_name)
    VALUES ('${userId}', '${ADMIN_EMAIL}', '${FIRST_NAME}', '${LAST_NAME}')
    ON CONFLICT (id) DO UPDATE SET
      email      = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name  = EXCLUDED.last_name
  `)
  console.log('  ✓ Profile row')

  // ── 3. Check school_admin office exists ────────────────────────
  const officeCheck = await sql(`
    SELECT id FROM offices WHERE name = 'school_admin' AND governance_mode = 'tertiary' LIMIT 1
  `)
  if (!officeCheck?.[0]?.id) throw new Error("office 'school_admin' not found — run the tertiary setup scripts first")
  const officeId = officeCheck[0].id
  console.log(`  ✓ school_admin office: ${officeId}`)

  // ── 4. Membership at FUSOX ─────────────────────────────────────
  const existing = await sql(`
    SELECT id FROM memberships
    WHERE profile_id = '${userId}' AND school_id = '${FUSOX_ID}' AND office_id = '${officeId}'
    LIMIT 1
  `)
  if (existing?.[0]?.id) {
    await sql(`UPDATE memberships SET is_active = true WHERE id = '${existing[0].id}'`)
    console.log('  ✓ Membership: already exists — set active')
  } else {
    await sql(`
      INSERT INTO memberships (profile_id, school_id, office_id, is_active)
      VALUES ('${userId}', '${FUSOX_ID}', '${officeId}', true)
    `)
    console.log('  ✓ Membership: school_admin @ FUSOX')
  }

  // ── 5. Verify ──────────────────────────────────────────────────
  const check = await sql(`
    SELECT m.id, o.name AS office, s.name AS school
    FROM memberships m
    JOIN offices o ON o.id = m.office_id
    JOIN schools s ON s.id = m.school_id
    WHERE m.profile_id = '${userId}'
  `)

  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║       FUSOX Admin Login Details          ║')
  console.log('╠══════════════════════════════════════════╣')
  console.log(`║  Email    : ${ADMIN_EMAIL.padEnd(29)}║`)
  console.log(`║  Password : ${ADMIN_PASSWORD.padEnd(29)}║`)
  console.log(`║  Role     : ${(check[0]?.office ?? '').padEnd(29)}║`)
  console.log(`║  School   : ${(check[0]?.school ?? '').padEnd(29)}║`)
  console.log('╚══════════════════════════════════════════╝\n')
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
