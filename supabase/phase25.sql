-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 25 MIGRATION
-- ICT Admin role + serious role scoping (capabilities layer)
-- ═══════════════════════════════════════════════════════════
--
-- Adds a school-level "ICT Admin" office: a school superuser that manages
-- setup, admissions, guardians/parents, attendance, timetable, CBT, staff
-- RECORDS, library and — crucially — assigns other users to their roles
-- (exam officer, finance officer, etc.). Explicitly EXCLUDED from Finance
-- (fees, payments, payroll, salary definitions) and academic grading
-- (results entry, report cards).
--
-- Also tightens two capability boundaries used for real enforcement:
--   * salary_grades writes move from 'staff.manage' → new 'salary.manage'
--     (a financial record), so staff-record editors can't set pay scales.
--   * create_staff_member() is now capability-gated ('staff.assign_role')
--     instead of callable by any authenticated user.

-- ── 1. ICT Admin office ──
INSERT INTO offices (id, name, governance_mode, description)
SELECT gen_random_uuid(), 'ict_admin', 'k12', 'School ICT / Access Administrator'
WHERE NOT EXISTS (SELECT 1 FROM offices WHERE name='ict_admin');

-- ── 2. New capabilities ──
--    salary.manage → head_teacher, bursar   |   staff.assign_role → head_teacher, ict_admin
INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action FROM offices o
JOIN (VALUES
  ('head_teacher','salary.manage'), ('bursar','salary.manage'),
  ('head_teacher','staff.assign_role'), ('ict_admin','staff.assign_role')
) a(office, action) ON o.name = a.office
ON CONFLICT DO NOTHING;

-- ── 3. ICT Admin capability set (everything a head teacher has EXCEPT
--       finance + grading/results; plus staff.assign_role from step 2) ──
INSERT INTO capabilities (office_id, action)
SELECT (SELECT id FROM offices WHERE name='ict_admin'), action
FROM (VALUES
  ('admission.manage'),('enrollment.manage'),('learner.enroll'),('learner.promote'),
  ('learner.transfer'),('learner.transfer.accept'),('learner.transfer.initiate'),
  ('guardian.manage'),
  ('attendance.record'),('attendance.view'),('cbt.manage'),
  ('timetable.manage'),('timetable.view'),
  ('k12.class.manage'),('k12.subject.manage'),
  ('k12.session.create'),('k12.session.activate'),('k12.term.create'),('k12.term.activate'),
  ('school.manage'),('staff.manage'),('library.manage')
) c(action)
ON CONFLICT DO NOTHING;

-- ── 3b. Separation of duties: Head Teacher may VIEW grades but not ENTER
--        them. Revoke score-entry caps; keep report_card.generate (view).
--        Score entry now belongs to exam officer / class teacher only. ──
DELETE FROM capabilities
WHERE office_id = (SELECT id FROM offices WHERE name='head_teacher')
  AND action IN ('results.finalize','results.reopen','result.manage');

-- ── 4. Move salary_grades write policy to 'salary.manage' ──
DROP POLICY IF EXISTS write_salary_grades ON salary_grades;
CREATE POLICY write_salary_grades ON salary_grades FOR ALL TO authenticated
  USING      (is_super_admin() OR has_school_capability(school_id, 'salary.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(school_id, 'salary.manage'));

-- ── 5. Capability-gate create_staff_member() (live def + gate) ──
CREATE OR REPLACE FUNCTION public.create_staff_member(p_email text, p_first_name text, p_last_name text, p_office_name text, p_school_id uuid, p_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id       UUID;
  v_password      TEXT;
  v_office_id     UUID;
  v_membership_id UUID;
  v_is_new        BOOLEAN := false;
BEGIN
  -- Role assignment is authorized: super admin, or a school office holding
  -- 'staff.assign_role' (head teacher / ICT admin). Preserves the super-admin
  -- onboarding path while letting schools self-manage staff roles.
  IF NOT (is_super_admin() OR has_school_capability(p_school_id, 'staff.assign_role')) THEN
    RAISE EXCEPTION 'Forbidden: you are not permitted to assign staff roles at this school';
  END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(p_email) LIMIT 1;

  IF v_user_id IS NULL THEN
    v_is_new := true;
    v_user_id := gen_random_uuid();

    IF p_password IS NOT NULL AND p_password <> '' THEN
      IF length(p_password) < 6 THEN
        RAISE EXCEPTION 'Password must be at least 6 characters';
      END IF;
      v_password := p_password;
    ELSE
      v_password := 'Staff@' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 3))
                    || floor(random() * 900 + 100)::text;
    END IF;

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, deleted_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change,
      email_change_token_current, phone_change,
      phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      lower(p_email),
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name),
      now(), now(), false, null,
      '', '', '', '', '', '', '', ''
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data,
      provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      lower(p_email), v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', lower(p_email)),
      'email', now(), now(), now()
    );
  END IF;

  INSERT INTO profiles (id, email, first_name, last_name)
  VALUES (v_user_id, lower(p_email), p_first_name, p_last_name)
  ON CONFLICT (id) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name  = COALESCE(EXCLUDED.last_name,  profiles.last_name);

  SELECT id INTO v_office_id FROM offices WHERE name = p_office_name LIMIT 1;
  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Office role not found: %', p_office_name;
  END IF;

  SELECT id INTO v_membership_id
  FROM memberships
  WHERE profile_id = v_user_id AND school_id = p_school_id AND office_id = v_office_id
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    INSERT INTO memberships (profile_id, school_id, office_id, is_active)
    VALUES (v_user_id, p_school_id, v_office_id, true)
    RETURNING id INTO v_membership_id;
  ELSE
    UPDATE memberships SET is_active = true WHERE id = v_membership_id;
  END IF;

  RETURN jsonb_build_object(
    'profile_id',    v_user_id,
    'membership_id', v_membership_id,
    'is_new_user',   v_is_new,
    'temp_password', CASE WHEN v_is_new THEN v_password ELSE NULL END,
    'email',         lower(p_email)
  );
END;
$function$;

SELECT 'phase25 done' AS status;
