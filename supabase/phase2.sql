-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 2 MIGRATION
-- K12 Timetable · Course Registration · Notifications
-- ═══════════════════════════════════════════════════════════

-- ── K12 Timetable ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS k12_timetable_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  ordinal     INT NOT NULL,
  label       TEXT NOT NULL,
  start_time  TIME,
  end_time    TIME,
  is_break    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, ordinal)
);

CREATE TABLE IF NOT EXISTS k12_timetable_slots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id              UUID NOT NULL REFERENCES k12_classes(id) ON DELETE CASCADE,
  period_id             UUID NOT NULL REFERENCES k12_timetable_periods(id) ON DELETE CASCADE,
  day_of_week           INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  subject_id            UUID REFERENCES k12_subjects(id) ON DELETE SET NULL,
  teacher_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, period_id, day_of_week)
);

-- ── Notifications ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  school_id  UUID REFERENCES schools(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  type       TEXT NOT NULL DEFAULT 'info'
               CHECK (type IN ('info','success','warning','alert')),
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── New capabilities ─────────────────────────────────────────

INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  ('head_teacher',  'timetable.manage'),
  ('class_teacher', 'timetable.view'),
  ('school_admin',  'course.register'),
  ('school_admin',  'course.scores.enter'),
  ('exam_officer',  'course.scores.enter'),
  ('lecturer',      'course.scores.enter')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE k12_timetable_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE k12_timetable_slots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_member_read_periods"
  ON k12_timetable_periods FOR SELECT TO authenticated USING (true);

CREATE POLICY "school_member_read_slots"
  ON k12_timetable_slots FOR SELECT TO authenticated USING (true);

CREATE POLICY "user_read_own_notifications"
  ON notifications FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "user_update_own_notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (profile_id = auth.uid());
