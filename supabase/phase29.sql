-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 29 MIGRATION
-- Bursar reports: arrears, aging and collection by class
-- ═══════════════════════════════════════════════════════════
--
-- Fee Management could show a list of invoices and nothing else — no arrears
-- report, no aging, no per-class collection, and the "Payment history" tab was
-- a literal "coming soon" stub. These are day-one asks for a bursar.
--
-- Done as RPCs because they need joins + aggregation across invoices, and
-- PostgREST aggregates are disabled on Supabase by default.
--
-- All SECURITY INVOKER: RLS still applies, so a caller only ever sees a school
-- they're a member of. Passing another school's id returns nothing rather than
-- leaking its financial position.

-- ── Per-pupil arrears (only those actually owing), newest debt first ──
DROP FUNCTION IF EXISTS k12_arrears(UUID, INTEGER, INTEGER);
CREATE FUNCTION k12_arrears(p_school_id UUID, p_limit INTEGER DEFAULT 25, p_offset INTEGER DEFAULT 0)
RETURNS TABLE (
  enrollment_id UUID,
  learner_name  TEXT,
  learner_code  TEXT,
  class_name    TEXT,
  invoiced      NUMERIC,
  paid          NUMERIC,
  balance       NUMERIC,
  oldest_due    DATE,
  days_overdue  INTEGER
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT le.id,
         (l.first_name || ' ' || l.last_name)::text,
         l.learner_id::text,
         COALESCE(k.name, '—')::text,
         SUM(fi.amount_due)::numeric,
         SUM(fi.amount_paid)::numeric,
         SUM(fi.amount_due - fi.amount_paid)::numeric,
         MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid),
         GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid))::int
  FROM fee_invoices fi
  JOIN learner_enrollments le ON le.id = fi.enrollment_id
  JOIN learners l            ON l.id  = le.learner_id
  LEFT JOIN k12_classes k    ON k.id  = le.class_id
  WHERE fi.school_id = p_school_id AND le.status = 'active'
  GROUP BY le.id, l.first_name, l.last_name, l.learner_id, k.name
  HAVING SUM(fi.amount_due - fi.amount_paid) > 0
  ORDER BY SUM(fi.amount_due - fi.amount_paid) DESC
  LIMIT p_limit OFFSET p_offset
$$;
GRANT EXECUTE ON FUNCTION k12_arrears(UUID, INTEGER, INTEGER) TO authenticated;

-- ── Headline: how many pupils owe, and how much in total ──
DROP FUNCTION IF EXISTS k12_arrears_total(UUID);
CREATE FUNCTION k12_arrears_total(p_school_id UUID)
RETURNS TABLE (pupils BIGINT, total_balance NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT count(*)::bigint, COALESCE(SUM(bal), 0)::numeric FROM (
    SELECT SUM(fi.amount_due - fi.amount_paid) AS bal
    FROM fee_invoices fi
    JOIN learner_enrollments le ON le.id = fi.enrollment_id
    WHERE fi.school_id = p_school_id AND le.status = 'active'
    GROUP BY le.id
    HAVING SUM(fi.amount_due - fi.amount_paid) > 0
  ) x
$$;
GRANT EXECUTE ON FUNCTION k12_arrears_total(UUID) TO authenticated;

-- ── Aging buckets (by the oldest unpaid invoice's due date) ──
DROP FUNCTION IF EXISTS k12_aging_summary(UUID);
CREATE FUNCTION k12_aging_summary(p_school_id UUID)
RETURNS TABLE (bucket TEXT, sort_order INTEGER, pupils BIGINT, amount NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT b.bucket, b.sort_order, count(*)::bigint, SUM(b.bal)::numeric
  FROM (
    SELECT SUM(fi.amount_due - fi.amount_paid) AS bal,
           CASE
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) = 0  THEN 'Not yet due'
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) <= 30 THEN '1–30 days'
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) <= 60 THEN '31–60 days'
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) <= 90 THEN '61–90 days'
             ELSE '90+ days'
           END AS bucket,
           CASE
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) = 0  THEN 0
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) <= 30 THEN 1
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) <= 60 THEN 2
             WHEN GREATEST(0, CURRENT_DATE - MIN(fi.due_date) FILTER (WHERE fi.amount_due > fi.amount_paid)) <= 90 THEN 3
             ELSE 4
           END AS sort_order
    FROM fee_invoices fi
    JOIN learner_enrollments le ON le.id = fi.enrollment_id
    WHERE fi.school_id = p_school_id AND le.status = 'active'
    GROUP BY le.id
    HAVING SUM(fi.amount_due - fi.amount_paid) > 0
  ) b
  GROUP BY b.bucket, b.sort_order
  ORDER BY b.sort_order
$$;
GRANT EXECUTE ON FUNCTION k12_aging_summary(UUID) TO authenticated;

-- ── Collection performance per class ──
DROP FUNCTION IF EXISTS k12_collection_by_class(UUID);
CREATE FUNCTION k12_collection_by_class(p_school_id UUID)
RETURNS TABLE (class_name TEXT, pupils BIGINT, invoiced NUMERIC, collected NUMERIC, outstanding NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(k.name, '—')::text,
         count(DISTINCT le.id)::bigint,
         SUM(fi.amount_due)::numeric,
         SUM(fi.amount_paid)::numeric,
         SUM(fi.amount_due - fi.amount_paid)::numeric
  FROM fee_invoices fi
  JOIN learner_enrollments le ON le.id = fi.enrollment_id
  LEFT JOIN k12_classes k     ON k.id  = le.class_id
  WHERE fi.school_id = p_school_id AND le.status = 'active'
  GROUP BY k.name
  ORDER BY SUM(fi.amount_due - fi.amount_paid) DESC
$$;
GRANT EXECUTE ON FUNCTION k12_collection_by_class(UUID) TO authenticated;

SELECT 'phase29 done' AS status;
