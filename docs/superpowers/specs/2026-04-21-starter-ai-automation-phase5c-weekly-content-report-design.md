# Starter AI Automation — Phase 5c: Weekly Content Report Email (Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode)
**Scope:** One email, sent every Friday. No new data model, no UI additions.
**Depends on:** 5a (`social_analytics` + nightly sync) + 5b (`computeSocialMetrics` / `computeContentMetrics`)
**Precedes:** 5d (Daily Pulse — reuses the same route + render pattern)

## Goal

Every Friday at 5 PM Central, send the coach a branded HTML email summarizing the week's content activity: posts published, engagement, top-performing posts, blogs shipped, newsletter sends. The recipient can reply with feedback instead of logging into the dashboard.

## Non-goals

- No new tables, no new DAL functions, no new migrations.
- No recipient management UI — hardcode to `COACH_EMAIL`.
- No A/B subject lines, no tracking pixels.
- No "highlights since last week" narrative AI copy — just the numbers (for now).
- Daily Pulse (Monday edition, trending scan) — **5d**.
- Learning loop / voice drift — **5e/5f**.

## Architecture

```
Cloud Scheduler (Fri 17:00 America/Chicago)
       │
       ▼
[sendWeeklyContentReport — Firebase Function onSchedule]
       │   invokes the internal route (HTTPS, Bearer INTERNAL_CRON_TOKEN)
       ▼
[POST /api/admin/internal/send-weekly-report (Next.js)]
       │   1. compute 7-day range + previous 7-day range
       │   2. fetch social_posts + social_analytics + blog_posts + newsletters + active subs
       │   3. computeSocialMetrics + computeContentMetrics  (reused from 5b)
       │   4. render <WeeklyContentReport /> via react-dom/server.renderToStaticMarkup()
       │   5. resend.emails.send({ to: COACH_EMAIL, from, subject, html })
       │   6. respond { ok: true, sentTo, rangeStart, rangeEnd }
       ▼
[Resend → coach inbox]
```

**Why the Function doesn't do the rendering itself:**
- `react-dom/server` isn't installed in `functions/` (and shouldn't be — that dir stays lean).
- Same separation as 5a: Firebase schedules, Next.js computes + renders + sends.
- Keeps the compute path testable in one place (`npm run test` already covers `computeSocialMetrics` / `computeContentMetrics`).

**Trade-off accepted:** Function → Next.js adds one HTTPS hop. At weekly cadence this is irrelevant.

## The email

### Subject
`Weekly Content Report — Week of {Mon 4/14}` (uses the Monday of the report week)

### Sections
1. **Hero** — "Week of X" + a one-line summary ("6 posts published, 12.3K engagement").
2. **Social at a glance** — 4-metric grid (posts created, posts published, impressions, engagement) with week-over-week deltas.
3. **Top 5 posts by engagement** — platform, first 80 chars, engagement number.
4. **Platform breakdown** — list with counts per platform for the week.
5. **Content shipped** — blogs published (count + title list), newsletters sent.
6. **Fact-check flags** — if any blogs are `flagged` or `failed`, list them. Skip the whole block when clean.
7. **Footer** — CTA button to `/admin/analytics?tab=social`.

Keep it short enough to read in 60 seconds; defer the dashboard for anything deeper.

### Empty states
Every section checks its own data and renders a brief "nothing this week" placeholder rather than disappearing — keeps the layout stable across weeks.

## Interfaces

### Internal route — `POST /api/admin/internal/send-weekly-report`

**Auth:** `Authorization: Bearer <INTERNAL_CRON_TOKEN>`. 401 on mismatch.

**Body (optional, all for testing):**
```ts
{
  to?: string             // override COACH_EMAIL
  dryRun?: boolean        // returns html without sending
  rangeEnd?: string       // ISO, defaults to now — useful for backfill tests
}
```

**Responses:**
- 200 `{ ok: true, sentTo, subject, rangeStart, rangeEnd }`
- 200 `{ ok: true, dryRun: true, html, subject, ... }` when `dryRun: true`
- 401 / 400 / 500 as usual.

### Firebase Function — `sendWeeklyContentReport`

```ts
export const sendWeeklyContentReport = onSchedule(
  {
    schedule: "0 17 * * 5",
    timeZone: "America/Chicago",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    // POST to /api/admin/internal/send-weekly-report
    // log { sentTo, rangeStart, rangeEnd }
  },
)
```

**Failure mode:** if the Next.js route 5xx's, the function throws — Cloud Scheduler shows the failure in logs. No retry logic beyond default. One missed Friday is acceptable (the admin can hit the internal route manually).

## Email template

**File:** `components/emails/WeeklyContentReport.tsx`

A pure React component, no client hooks, no Next.js-only APIs. Receives:

```ts
interface WeeklyContentReportProps {
  social: SocialMetrics
  content: ContentMetrics
  rangeStart: Date
  rangeEnd: Date
  dashboardUrl: string
}
```

Returns a JSX tree of nested `<table>` elements (inline styles) mirroring the existing [lib/shop/emails/order-confirmed.tsx](../../lib/shop/emails/order-confirmed.tsx). Brand palette matches: primary `#0E3F50`, accent `#C49B7A`, neutral `#edece8`.

**Rationale for the table-based approach** (not React Email components):
- React Email isn't installed; adopting it now is scope creep.
- The shop emails already prove the template works across major clients.
- `renderToStaticMarkup()` is the existing path.

## Testing

| Layer | Test | File |
|---|---|---|
| Route | 401 unauth, 200 happy, `dryRun` returns html without calling Resend, 500 on compute error | `__tests__/api/admin/internal/send-weekly-report.test.ts` |
| Email component | snapshot-style render: pass mock metrics, assert KPIs + top post titles appear in output | `__tests__/components/emails/WeeklyContentReport.test.tsx` |
| Firebase Function | handler is a thin HTTP caller; test `runSendWeeklyContentReport({ fetchImpl, ... })` with stubbed fetch | `functions/src/__tests__/send-weekly-content-report.test.ts` |

Not tested: Resend's actual delivery. The Resend client is mocked at the route level; live smoke via `dryRun: false` against a test recipient is a one-shot manual check at deploy time.

## Environment variables

All reuse existing:
- `COACH_EMAIL` — defined in `.env.example:91`, currently unused. First consumer. Required.
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — already wired.
- `INTERNAL_CRON_TOKEN` — reused from publish-due / sync-post-analytics.
- `APP_URL` — reused.

## Rollout

1. Ship the route + component + function in one PR.
2. Set `COACH_EMAIL` in Vercel (it's already in `.env.example`).
3. Deploy Next.js.
4. `firebase deploy --only functions:sendWeeklyContentReport`.
5. Manually hit the route with `{ dryRun: true }` to eyeball the HTML.
6. Hit it once with a real `to` override (your own test inbox) to verify deliverability.
7. Let the schedule take over next Friday.
