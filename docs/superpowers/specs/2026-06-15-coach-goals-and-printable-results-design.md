# Coach goal management + printable athlete result page — design

**Date:** 2026-06-15
**Status:** Approved-to-build (user asleep; built under autonomous-mode rules, held back from push/deploy)
**Surfaces:** Admin athlete performance hub (`/admin/clients/[id]/performance`)

Two related items from coach feedback, both living on the athlete performance hub.

---

## Feature 1 — Coach goal management ("Open goals doesn't seem to be working")

### Problem (verified diagnosis)
The goals *display* path is correct. Traced every surface (admin hub overview + profile tabs, client snapshot, `/client/goals`, `OpenGoalsCard`, `GoalsList`, the API, the DB). The only athlete with goals in prod is `testyortago@gmail.com` (`5e7bdb51-…`, 3 active); that id matches exactly what `/admin/clients/[id]/performance` loads via `activeGoals(id)`, so that athlete renders "Open goals (3)" correctly.

The real gap: **the coach has no way to create a goal for an athlete.** Goals can only be added by the client at `/client/goals`. So every other athlete shows "Open goals (0) → Set your first goal", and that card link points at `?tab=profile` (the same page) — a dead end. From the coach's chair it looks broken everywhere.

### Solution
Give the coach full goal management on the **Profile tab** of the performance hub, reusing the existing form + API (both already support a coach acting on a client's goals).

1. **API:** add an `action: "achieve"` branch to `PATCH /api/athlete-goals/[id]` → `markAchieved(id, <today>)`. (`archive` already exists; the form schema strips `status`/`achieved_at`, so "mark achieved" needs an explicit action.) Admin authorization already present.
2. **Page load:** `/admin/clients/[id]/performance` currently loads active-only goals (`activeGoals(id)`). Change to load **all** goals (`listByUser(id)`); the hub derives the active subset for `OpenGoalsCard`. (Manager needs achieved/archived too.)
3. **New component `CoachGoalsManager`** (client) rendered on the Profile tab:
   - "Add goal" button → dialog wrapping the existing `LogGoalForm` with `clientUserId` (the POST already honours admin `client_user_id`).
   - Goal list sorted active → achieved → archived. Each row: label, target + unit (+ deadline), status pill, progress bar, and actions: **Mark achieved** / **Archive** (active rows only).
   - Mutations via `fetch` to the existing `[id]` route; `router.refresh()` on success; `sonner` toasts.
4. **Dead-end fix:** the `OpenGoalsCard` link already targets `?tab=profile`; now that the Profile tab has the manager + Add button, it lands somewhere useful. Empty-state CTA copy clarified.

### Out of scope (v1)
Inline editing of every goal field (target/deadline tweaks) — defer; add covers the gap. No athlete-side changes (already works). No new goal *types*.

---

## Feature 2 — Printable athlete result page

### Goal
A coach-triggered, print-optimized one-pager of an athlete's results, exported via the browser's "Save as PDF".

### Decisions (made autonomously)
- **Browser Save-as-PDF**, not a server-generated PDF — no heavyweight dependency (puppeteer/chromium) for a simple report. A dedicated print route + `window.print()`.
- **Coach-only** for v1 (request was "for *me* to print"). Built reusable so exposing an athlete-facing version later is trivial.
- **Dedicated route**, not CSS-hiding the live hub — the hub is tabs + interactive Recharts that print badly.

### Route
`app/(admin)/admin/clients/[id]/performance/print/page.tsx` — server component. Admin-only (in-page `auth()` + role check, same as the hub; also covered by `/admin/*` middleware). Kept under `/admin` so on screen it renders inside the admin shell as a document preview; print CSS strips the chrome.

### Data (focused subset, reusing existing DAL)
- Tests: `listByUser(id)` (performance-tests) → latest per type + history.
- PRs: `getPRsByUser(id)`.
- Goals: `listByUser(id)` (athlete-goals) → active subset.
- Readiness: `getLatest(id)`, `getReadinessTrend(id, 30)` → latest + 30-day average.
- Load: `listByUser(id, {from,to})` (training-sessions) → `dailyLoads` + `acwr` + `weeklyStats` (mirror the hub's existing computation subset).
- Injuries: `getActive(id)`.

### Layout (single branded document)
- **Header:** brand wordmark, "Athlete Results", athlete name + email, generated date.
- **Performance tests & PRs:** table (Test | Latest | PR | Date).
- **Goals & progress:** list with progress bars (active goals).
- **Readiness & load:** summary stats (latest readiness, 30-day avg, current-week load, ACWR).
- **Injury / body status:** active injuries list (or "None").
Static tables + numbers only — no interactive charts.

### Trigger
"Print result page" button added to `PerformanceActionButtons` → Next `<Link>` to the print route, `target="_blank"`. On the print page: a `print:hidden` toolbar with "Print / Save as PDF" + "Back", and an auto-`window.print()` on mount (after first paint).

### Print CSS
Global `@media print` in `app/globals.css` using the layout-agnostic visibility trick: hide everything, then reveal `.print-document` and position it at the page origin. `@page { margin: 1.5cm }`. The toolbar uses `print:hidden`.

---

## Shared refactor (small, in-scope)
Goal `label()` and progress-percent logic are duplicated in `goals-list.tsx` / `open-goals-card.tsx`. Extract:
- `lib/goals/format.ts` → `goalLabel(goal)`
- `lib/goals/progress.ts` → `goalProgressPct(goal)`
Reuse in `GoalsList`, `OpenGoalsCard`, `CoachGoalsManager`, and the print page. Unit-test `goalProgressPct` (achieved=100, no start=0, clamping, higher/lower direction).

## Testing
- `goalProgressPct` unit tests (pure).
- Reused load/coach-intel helpers are already tested.
- Manual: add a goal as coach on an athlete → appears in manager + OpenGoalsCard; mark achieved / archive; open print page → renders all sections → Save as PDF.

## Files
**New:** `lib/goals/format.ts`, `lib/goals/progress.ts`, `components/admin/performance/coach-goals-manager.tsx`, `app/(admin)/admin/clients/[id]/performance/print/page.tsx`, print presentational components (under the print folder), `components/admin/performance/print-toolbar.tsx`, tests.
**Edited:** `app/api/athlete-goals/[id]/route.ts` (+achieve action), `app/(admin)/admin/clients/[id]/performance/page.tsx` (load all goals), `components/admin/performance/athlete-performance-hub.tsx` (derive active, render manager, print link wiring), `components/admin/performance/performance-action-buttons.tsx` (+Print button), `components/client/profile/open-goals-card.tsx` + `components/client/profile/goals-list.tsx` (use shared helpers), `app/globals.css` (print rules).
