/**
 * Seed office_instances for FUSOX (Federal University of Regentos)
 * Creates one instance per office_type for administrative offices,
 * plus one Dean instance per faculty and one HOD instance per department.
 * Also assigns the FUSOX admin user to the institution_admin office instance.
 */
const https = require('https')
const PAT         = process.env.SUPABASE_PAT
const PROJECT_REF = 'fghdgtihpvaehykgqgro'
const FUSOX_ID    = '7fe07e1c-1684-47c2-9c0f-656e34fbc9e4'
const ADMIN_EMAIL = 'admin@fusox.edu.ng'

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

async function run(label, query) {
  const r = await sql(query)
  if (r?.message?.includes('ERROR') || r?.error) {
    console.error(`  ✗ ${label}:`, r.message || r.error)
    return null
  }
  console.log(`  ✓ ${label}`)
  return r
}

async function main() {
  console.log('\n=== Seed FUSOX Office Instances ===\n')

  // ── Get office_type IDs ────────────────────────────────────────
  const types = await sql('SELECT id, code FROM office_types')
  const typeMap = Object.fromEntries((types ?? []).map(t => [t.code, t.id]))
  console.log(`Found ${Object.keys(typeMap).length} office_types: ${Object.keys(typeMap).join(', ')}\n`)

  // ── Get FUSOX faculties and departments ────────────────────────
  const faculties = await sql(`
    SELECT id, name FROM faculties WHERE school_id = '${FUSOX_ID}' ORDER BY name
  `)
  const departments = await sql(`
    SELECT d.id, d.name, f.name AS faculty_name
    FROM departments d
    JOIN faculties f ON f.id = d.faculty_id
    WHERE f.school_id = '${FUSOX_ID}'
    ORDER BY f.name, d.name
  `)
  console.log(`Found ${(faculties ?? []).length} faculties, ${(departments ?? []).length} departments\n`)

  // ── Admin user ID ──────────────────────────────────────────────
  const adminRows = await sql(`SELECT id FROM profiles WHERE email = '${ADMIN_EMAIL}' LIMIT 1`)
  const adminId = adminRows?.[0]?.id
  if (!adminId) { console.error('Admin user not found — run create_fusox_admin.cjs first'); return }

  // ── 1. Single administrative offices ──────────────────────────
  const singleOffices = [
    { code: 'institution_admin', label: 'Office of the Institutional Administrator' },
    { code: 'registrar',         label: 'Office of the Registrar' },
    { code: 'senate_secretary',  label: 'Office of the Senate Secretary' },
    { code: 'exam_officer',      label: 'Office of the Examinations Officer' },
    { code: 'bursar',            label: 'Office of the Bursar' },
  ]

  const createdInstances = {}

  for (const o of singleOffices) {
    const typeId = typeMap[o.code]
    if (!typeId) { console.log(`  ⚠ Skipping ${o.code} — office_type not found`); continue }

    // Check if already exists
    const existing = await sql(`
      SELECT id FROM office_instances
      WHERE institution_id = '${FUSOX_ID}' AND office_type_id = '${typeId}' LIMIT 1
    `)
    if (existing?.[0]?.id) {
      console.log(`  ↳ ${o.code} already exists`)
      createdInstances[o.code] = existing[0].id
      continue
    }

    const result = await sql(`
      INSERT INTO office_instances (institution_id, office_type_id, label, is_active)
      VALUES ('${FUSOX_ID}', '${typeId}', '${o.label}', true)
      RETURNING id
    `)
    if (result?.[0]?.id) {
      createdInstances[o.code] = result[0].id
      console.log(`  ✓ ${o.code}: ${o.label}`)
    }
  }

  // ── 2. Dean instances (one per faculty) ───────────────────────
  const deanTypeId = typeMap['dean']
  if (deanTypeId && (faculties ?? []).length > 0) {
    console.log('\n  Dean offices:')
    for (const f of (faculties ?? [])) {
      const label = `Dean — ${f.name}`
      const existing = await sql(`
        SELECT id FROM office_instances
        WHERE institution_id = '${FUSOX_ID}' AND office_type_id = '${deanTypeId}' AND label = '${label.replace(/'/g,"''")}'
        LIMIT 1
      `)
      if (existing?.[0]?.id) { console.log(`    ↳ already exists: ${label}`); continue }
      await sql(`
        INSERT INTO office_instances (institution_id, office_type_id, label, is_active)
        VALUES ('${FUSOX_ID}', '${deanTypeId}', '${label.replace(/'/g,"''")}', true)
      `)
      console.log(`    ✓ ${label}`)
    }
  }

  // ── 3. HOD instances (one per department) ─────────────────────
  const hodTypeId = typeMap['hod']
  if (hodTypeId && (departments ?? []).length > 0) {
    console.log('\n  HOD offices:')
    for (const d of (departments ?? [])) {
      const label = `HOD — ${d.name}`
      const existing = await sql(`
        SELECT id FROM office_instances
        WHERE institution_id = '${FUSOX_ID}' AND office_type_id = '${hodTypeId}' AND label = '${label.replace(/'/g,"''")}'
        LIMIT 1
      `)
      if (existing?.[0]?.id) { console.log(`    ↳ already exists: ${label}`); continue }
      await sql(`
        INSERT INTO office_instances (institution_id, office_type_id, label, is_active)
        VALUES ('${FUSOX_ID}', '${hodTypeId}', '${label.replace(/'/g,"''")}', true)
      `)
      console.log(`    ✓ ${label}`)
    }
  }

  // ── 4. Assign admin to institution_admin office ────────────────
  console.log('\n  Assigning admin user to institution_admin office:')
  const iaInstanceId = createdInstances['institution_admin']
  if (iaInstanceId && adminId) {
    const existingAssign = await sql(`
      SELECT id FROM office_assignments
      WHERE profile_id = '${adminId}' AND office_instance_id = '${iaInstanceId}' LIMIT 1
    `)
    if (existingAssign?.[0]?.id) {
      console.log('    ↳ Assignment already exists')
    } else {
      await sql(`
        INSERT INTO office_assignments (profile_id, office_instance_id, is_active)
        VALUES ('${adminId}', '${iaInstanceId}', true)
      `)
      console.log(`    ✓ admin@fusox.edu.ng → institution_admin`)
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────
  const total = await sql(`
    SELECT COUNT(*) AS n FROM office_instances WHERE institution_id = '${FUSOX_ID}'
  `)
  console.log(`\n✓ Done — ${total?.[0]?.n ?? '?'} office instances now exist for FUSOX`)
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
