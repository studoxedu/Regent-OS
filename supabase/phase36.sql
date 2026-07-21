-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 36 MIGRATION  (Tertiary org chart, stage 1)
-- Provision the capability-less tertiary offices (additive, low risk).
-- ═══════════════════════════════════════════════════════════
--
-- Test finding: registrar / timetable_officer / admissions_officer held ZERO
-- capabilities, so those logins were non-functional (everything funnelled
-- through school_admin). Also create_student (admissions) was SECURITY DEFINER
-- with NO capability check at all — anyone able to call the RPC could admit.
--
-- This grants the obvious capabilities, introduces a fine-grained
-- `timetable.manage` (so a timetable officer can run Schedox without also being
-- able to edit faculties/departments/courses via the coarse `structure.manage`),
-- introduces `student.admit`, and gates create_student on it.
-- (dept_exam_officer / faculty_exam_officer are provisioned in the results-chain
-- migration, phase38.)

-- ── 1. New capability grants ───────────────────────────────────
INSERT INTO capabilities (office_id, action)
SELECT o.id, v.action
FROM (VALUES
  ('registrar',          'course.register'),
  ('registrar',          'session.create'),
  ('registrar',          'student.admit'),
  ('timetable_officer',  'timetable.manage'),
  ('admissions_officer', 'student.admit'),
  ('school_admin',       'timetable.manage'),
  ('school_admin',       'student.admit')
) v(office_name, action)
JOIN offices o ON o.name = v.office_name
WHERE NOT EXISTS (
  SELECT 1 FROM capabilities c WHERE c.office_id = o.id AND c.action = v.action
);

-- ── 2. Let `timetable.manage` (not just `structure.manage`) drive Schedox ──
DROP POLICY IF EXISTS write_venues_structure ON venues;
CREATE POLICY write_venues_structure ON venues FOR ALL TO authenticated
  USING (is_super_admin()
     OR has_school_capability(institution_id, 'structure.manage')
     OR has_school_capability(institution_id, 'timetable.manage'))
  WITH CHECK (is_super_admin()
     OR has_school_capability(institution_id, 'structure.manage')
     OR has_school_capability(institution_id, 'timetable.manage'));

DROP POLICY IF EXISTS te_school_write ON timetable_entries;
CREATE POLICY te_school_write ON timetable_entries FOR ALL TO authenticated
  USING (is_super_admin() OR EXISTS (SELECT 1 FROM semesters s
     WHERE s.id = timetable_entries.semester_id
       AND (has_school_capability(s.school_id, 'structure.manage')
         OR has_school_capability(s.school_id, 'timetable.manage'))))
  WITH CHECK (is_super_admin() OR EXISTS (SELECT 1 FROM semesters s
     WHERE s.id = timetable_entries.semester_id
       AND (has_school_capability(s.school_id, 'structure.manage')
         OR has_school_capability(s.school_id, 'timetable.manage'))));

DROP POLICY IF EXISTS ee_school_write ON exam_entries;
CREATE POLICY ee_school_write ON exam_entries FOR ALL TO authenticated
  USING (is_super_admin() OR EXISTS (SELECT 1 FROM semesters s
     WHERE s.id = exam_entries.semester_id
       AND (has_school_capability(s.school_id, 'structure.manage')
         OR has_school_capability(s.school_id, 'timetable.manage'))))
  WITH CHECK (is_super_admin() OR EXISTS (SELECT 1 FROM semesters s
     WHERE s.id = exam_entries.semester_id
       AND (has_school_capability(s.school_id, 'structure.manage')
         OR has_school_capability(s.school_id, 'timetable.manage'))));

-- ── 3. Gate create_student on the new `student.admit` capability ──
-- Full function re-asserted from the live definition with ONE added guard after
-- BEGIN. Backend/service contexts (no end-user JWT) and super_admin are exempt
-- so seeds keep working.
CREATE OR REPLACE FUNCTION public.create_student(p_institution_id uuid, p_first_name text, p_last_name text, p_middle_name text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_gender text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_personal_email text DEFAULT NULL::text, p_department_id uuid DEFAULT NULL::uuid, p_programme text DEFAULT 'nd'::text, p_session_id uuid DEFAULT NULL::uuid, p_admitted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
  -- Capability guard (added phase36): a real end-user must hold student.admit.
  IF auth.uid() IS NOT NULL
     AND NOT is_super_admin()
     AND NOT has_school_capability(p_institution_id, 'student.admit') THEN
    RAISE EXCEPTION 'Forbidden: you do not hold the student.admit capability for this institution';
  END IF;

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
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change,
    email_change_token_current, phone_change,
    phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated', 'authenticated',
    v_email,
    crypt(v_temp_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name, 'is_student', true),
    now(), now(),
    '', '', '', '', '', '', '', ''
  ) RETURNING id INTO v_auth_user_id;

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data,
    provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_email, v_auth_user_id,
    jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

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
$function$;

SELECT 'phase36 done' AS status,
  (SELECT jsonb_object_agg(o.name, cnt) FROM offices o,
     LATERAL (SELECT count(*) cnt FROM capabilities c WHERE c.office_id=o.id) x
   WHERE o.name IN ('registrar','timetable_officer','admissions_officer')) AS provisioned;
