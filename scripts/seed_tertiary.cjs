const https = require('https');

const PAT         = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SCHOOL_ID = '00000000-0000-0000-0000-000000000003'; // Regentos Polytechnic

function sql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Use Supabase Auth Admin API (service role, project subdomain)
function createAuthUser(email, password, firstName, lastName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      email, password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    const req = https.request({
      hostname: `${PROJECT_REF}.supabase.co`,
      path: '/auth/v1/admin/users',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getOrCreateUser(email, password, first, last, label) {
  const res = await createAuthUser(email, password, first, last);
  if (res.body?.id) {
    console.log(`  ✓ ${label} auth user created: ${email}`);
    return res.body.id;
  }
  // Already exists — look up by profile
  const rows = await sql(`SELECT id FROM profiles WHERE email = '${email}' LIMIT 1`);
  if (rows[0]?.id) {
    console.log(`  ✓ ${label} (already existed): ${email}`);
    return rows[0].id;
  }
  throw new Error(`Could not create/find user ${email}: ${JSON.stringify(res.body).slice(0, 200)}`);
}

// Upsert helper: INSERT ... ON CONFLICT DO NOTHING, then SELECT
async function upsertAndGet(insertSql, selectSql, label) {
  await sql(insertSql);
  const rows = await sql(selectSql);
  const id = rows[0]?.id;
  if (!id) throw new Error(`Could not find ${label} after insert`);
  console.log(`  ✓ ${label}: ${id}`);
  return id;
}

async function main() {
  console.log('\n=== Regentos Polytechnic — Tertiary Seed ===\n');

  // ── 0. Schema fix: add missing columns to courses ──────────────
  console.log('0. Patching courses table schema…');
  await sql(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL`);
  await sql(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS title TEXT`);
  await sql(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS credit_units INTEGER DEFAULT 3`);
  console.log('  ✓ courses.department_id, .title, .credit_units ensured');

  // ── 1. Academic Session ───────────────────────────────────────
  console.log('\n1. Academic session…');
  const sessionId = await upsertAndGet(
    `INSERT INTO academic_sessions (school_id, label, is_active) VALUES ('${SCHOOL_ID}', '2025/2026', true) ON CONFLICT DO NOTHING`,
    `SELECT id FROM academic_sessions WHERE school_id = '${SCHOOL_ID}' AND label = '2025/2026' LIMIT 1`,
    'Session 2025/2026'
  );

  // ── 2. Semester ───────────────────────────────────────────────
  console.log('\n2. Semester…');
  const semesterId = await upsertAndGet(
    `INSERT INTO semesters (session_id, label, ordinal, is_active) VALUES ('${sessionId}', 'First Semester', 1, true) ON CONFLICT DO NOTHING`,
    `SELECT id FROM semesters WHERE session_id = '${sessionId}' AND label = 'First Semester' LIMIT 1`,
    'First Semester'
  );

  // ── 3. Faculty + Department ───────────────────────────────────
  console.log('\n3. Faculty of Technology / Computer Science…');
  const facultyId = await upsertAndGet(
    `INSERT INTO faculties (school_id, name) VALUES ('${SCHOOL_ID}', 'Faculty of Technology') ON CONFLICT DO NOTHING`,
    `SELECT id FROM faculties WHERE school_id = '${SCHOOL_ID}' AND name = 'Faculty of Technology' LIMIT 1`,
    'Faculty of Technology'
  );
  const deptId = await upsertAndGet(
    `INSERT INTO departments (faculty_id, name) VALUES ('${facultyId}', 'Computer Science') ON CONFLICT DO NOTHING`,
    `SELECT id FROM departments WHERE faculty_id = '${facultyId}' AND name = 'Computer Science' LIMIT 1`,
    'Computer Science dept'
  );

  // ── 4. Courses ────────────────────────────────────────────────
  console.log('\n4. Courses…');
  const courseList = [
    { code: 'CSC101', title: 'Introduction to Computing',   cu: 3 },
    { code: 'MTH101', title: 'Elementary Mathematics I',    cu: 3 },
    { code: 'ENG101', title: 'Communication in English',    cu: 2 },
    { code: 'CSC103', title: 'Computer Programming I',      cu: 3 },
  ];
  const courseIds = {};
  for (const c of courseList) {
    const id = await upsertAndGet(
      `INSERT INTO courses (department_id, code, name, title, credit_units) VALUES ('${deptId}', '${c.code}', '${c.title}', '${c.title}', ${c.cu}) ON CONFLICT DO NOTHING`,
      `SELECT id FROM courses WHERE department_id = '${deptId}' AND code = '${c.code}' LIMIT 1`,
      `Course ${c.code}`
    );
    courseIds[c.code] = id;
  }

  // ── 5. Grade Scale ───────────────────────────────────────────
  console.log('\n5. Grade scale…');
  for (const s of [
    [70, 100, 'A', 5.0], [60, 69, 'B', 4.0], [50, 59, 'C', 3.0],
    [45, 49, 'D', 2.0], [40, 44, 'E', 1.0], [0, 39, 'F', 0.0],
  ]) {
    await sql(`INSERT INTO grade_scales (school_id, min_score, max_score, grade_label, grade_point) VALUES ('${SCHOOL_ID}', ${s[0]}, ${s[1]}, '${s[2]}', ${s[3]}) ON CONFLICT DO NOTHING`);
  }
  console.log('  ✓ A=5, B=4, C=3, D=2, E=1, F=0');

  // ── 6. Course Offerings ───────────────────────────────────────
  console.log('\n6. Course offerings…');
  const offeringIds = {};
  for (const code of Object.keys(courseIds)) {
    const id = await upsertAndGet(
      `INSERT INTO course_offerings (course_id, semester_id, results_status) VALUES ('${courseIds[code]}', '${semesterId}', 'draft') ON CONFLICT DO NOTHING`,
      `SELECT id FROM course_offerings WHERE course_id = '${courseIds[code]}' AND semester_id = '${semesterId}' LIMIT 1`,
      `Offering ${code}`
    );
    offeringIds[code] = id;
  }

  // ── 7. Lecturer ───────────────────────────────────────────────
  console.log('\n7. Lecturer account…');
  const lecId = await getOrCreateUser('lecturer@regentos.ng', 'haidarbuilds2026!', 'Dr. Amaka', 'Obi', 'Lecturer');
  await sql(`INSERT INTO profiles (id, email, first_name, last_name) VALUES ('${lecId}', 'lecturer@regentos.ng', 'Dr. Amaka', 'Obi') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`);
  await sql(`INSERT INTO memberships (profile_id, school_id, office_id) VALUES ('${lecId}', '${SCHOOL_ID}', (SELECT id FROM offices WHERE name = 'lecturer')) ON CONFLICT DO NOTHING`);
  console.log('  ✓ lecturer@regentos.ng → lecturer office');

  // ── 8. Student ────────────────────────────────────────────────
  console.log('\n8. Student account…');
  const stuId = await getOrCreateUser('student@regentos.ng', 'haidarbuilds2026!', 'Emeka', 'Nwosu', 'Student');
  await sql(`INSERT INTO profiles (id, email, first_name, last_name) VALUES ('${stuId}', 'student@regentos.ng', 'Emeka', 'Nwosu') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`);

  // Create learner record
  const learnerId = await upsertAndGet(
    `INSERT INTO learners (learner_id, first_name, last_name, date_of_birth) VALUES ('STX/ND/2025/001', 'Emeka', 'Nwosu', '2002-03-15') ON CONFLICT DO NOTHING`,
    `SELECT id FROM learners WHERE learner_id = 'STX/ND/2025/001' LIMIT 1`,
    'Learner Emeka Nwosu'
  );

  // Create learner_enrollment (this is what ties the learner to the school/stage)
  const enrollId = await upsertAndGet(
    `INSERT INTO learner_enrollments (learner_id, school_id, stage, entry_date, status, guardian_consent_captured) VALUES ('${learnerId}', '${SCHOOL_ID}', 'nd', '2025-09-01', 'active', false) ON CONFLICT DO NOTHING`,
    `SELECT id FROM learner_enrollments WHERE learner_id = '${learnerId}' AND school_id = '${SCHOOL_ID}' LIMIT 1`,
    'Learner enrollment (ND, active)'
  );

  // Create student membership
  await sql(`INSERT INTO memberships (profile_id, school_id, office_id) VALUES ('${stuId}', '${SCHOOL_ID}', (SELECT id FROM offices WHERE name = 'student')) ON CONFLICT DO NOTHING`);
  console.log('  ✓ student@regentos.ng → student office');

  // ── Summary ────────────────────────────────────────────────────
  console.log(`
╔════════════════════════════════════════════════════════╗
║        SEED COMPLETE — Regentos Polytechnic              ║
╠════════════════════════════════════════════════════════╣
║  SCHOOL ADMIN  haidarbuilds@gmail.com                  ║
║  (your existing account, already seeded)               ║
╠════════════════════════════════════════════════════════╣
║  STUDENT       student@regentos.ng                       ║
║  Password      haidarbuilds2026!                       ║
║  Name          Emeka Nwosu  (ND, active)               ║
║  Enrollment ID ${enrollId.slice(0,8)}…            ║
╠════════════════════════════════════════════════════════╣
║  LECTURER      lecturer@regentos.ng                      ║
║  Password      haidarbuilds2026!                       ║
║  Name          Dr. Amaka Obi                           ║
╠════════════════════════════════════════════════════════╣
║  STRUCTURE                                             ║
║    Faculty of Technology                               ║
║      └─ Computer Science                               ║
║           CSC101  Introduction to Computing     3 CU   ║
║           MTH101  Elementary Mathematics I      3 CU   ║
║           ENG101  Communication in English      2 CU   ║
║           CSC103  Computer Programming I        3 CU   ║
╠════════════════════════════════════════════════════════╣
║  SESSION    2025/2026  (active)                        ║
║  SEMESTER   First Semester  (active)                   ║
║  OFFERINGS  4 courses open (draft)                     ║
║  GRADES     A=5  B=4  C=3  D=2  E=1  F=0              ║
╠════════════════════════════════════════════════════════╣
║  App: http://localhost:5173                            ║
╚════════════════════════════════════════════════════════╝
`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
