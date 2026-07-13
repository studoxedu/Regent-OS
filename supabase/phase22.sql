-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 22 MIGRATION
-- Fix: learner.promote corrupts learner_enrollments.stage
-- ═══════════════════════════════════════════════════════════
--
-- flow_execute's 'learner.promote' branch does:
--   SET stage = (SELECT el2.stage || ':' || el2.ordinal::text
--                FROM education_levels el1 JOIN education_levels el2
--                  ON el2.stage = el1.stage AND el2.ordinal = el1.ordinal + 1
--                WHERE el1.stage = le.stage LIMIT 1)
-- education_levels models WITHIN-stage year levels (jss: 1,2,3 / sss:
-- 1,2,3 / etc — checked live, 29 rows across all 8 K-12/tertiary stages).
-- The self-join on el2.stage = el1.stage finds the next ORDINAL in the
-- SAME stage, then concatenates it onto the stage name — producing
-- values like "jss:2". But learner_enrollments.stage is used everywhere
-- else in the app (K12_STAGES/STAGE_LABELS in src/lib/utils.ts +
-- roles.ts, Enrollment, Attendance, Results, ReportCards, Fees,
-- school.stages_offered, ...) as exactly one of the four literal values
-- 'nursery'|'primary'|'jss'|'sss' — there is no ordinal/year-level
-- column anywhere on learner_enrollments, and nothing else in the
-- codebase reads education_levels at all. The within-stage-year design
-- education_levels implies was never actually wired up anywhere;
-- "learner.promote" is the only caller, and it's broken.
--
-- Reproduced live: promoting a JSS 1A class of 2 test learners on
-- QA Test Secondary School set both their stage to the literal string
-- "jss:2" — an invalid value that then made them disappear from every
-- stage-filtered view (Attendance, Report Cards, the Promotion page's
-- own counts). The Promotion page's own UI describes this as "a logged,
-- irreversible action" — the first real school to use this feature
-- would have permanently corrupted their active learners' stage data.
-- Confirmed live that no real school has triggered this yet — only this
-- session's own test data was affected.
--
-- Fix: promote learners to the next COARSE stage (nursery -> primary ->
-- jss -> sss), matching what the rest of the app actually expects. This
-- does NOT restore the within-stage year granularity education_levels
-- seems to have been designed for — that would need a real schema
-- addition (e.g. a year_level column on learner_enrollments) and UI
-- changes across every stage-aware page, which is a larger product
-- decision, not a one-line query fix. Flagging it rather than guessing
-- at that larger redesign.
--
-- IMPORTANT: flow_execute is the governed write path for the whole
-- platform (enrollment, results pipeline for both K-12 and tertiary,
-- fees, transfers). The function body below is the *exact* live
-- definition (pulled via pg_get_functiondef immediately before writing
-- this migration) with only the learner.promote CASE branch changed —
-- verified programmatically as a single verbatim string replacement,
-- not retyped from memory or reconstructed from a partial file read.
-- Every other branch (learner.enroll, results.finalize/reopen/submit/
-- verify/approve/publish/reject, fee.record, learner.transfer.initiate,
-- the audit_log + system_event bookkeeping) is untouched.

CREATE OR REPLACE FUNCTION next_k12_stage(p_stage TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stage
    WHEN 'nursery' THEN 'primary'
    WHEN 'primary' THEN 'jss'
    WHEN 'jss'     THEN 'sss'
    ELSE NULL  -- sss (or anything else) has no next K-12 stage; promotion is a no-op
  END
$$;

CREATE OR REPLACE FUNCTION public.flow_execute(p_action_type text, p_school_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
      SET stage = next_k12_stage(le.stage)
      WHERE le.school_id = p_school_id
        AND le.stage = p_payload->>'stage'
        AND le.status = 'active'
        AND next_k12_stage(le.stage) IS NOT NULL;

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
$function$;

-- Fix this session's own corrupted test data (confirmed live: the only
-- rows affected platform-wide)
UPDATE learner_enrollments SET stage = 'sss'
WHERE stage = 'jss:2' AND school_id IN (SELECT id FROM schools WHERE name = 'QA Test Secondary School');

SELECT 'phase22 done' AS status;
