-- ═══════════════════════════════════════════════════════════
-- REGENT OS — PHASE 37 MIGRATION  (Tertiary org chart, stage 2)
-- Faculty scoping needs a faculty on the membership.
-- memberships carried department_id but no faculty_id, so faculty-level
-- officers (faculty_exam_officer, dean) could not be scoped to a faculty.
-- ═══════════════════════════════════════════════════════════
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS faculty_id uuid REFERENCES faculties(id);
SELECT 'phase37 done' AS status;
