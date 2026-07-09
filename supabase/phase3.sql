-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 3 MIGRATION
-- Staff Profiles · Payroll · Library · Announcements
-- ═══════════════════════════════════════════════════════════

-- ── Salary Grades (must come before staff_profiles) ──────────

CREATE TABLE IF NOT EXISTS salary_grades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  basic_pay   NUMERIC(12,2) NOT NULL CHECK (basic_pay >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- ── Staff Profiles (HR data attached to a membership) ────────

CREATE TABLE IF NOT EXISTS staff_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id    UUID NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  designation      TEXT,
  qualification    TEXT,
  employment_type  TEXT NOT NULL DEFAULT 'full_time'
                     CHECK (employment_type IN ('full_time','part_time','contract')),
  salary_grade_id  UUID REFERENCES salary_grades(id) ON DELETE SET NULL,
  start_date       DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Payroll ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','approved','paid')),
  created_by  UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, month)
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  membership_id     UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  basic_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_allowances  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, membership_id)
);

-- ── Library ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS library_books (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  author           TEXT,
  isbn             TEXT,
  category         TEXT,
  total_copies     INT NOT NULL DEFAULT 1 CHECK (total_copies >= 1),
  available_copies INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_borrows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  book_id       UUID NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  borrower_name TEXT NOT NULL,
  borrowed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date      DATE NOT NULL,
  returned_at   TIMESTAMPTZ,
  is_returned   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Announcements ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS announcements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  audience              TEXT NOT NULL DEFAULT 'all'
                          CHECK (audience IN ('all','staff','students','parents')),
  author_membership_id  UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────────

ALTER TABLE salary_grades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_books    ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_borrows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_salary_grades"   ON salary_grades   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_staff_profiles"  ON staff_profiles  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_payroll_runs"    ON payroll_runs    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_payroll_entries" ON payroll_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_library_books"   ON library_books   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_library_borrows" ON library_borrows FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_announcements"   ON announcements   FOR SELECT TO authenticated USING (true);
