# Athlete Performance Database — Core (Sub-project 1) Design Spec

**Status:** Draft — pending review
**Date:** 2026-05-13
**Author:** Brainstormed with Claude (superpowers brainstorming skill)
**Implementation cadence:** Driven via ralph-loop, committed directly to `main`

## 1. Background & Motivation

DJP Athlete currently captures client demographics, one-shot movement-screen questionnaires, and admin-driven multi-exercise performance assessment sessions. It does **not** capture:

- Daily readiness time-series (HRV, sleep quality, soreness, fatigue, mood)
- Longitudinal injury history beyond a snapshot blob on `client_profiles.injury_details`
- Standalone performance tests (e.g., drop jump on a single day) with PR/% change tracking

This spec covers Sub-project 1 of a three-part initiative to take the athlete profile "to the next level":

| # | Sub-project | Status |
|---|---|---|
| 1 | **Core Performance DB** | This spec |
| 2 | Coach Intelligence (training load, ACWR, monotony, strain, risk flags) | Future spec |
| 3 | Visualization & Engagement (body map, radar, streak heatmap, goals, badges, journal) | Future spec |

Sub-project 1 establishes the data foundation. Sub-projects 2 and 3 build analytics and visual polish on top.

## 2. Goals

- Athletes can log daily readiness in ≤30s via a simple form.
- Admin (Darren) can view an athlete's full performance picture on one hub page: readiness trend, active injuries, recent PRs, test history.
- Injuries are tracked as a real timeline (occurred → recovering → resolved) with rehab milestones.
- Performance tests support multi-trial inputs, auto-detect PRs, and surface % change from previous attempt.
- All data flows through the existing DAL pattern (`lib/db/`) and validator pattern (`lib/validators/`).

## 3. Non-Goals (Explicitly Out of Scope)

- ACWR, training monotony, training strain calculations — Sub-project 2.
- Automated risk flags and alerts — Sub-project 2.
- Clickable SVG body-map picker — Sub-project 3 (use a region dropdown for now).
- Radar chart, training-streak heatmap, goals, badges, journal — Sub-project 3.
- Wearable integrations (Apple Health, Whoop, Garmin) — future.
- Power-BI-style cross-filtering / drill-down dashboards — future.
- Athlete self-service test logging from a phone with photo/video upload — future polish.

## 4. Data Model

Four new tables plus one SQL view. All follow existing conventions: UUID PK, FK with cascade, `created_at` / `updated_at` timestamps with `update_updated_at_column()` trigger, indexes on `user_id` and date columns, and RLS enabled (admin full access, client read/write own rows).

### 4.1 `daily_readiness`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users.id | indexed |
| date | date | unique per (user_id, date) |
| sleep_hours | numeric(4,2) | nullable |
| sleep_quality | int (1–5) | CHECK 1–5 |
| soreness_overall | int (1–5) | |
| soreness_by_region | jsonb | `{hamstring:3, lower_back:2, …}` keys are body_region enum values |
| fatigue | int (1–5) | |
| mood | int (1–5) | |
| stress | int (1–5) | |
| hydration | int (1–5) | |
| resting_hr | int | nullable, bpm |
| hrv_ms | int | nullable, milliseconds |
| notes | text | nullable |
| readiness_score | numeric(5,2) | generated column, 0–100 composite (see §4.5) |
| created_at, updated_at | timestamptz | |

**Migration:** `00091_daily_readiness.sql`

### 4.2 `injuries`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users.id | indexed |
| body_region | enum | head, neck, shoulder, elbow, wrist, hand, chest, upper_back, lower_back, hip, glute, hamstring, quad, knee, calf, ankle, foot, other |
| side | enum | left, right, bilateral, n_a |
| injury_type | text | strain, sprain, contusion, fracture, tendinopathy, illness, other (free text — not enum, so coaches can be specific) |
| severity | enum | minor, moderate, severe |
| mechanism | text | nullable |
| description | text | nullable |
| date_occurred | date | required |
| date_resolved | date | nullable |
| days_lost | int | generated: `date_resolved - date_occurred` when resolved, else `CURRENT_DATE - date_occurred` |
| status | enum | active, recovering, resolved |
| rehab_milestones | jsonb | `[{name, target_date, completed_date, notes}]` |
| created_at, updated_at | timestamptz | |

**Migration:** `00092_injuries.sql`

### 4.3 `performance_tests`

Standalone, single-test logs. Separate from existing `performance_assessments` (which is an admin multi-exercise session workflow) — reasoning in §6.1.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users.id | indexed |
| test_type | enum | drop_jump, cmj, squat_jump, broad_jump, sprint_10m, sprint_20m, sprint_40m, sprint_5_10_5, t_test, beep_test, sit_reach, bench_press_1rm, back_squat_1rm, deadlift_1rm, pull_up_max, push_up_max, plank_hold, custom |
| custom_name | text | nullable, required when test_type='custom' |
| result_value | numeric(8,3) | the canonical result (best of trials by `best_method`) |
| result_unit | text | cm, m, sec, kg, lbs, reps, count, … |
| trial_values | jsonb | optional, e.g., `[4.2, 4.15, 4.18]` |
| best_method | enum | highest, lowest, mean, median. Defaulted from `TEST_TYPE_DEFAULTS` per test_type and treated as **canonical per test_type** — the validator rejects mixing methods for the same test_type per user. This guarantees PR comparisons are well-defined. |
| test_date | date | indexed |
| body_weight_kg | numeric(5,2) | nullable; populated for relative-strength context |
| notes | text | nullable |
| video_url | text | nullable |
| is_pr | boolean | computed at insert/update by DAL |
| pct_change_from_prev | numeric(6,2) | computed at insert/update by DAL |
| created_by | uuid FK → users.id | who logged it (admin or athlete) |
| created_at, updated_at | timestamptz | |

Index: `(user_id, test_type, test_date DESC)` for PR / prior-row lookups.

**Migration:** `00093_performance_tests.sql`

### 4.4 `performance_test_pr_view`

SQL view returning the current PR row per `(user_id, test_type)`, used by the admin hub's "PRs Shelf" card without a per-card subquery.

```sql
CREATE VIEW performance_test_pr_view AS
SELECT DISTINCT ON (user_id, test_type)
  user_id, test_type, custom_name, result_value, result_unit, test_date, id AS test_id
FROM performance_tests
ORDER BY user_id, test_type,
  CASE best_method
    WHEN 'highest' THEN -result_value
    WHEN 'lowest'  THEN  result_value
    ELSE -result_value
  END,
  test_date DESC;
```

**Migration:** `00094_performance_test_pr_view.sql`

### 4.5 Readiness score formula (generated column)

A composite 0–100 score for at-a-glance display.

```
readiness_score =
  ( normalize(sleep_quality, 1, 5) * 25 +
    normalize(soreness_overall, 5, 1) * 20 +    -- inverted: 5 sore = 0 pts
    normalize(fatigue, 5, 1) * 20 +             -- inverted
    normalize(mood, 1, 5) * 15 +
    normalize(stress, 5, 1) * 10 +              -- inverted
    normalize(hydration, 1, 5) * 10 )
```

Where `normalize(value, min, max)` maps to 0–1. HRV/resting_hr are **not** included in v1 — they're optional fields. We can incorporate them once we have a baseline per athlete (Sub-project 2 work).

Implemented as a Postgres `GENERATED ALWAYS AS (...) STORED` column so queries can `ORDER BY readiness_score` and the value is always consistent with inputs.

## 5. Validators (`lib/validators/`)

Follow the existing pattern: Zod schemas, enum constants, label maps, type exports.

- **`daily-readiness.ts`**
  - `READINESS_FIELDS` constant (with min/max/inverted flag for the form)
  - `dailyReadinessSchema` — server schema with all DB fields
  - `readinessFormSchema` — form schema (omits computed fields)
  - `DailyReadinessFormData` type export

- **`injury.ts`**
  - `BODY_REGIONS`, `INJURY_SIDES`, `INJURY_SEVERITIES`, `INJURY_STATUSES` enum constants
  - `BODY_REGION_LABELS` label map
  - `injurySchema`, `injuryFormSchema`, `rehabMilestoneSchema`
  - `InjuryFormData`, `RehabMilestoneFormData` types

- **`performance-test.ts`**
  - `TEST_TYPES` enum (extensible — new entries are just an enum value + a default-unit/best-method row in a `TEST_TYPE_DEFAULTS` map)
  - `TEST_TYPE_LABELS` and `TEST_TYPE_DEFAULTS` maps
  - `performanceTestSchema`, `performanceTestFormSchema`
  - `PerformanceTestFormData` type

## 6. Data Access Layer (`lib/db/`)

One file per table, mirroring existing files like `client-profiles.ts` and `performance-assessments.ts`.

### 6.1 Why not extend `performance_assessments`?

`performance_assessments` models an admin **session** with status (draft/in_progress/completed) and a child `performance_assessment_exercises` collection. Standalone tests (a single drop jump logged on a Tuesday by the athlete themselves) don't fit that shape — they're 1 row, not a parent+children with workflow state. Forcing them through `performance_assessments` would require creating a synthetic "session" per test, which makes queries (PRs, trends, % change) awkward. They stay parallel.

Future work could roll a completed `performance_assessment_exercises` row into a `performance_tests` row at save-time so PR/trend logic still sees it — flagged as Sub-project 2.

### 6.2 `daily-readiness.ts`

- `getByUserAndDate(userId, date) → DailyReadiness | null`
- `listByUser(userId, { from, to }) → DailyReadiness[]`
- `upsert(userId, date, data) → DailyReadiness` — one row per day, idempotent
- `getLatest(userId) → DailyReadiness | null`
- `getReadinessTrend(userId, days = 30) → { date, readiness_score }[]`

### 6.3 `injuries.ts`

- `listByUser(userId, { status? }) → Injury[]`
- `getActive(userId) → Injury[]` — convenience for status IN (active, recovering)
- `getById(id) → Injury | null`
- `create(userId, data) → Injury`
- `update(id, data) → Injury`
- `resolve(id, dateResolved) → Injury` — sets status='resolved', date_resolved
- `addMilestone(id, milestone) → Injury` — append to rehab_milestones jsonb
- `completeMilestone(id, milestoneIndex, completedDate, notes?) → Injury`
- `getInjuryTimeline(userId) → Injury[]` — ordered by date_occurred DESC

### 6.4 `performance-tests.ts`

- `listByUser(userId, { testType?, from?, to? }) → PerformanceTest[]`
- `getById(id) → PerformanceTest | null`
- `create(userId, data, createdBy) → PerformanceTest`
  - **Trial reduction:** if `trial_values` is provided, `result_value` is computed from it according to `best_method` (highest/lowest/mean/median) — explicit `result_value` in payload still wins if both are provided.
  - **PR detection:** compares this row's `result_value` against prior rows for `(user_id, test_type)`. For `best_method='highest'` → PR if greater than current max; for `'lowest'` → PR if less than current min. (mean/median are reductions on trials *within* a row, not comparisons between rows — for PR purposes they default to "higher is better" unless the `TEST_TYPE_DEFAULTS` overrides.)
  - **`pct_change_from_prev`:** looks up the immediately previous test row of the same `(user_id, test_type)` ordered by `test_date DESC` and computes `((current - prev) / prev) * 100`. Sign is informational only — the UI interprets direction based on `best_method`.
- `update(id, data) → PerformanceTest` — recomputes PR/% change for this row AND any rows newer than it for the same test_type (their lineage changed)
- `delete(id)` — also recomputes PR/% change for newer rows of the same test_type
- `getPRsByUser(userId) → PerformanceTest[]` — reads from `performance_test_pr_view`
- `getTestHistory(userId, testType) → PerformanceTest[]` — ordered by test_date ASC for trend charts

## 7. Routes

Follow existing route-group patterns:

### 7.1 Client side (`app/(client)/client/`)

- `readiness/page.tsx` — today's check-in form + 7-day mini sparkline
- `readiness/history/page.tsx` — full history table + 30/90-day line chart
- `injuries/page.tsx` — list (active + history) + "report new injury" button
- `injuries/[id]/page.tsx` — detail view, rehab milestones, notes
- `performance/page.tsx` — test log entry form + history dropdown filter
- `performance/[testType]/page.tsx` — focused history chart for one test type

### 7.2 Admin side (`app/(admin)/admin/`)

- `clients/[id]/performance/page.tsx` — **the Athlete Performance Hub** (tabbed)
  - `?tab=overview` (default): readiness gauge, active injuries count, recent PRs, last test
  - `?tab=readiness`: 30-day chart + day-detail drawer
  - `?tab=injuries`: timeline view
  - `?tab=tests`: test history grouped by type with PR markers and trend sparklines
- `clients/[id]/performance/log-test/page.tsx` — admin logs a test for the client (in-person testing day workflow — most common path)
- `clients/[id]/performance/injuries/new/page.tsx` — admin reports an injury on behalf of the client

## 8. API Routes (`app/api/`)

Server Actions are preferred for form submissions. REST routes only for chart data endpoints that need to be called from client components.

- POST `/api/readiness` — client self-log (server action wrapper is fine here too)
- POST `/api/injuries`, PATCH `/api/injuries/[id]`
- POST `/api/injuries/[id]/milestones`, PATCH `/api/injuries/[id]/milestones/[index]`
- POST `/api/performance-tests`, PATCH `/api/performance-tests/[id]`, DELETE `/api/performance-tests/[id]`
- GET `/api/clients/[id]/performance/summary` — powers the hub overview tab; returns `{ readiness, activeInjuries, recentPRs, lastTest }`
- GET `/api/clients/[id]/readiness/trend?days=30`
- GET `/api/clients/[id]/tests/[testType]/history`

## 9. UI Components

New components — composed by the route pages.

### 9.1 `components/admin/performance/`

- `ReadinessScoreGauge.tsx` — Recharts `<RadialBarChart>`, color-banded (red 0–40, amber 41–70, green 71–100 — using `--error`, `--warning`, `--success`)
- `ReadinessTrendChart.tsx` — Recharts `<LineChart>` with date range selector
- `ActiveInjuriesCard.tsx` — compact list of active/recovering injuries with status pill, days-since
- `InjuryTimelineList.tsx` — full chronological timeline
- `InjuryRehabMilestoneList.tsx` — checklist UI for milestones
- `PerformanceTestCard.tsx` — single test type: latest value, PR badge if applicable, mini sparkline, click to drill in
- `PerformanceTestHistoryChart.tsx` — Recharts line chart for one test type, PR points marked
- `PRsShelfCard.tsx` — grid of best-ever values across all test types
- `AthletePerformanceHub.tsx` — top-level layout for the hub page, hosts the tabs

### 9.2 `components/client/performance/`

- `LogReadinessForm.tsx` — single-page form (React Hook Form + Zod), uses sliders for 1–5 ratings
- `LogTestDialog.tsx` — shadcn `<Dialog>` with test-type selector, trial inputs, auto-computes best
- `ReportInjuryForm.tsx` — body region dropdown (no SVG body map in v1), severity, dates, notes
- `MyReadinessHistory.tsx` — client-facing version of the trend chart
- `MyPerformanceTests.tsx` — client-facing test history

### 9.3 Shared
- `components/shared/StatusPill.tsx` — generic pill for active/recovering/resolved, PR badge, etc. (uses semantic Tailwind classes — `bg-success/10 text-success`, etc.)

Brand colors stay Green Azure (`oklch(0.30 0.04 220)`) primary, Gray Orange (`oklch(0.70 0.08 60)`) accent. Status semantics use the existing `--success`, `--warning`, `--error` CSS vars.

## 10. Migrations

Applied via `mcp__supabase__apply_migration` per project convention (CLI not linked).

1. `00091_daily_readiness.sql` — table + readiness_score generated column + RLS + trigger
2. `00092_injuries.sql` — table + body_region/side/severity/status enums + days_lost generated column + RLS + trigger
3. `00093_performance_tests.sql` — table + test_type/best_method enums + index on (user_id, test_type, test_date DESC) + RLS + trigger
4. `00094_performance_test_pr_view.sql` — view

RLS policy template (per file):
- Admin role: `auth.jwt() ->> 'role' = 'admin'` → full access
- Client: `user_id = auth.uid()` → SELECT, INSERT, UPDATE on own rows

## 11. Testing

- **Vitest unit tests** (`__tests__/lib/db/`):
  - `daily-readiness.test.ts` — upsert idempotency, trend ordering, readiness_score correctness against fixture inputs
  - `injuries.test.ts` — create → addMilestone → completeMilestone → resolve, status transitions, days_lost computation
  - `performance-tests.test.ts` — PR detection (highest + lowest methods), % change computation, recomputation on update/delete
- **Vitest validator tests** (`__tests__/lib/validators/`) — schema accept/reject cases for each form
- **Playwright e2e** (`__tests__/e2e/athlete-performance.spec.ts`):
  - Athlete logs readiness → admin opens hub → readiness card reflects today's score
  - Admin logs a drop-jump test → PR badge appears → second test with worse value → no PR badge → % change is negative
  - Admin reports injury → adds milestones → marks one complete → resolves injury → status flows correctly

## 12. Component Boundary Check

Each unit has a single purpose with a clear interface:

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| Validator (Zod schemas) | Validate form/server inputs | raw form data / API payload | typed valid data or ZodError |
| DAL (`lib/db/*`) | Read/write a single table | userId, filters, payloads | typed records, throws on error |
| API route / Server Action | HTTP/RPC entry | request body, session | DAL calls + response shaping |
| Page component | Compose UI + fetch | route params, search params | rendered React |
| UI card component | Render one slice of data | typed props | rendered React, emits events |

DAL functions don't import from `app/` (no Next.js coupling). UI components don't import from `lib/db/` directly — they go through API routes or server actions. This keeps every layer testable in isolation.

## 13. Risk & Open Questions

- **Readiness score formula** — the weights in §4.5 are a starting point. We may iterate after seeing real data. Generated column is easy to swap (DROP + ALTER ADD GENERATED).
- **Test type list extensibility** — adding a new sport-specific test means a Postgres enum ALTER + a TypeScript enum update + a row in `TEST_TYPE_DEFAULTS`. Acceptable for v1; consider moving to a `test_type_definitions` table in Sub-project 2 if Darren wants to define custom tests via UI.
- **Injuries — multi-region (e.g., bilateral lower back + hamstring)** — v1 uses a single `body_region` per row. A multi-region injury becomes two rows linked by description. Good enough; revisit if it becomes painful.
- **Athlete-vs-coach data entry permissions** — RLS grants athletes write access to their own rows. If we later want to lock test-logging to admins (so athletes can't inflate their PRs), we'll add a `created_by_role` check or move the INSERT policy to admins-only and have athletes "request" tests. Flagged for Sub-project 2.

## 14. Implementation cadence (ralph-loop)

Once the implementation plan is written (next step), the work will be executed via the ralph-loop plugin. One ralph iteration = one cohesive slice:

1. Migration applied (Supabase MCP) + types regenerated
2. Validator written + unit tests
3. DAL file written + unit tests
4. Server action / API route
5. Page + components
6. Commit directly to `main` (per user memory: solo dev, no feature branches)

Ralph will iterate the plan tasks autonomously with verification gates between slices.

## 15. Definition of Done for Sub-project 1

- [ ] All 4 migrations applied; types/database.ts regenerated
- [ ] 3 validator files with passing schema tests
- [ ] 3 DAL files with passing unit tests
- [ ] All API routes / server actions wired
- [ ] Client routes: `/client/readiness`, `/client/readiness/history`, `/client/injuries`, `/client/performance` functional
- [ ] Admin route: `/admin/clients/[id]/performance` hub with 4 tabs functional
- [ ] Admin log-test and report-injury flows functional
- [ ] Playwright e2e green: readiness round-trip, PR detection, injury lifecycle
- [ ] `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` all green
- [ ] Manual smoke test in dev server confirms hub renders for a seeded test client

When all checked, Sub-project 1 ships. We then re-brainstorm Sub-project 2 (Coach Intelligence).
