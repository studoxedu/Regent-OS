-- ============================================================
-- Regent OS — Core Schema
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
  tier_id          text NOT NULL DEFAULT 'pilot',  -- 'pilot' | 'standard'
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

-- Seed education levels
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
  global_role text  -- 'super_admin' only; null for all other users
);

-- ── offices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  governance_mode text NOT NULL,  -- 'k12' | 'tertiary' | 'group'
  description     text
);

-- Seed offices
INSERT INTO offices (name, governance_mode, description) VALUES
  -- Tertiary
  ('school_admin',  'tertiary', 'School Administrator — full write access'),
  ('dean',          'tertiary', 'Dean — faculty-level oversight'),
  ('hod',           'tertiary', 'Head of Department — dept-level results chain'),
  ('exam_officer',  'tertiary', 'Exam Officer — verifies submitted results'),
  ('lecturer',      'tertiary', 'Lecturer — enters and submits course results'),
  ('student',       'tertiary', 'Student — read-only access to own results'),
  -- K12
  ('head_teacher',  'k12',      'Head Teacher / Principal — school-wide authority'),
  ('class_teacher', 'k12',      'Class Teacher — enters and finalises class results'),
  ('bursar',        'k12',      'Bursar / Admin Officer — records fee payments'),
  -- Group
  ('proprietor',    'group',    'Proprietor / Group Observer — read-only across group')
ON CONFLICT (name) DO NOTHING;

-- ── capabilities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS capabilities (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid REFERENCES offices(id) ON DELETE CASCADE,
  action    text NOT NULL,
  UNIQUE(office_id, action)
);

-- Seed capabilities
DO $$
DECLARE
  oid uuid;
BEGIN
  -- school_admin (tertiary)
  SELECT id INTO oid FROM offices WHERE name = 'school_admin';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'learner.enroll'), (oid, 'learner.transfer.initiate'), (oid, 'learner.transfer.accept'),
    (oid, 'results.approve'), (oid, 'results.publish'), (oid, 'results.reopen'),
    (oid, 'session.create'), (oid, 'staff.assign'), (oid, 'structure.manage')
  ON CONFLICT DO NOTHING;

  -- dean
  SELECT id INTO oid FROM offices WHERE name = 'dean';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.approve'), (oid, 'results.publish')
  ON CONFLICT DO NOTHING;

  -- hod
  SELECT id INTO oid FROM offices WHERE name = 'hod';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.approve')
  ON CONFLICT DO NOTHING;

  -- exam_officer
  SELECT id INTO oid FROM offices WHERE name = 'exam_officer';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.verify'), (oid, 'results.reject')
  ON CONFLICT DO NOTHING;

  -- lecturer
  SELECT id INTO oid FROM offices WHERE name = 'lecturer';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.save_draft'), (oid, 'results.submit')
  ON CONFLICT DO NOTHING;

  -- head_teacher (k12)
  SELECT id INTO oid FROM offices WHERE name = 'head_teacher';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'learner.enroll'), (oid, 'learner.transfer.initiate'), (oid, 'learner.transfer.accept'),
    (oid, 'learner.promote'), (oid, 'results.reopen'), (oid, 'fee.record')
  ON CONFLICT DO NOTHING;

  -- class_teacher (k12)
  SELECT id INTO oid FROM offices WHERE name = 'class_teacher';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'results.finalize')
  ON CONFLICT DO NOTHING;

  -- bursar (k12)
  SELECT id INTO oid FROM offices WHERE name = 'bursar';
  INSERT INTO capabilities (office_id, action) VALUES
    (oid, 'fee.record')
  ON CONFLICT DO NOTHING;

  -- proprietor — no write capabilities (structurally)
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
  -- Either school_id OR group_id must be set
  CONSTRAINT membership_scope CHECK (
    (school_id IS NOT NULL AND group_id IS NULL) OR
    (school_id IS NULL AND group_id IS NOT NULL)
  )
);

-- ── learners ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id    text UNIQUE NOT NULL,  -- STX-YYYY-NNNNN
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
  status                    text NOT NULL DEFAULT 'active',  -- active|transferred|graduated|withdrawn
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
  label      text NOT NULL,  -- '2024/2025'
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
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id             uuid NOT NULL REFERENCES courses(id),
  semester_id           uuid NOT NULL REFERENCES semesters(id),
  lecturer_membership_id uuid REFERENCES memberships(id),
  results_status        text NOT NULL DEFAULT 'draft',
  created_at            timestamptz DEFAULT now(),
  CONSTRAINT offering_status CHECK (
    results_status IN ('draft','submitted','verified','approved','published')
  )
);

CREATE TABLE IF NOT EXISTS course_registrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  uuid NOT NULL REFERENCES course_offerings(id),
  enrollment_id uuid NOT NULL REFERENCES learner_enrollments(id),
  ca_score     numeric CHECK (ca_score >= 0 AND ca_score <= 40),
  exam_score   numeric CHECK (exam_score >= 0 AND exam_score <= 60),
  grade        text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE(offering_id, enrollment_id)
);

-- ── Grade scales ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grade_scales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id),
  min_score   numeric NOT NULL,
  max_score   numeric NOT NULL,
  grade       text    NOT NULL,
  grade_point numeric NOT NULL,
  description text
);

-- ── K12: term results ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS term_results (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id      uuid NOT NULL REFERENCES learner_enrollments(id),
  school_id          uuid NOT NULL REFERENCES schools(id),
  academic_session   text NOT NULL,
  term               int  NOT NULL CHECK (term IN (1, 2, 3)),
  education_level_id uuid REFERENCES education_levels(id),
  scores             jsonb,
  status             text NOT NULL DEFAULT 'draft',
  finalized_at       timestamptz,
  created_via_flow_id uuid,
  created_at         timestamptz DEFAULT now()
);

-- ── K12: fee records ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    uuid NOT NULL REFERENCES learner_enrollments(id),
  school_id        uuid NOT NULL REFERENCES schools(id),
  amount           numeric NOT NULL CHECK (amount > 0),
  description      text,
  academic_session text,
  term             int,
  receipt_ref      text UNIQUE,
  recorded_at      timestamptz DEFAULT now(),
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

-- Profiles: own row only
CREATE POLICY profiles_self ON profiles FOR ALL
  USING (id = auth.uid());

-- Memberships: own memberships
CREATE POLICY memberships_self ON memberships FOR SELECT
  USING (profile_id = auth.uid());

-- Audit log: visible to members of that school
CREATE POLICY audit_log_school_members ON audit_log FOR SELECT
  USING (
    school_id IN (
      SELECT school_id FROM memberships
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );
