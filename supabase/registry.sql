-- ═══════════════════════════════════════════════════════════════════════════
-- REGENTOS TERTIARY — PHASE 1: REGISTRY
-- ═══════════════════════════════════════════════════════════════════════════
-- K12 (SchoolMasterPro) tables are UNTOUCHED.
-- This migration only adds to / creates new tables for the tertiary Registry.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Institution: add configurable identity columns ───────────────────────
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS code               TEXT,
  ADD COLUMN IF NOT EXISTS reg_number_pattern TEXT DEFAULT '{CODE}/{YEAR}/{DEPT}/{SEQ}';

-- ── Faculties / Departments: add short codes ─────────────────────────────
ALTER TABLE faculties    ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE departments  ADD COLUMN IF NOT EXISTS code TEXT;

-- ── Canonical tertiary student record ────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id       UUID        NOT NULL REFERENCES schools(id)              ON DELETE RESTRICT,
  reg_number           TEXT        NOT NULL,
  first_name           TEXT        NOT NULL,
  last_name            TEXT        NOT NULL,
  middle_name          TEXT,
  date_of_birth        DATE,
  gender               TEXT        CHECK (gender IN ('male','female','other')),
  phone                TEXT,
  personal_email       TEXT,
  department_id        UUID        REFERENCES departments(id)                   ON DELETE RESTRICT,
  programme            TEXT        NOT NULL
                                   CHECK (programme IN ('nd','hnd','nce','degree','pgd','masters','phd')),
  admission_session_id UUID        REFERENCES academic_sessions(id)             ON DELETE RESTRICT,
  status               TEXT        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','suspended','graduated','withdrawn','deferred')),
  auth_user_id         UUID        REFERENCES auth.users(id)                    ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, reg_number)
);

-- ── Formal, immutable admission event ───────────────────────────────────
CREATE TABLE IF NOT EXISTS admissions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           UUID        NOT NULL REFERENCES students(id)             ON DELETE RESTRICT,
  institution_id       UUID        NOT NULL REFERENCES schools(id)              ON DELETE RESTRICT,
  session_id           UUID        NOT NULL REFERENCES academic_sessions(id)    ON DELETE RESTRICT,
  programme            TEXT        NOT NULL,
  department_id        UUID        REFERENCES departments(id),
  admitted_by_user_id  UUID        NOT NULL REFERENCES profiles(id)             ON DELETE RESTRICT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  -- flow_log_id added in Phase 2
);

-- ── Per-institution reg number sequence counter ──────────────────────────
CREATE TABLE IF NOT EXISTS reg_sequences (
  institution_id  UUID    NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  dept_code       TEXT    NOT NULL DEFAULT '',
  last_seq        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (institution_id, year, dept_code)
);

-- ── course_registrations: add student_id for tertiary ────────────────────
-- K12 rows continue to use enrollment_id. Tertiary rows use student_id.
ALTER TABLE course_registrations
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trig_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS students_set_updated_at ON students;
CREATE TRIGGER students_set_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION trig_set_updated_at();

-- ── Reg number generation ────────────────────────────────────────────────
-- Atomically increments the per-institution/year/dept counter and
-- substitutes tokens into the institution's configured pattern.
-- Tokens: {CODE} {YEAR} {DEPT} {SEQ}
CREATE OR REPLACE FUNCTION generate_reg_number(
  p_institution_id  UUID,
  p_year            INTEGER,
  p_dept_code       TEXT DEFAULT ''
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
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
$$;

-- ── Student creation: atomic, credential-generating ──────────────────────
-- Called by the Registrar UI. Creates auth user + student record + admission
-- in one transaction. Returns reg_number and temp_password to display once.
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
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  -- Create Supabase auth user
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

  -- Matching profile row (required for RLS and display)
  INSERT INTO profiles (id, email, first_name, last_name)
  VALUES (v_auth_user_id, v_email, p_first_name, p_last_name)
  ON CONFLICT (id) DO NOTHING;

  -- Student canonical record
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

  -- Immutable admission record
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
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE students      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reg_sequences ENABLE ROW LEVEL SECURITY;

-- Phase 1: authenticated read/write (tightened to office-only in Phase 2)
CREATE POLICY IF NOT EXISTS "students_read"   ON students   FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "students_insert" ON students   FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "students_update" ON students   FOR UPDATE TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "admissions_read"   ON admissions FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "admissions_insert" ON admissions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "reg_seq_all" ON reg_sequences FOR ALL TO authenticated USING (true);

-- Students can read their own record (for Layer 4, Phase 7)
CREATE POLICY IF NOT EXISTS "students_own_read"
  ON students FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());
