# Starter AI Automation — Phase 5b: Analytics Tabs (Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode)
**Scope:** Two new read-only tabs in the existing admin AnalyticsDashboard. No schema changes, no cron jobs.
**Depends on:** 5a (`social_analytics` table + nightly sync)
**Precedes:** 5c (Weekly Content Report — same aggregation functions get reused in the email template)

## Goal

Surface everything 5a has been collecting (plus existing blog / newsletter data) inside the admin's `AnalyticsDashboard`, using the exact same patterns as `RevenueTab`, `ShopTab`, etc.

## Non-goals

- No new database tables or schema changes.
- No new API routes.
- No new Firebase Functions.
- No editing / approving / deleting content from these tabs — they are purely read-only dashboards.
- Learning-loop / voice-drift views — **5e/5f**.
- Email copies of these metrics — **5c/5d**.

## Tabs

### SocialTab

Reads from: `social_posts`, `social_analytics`.

**KPIs (4 StatCards, top of tab):**
- Posts generated (in range) — trend vs. previous period
- Posts published (in range) — trend vs. previous period
- Total impressions (sum across newest snapshot per post, in range)
- Total engagement (sum, same basis)

**Middle section (bar chart):** Posts-published-per-month time series (recharts), like `ShopTab`'s revenue-by-month.

**Bottom section (breakdowns, side-by-side `HorizontalBar`s):**
- Posts by platform (published, in range)
- Posts by approval_status (draft / edited / approved / awaiting_connection / scheduled / published / rejected / failed)
- Top 10 posts by engagement (platform icon + truncated content + engagement number)

**Snapshot selection for impressions/engagement:** For each post, use its *most recent* `social_analytics` row whose `recorded_at` falls inside the range. Summing the latest snapshot avoids double-counting across days.

### ContentTab

Reads from: `blog_posts`, `newsletters`, `newsletter_subscribers`.

**KPIs (4 StatCards):**
- Blog posts created (in range) — trend vs. previous
- Blog posts published (in range) — trend vs. previous
- Newsletters sent (in range)
- Active subscribers (current total, no trend — it's a snapshot)

**Middle section (bar chart):** Blog publish cadence — one bar per month showing drafts + published.

**Bottom section:**
- Blogs by category (`HorizontalBar`)
- Blogs by fact-check status (pending / passed / flagged / failed) — new-in-Phase-4, worth surfacing
- Recent publishes table: last 10 blog posts in range with title, status, category, publish/created date

## Architecture

```
[app/(admin)/admin/analytics/page.tsx — server component]
       │  parallel fetch via Promise.all:
       │    existing fetchers (users, programs, payments, ...)
       │  + listSocialPosts()
       │  + listSocialAnalyticsInRange()     ← new DAL fetcher (5a lib)
       │  + getBlogPosts()
       │  + getNewsletters()
       │  + listActiveSubscriberCount()      ← new one-liner (or reuse existing)
       │
       │  computeSocialMetrics(posts, analytics, range, previousRange)
       │  computeContentMetrics(blogs, newsletters, subscriberCount, range, previousRange)
       ▼
[AnalyticsDashboard — client component]
       │  register "social" + "content" in TABS array
       │  pass metrics as props
       ▼
[SocialTab / ContentTab — client components]
       render StatCard + recharts + HorizontalBar, following ShopTab layout
```

**Why two new compute files instead of adding to `compute.ts`:**
- `compute.ts` is already 694 lines. Adding two more large functions would push it past 900. Scope the new work into siblings.
- Export `inRange` + `getMonthsInRange` + `capitalize` helpers from `compute.ts` so the new files reuse them without duplication.
- No refactor of existing `compute.ts` — out of scope.

## Data model additions

**`types/analytics.ts`:**

```ts
export interface SocialAnalyticsSnapshot {
  platform: SocialPlatform
  post_count: number
  impressions: number
  engagement: number
}

export interface SocialMetrics {
  totalPosts: number
  previousTotalPosts: number
  publishedPosts: number
  previousPublishedPosts: number
  totalImpressions: number
  totalEngagement: number

  postsByMonth: { key: string; label: string; total: number; published: number }[]
  postsByPlatform: { label: string; count: number }[]
  postsByStatus: { label: string; count: number }[]
  topPostsByEngagement: {
    social_post_id: string
    platform: SocialPlatform
    content_preview: string
    engagement: number
    impressions: number
  }[]
}

export interface ContentMetrics {
  blogsCreated: number
  previousBlogsCreated: number
  blogsPublished: number
  previousBlogsPublished: number
  newslettersSent: number
  activeSubscribers: number

  blogsByMonth: { key: string; label: string; drafts: number; published: number }[]
  blogsByCategory: { label: string; count: number }[]
  blogsByFactCheckStatus: { label: string; count: number }[]
  recentPublishes: {
    id: string
    title: string
    status: string
    category: string | null
    published_at: string | null
    created_at: string
  }[]
}
```

## Interfaces

### New DAL function — `listSocialAnalyticsInRange`

Added to [lib/db/social-analytics.ts](../../lib/db/social-analytics.ts):

```ts
export async function listSocialAnalyticsInRange(
  from: Date,
  to: Date,
): Promise<SocialAnalytics[]>
```

Returns every snapshot with `recorded_at` between `from` and `to`. The compute function handles most-recent-per-post selection in memory.

### Exported helpers from `compute.ts`

Minimal change: add `export` to the existing `inRange` and `capitalize` functions so the new compute files can reuse them. No behavior change.

## Testing strategy

| Layer | Test | Notes |
|---|---|---|
| `computeSocialMetrics` | fixture-based unit tests — covers KPI math, month bucketing, most-recent-snapshot selection, top-N sort, previous-period comparison | `__tests__/lib/analytics/social.test.ts` |
| `computeContentMetrics` | same pattern | `__tests__/lib/analytics/content.test.ts` |
| `listSocialAnalyticsInRange` | integration test against Supabase (follows existing DAL test pattern) | `__tests__/db/social-analytics.test.ts` — extend existing file |
| SocialTab render | render with mock metrics, assert KPI numbers appear | `__tests__/components/admin/analytics/SocialTab.test.tsx` |
| ContentTab render | same | `__tests__/components/admin/analytics/ContentTab.test.tsx` |

Not tested: the integration between page.tsx server fetches and the tab (covered implicitly by production smoke).

## Rollout

1. Ship as one PR — additive only.
2. Deploy to Vercel.
3. Navigate to `/admin/analytics?tab=social` — confirm render even with zero data (empty states).
4. Once 5a's nightly sync has produced rows, confirm numbers populate.
