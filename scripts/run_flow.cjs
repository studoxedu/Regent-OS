const https = require('https');

const PAT         = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';
const SCHOOL_ID   = '00000000-0000-0000-0000-000000000003';

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

function ok(r, step) {
  if (r && r.error) { console.error(`FAIL [${step}]:`, r.error); process.exit(1); }
  console.log(`   OK`);
}

async function run() {
  console.log('Phase 2 — Flow migration\n');

  // ── 1. capabilities ────────────────────────────────────────────────────
  console.log('1. Creating capabilities table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS capabilities (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code        TEXT UNIQUE NOT NULL,
      label       TEXT NOT NULL,
      description TEXT
    );
  `), 'capabilities');

  // ── 2. office_types ────────────────────────────────────────────────────
  console.log('2. Creating office_types table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS office_types (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code            TEXT UNIQUE NOT NULL,
      label           TEXT NOT NULL,
      governance_mode TEXT NOT NULL DEFAULT 'tertiary'
                      CHECK (governance_mode IN ('tertiary','k12','group'))
    );
  `), 'office_types');

  // ── 3. office_type_capabilities ────────────────────────────────────────
  console.log('3. Creating office_type_capabilities table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS office_type_capabilities (
      office_type_id UUID NOT NULL REFERENCES office_types(id) ON DELETE CASCADE,
      capability_id  UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      PRIMARY KEY (office_type_id, capability_id)
    );
  `), 'office_type_capabilities');

  // ── 4. office_instances ────────────────────────────────────────────────
  console.log('4. Creating office_instances table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS office_instances (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      office_type_id  UUID NOT NULL REFERENCES office_types(id) ON DELETE RESTRICT,
      label           TEXT,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `), 'office_instances');

  // ── 5. office_assignments ──────────────────────────────────────────────
  console.log('5. Creating office_assignments table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS office_assignments (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      office_instance_id  UUID NOT NULL REFERENCES office_instances(id) ON DELETE CASCADE,
      is_active           BOOLEAN NOT NULL DEFAULT true,
      assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      assigned_by         UUID REFERENCES profiles(id),
      UNIQUE (profile_id, office_instance_id)
    );
  `), 'office_assignments');

  // ── 6. office_delegations ─────────────────────────────────────────────
  console.log('6. Creating office_delegations table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS office_delegations (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      grantor_office_id    UUID NOT NULL REFERENCES office_instances(id) ON DELETE CASCADE,
      delegate_office_id   UUID NOT NULL REFERENCES office_instances(id) ON DELETE CASCADE,
      capability_id        UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      is_active            BOOLEAN NOT NULL DEFAULT true,
      expires_at           TIMESTAMPTZ,
      granted_by           UUID REFERENCES profiles(id),
      granted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      reason               TEXT
    );
  `), 'office_delegations');

  // ── 7. flow_log ────────────────────────────────────────────────────────
  console.log('7. Creating flow_log table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS flow_log (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      capability          TEXT NOT NULL,
      actor_user_id       UUID NOT NULL REFERENCES auth.users(id),
      office_instance_id  UUID NOT NULL REFERENCES office_instances(id),
      delegation_id       UUID REFERENCES office_delegations(id),
      payload             JSONB,
      result              JSONB,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `), 'flow_log');

  // ── 8. Seed capabilities ───────────────────────────────────────────────
  console.log('8. Seeding capability vocabulary…');
  ok(await sql(`
    INSERT INTO capabilities (code, label) VALUES
      ('student.create',           'Admit new student'),
      ('student.update',           'Update student record'),
      ('student.suspend',          'Suspend student'),
      ('student.withdraw',         'Withdraw student'),
      ('student.graduate',         'Graduate student'),
      ('course.create',            'Create course'),
      ('course.update',            'Update course'),
      ('offering.create',          'Create course offering'),
      ('offering.assign_lecturer', 'Assign lecturer to offering'),
      ('result.submit',            'Submit assessment scores'),
      ('result.verify',            'Verify submitted scores'),
      ('result.approve',           'Approve results for release'),
      ('result.publish',           'Publish results'),
      ('fee.invoice_create',       'Create fee invoice'),
      ('fee.payment_record',       'Record fee payment'),
      ('fee.waive',                'Waive fee'),
      ('session.create',           'Create academic session'),
      ('semester.create',          'Create semester'),
      ('institution.configure',    'Configure institution settings'),
      ('staff.create',             'Create staff record'),
      ('staff.assign_office',      'Assign staff to an office'),
      ('delegation.grant',         'Grant capability delegation'),
      ('delegation.revoke',        'Revoke capability delegation'),
      ('office.create',            'Create office instance'),
      ('office.assign',            'Assign person to office'),
      ('timetable.manage',         'Manage timetable')
    ON CONFLICT (code) DO NOTHING;
  `), 'capabilities seed');

  // ── 9. Seed office types ───────────────────────────────────────────────
  console.log('9. Seeding office types…');
  ok(await sql(`
    INSERT INTO office_types (code, label) VALUES
      ('institution_admin', 'Institution Administrator'),
      ('registrar',         'Registrar'),
      ('dean',              'Dean of Faculty'),
      ('hod',               'Head of Department'),
      ('exam_officer',      'Examinations Officer'),
      ('lecturer',          'Lecturer'),
      ('bursar',            'Bursar / Finance Office')
    ON CONFLICT (code) DO NOTHING;
  `), 'office_types seed');

  // ── 10. Office type capabilities ───────────────────────────────────────
  console.log('10. Mapping capabilities to office types…');
  ok(await sql(`
    INSERT INTO office_type_capabilities (office_type_id, capability_id)
    SELECT ot.id, c.id FROM office_types ot, capabilities c
    WHERE (ot.code, c.code) IN (
      -- institution_admin
      ('institution_admin', 'institution.configure'),
      ('institution_admin', 'office.create'),
      ('institution_admin', 'office.assign'),
      ('institution_admin', 'staff.create'),
      ('institution_admin', 'staff.assign_office'),
      ('institution_admin', 'delegation.grant'),
      ('institution_admin', 'delegation.revoke'),
      ('institution_admin', 'session.create'),
      ('institution_admin', 'semester.create'),
      -- registrar
      ('registrar', 'student.create'),
      ('registrar', 'student.update'),
      ('registrar', 'student.suspend'),
      ('registrar', 'student.withdraw'),
      ('registrar', 'student.graduate'),
      ('registrar', 'result.publish'),
      ('registrar', 'session.create'),
      ('registrar', 'semester.create'),
      -- dean
      ('dean', 'result.approve'),
      ('dean', 'offering.create'),
      ('dean', 'course.create'),
      -- hod
      ('hod', 'result.verify'),
      ('hod', 'offering.create'),
      ('hod', 'offering.assign_lecturer'),
      ('hod', 'course.create'),
      ('hod', 'course.update'),
      -- exam_officer
      ('exam_officer', 'result.verify'),
      ('exam_officer', 'result.approve'),
      ('exam_officer', 'result.publish'),
      -- lecturer
      ('lecturer', 'result.submit'),
      -- bursar
      ('bursar', 'fee.invoice_create'),
      ('bursar', 'fee.payment_record'),
      ('bursar', 'fee.waive')
    )
    ON CONFLICT DO NOTHING;
  `), 'office_type_capabilities');

  // ── 11. Action functions ───────────────────────────────────────────────
  console.log('11. Creating Flow action functions…');

  // student.create action
  ok(await sql(`
    CREATE OR REPLACE FUNCTION _flow_student_create(
      p_payload        JSONB,
      p_actor_id       UUID,
      p_institution_id UUID
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE
      v_dept_code     TEXT;
      v_inst_code     TEXT;
      v_reg_number    TEXT;
      v_temp_password TEXT;
      v_email         TEXT;
      v_auth_user_id  UUID;
      v_student_id    UUID;
      v_year          INTEGER;
      v_dept_id       UUID;
      v_session_id    UUID;
    BEGIN
      v_dept_id    := (p_payload->>'department_id')::UUID;
      v_session_id := (p_payload->>'session_id')::UUID;
      v_year       := EXTRACT(YEAR FROM now())::INTEGER;

      SELECT COALESCE(code, '') INTO v_dept_code FROM departments WHERE id = v_dept_id;
      SELECT COALESCE(code, 'STX') INTO v_inst_code FROM schools WHERE id = p_institution_id;

      v_reg_number    := generate_reg_number(p_institution_id, v_year, v_dept_code);
      v_temp_password := upper(substring(encode(gen_random_bytes(4),'hex'),1,4))
                         || lower(substring(encode(gen_random_bytes(4),'hex'),1,4));
      v_email         := lower(replace(v_reg_number,'/','--'))
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
        jsonb_build_object('first_name', p_payload->>'first_name',
                           'last_name',  p_payload->>'last_name',
                           'is_student', true),
        now(), now()
      ) RETURNING id INTO v_auth_user_id;

      INSERT INTO profiles (id, email, first_name, last_name)
      VALUES (v_auth_user_id, v_email, p_payload->>'first_name', p_payload->>'last_name')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO students (
        institution_id, reg_number, first_name, last_name, middle_name,
        date_of_birth, gender, phone, personal_email,
        department_id, programme, admission_session_id, status, auth_user_id
      ) VALUES (
        p_institution_id,
        v_reg_number,
        p_payload->>'first_name',
        p_payload->>'last_name',
        NULLIF(p_payload->>'middle_name', ''),
        NULLIF(p_payload->>'date_of_birth', '')::DATE,
        NULLIF(p_payload->>'gender', ''),
        NULLIF(p_payload->>'phone', ''),
        NULLIF(p_payload->>'personal_email', ''),
        v_dept_id,
        COALESCE(p_payload->>'programme', 'nd'),
        v_session_id,
        'active',
        v_auth_user_id
      ) RETURNING id INTO v_student_id;

      INSERT INTO admissions (
        student_id, institution_id, session_id,
        programme, department_id, admitted_by_user_id
      ) VALUES (
        v_student_id, p_institution_id, v_session_id,
        COALESCE(p_payload->>'programme','nd'),
        v_dept_id, p_actor_id
      );

      RETURN jsonb_build_object(
        'student_id',    v_student_id,
        'reg_number',    v_reg_number,
        'temp_password', v_temp_password,
        'login_email',   v_email
      );
    END;
    $fn$;
  `), '_flow_student_create');

  // institution.configure action
  ok(await sql(`
    CREATE OR REPLACE FUNCTION _flow_institution_configure(
      p_payload        JSONB,
      p_institution_id UUID
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    BEGIN
      UPDATE schools
      SET code               = COALESCE(NULLIF(p_payload->>'code',''), code),
          reg_number_pattern = COALESCE(NULLIF(p_payload->>'reg_number_pattern',''), reg_number_pattern)
      WHERE id = p_institution_id;

      -- Optional: update department codes array
      IF p_payload ? 'department_codes' THEN
        DECLARE
          rec JSONB;
        BEGIN
          FOR rec IN SELECT * FROM jsonb_array_elements(p_payload->'department_codes')
          LOOP
            UPDATE departments
            SET code = NULLIF(rec->>'code','')
            WHERE id = (rec->>'id')::UUID;
          END LOOP;
        END;
      END IF;

      RETURN jsonb_build_object('institution_id', p_institution_id, 'ok', true);
    END;
    $fn$;
  `), '_flow_institution_configure');

  // student.update action
  ok(await sql(`
    CREATE OR REPLACE FUNCTION _flow_student_update(p_payload JSONB)
    RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE v_id UUID;
    BEGIN
      v_id := (p_payload->>'student_id')::UUID;
      IF v_id IS NULL THEN RAISE EXCEPTION 'student_id required'; END IF;

      UPDATE students SET
        first_name     = COALESCE(NULLIF(p_payload->>'first_name',''),  first_name),
        last_name      = COALESCE(NULLIF(p_payload->>'last_name',''),   last_name),
        middle_name    = COALESCE(p_payload->>'middle_name',            middle_name),
        phone          = COALESCE(NULLIF(p_payload->>'phone',''),        phone),
        personal_email = COALESCE(NULLIF(p_payload->>'personal_email',''), personal_email),
        gender         = COALESCE(NULLIF(p_payload->>'gender',''),       gender),
        date_of_birth  = COALESCE(NULLIF(p_payload->>'date_of_birth','')::DATE, date_of_birth)
      WHERE id = v_id;

      RETURN jsonb_build_object('student_id', v_id, 'ok', true);
    END;
    $fn$;
  `), '_flow_student_update');

  // student.suspend / withdraw / graduate
  ok(await sql(`
    CREATE OR REPLACE FUNCTION _flow_student_status(p_capability TEXT, p_payload JSONB)
    RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE
      v_id     UUID;
      v_status TEXT;
    BEGIN
      v_id := (p_payload->>'student_id')::UUID;
      IF v_id IS NULL THEN RAISE EXCEPTION 'student_id required'; END IF;

      v_status := CASE p_capability
        WHEN 'student.suspend'  THEN 'suspended'
        WHEN 'student.withdraw' THEN 'withdrawn'
        WHEN 'student.graduate' THEN 'graduated'
        ELSE RAISE EXCEPTION 'Unknown status capability: %', p_capability
      END;

      UPDATE students SET status = v_status WHERE id = v_id;
      RETURN jsonb_build_object('student_id', v_id, 'new_status', v_status);
    END;
    $fn$;
  `), '_flow_student_status');

  // ── 12. flow_execute ────────────────────────────────────────────────────
  console.log('12. Creating flow_execute…');
  ok(await sql(`
    CREATE OR REPLACE FUNCTION flow_execute(
      p_capability TEXT,
      p_payload    JSONB,
      p_office_id  UUID DEFAULT NULL
    ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    DECLARE
      v_user_id       UUID;
      v_office_id     UUID;
      v_institution_id UUID;
      v_delegation_id UUID;
      v_result        JSONB;
      v_log_id        UUID;
    BEGIN
      v_user_id := auth.uid();
      IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'flow_execute: not authenticated';
      END IF;

      -- 1. Check direct capability via office_assignments
      SELECT oa.office_instance_id, oi.institution_id
      INTO   v_office_id, v_institution_id
      FROM   office_assignments oa
      JOIN   office_instances oi         ON oi.id = oa.office_instance_id
      JOIN   office_type_capabilities otc ON otc.office_type_id = oi.office_type_id
      JOIN   capabilities c              ON c.id = otc.capability_id
      WHERE  oa.profile_id = v_user_id
        AND  oa.is_active  = true
        AND  oi.is_active  = true
        AND  c.code        = p_capability
        AND  (p_office_id IS NULL OR oa.office_instance_id = p_office_id)
      LIMIT 1;

      -- 2. Check delegated capability
      IF v_office_id IS NULL THEN
        SELECT od.delegate_office_id, oi2.institution_id, od.id
        INTO   v_office_id, v_institution_id, v_delegation_id
        FROM   office_delegations od
        JOIN   office_assignments oa   ON oa.office_instance_id = od.delegate_office_id
        JOIN   office_instances oi2    ON oi2.id = od.delegate_office_id
        JOIN   capabilities c          ON c.id = od.capability_id
        WHERE  oa.profile_id  = v_user_id
          AND  oa.is_active   = true
          AND  od.is_active   = true
          AND  c.code         = p_capability
          AND  (od.expires_at IS NULL OR od.expires_at > now())
          AND  (p_office_id IS NULL OR od.delegate_office_id = p_office_id)
        LIMIT 1;
      END IF;

      IF v_office_id IS NULL THEN
        RAISE EXCEPTION 'flow_execute: unauthorized — capability "%" not held by any active office assignment', p_capability;
      END IF;

      -- 3. Dispatch to action handler
      IF p_capability = 'student.create' THEN
        v_result := _flow_student_create(p_payload, v_user_id, v_institution_id);

      ELSIF p_capability = 'institution.configure' THEN
        v_result := _flow_institution_configure(p_payload, v_institution_id);

      ELSIF p_capability = 'student.update' THEN
        v_result := _flow_student_update(p_payload);

      ELSIF p_capability IN ('student.suspend','student.withdraw','student.graduate') THEN
        v_result := _flow_student_status(p_capability, p_payload);

      ELSE
        RAISE EXCEPTION 'flow_execute: no action handler for capability "%"', p_capability;
      END IF;

      -- 4. Immutable log entry
      INSERT INTO flow_log (capability, actor_user_id, office_instance_id, delegation_id, payload, result)
      VALUES (p_capability, v_user_id, v_office_id, v_delegation_id, p_payload, v_result)
      RETURNING id INTO v_log_id;

      RETURN jsonb_build_object(
        'ok',        true,
        'log_id',    v_log_id,
        'office_id', v_office_id,
        'result',    v_result
      );
    END;
    $fn$;
  `), 'flow_execute');

  // ── 13. Create office instances for Regentos Polytechnic ─────────────────
  console.log('13. Creating office instances for Regentos Polytechnic…');
  ok(await sql(`
    INSERT INTO office_instances (institution_id, office_type_id, label)
    SELECT '${SCHOOL_ID}', ot.id, ot.label
    FROM office_types ot
    WHERE ot.code IN ('institution_admin','registrar','dean','hod','exam_officer','lecturer','bursar')
    ON CONFLICT DO NOTHING;
  `), 'office_instances');

  // ── 14. Assign existing school_admin user to both inst_admin + registrar ──
  console.log('14. Migrating existing school_admin to office_assignments…');
  const r14 = await sql(`
    WITH school_admin_profile AS (
      SELECT DISTINCT m.profile_id
      FROM memberships m
      JOIN offices o ON o.id = m.office_id
      WHERE m.school_id = '${SCHOOL_ID}'
        AND o.name = 'school_admin'
        AND m.is_active = true
    ),
    target_offices AS (
      SELECT oi.id AS office_instance_id
      FROM office_instances oi
      JOIN office_types ot ON ot.id = oi.office_type_id
      WHERE oi.institution_id = '${SCHOOL_ID}'
        AND ot.code IN ('institution_admin','registrar')
    )
    INSERT INTO office_assignments (profile_id, office_instance_id, is_active)
    SELECT p.profile_id, o.office_instance_id, true
    FROM school_admin_profile p, target_offices o
    ON CONFLICT (profile_id, office_instance_id) DO NOTHING;
  `);
  if (r14 && r14.error) console.warn('   WARN (non-fatal):', r14.error);
  else console.log('   OK');

  // ── 15. RLS ────────────────────────────────────────────────────────────
  console.log('15. Enabling RLS…');
  ok(await sql(`
    ALTER TABLE capabilities            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE office_types            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE office_type_capabilities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE office_instances        ENABLE ROW LEVEL SECURITY;
    ALTER TABLE office_assignments      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE office_delegations      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE flow_log                ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      -- Reference tables: all authenticated users can read
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='capabilities' AND policyname='cap_read') THEN
        CREATE POLICY cap_read  ON capabilities           FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='office_types' AND policyname='ot_read') THEN
        CREATE POLICY ot_read   ON office_types           FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='office_type_capabilities' AND policyname='otc_read') THEN
        CREATE POLICY otc_read  ON office_type_capabilities FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='office_instances' AND policyname='oi_read') THEN
        CREATE POLICY oi_read   ON office_instances       FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='office_assignments' AND policyname='oa_read') THEN
        CREATE POLICY oa_read   ON office_assignments     FOR SELECT TO authenticated USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='office_delegations' AND policyname='od_read') THEN
        CREATE POLICY od_read   ON office_delegations     FOR SELECT TO authenticated USING (true);
      END IF;
      -- flow_log: read own entries (tighten per institution in Phase 3)
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='flow_log' AND policyname='fl_own_read') THEN
        CREATE POLICY fl_own_read ON flow_log FOR SELECT TO authenticated
          USING (actor_user_id = auth.uid());
      END IF;
    END $$;
  `), 'RLS');

  // ── 16. Verify ────────────────────────────────────────────────────────
  console.log('\n16. Verification…');
  const v = await sql(`
    SELECT
      (SELECT COUNT(*) FROM capabilities)          AS cap_count,
      (SELECT COUNT(*) FROM office_types)          AS ot_count,
      (SELECT COUNT(*) FROM office_type_capabilities) AS otc_count,
      (SELECT COUNT(*) FROM office_instances WHERE institution_id = '${SCHOOL_ID}') AS inst_offices,
      (SELECT COUNT(*) FROM office_assignments oa
         JOIN office_instances oi ON oi.id = oa.office_instance_id
         WHERE oi.institution_id = '${SCHOOL_ID}') AS assignments,
      (SELECT COUNT(*) FROM information_schema.routines
         WHERE routine_schema='public' AND routine_name='flow_execute') AS has_flow_execute;
  `);
  if (v && v[0]) {
    const d = v[0];
    console.log(`   capabilities:       ${d.cap_count}`);
    console.log(`   office types:       ${d.ot_count}`);
    console.log(`   type→cap mappings:  ${d.otc_count}`);
    console.log(`   office instances:   ${d.inst_offices} (Regentos Polytechnic)`);
    console.log(`   office assignments: ${d.assignments}`);
    console.log(`   flow_execute fn:    ${d.has_flow_execute === '1' ? 'YES' : 'MISSING'}`);
  }

  console.log('\nPhase 2 Flow migration complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
