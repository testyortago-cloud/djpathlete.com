# Phase 4b — Video → Blog Pipeline

**Status:** Approved design — ready for implementation plan
**Date:** 2026-04-20
**Author:** brainstormed with tayawaaean
**Parent plan:** [DJP-AI-Automation-Starter-Phases.md § Phase 4](../../DJP-AI-Automation-Starter-Phases.md)

## Goal

Extend the blog editor so a single click turns a transcribed video into a research-grounded, fact-checked blog draft. Add a "From video" mode to [BlogGenerateDialog.tsx](../../../components/admin/blog/BlogGenerateDialog.tsx) that picks a transcribed video and kicks off a new Firebase Function (`generateBlogFromVideo`) which orchestrates: read transcript → Tavily research → Claude generation → Tavily fact-check → persist to `blog_posts`. Flagged claims surface as a top-of-editor banner in [BlogEditor.tsx](../../../components/admin/blog/BlogEditor.tsx) with a clickable sidebar list.

## Non-goals

- No inline TipTap highlights on flagged spans (deferred polish — inline highlighting is a bigger investment).
- No "Cite this" insertion from research/fact-check into the editor content.
- No auto-publish — the blog draft lands in `blog_posts` with `status="draft"` for human review.
- No newsletter auto-draft (Phase 4c).
- No SEO metadata rendering beyond what 4a already stores in `seo_metadata` (Phase 4d).

## Decisions (captured from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | How `generateBlogFromVideo` calls Tavily + Claude | **Direct in-process** — one ai_jobs doc owns the whole pipeline; no sub-job orchestration |
| 2 | Fact-check UI surface | **Banner + sidebar list** in `BlogEditor` — no inline TipTap highlights |
| 3 | BlogGenerateDialog shape | **Tabbed mode** — existing "From prompt" stays, new "From video" tab added alongside |
| 4 | Flagged-claims storage | **New JSONB column** `blog_posts.fact_check_details` (migration 00084) |
| 5 | Shared brief shape between Functions | **Extract** `buildResearchBrief` into `functions/src/lib/research-brief.ts` |
| 6 | Fact-check input | **Generated content + research brief** — Claude verifies each claim against the brief's extracted content + cited URLs |
| 7 | Re-run behavior | Overwrites the existing draft (same row, updated content + research + fact_check_status) |

## Architecture

### End-to-end flow

```
[BlogGenerateDialog · "From video" tab · pick transcribed video]
      │ POST /api/admin/blog-posts/generate-from-video
      │ body: { video_upload_id, tone, length }
      ▼
[Next.js route]
      │ validates admin + video transcribed
      │ creates blog_posts row (status="draft", title="Generating…", source_video_id)
      │ createAiJob({ type: "blog_from_video", userId, input: { video_upload_id, blog_post_id, tone, length } })
      │ returns { jobId, blog_post_id }
      ▼
[generateBlogFromVideo Firebase Function]
      │ 1. Read transcript from video_transcripts (Supabase)
      │ 2. Tavily research on the topic (derived from transcript's first 1500 chars + video title)
      │    → persist brief to blog_posts.tavily_research
      │ 3. Claude generate via callAgent() with transcript + research brief as inputs
      │    → writes { title, slug, content, excerpt, category, tags, meta_description } to blog_posts
      │ 4. Tavily fact-check: invoke tavilyFactCheck(content, brief) → returns flagged claims
      │    → persist to blog_posts.fact_check_details + flip fact_check_status
      │ 5. ai_jobs.result = { blog_post_id, fact_check_status, flagged_count }
      ▼
[Frontend polls via useAiJob(jobId)]
      │ on completed: redirect to /admin/blog/[id]/edit (full BlogEditor with banner+sidebar)
```

### Why in-process, not sub-jobs

- Atomic: one Function invocation owns the whole pipeline. No Firestore polling loops inside the Function.
- Fits the plan's latency budget (30-90s) — well within the Function's 540s timeout.
- Simpler error recovery: any step failure → single `ai_jobs.status = failed` with contextual error.
- The `tavilyResearch` ai_jobs flow from 4a is preserved for the manual Research button use case — 4b does NOT reuse it.

### `tavilyFactCheck` Function — what it does

- Input: `{ content_html, research_brief, claims_max }` (claims_max defaults to 10)
- Calls Claude with: "Here is a blog post content and the research brief used to generate it. Identify claims that cannot be verified against the sources. Return a JSON array of `{ claim, span_start, span_end, source_urls_checked, verdict: 'unverifiable' | 'contradicted' | 'verified', notes }` objects. Skip claims that are verified — only return flagged ones. Max 10."
- Output: `{ flagged_claims: [...], fact_check_status: "passed" | "flagged" | "failed" }`
  - `passed` = empty array
  - `flagged` = 1-5 flagged
  - `failed` = 6+ flagged OR Claude returns malformed output
- Pure helper `buildFactCheckPrompt(content, brief)` extracted for unit testing.

## Data model

### Migration `00084_blog_posts_fact_check_details.sql`

```sql
ALTER TABLE blog_posts
  ADD COLUMN fact_check_details jsonb;

CREATE INDEX idx_blog_posts_flagged_posts
  ON blog_posts(fact_check_status)
  WHERE fact_check_status IN ('flagged', 'failed');
```

Shape of `blog_posts.fact_check_details`:

```ts
{
  flagged_claims: Array<{
    claim: string                              // the text of the flagged claim
    span_start: number | null                  // char offset in content (null if not located)
    span_end: number | null
    source_urls_checked: string[]              // URLs from the research brief Claude consulted
    verdict: "unverifiable" | "contradicted"   // (verified claims not persisted)
    notes: string                              // short justification from Claude
  }>
  generated_at: string                         // ISO timestamp
  model: string                                // which Claude model was used
}
```

## File changes

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/00084_blog_posts_fact_check_details.sql` | New JSONB column + index |
| `functions/src/lib/research-brief.ts` | Extracted `buildResearchBrief` + `TavilyResearchBrief` type (shared between Functions) |
| `functions/src/tavily-fact-check.ts` | `handleTavilyFactCheck(jobId)` + pure helpers `buildFactCheckPrompt`, `classifyStatus` |
| `functions/src/blog-from-video.ts` | `handleBlogFromVideo(jobId)` orchestrator + pure helper `deriveResearchTopic(videoTitle, transcript)` |
| `app/api/admin/blog-posts/generate-from-video/route.ts` | POST route — creates draft blog_posts row + ai_jobs doc |
| `components/admin/blog/FactCheckBanner.tsx` | Top-of-editor banner that shows flagged-count + toggles sidebar |
| `components/admin/blog/FactCheckSidebar.tsx` | Right-column list of flagged claims with source URLs |

### Modified files

| Path | Change |
|---|---|
| `functions/src/tavily-research.ts` | Re-export `buildResearchBrief` from new `./lib/research-brief.ts` (no behavior change — just move the helper) |
| `functions/src/index.ts` | Register two new Functions: `tavilyFactCheck` (type: `tavily_fact_check`) and `blogFromVideo` (type: `blog_from_video`). Both need `[anthropicApiKey, tavilyApiKey, supabaseUrl, supabaseServiceRoleKey]`. Register the `blog_from_video` type in `lib/ai-jobs.ts` `AiJobType` union is already done (it's in the existing union). |
| `components/admin/blog/BlogGenerateDialog.tsx` | Add top-of-dialog tabs: "From prompt" (current behavior) / "From video" (new — picks a transcribed video). In "From video" mode, tone/length stay; URL references are hidden (research is automatic). Submit calls the new route. |
| `components/admin/blog/BlogEditor.tsx` | On mount, read `fact_check_status` + `fact_check_details` from props. Render `<FactCheckBanner>` above the editor when `fact_check_status in ('flagged', 'failed')`. Clicking the banner opens `<FactCheckSidebar>` as a right column (like 4a's ResearchPanel). |
| `components/admin/blog/BlogPostForm.tsx` | Pass `fact_check_status` + `fact_check_details` into `BlogEditor` props. |
| `types/database.ts` | Add `fact_check_details` field on `BlogPost` type (`FactCheckDetails | null`). Add a `FactCheckDetails` type alias. |

### Out of scope

- No changes to existing blog publish pipeline.
- No changes to the newsletter system (4c).
- No changes to analytics/usage dashboards (5).

## API

### `POST /api/admin/blog-posts/generate-from-video`

**Auth:** existing admin middleware.

**Request:**
```ts
{
  video_upload_id: string
  tone: "professional" | "conversational" | "motivational"   // default: "professional"
  length: "short" | "medium" | "long"                        // default: "medium"
}
```

**Behavior:**
1. Verify admin.
2. Look up `video_uploads.id = video_upload_id`; 404 if not found.
3. Look up `video_transcripts.video_upload_id = video_upload_id`; 409 if no transcript.
4. Insert new `blog_posts` row: `{ status: "draft", title: "Generating from video…", slug: "generating-<timestamp>", content: "", excerpt: "", category: "Performance", tags: [], author_id: session.user.id, source_video_id: video_upload_id }`.
5. `createAiJob({ type: "blog_from_video", userId, input: { video_upload_id, blog_post_id, tone, length } })`.
6. Return `{ jobId, blog_post_id }` (202).

**Errors:** 401 / 404 / 409 / 500.

## UI states

### BlogGenerateDialog — "From video" tab

- Dropdown of `video_uploads` where `status = 'transcribed'`, sorted by created_at desc, showing `{ title, duration, uploaded_at }`.
- Tone + length selectors (existing).
- No URL / attachment inputs — research is automatic.
- Submit button label: "Generate from video" → POSTs to the new route → on success, navigates to `/admin/blog/[blog_post_id]/edit`. Dialog stays open briefly showing "Starting generation…" while the job fires; the real work happens in the Function and the edit page then polls via `useAiJob`.

### FactCheckBanner

Rendered when `fact_check_status in ('flagged', 'failed')`. States:
- `flagged` (1-5 claims) → amber background, "X claims flagged — review before publishing"
- `failed` (6+ or malformed) → red background, "Fact-check failed — manual review recommended"
- Click to expand/collapse sidebar.

### FactCheckSidebar

For each flagged claim:
- Claim text (italic blockquote)
- Verdict chip (`unverifiable` / `contradicted`)
- Notes from Claude
- Source URLs the claim was checked against (external-link icons)
- "Dismiss" action (client-side only — strikes through, does not mutate server state; reopening the page restores all claims)

Read-only — no editor mutation, no insert-to-content actions.

## Error handling

| Failure | Behavior |
|---|---|
| Video has no transcript | Route returns 409; UI shows "This video isn't transcribed yet — run Transcribe first" |
| Tavily fails during research step | Log; skip research, generate without it. `fact_check_status = 'pending'`. Banner shows "Research unavailable — no fact-check ran" |
| Claude generation fails | Function marks job failed; pre-created draft row gets `content` set to empty + `title = "Generation failed"`; UI redirects to the draft and shows a retry button (route the retry as a new ai_job) |
| Fact-check Claude returns malformed JSON | Log; set `fact_check_status = 'failed'` with empty `flagged_claims` array — human review required |
| Supabase update failure at any step | Fail the ai_job; log error; pre-created draft is left in its last-known state |

## Testing

**Unit:**
- `functions/src/__tests__/tavily-fact-check.test.ts` — `buildFactCheckPrompt` shape; `classifyStatus` (empty → passed, 1-5 → flagged, 6+ → failed)
- `functions/src/__tests__/blog-from-video.test.ts` — `deriveResearchTopic(videoTitle, transcript)` builds a Tavily query from the first 1500 chars + title
- `functions/src/__tests__/research-brief.test.ts` — relocated from `tavily-research.test.ts` (tests still pass; no behavior change)
- `__tests__/api/admin/blog-posts/generate-from-video.test.ts` — 401/400/404/409/202 + verifies draft row creation and ai_job payload

**Component:**
- `__tests__/components/fact-check-banner.test.tsx` — renders banner for flagged/failed, hidden for passed/pending, click toggles expansion prop
- `__tests__/components/fact-check-sidebar.test.tsx` — renders list of flagged claims with verdict chips; Dismiss strikes through locally
- `__tests__/components/blog-generate-dialog-from-video.test.tsx` — tab renders, video picker lists only transcribed videos, submit POSTs to the new route

**Manual smoke:**
1. Upload + transcribe a real video (existing flow).
2. Open BlogGenerateDialog → "From video" tab → pick the transcribed video → submit.
3. Verify redirect to /admin/blog/[id]/edit. Watch for status transitions: Generating → Researching → Generating → Fact-checking → Done.
4. Verify draft content, research brief (open Research panel from 4a), and fact-check banner (if flagged).
5. Verify re-generation from a different transcript overwrites the same row's content but creates a new draft when picked from dialog.

## Phase 4b closes when

1. From the blog dashboard, an admin can pick a transcribed video and generate a fact-checked draft in one flow.
2. Drafts have populated content + research brief (via `tavily_research`) + fact-check status + flagged claims (if any).
3. Banner + sidebar render correctly for all four fact-check statuses.
4. All new unit/component tests pass.
5. Manual smoke with a real Tavily + Claude call completes end-to-end.

## What 4b unblocks

- **Phase 4c** reads `blog_posts` on publish and auto-drafts a newsletter. The `fact_check_details` column is a natural input if the newsletter should surface "verified" claims only.
- **Phase 4d** consumes `source_video_id` + `tavily_research` for SEO enrichment (schema.org `videoObject` pointer, internal linking suggestions based on research topics).
