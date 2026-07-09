const https = require('https');
const fs = require('fs');
const path = require('path');

const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';

function runSQL(sql, label) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          if (label) console.log(`✓ ${label}`);
          resolve(JSON.parse(data));
        } else {
          console.error(`✗ ${label || 'query'} (HTTP ${res.statusCode})`);
          try {
            const err = JSON.parse(data);
            console.error('  ', err.message || err.error || data.substring(0, 300));
          } catch { console.error('  ', data.substring(0, 300)); }
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Verify seeds
  const offices = await runSQL(`SELECT name, governance_mode FROM offices ORDER BY governance_mode, name`, 'Offices seed');
  console.log('  Offices:', offices.map(o => o.name).join(', '));

  const caps = await runSQL(`SELECT COUNT(*) as n FROM capabilities`, 'Capabilities seed');
  console.log('  Capabilities:', caps[0].n, 'rows');

  const levels = await runSQL(`SELECT COUNT(*) as n FROM education_levels`, 'Education levels seed');
  console.log('  Education levels:', levels[0].n, 'rows');

  // Create demo school group + school
  const groupId = '00000000-0000-0000-0000-000000000001';
  const schoolId = '00000000-0000-0000-0000-000000000002';

  await runSQL(`
    INSERT INTO school_groups (id, name)
    VALUES ('${groupId}', 'Regentos Demo Group')
    ON CONFLICT (id) DO NOTHING
  `, 'Demo school group');

  await runSQL(`
    INSERT INTO schools (id, group_id, name, stages_offered, tier_id)
    VALUES (
      '${schoolId}',
      '${groupId}',
      'Greenfield Academy',
      ARRAY['nursery','primary','jss','sss'],
      'pilot'
    )
    ON CONFLICT (id) DO NOTHING
  `, 'Demo school');

  console.log('\nDatabase ready.');
  console.log('School ID:', schoolId);
  console.log('\nNext: create a user in Supabase Auth (Authentication → Users → Add user)');
  console.log('Then run: assign_membership.cjs with their user ID');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
