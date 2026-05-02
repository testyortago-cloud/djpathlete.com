# Blog Pipeline — Topic-to-Post with Fal Images (Phase 1) — Design Spec

**Date:** 2026-05-02
**Status:** Draft, ready for plan-drafting
**Phase:** 1 of 2 — images-only extension (Phase 2 = full staged `blog_pipeline` parent job, deferred)
**Related existing specs:**
- `docs/superpowers/plans/2026-05-02-enterprise-upgrade-roadmap.md`
- Existing Functions: [functions/src/blog-generation.ts](../../../functions/src/blog-generation.ts), [functions/src/tavily-trending-scan.ts](../../../functions/src/tavily-trending-scan.ts), [functions/src/seo-enhance.ts](../../../functions/src/seo-enhance.ts), [functions/src/image-vision.ts](../../../functions/src/image-vision.ts)

---

## Problem statement

DJP Athlete already has a topic-suggestion source (`tavilyTrendingScan` writes ranked topics into `content_calendar` weekly) and a working blog text generator (`blogGeneration` Function produces `{title, slug, excerpt, content, category, tags, meta_description}`). Two gaps prevent topic-suggestion → publishable blog post:

1. **No trigger from `content_calendar` to `blogGeneration`.** Topics land in the calendar but require manual prompt entry to actually generate a draft.
2. **No images.** `cover_image_url` is `NULL` on AI-generated posts. This kills `og:image`, Twitter cards, Google Discover eligibility, and `Article.image` JSON-LD — all of which directly affect SEO and social CTR.

This spec covers the smallest change that closes both gaps: a "Generate from suggestion" admin action that enqueues `blog_generation`, and a new `blog_image_generation` job type that runs after to produce hero + inline images via fal.ai, alt-text via Claude Vision, and SEO schema enrichment.

A future Phase 2 spec will introduce a parent `blog_pipeline` orchestrator job for retry isolation, parallel fan-out, and per-stage cost tracking once volume justifies the orchestration overhead. Phase 1 deliberately stays inline-after-text to ship fast.

---

## Goals

1. One-click "Generate post" action on each `content_calendar` topic-suggestion row primes `blogGeneration` with the topic title and Tavily URL as a primary reference.
2. Every AI-generated blog post gets a hero image (high-quality, OG/Discover-ready) and 2–3 inline images placed under long `<h2>` sections.
3. All images are mirrored to the existing public Supabase `blog-images` bucket as WebP, with slug-based filenames and AI-generated alt text.
4. `seoEnhance` is extended to populate `Article.image` / `ImageObject` JSON-LD using the new hero URL.
5. Image generation failure does **not** fail the blog post — the post is left as a text-only draft and admin can retry.
6. Match djpathlete conventions: Firebase Functions for compute, `ai_jobs` doc-trigger pattern, Supabase as source of truth, Zod validators, `lib/db/` DAL, secrets via `defineSecret`.

## Non-goals (deferred to Phase 2)

- Parent `blog_pipeline` orchestrator job with `childJobIds[]` and per-stage retry.
- Fan-out parallelism via separate child jobs per image (Phase 1 generates all images in one Function invocation, in-process `Promise.all`).
- Cloud Tasks queue for fal QPS rate-limiting.
- Bulk-generate ("generate all 7 weekly topics at once") — Phase 1 is per-topic-click only.
- Per-stage cost ceilings and pre-generation cost preview UI.
- Inline image regeneration UI (Phase 1: regenerate = delete post, re-trigger).

---

## Existing patterns to follow

| Pattern | File / location | What we reuse |
|---|---|---|
| Job-trigger via Firestore | `ai_jobs/{jobId}` doc create — see [functions/src/index.ts](../../../functions/src/index.ts) | Add new `type: "blog_image_generation"` handler, new export in `index.ts` |
| Secrets | `defineSecret("ANTHROPIC_API_KEY")` etc. in `index.ts` | Add `defineSecret("FAL_KEY")` |
| Claude wrapper | `functions/src/ai/anthropic.ts` (`callAgent`, `MODEL_SONNET`) | Reuse for image-prompt extraction call |
| Supabase service-role client (Functions side) | `functions/src/lib/supabase.ts` | Reuse for `blog_posts` updates and Storage uploads |
| Public image storage bucket | `blog-images` (created in migration 00043, 5MB limit, public read) | Reuse — no new bucket needed |
| Existing alt-text generator | [functions/src/image-vision.ts](../../../functions/src/image-vision.ts) (system prompt + safeParseVision) | Extract the Claude-Vision-with-base64 portion into a shared helper; call inline for fal outputs |
| SEO enrichment | [functions/src/seo-enhance.ts](../../../functions/src/seo-enhance.ts) — already triggers on blog publish | Extend to set `Article.image` / `ImageObject` from `cover_image_url` and inline `<img src>` tags |
| Topic suggestions source | `content_calendar` rows with `entry_type='topic_suggestion'`, `metadata.tavily_url`, `status='planned'` | Read on the trigger UI; after the post is inserted, flip `status` to `'in_progress'` and set `reference_id` to the new blog_post_id |
| Admin role guard | `middleware.ts` + NextAuth v5 role check | New `/api/admin/blog/generate-from-suggestion` route under `/admin/*` |
| Zod validators | `lib/validators/blog-post.ts` (`cover_image_url` already in schema) | No schema change needed for cover_image_url; add `inline_images` JSONB column for tracking |
| Migration numbering | `00094_*.sql` is current latest | Start at `00095_*` |

---

## Decisions

### D1. Image plan: 1 premium hero + 2–3 cheap inline (option C from brainstorm)

- **Hero**: `fal-ai/flux-pro/v1.1` at 1200×630 (matches OG card aspect ratio). Premium because this is the only image rendered at large size on social shares, Discover, and `Article.image` rich result. Cost ~$0.04/post.
- **Inline**: `fal-ai/flux/schnell` at 1024×576 (16:9), one image inserted under each `<h2>` section longer than 150 words, capped at 3 inline total. Cheap because Google can't tell which model generated an image — inline SEO value comes from presence + alt text + filename, not aesthetic. Cost ~$0.003 each.
- **Total per post**: ~$0.05 (hero + 3 inline).

A short post with only 1–2 long sections gets fewer inline images. A 500-word post may end up hero-only.

### D2. Image storage: Supabase `blog-images` bucket, WebP, slug-based filenames

- The bucket already exists (migration 00043: public, 5MB limit, allows webp/jpeg/png/gif).
- Filenames: `<slug>-hero.webp`, `<slug>-section-1.webp`, `<slug>-section-2.webp`, etc. Predictable filenames help with cache-busting and image SEO.
- All images are transcoded to WebP via `sharp` before upload. Hero is capped at 1200px wide to keep LCP under target.
- Fal CDN URLs are **never persisted** to `blog_posts` — they expire. The Function downloads the fal output, transcodes, uploads to Supabase Storage, and stores only the Supabase public URL.

### D3. Alt text via shared Claude Vision helper

Extract the `Anthropic.messages.create` + `safeParseVision` block from [functions/src/image-vision.ts](../../../functions/src/image-vision.ts) into `functions/src/lib/image-alt-text.ts` exporting `generateAltText(buffer: Buffer, mimeType: string): Promise<string>`. The existing `image-vision.ts` Function refactors to use it. The new `blog-image-generation.ts` calls it on each freshly-generated fal output buffer (no media_assets roundtrip — alt text comes back inline before upload).

This avoids a second Firestore-trigger fan-out for alt text and keeps Phase 1 in-process.

### D4. Inline image placement: regex-based HTML splice, not LLM rewrite

After fal returns inline images and they're uploaded, the Function walks the post HTML, locates each `<h2>` whose following content is ≥150 words (paragraph text, stripped), and inserts an `<img src="<supabase-url>" alt="<claude-alt>" loading="lazy" width="1024" height="576">` immediately after the `<h2>` closing tag.

The blog-generation Claude prompt is **not** modified to know about inline images. This keeps text gen and image gen decoupled and idempotent — running images twice on the same post overwrites cleanly.

### D5. Image-prompt derivation: one extra Claude call, not part of `blogGeneration`

After `blog_generation` completes, the new `blog_image_generation` Function does a small `callAgent` request that takes the finished post HTML and returns:

```json
{
  "hero_prompt": "...",
  "inline_prompts": [
    { "section_h2": "...", "prompt": "..." },
    ...
  ]
}
```

System prompt instructs Claude to produce photorealistic prompts (no text overlays, no logos, athletic/coaching imagery, no AI-art tropes). Cost ~$0.005/post. Schema is Zod-validated.

This is in-Function for Phase 1. Phase 2 will split it into its own `blog_image_prompts` job for retry isolation.

### D6. Trigger: per-suggestion button, not auto-generate

A "Generate post" button on each `content_calendar` topic-suggestion row in the admin calendar UI:

1. Opens a small dialog confirming `tone` (default `professional`) and `length` (default `medium`).
2. POSTs to `/api/admin/blog/generate-from-suggestion` with `{ calendarId }`.
3. The route reads the row, builds the `ai_jobs` payload, and enqueues `type: "blog_generation"`. The Function later updates the row's `status = 'in_progress'` (matching the existing CHECK constraint enum) and populates `reference_id` with the new `blog_post_id` once the post is inserted, so the row visibly transitions and links to the resulting draft.
4. The existing `blogGeneration` Function runs as today.
5. On `blogGeneration` completion (`status='completed'` write to `ai_jobs`), a new Firestore `onUpdate` listener in `blog-image-generation.ts` enqueues a follow-up `ai_jobs` doc with `type: "blog_image_generation"` and `input.blog_post_id` set from the just-created `blog_posts` row.

> **Note on the listener.** Today, `blogGeneration` writes the completed post fields to `ai_jobs.result` but does **not** insert a `blog_posts` row — that happens in the Next.js admin UI when the user accepts the draft. We change this in Phase 1: `blogGeneration` now inserts a `blog_posts` row with `status='draft'` directly, returns the inserted ID in `ai_jobs.result.blog_post_id`, and a new `onDocumentUpdated` listener on `ai_jobs/{jobId}` fires the image job when `status` flips to `completed` and `type === 'blog_generation'`. This is a behavioral change to `blogGeneration`; covered in the implementation plan.

### D7. Failure mode: graceful

- **Image-prompt Claude call fails** → mark `ai_jobs` failed; post stays as text-only draft; admin can re-trigger from the post editor.
- **Fal call fails for hero** → mark `ai_jobs` failed; same recovery.
- **Fal call fails for an inline image** → log, skip that one image, continue with the rest. Post gets hero + remaining inline. Don't fail the job for a partial inline failure.
- **Supabase upload fails** → mark `ai_jobs` failed.
- **Alt text fails** → use a fallback derived from the prompt itself (`prompt.slice(0,120)`), don't fail the job.

### D8. Idempotency

`blog_image_generation` job inputs include `blog_post_id`. If the post already has `cover_image_url` set, the job overwrites both the cover and inline images (admin re-trigger == regenerate). Filenames are slug-deterministic so Supabase upserts cleanly.

### D9. SEO enhancements in `seoEnhance`

`seoEnhance` (already runs on blog publish) is extended to:
- Read `cover_image_url` and inline `<img>` tags from the published post.
- Populate `Article.image` (URL array) and per-image `ImageObject` JSON-LD with `url`, `width`, `height`, `caption` (alt text).
- No new Function — existing one gets a content-aware enhancement.

---

## Architecture

### Data flow

```
content_calendar (topic_suggestion)
        │
        │  admin clicks "Generate post"
        ▼
POST /api/admin/blog/generate-from-suggestion
        │
        │  inserts ai_jobs doc { type: "blog_generation", input: { prompt, references.urls=[tavily_url], ... } }
        │  updates content_calendar.status='drafted'
        ▼
blogGeneration Function  ───────────────────┐
  • Crawls tavily_url as primary reference   │
  • Calls Claude → blog HTML + frontmatter   │
  • INSERTS blog_posts row, status='draft'   │  ← NEW: was previously left to UI
  • Writes ai_jobs.result.blog_post_id       │
        │                                    │
        │ ai_jobs status flips to 'completed'│
        ▼                                    │
onAiJobCompleted listener (NEW)              │
  • Reads job.type === 'blog_generation'     │
  • Enqueues new ai_jobs doc:                │
      type: "blog_image_generation"          │
      input: { blog_post_id, slug }          │
        │                                    │
        ▼                                    │
blogImageGeneration Function (NEW)           │
  ├─ Step 1: Claude → image_prompts          │
  │   { hero_prompt, inline_prompts[...] }   │
  ├─ Step 2: Promise.all over fal calls      │
  │   • flux-pro/v1.1 for hero (1200×630)   │
  │   • flux/schnell for each inline         │
  ├─ Step 3: For each result buffer:         │
  │   • Sharp transcode to WebP, resize      │
  │   • generateAltText(buffer, 'image/webp')│
  │   • Upload to Supabase Storage           │
  │     bucket=blog-images                   │
  │     path=<slug>-hero.webp / -section-N   │
  ├─ Step 4: Splice <img> tags into HTML     │
  │   under each qualifying <h2>             │
  ├─ Step 5: UPDATE blog_posts SET           │
  │   cover_image_url, content (with imgs),  │
  │   inline_images (JSONB tracking)         │
  └─ Mark ai_jobs completed                  │
        │
        │ admin reviews draft, hits "Publish"
        ▼
seoEnhance Function (existing, extended)
  • Reads now-populated cover + inline img tags
  • Writes Article.image / ImageObject schema
```

### New / changed files

```
functions/src/
├── index.ts                          (CHANGED: register blogImageGeneration + onAiJobCompleted)
├── blog-generation.ts                (CHANGED: insert blog_posts row, return blog_post_id)
├── blog-image-generation.ts          (NEW: handler for type='blog_image_generation')
├── on-ai-job-completed.ts            (NEW: Firestore onUpdate listener, fans out image job)
├── lib/
│   ├── image-alt-text.ts             (NEW: shared Claude Vision helper)
│   ├── fal-client.ts                 (NEW: typed wrapper around @fal-ai/client)
│   └── image-pipeline.ts             (NEW: WebP transcode + Supabase upload + slug filename)
├── ai/
│   └── image-prompts.ts              (NEW: callAgent + Zod schema for image-prompt extraction)
├── image-vision.ts                   (CHANGED: refactor to use lib/image-alt-text.ts)
└── seo-enhance.ts                    (CHANGED: populate ImageObject schema from images in HTML)

app/api/admin/blog/
└── generate-from-suggestion/
    └── route.ts                      (NEW: enqueues ai_jobs + flips content_calendar.status)

components/admin/content-calendar/
└── TopicSuggestionRow.tsx            (CHANGED: add "Generate post" button + dialog)

supabase/migrations/
└── 00095_blog_posts_inline_images.sql  (NEW: adds inline_images JSONB column)

lib/db/
└── blog-posts.ts                     (CHANGED: typed accessors for inline_images column)

lib/validators/
└── blog-post.ts                      (CHANGED: optional inline_images schema)

functions/package.json                (CHANGED: add @fal-ai/client, sharp)
```

---

## Schema changes

### Migration `00095_blog_posts_inline_images.sql`

```sql
-- Track inline images per post for regeneration / display logic
ALTER TABLE blog_posts
  ADD COLUMN inline_images JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Each entry: { url, alt, prompt, section_h2, width, height }
COMMENT ON COLUMN blog_posts.inline_images IS
  'Array of inline images generated for this post. Used for regeneration and ImageObject schema.';
```

### `ai_jobs` payload shapes

```ts
// blog_generation (existing — input shape unchanged; result shape extended)
type BlogGenInput = {
  type: "blog_generation"
  input: {
    prompt: string
    tone?: "professional" | "conversational" | "motivational"
    length?: "short" | "medium" | "long"
    userId: string
    references?: { urls?: string[]; notes?: string; file_contents?: { name: string; content: string }[] }
    sourceCalendarId?: string  // NEW: optional, lets the Function flip content_calendar after insert
  }
  result?: {
    title: string; slug: string; excerpt: string; content: string
    category: string; tags: string[]; meta_description: string
    blog_post_id: string  // NEW
  }
}

// blog_image_generation (NEW)
type BlogImageGenInput = {
  type: "blog_image_generation"
  input: {
    blog_post_id: string  // FK into blog_posts
  }
  result?: {
    cover_image_url: string
    inline_images: Array<{ url: string; alt: string; section_h2: string }>
    fal_cost_usd: number
    failed_inline_count: number
  }
}
```

### Secrets

Add to `functions/src/index.ts`:

```ts
const falKey = defineSecret("FAL_KEY")
```

Add `falKey` to the secrets list of `blogImageGeneration`. Configure in Firebase: `firebase functions:secrets:set FAL_KEY`.

---

## Module boundaries

Each new module has one job and one well-defined interface.

| Module | Public API | Depends on |
|---|---|---|
| `lib/image-alt-text.ts` | `generateAltText(buffer: Buffer, mimeType: string): Promise<string>` | `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` |
| `lib/fal-client.ts` | `generateFalImage({ model, prompt, width, height }): Promise<{ buffer: Buffer; mime: string }>` | `@fal-ai/client`, `FAL_KEY` |
| `lib/image-pipeline.ts` | `transcodeAndUpload({ buffer, slug, kind, sectionIdx? }): Promise<{ url: string; width: number; height: number }>` | `sharp`, `getSupabase()` |
| `ai/image-prompts.ts` | `extractImagePrompts(post: { title; content; category }): Promise<{ hero: string; inline: { sectionH2; prompt }[] }>` | `callAgent`, `MODEL_SONNET` |
| `blog-image-generation.ts` | `handleBlogImageGeneration(jobId): Promise<void>` | All four above |
| `on-ai-job-completed.ts` | `handleAiJobCompleted(event): Promise<void>` | Firestore Admin SDK |

This shape keeps `blog-image-generation.ts` thin (~80 lines: orchestration only) and pushes implementation detail into single-purpose helpers that are independently testable.

---

## Error handling

| Failure | Behavior | Recovery |
|---|---|---|
| Image-prompt Claude call fails or returns invalid JSON | `ai_jobs.status='failed'`, `error` populated. Post is text-only. | Admin re-triggers from post editor "Regenerate images" button (added in Phase 1). |
| Fal hero call fails | Same as above. | Same. |
| Fal inline call fails (single) | Logged, skipped. Other inline images proceed. | None — partial result accepted. |
| Sharp transcode error | Same as fal hero failure. | Same. |
| Supabase upload error (transient — 5xx) | Retry once with 1s backoff, then fail the job. | Admin re-triggers. |
| Supabase upload error (permanent — 4xx) | Fail immediately. | Investigate bucket config / size limit. |
| Listener fires for non-blog `ai_jobs` | Listener checks `job.type === 'blog_generation'` first; no-op otherwise. | N/A. |
| Re-running on a post that already has images | Filenames are slug-deterministic; Supabase Storage upserts overwrite cleanly. `inline_images` JSONB array replaced atomically. | This **is** the regeneration path. |

---

## Testing

| Layer | What is tested | Where |
|---|---|---|
| Unit | `image-alt-text.ts`: Claude vision call with mocked SDK, validates parse + truncation | `functions/src/lib/__tests__/image-alt-text.test.ts` |
| Unit | `fal-client.ts`: mocked fal SDK, verifies model + dimensions plumbing, error propagation | `functions/src/lib/__tests__/fal-client.test.ts` |
| Unit | `image-pipeline.ts`: real `sharp` transcode on a tiny fixture buffer, mocked Supabase upload | `functions/src/lib/__tests__/image-pipeline.test.ts` |
| Unit | `ai/image-prompts.ts`: mocked `callAgent`, schema validation | `functions/src/ai/__tests__/image-prompts.test.ts` |
| Unit | HTML splice helper: inserts `<img>` only after `<h2>` with ≥150 words of following text; idempotent on second run | `functions/src/__tests__/html-splice.test.ts` |
| Integration | `handleBlogImageGeneration`: full flow with mocks at SDK boundaries (anthropic, fal, supabase) | `functions/src/__tests__/blog-image-generation.test.ts` |
| Integration | `handleAiJobCompleted`: fires only on `blog_generation` complete, enqueues correct payload | `functions/src/__tests__/on-ai-job-completed.test.ts` |
| API route | `/api/admin/blog/generate-from-suggestion`: admin auth gate, payload shape, content_calendar status transition | `__tests__/api/admin/blog/generate-from-suggestion.test.ts` |
| Manual | Click "Generate post" on a real topic suggestion, verify hero + inline images appear in published post, OG card renders, ImageObject in JSON-LD | Staging env |

---

## Rollout

1. Migration `00095` (additive — `inline_images` JSONB defaults to `[]`).
2. Deploy Functions changes — `blogGeneration` (now inserts `blog_posts`), new `blogImageGeneration`, new `onAiJobCompleted`, refactored `image-vision` (uses shared helper), enhanced `seoEnhance`.
3. Deploy Next.js — new admin API route, new "Generate post" button.
4. **Backfill optional**: existing AI-generated `blog_posts` without `cover_image_url` can be processed by enqueuing `blog_image_generation` jobs directly via a one-off script. Out of scope for the spec but trivial with the new handler.

No feature flag — the new path is gated behind admin role + an explicit button click, so risk is low. If image gen breaks, the worst case is a text-only draft, which matches today's behavior.

---

## Open questions

None blocking. Two items to resolve during implementation:

1. **Inline image placement threshold (150 words after `<h2>`)** — pulled from analogous editorial conventions; may need tuning after first 5–10 generated posts. The threshold is a constant in `html-splice.ts`, easy to adjust.
2. **fal model upgrade path** — `flux-pro/v1.1` is current default; the model string is a constant in `fal-client.ts` so swapping to a future `flux-pro/v2` is one-line.

---

## Phase 2 preview (not in this spec)

Once Phase 1 is in production and Darren wants to bulk-generate or iterate on image prompts, Phase 2 introduces a parent `blog_pipeline` `ai_jobs` doc with `childJobIds[]`, splits image generation into one child job per image (true fan-out), adds `concurrency` + `maxInstances` tuning per stage, and adds a pre-generation cost preview UI. Phase 2 spec to be written separately when triggered by volume.
