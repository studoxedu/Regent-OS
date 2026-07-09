const https = require('https');

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_KEY;
const PAT         = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';

function runSQL(sql, label) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (res.statusCode === 200 || res.statusCode === 201) { if (label) console.log(`✓ ${label}`); resolve(parsed); }
        else { console.error(`✗ ${label}: ${parsed.message}`); reject(new Error(parsed.message)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function authRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'apikey': SERVICE_ROLE };
    if (bodyStr) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(bodyStr); }
    const req = https.request({ hostname: `${PROJECT_REF}.supabase.co`, path, method, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const TERTIARY_SCHOOL_ID = '00000000-0000-0000-0000-000000000003';
  const GROUP_ID           = '00000000-0000-0000-0000-000000000001';

  // 1. Create tertiary school
  await runSQL(`
    INSERT INTO schools (id, group_id, name, stages_offered, tier_id)
    VALUES ('${TERTIARY_SCHOOL_ID}', '${GROUP_ID}', 'Regentos Polytechnic', ARRAY['nd','hnd'], 'pilot')
    ON CONFLICT (id) DO NOTHING
  `, 'Tertiary school: Regentos Polytechnic');

  // 2. Create auth user via Management API
  const createRes = await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      email: 'admin@regentos.ng',
      password: 'haidarbuilds2026!',
      email_confirm: true,
      user_metadata: { first_name: 'School', last_name: 'Admin' },
    });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/auth/users`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  let userId = createRes.body.id;
  if (!userId) {
    // Check if already exists
    const existing = await runSQL(`SELECT id FROM profiles WHERE email = 'admin@regentos.ng'`, null);
    userId = existing[0]?.id;
    if (!userId) {
      console.error('Create user response:', JSON.stringify(createRes.body).substring(0, 300));
      throw new Error('Could not create or find user');
    }
    console.log('✓ Auth user (already existed):', userId);
  } else {
    console.log(`✓ Auth user: ${userId}`);
  }

  // 3. Profile
  await runSQL(`
    INSERT INTO profiles (id, email, first_name, last_name)
    VALUES ('${userId}', 'admin@regentos.ng', 'School', 'Admin')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
  `, 'Profile row');

  // 4. Membership as school_admin
  await runSQL(`
    INSERT INTO memberships (profile_id, school_id, office_id)
    VALUES (
      '${userId}',
      '${TERTIARY_SCHOOL_ID}',
      (SELECT id FROM offices WHERE name = 'school_admin')
    )
    ON CONFLICT DO NOTHING
  `, 'Membership: school_admin @ Regentos Polytechnic');

  console.log('\nTertiary user ready:');
  console.log('  Email   :', 'admin@regentos.ng');
  console.log('  Password:', 'haidarbuilds2026!');
  console.log('  Office  : school_admin');
  console.log('  School  : Regentos Polytechnic (ND / HND)');
  console.log('\nSign in at http://localhost:5173 with those credentials.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
