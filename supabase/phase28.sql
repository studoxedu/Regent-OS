-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 28 MIGRATION
-- Real promotion + graduation (class-aware)
-- ═══════════════════════════════════════════════════════════
--
-- Before this, learner.promote bumped an entire COARSE stage:
--   UPDATE ... SET stage = next_k12_stage(stage) WHERE stage = payload.stage
-- Running it for 'jss' moved JSS1, JSS2 AND JSS3 pupils all to 'sss' at once,
-- while leaving class_id pointing at a JSS class — i.e. it corrupted the
-- roster rather than promoting it. It also had no concept of graduation or
-- of a pupil repeating a year.
--
-- The year-level only exists inside the class NAME ("JSS 1A"), so nothing
-- could know JSS 1A -> JSS 2A. This adds an explicit progression map on the
-- class itself:
--   next_class_id       -> the class its pupils promote into
--   is_graduating_class -> final year; its pupils graduate instead
--
-- A class with neither is treated as UNCONFIGURED and skipped — deliberately,
-- so a school that hasn't set the map can't accidentally graduate everyone.

ALTER TABLE k12_classes ADD COLUMN IF NOT EXISTS next_class_id UUID REFERENCES k12_classes(id) ON DELETE SET NULL;
ALTER TABLE k12_classes ADD COLUMN IF NOT EXISTS is_graduating_class BOOLEAN NOT NULL DEFAULT false;

-- A class cannot both promote onward and be a final year.
ALTER TABLE k12_classes DROP CONSTRAINT IF EXISTS k12_classes_progression_chk;
ALTER TABLE k12_classes ADD CONSTRAINT k12_classes_progression_chk
  CHECK (NOT (next_class_id IS NOT NULL AND is_graduating_class = true));

-- flow_execute: live definition with ONLY the learner.promote branch replaced
-- (+ three counters in DECLARE). Verified programmatically: RGT prefix and
-- every other branch byte-identical to what is deployed.
CREATE OR REPLACE FUNCTION public.flow_execute(p_action_type text, p_school_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_promoted  INTEGER := 0;
  v_graduated INTEGER := 0;
  v_skipped   INTEGER := 0;
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
      v_learner_id := 'RGT-' || to_char(now(), 'YYYY') || '-' ||
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
      -- Class-aware promotion. payload: { enrollment_ids: [uuid, ...] }
      -- Only the ids passed are touched, so repeaters are simply left out.
      -- Graduation runs FIRST: once those rows are no longer 'active' the
      -- promote UPDATE below can't also move them.
      UPDATE learner_enrollments le
      SET status = 'graduated', exit_date = CURRENT_DATE
      FROM k12_classes kc
      WHERE le.class_id = kc.id
        AND kc.is_graduating_class = true
        AND le.school_id = p_school_id
        AND le.status = 'active'
        AND le.id IN (SELECT (jsonb_array_elements_text(p_payload->'enrollment_ids'))::uuid);
      GET DIAGNOSTICS v_graduated = ROW_COUNT;

      -- Promote into the class's configured next class. stage is taken from the
      -- DESTINATION class so stage and class can never disagree.
      UPDATE learner_enrollments le
      SET class_id = kc.next_class_id, stage = nc.stage
      FROM k12_classes kc
      JOIN k12_classes nc ON nc.id = kc.next_class_id
      WHERE le.class_id = kc.id
        AND le.school_id = p_school_id
        AND le.status = 'active'
        AND le.id IN (SELECT (jsonb_array_elements_text(p_payload->'enrollment_ids'))::uuid);
      GET DIAGNOSTICS v_promoted = ROW_COUNT;

      -- Anything left is in a class with no next class and no graduating flag:
      -- an unconfigured progression. Skip it loudly rather than silently
      -- graduating a whole school by accident.
      SELECT count(*) INTO v_skipped
      FROM learner_enrollments le
      JOIN k12_classes kc ON kc.id = le.class_id
      WHERE le.school_id = p_school_id
        AND le.status = 'active'
        AND kc.next_class_id IS NULL
        AND kc.is_graduating_class = false
        AND le.id IN (SELECT (jsonb_array_elements_text(p_payload->'enrollment_ids'))::uuid);

      v_result := jsonb_build_object(
        'entity_type','learner_enrollment',
        'promoted', v_promoted, 'graduated', v_graduated, 'skipped', v_skipped);

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

SELECT 'phase28 done' AS status;
