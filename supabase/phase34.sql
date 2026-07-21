-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 34 MIGRATION
-- Real tier gating: Core / Connect / Command.
-- ═══════════════════════════════════════════════════════════
--
-- Until now schools.tier_id was cosmetic ('pilot'/'standard'), checked
-- nowhere — every school got every feature regardless of billing. This makes
-- tier a real access-control boundary enforced at the DB layer (RLS), so a
-- Core school cannot reach a Command-only table even by hitting the API
-- directly, not just by having buttons hidden in the UI.
--
-- Pricing (settled): Core ₦500 / Connect ₦1,200 / Command ₦2,000 per
-- student/term.
--
-- Existing schools are GRANDFATHERED to 'command' (per MO, 2026-07-20): no live
-- school loses a feature it uses today; specific schools get downgraded to
-- their real paid tier by hand afterward. So this migration has zero functional
-- impact on current data — it only bites future core/connect schools.
--
-- Enforcement model: additive RESTRICTIVE policies. A RESTRICTIVE policy is
-- AND-ed with the (OR of) existing permissive policies, so it can only SUBTRACT
-- access for under-tier schools; it never widens anyone's access and does not
-- touch the phase26 isolation / phase33 group-observer policies. super_admin
-- and BYPASSRLS roles (service_role / seeds) are unaffected.
--
-- Writes: the gated modules (payroll, library, CBT, grade scales, venues,
-- timetabling, tertiary structure) all write via direct client inserts, which
-- the RESTRICTIVE WITH CHECK gates. flow_execute (SECURITY DEFINER) only serves
-- Core features (fees/enrol) plus tertiary results — and tertiary results are
-- transitively blocked because their upstream (semesters/faculties/…) is gated,
-- so flow_execute needs no separate tier guard.

-- ── 1. Migrate tier values + constrain the domain ──────────────
UPDATE schools SET tier_id = 'command' WHERE tier_id NOT IN ('core','connect','command');
ALTER TABLE schools ALTER COLUMN tier_id SET DEFAULT 'core';
ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_tier_id_check;
ALTER TABLE schools ADD CONSTRAINT schools_tier_id_check CHECK (tier_id IN ('core','connect','command'));

-- ── 2. Tier ordering ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION tier_rank(p_tier text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tier WHEN 'core' THEN 1 WHEN 'connect' THEN 2 WHEN 'command' THEN 3 ELSE 0 END
$$;

-- ── 3. Feature → minimum-tier map (the published packaging) ────
CREATE TABLE IF NOT EXISTS feature_tiers (
  feature   text PRIMARY KEY,
  min_tier  text NOT NULL CHECK (min_tier IN ('core','connect','command')),
  label     text
);
INSERT INTO feature_tiers (feature, min_tier, label) VALUES
  -- Connect+
  ('parent_portal',         'connect', 'Parent portal'),
  ('timetabling',           'connect', 'Timetable management'),
  ('staff_scheduling',      'connect', 'Staff scheduling'),
  ('custom_report_formats', 'connect', 'Custom report card formats'),
  ('multi_class_arm',       'connect', 'Multi-class / multi-arm'),
  -- Command
  ('payroll',               'command', 'Payroll'),
  ('library',               'command', 'Library management'),
  ('cbt',                   'command', 'CBT examinations'),
  ('tertiary',              'command', 'Tertiary / university module'),
  ('multi_branch',          'command', 'Multi-branch oversight'),
  ('advanced_analytics',    'command', 'Advanced analytics')
ON CONFLICT (feature) DO UPDATE SET min_tier = EXCLUDED.min_tier, label = EXCLUDED.label;

ALTER TABLE feature_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_tiers_read ON feature_tiers;
CREATE POLICY feature_tiers_read ON feature_tiers FOR SELECT TO authenticated USING (true);

-- ── 4. Does a school's tier include a feature? ─────────────────
-- SECURITY DEFINER so it reads schools/feature_tiers without being filtered by
-- their own RLS. Unknown feature → treated as 'core' (never gate the baseline);
-- unknown/missing school → false (no access).
CREATE OR REPLACE FUNCTION school_has_feature(p_school_id uuid, p_feature text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT COALESCE(
    tier_rank((SELECT tier_id FROM schools WHERE id = p_school_id))
      >= tier_rank(COALESCE((SELECT min_tier FROM feature_tiers WHERE feature = p_feature), 'core')),
    false)
$$;
GRANT EXECUTE ON FUNCTION school_has_feature(uuid, text) TO authenticated;

-- ── 5. RESTRICTIVE tier gates on the module entry tables ───────
-- Gating the directly school-keyed entry table of each module disables the
-- whole module for under-tier schools (downstream join-keyed tables have no
-- reachable rows without it). FOR ALL covers read (USING) and direct write
-- (WITH CHECK).
DO $g$
DECLARE
  gates jsonb := jsonb_build_array(
    -- Tertiary module (Command)
    jsonb_build_object('t','faculties',            'c','school_id',      'f','tertiary'),
    jsonb_build_object('t','semesters',            'c','school_id',      'f','tertiary'),
    jsonb_build_object('t','academic_sessions',    'c','school_id',      'f','tertiary'),
    jsonb_build_object('t','grade_scales',         'c','school_id',      'f','tertiary'),
    jsonb_build_object('t','students',             'c','institution_id', 'f','tertiary'),
    jsonb_build_object('t','venues',               'c','institution_id', 'f','tertiary'),
    -- Payroll (Command)
    jsonb_build_object('t','payroll_runs',         'c','school_id',      'f','payroll'),
    jsonb_build_object('t','salary_grades',        'c','school_id',      'f','payroll'),
    -- Library (Command)
    jsonb_build_object('t','library_books',        'c','school_id',      'f','library'),
    jsonb_build_object('t','library_borrows',      'c','school_id',      'f','library'),
    -- CBT (Command)
    jsonb_build_object('t','cbt_tests',            'c','school_id',      'f','cbt'),
    -- K-12 timetabling (Connect)
    jsonb_build_object('t','k12_timetable_periods','c','school_id',      'f','timetabling'),
    jsonb_build_object('t','k12_timetable_slots',  'c','school_id',      'f','timetabling')
  );
  g jsonb;
BEGIN
  FOR g IN SELECT * FROM jsonb_array_elements(gates) LOOP
    EXECUTE format('DROP POLICY IF EXISTS tier_gate ON public.%I', g->>'t');
    EXECUTE format(
      'CREATE POLICY tier_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (is_super_admin() OR school_has_feature(%I, %L)) '
      || 'WITH CHECK (is_super_admin() OR school_has_feature(%I, %L))',
      g->>'t', g->>'c', g->>'f', g->>'c', g->>'f');
    RAISE NOTICE 'phase34: tier_gate on % (% >= %)', g->>'t', g->>'f', (SELECT min_tier FROM feature_tiers WHERE feature = g->>'f');
  END LOOP;
END $g$;

SELECT 'phase34 done' AS status,
  (SELECT jsonb_object_agg(tier_id, c) FROM (SELECT tier_id, count(*) c FROM schools GROUP BY tier_id) t) AS tiers;
