# Coach Intelligence (Sub-project 2) Design Spec

**Status:** Draft — pending review
**Date:** 2026-05-13
**Author:** Brainstormed with Claude (superpowers brainstorming skill)
**Builds on:** [Sub-project 1 — Athlete Performance Core](./2026-05-13-athlete-performance-core-design.md) (shipped)
**Implementation cadence:** Driven via ralph-loop, committed directly to `main`

## 1. Background & Motivation

Sub-project 1 shipped the data foundation: daily readiness, longitudinal injuries, standalone performance tests with PR/% change. The admin Athlete Performance Hub renders that data but offers **no derived analytics** — no training-load tracking, no risk signals, no week-over-week comparisons, no compliance tracking.

Sub-project 2 closes that gap. The coach (Darren) needs auto-generated signals about when an athlete is overtrained, undertrained, or at injury risk based on workload and readiness trends. Without it, the data sits inert.

## 2. Goals

- Athletes log daily training load in ≤15s (RPE + duration + type).
- Admin sees auto-computed ACWR, monotony, strain, compliance %, week-over-week deltas for any athlete.
- Risk flags are auto-generated on a fixed rule set and surface in the admin hub.
- Coach can acknowledge or dismiss flags to clear them.
- All math is pure functions in DAL — exhaustively unit-tested with fixtures.

## 3. Non-Goals (Explicitly Out of Scope)

- Body-map picker, radar chart, streak heatmap — Sub-project 3
- Goals, achievement badges, athlete journal — Sub-project 3
- Wearable ingestion (Whoop, Apple Health, Garmin) — future
- ML/learned risk modeling — v1 is rule-based with fixed thresholds
- Admin UI to edit threshold values — v1 uses code constants; future spec if needed
- Daily cron for rule evaluation — v1 evaluates synchronously after each `training_sessions` or `daily_readiness` insert
- Bulk historical backfill of risk flags — flags are generated forward from the moment Sub-project 2 ships

## 4. Data Model

Two new tables, no views. All math runs in DAL.

### 4.1 `training_sessions`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_user_id | uuid FK → users.id | indexed; ON DELETE CASCADE |
| date | date | indexed; allowed: one row per (user, date, session_type) — coach may want morning + evening sessions on the same day |
| session_type | TEXT + CHECK | gym, sport, field, conditioning, mobility, other |
| rpe | int (1–10) | CHECK 1..10 |
| duration_min | int | CHECK > 0 AND <= 600 |
| session_load | int | GENERATED ALWAYS AS (rpe * duration_min) STORED |
| notes | text | nullable |
| program_assignment_id | uuid FK → program_assignments.id | nullable, ON DELETE SET NULL — links the session to a scheduled program when applicable (drives compliance %) |
| created_at, updated_at | timestamptz | |

Composite unique constraint: `(client_user_id, date, session_type)`.

Indexes: `(client_user_id)`, `(client_user_id, date DESC)`, `(program_assignment_id)`.

**Migration:** `00132_training_sessions.sql` (00131 is `ads_agent_recommendation_types`, confirmed)

### 4.2 `risk_flags`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_user_id | uuid FK → users.id | indexed; ON DELETE CASCADE |
| flag_type | TEXT + CHECK | load_spike, fatigue, overtraining, high_strain, rpe_creep |
| severity | TEXT + CHECK | low, medium, high |
| message | text | human-readable summary (e.g., "ACWR 1.62 — high load spike") |
| evidence | jsonb | structured payload with raw values + window dates so the UI can drill in |
| status | TEXT + CHECK | open, acknowledged, dismissed |
| triggered_at | date | the date the rule fired (NOT necessarily today — see §6.2 dedupe) |
| created_at | timestamptz | |
| acknowledged_at | timestamptz | nullable |
| acknowledged_by | uuid FK → users.id | nullable, ON DELETE SET NULL |

Indexes: `(client_user_id)`, `(client_user_id, status)`, `(client_user_id, flag_type, triggered_at)` for the dedupe lookup.

**Migration:** `00133_risk_flags.sql`

### 4.3 Why no SQL views?

ACWR/monotony/strain need rolling windows (7-day, 28-day, weekly). They can be expressed as window functions in SQL, but:
- Volume is low (one user — Darren — with <100 clients, <1 session/client/day).
- Pure JS functions over a session-list array are sub-ms.
- Easier to test (fixtures in, expected numbers out).
- Easier to evolve thresholds and add metrics without migration churn.

If volume ever 10×s, a materialized view per (user, week) becomes the obvious upgrade.

## 5. Computation (`lib/coach-intel/`)

A new directory of pure modules. **No I/O, no Supabase, no React.** Inputs are arrays + dates; outputs are numbers and structured records. This is what gets tested.

### 5.1 Files

- `lib/coach-intel/load.ts`
  - `dailyLoads(sessions, fromDate, toDate) → { date, load }[]` — sums all sessions per day, filling 0 for missing dates
  - `rollingAverage(dailyLoads, windowDays) → { date, value }[]` — simple unweighted rolling mean
  - `acuteLoad(dailyLoads, asOf) → number` — 7-day mean ending on asOf
  - `chronicLoad(dailyLoads, asOf) → number` — 28-day mean ending on asOf
  - `acwr(dailyLoads, asOf) → number | null` — `acute / chronic`; null when chronic is 0

- `lib/coach-intel/monotony.ts`
  - `weeklyStats(dailyLoads, weekStart) → { totalLoad, mean, stdDev, monotony, strain }` — single ISO week. `monotony = mean / stdDev` (null when stdDev=0). `strain = totalLoad * monotony` (null when monotony null).

- `lib/coach-intel/week-over-week.ts`
  - `weekOverWeek(dailyLoads, currentWeekStart) → { current, previous, deltaPct }` — `current` = sum + mean RPE + session count for the current week; `previous` = the prior 7 days

- `lib/coach-intel/compliance.ts`
  - `compliance(scheduledAssignments, completedSessions, fromDate, toDate) → { scheduledCount, completedCount, pct }` — given an assignment window, counts completed sessions that link back via `program_assignment_id`

- `lib/coach-intel/evaluate-rules.ts`
  - `evaluateRules(input: { sessions, readiness, asOf }) → ProposedFlag[]` — pure rule evaluation. Returns the flags that *should* exist. Persistence + dedupe is the caller's job (DAL layer).

### 5.2 The rules (v1)

Module exports `RULES` array; each is `(input) => ProposedFlag | null`. Easy to add, easy to test. **Thresholds are named constants** in `lib/coach-intel/thresholds.ts`:

```ts
export const ACWR_DANGER = 1.5
export const READINESS_FATIGUE_THRESHOLD = 40
export const FATIGUE_CONSECUTIVE_DAYS = 3
export const WEEKLY_LOAD_SPIKE_PCT = 30
export const MONOTONY_HIGH = 2.0
export const RPE_CREEP_THRESHOLD = 8
export const RPE_CREEP_CONSECUTIVE_SESSIONS = 3
```

Rules:

| Flag type | Rule | Severity |
|---|---|---|
| load_spike | `acwr(asOf) > ACWR_DANGER` | high |
| fatigue | `readiness_score < READINESS_FATIGUE_THRESHOLD` on each of last `FATIGUE_CONSECUTIVE_DAYS` calendar days | medium |
| overtraining | `weekOverWeek.deltaPct > WEEKLY_LOAD_SPIKE_PCT` | high |
| high_strain | `weeklyStats(currentWeek).monotony > MONOTONY_HIGH` | medium |
| rpe_creep | last `RPE_CREEP_CONSECUTIVE_SESSIONS` sessions all have `rpe > RPE_CREEP_THRESHOLD` | low |

### 5.3 Why pure functions, not DAL functions?

Computation is the part most likely to evolve (weights, time windows, new metrics, ML eventually). Keeping it I/O-free means:
- 100% test coverage with fixtures, no Supabase mocks.
- Reusable later for batch backfill, exports, embedded analytics.
- Composable: the DAL just orchestrates "read data → call pure module → return".

## 6. Data Access Layer (`lib/db/`)

### 6.1 `training-sessions.ts`

- `getByUserAndDateAndType(clientUserId, date, sessionType) → TrainingSession | null`
- `listByUser(clientUserId, opts: { from?, to?, sessionType? }) → TrainingSession[]`
- `upsert(clientUserId, data) → TrainingSession` — idempotent on `(client_user_id, date, session_type)`
- `update(id, patch) → TrainingSession`
- `deleteOne(id) → void`
- `getLatest(clientUserId, n = 10) → TrainingSession[]` — for the RPE-creep rule

### 6.2 `risk-flags.ts`

- `listByUser(clientUserId, opts: { status?, flagType? }) → RiskFlag[]`
- `getOpenByUser(clientUserId) → RiskFlag[]`
- `getCountByUser(clientUserId, status = 'open') → number`
- `createIfNew(clientUserId, proposed) → RiskFlag | null` — **dedupe-aware**: returns null if a flag of the same `flag_type` already exists with `status = 'open'` and `triggered_at` within the last 7 days. This is critical — without it, every readiness/session insert would spam new flags.
- `acknowledge(id, byUserId) → RiskFlag`
- `dismiss(id, byUserId) → RiskFlag`
- `closeStaleByType(clientUserId, flagType) → number` — closes open flags whose triggering condition no longer holds (called after the evaluator runs and a previously-flagged condition is no longer in the proposed-flag list)

### 6.3 The evaluator orchestrator: `lib/coach-intel/run-evaluation.ts`

A thin wrapper that:
1. Loads the athlete's last 35 days of training sessions and readiness rows
2. Calls `evaluateRules({ sessions, readiness, asOf: today })`
3. For each proposed flag → `createIfNew`
4. For each rule that didn't fire this run but has open flags → `closeStaleByType`
5. Returns the resulting `{ created: RiskFlag[], closed: number }`

Triggered from:
- `POST /api/training-sessions` after the upsert
- `POST /api/readiness` after the upsert

## 7. Routes

### 7.1 Client side (`app/(client)/client/`)
- `training/page.tsx` — log a training session (RPE slider + duration input + session_type select). Pre-populates from today's row if one exists for that type.
- `training/history/page.tsx` — last 30 days as a list + small daily-load sparkline.

### 7.2 Admin side (`app/(admin)/admin/clients/[id]/performance/`)
The existing performance hub gains **2 new tabs** alongside Overview/Readiness/Injuries/Tests:
- `?tab=load` — TrainingLoadChart, ACWRChart, MonotonyStrainCard, WeekOverWeekCard, ComplianceRingCard
- `?tab=alerts` — RiskFlagsList with ack/dismiss actions

The Overview tab gains:
- `TrainingLoadCard` (current week total + sparkline)
- `RiskFlagsCard` (open count + 3 most recent)

### 7.3 New admin sub-route
- `clients/[id]/performance/log-session/page.tsx` — admin logs a training session for the client (same component as the client form, with `clientUserId` prop)

## 8. API Routes

- `POST /api/training-sessions` — upsert (athlete self or admin on behalf)
- `PATCH /api/training-sessions/[id]`
- `DELETE /api/training-sessions/[id]`
- `GET /api/clients/[id]/training/load-trend?days=N` — daily-load + 7d + 28d series for charts
- `GET /api/clients/[id]/coach-intel/summary` — single endpoint returning ACWR, weekly monotony/strain, week-over-week, compliance, open flag count + recent flags
- `PATCH /api/risk-flags/[id]` — body `{ action: "acknowledge" | "dismiss" }`
- `POST /api/clients/[id]/coach-intel/re-evaluate` — admin-only; force-runs the evaluator (debug/manual trigger)

`POST /api/readiness` (Sub-project 1) is updated to call `run-evaluation` after the upsert. Same for the new `/api/training-sessions`.

## 9. UI Components

### 9.1 `components/admin/coach-intel/`
- `TrainingLoadCard.tsx` — current-week total + sparkline
- `TrainingLoadChart.tsx` — Recharts ComposedChart: daily bars (load) + acute (7d) line + chronic (28d) line
- `ACWRChart.tsx` — Recharts LineChart with reference bands for sweet-spot (0.8–1.3) and danger (>1.5)
- `MonotonyStrainCard.tsx` — current-week monotony + strain values with color-coded indicator
- `WeekOverWeekCard.tsx` — side-by-side current vs prior week with deltas + up/down arrows
- `ComplianceRingCard.tsx` — radial progress for planned-vs-completed sessions
- `RiskFlagsCard.tsx` — compact list (overview tab)
- `RiskFlagsList.tsx` — full list with ack/dismiss buttons (alerts tab)
- `RiskFlagPill.tsx` — small badge (used inside other cards)

### 9.2 `components/client/coach-intel/`
- `LogTrainingSessionForm.tsx` — RHF form with shadcn Slider (RPE 1–10), Input (duration), Select (session_type)
- `MyTrainingHistory.tsx` — list + daily-load sparkline

### 9.3 Reuse from Sub-project 1
- `StatusPill` (already exists) — extended via the existing variant prop pattern; adds variants for severity (low/medium/high) instead of injury-status variants.

## 10. Migrations

Apply via `mcp__supabase__apply_migration`:
1. `00132_training_sessions.sql` — table + `session_load` generated column + RLS + unique constraint (00131 was taken by `ads_agent_recommendation_types`)
2. `00133_risk_flags.sql` — table + RLS

RLS:
- Admin: full access (existing `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')` pattern)
- Client: read own rows for `training_sessions`; **no client access** to `risk_flags` (coach-only by design)

## 11. Testing

### 11.1 Vitest unit tests — heavy coverage on pure modules
- `__tests__/lib/coach-intel/load.test.ts`
  - `dailyLoads` — fills missing dates with 0; sums multiple sessions per day
  - `rollingAverage` — boundary cases (window > data length), date alignment
  - `acuteLoad`, `chronicLoad` — known fixtures
  - `acwr` — sweet spot, danger zone, chronic=0 null case
- `__tests__/lib/coach-intel/monotony.test.ts` — known weekly fixtures, stdDev=0 null case
- `__tests__/lib/coach-intel/week-over-week.test.ts` — delta sign correctness, empty-previous-week case
- `__tests__/lib/coach-intel/compliance.test.ts`
- `__tests__/lib/coach-intel/evaluate-rules.test.ts` — one test per rule firing + one test per rule NOT firing

### 11.2 DAL tests (vitest with supabase mocks)
- `__tests__/lib/db/training-sessions.test.ts` — upsert idempotency
- `__tests__/lib/db/risk-flags.test.ts` — `createIfNew` dedupe behaviour

### 11.3 Integration test (vitest)
- `__tests__/lib/coach-intel/run-evaluation.test.ts` — fixture sessions/readiness → expected created flags. Mocks supabase reads + writes.

### 11.4 Playwright e2e (skips if env-creds absent)
- Athlete logs a high-RPE session for 3 days → admin loads hub → "rpe_creep" flag visible.
- Admin clicks "Acknowledge" → flag disappears from open list.

## 12. Component Boundary Check

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `lib/coach-intel/*` | Pure math | arrays of typed records, dates | numbers, structured records |
| `lib/db/training-sessions.ts` | I/O for training_sessions | DB params | typed rows |
| `lib/db/risk-flags.ts` | I/O for risk_flags + dedupe | DB params + proposed flags | typed rows |
| `lib/coach-intel/run-evaluation.ts` | Orchestration | userId, asOf | summary of created/closed flags |
| API routes | HTTP + auth | request body, session | DAL + evaluator calls |
| UI components | Render slices | typed props | React |

Every layer is independently testable. The pure-math layer (`lib/coach-intel/*`) has no Supabase imports — that's the design contract.

## 13. Risk & Open Questions

- **Threshold tuning**: v1 uses fixed constants. Real-world use will reveal if 1.5 / 2.0 / 30% are too sensitive or too lax. Adjustments are one-file edits + redeploy. If the user wants per-athlete thresholds, a future spec adds a `coach_intel_thresholds` table.
- **Multiple sessions per day**: the data model supports it via `(user, date, session_type)`. Daily load is summed across them in `dailyLoads`. ACWR and monotony see the same summed value — no double-counting.
- **`program_assignment_id` linkage for compliance**: a session links to a `program_assignment`, not a specific `program_exercise`. That's correct for "did the athlete do today's workout?" compliance. Per-exercise compliance is a separate concern (Sub-project 1's `exercise_progress` covers it).
- **Evaluator failure swallowing**: if `run-evaluation` throws after a successful insert, we return 200 with the inserted row but log the error and silently skip flag creation. Acceptable — the next insert will re-evaluate the same window. Documented in code.
- **Risk-flag spam during initial onboarding**: a brand-new athlete with sparse data will trip rules that need a baseline (ACWR with chronic=0 → null, monotony with one session → null). Rules return null in these cases, so they don't fire. Verified in evaluate-rules tests.

## 14. Implementation cadence (ralph-loop)

Same pattern as Sub-project 1:
1. Migration + types
2. Pure compute module + unit tests
3. DAL + tests
4. Evaluator orchestrator + integration test
5. API routes
6. Page + components
7. Commit directly to `main`

Estimated ~22 task slices in the plan.

## 15. Definition of Done

- [ ] Both migrations applied; types regenerated
- [ ] All `lib/coach-intel/*` modules with passing unit tests (≥30 tests)
- [ ] Both DAL files with passing tests
- [ ] `run-evaluation` integration test green
- [ ] All API routes wired (with re-evaluation triggered on readiness + training-session upserts)
- [ ] Client `/training` + `/training/history` routes functional
- [ ] Admin hub gains `?tab=load` and `?tab=alerts`; Overview tab gains `TrainingLoadCard` + `RiskFlagsCard`
- [ ] Admin `/log-session` route functional
- [ ] Playwright e2e green (rpe_creep flag round-trip)
- [ ] `npm run test:run` (perf-db + coach-intel) passes; `npm run build` succeeds

When all checked, Sub-project 2 ships. Sub-project 3 (visualization & engagement) is the natural next brainstorming target.
