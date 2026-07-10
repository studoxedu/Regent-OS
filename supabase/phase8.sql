-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 8 MIGRATION
-- Fix K-12 capability contract for the new offices
-- ═══════════════════════════════════════════════════════════
--
-- flow_execute authorises by matching capabilities.action to the exact
-- action string a page passes (learner.enroll, results.finalize, ...).
-- phase5 gave the new offices DESCRIPTIVE capability names
-- (enrollment.manage, result.manage, ...) that don't match those action
-- strings, so Enrollment, Transfers, and Results silently 403 for the
-- Registrar and Exam Officer. This grants the real action strings.
--
-- Also grants head_teacher 'results.finalize' — previously only
-- class_teacher held it, so a one-person school (Head Teacher only)
-- could not finalise results at all.

INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  -- Admissions & Records (Registrar): enrolment + transfers
  ('k12_registrar',    'learner.enroll'),
  ('k12_registrar',    'learner.transfer.initiate'),
  ('k12_registrar',    'learner.transfer.accept'),
  -- Exam Officer: finalise / reopen results
  ('k12_exam_officer', 'results.finalize'),
  ('k12_exam_officer', 'results.reopen'),
  -- Head Teacher must be able to finalise results (one-person school)
  ('head_teacher',     'results.finalize')
  -- (k12_registrar already holds the real 'learner.promote' from phase5)
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

SELECT 'phase8 done' AS status;
