# Starter AI Automation — Phase 5c: Weekly Content Report Email (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase5c-weekly-content-report-design.md](../specs/2026-04-21-starter-ai-automation-phase5c-weekly-content-report-design.md)

## Steps

1. **components/emails/WeeklyContentReport.tsx** (NEW) — pure JSX email, props per spec. Mirror [lib/shop/emails/order-confirmed.tsx](../../lib/shop/emails/order-confirmed.tsx).
2. **lib/analytics/weekly-report.ts** (NEW) — small helper that:
   - Computes the 7-day range + previous 7-day range from `rangeEnd`.
   - Fetches social_posts + social_analytics + blog_posts + newsletters + active subs.
   - Calls `computeSocialMetrics` + `computeContentMetrics`.
   - Returns `{ social, content, rangeStart, rangeEnd, subject, html }`.
3. **app/api/admin/internal/send-weekly-report/route.ts** (NEW) — POST handler:
   - Bearer auth via `INTERNAL_CRON_TOKEN`.
   - Parse optional `{ to?, dryRun?, rangeEnd? }`.
   - Call helper, then `resend.emails.send()` unless `dryRun`.
4. **functions/src/send-weekly-content-report.ts** (NEW) — exports `runSendWeeklyContentReport({ fetchImpl, internalToken, appUrl })` — pure function that POSTs to the internal route.
5. **functions/src/index.ts** — register `sendWeeklyContentReport` via `onSchedule`.
6. **Tests (3 files):** route, email render, function helper.
7. **Verification:** tsc on Next.js + functions, prettier check, new vitest runs green.

## Out of scope

- Daily Pulse (5d).
- Voice drift (5e).
- Learning loop (5f).
- React Email migration.
