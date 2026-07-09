/**
 * Full seed — Federal University of Regentos (FUSOX)
 * 4 Faculties · 9 Departments · 24 Courses · 8 Admin · 4 Deans · 7 HODs · 10 Lecturers · 19 Students
 */

const https = require('https')

const PAT         = process.env.SUPABASE_PAT
const PROJECT_REF = 'fghdgtihpvaehykgqgro'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

// ── Helpers ───────────────────────────────────────────────────────────────────

function sql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query })
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
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({ raw: data }) } })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function adminCreateUser(email, password, firstName, lastName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      email, password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    })
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
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function getOrCreateUser(email, password, first, last) {
  const res = await adminCreateUser(email, password, first, last)
  if (res.body?.id) {
    await sql(`INSERT INTO profiles (id, email, first_name, last_name)
               VALUES ('${res.body.id}', '${email}', '${first.replace(/'/g,"''")}', '${last.replace(/'/g,"''")}')
               ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name`)
    return res.body.id
  }
  const rows = await sql(`SELECT id FROM profiles WHERE email = '${email}' LIMIT 1`)
  if (rows[0]?.id) return rows[0].id
  throw new Error(`Cannot create/find ${email}: ${JSON.stringify(res.body).slice(0,200)}`)
}

async function upsertGet(insertSql, selectSql, label) {
  await sql(insertSql)
  const rows = await sql(selectSql)
  const id = rows[0]?.id
  if (!id) throw new Error(`upsertGet failed for: ${label}`)
  return id
}

function esc(s) { return s.replace(/'/g, "''") }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║  Federal University of Regentos — Full Seed        ║')
  console.log('╚══════════════════════════════════════════════════╝\n')

  // ── 0. Schema check: discover actual column names ─────────────
  console.log('0. Checking schema…')
  const crCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'course_registrations' AND table_schema = 'public' ORDER BY ordinal_position`)
  const gsCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'grade_scales' AND table_schema = 'public' ORDER BY ordinal_position`)
  const crColNames = (crCols || []).map(r => r.column_name)
  const gsColNames = (gsCols || []).map(r => r.column_name)
  console.log('  course_registrations cols:', crColNames.join(', '))
  console.log('  grade_scales cols:', gsColNames.join(', '))

  // Resolve which column links course_registrations to a student
  const crStudentCol = crColNames.includes('student_id') ? 'student_id'
    : crColNames.includes('enrollment_id') ? 'enrollment_id' : null
  const gsGradeCol = gsColNames.includes('grade') ? 'grade'
    : gsColNames.includes('grade_label') ? 'grade_label' : 'grade'
  console.log(`  Using: course_registrations.${crStudentCol}, grade_scales.${gsGradeCol}`)

  // ── 1. University ─────────────────────────────────────────────
  console.log('\n1. Creating university…')
  const SCHOOL_ID = await upsertGet(
    `INSERT INTO schools (name, code, institution_type, stages_offered, tier_id, is_active, modules_included)
     VALUES ('Federal University of Regentos', 'FUSOX', 'university', ARRAY['degree'], 'standard', true,
             ARRAY['registry','acadex','senate','schedox','paydesk','boards','coredesk','hr','library'])
     ON CONFLICT DO NOTHING`,
    `SELECT id FROM schools WHERE code = 'FUSOX' LIMIT 1`,
    'FUSOX school'
  )
  console.log(`  ✓ Federal University of Regentos: ${SCHOOL_ID}`)

  // ── 2. Grade Scales ───────────────────────────────────────────
  console.log('\n2. Grade scales (5-point CGPA)…')
  const grades = [[70,100,'A',5.0],[60,69,'B',4.0],[50,59,'C',3.0],[45,49,'D',2.0],[40,44,'E',1.0],[0,39,'F',0.0]]
  for (const [mn,mx,gr,gp] of grades) {
    await sql(`INSERT INTO grade_scales (school_id, min_score, max_score, ${gsGradeCol}, grade_point)
               VALUES ('${SCHOOL_ID}', ${mn}, ${mx}, '${gr}', ${gp}) ON CONFLICT DO NOTHING`)
  }
  console.log('  ✓ A=5.0  B=4.0  C=3.0  D=2.0  E=1.0  F=0.0')

  // ── 3. Academic Session + Semesters ──────────────────────────
  console.log('\n3. Academic session 2025/2026…')
  const sessionId = await upsertGet(
    `INSERT INTO academic_sessions (school_id, label, is_active) VALUES ('${SCHOOL_ID}', '2025/2026', true) ON CONFLICT DO NOTHING`,
    `SELECT id FROM academic_sessions WHERE school_id = '${SCHOOL_ID}' AND label = '2025/2026' LIMIT 1`,
    'session 2025/2026'
  )
  const sem1Id = await upsertGet(
    `INSERT INTO semesters (session_id, label, ordinal, is_active) VALUES ('${sessionId}', 'First Semester', 1, true) ON CONFLICT DO NOTHING`,
    `SELECT id FROM semesters WHERE session_id = '${sessionId}' AND label = 'First Semester' LIMIT 1`,
    'First Semester'
  )
  await sql(`INSERT INTO semesters (session_id, label, ordinal, is_active) VALUES ('${sessionId}', 'Second Semester', 2, false) ON CONFLICT DO NOTHING`)
  console.log(`  ✓ 2025/2026 · First Semester active`)

  // ── 4. Faculties ──────────────────────────────────────────────
  console.log('\n4. Faculties…')
  const FACULTIES = [
    { code: 'FS',  name: 'Faculty of Science' },
    { code: 'FE',  name: 'Faculty of Engineering' },
    { code: 'FSS', name: 'Faculty of Social Sciences' },
    { code: 'FAH', name: 'Faculty of Arts & Humanities' },
  ]
  const facIds = {}
  for (const f of FACULTIES) {
    facIds[f.code] = await upsertGet(
      `INSERT INTO faculties (school_id, name, code) VALUES ('${SCHOOL_ID}', '${esc(f.name)}', '${f.code}') ON CONFLICT DO NOTHING`,
      `SELECT id FROM faculties WHERE school_id = '${SCHOOL_ID}' AND code = '${f.code}' LIMIT 1`,
      f.name
    )
    console.log(`  ✓ ${f.name}`)
  }

  // ── 5. Departments ────────────────────────────────────────────
  console.log('\n5. Departments…')
  const DEPTS = [
    { fac:'FS',  code:'CS',  name:'Computer Science' },
    { fac:'FS',  code:'MTH', name:'Mathematics' },
    { fac:'FS',  code:'PHY', name:'Physics' },
    { fac:'FE',  code:'EEE', name:'Electrical & Electronics Engineering' },
    { fac:'FE',  code:'CVE', name:'Civil Engineering' },
    { fac:'FSS', code:'ECO', name:'Economics' },
    { fac:'FSS', code:'SOC', name:'Sociology' },
    { fac:'FAH', code:'ENG', name:'English & Literary Studies' },
    { fac:'FAH', code:'HIS', name:'History & International Studies' },
  ]
  const deptIds = {}
  for (const d of DEPTS) {
    deptIds[d.code] = await upsertGet(
      `INSERT INTO departments (faculty_id, name, code) VALUES ('${facIds[d.fac]}', '${esc(d.name)}', '${d.code}') ON CONFLICT DO NOTHING`,
      `SELECT id FROM departments WHERE faculty_id = '${facIds[d.fac]}' AND code = '${d.code}' LIMIT 1`,
      d.name
    )
    console.log(`  ✓ ${d.name}`)
  }

  // ── 6. Courses ────────────────────────────────────────────────
  console.log('\n6. Courses (24 total)…')
  const COURSES = [
    { dept:'CS',  code:'CSC101', title:'Introduction to Computing',           cu:3 },
    { dept:'CS',  code:'CSC201', title:'Data Structures & Algorithms',        cu:3 },
    { dept:'CS',  code:'CSC301', title:'Database Management Systems',         cu:3 },
    { dept:'CS',  code:'CSC401', title:'Software Engineering',                cu:3 },
    { dept:'MTH', code:'MTH101', title:'Elementary Mathematics I',            cu:3 },
    { dept:'MTH', code:'MTH201', title:'Linear Algebra',                      cu:3 },
    { dept:'MTH', code:'MTH301', title:'Real Analysis',                       cu:3 },
    { dept:'PHY', code:'PHY101', title:'Mechanics & Properties of Matter',    cu:3 },
    { dept:'PHY', code:'PHY201', title:'Electricity & Magnetism',             cu:3 },
    { dept:'PHY', code:'PHY301', title:'Modern Physics',                      cu:3 },
    { dept:'EEE', code:'EEE101', title:'Basic Electrical Engineering',        cu:3 },
    { dept:'EEE', code:'EEE201', title:'Circuit Theory',                      cu:3 },
    { dept:'EEE', code:'EEE301', title:'Electromagnetic Fields',              cu:3 },
    { dept:'CVE', code:'CVE101', title:'Engineering Drawing',                 cu:2 },
    { dept:'CVE', code:'CVE201', title:'Structural Analysis',                 cu:3 },
    { dept:'CVE', code:'CVE301', title:'Fluid Mechanics',                     cu:3 },
    { dept:'ECO', code:'ECO101', title:'Principles of Economics',             cu:3 },
    { dept:'ECO', code:'ECO201', title:'Microeconomics',                      cu:3 },
    { dept:'ECO', code:'ECO301', title:'Econometrics',                        cu:3 },
    { dept:'SOC', code:'SOC101', title:'Introduction to Sociology',           cu:3 },
    { dept:'SOC', code:'SOC201', title:'Social Theory',                       cu:3 },
    { dept:'ENG', code:'ENG101', title:'Use of English & Communication',      cu:2 },
    { dept:'ENG', code:'ENG201', title:'Literary Analysis & Criticism',       cu:3 },
    { dept:'HIS', code:'HIS101', title:'History of West Africa',              cu:3 },
  ]
  const courseIds = {}
  for (const c of COURSES) {
    courseIds[c.code] = await upsertGet(
      `INSERT INTO courses (department_id, code, name, title, credit_units)
       VALUES ('${deptIds[c.dept]}', '${c.code}', '${esc(c.title)}', '${esc(c.title)}', ${c.cu})
       ON CONFLICT DO NOTHING`,
      `SELECT id FROM courses WHERE department_id = '${deptIds[c.dept]}' AND code = '${c.code}' LIMIT 1`,
      c.code
    )
  }
  console.log(`  ✓ ${COURSES.length} courses`)

  // ── 7. Course Offerings ───────────────────────────────────────
  console.log('\n7. Course offerings (First Semester)…')
  const offeringIds = {}
  for (const c of COURSES) {
    offeringIds[c.code] = await upsertGet(
      `INSERT INTO course_offerings (course_id, semester_id, results_status) VALUES ('${courseIds[c.code]}', '${sem1Id}', 'draft') ON CONFLICT DO NOTHING`,
      `SELECT id FROM course_offerings WHERE course_id = '${courseIds[c.code]}' AND semester_id = '${sem1Id}' LIMIT 1`,
      `offering ${c.code}`
    )
  }
  console.log(`  ✓ ${COURSES.length} offerings (all draft)`)

  // ── 8. Office IDs ─────────────────────────────────────────────
  console.log('\n8. Loading office map…')
  const officeRows = await sql(`SELECT id, name FROM offices`)
  const officeMap = {}
  for (const o of (officeRows || [])) officeMap[o.name] = o.id
  console.log(`  ✓ ${Object.keys(officeMap).length} offices: ${Object.keys(officeMap).join(', ')}`)

  // ── 9. Staff ──────────────────────────────────────────────────
  console.log('\n9. Creating staff accounts…')

  const STAFF = [
    // ── Admin ──
    { email:'vc@fusox.edu.ng',          pw:'VCFusox2026!',    first:'Adebayo',   last:'Okafor',   office:'school_admin',       label:'Vice Chancellor'    },
    { email:'registrar@fusox.edu.ng',   pw:'RegFusox2026!',   first:'Chiamaka',  last:'Nwosu',    office:'registrar',          label:'Registrar'          },
    { email:'finance@fusox.edu.ng',     pw:'FinFusox2026!',   first:'Kehinde',   last:'Adebisi',  office:'finance_officer',    label:'Finance Officer'    },
    { email:'senate@fusox.edu.ng',      pw:'SenFusox2026!',   first:'Yusuf',     last:'Tanko',    office:'senate_secretary',   label:'Senate Secretary'   },
    { email:'hr@fusox.edu.ng',          pw:'HRFusox2026!',    first:'Blessing',  last:'Eze',      office:'hr_officer',         label:'HR Officer'         },
    { email:'timetable@fusox.edu.ng',   pw:'TTFusox2026!',    first:'Chidi',     last:'Okoye',    office:'timetable_officer',  label:'Timetable Officer'  },
    { email:'admissions@fusox.edu.ng',  pw:'AdmFusox2026!',   first:'Ada',       last:'Obi',      office:'admissions_officer', label:'Admissions Officer' },
    { email:'library@fusox.edu.ng',     pw:'LibFusox2026!',   first:'Emeka',     last:'Okoro',    office:'library_officer',    label:'Library Officer'    },
    // ── Deans ──
    { email:'deanscience@fusox.edu.ng', pw:'DeanSci2026!',    first:'Ngozi',     last:'Okonkwo',  office:'dean',               label:'Dean of Science', dept:'FS'  },
    { email:'deaneng@fusox.edu.ng',     pw:'DeanEng2026!',    first:'Ibrahim',   last:'Musa',     office:'dean',               label:'Dean of Engineering', dept:'FE' },
    { email:'deanss@fusox.edu.ng',      pw:'DeanSS2026!',     first:'Grace',     last:'Adeleke',  office:'dean',               label:'Dean of Social Sciences', dept:'FSS' },
    { email:'deanarts@fusox.edu.ng',    pw:'DeanArts2026!',   first:'Aminu',     last:'Bello',    office:'dean',               label:'Dean of Arts & Humanities', dept:'FAH' },
    // ── HODs ──
    { email:'hodcs@fusox.edu.ng',       pw:'HODcs2026!',      first:'Fatima',    last:'Hassan',   office:'hod',                label:'HOD Computer Science', dept:'CS'  },
    { email:'hodmth@fusox.edu.ng',      pw:'HODmth2026!',     first:'Bola',      last:'Adeyemi',  office:'hod',                label:'HOD Mathematics', dept:'MTH' },
    { email:'hodphy@fusox.edu.ng',      pw:'HODphy2026!',     first:'Emeka',     last:'Obi',      office:'hod',                label:'HOD Physics', dept:'PHY' },
    { email:'hodeee@fusox.edu.ng',      pw:'HODeee2026!',     first:'Suleiman',  last:'Bako',     office:'hod',                label:'HOD EEE', dept:'EEE' },
    { email:'hodcve@fusox.edu.ng',      pw:'HODcve2026!',     first:'Ngozi',     last:'Okonjo',   office:'hod',                label:'HOD Civil Engineering', dept:'CVE' },
    { email:'hodeco@fusox.edu.ng',      pw:'HODeco2026!',     first:'Tunde',     last:'Williams', office:'hod',                label:'HOD Economics', dept:'ECO' },
    { email:'hodsoc@fusox.edu.ng',      pw:'HODsoc2026!',     first:'Aisha',     last:'Mohammed', office:'hod',                label:'HOD Sociology', dept:'SOC' },
    // ── Lecturers ──
    { email:'lec.usman@fusox.edu.ng',    pw:'LecFusox2026!',  first:'Usman',     last:'Dankore',  office:'lecturer', label:'Lec CS-1', dept:'CS'  },
    { email:'lec.amara@fusox.edu.ng',    pw:'LecFusox2026!',  first:'Amara',     last:'Osei',     office:'lecturer', label:'Lec CS-2', dept:'CS'  },
    { email:'lec.dayo@fusox.edu.ng',     pw:'LecFusox2026!',  first:'Dayo',      last:'Adeola',   office:'lecturer', label:'Lec MTH-1', dept:'MTH' },
    { email:'lec.kemi@fusox.edu.ng',     pw:'LecFusox2026!',  first:'Kemi',      last:'Balogun',  office:'lecturer', label:'Lec MTH-2', dept:'MTH' },
    { email:'lec.olu@fusox.edu.ng',      pw:'LecFusox2026!',  first:'Olu',       last:'Jide',     office:'lecturer', label:'Lec PHY-1', dept:'PHY' },
    { email:'lec.abubakar@fusox.edu.ng', pw:'LecFusox2026!',  first:'Abubakar',  last:'Raji',     office:'lecturer', label:'Lec EEE-1', dept:'EEE' },
    { email:'lec.chioma@fusox.edu.ng',   pw:'LecFusox2026!',  first:'Chioma',    last:'Eze',      office:'lecturer', label:'Lec CVE-1', dept:'CVE' },
    { email:'lec.felix@fusox.edu.ng',    pw:'LecFusox2026!',  first:'Felix',     last:'Nwoye',    office:'lecturer', label:'Lec ECO-1', dept:'ECO' },
    { email:'lec.helen@fusox.edu.ng',    pw:'LecFusox2026!',  first:'Helen',     last:'Adisa',    office:'lecturer', label:'Lec SOC-1', dept:'SOC' },
    { email:'lec.kayode@fusox.edu.ng',   pw:'LecFusox2026!',  first:'Kayode',    last:'Oke',      office:'lecturer', label:'Lec HIS-1', dept:'HIS' },
  ]

  const staffIds = {}
  for (const s of STAFF) {
    const officeId = officeMap[s.office]
    if (!officeId) {
      console.warn(`  ! Office '${s.office}' not found — skipping ${s.email}`)
      continue
    }
    const userId = await getOrCreateUser(s.email, s.pw, s.first, s.last)
    await sql(`INSERT INTO memberships (profile_id, school_id, office_id, is_active)
               VALUES ('${userId}', '${SCHOOL_ID}', '${officeId}', true) ON CONFLICT DO NOTHING`)
    staffIds[s.email] = userId
    console.log(`  ✓ ${s.label}: ${s.email}`)
  }

  // ── 10. Students ──────────────────────────────────────────────
  console.log('\n10. Creating students (19 total)…')

  const STUDENTS = [
    { email:'stu.ada@fusox.edu.ng',      first:'Ada',      last:'Okonkwo',  dept:'CS',  dob:'2003-04-12', gender:'female', reg:'FUSOX/CS/2025/001'  },
    { email:'stu.emeka@fusox.edu.ng',    first:'Emeka',    last:'Nwosu',    dept:'CS',  dob:'2002-08-22', gender:'male',   reg:'FUSOX/CS/2025/002'  },
    { email:'stu.hafsa@fusox.edu.ng',    first:'Hafsa',    last:'Bello',    dept:'CS',  dob:'2003-01-15', gender:'female', reg:'FUSOX/CS/2025/003'  },
    { email:'stu.tunde@fusox.edu.ng',    first:'Tunde',    last:'Adeyemi',  dept:'MTH', dob:'2002-11-05', gender:'male',   reg:'FUSOX/MTH/2025/001' },
    { email:'stu.ngozi@fusox.edu.ng',    first:'Ngozi',    last:'Eze',      dept:'MTH', dob:'2003-06-18', gender:'female', reg:'FUSOX/MTH/2025/002' },
    { email:'stu.ibrahim@fusox.edu.ng',  first:'Ibrahim',  last:'Musa',     dept:'PHY', dob:'2002-03-30', gender:'male',   reg:'FUSOX/PHY/2025/001' },
    { email:'stu.amina@fusox.edu.ng',    first:'Amina',    last:'Suleiman', dept:'PHY', dob:'2003-09-14', gender:'female', reg:'FUSOX/PHY/2025/002' },
    { email:'stu.chibuzor@fusox.edu.ng', first:'Chibuzor', last:'Okeke',    dept:'EEE', dob:'2002-07-25', gender:'male',   reg:'FUSOX/EEE/2025/001' },
    { email:'stu.halima@fusox.edu.ng',   first:'Halima',   last:'Usman',    dept:'EEE', dob:'2003-02-08', gender:'female', reg:'FUSOX/EEE/2025/002' },
    { email:'stu.segun@fusox.edu.ng',    first:'Segun',    last:'Olatunji', dept:'CVE', dob:'2002-12-20', gender:'male',   reg:'FUSOX/CVE/2025/001' },
    { email:'stu.chidinma@fusox.edu.ng', first:'Chidinma', last:'Agu',      dept:'CVE', dob:'2003-05-03', gender:'female', reg:'FUSOX/CVE/2025/002' },
    { email:'stu.biodun@fusox.edu.ng',   first:'Biodun',   last:'Oluwole',  dept:'ECO', dob:'2002-10-17', gender:'male',   reg:'FUSOX/ECO/2025/001' },
    { email:'stu.zainab@fusox.edu.ng',   first:'Zainab',   last:'Yakubu',   dept:'ECO', dob:'2003-07-29', gender:'female', reg:'FUSOX/ECO/2025/002' },
    { email:'stu.chukwudi@fusox.edu.ng', first:'Chukwudi', last:'Obi',      dept:'SOC', dob:'2002-02-14', gender:'male',   reg:'FUSOX/SOC/2025/001' },
    { email:'stu.rukayat@fusox.edu.ng',  first:'Rukayat',  last:'Adesanya', dept:'SOC', dob:'2003-11-22', gender:'female', reg:'FUSOX/SOC/2025/002' },
    { email:'stu.obiora@fusox.edu.ng',   first:'Obiora',   last:'Chukwu',   dept:'ENG', dob:'2002-06-08', gender:'male',   reg:'FUSOX/ENG/2025/001' },
    { email:'stu.fatimah@fusox.edu.ng',  first:'Fatimah',  last:'Lawal',    dept:'ENG', dob:'2003-08-31', gender:'female', reg:'FUSOX/ENG/2025/002' },
    { email:'stu.gbenga@fusox.edu.ng',   first:'Gbenga',   last:'Adeyinka', dept:'HIS', dob:'2002-04-04', gender:'male',   reg:'FUSOX/HIS/2025/001' },
    { email:'stu.nkechi@fusox.edu.ng',   first:'Nkechi',   last:'Ofosu',    dept:'HIS', dob:'2003-10-16', gender:'female', reg:'FUSOX/HIS/2025/002' },
  ]

  const STU_PW = 'RegentosStu2026!'
  const studentOfficeId = officeMap['student']
  const stuDbIds = {}  // reg → students.id

  for (const s of STUDENTS) {
    const userId = await getOrCreateUser(s.email, STU_PW, s.first, s.last)

    // Tertiary student record
    await sql(`INSERT INTO students (institution_id, reg_number, first_name, last_name, gender, date_of_birth, department_id, programme, admission_session_id, status, auth_user_id)
               VALUES ('${SCHOOL_ID}', '${s.reg}', '${esc(s.first)}', '${esc(s.last)}', '${s.gender}', '${s.dob}', '${deptIds[s.dept]}', 'degree', '${sessionId}', 'active', '${userId}')
               ON CONFLICT (institution_id, reg_number) DO NOTHING`)

    // Student portal membership
    if (studentOfficeId) {
      await sql(`INSERT INTO memberships (profile_id, school_id, office_id, is_active)
                 VALUES ('${userId}', '${SCHOOL_ID}', '${studentOfficeId}', true) ON CONFLICT DO NOTHING`)
    }

    const stuRows = await sql(`SELECT id FROM students WHERE institution_id = '${SCHOOL_ID}' AND reg_number = '${s.reg}' LIMIT 1`)
    stuDbIds[s.reg] = stuRows[0]?.id
    console.log(`  ✓ ${s.first} ${s.last} (${s.dept}) · ${s.reg}`)
  }

  // ── 11. Course Registrations ──────────────────────────────────
  console.log('\n11. Enrolling students in courses…')

  // Each student gets their dept's courses + cross-dept general courses
  const ENROLL_MAP = {
    CS:  ['CSC101','CSC201','MTH101','ENG101'],
    MTH: ['MTH101','MTH201','CSC101','PHY101'],
    PHY: ['PHY101','PHY201','MTH101','CSC101'],
    EEE: ['EEE101','EEE201','MTH101','PHY101'],
    CVE: ['CVE101','CVE201','MTH101','EEE101'],
    ECO: ['ECO101','ECO201','ENG101','SOC101'],
    SOC: ['SOC101','SOC201','ECO101','ENG101'],
    ENG: ['ENG101','ENG201','HIS101','SOC101'],
    HIS: ['HIS101','HIS201','ENG101','SOC101'],
  }

  if (crStudentCol) {
    let totalRegs = 0
    for (const s of STUDENTS) {
      const stuId = stuDbIds[s.reg]
      if (!stuId) { console.warn(`  ! No DB id for ${s.reg}`); continue }
      for (const code of (ENROLL_MAP[s.dept] || [])) {
        const offId = offeringIds[code]
        if (!offId) continue
        const result = await sql(`INSERT INTO course_registrations (offering_id, ${crStudentCol}, ca_score, exam_score)
                                  VALUES ('${offId}', '${stuId}', NULL, NULL) ON CONFLICT DO NOTHING`)
        if (!result?.message?.includes('ERROR')) totalRegs++
      }
    }
    console.log(`  ✓ ~${totalRegs} course registrations`)
  } else {
    console.warn('  ! Could not determine student column in course_registrations — skipping registrations')
  }

  // ── 12. Sample scores for 2 students ─────────────────────────
  console.log('\n12. Adding sample scores for Ada Okonkwo & Emeka Nwosu…')
  if (crStudentCol && stuDbIds['FUSOX/CS/2025/001'] && stuDbIds['FUSOX/CS/2025/002']) {
    const sampleScores = [
      { reg:'FUSOX/CS/2025/001', code:'CSC101', ca:22, exam:55 },
      { reg:'FUSOX/CS/2025/001', code:'CSC201', ca:24, exam:62 },
      { reg:'FUSOX/CS/2025/001', code:'MTH101', ca:20, exam:50 },
      { reg:'FUSOX/CS/2025/002', code:'CSC101', ca:18, exam:48 },
      { reg:'FUSOX/CS/2025/002', code:'CSC201', ca:25, exam:70 },
      { reg:'FUSOX/CS/2025/002', code:'MTH101', ca:23, exam:60 },
    ]
    for (const sc of sampleScores) {
      const stuId = stuDbIds[sc.reg]
      const offId = offeringIds[sc.code]
      if (!stuId || !offId) continue
      await sql(`UPDATE course_registrations SET ca_score = ${sc.ca}, exam_score = ${sc.exam}
                 WHERE offering_id = '${offId}' AND ${crStudentCol} = '${stuId}'`)
    }
    console.log('  ✓ Scores set (ca + exam)')
  }

  // ── Done ──────────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║          FEDERAL UNIVERSITY OF REGENTOS — SEEDED ✓                     ║
╠══════════════════════════════════════════════════════════════════════╣
║  SUPER ADMIN      regentos.edu@gmail.com         Regentosedu2026!         ║
╠══════════════════════════════════════════════════════════════════════╣
║  ADMIN STAFF (email → password)                                       ║
║  vc@fusox.edu.ng                  VCFusox2026!  Vice Chancellor       ║
║  registrar@fusox.edu.ng           RegFusox2026! Registrar             ║
║  finance@fusox.edu.ng             FinFusox2026! Finance Officer       ║
║  senate@fusox.edu.ng              SenFusox2026! Senate Secretary      ║
║  hr@fusox.edu.ng                  HRFusox2026!  HR Officer            ║
║  timetable@fusox.edu.ng           TTFusox2026!  Timetable Officer     ║
║  admissions@fusox.edu.ng          AdmFusox2026! Admissions Officer    ║
║  library@fusox.edu.ng             LibFusox2026! Library Officer       ║
╠══════════════════════════════════════════════════════════════════════╣
║  DEANS                                                                ║
║  deanscience@fusox.edu.ng         DeanSci2026!  Faculty of Science    ║
║  deaneng@fusox.edu.ng             DeanEng2026!  Faculty of Engineering║
║  deanss@fusox.edu.ng              DeanSS2026!   Social Sciences       ║
║  deanarts@fusox.edu.ng            DeanArts2026! Arts & Humanities     ║
╠══════════════════════════════════════════════════════════════════════╣
║  HODs                                                                 ║
║  hodcs@fusox.edu.ng               HODcs2026!    Computer Science      ║
║  hodmth@fusox.edu.ng              HODmth2026!   Mathematics           ║
║  hodphy@fusox.edu.ng              HODphy2026!   Physics               ║
║  hodeee@fusox.edu.ng              HODeee2026!   EEE                   ║
║  hodcve@fusox.edu.ng              HODcve2026!   Civil Engineering      ║
║  hodeco@fusox.edu.ng              HODeco2026!   Economics             ║
║  hodsoc@fusox.edu.ng              HODsoc2026!   Sociology             ║
╠══════════════════════════════════════════════════════════════════════╣
║  LECTURERS  (all: LecFusox2026!)                                      ║
║  lec.usman/amara@fusox.edu.ng     CS lecturers                        ║
║  lec.dayo/kemi@fusox.edu.ng       Mathematics lecturers               ║
║  lec.olu@fusox.edu.ng             Physics lecturer                    ║
║  lec.abubakar@fusox.edu.ng        EEE lecturer                        ║
║  lec.chioma@fusox.edu.ng          Civil Engineering lecturer          ║
║  lec.felix@fusox.edu.ng           Economics lecturer                  ║
║  lec.helen@fusox.edu.ng           Sociology lecturer                  ║
║  lec.kayode@fusox.edu.ng          History lecturer                    ║
╠══════════════════════════════════════════════════════════════════════╣
║  STUDENTS  (all: RegentosStu2026!)                                       ║
║  stu.ada/emeka/hafsa@fusox.edu.ng             CS (3 students)         ║
║  stu.tunde/ngozi@fusox.edu.ng                 MTH (2 students)        ║
║  stu.ibrahim/amina@fusox.edu.ng               PHY (2 students)        ║
║  stu.chibuzor/halima@fusox.edu.ng             EEE (2 students)        ║
║  stu.segun/chidinma@fusox.edu.ng              CVE (2 students)        ║
║  stu.biodun/zainab@fusox.edu.ng               ECO (2 students)        ║
║  stu.chukwudi/rukayat@fusox.edu.ng            SOC (2 students)        ║
║  stu.obiora/fatimah@fusox.edu.ng              ENG (2 students)        ║
║  stu.gbenga/nkechi@fusox.edu.ng               HIS (2 students)        ║
╠══════════════════════════════════════════════════════════════════════╣
║  STRUCTURE                                                            ║
║  4 Faculties · 9 Departments · 24 Courses                            ║
║  1 Session (2025/2026) · 2 Semesters · 24 Offerings (draft)         ║
║  Ada & Emeka have sample CA+Exam scores for Senate/Ratification test  ║
╚══════════════════════════════════════════════════════════════════════╝
`)
}

main().catch(e => { console.error('\nFatal:', e.message, e.stack); process.exit(1) })
