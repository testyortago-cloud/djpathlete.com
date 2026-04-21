# Starter AI Automation — Phase 5f: Performance Learning Loop (Design)

**Date:** 2026-04-21
**Status:** Accepted (auto-mode)
**Scope:** One weekly scheduled job + one jsonb column on `prompt_templates`.
**Depends on:** 5a (`social_analytics` populated nightly).
**Wraps up Phase 5.**

## Goal

Every Monday, pick the top 3 performing social posts per platform from the last 30 days and store them as `few_shot_examples` on the matching `prompt_templates` row. Future caption generation can inject these examples into the prompt; the loop itself just keeps the data fresh.

## Non-goals

- No changes to `generateSocialFanout` in this phase — storing the data is the deliverable. Wiring fanout to read `few_shot_examples` is a follow-up.
- No UI — admin can inspect via the existing prompt template editor.
- No per-audience segmentation — one top-3 list per platform.
- No learning from blog/newsletter performance — social only for now (those don't have engagement data yet).

## Why store in a column, not a side table

- Reads happen at caption-generation time from a code path that already fetches `prompt_templates`. One table, one query.
- No orphan risk — the examples live on the template.
- JSONB keeps the shape flexible if we later want to add video_url, original_post_id, etc.

## Data model — migration 00091

```sql
ALTER TABLE prompt_templates
  ADD COLUMN few_shot_examples jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prompt_templates.few_shot_examples IS
  'Top-performing real examples for this prompt. Populated weekly by the performanceLearningLoop Firebase Function when category = social_caption. Array of { caption, platform, engagement, impressions, recorded_at }.';
```

Additive. No backfill. Existing rows default to `[]`.

### TypeScript shape

```ts
interface PromptFewShotExample {
  caption: string                 // truncated to 500 chars
  platform: SocialPlatform
  engagement: number
  impressions: number
  recorded_at: string             // ISO from social_analytics.recorded_at
  social_post_id: string          // so we can show provenance if UI surfaces them
}

interface PromptTemplate {
  // ... existing fields
  few_shot_examples: PromptFewShotExample[]
}
```

## Architecture

```
Cloud Scheduler (Mon 03:00 America/Chicago — before voiceDriftMonitor @ 04:00)
       │
       ▼
[performanceLearningLoop — Firebase Function onSchedule]
       │  for each platform P in [facebook, instagram, tiktok, youtube, youtube_shorts, linkedin]:
       │    1. fetch published social_posts where platform=P AND published_at >= now - 30d
       │    2. for each, find the most-recent social_analytics snapshot within 30d
       │    3. rank by engagement desc (exclude engagement <= 0)
       │    4. take top 3 → build PromptFewShotExample[]
       │    5. if any, UPDATE prompt_templates SET few_shot_examples = $1
       │       WHERE category='social_caption' AND scope=P
       │    6. if zero top posts → skip (preserve previous examples rather than wiping)
       ▼
[prompt_templates row updated (or untouched on empty-week platforms)]
```

**Why "preserve on empty" instead of clearing:**
- A quiet week shouldn't forget what worked before. Old examples stay valid until we have better ones.
- If an admin wants a reset, they can edit the row manually.

## Schedule

`"0 3 * * 1"` in `America/Chicago`. Chosen so it runs before `voiceDriftMonitor` (04:00) — voice drift reads the current `prompt_templates.voice_profile` which this loop doesn't touch, so the order is actually independent. Keeping it early anyway so Monday's Daily Pulse (07:00) could, in a later phase, reflect the freshly-updated examples.

## Function signature

```ts
export async function runPerformanceLearningLoop(options?: {
  supabaseImpl?: SupabaseClient
  now?: Date
  topN?: number                   // defaults to 3
  lookbackDays?: number           // defaults to 30
}): Promise<{
  platformsUpdated: string[]
  platformsSkippedEmpty: string[]
  totalExamplesWritten: number
  errors: number
}>
```

## Selection logic per platform

1. One Supabase query per platform to fetch candidate posts:
   ```
   SELECT id, content, platform, published_at
   FROM social_posts
   WHERE platform = $1
     AND approval_status = 'published'
     AND published_at >= now() - interval '30 days'
   ORDER BY published_at DESC
   LIMIT 100
   ```
2. One query to fetch all their analytics snapshots (single IN query instead of N+1):
   ```
   SELECT social_post_id, impressions, engagement, recorded_at
   FROM social_analytics
   WHERE social_post_id = ANY($1)
     AND recorded_at >= now() - interval '30 days'
   ORDER BY recorded_at DESC
   ```
3. Keep the newest snapshot per post (Map-reduce in memory).
4. Filter `engagement > 0`, sort by engagement desc, take top N.
5. Build the example array.
6. Single UPDATE to the matching template row.

Running at 6 platforms × 2 queries + 1 update = 18 lightweight queries per run. Well within the weekly schedule's budget.

## Skipping when there's no voice_profile or no template

- If `prompt_templates` has no row for `category='social_caption' AND scope=<platform>`, skip that platform silently. (Phase 3 seeding creates these rows — migration 00083.)
- If the loop can't update due to constraint errors, increment `errors` and continue to the next platform.

## Testing

| Layer | Test | File |
|---|---|---|
| Migration | new column exists, default is empty array | `__tests__/migrations/00091_prompt_templates_few_shot.test.ts` |
| Function unit | fixture supabase returns posts + analytics; asserts top-N sort, update payload shape, skip-when-empty | `functions/src/__tests__/performance-learning-loop.test.ts` |

No route / UI test — no surface exists yet.

## Env / secrets

Reuses existing:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Firebase secrets)

No Claude calls. Pure aggregation — cheap to run.

## Rollout

1. Apply migration 00091 via Supabase MCP (additive).
2. Update `PromptTemplate` TS type.
3. `firebase deploy --only functions:performanceLearningLoop`.
4. Manually invoke once via Cloud Scheduler UI (or by calling `runPerformanceLearningLoop()` from a scratch script) and verify `few_shot_examples` is populated for platforms with published posts + analytics.
5. Monday 3 AM cron takes over.

## Follow-ups (not part of this phase)

- Update `generateSocialFanout` to read `few_shot_examples` from the platform's prompt template and inject them into the Claude system prompt as concrete examples. This is where the loop becomes valuable — but it's a separate change with its own design review.
- Admin-visible "how these examples were chosen" panel in the prompt template editor.
