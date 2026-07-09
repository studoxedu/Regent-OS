const https = require('https');
const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';

function sql(q) {
  return new Promise((res,rej) => {
    const body = JSON.stringify({query:q});
    const req = https.request({hostname:'api.supabase.com',path:`/v1/projects/${PROJECT_REF}/database/query`,method:'POST',headers:{'Authorization':`Bearer ${PAT}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res({raw:d})}});
    });
    req.on('error',rej); req.write(body); req.end();
  });
}
function ok(r,s){if(r&&r.error){console.error(`FAIL[${s}]:`,r.error);process.exit(1);}console.log('   OK');}

async function run() {
  console.log('Phase 7 — Regent OS Student Portal DB\n');

  console.log('1. auth_user_id on students table…');
  ok(await sql(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
  `),'students.auth_user_id');

  console.log('2. RLS on students (self-read by auth_user_id)…');
  ok(await sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='students' AND policyname='stu_self_read') THEN
        CREATE POLICY stu_self_read ON students FOR SELECT TO authenticated
          USING (auth_user_id = auth.uid() OR school_id IN (
            SELECT oi.institution_id FROM office_assignments oa
            JOIN office_instances oi ON oi.id = oa.office_instance_id
            WHERE oa.profile_id = auth.uid() AND oa.is_active = true
          ));
      END IF;
    END $$;
  `),'stu_self_read rls');

  console.log('3. RLS on admissions (student self-read)…');
  ok(await sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admissions' AND policyname='adm_self_read') THEN
        CREATE POLICY adm_self_read ON admissions FOR SELECT TO authenticated
          USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
      END IF;
    END $$;
  `),'adm_self_read rls');

  console.log('4. RLS on course_registrations (student self-read/write)…');
  ok(await sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='course_registrations' AND policyname='cr_student_rw') THEN
        CREATE POLICY cr_student_rw ON course_registrations FOR ALL TO authenticated
          USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()))
          WITH CHECK (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
      END IF;
    END $$;
  `),'cr_student_rw rls');

  console.log('5. resolve_student_by_reg() function (for login lookup)…');
  ok(await sql(`
    CREATE OR REPLACE FUNCTION resolve_student_by_reg(p_reg_number TEXT)
    RETURNS TABLE(student_id UUID, auth_user_id UUID, email TEXT)
    LANGUAGE sql SECURITY DEFINER AS $$
      SELECT s.id, s.auth_user_id, u.email
      FROM students s
      JOIN auth.users u ON u.id = s.auth_user_id
      WHERE s.reg_number = p_reg_number AND s.auth_user_id IS NOT NULL
      LIMIT 1;
    $$;
  `),'resolve_student_by_reg');

  console.log('6. get_student_context() for portal bootstrap…');
  ok(await sql(`
    CREATE OR REPLACE FUNCTION get_student_context()
    RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE
      v_uid  UUID := auth.uid();
      v_student RECORD;
      v_admission RECORD;
    BEGIN
      SELECT s.id, s.first_name, s.last_name, s.reg_number, s.status,
             s.school_id, s.department_id, s.programme_id
      INTO v_student
      FROM students s WHERE s.auth_user_id = v_uid LIMIT 1;

      IF NOT FOUND THEN RETURN NULL; END IF;

      SELECT a.session_id, a.programme_id, a.level, a.mode_of_study
      INTO v_admission
      FROM admissions a WHERE a.student_id = v_student.id
      ORDER BY a.created_at DESC LIMIT 1;

      RETURN jsonb_build_object(
        'student_id',    v_student.id,
        'first_name',    v_student.first_name,
        'last_name',     v_student.last_name,
        'reg_number',    v_student.reg_number,
        'status',        v_student.status,
        'school_id',     v_student.school_id,
        'department_id', v_student.department_id,
        'programme_id',  v_student.programme_id,
        'session_id',    v_admission.session_id,
        'level',         v_admission.level,
        'mode_of_study', v_admission.mode_of_study
      );
    END;
    $fn$;
  `),'get_student_context');

  console.log('\nPhase 7 DB complete.');
}
run().catch(e=>{console.error(e);process.exit(1);});
