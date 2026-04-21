# Starter AI Automation — Phase 5d: Daily Pulse Email (Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode)
**Scope:** A second scheduled email. Reuses 5c's route/function/render pattern.
**Depends on:** 5a (posts), existing Tavily trending scan (4d)
**Precedes:** 5e (voice drift) + 5f (learning loop)

## Goal

Every weekday at 7 AM Central, send the coach a short "what's on your plate today" digest. Faster cadence than the weekly report, narrower scope — no engagement metrics, just pipeline state. Monday edition tacks on the week's Tavily trending topics.

## Non-goals

- Weekend sends (nothing new is generated overnight between Fri → Sun).
- Engagement numbers — those live in 5c.
- Real-time updates — cron only.
- Push/SMS — email only.

## Architecture

Same shape as 5c:

```
Cloud Scheduler (Mon-Fri 07:00 America/Chicago)
       │
       ▼
[sendDailyPulse — Firebase Function onSchedule]
       │  Bearer INTERNAL_CRON_TOKEN → Next.js route
       ▼
[POST /api/admin/internal/send-daily-pulse]
       │  1. fetch social_posts, video_uploads, blog_posts
       │  2. build pulse counters
       │  3. if weekday === Monday, attach topic suggestions from last 7 days
       │  4. render <DailyPulse /> → HTML via renderToStaticMarkup
       │  5. resend.emails.send({ to: COACH_EMAIL, from, subject, html })
       ▼
[Resend → coach inbox]
```

**Schedule cron:** `0 7 * * 1-5` (Mon–Fri, 7 AM America/Chicago). Weekends skipped.

## The email

### Subject
- Normal days: `Daily Pulse — Mon, Apr 21`
- Monday: `Weekly kick-off — Mon, Apr 21`

### Sections
1. **Hero** — day label + one-line summary (e.g. "6 awaiting review · 2 videos need transcripts").
2. **Pipeline** — five numbers in a 2-column grid:
   - Posts awaiting review (draft + edited)
   - Approved & ready (approved + awaiting_connection, not yet scheduled/published)
   - Scheduled today
   - Videos awaiting transcription (status = "uploaded")
   - Blog drafts in flight (status = "draft")
3. **Monday only — Trending topics for the week.** Top 5 from most-recent topic_suggestion scan; each is title + one-line summary + optional Tavily source URL.
4. **CTA** — Open admin pipeline.

Empty states: each counter renders even when zero; trending block is omitted entirely when not Monday.

## Interfaces

### Internal route — POST `/api/admin/internal/send-daily-pulse`

**Auth:** Bearer `INTERNAL_CRON_TOKEN`. 401 otherwise.

**Body (optional, all for testing):**
```ts
{
  to?: string             // override COACH_EMAIL
  dryRun?: boolean        // return html without sending
  forceMonday?: boolean   // for testing the trending section on any day
  referenceDate?: string  // ISO, override "today" for testing
}
```

**Responses:** same shape as 5c: 200 `{ ok, sentTo, subject, ... }` or 200 `{ dryRun: true, html, ... }`.

### Firebase Function

```ts
export const sendDailyPulse = onSchedule(
  {
    schedule: "0 7 * * 1-5",
    timeZone: "America/Chicago",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const { runSendDailyPulse } = await import("./send-daily-pulse.js")
    const result = await runSendDailyPulse()
    console.log("[sendDailyPulse]", result)
  },
)
```

### Email component — `components/emails/DailyPulse.tsx`

Pure JSX, inline styles, matches the brand palette used by `WeeklyContentReport.tsx`.

```ts
interface DailyPulseProps {
  referenceDate: Date
  pipeline: {
    awaitingReview: number
    readyToPublish: number
    scheduledToday: number
    videosAwaitingTranscription: number
    blogsInDraft: number
  }
  trendingTopics: {
    title: string
    summary: string
    sourceUrl: string | null
  }[] // empty on non-Monday
  dashboardUrl: string
}
```

### Data helper — `lib/analytics/daily-pulse.ts`

Exports `buildDailyPulse({ referenceDate?, forceMonday? })`. Fetches the three tables, derives the five counters, conditionally attaches trending topics.

**Trending topic selection:**
- Read via `listTopicSuggestions()` (existing DAL).
- Filter to entries with `created_at >= now - 7 days`.
- Sort by `metadata.rank` ascending (lowest rank = highest priority). Fallback to `created_at` desc.
- Take top 5.

## Testing

| Layer | Test | File |
|---|---|---|
| Email component render | renders hero, 5 counters, trending section when Monday, CTA | `__tests__/components/emails/DailyPulse.test.tsx` |
| Route | 401, 200 happy, `dryRun` returns html, `forceMonday` attaches trending, 502 on Resend error | `__tests__/api/admin/internal/send-daily-pulse.test.ts` |
| Firebase Function | pure HTTP caller — mirror of 5c tests | `functions/src/__tests__/send-daily-pulse.test.ts` |

## Environment / rollout

No new env vars. Reuses COACH_EMAIL, INTERNAL_CRON_TOKEN, APP_URL, RESEND_API_KEY.

1. Ship route + component + function + tests in one PR.
2. `firebase deploy --only functions:sendDailyPulse`.
3. Dry-run `curl -X POST .../send-daily-pulse -d '{"dryRun":true}'` — eyeball.
4. Dry-run `... -d '{"dryRun":true,"forceMonday":true}'` — eyeball trending section.
5. Send-to-self `... -d '{"to":"you@test.com"}'` — deliverability.
6. Let cron take over.
