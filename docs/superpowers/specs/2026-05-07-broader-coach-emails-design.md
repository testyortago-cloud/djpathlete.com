# Broader Coach Emails — Daily Brief & Weekly Business Review

**Date:** 2026-05-07
**Status:** Design approved, ready for implementation planning
**Owner:** Solo dev (Darren / DJP Athlete)

## Problem

Today's two coach emails — the **Daily Pulse** and **Weekly Content Report** — are heavily content/social-post focused. They tell the coach what posts are queued and how content performed, but they ignore the rest of the business: client coaching activity, bookings, revenue, and the lead funnel.

The coach wants both emails to be a **broader business signal** — not just "what's in the post pipeline" but "what needs my attention across the business today / this week."

## Goals

1. **Daily Brief**: a fast, scannable "what to look at today" across coaching, content, revenue, and ads. Empty sections hide so quiet days stay short.
2. **Weekly Business Review**: a retrospective with current-vs-previous-week deltas across all four business areas. Top-of-mind bullets surface the biggest movers automatically.
3. **No new infrastructure** — extend existing `lib/analytics/daily-pulse.ts`, `lib/analytics/weekly-report.ts`, the React email components, the cron, and the Resend send. The route handlers, the gating in `system-settings`, and the Firebase schedulers stay untouched.
4. **Reuse existing DAL** — every metric in this spec must come from a function already present in `lib/db/`. No new DB queries are written from scratch.

## Non-goals

- No changes to the cron schedule, the route handlers (`send-daily-pulse`, `send-weekly-report`), `INTERNAL_CRON_TOKEN` auth, or Resend send logic.
- No new database tables. No migrations.
- No new admin UI to configure section visibility — section visibility is rule-based ("hide if empty"), not user-configured.
- No replacement of the existing `WeeklyAdsReport` / `WeeklyPipelineReport` / `WeeklyAgentMemo` emails. Those remain as-is. Only the Daily Pulse and Weekly Content Report broaden.
- No SMS, push, or Slack delivery. Email-only.

## User decisions captured

- **Coverage:** all four broader areas in scope — client coaching, bookings & calls, revenue & commerce, lead funnel & ads.
- **Empty sections:** hide when empty. Email length scales with how much actually happened.
- **Top-of-mind bullets** on the weekly: included.
- **Anomaly section** on the daily: included, exception-only.

## Section structure

### Daily Brief (weekday 7am CT)

Sections render in order. Each is independent and may be omitted if its builder returns `null`.

1. **Today at a glance** — *always renders*
   A single sentence summarising whichever sections produced data, e.g.
   *"2 calls today · 3 form reviews waiting · 1 client missed yesterday · $420 ad spend yesterday."*
   Computed from the section payloads, not fetched separately.

2. **Today's calls & sessions** — *hide if no calls and no overnight signups*
   - Booked client calls today: time, client name, type
   - Event/clinic signups since the last brief

3. **Coaching signal** — *hide if all subsections are empty*
   - Form reviews awaiting reply: count + age of oldest
   - At-risk clients: no workout logged in 3+ days
   - Low RPE log quality flags from yesterday's completed workouts
   - Voice drift flags / AI policy alerts created since last brief

4. **Content pipeline** — *existing, unchanged behaviour*
   Awaiting review · Ready to publish · Scheduled today · Videos to transcribe · Blog drafts.

5. **Revenue & funnel — yesterday** — *hide if every metric is zero*
   - New shop orders + total revenue
   - New subs / cancels (Stripe)
   - Newsletter net delta
   - Google Ads spend, conversions, CPL

6. **Anomalies** — *exception-only, hide if no flags*
   Each rule fires only when the threshold is crossed. Thresholds live as module-level constants in `lib/analytics/sections/anomalies.ts` so they can be tuned without spelunking.
   - Day-over-day conversion-rate drop: ≥ 30% relative drop vs. 7-day average AND ≥ 5 conversions in the 7-day baseline (avoids low-volume noise)
   - Abandoned-checkout spike: ≥ 3× the 7-day average
   - Ad CPL spike: ≥ 50% above the 7-day average AND ≥ $20 absolute CPL (avoid noise on micro-spend)
   - AI generation failures: ≥ 3 failures in the prior 24h
   - Transcription failures: ≥ 1 failure in the prior 24h (rare enough that any failure is worth surfacing)

7. **Trending topics** — *Monday only, existing*
   Top 5 from `topic_suggestions`.

### Weekly Business Review (Friday 5pm CT)

Sections compare current 7-day window to previous 7-day window. Hide when no data this week.

1. **Top of mind** — *always renders*
   3–5 auto-generated bullets describing the biggest week-over-week movers (positive or negative). Selection rule: rank all numeric metrics by absolute % delta where previous-week value ≥ a per-metric floor (to avoid "+9000% from 1 to 91" noise), take the top 5, format as one-liners.

2. **Coaching** — *hide if no clients with activity in either week*
   - Active clients (≥1 workout logged), sessions completed
   - Program-completion rate
   - Form reviews delivered, average response time
   - Churn signal: clients gone silent (no log in 14+ days)

3. **Revenue** — *hide if all dollar values zero*
   - MRR + delta
   - New subs / cancels / renewals
   - Shop revenue, refunds, total inflow

4. **Lead funnel** — *hide if no inflow either week*
   - Newsletter net subscribers
   - Shop leads
   - Google Ads spend / CPL / conversions
   - Top converting campaign
   - Attribution by source

5. **Content performance** — *existing behaviour*
   Social impressions/engagement, top post, blog views, newsletter open rate.

6. **Operational health** — *exception-only*
   Same thresholds-as-constants pattern as the daily anomalies section.
   - AI token spend: render only if current week is ≥ 50% above the 4-week trailing average AND ≥ $10 absolute spend
   - Generation failure rate: render only if failed ÷ attempted ≥ 5% over the week AND ≥ 2 absolute failures
   - Voice-drift flag count: render if > 0
   - Cron skips/errors: render if > 0

## Architecture

### File layout

```
lib/analytics/
  daily-pulse.ts            # existing — orchestrates section builders, returns email payload
  weekly-report.ts          # existing — same, for weekly
  sections/                 # NEW — one builder per area, used by both pulse and report
    coaching.ts
    bookings.ts
    revenue.ts
    funnel.ts
    ops-health.ts
    anomalies.ts            # daily-only
    top-of-mind.ts          # weekly-only — derives bullets from other section payloads
  social.ts                 # existing
  content.ts                # existing
```

### Builder contract

Each builder exports a single async function and a payload type:

```ts
// lib/analytics/sections/coaching.ts
export interface CoachingDailyPayload {
  formReviewsAwaiting: { count: number; oldestAgeHours: number } | null
  atRiskClients: Array<{ name: string; daysSinceLastLog: number }>
  lowRpeLogFlags: number
  voiceDriftFlags: number
}

export async function buildCoachingDaily(
  range: { from: Date; to: Date }
): Promise<CoachingDailyPayload | null>
```

- Returns `null` when nothing in the payload would render — the email component then skips the section entirely.
- Returns a typed payload otherwise; the email component renders only the populated subfields.
- Pure function over DAL calls — no side effects, no email rendering.
- Each builder is independently unit-testable with mocked DAL.

### Orchestration

`buildDailyPulse` and `buildWeeklyReport` orchestrate the builders in parallel via `Promise.all`, assemble the payload object, then pass it to the React email component. They also compute the "Today at a glance" / "Top of mind" lines from the assembled payload.

### Email components

- Add a small `<Section>` primitive in `components/emails/_shared/Section.tsx` (heading + body slot) so adding a new section is one block.
- `DailyPulse.tsx` and `WeeklyContentReport.tsx` accept the new payload shape and render each section conditionally (`payload.coaching && <CoachingSection ... />`).
- Brand tokens, fonts, footer, CTA stay as-is.

### Component naming

Keep the existing component file names (`DailyPulse`, `WeeklyContentReport`) so the route handlers and tests don't churn. Update only the in-email kicker / heading text:

- Daily kicker: `Daily Brief` (currently `Daily Pulse` / `Weekly kick-off`)
- Weekly kicker: `Weekly Review` (currently weekly content report subject)
- Subjects: `Daily Brief — <Day, Mon D>`, `Weekly Review — Week of <Mon D>`. Monday daily keeps `Weekly kick-off — <Day, Mon D>` since trending topics still appear.

## Data sources

| Section | DAL functions used |
|---|---|
| Today's calls & sessions | `lib/db/bookings.ts`, `lib/db/event-signups.ts` |
| Coaching signal | `lib/db/form-reviews.ts`, `lib/db/progress.ts`, `lib/db/voice-drift-flags.ts`, `lib/db/ai-program-feedback.ts` |
| Content pipeline | `lib/db/social-posts.ts`, `lib/db/video-uploads.ts`, `lib/db/blog-posts.ts` (existing) |
| Revenue & funnel daily | `lib/db/shop-orders.ts`, `lib/db/subscriptions.ts`, `lib/db/payments.ts`, `lib/db/newsletter.ts`, `lib/db/google-ads-metrics.ts` |
| Anomalies | derived from same metrics + a threshold table in the section file |
| Coaching weekly | `lib/db/programs.ts`, `lib/db/progress.ts`, `lib/db/form-reviews.ts`, `lib/db/users.ts` |
| Revenue weekly | `lib/db/subscriptions.ts`, `lib/db/payments.ts`, `lib/db/shop-orders.ts` |
| Lead funnel weekly | `lib/db/newsletter.ts`, `lib/db/shop-leads.ts`, `lib/db/google-ads-metrics.ts`, `lib/db/google-ads-campaigns.ts`, `lib/db/marketing-attribution.ts` |
| Content weekly | `lib/db/social-posts.ts`, `lib/db/social-analytics.ts`, `lib/db/blog-posts.ts`, `lib/db/newsletters.ts`, `lib/db/newsletter.ts` (existing) |
| Ops health weekly | `lib/db/ai-generation-log.ts`, `lib/db/voice-drift-flags.ts`, `lib/db/system-settings.ts` |

If any required DAL function is missing a needed query (e.g. "subscriptions cancelled in range"), the builder author adds it to the existing DAL file rather than creating a one-off query in the analytics layer.

## Top-of-mind bullet generation (weekly)

1. Collect all numeric (current, previous) pairs from the section payloads.
2. For each pair, skip if `previous < floor` (per-metric floor: revenue $50, subs 1, sessions 5, leads 3, etc.).
3. Compute absolute % delta. Sort descending. Take top 5.
4. Format each as a one-liner with the metric label, current value, and signed delta. Positive deltas use the brand success colour; negative use the error colour.
5. If no metric clears its floor, render a single neutral line: *"Quiet week across the board."*

## Error handling

- A builder that throws is caught at the orchestrator. The orchestrator logs the error with the builder name and continues — that section is omitted from the email.
- The email always sends even if some sections fail. Better partial than missed.
- Failures within a single builder (e.g. one DAL call throws) are the builder's problem to handle locally; partial payloads are fine.

## Testing

- Unit tests per builder under `__tests__/lib/analytics/sections/<area>.test.ts`. Use mocked DAL functions. Cover: (a) empty case → returns `null`, (b) populated case → returns expected payload, (c) edge cases per builder.
- Existing `__tests__/api/admin/internal/send-daily-pulse.test.ts` and `send-weekly-report.test.ts` stay green. Update fixtures only where the payload shape changed.
- Add a snapshot test for each updated email component rendering with a representative payload, so future changes show up as a clear diff.

## Migration / rollout

- Single deploy. No feature flag.
- Existing dry-run support (`{ dryRun: true }` on the route) lets the coach preview the new format before the next scheduled send.
- If output looks wrong in the first scheduled run, set `cron_daily_pulse_enabled` / `cron_weekly_report_enabled` to `false` via `system_settings` to pause while we fix.

## Out of scope (explicit)

- Per-section enable/disable in admin UI. Could be added later if the coach wants finer control.
- Per-client highlight cards (e.g. "Sarah hit a PR"). Possible later layer once the foundation works.
- Mobile push or Slack mirroring. Email is the channel.
- Replacing the broader business KPIs that already live in the standalone `WeeklyAdsReport`, `WeeklyPipelineReport`, `WeeklyAgentMemo` emails. Those remain dedicated deep-dives.

## Open questions

None blocking. The answers above lock the daily structure, the weekly structure, the empty-section behaviour, and the top-of-mind bullet rule.
