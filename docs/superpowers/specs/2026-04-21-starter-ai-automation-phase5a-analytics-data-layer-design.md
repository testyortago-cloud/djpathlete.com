# Starter AI Automation — Phase 5a: Analytics Data Layer (Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode, awaiting live feedback)
**Scope:** Foundation only. No dashboard tabs, no emails, no learning loops.
**Follows:** Phase 4d (Tavily trending + SEO)
**Precedes:** 5b (SocialTab + ContentTab), 5c (Weekly Report), 5d (Daily Pulse)

## Goal

Collect per-post engagement metrics for every **published** social post from every **connected** plugin, on a **nightly schedule**, and persist them as **time-series snapshots** in Supabase so downstream sub-phases (tabs, reports, learning loop) have data to read.

## Non-goals (explicitly deferred)

- Analytics UI (SocialTab / ContentTab) — **Phase 5b**
- Weekly Content Report + Daily Pulse emails — **Phase 5c/5d**
- Voice drift / performance learning cron — **Phase 5e/5f**
- Blog post analytics, newsletter open rates — **later sub-phase** (the `ContentTab` will pull from existing blog/newsletter tables, no new data layer needed there)
- Historical backfill — only forward-looking syncs. Older posts get their first snapshot on their first nightly run.

## Existing infrastructure we're building on

- `PublishPlugin.fetchAnalytics(platformPostId)` interface at [lib/social/plugins/types.ts:38](../../lib/social/plugins/types.ts#L38) — already implemented by Facebook, Instagram, YouTube; stubbed by TikTok and LinkedIn (returns `{}`).
- `platform_connections` table with OAuth tokens in `credentials` jsonb.
- `social_posts` table with `platform`, `platform_post_id`, `approval_status`, `published_at`.
- Firebase Functions runtime (2nd gen, `functions/src/`) with Supabase service-role client already wired.
- No existing `onSchedule` functions — this will be the first.

## Data model — migration 00089

One new table: `social_analytics`. Time-series: one row per (post, sync run).

```sql
CREATE TABLE social_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  platform social_platform NOT NULL,
  platform_post_id text NOT NULL,
  impressions bigint,
  engagement bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  views bigint,
  extra jsonb,                     -- platform-specific fields outside the core set
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_analytics_post_recorded_desc
  ON social_analytics (social_post_id, recorded_at DESC);

CREATE INDEX idx_social_analytics_platform_recorded_desc
  ON social_analytics (platform, recorded_at DESC);
```

**Shape choice (typed columns + `extra` escape hatch) rationale:**
- Tabs will need `SUM(engagement)`, `AVG(likes)`, top-N queries — typed columns keep these fast + indexable without jsonb path juggling.
- `extra` preserves anything a plugin returns beyond the core six — future-proof without schema churn.
- Nullable columns mirror the optional fields in `AnalyticsResult`.

**Why time-series (not upsert-per-day):**
- Lets us draw trend lines in 5b without losing historical data.
- Space is cheap; one row per post per night ≈ 365 × post_count / year. Acceptable.
- Dedup-per-day is a downstream concern: the dashboard can group by day if needed.

## Architecture

```
[Cloud Scheduler, 03:00 UTC daily]
       │
       ▼
[syncPlatformAnalytics Firebase Function (onSchedule)]
       │   reads published social_posts from Supabase
       │   reads platform_connections (connected only)
       │   groups posts by platform
       ▼
[HTTPS POST → Next.js /api/admin/internal/sync-post-analytics]
       │   authenticated via INTERNAL_API_SHARED_SECRET header
       │   invokes plugin.fetchAnalytics(platformPostId)
       │   returns AnalyticsResult
       ▼
[Function writes social_analytics row via Supabase service-role]
```

**Why route the API calls through Next.js instead of duplicating plugins in `functions/src/`:**

1. Plugin code already lives in `lib/social/plugins/` and is tested there. Re-implementing `fetchAnalytics` in the function would double the maintenance surface.
2. The function keeps its responsibility narrow: **schedule + orchestration + DB write**. Next.js keeps its responsibility: **platform API wrapper**.
3. Matches the existing separation in this repo (Next.js owns domain logic, Functions own scheduling + heavy compute).

**Trade-off accepted:** One extra network hop per post (function → Vercel → plugin). For nightly syncs on O(100) posts, this is negligible.

## Interfaces

### Internal API route — POST `/api/admin/internal/sync-post-analytics`

**Auth:** `Authorization: Bearer <INTERNAL_CRON_TOKEN>` header, matching the existing internal-route convention. 401 otherwise. No session required (Firebase Function is the caller).

**Request body:**
```ts
{
  socialPostId: string  // uuid
}
```

**Response (200):**
```ts
{
  socialPostId: string,
  platform: SocialPlatform,
  platformPostId: string,
  metrics: AnalyticsResult | null  // null if platform not connected or plugin returned empty
}
```

**Errors:**
- 401 — bad/missing secret
- 404 — post not found
- 409 — post not published / no `platform_post_id`
- 502 — plugin threw (rate limit, token expired) — body includes `error` string

### Firebase Function — `syncPlatformAnalytics`

```ts
export const syncPlatformAnalytics = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    memory: "512MiB",
    timeoutSeconds: 540,
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl],
  },
  async () => { /* ... */ }
)
```

**Flow per run:**
1. Query Supabase for `social_posts` where `approval_status = 'published'` AND `platform_post_id IS NOT NULL` — cap at 500 rows per run (safety).
2. For each post, POST to `/api/admin/internal/sync-post-analytics`.
3. On 200 with non-null metrics: insert one `social_analytics` row.
4. On non-200: log + continue (do not fail the whole run).
5. Return `{ synced, skipped, failed }` counts for logs.

**Idempotency:** Running the function twice on the same day inserts two rows per post. That is acceptable — the dashboard can `GROUP BY date_trunc('day', recorded_at)`. Dedup is not a data-layer concern.

### DAL — `lib/db/social-analytics.ts`

Minimal surface for now. Two functions:

```ts
export async function insertSocialAnalytics(
  row: Omit<SocialAnalytics, "id" | "created_at">
): Promise<SocialAnalytics>

export async function listRecentAnalyticsByPost(
  socialPostId: string,
  limit?: number
): Promise<SocialAnalytics[]>
```

No list-by-platform / list-by-date-range yet — those arrive when 5b needs them. YAGNI.

## Error handling

| Condition | Function response | Row inserted? |
|---|---|---|
| Plugin stub returns `{}` (TikTok, LinkedIn today) | skip | no |
| Platform not connected | skip | no |
| Plugin throws / 502 from route | log + continue | no |
| Plugin returns partial metrics (e.g., only `views`) | insert with nullables | yes |
| HTTP timeout to internal route | log + continue | no |

Failing a single post must never abort the whole nightly run. The function returns per-run counters for monitoring.

## Testing strategy

| Layer | Test | File |
|---|---|---|
| Migration | table + indexes exist, FK cascade works | `__tests__/migrations/00089_social_analytics.test.ts` |
| DAL | insert + list round-trip (uses live Supabase test schema) | `__tests__/db/social-analytics.test.ts` |
| Internal route | 401/404/409/502 branches, happy path calls plugin | `__tests__/api/admin/internal/sync-post-analytics.test.ts` |
| Function helper | extract metric mapping + HTTP caller as pure functions; unit test them | `functions/src/__tests__/sync-platform-analytics.test.ts` |

**Not tested end-to-end:** The `onSchedule` trigger itself. Cloud Scheduler triggering is a Firebase platform responsibility; we test the handler as a pure function.

## Environment variables

| Key | Where | New? |
|---|---|---|
| `INTERNAL_CRON_TOKEN` | Vercel + Firebase secrets | existing (reused from publish-due) |
| `SUPABASE_SERVICE_ROLE_KEY` | Firebase secrets | existing |
| `APP_URL` | Firebase secrets | existing (already used by `transcribeVideo`) |

No new secrets. We reuse the bearer token that already guards `/api/admin/internal/publish-due` and `/api/admin/internal/tavily-trending`, and the `APP_URL` secret already consumed by the video transcription function.

## Rollout

1. Ship migration → DAL → internal route → function in one PR.
2. Deploy Next.js (Vercel).
3. Set `INTERNAL_API_SHARED_SECRET` in both environments.
4. `firebase deploy --only functions:syncPlatformAnalytics`.
5. **Manual trigger** the scheduled function once via Cloud Scheduler UI to verify end-to-end; check `social_analytics` rows appear.
6. Let the nightly schedule run for 2 nights; confirm counter logs are clean.
7. Unblock 5b.

## Open questions / decisions locked

- **Time zone for schedule:** UTC (3 AM UTC = 10 PM Central, after the typical posting day). 5c/5d emails may shift — no constraint yet.
- **Backfill:** Not in scope. If desired later, add a one-shot script that hits the same internal route for every published post.
- **TikTok / LinkedIn stubs:** Skip gracefully today. When their `fetchAnalytics` becomes real (Phase 2b OAuth follow-ups), the scheduler picks them up automatically with zero schema change.
