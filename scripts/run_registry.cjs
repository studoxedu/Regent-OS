const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PAT         = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';
const SCHOOL_ID   = '00000000-0000-0000-0000-000000000003'; // Regentos Polytechnic

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

async function run() {
  console.log('Phase 1 — Registry migration\n');

  // 1. Schema changes
  console.log('1. Adding code/reg_number_pattern to schools, faculties, departments…');
  let r = await sql(`
    ALTER TABLE schools      ADD COLUMN IF NOT EXISTS code               TEXT;
    ALTER TABLE schools      ADD COLUMN IF NOT EXISTS reg_number_pattern TEXT DEFAULT '{CODE}/{YEAR}/{DEPT}/{SEQ}';
    ALTER TABLE faculties    ADD COLUMN IF NOT EXISTS code TEXT;
    ALTER TABLE departments  ADD COLUMN IF NOT EXISTS code TEXT;
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 2. students table
  console.log('2. Creating students table…');
  r = await sql(`
    CREATE TABLE IF NOT EXISTS students (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id       UUID        NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      reg_number           TEXT        NOT NULL,
      first_name           TEXT        NOT NULL,
      last_name            TEXT        NOT NULL,
      middle_name          TEXT,
      date_of_birth        DATE,
      gender               TEXT        CHECK (gender IN ('male','female','other')),
      phone                TEXT,
      personal_email       TEXT,
      department_id        UUID        REFERENCES departments(id) ON DELETE RESTRICT,
      programme            TEXT        NOT NULL
                                       CHECK (programme IN ('nd','hnd','nce','degree','pgd','masters','phd')),
      admission_session_id UUID        REFERENCES academic_sessions(id) ON DELETE RESTRICT,
      status               TEXT        NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active','suspended','graduated','withdrawn','deferred')),
      auth_user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (institution_id, reg_number)
    );
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 3. admissions table
  console.log('3. Creating admissions table…');
  r = await sql(`
    CREATE TABLE IF NOT EXISTS admissions (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id           UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      institution_id       UUID        NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      session_id           UUID        NOT NULL REFERENCES academic_sessions(id) ON DELETE RESTRICT,
      programme            TEXT        NOT NULL,
      department_id        UUID        REFERENCES departments(id),
      admitted_by_user_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 4. reg_sequences table
  console.log('4. Creating reg_sequences table…');
  r = await sql(`
    CREATE TABLE IF NOT EXISTS reg_sequences (
      institution_id  UUID    NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      year            INTEGER NOT NULL,
      dept_code       TEXT    NOT NULL DEFAULT '',
      last_seq        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (institution_id, year, dept_code)
    );
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 5. student_id on course_registrations
  console.log('5. Adding student_id to course_registrations…');
  r = await sql(`
    ALTER TABLE course_registrations
      ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 6. updated_at trigger
  console.log('6. Creating updated_at trigger…');
  r = await sql(`
    CREATE OR REPLACE FUNCTION trig_set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$;

    DROP TRIGGER IF EXISTS students_set_updated_at ON students;
    CREATE TRIGGER students_set_updated_at
      BEFORE UPDATE ON students
      FOR EACH ROW EXECUTE FUNCTION trig_set_updated_at();
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 7. generate_reg_number function
  console.log('7. Creating generate_reg_number()…');
  r = await sql(`
    CREATE OR REPLACE FUNCTION generate_reg_number(
      p_institution_id  UUID,
      p_year            INTEGER,
      p_dept_code       TEXT DEFAULT ''
    ) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE
      v_inst_code  TEXT;
      v_pattern    TEXT;
      v_seq        INTEGER;
      v_result     TEXT;
    BEGIN
      SELECT COALESCE(code, 'STX'),
             COALESCE(reg_number_pattern, '{CODE}/{YEAR}/{DEPT}/{SEQ}')
      INTO   v_inst_code, v_pattern
      FROM   schools WHERE id = p_institution_id;

      INSERT INTO reg_sequences (institution_id, year, dept_code, last_seq)
      VALUES (p_institution_id, p_year, COALESCE(p_dept_code,''), 1)
      ON CONFLICT (institution_id, year, dept_code)
      DO UPDATE SET last_seq = reg_sequences.last_seq + 1
      RETURNING last_seq INTO v_seq;

      v_result := v_pattern;
      v_result := REPLACE(v_result, '{CODE}', COALESCE(v_inst_code, 'STX'));
      v_result := REPLACE(v_result, '{YEAR}', p_year::TEXT);
      v_result := REPLACE(v_result, '{DEPT}', COALESCE(p_dept_code, ''));
      v_result := REPLACE(v_result, '{SEQ}',  LPAD(v_seq::TEXT, 3, '0'));
      RETURN v_result;
    END;
    $fn$;
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 8. create_student function
  console.log('8. Creating create_student()…');
  r = await sql(`
    CREATE OR REPLACE FUNCTION create_student(
      p_institution_id    UUID,
      p_first_name        TEXT,
      p_last_name         TEXT,
      p_middle_name       TEXT    DEFAULT NULL,
      p_date_of_birth     DATE    DEFAULT NULL,
      p_gender            TEXT    DEFAULT NULL,
      p_phone             TEXT    DEFAULT NULL,
      p_personal_email    TEXT    DEFAULT NULL,
      p_department_id     UUID    DEFAULT NULL,
      p_programme         TEXT    DEFAULT 'nd',
      p_session_id        UUID    DEFAULT NULL,
      p_admitted_by       UUID    DEFAULT NULL
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE
      v_dept_code      TEXT;
      v_inst_code      TEXT;
      v_reg_number     TEXT;
      v_temp_password  TEXT;
      v_email          TEXT;
      v_auth_user_id   UUID;
      v_student_id     UUID;
      v_year           INTEGER;
    BEGIN
      SELECT COALESCE(code, '') INTO v_dept_code FROM departments WHERE id = p_department_id;
      SELECT COALESCE(code, 'STX') INTO v_inst_code FROM schools WHERE id = p_institution_id;
      v_year := EXTRACT(YEAR FROM now())::INTEGER;

      v_reg_number    := generate_reg_number(p_institution_id, v_year, v_dept_code);
      v_temp_password := upper(substring(encode(gen_random_bytes(4), 'hex'), 1, 4))
                         || lower(substring(encode(gen_random_bytes(4), 'hex'), 1, 4));
      v_email         := lower(replace(v_reg_number, '/', '-'))
                         || '@' || lower(v_inst_code) || '.regentos.ng';

      INSERT INTO auth.users (
        instance_id, id, aud, role,
        email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated', 'authenticated',
        v_email,
        crypt(v_temp_password, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name, 'is_student', true),
        now(), now()
      ) RETURNING id INTO v_auth_user_id;

      INSERT INTO profiles (id, email, first_name, last_name)
      VALUES (v_auth_user_id, v_email, p_first_name, p_last_name)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO students (
        institution_id, reg_number,
        first_name, last_name, middle_name,
        date_of_birth, gender, phone, personal_email,
        department_id, programme, admission_session_id,
        status, auth_user_id
      ) VALUES (
        p_institution_id, v_reg_number,
        p_first_name, p_last_name, p_middle_name,
        p_date_of_birth, p_gender, p_phone, p_personal_email,
        p_department_id, p_programme, p_session_id,
        'active', v_auth_user_id
      ) RETURNING id INTO v_student_id;

      INSERT INTO admissions (
        student_id, institution_id, session_id,
        programme, department_id, admitted_by_user_id
      ) VALUES (
        v_student_id, p_institution_id, p_session_id,
        p_programme, p_department_id,
        COALESCE(p_admitted_by, v_auth_user_id)
      );

      RETURN jsonb_build_object(
        'student_id',    v_student_id,
        'reg_number',    v_reg_number,
        'temp_password', v_temp_password,
        'login_email',   v_email
      );
    END;
    $fn$;
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 9. RLS
  console.log('9. Enabling RLS and creating policies…');
  r = await sql(`
    ALTER TABLE students      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE admissions    ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reg_sequences ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='students' AND policyname='students_read') THEN
        CREATE POLICY students_read   ON students FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='students' AND policyname='students_insert') THEN
        CREATE POLICY students_insert ON students FOR INSERT TO authenticated WITH CHECK (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='students' AND policyname='students_update') THEN
        CREATE POLICY students_update ON students FOR UPDATE TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admissions' AND policyname='admissions_read') THEN
        CREATE POLICY admissions_read   ON admissions FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admissions' AND policyname='admissions_insert') THEN
        CREATE POLICY admissions_insert ON admissions FOR INSERT TO authenticated WITH CHECK (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reg_sequences' AND policyname='reg_seq_all') THEN
        CREATE POLICY reg_seq_all ON reg_sequences FOR ALL TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='students' AND policyname='students_own_read') THEN
        CREATE POLICY students_own_read ON students FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
      END IF;
    END $$;
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 10. Set institution code for Regentos Polytechnic
  console.log('10. Configuring Regentos Polytechnic (code=STX)…');
  r = await sql(`
    UPDATE schools
    SET code = 'STX',
        reg_number_pattern = '{CODE}/{YEAR}/{DEPT}/{SEQ}'
    WHERE id = '${SCHOOL_ID}';
  `);
  if (r.error) { console.error('FAIL:', r.error); process.exit(1); }
  console.log('   OK');

  // 11. Set department codes for existing departments
  console.log('11. Setting department codes…');
  r = await sql(`
    UPDATE departments SET code = 'CSC'
    WHERE name ILIKE '%computer science%';

    UPDATE departments SET code = 'MTH'
    WHERE name ILIKE '%math%';

    UPDATE departments SET code = 'ENG'
    WHERE name ILIKE '%english%' OR name ILIKE '%engineering%';
  `);
  if (r.error) { console.error('FAIL:', r.error); }
  console.log('   OK');

  // 12. Verify
  console.log('\n12. Verification…');
  const verify = await sql(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'students')   AS has_students,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'admissions') AS has_admissions,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'reg_sequences') AS has_reg_seq,
      (SELECT code FROM schools WHERE id = '${SCHOOL_ID}') AS inst_code,
      (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name = 'generate_reg_number') AS has_gen_fn,
      (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name = 'create_student') AS has_create_fn;
  `);
  if (verify.error) {
    console.error('Verification query failed:', verify.error);
  } else {
    const v = verify[0];
    console.log(`   students table:       ${v.has_students === '1' ? 'YES' : 'MISSING'}`);
    console.log(`   admissions table:     ${v.has_admissions === '1' ? 'YES' : 'MISSING'}`);
    console.log(`   reg_sequences table:  ${v.has_reg_seq === '1' ? 'YES' : 'MISSING'}`);
    console.log(`   institution code:     ${v.inst_code ?? 'NOT SET'}`);
    console.log(`   generate_reg_number:  ${v.has_gen_fn === '1' ? 'YES' : 'MISSING'}`);
    console.log(`   create_student:       ${v.has_create_fn === '1' ? 'YES' : 'MISSING'}`);
  }

  console.log('\nPhase 1 Registry migration complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
