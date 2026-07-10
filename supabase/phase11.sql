-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 11 MIGRATION
-- School profile fields · logo storage · school.manage capability
-- ═══════════════════════════════════════════════════════════

-- ── 1. School profile columns (feed report-card headers etc.) ──
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url         TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS motto            TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS address          TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS city             TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS state            TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS phone            TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS email            TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS website          TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS head_name        TEXT;   -- principal / head teacher (report-card signature)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS registration_no  TEXT;   -- govt approval / registration number
ALTER TABLE schools ADD COLUMN IF NOT EXISTS established_year INT;

-- ── 2. Capability + RLS so a school's head can edit its profile ──
INSERT INTO capabilities (office_id, action)
SELECT o.id, a.action
FROM offices o
CROSS JOIN (VALUES
  ('head_teacher', 'school.manage'),
  ('school_admin', 'school.manage')
) AS a(office, action)
WHERE o.name = a.office
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS schools_manager_update ON schools;
CREATE POLICY schools_manager_update ON schools FOR UPDATE TO authenticated
  USING      (is_super_admin() OR has_school_capability(id, 'school.manage'))
  WITH CHECK (is_super_admin() OR has_school_capability(id, 'school.manage'));

-- ── 3. Public bucket for school logos + policies ─────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('school-logos', 'school-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS school_logos_read   ON storage.objects;
CREATE POLICY school_logos_read   ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'school-logos');

DROP POLICY IF EXISTS school_logos_write  ON storage.objects;
CREATE POLICY school_logos_write  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'school-logos');

DROP POLICY IF EXISTS school_logos_update ON storage.objects;
CREATE POLICY school_logos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'school-logos');

SELECT 'phase11 done' AS status;
