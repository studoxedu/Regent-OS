-- ============================================================
-- Regent OS — flow_execute: the only write path for governance data
-- ============================================================

CREATE OR REPLACE FUNCTION flow_execute(
  p_action_type text,
  p_school_id   uuid,
  p_payload     jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
  -- ── 1. Authentication ───────────────────────────────────────
  v_profile_id := auth.uid();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  -- ── 2. Resolve membership ───────────────────────────────────
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

  -- ── 3. Capability check ─────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM capabilities c
    WHERE c.office_id = v_membership.office_id
      AND c.action = p_action_type
  ) INTO v_has_cap;

  IF NOT v_has_cap THEN
    RAISE EXCEPTION 'Forbidden: office "%" does not hold capability "%"',
      v_office_name, p_action_type;
  END IF;

  -- ── 4. Dispatch ─────────────────────────────────────────────
  CASE p_action_type

    -- ──────────────────────────────────────────────────────────
    WHEN 'learner.enroll' THEN
      -- Payload: first_name, last_name, stage, date_of_birth,
      --          guardian_consent_captured
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

    -- ──────────────────────────────────────────────────────────
    WHEN 'results.finalize' THEN
      -- K12: Payload: enrollment_id, academic_session, term, scores (jsonb)
      UPDATE term_results
      SET status = 'published', finalized_at = now(),
          scores = p_payload->'scores'
      WHERE enrollment_id = (p_payload->>'enrollment_id')::uuid
        AND academic_session = p_payload->>'academic_session'
        AND term = (p_payload->>'term')::int
        AND school_id = p_school_id
      RETURNING * INTO v_result;

      -- If no existing row, insert
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

    -- ──────────────────────────────────────────────────────────
    WHEN 'results.reopen' THEN
      -- K12: Payload: enrollment_id, academic_session, term, correction_note
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

    -- ──────────────────────────────────────────────────────────
    WHEN 'results.submit' THEN
      -- Tertiary: Payload: offering_id
      UPDATE course_offerings
      SET results_status = 'submitted'
      WHERE id = (p_payload->>'offering_id')::uuid
        AND results_status = 'draft'
      RETURNING * INTO v_offering;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Offering not found or not in draft status';
      END IF;
      v_result := jsonb_build_object('entity_type','course_offering','entity_id', v_offering.id);

    -- ──────────────────────────────────────────────────────────
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

    -- ──────────────────────────────────────────────────────────
    WHEN 'fee.record' THEN
      -- Payload: enrollment_id, amount, description, academic_session, term
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

    -- ──────────────────────────────────────────────────────────
    WHEN 'learner.promote' THEN
      -- Payload: stage, academic_session (advances all active learners in stage by one ordinal)
      UPDATE learner_enrollments le
      SET stage = (
        SELECT el2.stage || ':' || el2.ordinal::text
        FROM education_levels el1
        JOIN education_levels el2
          ON el2.stage = el1.stage AND el2.ordinal = el1.ordinal + 1
        WHERE el1.stage = le.stage
        LIMIT 1
      )
      WHERE le.school_id = p_school_id
        AND le.stage = p_payload->>'stage'
        AND le.status = 'active';

      v_result := jsonb_build_object('entity_type','learner_enrollment','stage',p_payload->>'stage');

    -- ──────────────────────────────────────────────────────────
    WHEN 'learner.transfer.initiate' THEN
      -- Payload: enrollment_id, destination_school_id, reason
      UPDATE learner_enrollments
      SET status = 'transferred', exit_date = CURRENT_DATE
      WHERE id = (p_payload->>'enrollment_id')::uuid
        AND school_id = p_school_id;

      v_result := jsonb_build_object(
        'entity_type', 'learner_enrollment',
        'entity_id',   (p_payload->>'enrollment_id')::uuid,
        'destination', p_payload->>'destination_school_id'
      );

    -- ──────────────────────────────────────────────────────────
    ELSE
      RAISE EXCEPTION 'Unknown action type: %', p_action_type;
  END CASE;

  -- ── 5. Audit log (always) ───────────────────────────────────
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

  -- ── 6. Return ───────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',        true,
    'audit_ref', v_audit_ref,
    'action',    p_action_type,
    'result',    v_result
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Ensure nothing partial commits — the whole txn rolls back
    RAISE;
END;
$$;

-- Grant execute only to authenticated users
REVOKE ALL ON FUNCTION flow_execute FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow_execute TO authenticated;
