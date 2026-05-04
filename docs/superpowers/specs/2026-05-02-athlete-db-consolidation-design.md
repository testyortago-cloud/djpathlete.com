# Athlete DB Consolidation — Design Spec

**Date:** 2026-05-02
**Status:** Draft, ready for plan-drafting
**Roadmap reference:** `docs/superpowers/plans/2026-05-02-enterprise-upgrade-roadmap.md` — Phase 2 (weeks 5–6)
**Source repo audited:** `../athlete-performance/` (https://github.com/testyortago-cloud/athlete-performance)
**Target:** This djpathlete repo

---

## Problem statement

Darren currently runs two systems for client/athlete data:
1. **Airtable** — operational source-of-truth for users, athletes, sports, metric definitions, testing sessions, trials, injuries, daily load, wellness, goals, journals
2. **`athlete-performance` Next.js app** — Power BI-style dashboards built on top of Airtable + a Supabase analytics mirror

Enterprise-tier scope (per `docs/DJP-AI-Automation-Plan.md` lines 1417–1457) calls for the athlete database to live "directly in the platform" with no per-user fees, no record limits, and AI integration. We need to:
1. Port the athlete-performance app into djpathlete (admin/coach/client routes under existing route groups)
2. Migrate the Airtable data into Supabase as the new source of truth
3. Decommission Airtable
4. Keep djpathlete's existing fitness-coaching surface (client_profiles, programs, assessments, payments, events, shop) intact

---

## Audit findings

### Source repo stack

| Aspect | Source (`athlete-performance`) | Target (djpathlete) | Compatibility |
|---|---|---|---|
| Next.js | 16.1.6 | 16.x | ✅ Match |
| React | 19.2.3 | 19.2.3 | ✅ Match |
| Tailwind | v4 | v4 | ✅ Match |
| NextAuth | v5 beta | v5 beta | ✅ Match |
| Supabase | `@supabase/supabase-js` | `@supabase/supabase-js` + `@supabase/ssr` | ✅ Match |
| Charts | recharts | recharts | ✅ Match |
| Tests | vitest | vitest | ✅ Match |
| Code layout | `src/` directory | root-level (no `src/`) | ⚠️ Convert |
| State | zustand (4 stores) | none repo-wide | ⚠️ Decision needed |
| UI components | custom (`Button`, `Card`, `Modal`, etc.) | shadcn/ui | ⚠️ Port-then-refactor |
| Brand | black + white "premium sports tech" | Green Azure + Gray Orange + Lexend | ⚠️ Re-tokenize |

### Source repo surface (what actually exists)

**Routes (`src/app/`):**
- `(auth)` — login, forgot-password, reset-password
- `(dashboard)` — dashboard, athletes (list + detail with goals/journal/wellness/analytics), injuries (list + kanban + detail), load-monitoring (list + detail + batch + daily forms), profile, settings, sports (list + detail with metric category/metric forms), testing (list + detail + new-session), programs (list + detail), analytics/comparisons, analytics/risk
- `api/` — `auth/[...nextauth]`, `auth/forgot-password`, `auth/reset-password`, `athletes-search`, `sync` (manual Airtable→Supabase sync trigger)
- `p/[id]` — public read-only athlete profile

**Services (`src/lib/services/` — 13 files, ~2,100 LoC):**
- `analyticsService.ts` (1,016 LoC — the heavyweight, owns all dashboard queries)
- `athleteService`, `dailyLoadService`, `goalService`, `injuryService`, `journalService`, `metricService`, `programService`, `settingsService`, `sportService`, `syncService`, `testingSessionService`, `userService`, `wellnessService`

**Components (`src/components/`):**
- `charts/` — AcwrGauge, AreaChart, BarChart, **BodyMap**, CalendarHeatmap, ChartCard, LineChart, RadarChart, Sparkline
- `dashboard/` — AlertsPanel, FilterBar, KpiCard, MetricSlicer
- `layout/` — AppShell, Header, Sidebar, ContentArea, MobileBottomNav, MobileMenuOverlay, PageHeader, SidebarNavItem, SidebarSubNav
- `tables/` — InteractiveTable, ColumnFilter, TableBody, TableHeader, TablePagination
- `ui/` — Avatar, Badge, Button, Card, CollapsibleCard, Dropdown, EmptyState, HelpTip, Input, Modal, PhotoUpload, SearchInput, Select, Skeleton, Toast, Tooltip
- `forms/` — ResetPasswordForm, UserForm
- Standalone — `CommandPalette`, `OnboardingTour`, `Stopwatch`

**Stores (`src/stores/` — zustand):**
- `dashboardStore`, `notificationPrefsStore`, `notificationStore`, `onboardingStore`

**Hooks:** `useDashboardFilters`, `useDebounce`, `useMediaQuery`

### Source schema (`supabase/migration.sql` + `migration_phase4.sql`)

**Core tables (TEXT primary keys = Airtable record IDs):**
- `sports` — sport definitions
- `athletes` — sport athletes (separate concept from djpathlete's `client_profiles`)
- `metric_categories` — sport-scoped metric groups
- `metrics` — per-sport metric definitions, with units, derived/formula support, `best_score_method`, `trial_count`
- `testing_sessions` — testing event per athlete
- `trial_data` — 3-trial captures per metric per session, plus `best_score`, `average_score`
- `injuries` — type/illness, mechanism, body region, days lost
- `daily_load` — RPE 1–10, duration, training load, session type
- `users` — admin/coach/athlete roles (TEXT id from Airtable)
- `sync_log` — Airtable→Supabase sync audit
- `wellness_entries` — sleep hours, sleep quality, soreness, fatigue, stress, mood (UUID PK, direct Supabase, not synced)
- `perceived_recovery` — PRS 1–10 (UUID PK, direct Supabase)
- `settings` — generic key/value (UUID PK, direct Supabase)

**Views:**
- `athlete_performance_history` — joined trial data with athlete + sport + metric metadata
- `load_weekly_summary` — weekly load/monotony/strain per athlete
- `dashboard_kpi_summary` (materialized) — active athletes, active injuries, avg 7d load, sessions this month
- `injury_load_correlation` — ACWR + acute/chronic load at injury time
- `performance_comparisons` — per-metric ranking within sport

**RLS:** Phase 4 adds RLS policies using `auth.uid()::TEXT` (Supabase auth model). djpathlete uses NextAuth, not Supabase auth, so most RLS in djpathlete is currently advisory — these policies must be rewritten or dropped.

### djpathlete's existing schema (relevant overlap)

- `users` — UUID primary key, role enum `('admin', 'client')`, with first_name/last_name/email/password_hash/status
- `client_profiles` — UUID, FK to users, fitness-coaching client (date_of_birth, gender, sport, position, experience_level, goals, injuries, height, weight, emergency contacts)
- `programs` / `program_exercises` / `assignments` — fitness program system
- `assessments` / `assessment_questions` / `assessment_exercise_results` / `performance_assessments` — assessment engine
- `exercise_progress` — per-set progress tracking
- `notifications` / `notification_preferences`
- `events`, `event_signups`, `bookings` — event system
- `payments`, `subscriptions`
- `shop_*` (10 tables) — merch shop
- 94 migrations total

---

## Decisions

These are the load-bearing calls. Lock these before drafting plans.

### D1. Athletes are a separate domain, NOT merged into `client_profiles`

The two domains are semantically different:
- **`client_profiles`** = paying fitness-coaching clients buying programs (Comeback Code, Rotational Reboot, etc.)
- **`athletes`** = sport athletes whose performance/injuries/load Darren tracks (may overlap with clients but conceptually distinct)

**Decision:** Keep both. Port `athletes` and its dependent tables wholesale, prefixed where needed. Do NOT touch `client_profiles`.

**Linkage:** Add an optional `client_profile_id UUID NULL REFERENCES client_profiles(id)` column on `athletes` so an athlete can be linked to a coaching client when applicable. This unlocks Phase 4 reporting that can join training-app retention data with athlete performance.

### D2. Convert TEXT primary keys to UUID, preserve Airtable IDs

Source uses Airtable record IDs (e.g. `recXxxxxxxxxx`) as TEXT PKs. djpathlete uses UUID consistently.

**Decision:** During migration, generate UUIDs for every row. Preserve the original Airtable ID in a `legacy_airtable_id TEXT` column with a unique index, so:
- Cross-references between rows can be re-resolved during the migration
- Future debugging against Darren's Airtable archives is possible

### D3. Extend `users.role` enum, do NOT introduce a separate auth domain

Source has `admin | coach | athlete`. djpathlete has `admin | client`.

**Decision:** Extend djpathlete's enum to `('admin', 'client', 'coach', 'athlete')`. Migration:
```sql
ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'client', 'coach', 'athlete'));
```

**Athlete login:** Out-of-scope for Phase 2. Source repo supports athlete login but Darren's actual usage today is admin/coach login only (athletes are records, not users). Phase 2 ships with `athlete` role added to enum but no athlete-facing routes. Athlete login can be a follow-up if/when needed.

**Coach role:** In-scope for Phase 2. Coach RLS in source repo (read-all, write-own) is the right pattern.

### D4. Auth source-of-truth is djpathlete's `users` table, not Airtable

Source repo's `lib/auth.ts` reads users from Airtable via `getUserByEmail`. Migration:
- Move all source users into djpathlete's `users` table during migration
- Reuse djpathlete's existing NextAuth v5 + `lib/auth.ts` + `lib/auth-helpers.ts`
- Drop source's `src/lib/auth.ts`, `auth.config.ts`, and the `[...nextauth]` API route

### D5. Drop `lib/airtable.ts` and `syncService.ts` entirely after migration

These exist solely to read from / write to Airtable. After Phase 2, Supabase is source of truth. The one-shot migration script is the only Airtable reader we keep.

### D6. RLS rewrite, not RLS port

Source RLS uses `auth.uid()::TEXT` (Supabase auth). djpathlete uses NextAuth JWTs and currently does authorization in middleware + DAL, not in RLS. Existing djpathlete RLS policies on `client_profiles` etc. are inert (`auth.uid()` returns null without Supabase auth).

**Decision:** Do not port source RLS policies. Authorization for new athlete tables happens in:
1. Middleware (`middleware.ts`) — gate `/admin/*` and `/coach/*` routes
2. DAL (`lib/db/athletes.ts` etc.) — server-side role checks before queries
3. Service-role Supabase client for admin operations (existing pattern in `lib/supabase.ts`)

### D7. Custom UI components stay during port, refactored to shadcn in a later sub-phase

Source has its own `Button`, `Card`, `Modal`, `Input`, `Select`, `Avatar`, `Badge`, `Skeleton`, `Toast`, `Tooltip`. djpathlete uses shadcn. Refactoring during the port multiplies risk.

**Decision:** Port source components as-is into `components/athlete/ui/` namespace. Schedule a follow-up sub-phase (Phase 2.6) to migrate athlete pages to shadcn equivalents. Brand tokens (colors/fonts) are re-tokenized during the port; component shape stays.

### D8. zustand stays, scoped to athlete admin pages only

Source uses zustand for 4 stores. djpathlete has no repo-wide state library.

**Decision:** Add zustand as a dependency. Port the 4 stores into `stores/athlete/`. Do not introduce zustand to other parts of djpathlete. If a future need arises in non-athlete code, decide then.

### D9. Brand re-tokenization during the port

Source uses black + white "premium sports tech." djpathlete uses Green Azure + Gray Orange + Lexend fonts.

**Decision:** During port, replace:
- All hardcoded `#000`, `#FFF`, `#999`, `#1A1A1A`, `#222` etc. with semantic Tailwind tokens (`bg-primary`, `text-primary-foreground`, `text-muted-foreground`, etc.) per `app/globals.css` `@theme inline` block
- All inline `fontFamily` references with `font-heading` / `font-body` / `font-mono` Tailwind utilities
- Logo asset — use existing djpathlete brand asset, not the source's "djp ATHLETE" wordmark

This is non-negotiable per project conventions in `CLAUDE.md` + memory.

### D10. Route placement

| Source path | djpathlete target |
|---|---|
| `(dashboard)/dashboard` | merge into existing `(admin)/admin/page.tsx` as a new "Performance" tab/section, OR new `(admin)/admin/athletes/dashboard/page.tsx` |
| `(dashboard)/athletes` | `(admin)/admin/athletes/page.tsx` |
| `(dashboard)/athletes/[id]` | `(admin)/admin/athletes/[id]/page.tsx` |
| `(dashboard)/sports` | `(admin)/admin/athletes/sports/page.tsx` |
| `(dashboard)/sports/[id]` | `(admin)/admin/athletes/sports/[id]/page.tsx` |
| `(dashboard)/testing` | `(admin)/admin/athletes/testing/page.tsx` |
| `(dashboard)/testing/[id]` | `(admin)/admin/athletes/testing/[id]/page.tsx` |
| `(dashboard)/testing/new` | `(admin)/admin/athletes/testing/new/page.tsx` |
| `(dashboard)/injuries` | `(admin)/admin/athletes/injuries/page.tsx` |
| `(dashboard)/injuries/[id]` | `(admin)/admin/athletes/injuries/[id]/page.tsx` |
| `(dashboard)/load-monitoring` | `(admin)/admin/athletes/load/page.tsx` |
| `(dashboard)/load-monitoring/[id]` | `(admin)/admin/athletes/load/[id]/page.tsx` |
| `(dashboard)/programs` | **DROP** — duplicate of djpathlete's existing `(admin)/admin/programs/`. The athlete repo's `programs` is for sport training programs, but djpathlete's existing `programs` is more developed. **Action:** review whether sport "training programs" need a separate concept or can re-use existing programs with a `discipline` flag. Spec follow-up. |
| `(dashboard)/analytics/comparisons` | `(admin)/admin/athletes/analytics/comparisons/page.tsx` |
| `(dashboard)/analytics/risk` | `(admin)/admin/athletes/analytics/risk/page.tsx` |
| `(dashboard)/profile`, `settings` | **DROP** — djpathlete already has user profile/settings pages |
| `(auth)/*` | **DROP** — djpathlete's auth is canonical |
| `api/auth/*` | **DROP** |
| `api/athletes-search` | `app/api/athletes/search/route.ts` |
| `api/sync` | **DROP** after migration |
| `p/[id]` (public profile) | **DECISION DEFERRED** — does Darren want public athlete profiles? Default: drop for Phase 2, revisit later. |

**Sidebar:** Add a new `Athletes` collapsible group to `components/admin/AdminSidebar.tsx` containing all the sub-pages above.

### D11. Migration data flow

Source uses Airtable as the operational DB and a thin Supabase mirror for analytics. We collapse to Supabase only.

**Migration ordering (FK-respecting):**
1. `sports`
2. `metric_categories` (FK → sports)
3. `metrics` (FK → metric_categories, sports)
4. `users` (UPSERT: existing djpathlete users matched by email, new ones added with role='coach' or 'athlete')
5. `athletes` (FK → sports, users via coach_id; optional FK → client_profiles by email match)
6. `testing_sessions` (FK → athletes)
7. `trial_data` (FK → testing_sessions, metrics)
8. `injuries` (FK → athletes)
9. `daily_load` (FK → athletes)
10. `wellness_entries` (FK → athletes) — read from Airtable's `Wellness_Checkins`
11. Goals + Journal entries (in-source service files exist; tables don't appear in `migration.sql` — they're either Airtable-only or in another file)

**Migration script:** `scripts/migrate-athlete-data.ts`. Reads Airtable via the source's existing `airtable` package, writes via djpathlete's service-role Supabase client. Idempotent (UPSERTs by `legacy_airtable_id`). Produces a verification report (counts per table + sample-row spot checks).

**Goals + Journal Entries:** Source services exist (`goalService.ts`, `journalService.ts`) but no DDL appears in `migration.sql` or `migration_phase4.sql`. Pre-plan-1 work: read both service files to extract their Supabase schema, OR confirm they're Airtable-only. Add tables in the migration if needed.

---

## In-scope features

| Feature (per plan doc) | Provided by |
|---|---|
| Athlete Performance Database | New `athletes` + `metrics` + `testing_sessions` + `trial_data` tables |
| Client Profiles (sport-side) | Existing djpathlete `client_profiles` (untouched) + new `athletes` (sport-side) |
| Custom Data Fields | `metric_categories` + `metrics` (sport-scoped, typed, with units + derived formulas) |
| Progress Dashboards | Recharts-based dashboards ported from `analyticsService.ts` (1,016 LoC) |
| Data Export (CSV/PDF) | Source has `lib/utils/csvExport.ts`. PDF export added in Phase 4 (Reporting suite). |
| Client Portal Integration | Linked via `athletes.client_profile_id` (data view) — actual UI extension deferred unless Darren wants it in Phase 2 |
| Replaces Airtable | Migration script + `lib/airtable.ts` removal |
| Training App Reporting (data side) | `athletes ↔ client_profiles` link enables Phase 4 reports to read both |

## Out-of-scope (deferred)

- Athlete login (D3) — schema-ready, no routes
- Public athlete profiles (`/p/[id]`) (D10) — drop for now
- Re-using djpathlete `programs` for sport training programs (D10) — needs follow-up spec
- shadcn refactor of ported components (D7) — Phase 2.6 follow-up
- PDF athlete reports (Phase 4 Reporting suite owns this)
- Stripe revenue tracking (Phase 5)

---

## Sub-phase breakdown (for plan-drafting)

Each sub-phase produces a separate plan under `docs/superpowers/plans/`. Each ships independently.

### Phase 2.1 — Schema port + migration prep
**Output:** Plan `2026-05-XX-athlete-consolidation-phase1-schema.md`
- Add 8+ new Supabase migrations (numbered after `00094`):
  - `sports`, `metric_categories`, `metrics` (with `legacy_airtable_id` + UUID PKs)
  - `athletes` (with `client_profile_id` FK option, `coach_id` FK to users)
  - `testing_sessions`, `trial_data`
  - `injuries`, `daily_load`
  - `wellness_entries`, `perceived_recovery`
  - Goals/Journals (after pre-work confirms schema)
  - Extend `users.role` enum to include `coach` and `athlete`
  - All views: `athlete_performance_history`, `load_weekly_summary`, `dashboard_kpi_summary`, `injury_load_correlation`, `performance_comparisons`
- Drop or no-op all Phase 4 source RLS policies

### Phase 2.2 — DAL port
**Output:** Plan `2026-05-XX-athlete-consolidation-phase2-dal.md`
- Port 13 service files into `lib/db/`:
  - `lib/db/sports.ts`, `lib/db/athletes.ts`, `lib/db/metrics.ts`, `lib/db/metric-categories.ts`
  - `lib/db/testing-sessions.ts`, `lib/db/trial-data.ts`
  - `lib/db/injuries.ts`, `lib/db/daily-load.ts`
  - `lib/db/wellness-entries.ts`, `lib/db/perceived-recovery.ts`
  - `lib/db/athlete-goals.ts`, `lib/db/athlete-journal.ts`
  - `lib/db/athlete-analytics.ts` (the big one — split if it exceeds ~500 LoC)
- Each function uses djpathlete's existing Supabase client patterns from `lib/supabase.ts`
- Add Zod validators in `lib/validators/`: `athlete.ts`, `metric.ts`, `testing-session.ts`, `injury.ts`, `daily-load.ts`, `wellness.ts`

### Phase 2.3 — Routes + components port
**Output:** Plan `2026-05-XX-athlete-consolidation-phase3-routes.md`
- Move all `(dashboard)/...` routes per the table in D10
- Port components to `components/athlete/` (ui, charts, dashboard, tables) — keep source's component shape, re-tokenize colors/fonts only
- Port hooks to `hooks/athlete/`
- Port stores to `stores/athlete/` + add zustand dependency
- Wire NextAuth v5 session into ported pages (replace source's `auth()` calls if signature differs)
- Add `Athletes` collapsible group to `components/admin/AdminSidebar.tsx`
- Update `middleware.ts` if new role gates are needed for `/admin/athletes/*`

### Phase 2.4 — Airtable migration script
**Output:** Plan `2026-05-XX-athlete-consolidation-phase4-airtable-migration.md`
- Write `scripts/migrate-athlete-data.ts`
- Read Airtable tables: Users, Athletes, Sports, Metric_Categories, Metrics, Testing_Sessions, Trial_Data, Injuries, Daily_Load, Wellness_Checkins, Goals, Journal_Entries (skip Settings — handled in app config)
- UPSERT into Supabase by `legacy_airtable_id`
- Verification report: row counts per table, 5 random spot-checks per table comparing Airtable raw vs Supabase row
- Dry-run mode (`--dry-run`) that prints intended writes without committing
- Run against Darren's live Airtable in staging env first, then production
- Decommission: drop `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` env vars after success; remove `airtable` npm dep; delete `lib/airtable.ts` if any source-derived references remain

### Phase 2.5 — Verification + cancellation handoff
**Output:** Plan `2026-05-XX-athlete-consolidation-phase5-verification.md`
- E2E smoke tests on ported routes (Playwright)
- Manual QA checklist for Darren (10–15 spot-checks across athletes, injuries, load, testing)
- Documentation update: README + CLAUDE.md notes about the new athlete domain
- Hand off Airtable subscription cancellation to Darren

### Phase 2.6 (optional follow-up) — shadcn refactor
**Output:** Plan `2026-05-XX-athlete-consolidation-phase6-shadcn-refactor.md`
- Migrate `components/athlete/ui/*` to shadcn equivalents
- Defer until Phase 2.5 ships and athlete pages are stable

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Goals + Journal schema undocumented in source migrations | Pre-work for Phase 2.1: read `goalService.ts` + `journalService.ts` to extract DDL. If still unclear, ask Darren. |
| `analyticsService.ts` is 1,016 LoC — single file too large for djpathlete conventions | Split into `lib/db/athlete-analytics/{queries,kpis,risk,comparisons}.ts` during DAL port |
| Source RLS policies leak into ported migrations and break djpathlete's NextAuth model | D6: explicitly do not port RLS. Plan 2.1 step: write a comment block explaining authorization moved to middleware + DAL. |
| zustand introduction may conflict with future state management decisions | D8: scope to athlete pages. Document in CLAUDE.md. |
| ID-type mismatch (TEXT → UUID) breaks any code that hardcoded `recXxx` strings | grep ported code for `'rec` and `legacy_airtable_id` references; verify FK chains |
| Custom field `metrics` model (sport-scoped) is more rigid than the plan-doc's "any data points" promise | Acceptable trade-off — it's still strictly more flexible than Airtable. If Darren wants free-form per-athlete fields later, add a `athlete_custom_fields` JSONB table in a follow-up. |
| RLS gap on new tables — middleware/DAL is the only line of defense | Code review + tests in Phase 2.5. Document the model in CLAUDE.md. |
| Airtable migration runs against Darren's live data without backup | Plan 2.4 step: `pg_dump` djpathlete pre-migration; export Airtable to CSV (already done in `airtable-csv/`) |
| `client_profiles ↔ athletes` linkage by email may produce false matches | Linkage is OPTIONAL nullable column; Phase 2 doesn't auto-link. Manual linking UI deferred or scripted by Darren. |

---

## Open questions for Darren (before plan-drafting)

1. **Public athlete profiles** (`/p/[id]`) — keep or drop?
2. **Athlete login** — needed in Phase 2, or punt?
3. **Sport "Training Programs"** — should they reuse djpathlete's existing `programs` table (with a `discipline` flag) or stay as a separate `sport_training_programs` table? Source has its own `programs` system but it's thin (53 LoC service).
4. **Goals + Journals tables** — confirm they exist in your Airtable today and what fields they have (we'll inspect via the source service code, but a sanity check helps).
5. **Migration timing** — staging-first migration runs against a Supabase branch / preview project, OK?

---

## Acceptance criteria (Phase 2 done when…)

- [ ] All routes from the D10 mapping live under djpathlete's `(admin)/admin/athletes/...`
- [ ] All 13 source services have djpathlete DAL equivalents under `lib/db/`
- [ ] All Airtable tables (Users, Athletes, Sports, Metric_Categories, Metrics, Testing_Sessions, Trial_Data, Injuries, Daily_Load, Wellness_Checkins, Goals, Journal_Entries) are imported into Supabase with row-count parity verified
- [ ] No code references `process.env.AIRTABLE_*`
- [ ] No `import` from `airtable` package outside the migration script
- [ ] All ported components use semantic Tailwind tokens; no hardcoded hex; no inline `fontFamily`
- [ ] `users.role` enum includes `coach` and `athlete`
- [ ] Admin sidebar shows new Athletes group with all sub-pages
- [ ] Migration script's verification report shows zero row-count mismatches
- [ ] Darren confirms Airtable subscription can be canceled

---

## Spec coverage check

Cross-checked against `docs/DJP-AI-Automation-Plan.md` lines 1417–1457 and the Enterprise Upgrade Roadmap Phase 2 acceptance criteria:

| Roadmap Phase 2 deliverable | Sub-phase covering it |
|---|---|
| Schema port from athlete-performance | 2.1 |
| DAL port (13 services) | 2.2 |
| Routes + UI port + brand re-tokenization | 2.3 |
| zustand store port | 2.3 |
| Airtable migration script | 2.4 |
| Auth unification on NextAuth v5 | 2.3 (drop source auth wiring) |
| Custom Data Fields | 2.1 (metric_categories + metrics tables) |
| Progress Dashboards | 2.3 (analytics routes) |
| CSV export | 2.2 (port `lib/utils/csvExport.ts` to `lib/exports/csv.ts`) |
| PDF export | Deferred to Phase 4 |
| Client Portal Integration | 2.1 (`client_profile_id` FK) — UI deferred unless requested |
| Cancel Airtable subscription | 2.5 |

All Phase 2 roadmap items mapped.
