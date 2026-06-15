# Implementation plan — coach goal management + printable result page

Spec: `docs/superpowers/specs/2026-06-15-coach-goals-and-printable-results-design.md`
Ordered, each task independently verifiable. Build directly (well-scoped, shared files → sequential is safer than parallel subagents); final adversarial review + full-suite verify at the end.

## Task 1 — Shared goal helpers (DRY + testable)
- `lib/goals/progress.ts`: `goalProgressPct(goal): number` (achieved→100; start_value null→0; span 0→100; clamp 0..100; matches current `goals-list` logic).
- `lib/goals/format.ts`: `goalLabel(goal): string` (test+test_type→`TEST_TYPE_LABELS`, else `GOAL_METRIC_KIND_LABELS`).
- Update `components/client/profile/goals-list.tsx` + `open-goals-card.tsx` to import these (delete local copies).
- Test: `__tests__/lib/goals/progress.test.ts` covering each branch.
- **Verify:** `npm run test:run __tests__/lib/goals` green.

## Task 2 — API: mark-achieved action
- `app/api/athlete-goals/[id]/route.ts`: in PATCH, before the partial-update parse, add `if (body.action === "achieve") { const goal = await markAchieved(id, <today ISO date>); return ... }`. Import `markAchieved`.
- **Verify:** tsc clean on the route.

## Task 3 — Load all goals into the hub
- `app/(admin)/admin/clients/[id]/performance/page.tsx`: swap `activeGoals(id)` → `listByUser(id)` (athlete-goals) for the goals slot; keep var name aligned.
- `athlete-performance-hub.tsx`: `ProfileSummary.goals` now = all goals. Derive `const activeGoals = profile.goals.filter(g => g.status === "active")` and pass that to both `OpenGoalsCard`s.
- **Verify:** tsc clean; OpenGoalsCard still shows active only.

## Task 4 — CoachGoalsManager
- `components/admin/performance/coach-goals-manager.tsx` (client): props `{ clientUserId, goals }`.
  - Header row with "Add goal" → `Dialog` wrapping existing `LogGoalForm` (pass `clientUserId`; close + `router.refresh()` on success — add optional `onSuccess` to `LogGoalForm`).
  - Sorted list (active→achieved→archived), each: `goalLabel`, target/unit/deadline, `StatusPill`, progress bar (`goalProgressPct`), actions Mark achieved / Archive for active rows (fetch PATCH `{action:"achieve"|"archive"}`, toast, refresh).
  - Empty state: "No goals yet — add the first one."
- Render it in the Profile tab of `athlete-performance-hub.tsx` (full width, above or beside the existing read-only card).
- `LogGoalForm`: add optional `onSuccess?: () => void` called after success (keep `router.refresh()`).
- **Verify:** tsc clean; manual flow.

## Task 5 — Print CSS
- `app/globals.css`: add `@media print` block — hide all, reveal `.print-document` (visibility trick), `position:absolute; inset:0; width:100%`; `@page { margin: 1.5cm }`.
- **Verify:** build clean; chrome hidden when printing the print route.

## Task 6 — Print route + sections
- `app/(admin)/admin/clients/[id]/performance/print/page.tsx` (server): auth+admin check; focused DAL loads (tests, PRs, goals→active, readiness latest+trend, sessions→load summary via coach-intel helpers, active injuries); render `.print-document` wrapper with header + 4 sections (static tables/lists/stats); reuse `goalLabel`/`goalProgressPct`.
- `components/admin/performance/print-toolbar.tsx` (client, `print:hidden`): "Print / Save as PDF" (`window.print()`), "Back" (`router.back()`), and auto-`window.print()` once on mount via `useEffect`.
- **Verify:** route renders; print preview shows only the document.

## Task 7 — Print button on hub
- `performance-action-buttons.tsx`: add a `Button asChild` → `<Link href={`/admin/clients/${clientUserId}/performance/print`} target="_blank">Print result page</Link>`.
- **Verify:** button navigates.

## Task 8 — Full verification
- `npx tsc --noEmit` (no NEW errors vs the 384-line baseline; none referencing new/edited files).
- `npm run lint`.
- `npm run test:run`.
- `npm run build`.

## Task 9 — Review + finalize
- Adversarial code-review subagent over the diff (auth, RLS/service-role, print-CSS leakage, goal authorization, edge cases).
- Apply fixes.
- Commit locally on `main` (NOT push — autonomous-mode hold). Update JOURNAL.md + memory. Final report.
