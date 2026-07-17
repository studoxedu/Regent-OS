-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 27 MIGRATION
-- School-wide fee totals RPC (for the paginated Fee Management page)
-- ═══════════════════════════════════════════════════════════
--
-- Fee Management now pages its invoice list, so the summary tiles can no
-- longer be reduced from the loaded rows — that would only sum the visible
-- page. (The old code summed a hard limit(100), which was already wrong for
-- any school with >100 invoices.)
--
-- PostgREST aggregate functions (amount_due.sum()) are disabled by default on
-- Supabase, so this does the aggregate in a function instead.
--
-- SECURITY INVOKER on purpose: RLS still applies, so a caller can only ever
-- sum invoices at a school they're a member of — passing someone else's
-- school_id returns zeros rather than leaking their financial position.

CREATE OR REPLACE FUNCTION k12_fee_totals(p_school_id UUID)
RETURNS TABLE (total_due NUMERIC, total_paid NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public AS $$
  SELECT COALESCE(sum(amount_due), 0)::numeric,
         COALESCE(sum(amount_paid), 0)::numeric
  FROM fee_invoices
  WHERE school_id = p_school_id
$$;

GRANT EXECUTE ON FUNCTION k12_fee_totals(UUID) TO authenticated;

SELECT 'phase27 done' AS status;
