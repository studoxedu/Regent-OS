-- ============================================================
-- Regent OS — Full Setup (run once in Supabase SQL Editor)
-- https://supabase.com → your project → SQL Editor → paste → Run
-- ============================================================

-- Audit sequence for human-readable refs
CREATE SEQUENCE IF NOT EXISTS audit_log_seq START 1;

-- ── school_groups ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ── schools ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schools (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid REFERENCES school_groups(id),
  name             text NOT NULL,
  stages_offered   text[] NOT NULL DEFAULT '{}',
  tier_id          text NOT NULL DEFAULT 'pilot',
  student_cap      int,
  modules_included text[] NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

-- ── education_levels ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS education_levels (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage   text NOT NULL,
  ordinal int  NOT NULL,
  label   text NOT NULL,
  UNIQUE(stage, ordinal)
);

INSERT INTO education_levels (stage, ordinal, label) VALUES
  ('nursery', 1, 'Nursery 1'), ('nursery', 2, 'Nursery 2'), ('nursery', 3, 'Nursery 3'),
  ('primary', 1, 'Primary 1'), ('primary', 2, 'Primary 2'), ('primary', 3, 'Primary 3'),
  ('primary', 4, 'Primary 4'), ('primary', 5, 'Primary 5'), ('primary', 6, 'Primary 6'),
  ('jss', 1, 'JSS 1'), ('jss', 2, 'JSS 2'), ('jss', 3, 'JSS 3'),
  ('sss', 1, 'SSS 1'), ('sss', 2, 'SSS 2'), ('sss', 3, 'SSS 3'),
  ('nd',  1, 'ND 1'),  ('nd',  2, 'ND 2'),
  ('hnd', 1, 'HND 1'), ('hnd', 2, 'HND 2'),
  ('nce', 1, 'NCE 1'), ('nce', 2, 'NCE 2'), ('nce', 3, 'NCE 3'),
  ('degree', 1, 'Year 1'), ('degree', 2, 'Year 2'), ('degree', 3, 'Year 3'),
  ('degree', 4, 'Year 4'), ('degree', 5, 'Year 5'), ('degree', 6, 'Year 6')
ON CONFLICT (stage, ordinal) DO NOTHING;

-- ── profiles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  first_name  text,
  last_name   text,
  global_role text
);

-- ── offices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  governance_mode text NOT NULL,
  description     text
);

INSERT INTO offices (name, governance_mode, description) VALUES
  ('school_admin',  'tertiary', 'School Administrator — full write access'),
  ('dean',          'tertiary', 'Dean — faculty-level oversight'),
  ('hod',           'tertiary', 'Head of Department — dept-level results chain'),
  ('exam_officer',  'tertiary', 'Exam Officer — verifies submitted results'),
  ('lecturer',      'tertiary', 'Lecturer — enters and submits course results'),
  ('student',       'tertiary', 'Student — read-only access to own results'),
  ('head_teacher',  'k12',      'Head Teacher / Principal — school-wide authority'),
  ('class_teacher', 'k12',      'Class Teacher — enters and finalises class results'),
  ('bursar',        'k12',      'Bursar / Admin Officer — records fee payments'),
  ('proprietor',    'group',    'Proprietor / Group Observer — read-only across group')
ON CONFLICT (name) DO NOTHING;

-- ── capabilities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS capabilities (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid REFERENCES offices(id) ON DELETE CASCADE,
  action    text NOT NULL,
  UNIQUE(office_id, action)
);

DO $$
DECLARE
  oid uuid;
BEGIN
  SELECT id INTO oid FROM offices WHERE name = 'school_admin';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'learner.enroll'), (oid, 'learner.transfer.initiate'), (oid, 'learner.transfer.accept'),
    (oid, 'results.approve'), (oid, 'results.publish'), (oid, 'results.reopen'),
    (oid, 'session.create'), (oid, 'staff.assign'), (oid, 'structure.manage')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'dean';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.approve'), (oid, 'results.publish')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'hod';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.approve')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'exam_officer';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.verify'), (oid, 'results.reject')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'lecturer';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.save_draft'), (oid, 'results.submit')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'head_teacher';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'learner.enroll'), (oid, 'learner.transfer.initiate'), (oid, 'learner.transfer.accept'),
    (oid, 'learner.promote'), (oid, 'results.reopen'), (oid, 'fee.record')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'class_teacher';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.finalize')
  ON CONFLICT DO NOTHING;

  SELECT id INTO oid FROM offices WHERE name = 'bursar';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'fee.record')
  ON CONFLICT DO NOTHING;
END $$;

-- ── memberships ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  school_id     uuid REFERENCES schools(id),
  group_id      uuid REFERENCES school_groups(id),
  office_id     uuid NOT NULL REFERENCES offices(id),
  department_id uuid,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT membership_scope CHECK (
    (school_id IS NOT NULL AND group_id IS NULL) OR
    (school_id IS NULL AND group_id IS NOT NULL)
  )
);

-- ── learners ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id    text UNIQUE NOT NULL,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  date_of_birth date,
  created_at    timestamptz DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS learner_id_seq START 1;

-- ── learner_enrollments ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS learner_enrollments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id                uuid NOT NULL REFERENCES learners(id),
  school_id                 uuid NOT NULL REFERENCES schools(id),
  stage                     text NOT NULL,
  entry_date                date NOT NULL DEFAULT CURRENT_DATE,
  exit_date                 date,
  status                    text NOT NULL DEFAULT 'active',
  guardian_consent_captured boolean NOT NULL DEFAULT false,
  guardian_consent_at       timestamptz,
  created_via_flow_id       uuid,
  created_at                timestamptz DEFAULT now(),
  CONSTRAINT enrollment_status CHECK (status IN ('active','transferred','graduated','withdrawn'))
);

-- ── audit_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_ref        text UNIQUE NOT NULL,
  school_id        uuid REFERENCES schools(id),
  action_type      text NOT NULL,
  actor_profile_id uuid REFERENCES profiles(id),
  actor_office     text NOT NULL,
  payload          jsonb,
  created_at       timestamptz DEFAULT now()
);

-- ── system_event ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_log_id  uuid NOT NULL REFERENCES audit_log(id),
  event_type    text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  delta         jsonb,
  created_at    timestamptz DEFAULT now()
);

-- ── Tertiary: structure ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS faculties (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name      text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id uuid NOT NULL REFERENCES faculties(id),
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  uuid NOT NULL REFERENCES departments(id),
  name           text NOT NULL,
  stage          text NOT NULL,
  duration_years int  NOT NULL DEFAULT 2
);

-- ── Tertiary: sessions & semesters ───────────────────────────
CREATE TABLE IF NOT EXISTS academic_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id),
  label      text NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semesters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES academic_sessions(id),
  label      text NOT NULL,
  ordinal    int  NOT NULL,
  is_active  boolean NOT NULL DEFAULT false
);

-- ── Tertiary: courses & offerings ────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  code          text NOT NULL,
  title         text NOT NULL,
  credit_units  int  NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS course_offerings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id              uuid NOT NULL REFERENCES courses(id),
  semester_id            uuid NOT NULL REFERENCES semesters(id),
  lecturer_membership_id uuid REFERENCES memberships(id),
  results_status         text NOT NULL DEFAULT 'draft',
  created_at             timestamptz DEFAULT now(),
  CONSTRAINT offering_status CHECK (
    results_status IN ('draft','submitted','verified','approved','published')
  )
);

CREATE TABLE IF NOT EXISTS course_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id   uuid NOT NULL REFERENCES course_offerings(id),
  enrollment_id uuid NOT NULL REFERENCES learner_enrollments(id),
  ca_score      numeric CHECK (ca_score >= 0 AND ca_score <= 40),
  exam_score    numeric CHECK (exam_score >= 0 AND exam_score <= 60),
  grade         text,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(offering_id, enrollment_id)
);

-- ── Grade scales ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grade_scales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id),
  min_score   numeric NOT NULL,
  max_score   numeric NOT NULL,
  grade       text    NOT NULL,
  grade_point numeric NOT NULL,
  description text
);

-- ── K12: term results ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS term_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id       uuid NOT NULL REFERENCES learner_enrollments(id),
  school_id           uuid NOT NULL REFERENCES schools(id),
  academic_session    text NOT NULL,
  term                int  NOT NULL CHECK (term IN (1, 2, 3)),
  education_level_id  uuid REFERENCES education_levels(id),
  scores              jsonb,
  status              text NOT NULL DEFAULT 'draft',
  finalized_at        timestamptz,
  created_via_flow_id uuid,
  created_at          timestamptz DEFAULT now()
);

-- ── K12: fee records ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id       uuid NOT NULL REFERENCES learner_enrollments(id),
  school_id           uuid NOT NULL REFERENCES schools(id),
  amount              numeric NOT NULL CHECK (amount > 0),
  description         text,
  academic_session    text,
  term                int,
  receipt_ref         text UNIQUE,
  recorded_at         timestamptz DEFAULT now(),
  created_via_flow_id uuid
);

-- ── Row-level security ────────────────────────────────────────
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools               ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_enrollments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_results          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_records           ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self ON profiles FOR ALL
  USING (id = auth.uid());

CREATE POLICY memberships_self ON memberships FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY audit_log_school_members ON audit_log FOR SELECT
  USING (
    school_id IN (
      SELECT school_id FROM memberships
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- Allow authenticated users to read schools (needed to load active school)
CREATE POLICY schools_members_read ON schools FOR SELECT
  USING (
    id IN (
      SELECT school_id FROM memberships
      WHERE profile_id = auth.uid() AND is_active = true AND school_id IS NOT NULL
    )
  );

-- Allow authenticated users to read learner_enrollments for their school
CREATE POLICY enrollments_school_members ON learner_enrollments FOR SELECT
  USING (
    school_id IN (
      SELECT school_id FROM memberships
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- Allow term_results read for school members
CREATE POLICY term_results_school_members ON term_results FOR SELECT
  USING (
    school_id IN (
      SELECT school_id FROM memberships
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- ── flow_execute — the only write path ───────────────────────
CREATE OR REPLACE FUNCTION flow_execute(
  p_action_type text,
  p_school_id   uuid,
  p_payload     jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id  uuid;
  v_membership  memberships%ROWTYPE;
  v_office_name text;
  v_has_cap     boolean;
  v_audit_id    uuid;
  v_audit_ref   text;
  v_result      jsonb := '{}';
  v_receipt_ref text;
  v_learner_id  text;
  v_enrollment  learner_enrollments%ROWTYPE;
  v_offering    course_offerings%ROWTYPE;
BEGIN
  v_profile_id := auth.uid();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT m.* INTO v_membership
  FROM memberships m
  WHERE m.profile_id = v_profile_id
    AND m.school_id = p_school_id
    AND m.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: no active membership at school %', p_school_id;
  END IF;

  SELECT o.name INTO v_office_name
  FROM offices o WHERE o.id = v_membership.office_id;

  SELECT EXISTS (
    SELECT 1 FROM capabilities c
    WHERE c.office_id = v_membership.office_id
      AND c.action = p_action_type
  ) INTO v_has_cap;

  IF NOT v_has_cap THEN
    RAISE EXCEPTION 'Forbidden: office "%" does not hold capability "%"',
      v_office_name, p_action_type;
  END IF;

  CASE p_action_type

    WHEN 'learner.enroll' THEN
      v_learner_id := 'STX-' || to_char(now(), 'YYYY') || '-' ||
                      lpad((nextval('learner_id_seq'))::text, 5, '0');

      WITH new_learner AS (
        INSERT INTO learners (learner_id, first_name, last_name, date_of_birth)
        VALUES (
          v_learner_id,
          p_payload->>'first_name',
          p_payload->>'last_name',
          (p_payload->>'date_of_birth')::date
        )
        RETURNING id
      )
      INSERT INTO learner_enrollments
        (learner_id, school_id, stage, guardian_consent_captured, guardian_consent_at)
      SELECT
        new_learner.id,
        p_school_id,
        p_payload->>'stage',
        COALESCE((p_payload->>'guardian_consent_captured')::boolean, false),
        CASE WHEN (p_payload->>'guardian_consent_captured')::boolean THEN now() END
      FROM new_learner
      RETURNING * INTO v_enrollment;

      v_result := jsonb_build_object(
        'learner_id', v_learner_id,
        'enrollment_id', v_enrollment.id,
        'entity_type', 'learner_enrollment',
        'entity_id', v_enrollment.id
      );

    WHEN 'results.finalize' THEN
      UPDATE term_results
      SET status = 'published', finalized_at = now(),
          scores = p_payload->'scores'
      WHERE enrollment_id = (p_payload->>'enrollment_id')::uuid
        AND academic_session = p_payload->>'academic_session'
        AND term = (p_payload->>'term')::int
        AND school_id = p_school_id;

      IF NOT FOUND THEN
        INSERT INTO term_results
          (enrollment_id, school_id, academic_session, term, scores, status, finalized_at)
        VALUES (
          (p_payload->>'enrollment_id')::uuid,
          p_school_id,
          p_payload->>'academic_session',
          (p_payload->>'term')::int,
          p_payload->'scores',
          'published',
          now()
        );
      END IF;

      v_result := jsonb_build_object(
        'entity_type', 'term_result',
        'enrollment_id', p_payload->>'enrollment_id'
      );

    WHEN 'results.reopen' THEN
      UPDATE term_results
      SET status = 'draft', finalized_at = null
      WHERE enrollment_id = (p_payload->>'enrollment_id')::uuid
        AND academic_session = p_payload->>'academic_session'
        AND term = (p_payload->>'term')::int
        AND school_id = p_school_id;

      v_result := jsonb_build_object(
        'entity_type', 'term_result',
        'correction_note', p_payload->>'correction_note'
      );

    WHEN 'results.submit' THEN
      UPDATE course_offerings
      SET results_status = 'submitted'
      WHERE id = (p_payload->>'offering_id')::uuid
        AND results_status = 'draft'
      RETURNING * INTO v_offering;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Offering not found or not in draft status';
      END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id', v_offering.id);

    WHEN 'results.verify' THEN
      UPDATE course_offerings SET results_status = 'verified'
      WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'submitted';
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.approve' THEN
      UPDATE course_offerings SET results_status = 'approved'
      WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'verified';
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.publish' THEN
      UPDATE course_offerings SET results_status = 'published'
      WHERE id = (p_payload->>'offering_id')::uuid AND results_status = 'approved';
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid);

    WHEN 'results.reject' THEN
      UPDATE course_offerings SET results_status = 'draft'
      WHERE id = (p_payload->>'offering_id')::uuid;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id',(p_payload->>'offering_id')::uuid,'rejection_note',p_payload->>'rejection_note');

    WHEN 'fee.record' THEN
      v_receipt_ref := 'RCP-' || lpad((nextval('audit_log_seq'))::text, 5, '0');
      INSERT INTO fee_records
        (enrollment_id, school_id, amount, description, academic_session, term, receipt_ref)
      VALUES (
        (p_payload->>'enrollment_id')::uuid,
        p_school_id,
        (p_payload->>'amount')::numeric,
        p_payload->>'description',
        p_payload->>'academic_session',
        (p_payload->>'term')::int,
        v_receipt_ref
      );
      v_result := jsonb_build_object(
        'receipt_ref', v_receipt_ref,
        'entity_type', 'fee_record'
      );

    WHEN 'learner.promote' THEN
      UPDATE learner_enrollments le
      SET stage = (
        SELECT el2.stage || ':' || el2.ordinal::text
        FROM education_levels el1
        JOIN education_levels el2
          ON el2.stage = el1.stage AND el2.ordinal = el1.ordinal + 1
        WHERE el1.stage = le.stage
        LIMIT 1
      )
      WHERE le.school_id = p_school_id
        AND le.stage = p_payload->>'stage'
        AND le.status = 'active';

      v_result := jsonb_build_object('entity_type','learner_enrollment','stage',p_payload->>'stage');

    WHEN 'learner.transfer.initiate' THEN
      UPDATE learner_enrollments
      SET status = 'transferred', exit_date = CURRENT_DATE
      WHERE id = (p_payload->>'enrollment_id')::uuid
        AND school_id = p_school_id;

      v_result := jsonb_build_object(
        'entity_type', 'learner_enrollment',
        'entity_id',   (p_payload->>'enrollment_id')::uuid,
        'destination', p_payload->>'destination_school_id'
      );

    ELSE
      RAISE EXCEPTION 'Unknown action type: %', p_action_type;
  END CASE;

  v_audit_ref := 'AUD-' || to_char(now(), 'YYYYMMDD') || '-' ||
                 lpad((nextval('audit_log_seq'))::text, 4, '0');

  INSERT INTO audit_log
    (audit_ref, school_id, action_type, actor_profile_id, actor_office, payload)
  VALUES
    (v_audit_ref, p_school_id, p_action_type, v_profile_id, v_office_name, p_payload)
  RETURNING id INTO v_audit_id;

  INSERT INTO system_event (audit_log_id, event_type, entity_type, entity_id, delta)
  VALUES (
    v_audit_id,
    p_action_type,
    COALESCE(v_result->>'entity_type', 'unknown'),
    (v_result->>'entity_id')::uuid,
    v_result
  );

  RETURN jsonb_build_object(
    'ok',        true,
    'audit_ref', v_audit_ref,
    'action',    p_action_type,
    'result',    v_result
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION flow_execute FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow_execute TO authenticated;

-- ── Auto-create profile on signup ─────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
