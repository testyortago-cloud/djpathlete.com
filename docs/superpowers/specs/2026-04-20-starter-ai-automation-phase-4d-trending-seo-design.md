# Phase 4d — Weekly Trending Scan + SEO Polish

**Status:** Approved design — ready for implementation plan
**Date:** 2026-04-20
**Author:** brainstormed with tayawaaean
**Parent plan:** [DJP-AI-Automation-Starter-Phases.md § Phase 4](../../DJP-AI-Automation-Starter-Phases.md)

## Goal

Two independent features, shipped together in Phase 4d:

1. **Weekly Tavily trending scan** — every Monday 6 AM UTC, a GitHub Actions cron hits an internal Next.js endpoint that queues a `tavily_trending_scan` ai_job. The `tavilyTrendingScan` Firebase Function pulls 5-10 ranked topics from Tavily and writes them to `content_calendar` as `topic_suggestion` entries, auto-surfaced in the existing admin calendar UI.
2. **SEO enhancement on blog publish** — publishing a blog queues a `seoEnhance` ai_job in parallel with the existing `newsletter_from_blog` queue (4c). The `seoEnhance` Firebase Function fills `blog_posts.seo_metadata` with meta_title, meta_description, keywords, schema.org JSON-LD, and internal link suggestions (tag-overlap scored). A new `SeoSidebar` component in the BlogEditor surfaces the link suggestions. The marketing blog detail page reads `seo_metadata.json_ld` and renders it via the existing `<JsonLd>` component, falling back to the current hardcoded schema.

## Non-goals

- No semantic-embedding search for internal links (Phase 4d uses deterministic tag/category overlap; embeddings are a future optimization).
- No JSON-LD validation / Google Rich Results testing — stored as-produced by Claude.
- No edit UI for SEO metadata (it's regenerated on every publish; manual override is a later phase).
- No page-level meta tag override — `generateMetadata` in the marketing blog page continues to use `meta_description` (existing column). `seo_metadata.meta_description` is stored but not read by that function in 4d. A future cleanup can unify them.
- No rerun button on the trending-scan (cron-only). Manual trigger via ai-jobs API is possible but not UI-surfaced.

## Decisions (captured from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Cron mechanism | GitHub Actions → Next.js internal endpoint (bearer-token auth) → `createAiJob({ type: "tavily_trending_scan" })` |
| 2 | SEO trigger | Blog publish route queues `seoEnhance` ai_job, fire-and-forget (parallel to 4c's `newsletter_from_blog`) |
| 3 | Internal linking algorithm | Tag + category overlap scoring; top 5 suggestions; `reason` string enumerates the overlap |
| 4 | JSON-LD rendering | Marketing blog page reads `seo_metadata.json_ld` first; falls back to existing hardcoded schema when absent |
| 5 | BlogEditor surface | New `SeoSidebar` component (third sidebar alongside ResearchPanel + FactCheckSidebar) |
| 6 | Data storage | Reuse existing `blog_posts.seo_metadata` JSONB column (added in migration 00080); no new migration |

## Architecture

### Weekly trending scan flow

```
[GitHub Actions · Monday 6 AM UTC]
      │ POST /api/admin/internal/tavily-trending
      │ Authorization: Bearer INTERNAL_CRON_TOKEN
      ▼
[Next.js route]
      │ validates bearer token
      │ createAiJob({ type: "tavily_trending_scan", userId: "__cron__", input: {} })
      │ returns { jobId }
      ▼
[tavilyTrendingScan Firebase Function — new]
      │ tavilySearch({ query: "fitness coaching trends 2026", search_depth: "advanced" })
      │ Claude classifies/ranks top 5-10 topics via callAgent
      │ UPSERT content_calendar rows:
      │   { entry_type: "topic_suggestion", title, scheduled_for: next_week_monday,
      │     status: "planned", metadata: { source: "tavily", rank, tavily_url } }
      │ ai_jobs.result = { topics_written: 7 }
```

### SEO enhance on publish flow

```
[POST /api/admin/blog/:id/publish]
      │ status flip
      │ createAiJob({ type: "newsletter_from_blog", ... })   — from 4c, unchanged
      │ createAiJob({ type: "seo_enhance", userId, input: { blog_post_id } })   — new
      │ returns updated post
      ▼
[seoEnhance Firebase Function — new]
      │ 1. Read blog_posts row (title, content, excerpt, tags, category, published_at)
      │ 2. Claude generates: meta_title, meta_description, keywords (5-10), json_ld (schema.org Article)
      │ 3. Query recent published blog_posts (last 50, excluding self)
      │ 4. Score each by tag/category overlap; keep top 5 with overlap_score > 0
      │ 5. UPDATE blog_posts SET seo_metadata = { meta_title, meta_description, keywords,
      │    json_ld, internal_link_suggestions, generated_at } WHERE id = blog_post_id
      │ ai_jobs.result = { blog_post_id, suggestions_count }
```

### Internal linking scoring

For a published post with tags `T` and category `C`, scan the 50 most recent OTHER published posts. For each candidate:
- `overlap_score = (len(T ∩ candidate.tags) * 2) + (1 if C == candidate.category else 0)`
- Filter `overlap_score >= 1`
- Sort desc; take top 5
- `reason` = "Shares tags: X, Y" + " · same category" if applicable

Pure function, unit-testable.

## Data model

**`blog_posts.seo_metadata`** (existing JSONB column, default `'{}'`) after Phase 4d:

```ts
{
  meta_title?: string
  meta_description?: string
  keywords?: string[]
  json_ld?: {
    "@context": "https://schema.org"
    "@type": "Article"
    headline: string
    description: string
    author: { "@type": "Person"; name: string }
    datePublished: string
    // ... more schema.org fields as Claude generates them
  }
  internal_link_suggestions?: Array<{
    blog_post_id: string
    title: string
    slug: string
    overlap_score: number
    reason: string
  }>
  generated_at?: string
}
```

All fields optional — a post with empty `seo_metadata = {}` keeps rendering with the existing hardcoded JSON-LD fallback in the marketing blog page.

**`content_calendar`** (existing, no schema change) — `topic_suggestion` entries written by the trending scan:

```ts
{
  entry_type: "topic_suggestion"
  title: "The role of creatine in youth athletic performance"
  scheduled_for: "2026-04-27"  // next Monday
  status: "planned"
  metadata: {
    source: "tavily"
    rank: 1
    tavily_url: "https://..."
    summary: "..."
  }
}
```

## File changes

### GitHub Actions workflow (new)

- `.github/workflows/tavily-trending-cron.yml` — schedule: `"0 6 * * 1"` (Monday 6 AM UTC), matches `publish-due-cron.yml` pattern (curl with bearer token).

### Next.js internal endpoint (new)

- `app/api/admin/internal/tavily-trending/route.ts` — POST, bearer-token auth, creates ai_job.

### Firebase Functions (new)

- `functions/src/tavily-trending-scan.ts` — `handleTavilyTrendingScan(jobId)` + pure helpers `buildRankingPrompt(tavilyResults)`, `classifyTopics(claudeOutput)`.
- `functions/src/seo-enhance.ts` — `handleSeoEnhance(jobId)` + pure helpers `scoreInternalLinks(targetPost, candidates)`, `buildSeoPrompt(post)`.

### Firebase Functions registration (modify)

- `functions/src/index.ts` — register `tavilyTrendingScan` (type `tavily_trending_scan`) and `seoEnhance` (type `seo_enhance`) exports.

### AiJobType union (modify)

- `lib/ai-jobs.ts` — `tavily_trending_scan` already in union; add `seo_enhance`.

### Blog publish route (modify)

- `app/api/admin/blog/[id]/publish/route.ts` — after the existing `createAiJob({ type: "newsletter_from_blog" })` queue, add a second fire-and-forget `createAiJob({ type: "seo_enhance", ... })`.

### UI components (new + modify)

- `components/admin/blog/SeoSidebar.tsx` (new) — right-column panel listing internal link suggestions. Click a suggestion → opens its edit page in a new tab. Read-only (no "insert link" action — polish for later).
- `components/admin/blog/BlogEditor.tsx` (modify) — accept optional `seoMetadata` prop; render a new toolbar button that toggles `SeoSidebar` open/closed (styled consistently with the existing Research / fact-check toggles).
- `components/admin/blog/BlogPostForm.tsx` (modify) — pass `post?.seo_metadata as SeoMetadata | null` into BlogEditor.

### Marketing blog detail page (modify)

- `app/(marketing)/blog/[slug]/page.tsx` — read `post.seo_metadata.json_ld` if present and non-empty; pass it into the existing `<JsonLd>` component. Fall back to the existing hardcoded schema when absent.

### Types (modify)

- `types/database.ts` — define `SeoMetadata` interface with all optional fields matching the shape above. `BlogPost.seo_metadata` is already `Record<string, unknown>`; no change there but the new interface is used for casting in components.

### Tests (new)

- `functions/src/__tests__/tavily-trending-scan.test.ts` — 3 helper tests
- `functions/src/__tests__/seo-enhance.test.ts` — 4 helper tests (scoring + prompt shape)
- `__tests__/api/admin/internal/tavily-trending.test.ts` — 3 route tests (401 / 401-unauth-token / 202)
- `__tests__/api/admin/blog/publish-seo.test.ts` — 2 tests (publish queues both ai_jobs)
- `__tests__/components/seo-sidebar.test.tsx` — 3 state tests

## API

### `POST /api/admin/internal/tavily-trending`

**Auth:** `Authorization: Bearer ${INTERNAL_CRON_TOKEN}` (same env var as publish-due cron).

**Request body:** none (empty).

**Behavior:**
1. Validate bearer token against `INTERNAL_CRON_TOKEN`; 401 if mismatched or missing.
2. `createAiJob({ type: "tavily_trending_scan", userId: "__cron__", input: {} })`.
3. Return `{ jobId, status }` (202).

**Errors:**
- `401` — missing/invalid bearer
- `500` — ai-job creation failure

Note: the `userId: "__cron__"` sentinel is intentional. The Function doesn't use this field for any permission check; it's a marker for audit/debugging.

## Function behavior specs

### `tavilyTrendingScan`

1. Tavily search: `tavilySearch({ query: "fitness coaching trends this week", search_depth: "advanced", max_results: 15 })`.
2. If zero results → mark job completed with empty `topics_written: 0`; no DB write.
3. Claude call via `callAgent` — prompt: "Given these Tavily search results about fitness/coaching trends, extract the top 5-10 concrete blog topic ideas relevant to a strength & conditioning audience. For each, produce `{ title, summary, tavily_url, rank }`."
4. Zod-validated output → `insert content_calendar` rows. `scheduled_for` = next Monday (simple: `new Date(); set UTC day-of-week to Monday; add 7 if today >= Monday`).
5. `ai_jobs.result = { topics_written: N }`.

### `seoEnhance`

1. Read `blog_posts` row.
2. Claude call — prompt includes title + excerpt + first 4000 chars of content + tags + category + published_at. Asks Claude to output `{ meta_title, meta_description, keywords, json_ld }` where `json_ld` is a schema.org Article object.
3. Fetch 50 recent other published posts (`status = 'published' AND id != blog_post_id ORDER BY published_at DESC LIMIT 50`). Minimal fields: `id, slug, title, tags, category`.
4. Pure helper `scoreInternalLinks(targetPost, candidates)` returns sorted top-5 with `overlap_score >= 1`.
5. `UPDATE blog_posts SET seo_metadata = { ...claudeFields, internal_link_suggestions, generated_at: new Date().toISOString() } WHERE id = blog_post_id`.
6. `ai_jobs.result = { blog_post_id, suggestions_count }`.

## UI states (SeoSidebar)

- **Empty** (no `seo_metadata` or empty `internal_link_suggestions`) — "No link suggestions yet — publish the post to generate."
- **Populated** — list of suggestions, each row: title + overlap_score badge + `reason` + "Open" external-link icon → `/admin/blog/:id/edit`.
- No loading/error states in the sidebar (unlike ResearchPanel) — seoEnhance runs in the background post-publish, not triggered from the sidebar. The sidebar just reflects what's stored.

Button in BlogEditor toolbar: disabled when `post?.id` falsy OR `seo_metadata?.internal_link_suggestions?.length` is 0 (tooltip: "Publish the post to generate link suggestions"). When enabled, clicking toggles the sidebar.

## Error handling

| Failure | Behavior |
|---|---|
| GitHub Actions cron fails or times out | GHA logs; no retry within the same hour; next week's run still queues. |
| Internal endpoint bearer mismatch | 401 |
| `createAiJob` fails in internal endpoint | 500 with error body; GHA shows failure |
| Tavily returns empty | Job completes with `topics_written: 0` |
| Claude fails in either Function | `ai_jobs.status = failed` + error message; no row writes |
| Supabase update fails in `seoEnhance` | Log; mark job failed; `seo_metadata` stays `{}` — marketing blog page falls back to hardcoded JSON-LD |
| Blog publish + seoEnhance queue failure | Publish still returns 200 (fire-and-forget) |

## Testing

**Unit — Functions:**
- `tavily-trending-scan`: `buildRankingPrompt` embeds Tavily results; `classifyTopics` handles empty input gracefully; next-Monday date math for `scheduled_for`.
- `seo-enhance`: `scoreInternalLinks` — (a) 0 overlap returns empty array, (b) tag-only overlap scores correctly, (c) tag+category bonus adds 1, (d) top-5 cap enforced.

**Unit — Route:** `tavily-trending.test.ts` — 401 no bearer, 401 wrong bearer, 202 happy path.

**Unit — Blog publish integration:** `publish-seo.test.ts` — asserts BOTH `createAiJob` calls fire (newsletter_from_blog + seo_enhance); publish still 200 if seo_enhance throws.

**Component:** `seo-sidebar.test.tsx` — empty / populated / button-disabled states.

**Manual smoke:**
1. Trigger cron manually via GHA `workflow_dispatch` on `tavily-trending-cron`. Check `content_calendar` for new `topic_suggestion` rows within ~90s.
2. Publish an existing draft blog post. Watch `ai_jobs` — both `newsletter_from_blog` AND `seo_enhance` appear.
3. Wait for `seo_enhance` to complete. Reload the blog post's edit page. SEO toolbar button should light up; click reveals sidebar with 0-5 link suggestions.
4. Visit the marketing blog detail page (`/blog/[slug]`). View source — `<script type="application/ld+json">` should reflect the Claude-generated schema, not the hardcoded fallback.

## Phase 4d closes when

1. GitHub Actions cron fires weekly; `content_calendar` receives `topic_suggestion` entries.
2. Publishing a blog post auto-populates `seo_metadata` within ~60s.
3. Marketing blog detail page renders Claude-generated JSON-LD when available.
4. SeoSidebar renders internal link suggestions in BlogEditor.
5. All unit + component + route tests pass.

## What 4d unblocks / concludes

- **Closes Phase 4.** All four content-extension systems (4a research, 4b video-to-blog, 4c newsletter, 4d trending+SEO) are live.
- Phase 5 can consume `seo_metadata.keywords` + `content_calendar` trending history for analytics and the weekly report.
- Post-Phase-5: the hardcoded `meta_description` column can be migrated to read from `seo_metadata.meta_description`, and a manual SEO regeneration button can be added to BlogEditor.
