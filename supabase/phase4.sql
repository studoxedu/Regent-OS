-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 4 MIGRATION
-- Messaging · CBT · Guardian Notifications · Online Payments
-- ═══════════════════════════════════════════════════════════

-- ── Two-way Messaging ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject         TEXT,
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, profile_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_participants_profile  ON conversation_participants (profile_id);

-- Keep conversations sorted by activity
CREATE OR REPLACE FUNCTION bump_conversation_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_conversation ON messages;
CREATE TRIGGER trg_bump_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_ts();

-- SECURITY DEFINER membership check (avoids recursive RLS on participants)
CREATE OR REPLACE FUNCTION is_conversation_participant(p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation_id AND profile_id = auth.uid()
  );
$$;

-- ── CBT (Computer-Based Testing) ─────────────────────────────

CREATE TABLE IF NOT EXISTS cbt_tests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  instructions     TEXT,
  offering_id      UUID REFERENCES course_offerings(id) ON DELETE SET NULL,  -- tertiary scope
  class_id         UUID REFERENCES k12_classes(id) ON DELETE SET NULL,       -- k12 scope
  subject_id       UUID REFERENCES k12_subjects(id) ON DELETE SET NULL,
  duration_minutes INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  show_results     BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cbt_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       UUID NOT NULL REFERENCES cbt_tests(id) ON DELETE CASCADE,
  ordinal       INT NOT NULL,
  prompt        TEXT NOT NULL,
  options       JSONB NOT NULL,          -- ["Option A", "Option B", ...]
  correct_index INT NOT NULL,
  marks         NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (marks > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, ordinal)
);

CREATE TABLE IF NOT EXISTS cbt_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id      UUID NOT NULL REFERENCES cbt_tests(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  student_id   UUID REFERENCES students(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  answers      JSONB,                    -- { question_id: chosen_index }
  score        NUMERIC(8,2),
  total        NUMERIC(8,2),
  UNIQUE (test_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_cbt_tests_school   ON cbt_tests (school_id, status);
CREATE INDEX IF NOT EXISTS idx_cbt_attempts_test  ON cbt_attempts (test_id);

-- Students fetch questions through this RPC only — the answer key
-- (correct_index) never leaves the server.
CREATE OR REPLACE FUNCTION cbt_fetch_test(p_test_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_test      cbt_tests%ROWTYPE;
  v_questions JSONB;
BEGIN
  SELECT * INTO v_test FROM cbt_tests WHERE id = p_test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Test not found'; END IF;
  IF v_test.status <> 'published' THEN RAISE EXCEPTION 'This test is not open'; END IF;
  IF v_test.starts_at IS NOT NULL AND now() < v_test.starts_at THEN RAISE EXCEPTION 'This test has not started yet'; END IF;
  IF v_test.ends_at   IS NOT NULL AND now() > v_test.ends_at   THEN RAISE EXCEPTION 'This test window has closed'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'ordinal', q.ordinal, 'prompt', q.prompt,
    'options', q.options, 'marks', q.marks
  ) ORDER BY q.ordinal), '[]'::jsonb)
  INTO v_questions
  FROM cbt_questions q WHERE q.test_id = p_test_id;

  RETURN jsonb_build_object(
    'id', v_test.id,
    'title', v_test.title,
    'instructions', v_test.instructions,
    'duration_minutes', v_test.duration_minutes,
    'show_results', v_test.show_results,
    'questions', v_questions
  );
END;
$$;

CREATE OR REPLACE FUNCTION cbt_start_attempt(p_test_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_test       cbt_tests%ROWTYPE;
  v_attempt    cbt_attempts%ROWTYPE;
  v_student_id UUID;
BEGIN
  SELECT * INTO v_test FROM cbt_tests WHERE id = p_test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Test not found'; END IF;
  IF v_test.status <> 'published' THEN RAISE EXCEPTION 'This test is not open'; END IF;
  IF v_test.starts_at IS NOT NULL AND now() < v_test.starts_at THEN RAISE EXCEPTION 'This test has not started yet'; END IF;
  IF v_test.ends_at   IS NOT NULL AND now() > v_test.ends_at   THEN RAISE EXCEPTION 'This test window has closed'; END IF;

  SELECT * INTO v_attempt FROM cbt_attempts
  WHERE test_id = p_test_id AND profile_id = auth.uid();

  IF FOUND THEN
    IF v_attempt.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'You have already submitted this test';
    END IF;
    RETURN jsonb_build_object('attempt_id', v_attempt.id, 'started_at', v_attempt.started_at);
  END IF;

  SELECT id INTO v_student_id FROM students WHERE auth_user_id = auth.uid();

  INSERT INTO cbt_attempts (test_id, profile_id, student_id)
  VALUES (p_test_id, auth.uid(), v_student_id)
  RETURNING * INTO v_attempt;

  RETURN jsonb_build_object('attempt_id', v_attempt.id, 'started_at', v_attempt.started_at);
END;
$$;

-- Grades server-side; answers arrive as { question_id: chosen_index }.
CREATE OR REPLACE FUNCTION cbt_submit_attempt(p_attempt_id UUID, p_answers JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_attempt cbt_attempts%ROWTYPE;
  v_test    cbt_tests%ROWTYPE;
  v_score   NUMERIC := 0;
  v_total   NUMERIC := 0;
  q         RECORD;
  v_choice  INT;
BEGIN
  SELECT * INTO v_attempt FROM cbt_attempts
  WHERE id = p_attempt_id AND profile_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found'; END IF;
  IF v_attempt.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'This attempt was already submitted'; END IF;

  SELECT * INTO v_test FROM cbt_tests WHERE id = v_attempt.test_id;

  FOR q IN SELECT id, correct_index, marks FROM cbt_questions WHERE test_id = v_attempt.test_id LOOP
    v_total  := v_total + q.marks;
    v_choice := NULLIF(p_answers ->> q.id::text, '')::INT;
    IF v_choice IS NOT NULL AND v_choice = q.correct_index THEN
      v_score := v_score + q.marks;
    END IF;
  END LOOP;

  UPDATE cbt_attempts
  SET submitted_at = now(), answers = p_answers, score = v_score, total = v_total
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('score', v_score, 'total', v_total, 'show_results', v_test.show_results);
END;
$$;

GRANT EXECUTE ON FUNCTION cbt_fetch_test(UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION cbt_start_attempt(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION cbt_submit_attempt(UUID,JSONB) TO authenticated;

-- ── Guardian Notifications (attendance alerts etc.) ──────────

CREATE TABLE IF NOT EXISTS guardian_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  school_id   UUID REFERENCES schools(id) ON DELETE CASCADE,
  learner_id  UUID REFERENCES learners(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT NOT NULL DEFAULT 'info'
                CHECK (type IN ('info','success','warning','alert')),
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_notifications ON guardian_notifications (guardian_id, created_at DESC);

-- ── Online Payments (Paystack) ───────────────────────────────

CREATE TABLE IF NOT EXISTS payment_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID REFERENCES schools(id) ON DELETE CASCADE,
  invoice_id        UUID REFERENCES fee_invoices(id) ON DELETE SET NULL,
  student_id        UUID REFERENCES students(id) ON DELETE SET NULL,
  profile_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL DEFAULT 'paystack',
  reference         TEXT NOT NULL UNIQUE,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency          TEXT NOT NULL DEFAULT 'NGN',
  status            TEXT NOT NULL DEFAULT 'initialized'
                      CHECK (status IN ('initialized','success','failed','abandoned')),
  authorization_url TEXT,
  paid_at           TIMESTAMPTZ,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_invoice ON payment_transactions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_profile ON payment_transactions (profile_id);

-- ── New capabilities ─────────────────────────────────────────

INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  ('head_teacher',  'cbt.manage'),
  ('class_teacher', 'cbt.manage'),
  ('school_admin',  'cbt.manage'),
  ('exam_officer',  'cbt.manage'),
  ('lecturer',      'cbt.manage'),
  ('bursar',        'payment.online.view'),
  ('finance_officer','payment.online.view')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_tests                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_questions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_attempts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions      ENABLE ROW LEVEL SECURITY;

-- Messaging: participants only
CREATE POLICY "participant_read_conversations" ON conversations
  FOR SELECT TO authenticated
  USING (is_conversation_participant(id));

CREATE POLICY "user_create_conversations" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "participant_read_participants" ON conversation_participants
  FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id));

CREATE POLICY "creator_add_participants" ON conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.created_by = auth.uid())
  );

CREATE POLICY "participant_update_own_read_marker" ON conversation_participants
  FOR UPDATE TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "participant_read_messages" ON messages
  FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id));

CREATE POLICY "participant_send_messages" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_profile_id = auth.uid() AND is_conversation_participant(conversation_id));

-- CBT: tests are listable; the answer key (cbt_questions) is only
-- directly readable by the test author — students go through RPCs.
CREATE POLICY "auth_read_cbt_tests" ON cbt_tests
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "author_write_cbt_tests" ON cbt_tests
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "author_update_cbt_tests" ON cbt_tests
  FOR UPDATE TO authenticated USING (created_by = auth.uid());

CREATE POLICY "author_delete_cbt_tests" ON cbt_tests
  FOR DELETE TO authenticated USING (created_by = auth.uid());

CREATE POLICY "author_read_cbt_questions" ON cbt_questions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM cbt_tests t WHERE t.id = test_id AND t.created_by = auth.uid()));

CREATE POLICY "author_write_cbt_questions" ON cbt_questions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM cbt_tests t WHERE t.id = test_id AND t.created_by = auth.uid()));

CREATE POLICY "author_update_cbt_questions" ON cbt_questions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM cbt_tests t WHERE t.id = test_id AND t.created_by = auth.uid()));

CREATE POLICY "author_delete_cbt_questions" ON cbt_questions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM cbt_tests t WHERE t.id = test_id AND t.created_by = auth.uid()));

-- Attempts: students see their own; authors see attempts on their tests.
-- Inserts/updates happen inside SECURITY DEFINER RPCs only.
CREATE POLICY "own_or_author_read_attempts" ON cbt_attempts
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM cbt_tests t WHERE t.id = test_id AND t.created_by = auth.uid())
  );

-- Guardian notifications: staff write, the linked guardian reads.
CREATE POLICY "staff_insert_guardian_notifications" ON guardian_notifications
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "guardian_read_own_notifications" ON guardian_notifications
  FOR SELECT TO authenticated
  USING (
    guardian_id IN (SELECT id FROM guardians WHERE email = (auth.jwt() ->> 'email'))
  );

CREATE POLICY "guardian_mark_notifications_read" ON guardian_notifications
  FOR UPDATE TO authenticated
  USING (
    guardian_id IN (SELECT id FROM guardians WHERE email = (auth.jwt() ->> 'email'))
  );

-- Payment transactions: written only by edge functions (service role,
-- bypasses RLS); readable in-app following existing permissive style.
CREATE POLICY "auth_read_payment_transactions" ON payment_transactions
  FOR SELECT TO authenticated USING (true);
