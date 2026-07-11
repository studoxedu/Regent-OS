# Regent OS — Project Handoff & State

> Complete context document. Feed this to a new chat/session so it has everything
> we've built and everything still outstanding. Last updated: 2026-07-11.

---

## 1. What this is

**Rysan Technologies** is the company. Two products:

- **Regent OS** — multi-tenant school-management platform for **K-12 and tertiary**
  institutions. This repo. The main product.
- **Herald** — long-range RFID gate attendance + parent SMS (hardware, pilot stage).
  Only exists as a marketing page so far; no code in this repo.

Selling point / positioning: **the records we keep** — rich, connected academic
history and report cards. Competes with Nigerian systems **SchoolMaster** and
**FlexiSAF (SAFSIMS / SAFRECORDS)**. Gaps we closed this session vs. them: CBT,
two-way messaging, guardian alerts, online payments.

---

## 2. Tech stack & architecture

- **Frontend:** React 19 + TypeScript + Vite 8 (rolldown) + Tailwind. SPA.
- **Routing:** react-router-dom 7. `BrowserRouter` on web, `HashRouter` under
  Electron `file://`.
- **Backend:** **Supabase** (Postgres + Auth + Storage + Edge Functions). All
  dynamic data lives here — NOT on the host.
- **Governance write path:** most writes go through the `flow_execute(action_type,
  school_id, payload)` RPC — `SECURITY DEFINER`, capability-checked. Some K-12
  pages write directly to tables (guarded by RLS, see §8).
- **Offline layer:** `src/lib/fetchInterceptor.ts` wraps `window.fetch`, caches
  Supabase reads in IndexedDB (Dexie, `src/lib/db.ts`), queues mutations offline
  and replays them (`src/lib/syncManager.ts`).
- **PWA:** vite-plugin-pwa, `registerType: autoUpdate`. Registers a service worker
  (matters for cache-busting on deploy — see §7).
- **Desktop:** Electron + Tauri wrappers scaffolded (`electron/`, `src-tauri/`).

### Repo & locations
- **GitHub:** `github.com/studoxedu/Regent-OS` (**private**), branch `main`, HTTPS remote.
- **Local:** `C:\Users\HomeZ\Documents\studox-main`
- **Marketing site:** `website/` subfolder (3 static pages + og images).
- **SQL migrations:** `supabase/*.sql`
- **Admin scripts:** `scripts/*.cjs` (need `SUPABASE_PAT` env; user runs SQL via
  dashboard instead).

---

## 3. Supabase backend — IMPORTANT

- **App's live project** (from committed `.env.production`):
  `https://rmyjqgvftbaofhhefvin.supabase.co`
- ⚠️ **Discrepancy to verify:** the `scripts/*.cjs` hardcode a *different* project
  ref `fghdgtihpvaehykgqgro`. The **app** uses `rmyjqgvftbaofhhefvin`. Run all SQL
  against the project that matches `.env.production` (rmyjqgvftbaofhhefvin). Confirm
  in the Supabase dashboard which project you have open before running migrations.
- **No self-signup.** Every account (incl. super admins) is provisioned server-side
  via SQL or the `create_staff_member` RPC.

### Super admin login
- Email: **muhdnasrahmd@gmail.com**  ·  Password: **@Novica1234**
  (set via SQL; `profiles.global_role = 'super_admin'`). Change after go-live.

### Migrations — APPLY IN THIS ORDER (all idempotent, safe to re-run)
Run each in **Supabase Dashboard → SQL Editor**:

```
setup.sql → registry.sql → phase1 → phase2 → phase3 → phase4
→ phase5 → phase6 → phase7 → phase8 → phase9 → phase10 → phase11
```

- phase1–4 were applied before this session (core schema, K-12 calendar/fees/
  attendance, timetable/notifications, CBT/messaging/payments).
- **phase5–phase11 are this session.** User confirmed phase6 applied and reran
  phase10; the rest should be run to be safe. phase7/8/9/11 depend on phase6's
  helper functions (`is_super_admin`, `has_school_capability`, `has_any_capability`).
- **Diagnostics run this session came back clean** — no stray permissive
  `USING(true)` *write* policies exist, so the capability RLS actually enforces.

### What each new migration does
- **phase5** — adds K-12 offices `k12_exam_officer`, `k12_registrar` + capabilities.
- **phase6** — capability-scoped RLS write policies on K-12 direct-write tables
  (attendance, fees, guardians). Defines the helper functions.
- **phase7** — same for shared tables (announcements, staff_profiles, salary_grades,
  payroll_*, library_*). Adds `staff.manage` / `payroll.manage` / `library.manage`.
- **phase8** — fixes a capability CONTRACT bug (see §9): grants the real
  flow_execute action strings (`learner.enroll`, `learner.transfer.initiate`,
  `results.finalize`, `results.reopen`) to the new offices + head_teacher.
- **phase9** — write RLS for K-12 setup tables (calendar, classes, subjects,
  timetable) which were previously default-denied (pages were silently broken).
- **phase10** — `learners.nin` + `learners.guardian_nin` + `guardians.nin` (11-digit
  CHECK); `set_learner_nin()` RPC; `create_staff_member` gains optional `p_password`
  (drops old 5-arg signature first — MUST run or the Add Staff password field errors).
- **phase11** — school profile columns (logo_url, motto, address, city, state, phone,
  email, website, head_name, registration_no, established_year); `school.manage`
  capability + schools UPDATE RLS; public `school-logos` storage bucket + policies.

### Supabase Edge Functions (Paystack) — need deploying separately
`supabase/functions/paystack-init`, `paystack-verify`, `paystack-webhook`.
Deploy with `supabase functions deploy ...`, set secret
`PAYSTACK_SECRET_KEY`, and point the Paystack dashboard webhook at
`https://<project>.supabase.co/functions/v1/paystack-webhook`. **Not yet deployed.**

---

## 4. Local dev

```
npm install
npm run dev        # dev server (hot reload)
npm run build      # tsc -b && vite build → dist/  (the whole static site)
npm run preview    # serve the built dist/ at localhost:4173
```

**Windows PowerShell gotcha:** if `npm` errors with *"running scripts is disabled"*,
either use `npm.cmd run <script>`, or run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (safe, user-scoped).

The Supabase keys are baked into the build from committed `.env.production`, so
`npm run build` produces a fully working `dist/` with no extra config.

---

## 5. Build & deploy (current plan)

**Hosting decision: Cloudflare Pages — Direct Upload.** Why:
- Netlify free tier's **bandwidth limit** (100GB/mo) stopped the project.
- Cloudflare has **unlimited bandwidth**, free, no card.
- Cloudflare's *git build* kept failing on config (`_redirects` infinite-loop,
  wrangler). **Direct Upload skips the build entirely** — you upload the finished
  `dist/` folder — so none of those failures apply. Repo stays private.

### First deploy (pick one)
- **Dashboard:** Cloudflare → Workers & Pages → **Create → Pages → Upload assets**
  (NOT "Connect to Git"). Name it `regentos`. Drag the `dist` folder. → `regentos.pages.dev`.
- **CLI:** `npx wrangler login` then `npm run deploy`.

### Updates (every code change)
```
npm run deploy      # = build locally + wrangler pages deploy dist --project-name=regentos
```
~30s. Each upload is a versioned deployment with one-click rollback. (Script is in
`package.json`.)

### Do NOT
- Do not "Connect to Git" on Cloudflare (that runs the failing build).
- Do not "Retry" the old failed Cloudflare deploy (rebuilds an old commit).

### SPA routing
- Cloudflare Workers/Pages Assets handles SPA fallback natively — **no `_redirects`
  file** for the app (it was removed; it caused the infinite-loop error).
- `public/.htaccess` exists for Apache/cPanel hosts (harmless elsewhere).

---

## 6. Domain (rysantech.com.ng) — outstanding

- Registered at **Whogohost**. DNS nameservers currently point at **Netlify** (from
  the earlier setup) — this must move.
- **Plan:** move the domain onto **Cloudflare DNS** (free), then attach custom
  domains to the Pages projects:
  - `rysantech.com.ng` + `www` → marketing site
  - `regentos.rysantech.com.ng` → the app
- Steps: Cloudflare → Add a domain → get 2 nameservers → set them at Whogohost →
  wait for Active → Pages project → Custom Domains → add.
- **Old Netlify sites:** still up (throttled). Leave as fallback; delete once
  Cloudflare + domain fully work. The domain's DNS is the only remaining Netlify tie.
- Email `hello@rysantech.com.ng` is on the marketing site but **not set up yet**
  (needs e.g. Zoho Mail free tier + MX records).

---

## 7. Deploy gotchas / lessons learned

- **`navigator.onLine` lies.** It reports `false` even when online (worse under the
  PWA service worker). This caused the "Add Staff returned `{}`" bug: the interceptor
  faked mutations as `{}`. Fixed by making the interceptor **optimistic-online**
  (`d88d20f`): always try the real fetch, only fall back to offline queue on an actual
  network error. Credential RPCs (`create_staff_member`, `set_learner_nin`) also
  bypass the offline queue entirely (`4a5558b`).
- **PWA service worker caches the old bundle.** After a deploy, an open tab keeps
  running old JS. To force new code: hard-refresh twice, or DevTools → Application →
  Service Workers → Unregister + Clear site data, or test in incognito.
- **SQL reruns don't fix frontend bugs.** The `{}` was frontend, not DB.

---

## 8. Role / capability / RLS model (K-12) — architecture

**Offices** (central list in `src/lib/roles.ts`): `head_teacher`, `class_teacher`,
`bursar`, `k12_exam_officer`, `k12_registrar`. (Tertiary offices are separate:
school_admin, registrar, dean, hod, lecturer, exam_officer, etc.)

**Single-vs-multiple:** a school opts in by how many admins the platform admin seeds.
One-person school = just a **Head Teacher** (sees everything). Larger school adds
specialists, each scoped to their sidebar sections (`K12_OFFICE_SECTIONS` in roles.ts):
- head_teacher → everything (Setup + HR are head-only)
- bursar → Finance
- k12_exam_officer → Academics (attendance, results, report cards, CBT)
- k12_registrar → Admissions & Records (enrollment, guardians, transfers, promotion)

**Enforcement is two-layer:**
1. `flow_execute` checks the office holds a `capabilities.action` matching the exact
   action string the page sends.
2. Direct-write tables are guarded by capability-scoped RLS (phase6/7/9).

⚠️ **Soft boundary caveat:** the sidebar filter is UX; the DB RLS is the real wall.
Because some pages still write directly, a scoped user who typed another section's URL
is stopped by RLS (post phase6-9), not by the missing menu.

**Staff creation is platform-admin-only** (user's decision): Head Teacher's "Add
Staff" was removed; only Super Admin → Schools → "+ Add Staff" creates accounts, and
a **password is required** (no auto-generate). Tertiary institutions keep their own
Add Staff (left as-is).

---

## 9. Everything built this session (chronological, with commits)

**Competitor gap features** (`46c2715`): CBT (server-side graded, `cbt_*` tables +
RPCs, `src/pages/shared/CBT.tsx` builder + `src/pages/student/Tests.tsx`), two-way
messaging (`src/pages/shared/Messages.tsx`), attendance→guardian alerts
(`guardian_notifications` + Alerts tab in ParentDashboard), Paystack payments
(`payment_transactions` + 3 edge functions + Pay Now on student fees). SQL: phase4.

**Marketing site** (`378f9a9`, `58c94b6`): `website/` — company home + Regent OS +
Herald pages, brand system (R-tile logo, amber vs Herald green), OG images, favicons,
domain rysantech.com.ng.

**K-12 staff onboarding** (`615b140`, `ecdfaa1`): fixed `create_staff_member` to work
for K-12 offices; added Seed/Add Staff on Super Admin → Schools; `grant_platform_admin.cjs`.

**K-12 role model** (`9e236ac`): 4-office split + office-based sidebar filtering.
SQL phase5.

**RLS hardening** (`de7a416`, `8508d11`, `48d072e`): phase6/7/9 capability-scoped
write policies across K-12 + shared tables. `69b77a2` phase8 fixed the capability
contract bug (invented capability names didn't match flow_execute action strings —
had 403'd Enrollment/Transfers/Results for the new offices, and blocked a solo Head
Teacher from finalizing results).

**NIN + centralized staff** (`8459d20`, `7ddbeb2`): learner NIN / guardian NIN
(required: learner NIN OR guardian NIN at enrollment), inline backfill, guardian NIN
field; admin-set password; removed Head Teacher Add Staff. SQL phase10.

**School Profile + logo** (`bc4912d`): `/k12/school` page, logo upload, school profile
columns. SQL phase11.

**Richer report card** (`03fd4b9`): school branding + logo, learner bio incl. NIN/DOB,
term summary (total/average/overall grade/**class position**), attendance summary,
**full academic-history table** across past terms. `src/pages/k12/ReportCards.tsx`.

**Data migration** (`83af300`, `26c6fe4`): CSV **learner import** in Enrollment
("Import / Migrate"), and CSV **historical-results import** in Results ("Import
History"). Both run the governed paths (learner.enroll / results.finalize) with the
correct per-subject scores shape.

**Data-flow coherence** (`6d5fb9b`): made manual Results entry **subject-aware** —
pick class + subject, merge each subject into the term result's per-subject `scores`
object (`{ Mathematics: {ca,exam,total}, ... }`). Previously it wrote a flat
`{ca,exam}` that the report card couldn't render. Now manual entry, import, and report
card all use the identical shape.

**Perf** (`292764a`): route-level `React.lazy` code-splitting. Initial JS 1090 kB
(268 kB gz) → 577 kB (169 kB gz) + ~68 on-demand chunks. Suspense in AppLayout (page
area) and ParentPortal.

**Hosting/deploy** (`4a5558b`, `d88d20f`, `5d1fa36`, `1e4ae5c`, `94d4f6e`):
interceptor fixes (see §7); `_redirects` added then removed; `npm run deploy` script.

---

## 10. Known-good vs. outstanding

### Verified working (static trace / typecheck; not all run live)
- K-12 flows: enrollment, transfers, promotion, attendance, fees, guardians, results
  (finalize/reopen), report cards, calendar/classes/timetable, CBT, messaging.
- Capability strings aligned to the `flow_execute` contract after phase8.

### Outstanding / next steps
- **Deploy the Paystack edge functions** (§3) — online payments won't work until then.
- **Historical-results import only covers results**; migrating other tertiary data
  (transcripts, course regs) is not built.
- **Report-card enrichment is K-12 only** — tertiary transcripts are a separate surface.
- **School Profile is K-12 only** (`/k12/school`); tertiary has its own Setup page.
- **Messaging is staff↔student** — not extended to parents.
- **Attendance→guardian alerts** are in-portal only (no SMS; SMS is Herald's job).
- **Inventory/expenses tracking** (FlexiSAF Premium parity) — not built.
- **Manual results entry saves one subject at a time** (by design). A single
  all-subjects grid is a possible UI variation.
- **Lint baseline:** ~200 pre-existing lint issues repo-wide (mostly
  `react-hooks/set-state-in-effect`, `no-explicit-any`). Not blocking; typecheck is
  clean. New code this session added no new categories.
- **Git history contains secrets** in old commits (pre-`dd088ff` "scrub"). Keep the
  repo **private**; do not make it public (that's why we didn't use GitHub Pages).
- **Bundle still ~577 kB** main chunk (vendor: React + Supabase + Dexie). Fine; further
  splitting is diminishing returns.

---

## 11. Immediate next actions (user's stated plan)
1. Run locally, confirm (`npm run preview`).
2. `npm run build` → `dist/`.
3. Cloudflare Pages **Direct Upload** the `dist/` folder (project `regentos`).
4. Wire the domain: move DNS to Cloudflare, attach `regentos.` (app) + apex (marketing).
5. Then resume fixes/features in a fresh working folder using this doc as context.

**Reminder:** apply Supabase migrations phase5→phase11 (§3) against the
`rmyjqgvftbaofhhefvin` project, and deploy the Paystack edge functions, before
treating the backend as complete.
