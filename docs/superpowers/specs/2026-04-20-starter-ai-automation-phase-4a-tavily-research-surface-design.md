# Phase 4a — Tavily Research Surface

**Status:** Approved design — ready for implementation plan
**Date:** 2026-04-20
**Author:** brainstormed with tayawaaean
**Parent plan:** [DJP-AI-Automation-Starter-Phases.md § Phase 4](../../DJP-AI-Automation-Starter-Phases.md)

## Goal

Surface Tavily research inside the existing blog editor. When an admin clicks **Research** in [BlogPostForm.tsx](../../../components/admin/blog/BlogPostForm.tsx), a right-sidebar panel opens with an AI-generated brief (summary + ranked sources + expandable extracted content) for the post's title. The brief persists to `blog_posts.tavily_research` so Phase 4b's video-to-blog generator can consume it downstream.

This is the manual escape hatch. The primary automation path — running Tavily before every video-generated blog post — lands in Phase 4b.

## Non-goals

- No "Cite this" per-source insertion into the editor content (polish for a later sub-phase).
- No "Copy brief as markdown" button.
- No AI-synthesized Key Facts bullets (would require a second Claude pass).
- No fact-check integration (Phase 4b).
- No delete/clear brief affordance (empty = never researched; re-run overwrites).
- No rate limiting beyond existing admin auth + Tavily's own quotas.

## Decisions (captured from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Research query source | **Post title** — one-click, zero input |
| 2 | Panel contents | **Summary + sources + expandable extract per source** |
| 3 | Panel placement | **Right sidebar, docked** — visible while writing |
| 4 | User interactions inside panel | **Read-only reference** — no editor mutation |
| 5 | Persistence | Function writes brief to `blog_posts.tavily_research` server-side, not via a second frontend round-trip |
| 6 | Re-run behavior | Overwrites the existing brief; no versioning |

## Architecture

### End-to-end flow

```
[BlogPostForm · Research button]
      │ POST /api/admin/blog-posts/:id/research   { topic }
      ▼
[Next.js route]
      │ creates Firestore ai_jobs doc
      │   { type: "tavily_research",
      │     input: { topic, blog_post_id },
      │     status: "pending" }
      │ invokes tavilyResearch Firebase Function (HTTPS callable)
      │ returns { jobId }
      ▼
[tavilyResearch Firebase Function]
      │ tavilySearch(topic) + tavilyExtract(top 3 URLs)
      │ writes ai_jobs.result = brief
      │ if input.blog_post_id:
      │    UPDATE blog_posts SET tavily_research = brief WHERE id = blog_post_id
      │ sets ai_jobs.status = "completed"
      ▼
[ResearchPanel (right sidebar) · useAiJob(jobId)]
      │ polls ai_jobs doc until completed/failed
      │ renders summary + source list
      │ persistence already happened server-side — no extra request
```

### Why this shape

- **Reuses existing infrastructure end-to-end.** The `tavilyResearch` Function already exists ([functions/src/tavily-research.ts](../../../functions/src/tavily-research.ts)) and already writes to Firestore `ai_jobs`. The ai-jobs async pattern, `useAiJob` hook, and `blog_posts.tavily_research` column (migration [00080](../../../supabase/migrations/00080_blog_posts_ai_extensions.sql)) are all in place.
- **Server-side persistence** avoids a second round-trip and keeps the frontend simple — panel polls and renders, nothing else. It also means the brief is never "lost" if the user closes the tab mid-poll.
- **Admin auth is the existing middleware** — no new auth code.

## Data model

`blog_posts.tavily_research` is already a nullable JSONB column. Stored shape mirrors the Function's existing result:

```ts
{
  topic: string                                    // the query that was used (= post title at call time)
  summary: string | null                           // Tavily AI answer
  results: Array<{                                 // all search hits
    title: string
    url: string
    snippet: string
    score: number
    published_date: string | null
  }>
  extracted: Array<{                               // top-3 full extractions
    url: string
    content: string
  }>
  generated_at: string                             // ISO timestamp, added in 4a
}
```

`generated_at` is new for 4a — the panel uses it for a "Refreshed <n> ago" label.

## File changes

### New files

| Path | Purpose |
|---|---|
| `app/api/admin/blog-posts/[id]/research/route.ts` | POST handler — creates ai_jobs doc, invokes Function, returns `{ jobId }` |
| `components/admin/blog/ResearchPanel.tsx` | Right sidebar panel, 4 states: `empty` / `loading` / `populated` / `error` |

### Modified files

| Path | Change |
|---|---|
| `functions/src/tavily-research.ts` | Accept optional `blog_post_id` in input. After writing `ai_jobs.result`, upsert the same brief into `blog_posts.tavily_research` (and `generated_at`) via service-role Supabase client. Add `generated_at: new Date().toISOString()` to the result payload. |
| `components/admin/blog/BlogPostForm.tsx` | Add "Research" toolbar button (disabled when `title` is empty). Render `<ResearchPanel>` as a collapsible right column. Layout: `[editor flex-1][panel w-80]` when open; single-column when closed. |
| `lib/db/blog-posts.ts` | Add `updateTavilyResearch(id, brief)` DAL helper. Called from the Function's Supabase client (which mirrors this same pattern). |

### Out of scope (deferred)

- `functions/src/lib/supabase.ts` already exists for other Functions — reuse, don't create.
- Zod schemas for the brief already live in the Function's result shape — no new schema file.

## API

### `POST /api/admin/blog-posts/[id]/research`

**Auth:** existing admin middleware (role check).

**Request:**
```ts
{ topic: string }   // usually post.title, sent explicitly so the route doesn't re-read the post
```

**Response (200):**
```ts
{ jobId: string }
```

**Errors:**
- `400` — empty/missing topic
- `404` — blog post id not found
- `500` — Firebase invoke failure (caught, logged)

## UI states

The sidebar panel has four states:

| State | Trigger | Rendering |
|---|---|---|
| `empty` | Post has no `tavily_research` and no active job | CTA: "Research this topic" with a button — click runs the research |
| `loading` | Active job (`status in 'pending' 'processing'`) | Skeleton + "Researching…" with spinner; polls via `useAiJob` |
| `populated` | Brief exists | Header: topic + "Refreshed Xm ago" · "Re-run". Summary paragraph. Sources list (title, domain, date, score). Click a source → expands to show `extracted.content` if available |
| `error` | Job failed, or Tavily returned no results | Error card + "Try again" button. Zero-results copy: "No sources found for '<title>' — try a different title or refine" |

Panel opens automatically on first Research click; can be toggled via the toolbar button afterward. Toolbar button shows a small dot indicator when `tavily_research` is populated.

## Error handling

| Failure | Behavior |
|---|---|
| Post has no title when user clicks Research | Button disabled; tooltip: "Add a title first" |
| Tavily API fails (rate limit, network) | Function marks `ai_jobs.status = failed` with error message; panel shows error card with Retry |
| Tavily returns zero results | Job completes with empty `results` array; panel renders zero-results copy |
| Supabase upsert fails inside the Function | Log error; still mark `ai_jobs.status = completed` (the brief is still useful on-screen); panel renders a small warning banner: "Brief generated but not saved — click Retry to persist" |
| User clicks Research twice in quick succession | Second click is a no-op while `status in 'pending' 'processing'`; button shows spinner |
| Unauthorized user hits the route | Existing admin middleware returns 401 |

## Testing

- **Unit — Function** (extend [functions/__tests__/tavily-research.test.ts](../../../functions/__tests__/tavily-research.test.ts)): new case where input includes `blog_post_id`, asserts Supabase client upsert is called with correct `{ tavily_research }` payload. Mock `tavilySearch` / `tavilyExtract` and the Supabase service-role client.
- **Unit — Next.js route** (`__tests__/api/admin/blog-posts/research.test.ts`): asserts ai_jobs doc creation, Firebase invoke args `{ topic, blog_post_id }`, response shape `{ jobId }`. Mocks Firebase Admin + Firestore.
- **Component — ResearchPanel** (`__tests__/components/research-panel.test.tsx`): renders each of 4 states; clicking a source expands extracted content; Retry button re-triggers the POST.
- **Manual smoke** (no automated E2E for 4a): dev server → create a blog post with a title → click Research → sidebar populates → refresh page → verify brief persists and panel re-renders populated.

## Dependencies

- **Firebase Function already deployed** — if `tavilyResearch` is not live in Firebase yet, the deploy must happen in parallel with the route rollout.
- **`TAVILY_API_KEY`** — already set as a Firebase secret per Phase 1 env checklist.
- **Migration 00080** — already applied (adds `blog_posts.tavily_research` column).

## Phase 4a closes when

1. A post with a title can be researched in one click; brief appears in the right sidebar within ~10 seconds.
2. Brief persists across page refresh.
3. All four panel states render correctly.
4. Unit tests (Function + route + component) pass.
5. Manual smoke confirms end-to-end flow with a real Tavily call.

## What 4a unblocks

- **Phase 4b** can compose `generateBlogFromVideo` as: `transcript → (auto) tavilyResearch → generate → tavilyFactCheck`. The research step is already working end-to-end; 4b just chains it.
- **Phase 4c/4d** consume `tavily_research` as read-only input — no changes needed to its shape.
