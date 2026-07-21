# Multi-Branch / Proprietor Oversight — Demo Handoff

**Status:** ✅ Working live on `rmyjqgvftbaofhhefvin` (verified 2026-07-20).

## What it demonstrates
One proprietor sees **read-only** oversight across an entire group of institutions,
while each branch's own staff still see only their own branch.

- **Group:** Gombe Educational Group (`d4e5f6a7-0000-4000-8000-000000000001`)
  - **Branch 1 — K-12:** Gombe High School (`b2c3d4e5-…-000000000001`) — 500 pupils, ₦108.8M collected
  - **Branch 2 — tertiary:** Gombe State University (`c3d4e5f6-…-000000000001`) — 1,000 students, ₦135M collected

## Login
| Role | Email | Password |
|------|-------|----------|
| **Proprietor** (group observer, read-only) | `proprietor@gombeedu.ng` | `Proprietor@2025` |

Lands on `/proprietor`. Drill into either branch via "Drill into school →".
Branch logins (unchanged) still see only their own school — e.g. `principal@gombehigh.ng` / `Gombe@2025` (K-12), `lecturer@gsu.edu.ng` / `Gombe@2025` (tertiary).

## What was fixed
1. **`supabase/phase33.sql`** — completes proprietor group-read at the RLS layer.
   - Adds/keeps SECURITY DEFINER helper `proprietor_over_school(school_id)` (true when the
     caller has an active `group_id` membership owning that school).
   - Adds **additive, read-only** `<table>_group_observer` SELECT policies to every tenant
     table that was scoped to a single school's members (33 tables incl. `memberships`).
     Additive = the hardened phase26 isolation policies are untouched; Postgres ORs permissive
     policies, so this can only grant the observer extra read, never widen anyone else.
   - Supersedes phase32's 4 ad-hoc `prop_group_read` policies (folded into the uniform set).
   - `schools` was already covered by `schools_proprietor_read` (group_id-scoped).
2. **`supabase/demo_seed_group.sql`** — idempotent seed: group + branch links + proprietor
   login (known password) + GSU tertiary fee invoices. Re-runnable.
3. **Frontend** — `proprietor/Dashboard.tsx` + `proprietor/SchoolDetail.tsx` now read
   `fee_invoices` (via `k12_fee_totals`, not the empty legacy `fee_records`) and count
   `learner_enrollments` **⋃** `students`, so tertiary branches show real head-count, not zero.

## Verified (live RLS simulation)
- **Proprietor** sees: 2 branches; 500 K-12 + 1,000 tertiary head-count; ₦108.8M + ₦135M fees;
  41 + 4 staff; group-wide audit (22 rows); 2,324 K-12 term results.
- **Isolation intact:** Gombe principal sees only their 1 school / 500 pupils and **0** GSU rows;
  GSU lecturer sees only their own and **0** Gombe rows.
- `npx tsc -b` passes.

## Reproduce from scratch
Apply order (after the existing phase chain): `phase33.sql` → `demo_seed_group.sql`.
Both are idempotent. phase33 requires the group + a proprietor membership to exist (the seed creates them).
