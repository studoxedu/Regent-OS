# Tier Gating — Core / Connect / Command

**Status:** ✅ Applied live on `rmyjqgvftbaofhhefvin` (2026-07-20), `phase34.sql`.

Pricing (settled): **Core ₦500 / Connect ₦1,200 / Command ₦2,000** per student/term.

## Model
- `schools.tier_id` is now a real enum: `core` | `connect` | `command` (CHECK-constrained, default `core`).
- **Existing schools grandfathered to `command`** (per MO) — no live school lost a feature. Downgrade specific schools to their real paid tier by hand as contracts are confirmed:
  `UPDATE schools SET tier_id='core' WHERE id='…';`
- `feature_tiers(feature, min_tier, label)` — the packaging map (a real table, editable).
- `school_has_feature(school_id, feature)` — SECURITY DEFINER; `tier_rank(school.tier) >= tier_rank(feature.min_tier)`.

## Feature → tier
| Feature | Min tier |
|---|---|
| parent_portal, timetabling, staff_scheduling, custom_report_formats, multi_class_arm | **Connect** |
| payroll, library, cbt, tertiary, multi_branch, advanced_analytics | **Command** |
| (enrollment, attendance, results/report cards, fees, staff records — baseline) | Core |

## Enforcement (DB layer — the real boundary)
Additive **RESTRICTIVE** RLS policies named `tier_gate`, AND-ed with existing permissive
policies (so they only *subtract* access for under-tier schools; the phase26 isolation and
phase33 group-observer policies are untouched). `FOR ALL` gates read (USING) and direct
write (WITH CHECK). `super_admin` / BYPASSRLS (service_role, seeds) are exempt.

Gated at each module's directly school-keyed **entry table** (downstream join-keyed tables
have no reachable rows without it):

| Module (min tier) | Gated table(s) |
|---|---|
| Tertiary (Command) | faculties, semesters, academic_sessions, grade_scales (school_id); students, venues (institution_id) |
| Payroll (Command) | payroll_runs, salary_grades |
| Library (Command) | library_books, library_borrows |
| CBT (Command) | cbt_tests |
| Timetabling (Connect) | k12_timetable_periods, k12_timetable_slots |

**Verified** (RLS simulation, tx-rollback): a school flipped to `core` reads 0 semesters/students
(`has_tertiary=false`); flipped to `connect` it loses payroll/library (0 rows) but keeps
timetabling; grandfathered `command` schools are unchanged (GSU sees 1000 students / 2 semesters,
Gombe sees payroll + library + timetable). Payroll/library/CBT/grade-scale/venue/timetable/tertiary-
structure writes are all direct client inserts, so WITH CHECK blocks them too.

## Platform-admin control (phase35)
- **`schools.tier_id` and `group_id` are locked to the platform admin** by a BEFORE UPDATE
  trigger (`trg_lock_school_cols`). Without it, any `school.manage` holder (e.g. a tertiary
  school_admin/VC) could `UPDATE schools SET tier_id='command'` on their own row and self-upgrade,
  bypassing every gate. Now only super_admin (or a no-JWT service/backend/migration context) may
  change tier/group; ordinary school-profile edits are unaffected.
- The super-admin **Schools** page renders tier as an inline **Core/Connect/Command** dropdown per
  school (`changeTier`) — the sanctioned way to set/downgrade a plan. super_admin also bypasses
  every `tier_gate` (the `is_super_admin() OR …` escape), so the platform admin sees/administers
  all schools regardless of tier. Verified live.

## Known residual gaps (follow-up hardening — NOT enforced yet)
These are SECURITY DEFINER write paths that bypass RLS, so the RESTRICTIVE gates do not stop
them. All are **transitively** blocked today (their upstream data is gated) and have **zero live
impact** under grandfathering, but a strict hardening pass should add explicit `school_has_feature`
guards inside:
- `create_student` RPC (definer) — could insert a tertiary student for a core school by direct call.
- `flow_execute` (definer) — tertiary `results.*` writes to course_registrations; blocked in
  practice because semesters/offerings can't exist for a core school. (Note: `results.*` is shared
  with K-12, so any guard must key on payload/offering, not the action name.)

## Not DB-enforceable at table level (UI / product gates — recommend follow-up)
- **multi_branch** — a property of the group/proprietor, not a single school; there is no tier on
  `school_groups`. Today the control is the `proprietor` office assignment. Consider a group-tier.
- **parent_portal** — guardian read access is a clause inside shared policies, not a table.
- **staff_scheduling, custom_report_formats, multi_class_arm, advanced_analytics** — not distinct
  tables; gate in the UI/product layer.

UI sidebar/route hiding by tier was **not** added (grandfather = all Command, so nothing to hide
today). Recommended as a UX follow-up using the same `feature_tiers` / `school_has_feature` source.
