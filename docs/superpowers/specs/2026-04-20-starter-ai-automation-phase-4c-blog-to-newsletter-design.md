# Phase 4c — Blog → Newsletter Auto-Draft

**Status:** Approved design — ready for implementation plan
**Date:** 2026-04-20
**Author:** brainstormed with tayawaaean
**Parent plan:** [DJP-AI-Automation-Starter-Phases.md § Phase 4](../../DJP-AI-Automation-Starter-Phases.md)

## Goal

When a blog post is published, automatically generate an AI-curated newsletter draft (rich HTML, not just a link-blast) and queue it in the `newsletters` table for admin review. Darren reviews the draft in the existing newsletter admin UI and sends it when ready. Also add a "From blog post" tab to [NewsletterGenerateDialog.tsx](../../../components/admin/newsletter/NewsletterGenerateDialog.tsx) so drafts can be manually generated from any past post.

This replaces the current immediate blast from [app/api/admin/blog/[id]/publish/route.ts](../../../app/api/admin/blog/%5Bid%5D/publish/route.ts) which calls `sendBlogNewsletterToAll`. Publishing no longer auto-emails subscribers — it creates an AI draft that a human approves and sends.

## Non-goals

- No streaming generation UI — same `useAiJob` polling pattern everywhere else uses.
- No preview-then-approve step inside the draft Function — Darren reviews in the existing newsletter admin UI.
- No segmentation / audience targeting (goes to the default newsletter audience like the blast did).
- No auto-send (all drafts require human gate).

## Decisions (captured from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Existing `sendBlogNewsletterToAll` blast on publish | **Replace** — remove the call, create AI draft instead |
| 2 | Trigger | Next.js route flips `status="published"` then calls `createAiJob({ type: "newsletter_from_blog", ... })` |
| 3 | NewsletterGenerateDialog shape | Tabbed: existing "From prompt" + new "From blog post" |
| 4 | Draft destination | `newsletters` table with `status="draft"` and new `source_blog_post_id` FK |
| 5 | Claude model + schema | `MODEL_SONNET` via `callAgent`; schema matches existing `newsletterResultSchema` (`subject`, `preview_text`, `content`) |

## Architecture

### End-to-end flow (auto-draft on publish)

```
[POST /api/admin/blog/:id/publish]
      │ updateBlogPost(id, status="published")
      │ createAiJob({ type: "newsletter_from_blog", userId, input: { blog_post_id } })
      │ returns the published post (unchanged response shape)
      ▼
[newsletterFromBlog Firebase Function — new]
      │ 1. Read blog_posts row (title, excerpt, content, tags, category)
      │ 2. callAgent(NEWSLETTER_FROM_BLOG_PROMPT, buildUserMessage(post, tone, length), newsletterResultSchema)
      │ 3. Insert into newsletters: { subject, preview_text, content, source_blog_post_id, status="draft", created_by }
      │ 4. ai_jobs.result = { newsletter_id }
      ▼
[Newsletter admin UI — existing]
      │ Draft appears in the newsletters list
      │ Darren reviews, edits if needed, clicks Send (existing flow)
```

### Manual-trigger flow (dialog)

```
[NewsletterGenerateDialog · "From blog post" tab · pick blog + tone + length]
      │ POST /api/admin/newsletter/generate-from-blog { blog_post_id, tone, length }
      ▼
[Next.js route]
      │ validates admin + blog exists (with any status, not just published)
      │ createAiJob({ type: "newsletter_from_blog", userId, input: { blog_post_id, tone, length } })
      │ returns { jobId, status }
      ▼
[newsletterFromBlog Function]
      │ same as above; tone/length forwarded to Claude
```

## Data model

### Migration `00085_newsletters_source_blog_post_id.sql`

```sql
ALTER TABLE newsletters
  ADD COLUMN source_blog_post_id uuid REFERENCES blog_posts(id) ON DELETE SET NULL;

CREATE INDEX idx_newsletters_source_blog_post
  ON newsletters(source_blog_post_id)
  WHERE source_blog_post_id IS NOT NULL;
```

Existing `newsletters.status` enum (`'draft' | 'sent'`) is unchanged.

### `Newsletter` TypeScript type

Add `source_blog_post_id: string | null` to `Newsletter` in `types/database.ts`.

## File changes

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/00085_newsletters_source_blog_post_id.sql` | FK column + index |
| `functions/src/newsletter-from-blog.ts` | `handleNewsletterFromBlog(jobId)` orchestrator + pure helper `buildUserMessage({ post, tone, length })` |
| `app/api/admin/newsletter/generate-from-blog/route.ts` | Manual-trigger POST route |

### Modified files

| Path | Change |
|---|---|
| `functions/src/index.ts` | Register `newsletterFromBlog` export with type `newsletter_from_blog`, secrets `[anthropicApiKey, supabaseUrl, supabaseServiceRoleKey]`, 540s timeout |
| `app/api/admin/blog/[id]/publish/route.ts` | Replace `sendBlogNewsletterToAll(...)` with `createAiJob({ type: "newsletter_from_blog", userId, input: { blog_post_id: id } })`. Remove the `lib/email` import. Keep everything else (publish status flip, published_at timestamp, response shape). |
| `components/admin/newsletter/NewsletterGenerateDialog.tsx` | Add "From prompt" / "From blog post" tabs. Tab strip at top; existing prompt form gated behind `mode==="prompt"`; new blog picker under `mode==="blog"` (lists recent published blog posts, sorted by `published_at` desc). Tone + length are shared between modes (lifted). Submit for blog mode POSTs to new route. |
| `lib/db/newsletters.ts` | Add `createDraftFromBlog({ subject, previewText, content, sourceBlogPostId, createdBy })` helper the Function uses. |
| `types/database.ts` | Add `source_blog_post_id: string \| null` to `Newsletter` type. |
| `lib/ai-jobs.ts` | `newsletter_from_blog` is already in the `AiJobType` union — no change. |

### Out of scope

- No changes to existing newsletter send infrastructure (`newsletterSend` Function, `lib/email.ts` send paths, Resend integration).
- No changes to `NewsletterList.tsx` / `NewsletterForm.tsx` — drafts land in the existing list.
- No changes to Phase 4a/4b.

## API

### Manual trigger

`POST /api/admin/newsletter/generate-from-blog`

**Auth:** existing admin middleware.

**Request:**
```ts
{
  blog_post_id: string
  tone?: "professional" | "conversational" | "motivational"   // default: "professional"
  length?: "short" | "medium" | "long"                         // default: "medium"
}
```

**Behavior:**
1. Admin auth.
2. `getBlogPostById(blog_post_id)` — 404 on PGRST116.
3. `createAiJob({ type: "newsletter_from_blog", userId, input: { blog_post_id, tone, length } })`.
4. Return `{ jobId, status }` with 202.

### Auto trigger (unchanged surface)

`POST /api/admin/blog/[id]/publish` — response shape unchanged; side effect replaced:

- **Before:** status flip → fire-and-forget `sendBlogNewsletterToAll`.
- **After:** status flip → `createAiJob({ type: "newsletter_from_blog", userId, input: { blog_post_id: id } })` (fire-and-forget via promise chain, not awaited — same no-block pattern as today).

If `createAiJob` fails, log and continue — the publish itself must not fail. Same defensive posture as the existing `.catch((err) => console.error(...))`.

## Function input shape

```ts
interface NewsletterFromBlogInput {
  blog_post_id: string
  tone?: "professional" | "conversational" | "motivational"
  length?: "short" | "medium" | "long"
}
```

## Function output shape

Writes a newsletters row via `createDraftFromBlog(...)` and returns:

```ts
{
  newsletter_id: string
  subject: string
}
```

to `ai_jobs.result`. The frontend can poll for the job to surface a "draft created" toast; the dialog case redirects to the new newsletter.

## UI states (NewsletterGenerateDialog)

**Shared header** (always visible):
- Tabs: "From prompt" / "From blog post"
- Tone + Length selectors (lifted above tab content)

**Prompt mode** (existing behavior, unchanged):
- Prompt textarea
- Submit button → POSTs to existing newsletter-generate route

**Blog mode** (new):
- Blog picker: list of recent published blog posts (GET `/api/admin/blog?status=published&limit=20` — reuse the existing blog list route if it supports status filter, otherwise extend with an optional `?status=` query param)
- Submit button: "Generate from blog post" → POSTs to `/api/admin/newsletter/generate-from-blog`
- On success: close dialog + `router.push("/admin/newsletter")` (landing page for drafts)

## Error handling

| Failure | Behavior |
|---|---|
| Blog post not found (manual route) | 404 |
| `createAiJob` fails on publish | Log; publish response still 200 (behavior matches today's fire-and-forget) |
| Claude fails inside the Function | `ai_jobs.status = failed` with error message; no newsletter row inserted |
| Supabase insert fails inside the Function | Log; `ai_jobs.status = failed` |

## Testing

**Unit:**
- `functions/src/__tests__/newsletter-from-blog.test.ts` — 2 tests for `buildUserMessage`: embeds post title + excerpt + content + tone + length under clear headings; handles posts with empty tags/category gracefully.
- `__tests__/api/admin/newsletter/generate-from-blog.test.ts` — 4 tests: 401 / 400 (missing blog_post_id) / 404 (PGRST116) / 202 happy path (asserts `createAiJob` payload).
- `__tests__/api/admin/blog/publish.test.ts` — new test file: 3 tests verifying `createAiJob({ type: "newsletter_from_blog" })` is called with the published post id on publish, and `sendBlogNewsletterToAll` is NOT called. Also: publish still returns 200 even if `createAiJob` throws.

**Component:**
- `__tests__/components/newsletter-generate-dialog-from-blog.test.tsx` — 3 tests: tabs render; switching to blog mode fetches `/api/admin/blog?status=published`; submitting POSTs to `/api/admin/newsletter/generate-from-blog`.

**Manual smoke:**
1. Draft a new blog post with a title + content.
2. Publish it. Confirm no immediate blast arrives in subscriber mailbox.
3. Check the newsletter admin UI — new draft appears with `source_blog_post_id` set, AI-written subject + preview + content.
4. In `NewsletterGenerateDialog`, click the "From blog post" tab. Pick a different published post. Generate. Confirm the draft lands in the list.
5. Review + send the draft via the existing newsletter send flow — confirm subscribers receive it.

## Phase 4c closes when

1. Publishing a blog post no longer sends an immediate blast but creates an AI draft.
2. NewsletterGenerateDialog has a "From blog post" tab that picks any published post and generates a draft.
3. Drafts land in `newsletters` with `source_blog_post_id` populated.
4. All new unit/component tests pass.
5. Manual smoke confirms end-to-end: publish → draft appears → admin approves + sends.

## What 4c unblocks

- **Phase 4d** weekly trending scan writes to `content_calendar`; once topics become blog posts, the auto-draft flow triggers a newsletter for each.
- Post-Phase-5 Darren can segment newsletters by `source_blog_post_id` in analytics.
