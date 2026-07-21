# Tertiary Results — Hierarchical Governance Chain

**Status:** ✅ Applied live on `rmyjqgvftbaofhhefvin` (2026-07-20), `phase36`–`phase38` + `demo_seed_tertiary_officers.sql`. Verified end-to-end via `flow_execute` simulation. Frontend migrated; `tsc -b` green.

## The chain
`course_offerings.results_status`:
```
draft → submitted → dept_verified → dept_approved → faculty_verified → published
```
| Step | Action | Role | Scope |
|------|--------|------|-------|
| Submit | `results.submit` | lecturer | own draft |
| Dept verify | `results.dept_verify` | dept_exam_officer *(exam_officer = institution-wide)* | own department |
| Dept approve | `results.dept_approve` | HOD | own department |
| Faculty collate | `results.faculty_verify` | faculty_exam_officer | own faculty |
| Publish | `results.publish` | Dean | own faculty |
| Ratify | `senate.ratify` | senate_secretary | institution (unchanged) |
| **school_admin** | any step | — | **bypasses scope** (oversight) |

**Reject:** every approver can `results.reject`, which moves the offering **one step back** to the previous owner (dept_approved→dept_verified, etc.) — with a note; the frontend notifies the previous owner to make changes. Office + scope required match the level being rejected.

**Score lock (edit before submission):** scores on `course_registrations` are editable only while the offering is `draft` (trigger `trg_lock_scores`); after submit they lock. A reject back to `draft` re-opens them. super_admin / backend contexts are exempt.

## Enforcement
- All transitions go through `flow_execute(action, school_id, {offering_id})` (K-12 overload) — capability-checked, then department/faculty scope-checked inside the function. Scope: `memberships.department_id` (dept roles) / `memberships.faculty_id` (faculty roles), matched against the offering's course → department → faculty.
- `phase38` surgically replaced only the `results.*` branches of the live `flow_execute` (all other branches byte-identical; verified by `build_flow.mjs` sanity checks) and expanded the `offering_status` CHECK to the six states.
- `create_student` (admissions) is now gated on the new `student.admit` capability (was ungated). `timetable_officer` gets a fine-grained `timetable.manage` (Schedox/venues) instead of the coarse `structure.manage`. registrar gets `course.register` + `session.create`.

## Frontend migrated to the 6-state model
`ResultsPipeline.tsx` (primary, with per-step reject + notify), `tertiary/Dashboard.tsx`, `ScoreReview.tsx` (now routes through `flow_execute` instead of writing status directly), `Acadex.tsx` (fixed: was calling the wrong `flow_execute` overload with singular `result.*` caps — now the K-12 overload with the new actions), `LecturerCourseScores.tsx` (locks after draft), display styles in `Coredesk.tsx`/`Boards.tsx`. `ResultStatus` type + `RESULT_STATUS_STYLES`/`RESULT_STATUS_LABELS` updated.

## GSU demo officers (all `Gombe@2025`)
Seeded by `supabase/demo_seed_tertiary_officers.sql` (idempotent):
| Login | Office | Scope |
|-------|--------|-------|
| `examdept@gsu.edu.ng` | dept_exam_officer | Computer Science dept |
| `hod.csc@gsu.edu.ng` | HOD | Computer Science dept |
| `examfac@gsu.edu.ng` | faculty_exam_officer | Faculty of Science |
| `dean.sci@gsu.edu.ng` | Dean | Faculty of Science |

Plus existing: `lecturer@gsu.edu.ng`, `examofficer@gsu.edu.ng` (institution-wide exam officer), `registrar@gsu.edu.ng`, `vc@gsu.edu.ng` (school_admin) — all `Gombe@2025`. Walk a **CSC** draft offering (e.g. CSC203) lecturer→examdept→hod→examfac→dean to demo the full chain; a Reject from any officer bounces it one step back.

## Verified live (flow_execute simulation, tx-rollback)
- Forward chain CSC203 draft→published ✅
- CSC dept officer verifying an **MTH** offering → blocked ("outside your department") ✅
- faculty officer rejects `dept_approved` → returns to `dept_verified` ✅
- score edit in draft allowed; after submit → "Scores are locked" ✅

## Known follow-ups
- Reject notification currently targets the previous owner best-effort via office+scope lookup; could be enriched to the exact prior actor via `audit_log`.
- `dept_exam_officer` scope in `ScoreReview`'s *view filter* still reads the older `office_instances` model; the **action** path is correctly `memberships`-scoped by `flow_execute`, so this only affects which rows are listed, not what can be acted on.
