# SEO Agent — Design

**Date:** 2026-05-13
**Status:** Design (pre-plan). Solo-dev project; commits land on `main`.

## Goal

Build an SEO agent for darrenjpaul.com that picks **two highest-leverage actions per week**, executes them through existing pipelines, and learns from outcomes. The agent reasons over fused signals (Google Search Console, blog inventory, Tavily trending, internal-link graph, prior decisions) and produces a written rationale plus structured tool calls. It replaces what would otherwise be a thicket of fixed-rule crons.

This is an additive system. The existing Tuesday/Thursday `autoBlogCron` and the existing blog generation pipeline keep running unchanged — the agent feeds the same queue and uses the same primitives.

## Why an agent and not a pipeline

A fixed pipeline (rule-based "promote winnable keyword Thursday + refresh decayed post Sunday") is simpler to ship but caps out at what the rules express, can't notice cross-cutting opportunities (cannibalization, orphan posts, schema drift, intent mismatch), and never gets smarter. The codebase already runs a 4-agent pattern for program generation, so an agent here is stylistically consistent. The tradeoff is higher per-run Claude cost (one reasoning call per week) and slower trust-building — mitigated by limiting writes to drafts where any live content changes.

## Architecture

Two layers, separated by storage:

```
┌─ Substrate layer (cheap, daily) ──────────────────────────────────┐
│  gscSyncCron   (Firebase onSchedule, 03:00 UTC daily)             │
│    → POST /api/admin/internal/gsc-sync                            │
│    → upserts gsc_query_daily (3-day rolling window)               │
└───────────────────────────────────────────────────────────────────┘
                              │
                              │ reads
                              ▼
┌─ Agent layer (expensive, weekly) ─────────────────────────────────┐
│  seoAgentCron  (Firebase onSchedule, Sun 14:00 UTC)               │
│    → POST /api/admin/internal/seo-agent                           │
│    → enqueues ai_jobs/{type:"seo_agent_run"}                      │
│                                                                   │
│  functions/src/seo-agent.ts — handler runs four steps:            │
│    1. gather()   — parallel signal fetches                        │
│    2. reason()   — single Claude call with tool definitions       │
│    3. execute()  — invoke chosen tools                            │
│    4. remember() — insert seo_agent_memos                         │
└───────────────────────────────────────────────────────────────────┘
                              │
                              │ writes via tools
                              ▼
┌─ Action substrate (existing) ─────────────────────────────────────┐
│  content_calendar.topic_suggestion → autoBlogCron picks up Tue/Thu│
│  ai_jobs.blog_refresh              → blog-refresh handler         │
│  ai_jobs.internal_link_sweep       → internal-link handler        │
│  admin notifications + email digest                               │
└───────────────────────────────────────────────────────────────────┘
                              │
                              │ outcomes
                              ▼
┌─ Learning loop ───────────────────────────────────────────────────┐
│  outcomeTrackerCron (Firebase onSchedule, 04:00 UTC daily)        │
│    → finds memos older than 14 days with outcome_status=pending   │
│    → backfills outcome_metrics from gsc_query_daily               │
│    → next week's seoAgentCron reads last 8 memos as context       │
└───────────────────────────────────────────────────────────────────┘
```

### Design principles

- **Substrate vs. agent split.** Live GSC fetches in the agent's hot path would be slow, rate-limited, and unobservable. The agent reads day-old data from Supabase. Acceptable freshness tradeoff because SEO decisions are weekly, not minute-by-minute.
- **One reasoning call per cycle.** Not a multi-step agent loop. The agent emits two actions in one structured response, then the handler executes them. No iterative tool-use within a run.
- **Two actions per week, ranked.** First action = highest leverage. Second action = second highest leverage AND a different type from the first. Prevents the agent queuing two refreshes and starving new content.
- **Tools are existing primitives.** `queue_new_post` writes a row that `autoBlogCron` already knows how to consume. `queue_refresh` enqueues a job that `blog-refresh` handler executes. The agent is the brain; the existing pipeline is the hand.
- **Always-draft on writes that change live content.** Refreshes produce drafts the coach reviews before re-publishing. New posts use the existing `autoBlogCron` flow (which already auto-publishes). Coach can pause the whole loop via `automation_paused`.
- **Outcome tracking closes the loop.** Without it the agent rolls dice. The tracker writes back what each action produced after 14 days, and the next run reads that history as part of its context.

## Data model

### New table: `gsc_query_daily`

```sql
CREATE TABLE gsc_query_daily (
  date         DATE         NOT NULL,
  query        TEXT         NOT NULL,
  page         TEXT         NOT NULL,
  impressions  INTEGER      NOT NULL,
  clicks       INTEGER      NOT NULL,
  ctr          NUMERIC(6,5) NOT NULL,
  position     NUMERIC(6,2) NOT NULL,
  ingested_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (date, query, page)
);

CREATE INDEX idx_gsc_query_daily_query_date ON gsc_query_daily (query, date DESC);
CREATE INDEX idx_gsc_query_daily_page_date  ON gsc_query_daily (page, date DESC);
CREATE INDEX idx_gsc_query_daily_date       ON gsc_query_daily (date DESC);
```

Composite PK makes nightly syncs idempotent upserts. One row = one query + one URL + one day, matching GSC's natural granularity. No pre-aggregation; we run 28-day window queries at read time.

### New table: `gsc_properties`

```sql
CREATE TABLE gsc_properties (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_url             TEXT         NOT NULL UNIQUE,
  refresh_token        TEXT         NOT NULL,
  access_token         TEXT,
  access_token_expires TIMESTAMPTZ,
  connected_by_user_id UUID         NOT NULL REFERENCES profiles(id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

One row. Mirrors the `google_ads_accounts` shape and reuses the `lib/ads/oauth.ts` HMAC-state pattern.

### New table: `seo_agent_memos`

```sql
CREATE TABLE seo_agent_memos (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        DATE         NOT NULL,
  ai_job_id       TEXT         NOT NULL,

  signals_summary JSONB        NOT NULL,
  rationale       TEXT         NOT NULL,
  actions         JSONB        NOT NULL,

  outcome_status  TEXT         NOT NULL DEFAULT 'pending',
                  -- 'pending' (set by agent on insert)
                  -- 'measured' (set by outcomeTrackerCron after 14d)
                  -- 'rolled_back' (set when coach overrides an action via admin UI before it runs)
  outcome_metrics JSONB        NULL,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  measured_at     TIMESTAMPTZ  NULL
);

CREATE INDEX idx_seo_agent_memos_run_date ON seo_agent_memos (run_date DESC);
CREATE INDEX idx_seo_agent_memos_pending  ON seo_agent_memos (outcome_status, run_date)
  WHERE outcome_status = 'pending';
```

`signals_summary` shape:

```jsonc
{
  "gsc_28d": {
    "total_clicks": 1842,
    "total_impressions": 41203,
    "avg_position": 14.7,
    "top_winnable":  [{ "query": "...", "avg_position": 11.2, "impressions": 312 }, ...],
    "top_decayed":   [{ "slug": "...", "position_drop": 6.3, "clicks_28d": 8 }, ...]
  },
  "inventory": { "total_posts": 47, "oldest_post_age_days": 612, "never_refreshed_count": 38 },
  "recent_tavily": [{ "title": "...", "score": 0.92 }, ...],
  "orphan_post_ids": ["uuid", ...],
  "last_8_memos_outcomes": [{ "run_date": "...", "tool": "queue_refresh", "outcome": "clicks +18, position −7.3" }, ...]
}
```

`actions` shape (always exactly 2 entries):

```jsonc
[
  {
    "rank": 1,
    "tool": "queue_refresh",
    "args": { "blog_post_id": "uuid", "reason": "lost 7 positions for 'tampa bay strength coach' over 28d" },
    "executed": false,
    "execution_target_id": null
  },
  {
    "rank": 2,
    "tool": "queue_new_post",
    "args": { "keyword": "...", "angle": "...", "references": ["..."] },
    "executed": false,
    "execution_target_id": null,
    "complementary_to_rank_1": "covers a new query cluster rather than another refresh"
  }
]
```

`outcome_metrics` shape (filled by `outcomeTrackerCron` after 14 days):

```jsonc
[
  { "action_index": 0, "executed": true, "target_id": "...", "clicks_before": 12, "clicks_after": 31, "position_before": 18.3, "position_after": 9.1 },
  { "action_index": 1, "executed": true, "target_id": "...", "clicks_before": 0,  "clicks_after": 4,  "position_before": null,  "position_after": 22.1 }
]
```

### Extensions to existing tables

| Table | Change |
|---|---|
| `blog_posts` | Add `last_refreshed_at TIMESTAMPTZ NULL` and `refresh_count INT NOT NULL DEFAULT 0`. Used to dedupe — same post can't refresh within 90 days. |
| `content_calendar.metadata` (jsonb, already exists) | New convention: when the agent's `queue_new_post` writes a row, metadata is `{ source: "seo_agent", primary_keyword, angle, references, memo_id }`. No schema change. |
| `system_settings` (key/value, already exists) | Add rows: `cron_gsc_sync_enabled`, `cron_seo_agent_enabled`, `cron_outcome_tracker_enabled` — all default `false` (opt-in, matches existing pattern). |
| `ai_jobs` (Firestore) | Three new `type` values: `seo_agent_run`, `blog_refresh`, `internal_link_sweep`. |

### Out of scope (data layer)

- No per-page rollup table (`gsc_page_daily`). Compute at read time.
- No multi-property support. One site, one `gsc_properties` row.
- No `seo_agent_runs` audit table. Memos are the audit log.

## GSC OAuth + nightly substrate

### OAuth flow (one-time per coach)

Mirrors `lib/ads/oauth.ts`. New files:

- `lib/gsc/oauth.ts` — `buildAuthorizationUrl`, `exchangeCode`, `refreshAccessToken`. Scope: `https://www.googleapis.com/auth/webmasters.readonly`. ~80 lines.
- `lib/gsc/client.ts` — `getValidAccessToken()` (refreshes lazily when `access_token_expires < now() + 60s`), `searchAnalyticsQuery(params)`.
- `app/api/admin/integrations/gsc/authorize/route.ts` — builds authorization URL with HMAC-signed state.
- `app/api/admin/integrations/gsc/callback/route.ts` — verifies state, exchanges code, confirms site ownership via `sites.list`, upserts `gsc_properties`.
- `app/(admin)/admin/integrations/gsc/page.tsx` — connect/disconnect button + last-sync timestamp.

Reuses `INTERNAL_CRON_TOKEN` as the HMAC secret (already in env).

### Nightly sync — `/api/admin/internal/gsc-sync`

```
POST /api/admin/internal/gsc-sync
  Authorization: Bearer ${INTERNAL_CRON_TOKEN}

1. Auth gate (bearer token).
2. isCronSkipped({ enabledKey: "cron_gsc_sync_enabled", defaultEnabled: false }).
3. Load gsc_properties row. Return { skipped: "not_connected" } if absent.
4. Compute date window: yesterday → 3 days ago.
5. For each date in window:
     POST searchAnalyticsQuery({
       startDate, endDate: startDate,
       dimensions: ["query", "page"],
       rowLimit: 25000
     })
6. UPSERT into gsc_query_daily ON CONFLICT (date, query, page) DO UPDATE.
7. Return { synced: { [day]: rowCount, ... }, totalRows }.
```

The 3-day rolling window catches GSC's retroactive attribution updates (clicks/impressions can shift for ~48h).

Hard-fail on OAuth 401: write `gsc_oauth_broken = true` to `system_settings` so the admin UI shows a reconnect banner.

### Scheduler — `gscSyncCron`

```ts
// functions/src/index.ts
export const gscSyncCron = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => { /* fetch /api/admin/internal/gsc-sync with bearer token */ },
)
```

Deploy: `firebase deploy --only functions:default:gscSyncCron`.

## Agent run pipeline

### Endpoint — `/api/admin/internal/seo-agent`

Thin wrapper that enqueues an `ai_job`. Real work runs in the Firebase handler.

```
POST /api/admin/internal/seo-agent
  Authorization: Bearer ${INTERNAL_CRON_TOKEN}

1. Auth + isCronSkipped({ enabledKey: "cron_seo_agent_enabled", defaultEnabled: false }).
2. Create ai_jobs/{type:"seo_agent_run", input:{ runDate: today }, userId: SYSTEM_USER_ID}.
3. Return { jobId, status: "pending" }.
```

### Job dispatch — `run-job.ts`

The existing generic ai_jobs queue runner (`functions/src/run-job.ts`) needs one new `case` to dispatch `type: "seo_agent_run"` to the handler below. Same one-line addition pattern as the other ai_job types. Likewise `type: "blog_refresh"` and `type: "internal_link_sweep"` need dispatch entries when their handlers are added in phases 2 and 3.

### Handler — `functions/src/seo-agent.ts`

Four sequential steps:

**Step 1 — `gather()`.** Parallel fetches into a single `signals_summary` object:

- 28-day GSC: top 20 winnable queries (positions 8–20, impressions ≥50, no published post on that keyword), top 20 decayed pages (position drop ≥5 vs prior 28d, age ≥6mo, not refreshed in 90d), site-wide totals.
- Blog inventory: count, oldest age, never-refreshed count, all primary keywords.
- Recent Tavily: last 4 weeks of `content_calendar.topic_suggestion` rows where `metadata.source = 'tavily'`.
- Orphan posts: published posts with zero internal links pointing in (cheap heuristic — body text scan for `/blog/<slug>` references).
- Memory: last 8 `seo_agent_memos` with their `outcome_metrics`.

Helpers live in `lib/gsc/signals.ts` — each one a pure function that takes a Supabase client and returns a typed summary. Easy to unit-test in isolation.

**Step 2 — `reason()`.** Single Claude call via `lib/ai/anthropic.ts` (existing wrapper) using tool-use mode.

System prompt (sketch):

> You are the SEO strategist for darrenjpaul.com — a strength & conditioning coach's site. Your job each Sunday is to pick the two highest-leverage SEO actions for the coming week.
>
> You see fused signals: Google Search Console performance, the blog inventory, prior Tavily topic suggestions, orphan posts with no inbound internal links, and the outcomes of your previous 8 decisions.
>
> Rules:
> 1. Output exactly two actions, ranked by leverage.
> 2. The two actions must be of different types (no two refreshes, no two new posts).
> 3. Each action must be justified in one sentence inside its `args.reason` field. The overall pair must be justified in a 2–5 sentence top-level rationale.
> 4. Prefer actions whose outcome you can measure. Avoid actions whose outcome is purely qualitative.
> 5. If the outcomes table shows a tactic underperforming (e.g., refreshes producing no clicks delta), shift weight to other tactics this week.

User message: the full `signals_summary` JSON.

Tools provided:

```ts
[
  {
    name: "queue_new_post",
    description: "Drop a topic_suggestion row that autoBlogCron will pick up Tuesday or Thursday.",
    input_schema: { keyword: string, angle: string, references?: string[] }
  },
  {
    name: "queue_refresh",
    description: "Enqueue an in-place refresh of an existing blog post. Produces a draft for coach review.",
    input_schema: { blog_post_id: string, reason: string }
  },
  {
    name: "queue_internal_link_sweep",
    description: "Insert 2–3 internal links from older posts into a target post.",
    input_schema: { target_blog_post_id: string, candidate_anchor_post_ids: string[] }
  },
  {
    name: "flag_for_human",
    description: "Notify the coach about something needing judgment (cannibalization, schema break, etc.).",
    input_schema: { issue: string, urgency: "low" | "medium" | "high", context: string }
  }
]
```

Output expected: `{ rationale: string, actions: [Action, Action] }`. Validation: 2 actions, distinct tools, all `args` parseable per tool schema. Re-prompt once on validation failure; on second failure, write a `flag_for_human` memo and abort.

**Step 3 — `execute()`.** For each of the 2 actions, in order:

- `queue_new_post`: insert into `content_calendar`. Set `execution_target_id` to the new row's id.
- `queue_refresh`: insert into Firestore `ai_jobs/{type:"blog_refresh", input:{blogPostId, reason}}`. Set `execution_target_id` to the job id.
- `queue_internal_link_sweep`: insert into Firestore `ai_jobs/{type:"internal_link_sweep", input:{targetBlogPostId, candidateAnchorPostIds}}`. Set `execution_target_id` to the job id.
- `flag_for_human`: create admin notification + email digest entry. Set `execution_target_id` to the notification id.

If any execution throws, mark that action's `executed: false`, log the error, and continue with the next action. The memo records partial execution honestly.

**Step 4 — `remember()`.** Insert one row into `seo_agent_memos` with `signals_summary`, `rationale`, `actions` (with `executed` + `execution_target_id` set), `outcome_status = "pending"`. Return the memo id.

### Scheduler — `seoAgentCron`

```ts
export const seoAgentCron = onSchedule(
  {
    schedule: "0 14 * * 0",  // Sunday 14:00 UTC = 9 AM Central winter / 10 AM summer
    timeZone: "UTC",
    timeoutSeconds: 540,     // longer — includes Claude call
    memory: "512MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl, anthropicApiKey],
  },
  async () => { /* fetch /api/admin/internal/seo-agent */ },
)
```

Sunday 14:00 UTC is late morning Central — gives the coach time Monday to review any drafts the agent queued.

## Tools — execution detail

### `queue_new_post`

Inserts:

```ts
{
  entry_type:    "topic_suggestion",
  title:         args.keyword,            // literal search query becomes the topic title
  scheduled_for: nextTuesday(),           // first auto-blog cron after this run
  status:        "planned",
  metadata: {
    source:          "seo_agent",
    rank:            1,                   // single suggestion = always rank 1
    primary_keyword: args.keyword,
    angle:           args.angle,
    references:      args.references,
    memo_id:         memoId,
    agent_reason:    args.reason
  }
}
```

`autoBlogCron`'s existing picker (`pickBestTopic` in `app/api/admin/internal/auto-blog/route.ts`) needs no change. It already sorts by `metadata.rank` ascending, then `created_at` descending. A freshly inserted `seo_agent`-sourced row with rank=1 and a more recent `created_at` than any Tavily row will win the tie-breaker on the next cron fire. (If a Tavily row also exists for the same scheduled_for week, Tuesday picks one, Thursday picks the other.)

### `queue_refresh` → new `blog_refresh` ai_job

New handler `functions/src/blog-refresh.ts`. Parallel to `blog-generation.ts` with persistence differences:

| Aspect | `blog_generation` (existing) | `blog_refresh` (new) |
|---|---|---|
| Output | INSERT new `blog_posts` row | UPDATE existing row by `blogPostId` |
| Status after success | `published` | **always** `draft` |
| Preserved fields | n/a | `id`, `slug`, `published_at`, `author_id`, `category` — never overwritten |
| Updated fields | n/a | `title`, `summary`, `body`, `faq`, `seo_metadata`, `last_refreshed_at = now()`, `refresh_count += 1` |
| Cache | revalidate `/blog` on publish | revalidate when coach later re-publishes (existing publish path) |
| IndexNow | submit on publish | submit when coach re-publishes (existing) |

Reuses every existing generation step: voice profile load, seo_enhance pass, FAQ extraction, schema validation. Only the persistence step is different. The handler passes the current post body to the model as context (so it iterates rather than rewriting blind).

Notification on success: `createAdminNotification({ type: "blog_refresh_ready", href: "/admin/blog/${slug}/edit" })`.

### `queue_internal_link_sweep` → new `internal_link_sweep` ai_job

New handler `functions/src/internal-link-sweep.ts`:

1. Load target post body + each candidate anchor post body.
2. For each candidate, ask Claude: "Pick a natural anchor phrase already in this body where linking to the target post would help the reader. If no natural fit exists, return null."
3. For non-null returns, insert a markdown link in the candidate's body via the same body-editing path `seo_enhance` uses. Cap at 2 successful insertions per sweep to avoid over-linking.
4. Bump `updated_at` on edited candidates. Revalidate `/blog/<slug>` for each.

Always-draft is NOT applied here because internal links don't change the substance of the candidate posts — they're additive. Safer to ship live than to add a review gate that gets skipped.

### `flag_for_human`

```ts
await createAdminNotification({
  type: "seo_agent_flag",
  title: `[${urgency}] ${issue}`,
  body: context,
  href: "/admin/seo-agent/memos"
})
```

Plus a row in the next `sendDailyPulse` digest email.

## Outcome tracking — `outcomeTrackerCron`

The mechanism that makes this an agent instead of a slot machine.

```
POST /api/admin/internal/outcome-tracker
  Authorization: Bearer ${INTERNAL_CRON_TOKEN}

1. Auth + isCronSkipped({ enabledKey: "cron_outcome_tracker_enabled", defaultEnabled: false }).
2. SELECT * FROM seo_agent_memos
   WHERE outcome_status = 'pending'
     AND run_date <= CURRENT_DATE - INTERVAL '14 days';
3. For each memo, for each of its 2 actions:
     • If executed=false → mark { action_index, executed: false }.
     • If executed=true and tool was queue_new_post:
         - resolve execution_target_id → blog_posts.slug
         - SELECT clicks/position from gsc_query_daily for that page,
           windowed (post_publish_date+7) → (post_publish_date+21)
         - record { clicks_before: 0, clicks_after, position_before: null, position_after }
     • If executed=true and tool was queue_refresh:
         - resolve execution_target_id → blog_posts.slug (via ai_jobs.result.blogPostId)
         - SELECT clicks/position for 14 days BEFORE refresh and 14 days AFTER
         - record both before/after pairs
     • If executed=true and tool was queue_internal_link_sweep:
         - SELECT impressions/position of target page 14 days before/after sweep
     • If executed=true and tool was flag_for_human:
         - record { acknowledged: bool } — pulled from notifications.read_at
4. UPDATE memo:
     outcome_status = 'measured',
     outcome_metrics = [...],
     measured_at = now()
```

Scheduler:

```ts
export const outcomeTrackerCron = onSchedule(
  { schedule: "0 4 * * *", timeZone: "UTC", timeoutSeconds: 120, memory: "256MiB",
    region: "us-central1", secrets: [internalCronToken, appUrl] },
  async () => { /* fetch /api/admin/internal/outcome-tracker */ },
)
```

The `last_8_memos_outcomes` field that `gather()` builds reads from this — closing the loop.

## Admin UI surfaces

Two new pages, both under existing admin shell:

### `/admin/seo-agent/memos`

Table view of `seo_agent_memos` ordered by `run_date DESC`. Columns:

| Run date | Action 1 | Action 2 | Outcome (after 14d) | Rationale |
|---|---|---|---|---|

Each row expandable to show full `rationale`, full `signals_summary` JSON (collapsed by default), per-action outcome metrics with mini sparkline of clicks/position over the measurement window. "Override" button on any pending action that cancels the queued job (e.g., agent queued a refresh you don't want — kill it before it runs).

### `/admin/integrations/gsc`

- Connection status (connected / disconnected / OAuth broken).
- Last sync timestamp + row count.
- "Connect Google Search Console" button → OAuth flow.
- "Disconnect" button → deletes the `gsc_properties` row.
- Visible reconnect banner if `system_settings.gsc_oauth_broken = true`.

### Update to `/admin/automation`

The existing automation toggle page gets three new rows:
- `cron_gsc_sync_enabled` — "Sync Google Search Console nightly"
- `cron_seo_agent_enabled` — "Run SEO agent weekly"
- `cron_outcome_tracker_enabled` — "Measure SEO agent outcomes daily"

All default OFF (opt-in).

## Operational defaults

| Concern | Default |
|---|---|
| Cron auth | Bearer `INTERNAL_CRON_TOKEN` (existing) |
| Cron gates | Two-layer: global `automation_paused` + per-cron `cron_*_enabled`, both default false |
| Claude model | Same as program-generation agent (whatever `lib/ai/anthropic.ts` currently uses) |
| Re-prompt on tool-validation failure | Once, then `flag_for_human` and abort |
| Refresh cooldown | 90 days per post |
| Topic-suggestion dedup | 60 days |
| Memo measurement window | 14 days after action |
| Always-draft on writes that change live content | Yes (refreshes only — new posts use existing auto-publish) |

## Verification

### Unit tests (Vitest)

- `__tests__/lib/gsc/oauth.test.ts` — state sign/verify round-trip, tampered-state rejection.
- `__tests__/lib/gsc/client.test.ts` — `getValidAccessToken` refresh-on-expiry behavior; `searchAnalyticsQuery` request shape.
- `__tests__/lib/gsc/signals.test.ts` — winnable picker, decay picker, orphan detector (each with seeded fixtures).
- `__tests__/api/internal/gsc-sync.test.ts` — auth gate, skip gate, happy path with mocked GSC API, OAuth-broken flag set on 401.
- `__tests__/api/internal/seo-agent.test.ts` — auth gate, skip gate, ai_job enqueue shape.
- `__tests__/api/internal/outcome-tracker.test.ts` — backfill happy path; handles each tool type; only processes pending memos older than 14d.
- `__tests__/functions/seo-agent.test.ts` — mock Claude to return fixed `actions`; assert `execute()` writes the right rows/jobs and `remember()` inserts the memo with correct `executed` flags.
- `__tests__/functions/blog-refresh.test.ts` — asserts UPDATE preserves id/slug/published_at/author_id and sets status=draft + `last_refreshed_at` + increments `refresh_count`.

### Integration (manual, post-deploy)

1. Connect GSC via admin UI. Verify `gsc_properties` row.
2. Manually invoke `gscSyncCron` via Firebase console. Verify rows in `gsc_query_daily`.
3. Wait until at least 28 days of GSC data accumulated, then manually invoke `seoAgentCron`. Verify memo row + that queued actions actually ran (a draft was created; a topic_suggestion exists for next Tuesday).
4. After 14 days, verify `outcomeTrackerCron` filled `outcome_metrics`.

### Continuous observability

- Memo table is the dashboard. If `outcome_metrics.clicks_after` is consistently lower than `clicks_before`, the agent is making things worse — investigate the prompt.
- Cron logs in Firebase console (existing pattern).

## Out of scope (explicitly)

- **Multi-action iterative reasoning.** Single Claude call per run. No reflexion loops, no critic agents.
- **Cannibalization detection.** Hard problem, deserves its own design pass. Agent can `flag_for_human` if it spots it, but no auto-merge tool.
- **Schema-validity audit.** Likely a separate cron consuming Google Rich Results API. Out of scope here.
- **OG image auto-regen.** Out of scope.
- **Competitor SERP scraping.** Out of scope (legal + maintenance burden).
- **Multi-site / multi-property support.** One `gsc_properties` row, hard-coded site.
- **Slack/email alerts on agent runs.** Coach checks `/admin/seo-agent/memos`. Email digest carries `flag_for_human` items only.
- **Manual "run agent now" button.** Can be added later; for now, manual fire via Firebase console or `workflow_dispatch` equivalent.

## Open questions (not blocking; resolve during implementation)

- **GSC API quota in practice.** 1200 queries/min site-wide is the documented cap; we use 3/night. No issue expected, but verify after a week of running.
- **Refresh cooldown interaction with cancel.** If a coach overrides (cancels) a queued refresh, should `last_refreshed_at` still update? Leaning no — the post wasn't actually touched. Verify the cancel path doesn't write the timestamp.
- **Tool-use vs structured-output.** Anthropic supports both; tool-use feels right for this shape (parallel-callable tools, type-safe args). Confirm during implementation the existing `lib/ai/anthropic.ts` wrapper exposes tool-use cleanly — if not, factor it in.

## Migration plan (phases)

This design is large enough that a phased rollout is worth it. Listed in dependency order:

1. **Phase 1 — Substrate.** GSC OAuth + nightly sync + admin connect page. No agent yet. Lets data accumulate while the agent is being built. ~1 week.
2. **Phase 2 — Refresh primitive.** `blog_refresh` ai_job + handler + a "Refresh this post" button on the existing `/admin/blog/[slug]/edit` page that enqueues the job. Draft review uses the existing edit page. No automation. ~3 days.
3. **Phase 3 — Internal-link primitive.** `internal_link_sweep` ai_job + handler + a "Sweep internal links to this post" button on the same edit page. Manually invokable. ~3 days.
4. **Phase 4 — Agent core.** `seoAgentCron` + handler + memos table + `/admin/seo-agent/memos` page. Off by default. The cron stays off until `gsc_query_daily` has ≥28 days of data (enforced by handler: if not enough data, log and skip without writing a memo). ~1 week.
5. **Phase 5 — Outcome tracker.** `outcomeTrackerCron` + outcome backfill. Closes the loop. ~3 days.

Total: roughly 3 weeks of focused work. Each phase ships independently and has value on its own; the agent only gets its full capability at phase 4 + 5.
