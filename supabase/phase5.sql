-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 5 MIGRATION
-- K-12 office split: Exam Officer + Admissions & Records (Registrar)
-- ═══════════════════════════════════════════════════════════
--
-- The Head Teacher keeps school-wide authority (a one-person school
-- just uses that single office). Larger schools additionally seed the
-- specialised offices below, each scoped to its own sidebar sections.
--
-- exam_officer / registrar already exist as tertiary offices and
-- offices.name is UNIQUE, so K-12 uses distinct k12_-prefixed names —
-- the app also routes K-12 vs tertiary by office name.

INSERT INTO offices (name, governance_mode, description) VALUES
  ('k12_exam_officer', 'k12', 'Exam Officer — results, report cards, CBT'),
  ('k12_registrar',    'k12', 'Admissions & Records — enrollment, transfers, promotion, guardians')
ON CONFLICT (name) DO NOTHING;

-- ── Capabilities ─────────────────────────────────────────────
-- NOTE: many K-12 pages currently write directly (not via
-- flow_execute), so these rows are documentation-grade for now — the
-- enforced boundary is the office-based sidebar filtering. They are
-- here so the model is coherent once writes move behind flow_execute.

INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  -- Exam Officer
  ('k12_exam_officer', 'result.manage'),
  ('k12_exam_officer', 'report_card.generate'),
  ('k12_exam_officer', 'cbt.manage'),
  ('k12_exam_officer', 'attendance.view'),
  -- Admissions & Records (Registrar)
  ('k12_registrar',    'enrollment.manage'),
  ('k12_registrar',    'learner.transfer'),
  ('k12_registrar',    'learner.promote'),
  ('k12_registrar',    'guardian.manage'),
  ('k12_registrar',    'admission.manage'),
  -- Keep Head Teacher a superset of every specialised office
  ('head_teacher',     'result.manage'),
  ('head_teacher',     'enrollment.manage'),
  ('head_teacher',     'learner.transfer'),
  ('head_teacher',     'learner.promote'),
  ('head_teacher',     'admission.manage')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;
