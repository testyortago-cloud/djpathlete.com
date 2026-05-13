# Visualization & Engagement (Sub-project 3) Design Spec

**Status:** Draft — pending review
**Date:** 2026-05-14
**Author:** Brainstormed with Claude (superpowers brainstorming skill)
**Builds on:** [Sub-1 — Athlete Performance Core](./2026-05-13-athlete-performance-core-design.md) and [Sub-2 — Coach Intelligence](./2026-05-13-coach-intelligence-design.md)
**Implementation cadence:** ralph-loop, committed directly to `main`

## 1. Background & Motivation

Sub-1 and Sub-2 shipped the data foundation and coach analytics. They render information well but lean on lists, dropdowns, and line charts. The athlete profile lacks **visual identity** and **engagement loops**.

This sub-project adds:
- Visual injury reporting + visualization via a clickable SVG body map
- Athlete radar chart for sport snapshots
- Training-streak heatmap for motivation
- Goals tracker for accountability
- Auto-awarded badges for milestone moments

These are mostly **read-side** features computed from existing data. Only goals introduce a new table.

## 2. Goals

- Injury reporting feels visual — athletes pick a body region by clicking, not by reading a dropdown.
- The admin Injuries tab shows injury distribution at a glance via colored markers on a body silhouette.
- Athletes have one "Profile" page that ties everything together: radar, streak, badges, goals.
- Goals are concrete, time-bound, and auto-marked achieved on the relevant insert.
- Badges are computed live from existing data — no nightly job, no manual issuance.

## 3. Non-Goals (Explicitly Out of Scope)

- Athlete journal / notes — deferred to a future spec
- Per-athlete percentile normalization for the radar chart — v1 uses global reference ranges
- Confetti / animated celebrations — v1 uses a toast + badge
- Editable badge or radar reference thresholds in the UI — constants in code
- Multi-region SVG drilldown (e.g., zoom into knee anterior vs posterior) — single-region picker only
- Sharing badges/PRs to social — future polish
- Wearable / Apple Health integration — separate future spec

## 4. Data Model

One new table.

### 4.1 `athlete_goals`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_user_id | uuid FK → users.id | indexed, ON DELETE CASCADE |
| metric_kind | TEXT + CHECK | `test` (performance_tests.test_type) or `readiness` (composite readiness_score) or `weekly_load` (sum of session_load) |
| test_type | TEXT, nullable | required when `metric_kind = 'test'`, must be a valid TestType value |
| target_value | numeric(8,3) | the value the athlete is shooting for |
| target_unit | TEXT | display unit (cm / sec / kg / reps / score / load) |
| direction | TEXT + CHECK | `higher` (e.g., jump higher) or `lower` (e.g., sprint faster). For `readiness` or `weekly_load`, always `higher`. |
| start_value | numeric(8,3) | nullable; the athlete's baseline at goal-creation time. Used for progress bar math. |
| deadline | date | nullable |
| status | TEXT + CHECK | `active`, `achieved`, `missed`, `archived` |
| achieved_at | date | nullable; set when the goal is hit |
| notes | text | nullable |
| created_at, updated_at | timestamptz | |

Indexes: `(client_user_id)`, `(client_user_id, status)`.

**Migration:** `00134_athlete_goals.sql` (confirm at apply time).

RLS:
- Admin: full access (existing EXISTS pattern)
- Client: read/write own rows

### 4.2 Achievement detection

After every relevant write, scan the athlete's `active` goals and mark them `achieved` if the new value satisfies the `direction` against `target_value`:

- `metric_kind='test'`: triggered from `POST /api/performance-tests`. Goal achieved if `(direction='higher' AND result_value >= target_value)` or `(direction='lower' AND result_value <= target_value)` for matching `test_type`.
- `metric_kind='readiness'`: triggered from `POST /api/readiness`. Achieved if `readiness_score >= target_value`.
- `metric_kind='weekly_load'`: triggered from `POST /api/training-sessions`. Achieved if the current week's `totalLoad >= target_value`.

Implementation is a thin `lib/coach-intel/check-goals.ts` module that loads active goals, evaluates each, updates achieved ones, returns the list. Called best-effort after the relevant DAL insert; failures are logged but do not block the response (same pattern as `runEvaluation` in Sub-2).

## 5. Body Map

A hand-rolled SVG with 18 clickable `<g>` zones, one per `BODY_REGIONS` enum value.

### 5.1 `BodyMapPicker.tsx` (interactive)

- Props: `value: BodyRegion | null`, `onChange: (region: BodyRegion) => void`, optional `side?: InjurySide` for tinting.
- Renders front + back silhouettes side-by-side (or front-only with a "back" toggle if vertical space is tight).
- Each region group has `data-region={enum_value}` and `aria-label`.
- Hover: region fills with `var(--muted)`; click: fills with `var(--primary)`.
- Selected region shows a checkmark badge above the SVG ("Hamstring (right)").

### 5.2 `BodyMapDisplay.tsx` (read-only)

- Props: `injuries: Injury[]`, `onSelect?: (id: string) => void`.
- Same SVG, but each region is colored by the most severe active injury in that region (`active` → red, `recovering` → amber, `resolved` → dim). Click → calls `onSelect` with the most recent injury's id; the page navigates to the detail.
- Hover shows a tooltip with the count of injuries by status for that region.

### 5.3 The SVG asset

Stored at `public/body-map.svg` (or inline in the component — see below). Hand-built with simplified anatomical regions:

- **Front view** zones: head, neck, chest, shoulder (×2), elbow (×2), wrist (×2), hand (×2), hip (×2), quad (×2), knee (×2)
- **Back view** zones: upper_back, lower_back, glute (×2), hamstring (×2), calf (×2), ankle (×2), foot (×2)

For simplicity, the SVG is **inlined** in the component so no static asset fetch is needed and Tailwind classes can target groups. Total size: ~200 lines of SVG path data. Each region is a `<g data-region="...">` with one or more `<path>`. Side detection: regions with a left/right counterpart use `data-side="left"|"right"`; bilateral regions (head, neck, chest, upper_back, lower_back) have no side.

Left/right click resolution: when the user clicks the left-side variant of a region, the form receives `body_region='hamstring'` and `side='left'`.

### 5.4 Where it goes
- `ReportInjuryForm` (sub-1) — replaces the body_region dropdown
- Admin hub Injuries tab — added above the existing `InjuryTimelineList` as `BodyMapDisplay`

## 6. Radar Chart

### 6.1 `AthleteRadarCard.tsx`

Recharts `<RadarChart>` with a single dataset (current latest tests per category). One axis per category:

- **Speed** — best of any `sprint_*` test (lower is better → normalized inverted)
- **Power** — best of `cmj` / `drop_jump` / `squat_jump` / `broad_jump` (highest is better)
- **Strength** — best of `bench_press_1rm` / `back_squat_1rm` / `deadlift_1rm`, optionally normalized by `body_weight_kg` to be a relative-strength score
- **Endurance** — `beep_test` level
- **Mobility** — `sit_reach`

Each axis returns a 0–100 score.

### 6.2 `lib/coach-intel/test-normalization.ts`

A pure module that maps `(test_type, value, body_weight_kg?) → 0..100` using fixed reference ranges:

```ts
const REFERENCE_RANGES: Record<TestType, { min: number; max: number; direction: "higher" | "lower" }> = {
  drop_jump: { min: 20, max: 60, direction: "higher" },
  sprint_10m: { min: 1.5, max: 2.5, direction: "lower" },
  // ... etc.
}

export function normalize(testType: TestType, value: number, bodyWeightKg?: number): number {
  // clamp + linear interpolation between min/max, inverted if direction is "lower"
}
```

Documented constants make tuning a one-file edit.

### 6.3 Where it goes
- New `/client/profile/page.tsx`
- New "Profile" tab on the admin hub

## 7. Training-Streak Heatmap

### 7.1 `TrainingStreakHeatmap.tsx`

Pure SVG grid of 12 weeks × 7 days = 84 cells. Each cell:
- Filled with a color bucket based on the day's `session_load`: 0 (gray), 1–199 (light primary), 200–399 (mid), 400–599 (high), 600+ (max).
- `<title>` element with the date + load for hover tooltip.

Header shows "Current streak: N days" and "Longest: M days".

### 7.2 `lib/coach-intel/streak.ts`

Pure functions over `DailyLoad[]`:
- `currentStreak(daily, today) → number` — consecutive days ending today with `load > 0`
- `longestStreak(daily) → number` — longest run of consecutive non-zero days in the input

### 7.3 Where it goes
- `/client/profile`
- Admin hub "Profile" tab

## 8. Goals

### 8.1 Validator `lib/validators/athlete-goal.ts`

Zod schema with refinements:
- `metric_kind='test'` ⇒ `test_type` required
- `direction='higher'` valid for any metric_kind; `direction='lower'` only valid for `metric_kind='test'`

### 8.2 DAL `lib/db/athlete-goals.ts`

- `listByUser(userId, { status? }) → AthleteGoal[]`
- `create(userId, payload) → AthleteGoal`
- `update(id, patch) → AthleteGoal`
- `markAchieved(id, achievedAt) → AthleteGoal`
- `delete(id) → void` (used for archive — sets status, doesn't hard delete; alias `archive`)

### 8.3 Achievement evaluator `lib/coach-intel/check-goals.ts`

```ts
export async function checkGoals(clientUserId: string, ctx: {
  testType?: TestType
  testValue?: number
  readinessScore?: number
  weeklyLoad?: number
}) {
  // Loads active goals filtered by metric_kind matching ctx.
  // For each, evaluate satisfaction; mark achieved if yes.
  // Returns the list of newly-achieved goals.
}
```

Wired into:
- `POST /api/performance-tests` → `checkGoals(uid, { testType, testValue })`
- `POST /api/readiness` → `checkGoals(uid, { readinessScore })`
- `POST /api/training-sessions` → `checkGoals(uid, { weeklyLoad: <current week total> })` (after `runEvaluation`)

### 8.4 UI

- `LogGoalForm.tsx` — RHF form; metric_kind select drives downstream field visibility (test_type select shown for metric_kind='test')
- `GoalsList.tsx` — active list with progress bars (`current / target`)
- Client route `/client/goals` for full management
- Goals summary card on `/client/profile`
- Admin hub Overview tab gets a small `OpenGoalsCard`

## 9. Badges

### 9.1 Pure functions `lib/badges/`

- `lib/badges/types.ts` — `Badge` interface (`id`, `name`, `description`, `icon` (lucide name), `tier` ("bronze" | "silver" | "gold"))
- `lib/badges/iron-streak.ts` — `IronStreak` (30 consecutive training days). Tier scales with streak length (30=bronze, 60=silver, 100=gold)
- `lib/badges/pr-machine.ts` — `PRMachine` (3+ PRs in the last 30 days)
- `lib/badges/recovery-pro.ts` — `RecoveryPro` (readiness ≥ 80 for 14 consecutive days)
- `lib/badges/consistent.ts` — `Consistent` (compliance ≥ 90% for a calendar month)
- `lib/badges/index.ts` — `computeBadges(input: BadgeInput) → Badge[]` calling each rule

Each rule is `(input) => Badge | null`. Returns the badge or null. The index file aggregates.

### 9.2 `BadgeShelfCard.tsx`

Grid of earned badges with tier-colored borders. Empty state: "Earn your first badge by logging readiness for 14 days."

### 9.3 Where it goes
- `/client/profile`
- Admin hub "Profile" tab

## 10. Routes

### 10.1 Client
- `/client/profile` — new comprehensive profile page (radar + heatmap + badges + open-goals summary + recent activity)
- `/client/goals` — full goal management (list + log new goal)
- `/client/injuries/new` — uses `BodyMapPicker` (replaces dropdown in `ReportInjuryForm`)

### 10.2 Admin
- `/admin/clients/[id]/performance?tab=profile` — new tab with radar + heatmap + badges + goals
- The existing Injuries tab adds `BodyMapDisplay` above the timeline list

## 11. API Routes

- `POST /api/athlete-goals`
- `PATCH /api/athlete-goals/[id]` — update or archive (body `{ action: 'archive' }`)
- `DELETE /api/athlete-goals/[id]` (alias for archive — soft delete via status)
- `GET /api/clients/[id]/profile/summary` — admin/owner-only fat endpoint returning radar inputs, streak, badges, recent activity

The three existing write endpoints (readiness, performance-tests, training-sessions) gain a `checkGoals` call after their primary upsert, best-effort.

## 12. UI Components

### 12.1 New client/admin shared `components/shared/body-map/`
- `body-map-picker.tsx` — interactive, controlled value, calls onChange
- `body-map-display.tsx` — read-only, takes Injury[]
- `body-map-svg.tsx` — the inlined SVG with all `<g data-region>` zones, exports a `BODY_MAP_REGIONS` constant for typed lookups

### 12.2 New client `components/client/profile/`
- `athlete-radar-card.tsx` (also used in admin)
- `training-streak-heatmap.tsx` (also used in admin)
- `badge-shelf-card.tsx` (also used in admin)
- `open-goals-card.tsx`
- `log-goal-form.tsx`
- `goals-list.tsx`

### 12.3 Admin reuses the shared ones via `components/admin/profile/` thin wrappers if needed (or imports directly).

## 13. Migration

1. `00134_athlete_goals.sql` (number-confirm at apply time; ralph-ads or other concurrent work may have taken 00134) — table + RLS

## 14. Testing

### 14.1 Vitest unit — pure modules
- `__tests__/lib/coach-intel/test-normalization.test.ts` — fixture cases per direction
- `__tests__/lib/coach-intel/streak.test.ts` — currentStreak / longestStreak edge cases
- `__tests__/lib/coach-intel/check-goals.test.ts` — achievement detection per metric_kind, mocked DAL
- `__tests__/lib/badges/*.test.ts` — one test per rule firing + one not firing
- `__tests__/lib/validators/athlete-goal.test.ts` — refinements (test_type required when metric_kind=test)

### 14.2 DAL tests
- `__tests__/lib/db/athlete-goals.test.ts` — listByUser, markAchieved

### 14.3 Playwright e2e
- Athlete logs a goal targeting drop_jump ≥ 40cm → logs a 42cm test → goal auto-marked achieved → toast "Goal achieved 🎯"
- Athlete clicks the right-hamstring on the body map in `/client/injuries/new` → form submits with `body_region=hamstring, side=right`
- Admin opens hub Profile tab → radar + heatmap + badge shelf render

## 15. Component Boundary Check

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `lib/coach-intel/test-normalization.ts` | Map test value to 0–100 | testType + value + optional bw | number |
| `lib/coach-intel/streak.ts` | Compute streak lengths | DailyLoad[] | numbers |
| `lib/coach-intel/check-goals.ts` | Orchestrate achievement check | userId + ctx | newly-achieved goals |
| `lib/badges/*` | Pure rule per badge | BadgeInput | Badge \| null |
| `lib/db/athlete-goals.ts` | Goal CRUD | DB params | typed rows |
| `body-map-svg.tsx` | The asset | none (constant) | inlined React JSX |
| `body-map-picker.tsx` | Interactive picker | value, onChange | controlled component |
| `body-map-display.tsx` | Read-only visualization | Injury[] | DOM with markers |
| `athlete-radar-card.tsx` | Sport snapshot | tests | radar chart |
| `training-streak-heatmap.tsx` | 12w grid + counts | sessions | SVG grid |
| `badge-shelf-card.tsx` | Render earned badges | Badge[] | grid |
| `log-goal-form.tsx` / `goals-list.tsx` / `open-goals-card.tsx` | Goal UI | typed props | React |

## 16. Risk & Open Questions

- **SVG region mapping**: 18 regions × front+back = some are duplicated (knee front and back). Decision: one region per enum value regardless of view side. Knees only on front view, hamstring only on back, etc. The plan locks this.
- **Reference ranges in `test-normalization`**: starting points based on common sport-test benchmarks. Tunable per-file.
- **`metric_kind='weekly_load'` goal evaluation timing**: checked after each `training_sessions` upsert with `weeklyLoad = sum(this week's session_load)`. Goal achievement is at-or-above; same goal won't double-trigger because `status` flips to `achieved` and the evaluator only looks at `active` goals.
- **Body map left/right**: a single `body_region` enum value plus a `side` field rather than `hamstring_left` / `hamstring_right` as separate enums. Keeps the existing injury schema intact.

## 17. Implementation cadence (ralph-loop)

Estimated ~14 task slices:
1. Migration + types
2. Goals validator + DAL + tests
3. `lib/coach-intel/test-normalization.ts` + tests
4. `lib/coach-intel/streak.ts` + tests
5. `lib/coach-intel/check-goals.ts` + tests + wire into 3 existing API routes
6. `lib/badges/*` + tests
7. Body map SVG + picker + display
8. Update `ReportInjuryForm` to use the picker
9. Admin Injuries tab gains BodyMapDisplay
10. Athlete radar card
11. Training-streak heatmap
12. Badge shelf card
13. Goal UI: form, list, open-goals card, `/client/goals`, `/client/profile`
14. Admin hub Profile tab; API endpoints; e2e + final verify

## 18. Definition of Done

- [ ] Migration applied; AthleteGoal type added
- [ ] All pure modules and validators with ≥25 passing tests
- [ ] Goals DAL with passing tests
- [ ] check-goals integration covered (mocked DAL)
- [ ] Body map renders in both `/client/injuries/new` (picker) and admin Injuries tab (display)
- [ ] Athlete `/client/profile` route shows radar + heatmap + badges + open goals
- [ ] `/client/goals` route allows full goal management
- [ ] Admin hub Profile tab renders the same components in admin mode
- [ ] Playwright e2e for: goal achievement, body map injury report, admin profile tab
- [ ] `npm run test:run` (sub-1 + sub-2 + sub-3) green
- [ ] `npm run build` green

When all checked, Sub-project 3 ships and the originally-decomposed roadmap is complete.
