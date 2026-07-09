-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 1 MIGRATION
-- Academic Calendar · Classes · Attendance · Fees · Guardians
-- ═══════════════════════════════════════════════════════════

-- ── K12 Academic Calendar ────────────────────────────────────

CREATE TABLE IF NOT EXISTS k12_academic_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,           -- "2024/2025"
  start_date  DATE,
  end_date    DATE,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS k12_terms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES k12_academic_sessions(id) ON DELETE CASCADE,
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  term_number  INT NOT NULL CHECK (term_number IN (1, 2, 3)),
  label        TEXT NOT NULL,           -- "First Term"
  start_date   DATE,
  end_date     DATE,
  is_active    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, term_number)
);

-- ── K12 Class & Subject Structure ────────────────────────────

CREATE TABLE IF NOT EXISTS k12_classes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,   -- "JSS 1A", "Primary 3B"
  stage                      TEXT NOT NULL,
  class_teacher_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS k12_subjects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,   -- "Mathematics", "English Language"
  stage      TEXT,            -- NULL = applies to all stages
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- Link learner enrollments to a class
ALTER TABLE learner_enrollments
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES k12_classes(id) ON DELETE SET NULL;

-- ── Attendance ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES learner_enrollments(id) ON DELETE CASCADE,
  class_id      UUID REFERENCES k12_classes(id) ON DELETE SET NULL,
  term_id       UUID REFERENCES k12_terms(id) ON DELETE SET NULL,
  date          DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note          TEXT,
  recorded_by   UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, date)
);

-- ── Fee Structures & Invoicing ───────────────────────────────

CREATE TABLE IF NOT EXISTS fee_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,   -- "School Fees", "Development Levy", "PTA"
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES fee_categories(id) ON DELETE CASCADE,
  term_id     UUID REFERENCES k12_terms(id) ON DELETE SET NULL,
  stage       TEXT,            -- NULL = applies to all stages
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  enrollment_id     UUID NOT NULL REFERENCES learner_enrollments(id) ON DELETE CASCADE,
  fee_structure_id  UUID REFERENCES fee_structures(id) ON DELETE SET NULL,
  description       TEXT NOT NULL,
  amount_due        NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status            TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (status IN ('unpaid','partial','paid','waived')),
  due_date          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
  school_id      UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  receipt_ref    TEXT NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  recorded_by    UUID REFERENCES memberships(id) ON DELETE SET NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: keep invoice status in sync after each payment
CREATE OR REPLACE FUNCTION sync_invoice_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_due  NUMERIC;
  v_paid NUMERIC;
BEGIN
  SELECT amount_due INTO v_due FROM fee_invoices WHERE id = NEW.invoice_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM fee_payments WHERE invoice_id = NEW.invoice_id;

  UPDATE fee_invoices SET
    amount_paid = v_paid,
    status = CASE
      WHEN v_paid <= 0       THEN 'unpaid'
      WHEN v_paid < v_due    THEN 'partial'
      ELSE                        'paid'
    END
  WHERE id = NEW.invoice_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice ON fee_payments;
CREATE TRIGGER trg_sync_invoice
  AFTER INSERT OR UPDATE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_status();

-- ── Guardians & Parent Links ─────────────────────────────────

CREATE TABLE IF NOT EXISTS guardians (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT UNIQUE,
  phone      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardian_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id  UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  learner_id   UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'guardian',  -- father, mother, guardian, sibling
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, learner_id)
);

-- ── New capabilities ─────────────────────────────────────────

INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  -- head_teacher additions
  ('head_teacher', 'k12.session.create'),
  ('head_teacher', 'k12.session.activate'),
  ('head_teacher', 'k12.term.create'),
  ('head_teacher', 'k12.term.activate'),
  ('head_teacher', 'k12.class.manage'),
  ('head_teacher', 'k12.subject.manage'),
  ('head_teacher', 'attendance.view'),
  ('head_teacher', 'fee.structure.manage'),
  ('head_teacher', 'fee.invoice.generate'),
  ('head_teacher', 'fee.invoice.waive'),
  ('head_teacher', 'guardian.manage'),
  ('head_teacher', 'report_card.generate'),
  -- class_teacher additions
  ('class_teacher', 'attendance.record'),
  ('class_teacher', 'attendance.view'),
  -- bursar additions
  ('bursar', 'fee.structure.manage'),
  ('bursar', 'fee.invoice.generate'),
  ('bursar', 'fee.payment.record'),
  ('bursar', 'fee.invoice.waive')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

-- ── RLS Policies ─────────────────────────────────────────────

ALTER TABLE k12_academic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE k12_terms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE k12_classes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE k12_subjects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_structures        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians             ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_links        ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their school's data
CREATE POLICY "school_member_read_k12_sessions"  ON k12_academic_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_k12_terms"     ON k12_terms             FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_k12_classes"   ON k12_classes           FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_k12_subjects"  ON k12_subjects          FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_attendance"    ON attendance_records    FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_fee_cats"      ON fee_categories        FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_fee_structs"   ON fee_structures        FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_fee_invoices"  ON fee_invoices          FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_fee_payments"  ON fee_payments          FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_guardians"     ON guardians             FOR SELECT TO authenticated USING (true);
CREATE POLICY "school_member_read_guardian_links" ON guardian_links       FOR SELECT TO authenticated USING (true);

-- All writes go through flow_execute (SECURITY DEFINER) — no direct insert policies needed
