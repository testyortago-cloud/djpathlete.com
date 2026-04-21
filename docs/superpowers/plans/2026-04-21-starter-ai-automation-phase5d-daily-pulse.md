# Starter AI Automation — Phase 5d: Daily Pulse (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase5d-daily-pulse-design.md](../specs/2026-04-21-starter-ai-automation-phase5d-daily-pulse-design.md)

## Steps

1. `components/emails/DailyPulse.tsx` — JSX email component, same brand palette as `WeeklyContentReport.tsx`.
2. `lib/analytics/daily-pulse.ts` — `buildDailyPulse({ referenceDate?, forceMonday? })` → `{ subject, html, referenceDate, pipeline, trendingTopics }`.
3. `app/api/admin/internal/send-daily-pulse/route.ts` — Bearer-guarded POST, mirrors 5c route.
4. `functions/src/send-daily-pulse.ts` — `runSendDailyPulse({ fetchImpl, internalToken, appUrl })`.
5. `functions/src/index.ts` — register `sendDailyPulse` via `onSchedule("0 7 * * 1-5", America/Chicago)`.
6. Tests: email render (DailyPulse.test.tsx), route (send-daily-pulse.test.ts), function (send-daily-pulse.test.ts in functions/).
7. Verification: tsc (Next + functions), prettier, new vitest suites green.

## Out of scope

- Weekend pulse.
- Real-time dashboard badge (that's a separate UI task).
- Push/SMS channel.
- Voice drift (5e) / learning loop (5f).
