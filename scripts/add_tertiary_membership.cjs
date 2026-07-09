const https = require('https');

const PAT = process.env.SUPABASE_PAT;
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

async function main() {
  const TERTIARY_SCHOOL_ID = '00000000-0000-0000-0000-000000000003';

  // Get the existing user's ID
  const [user] = await runSQL(`SELECT id FROM profiles WHERE email = 'haidarbuilds@gmail.com'`, 'Fetch user');
  if (!user) throw new Error('User not found');
  const userId = user.id;
  console.log('  User ID:', userId);

  // Add school_admin membership at the tertiary school
  await runSQL(`
    INSERT INTO memberships (profile_id, school_id, office_id)
    VALUES (
      '${userId}',
      '${TERTIARY_SCHOOL_ID}',
      (SELECT id FROM offices WHERE name = 'school_admin')
    )
    ON CONFLICT DO NOTHING
  `, 'Add tertiary membership (school_admin @ Regentos Polytechnic)');

  // Verify all memberships
  const memberships = await runSQL(`
    SELECT m.id, o.name as office, s.name as school
    FROM memberships m
    JOIN offices o ON o.id = m.office_id
    JOIN schools s ON s.id = m.school_id
    WHERE m.profile_id = '${userId}' AND m.is_active = true
  `, 'All memberships');

  console.log('\nMemberships for haidarbuilds@gmail.com:');
  memberships.forEach(m => console.log(`  • ${m.office} @ ${m.school}`));
  console.log('\nDone — now adding school switcher to the app.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
