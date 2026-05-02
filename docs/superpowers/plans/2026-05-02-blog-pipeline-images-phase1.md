# Blog Pipeline — Topic-to-Post with Fal Images (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `content_calendar` topic suggestions into the existing `blogGeneration` Firebase Function, then automatically follow up with fal.ai-generated hero + inline images uploaded to Supabase Storage with Claude-Vision alt text and SEO schema enrichment.

**Architecture:** Two new seams atop existing Functions. (1) A new admin API route + button on the topic suggestions page enqueues an `ai_jobs` doc of `type: "blog_generation"` with the Tavily URL primed as a primary reference. (2) A new Firestore `onDocumentUpdated` listener watches `ai_jobs` and, when a `blog_generation` job completes, fans out a `blog_image_generation` job that derives image prompts from the post HTML, calls fal in parallel, transcodes to WebP via sharp, uploads to the existing public Supabase `blog-images` bucket, generates alt text per image via Claude Vision, and splices `<img>` tags under qualifying `<h2>` sections. `blogGeneration` is modified to insert the `blog_posts` row directly so the listener has a target row. `seoEnhance` is extended to populate `Article.image` / `ImageObject` JSON-LD from the now-populated images.

**Tech Stack:** Firebase Functions Gen 2 (Node 22), `@anthropic-ai/sdk`, `@fal-ai/client`, `sharp`, `firebase-admin`, `@supabase/supabase-js`, Zod, NextAuth v5, Next.js 16 App Router, Vitest, Tailwind v4, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-05-02-blog-pipeline-images-phase1-design.md`

---

## File Structure

### New files (Functions side)
- `functions/src/lib/image-alt-text.ts` — `generateAltText(buffer, mimeType)` shared Claude Vision helper
- `functions/src/lib/fal-client.ts` — `generateFalImage({model, prompt, width, height})` typed wrapper
- `functions/src/lib/image-pipeline.ts` — `transcodeAndUpload({buffer, slug, kind, sectionIdx?})` sharp + Supabase upload
- `functions/src/lib/html-splice.ts` — `spliceInlineImages(html, images)` pure HTML mutation
- `functions/src/ai/image-prompts.ts` — `extractImagePrompts(post)` callAgent wrapper with Zod schema
- `functions/src/blog-image-generation.ts` — `handleBlogImageGeneration(jobId)` orchestrator
- `functions/src/on-ai-job-completed.ts` — `handleAiJobCompleted(event)` Firestore listener
- `functions/src/lib/__tests__/image-alt-text.test.ts`
- `functions/src/lib/__tests__/fal-client.test.ts`
- `functions/src/lib/__tests__/image-pipeline.test.ts`
- `functions/src/lib/__tests__/html-splice.test.ts`
- `functions/src/ai/__tests__/image-prompts.test.ts`
- `functions/src/__tests__/blog-image-generation.test.ts`
- `functions/src/__tests__/on-ai-job-completed.test.ts`

### New files (Next.js side)
- `supabase/migrations/00095_blog_posts_inline_images.sql`
- `app/api/admin/blog/generate-from-suggestion/route.ts`
- `__tests__/api/admin/blog/generate-from-suggestion.test.ts`

### Changed files
- `functions/package.json` — add `@fal-ai/client`, `sharp`
- `functions/src/index.ts` — `FAL_KEY` secret, register `blogImageGeneration`, register `onAiJobCompleted` listener
- `functions/src/blog-generation.ts` — insert `blog_posts` row, return `blog_post_id` in `result`
- `functions/src/image-vision.ts` — refactor to use `lib/image-alt-text.ts`
- `functions/src/seo-enhance.ts` — populate `ImageObject` schema from `cover_image_url` + inline `<img>` tags
- `lib/validators/blog-post.ts` — optional `inline_images` schema field
- `lib/db/blog-posts.ts` — type accessor for `inline_images` column
- `types/database.ts` — add `inline_images` to `BlogPost` interface
- `components/admin/topic-suggestions/TopicSuggestionsList.tsx` — add "Generate post" button alongside existing "Draft blog"

---

## Task 1: Database migration — `inline_images` column

**Files:**
- Create: `supabase/migrations/00095_blog_posts_inline_images.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Track inline images per post for regeneration logic and SEO ImageObject schema.
-- Each entry: { url, alt, prompt, section_h2, width, height }

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS inline_images JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN blog_posts.inline_images IS
  'Array of inline images generated for this post. Used for regeneration and ImageObject schema.';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push` (or apply via Supabase Studio SQL editor for cloud-only setup)
Expected: migration succeeds, column appears in `blog_posts`.

- [ ] **Step 3: Verify schema**

Run: `npx supabase db diff` (should be empty) or query `SELECT column_name FROM information_schema.columns WHERE table_name='blog_posts' AND column_name='inline_images';` — expects one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00095_blog_posts_inline_images.sql
git commit -m "feat(db): add blog_posts.inline_images JSONB column"
```

---

## Task 2: TypeScript types and validators for `inline_images`

**Files:**
- Modify: `types/database.ts:724-744`
- Modify: `lib/validators/blog-post.ts`

- [ ] **Step 1: Extend `BlogPost` interface**

In `types/database.ts`, add after line 743 (`fact_check_details`):

```ts
  inline_images: Array<{
    url: string
    alt: string
    prompt: string
    section_h2: string
    width: number
    height: number
  }>
```

So the full interface becomes:

```ts
export interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  category: BlogCategory
  cover_image_url: string | null
  status: BlogPostStatus
  tags: string[]
  meta_description: string | null
  author_id: string
  published_at: string | null
  created_at: string
  updated_at: string
  source_video_id: string | null
  seo_metadata: Record<string, unknown>
  tavily_research: Record<string, unknown> | null
  fact_check_status: FactCheckStatus | null
  fact_check_details: Record<string, unknown> | null
  inline_images: Array<{
    url: string
    alt: string
    prompt: string
    section_h2: string
    width: number
    height: number
  }>
}
```

- [ ] **Step 2: Extend `blogPostFormSchema`**

In `lib/validators/blog-post.ts`, add the `inline_images` field:

```ts
import { z } from "zod"

export const BLOG_CATEGORIES = ["Performance", "Recovery", "Coaching", "Youth Development"] as const

export const inlineImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(180),
  prompt: z.string(),
  section_h2: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const blogPostFormSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200, "Title must be under 200 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(200, "Slug must be under 200 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase with hyphens only"),
  excerpt: z
    .string()
    .min(10, "Excerpt must be at least 10 characters")
    .max(500, "Excerpt must be under 500 characters"),
  content: z.string().min(1, "Content is required"),
  category: z.enum(BLOG_CATEGORIES, { message: "Category is required" }),
  cover_image_url: z
    .string()
    .url("Must be a valid URL")
    .nullable()
    .optional()
    .transform((v) => v || null),
  tags: z.array(z.string()).optional().default([]),
  meta_description: z
    .string()
    .max(160, "Meta description must be under 160 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
  inline_images: z.array(inlineImageSchema).optional().default([]),
})

export type BlogPostFormData = z.infer<typeof blogPostFormSchema>
export type InlineImage = z.infer<typeof inlineImageSchema>
```

- [ ] **Step 3: Run type-check**

Run: `npm run build`
Expected: PASS (no type errors in any file referencing `BlogPost` or `blogPostFormSchema`).

- [ ] **Step 4: Commit**

```bash
git add types/database.ts lib/validators/blog-post.ts
git commit -m "feat(types): add inline_images to BlogPost type and validator"
```

---

## Task 3: Add fal + sharp dependencies to Functions

**Files:**
- Modify: `functions/package.json`

- [ ] **Step 1: Install dependencies**

Run: `cd functions && npm install @fal-ai/client@^1 sharp@^0.33` then `cd ..`
Expected: both packages added to `dependencies` in `functions/package.json`.

- [ ] **Step 2: Verify package.json**

Read: `functions/package.json`
Expected: `dependencies` block now includes `"@fal-ai/client"` and `"sharp"`.

- [ ] **Step 3: Type-check Functions**

Run: `cd functions && npm run build && cd ..`
Expected: PASS (existing code unaffected).

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "build(functions): add @fal-ai/client and sharp dependencies"
```

---

## Task 4: Shared `image-alt-text.ts` helper (extracted from `image-vision.ts`)

**Files:**
- Create: `functions/src/lib/image-alt-text.ts`
- Test: `functions/src/lib/__tests__/image-alt-text.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/lib/__tests__/image-alt-text.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Anthropic SDK before importing the helper
const mockCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { generateAltText } from "../image-alt-text.js"

describe("generateAltText", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  it("returns alt text from Claude Vision response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"alt_text":"A barbell back squat at the bottom position"}' }],
    })
    const buffer = Buffer.from("fakeimage")
    const alt = await generateAltText(buffer, "image/webp")
    expect(alt).toBe("A barbell back squat at the bottom position")
  })

  it("truncates alt text to 180 chars", async () => {
    const longText = "a".repeat(300)
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ alt_text: longText }) }],
    })
    const alt = await generateAltText(Buffer.from("x"), "image/webp")
    expect(alt.length).toBeLessThanOrEqual(180)
  })

  it("returns empty string on parse failure", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json at all" }],
    })
    const alt = await generateAltText(Buffer.from("x"), "image/webp")
    expect(alt).toBe("")
  })

  it("strips markdown fences from response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '```json\n{"alt_text":"Athlete sprinting on track"}\n```' }],
    })
    const alt = await generateAltText(Buffer.from("x"), "image/webp")
    expect(alt).toBe("Athlete sprinting on track")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/lib/__tests__/image-alt-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `functions/src/lib/image-alt-text.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk"

const MODEL = "claude-sonnet-4-6"
const ALT_TEXT_MAX_CHARS = 180

const SYSTEM_PROMPT = `You are writing accessibility alt-text for an image on a fitness/coaching blog. Output ONLY a JSON object with this shape:
{ "alt_text": "<one concrete sentence, <= 125 chars, describes what a blind reader needs to know>" }

Rules:
- Be specific. Use fitness terminology when an exercise or piece of equipment is identifiable.
- No filler ("photo of", "image shows").
- If the image is unusable, return alt_text="".
- Output nothing except the JSON object — no preamble, no markdown fence.`

export async function generateAltText(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type:
                (mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif") ?? "image/webp",
              data: buffer.toString("base64"),
            },
          },
          { type: "text", text: "Generate alt text for this image per the system instructions." },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b: { type: string }) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined
  if (!textBlock) return ""

  const cleaned = textBlock.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  try {
    const parsed = JSON.parse(cleaned) as { alt_text?: unknown }
    if (typeof parsed.alt_text !== "string") return ""
    return parsed.alt_text.slice(0, ALT_TEXT_MAX_CHARS)
  } catch {
    return ""
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/lib/__tests__/image-alt-text.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/image-alt-text.ts functions/src/lib/__tests__/image-alt-text.test.ts
git commit -m "feat(functions): add shared image-alt-text helper"
```

---

## Task 5: Refactor `image-vision.ts` to use shared helper

**Files:**
- Modify: `functions/src/image-vision.ts:67-173`

- [ ] **Step 1: Read current handler**

Read `functions/src/image-vision.ts` to confirm the inline Claude call at lines 110–149 matches the helper's responsibility.

- [ ] **Step 2: Rewrite `handleImageVision` to use the shared helper**

Replace the body of `handleImageVision` so it:
1. Loads the asset row.
2. Downloads the buffer from Firebase Storage.
3. Calls `generateAltText(buffer, mimeType)`.
4. Writes the result to `media_assets.ai_alt_text`.

The structured analysis (scene/objects/hashtags) **stays inside `handleImageVision`** — the shared helper only covers alt text. Keep the `safeParseVision` + structured prompt for the analysis path. New file body:

```ts
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabase } from "./lib/supabase.js"
import { generateAltText } from "./lib/image-alt-text.js"

const MODEL = "claude-sonnet-4-6"

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing a photograph for a fitness/coaching content team. Return ONLY a JSON object:
{
  "scene": "gym" | "home" | "outdoor" | "stage" | "studio" | "other",
  "objects": ["<notable object>", "..."],
  "suggested_hashtags": ["<tag>", "..."]
}
Rules:
- objects: max 8, name visible equipment, people, props. Skip walls/floor.
- suggested_hashtags: max 5, lowercase, single-word, no '#'.
Return nothing except the JSON object.`

interface ParsedAnalysis {
  scene: string
  objects: string[]
  suggested_hashtags: string[]
}

function safeParseAnalysis(raw: string): ParsedAnalysis | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(cleaned) as Partial<ParsedAnalysis>
    return {
      scene: typeof parsed.scene === "string" ? parsed.scene : "other",
      objects: Array.isArray(parsed.objects)
        ? parsed.objects.filter((x): x is string => typeof x === "string").slice(0, 8)
        : [],
      suggested_hashtags: Array.isArray(parsed.suggested_hashtags)
        ? parsed.suggested_hashtags.filter((x): x is string => typeof x === "string").slice(0, 5)
        : [],
    }
  } catch {
    return null
  }
}

export interface ImageVisionInput {
  mediaAssetId: string
}

export async function handleImageVision(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }
    const mediaAssetId = (data.input as ImageVisionInput | undefined)?.mediaAssetId
    if (!mediaAssetId) {
      await failJob("input.mediaAssetId is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const { data: asset, error } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type")
      .eq("id", mediaAssetId)
      .single()
    if (error || !asset) {
      await failJob(`media_assets row ${mediaAssetId} not found`)
      return
    }

    const bucket = getStorage().bucket()
    const [buffer] = await bucket.file(asset.storage_path).download()
    const mimeType = (asset.mime_type as string | null) ?? "image/jpeg"

    // Alt text via shared helper
    const altText = await generateAltText(buffer, mimeType)

    // Structured analysis via inline Claude call
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type:
                  (mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif") ??
                  "image/jpeg",
                data: buffer.toString("base64"),
              },
            },
            { type: "text", text: "Analyze this image per the system instructions." },
          ],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    const analysis = textBlock && textBlock.type === "text" ? safeParseAnalysis(textBlock.text) : null

    await supabase
      .from("media_assets")
      .update({
        ai_alt_text: altText,
        ai_analysis: analysis ?? { scene: "other", objects: [], suggested_hashtags: [] },
      })
      .eq("id", mediaAssetId)

    await jobRef.update({
      status: "completed",
      result: { mediaAssetId, alt_text: altText },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown image-vision error")
  }
}
```

- [ ] **Step 3: Run existing image-vision tests**

Run: `cd functions && npx vitest run src/__tests__/image-vision.test.ts`
Expected: PASS (existing tests should still hold; the alt-text generation moved but the contract on `media_assets` is identical).

If a test referenced the inlined alt-text JSON format directly, adjust the test to mock `generateAltText` instead.

- [ ] **Step 4: Run full functions test suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/image-vision.ts
git commit -m "refactor(functions): use shared image-alt-text helper in image-vision"
```

---

## Task 6: Fal client wrapper

**Files:**
- Create: `functions/src/lib/fal-client.ts`
- Test: `functions/src/lib/__tests__/fal-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/lib/__tests__/fal-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSubscribe = vi.fn()
const mockConfig = vi.fn()
vi.mock("@fal-ai/client", () => ({
  fal: {
    config: mockConfig,
    subscribe: mockSubscribe,
  },
}))

// fetch stub for the image download step
const originalFetch = globalThis.fetch
afterAllRestore()
function afterAllRestore() {
  // no-op; reset per-test below
}

import { generateFalImage } from "../fal-client.js"

describe("generateFalImage", () => {
  beforeEach(() => {
    mockSubscribe.mockReset()
    mockConfig.mockReset()
    process.env.FAL_KEY = "fal-test-key"
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      headers: { get: (k: string) => (k === "content-type" ? "image/png" : null) },
    })) as unknown as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it("calls fal.subscribe with correct model and dimensions, downloads and returns buffer", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: { images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }] },
    })

    const result = await generateFalImage({
      model: "fal-ai/flux/schnell",
      prompt: "an athlete sprinting",
      width: 1024,
      height: 576,
    })

    expect(mockConfig).toHaveBeenCalledWith({ credentials: "fal-test-key" })
    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/flux/schnell",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "an athlete sprinting",
          image_size: { width: 1024, height: 576 },
        }),
      }),
    )
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.buffer.length).toBe(4)
    expect(result.mime).toBe("image/png")
  })

  it("throws when fal returns no images", async () => {
    mockSubscribe.mockResolvedValueOnce({ data: { images: [] } })
    await expect(
      generateFalImage({ model: "fal-ai/flux/schnell", prompt: "x", width: 1024, height: 576 }),
    ).rejects.toThrow(/no images/i)
  })

  it("throws when image download fails", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: { images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }] },
    })
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
    await expect(
      generateFalImage({ model: "fal-ai/flux/schnell", prompt: "x", width: 1024, height: 576 }),
    ).rejects.toThrow(/download/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/lib/__tests__/fal-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `functions/src/lib/fal-client.ts`:

```ts
import { fal } from "@fal-ai/client"

let configured = false

export interface GenerateFalImageInput {
  model: string
  prompt: string
  width: number
  height: number
}

export interface GenerateFalImageResult {
  buffer: Buffer
  mime: string
}

export async function generateFalImage(input: GenerateFalImageInput): Promise<GenerateFalImageResult> {
  const apiKey = process.env.FAL_KEY
  if (!apiKey) throw new Error("FAL_KEY is not set")
  if (!configured) {
    fal.config({ credentials: apiKey })
    configured = true
  }

  const response = await fal.subscribe(input.model, {
    input: {
      prompt: input.prompt,
      image_size: { width: input.width, height: input.height },
      num_images: 1,
      enable_safety_checker: true,
    },
    logs: false,
  })

  const data = response.data as { images?: Array<{ url: string; content_type?: string }> }
  const first = data.images?.[0]
  if (!first?.url) {
    throw new Error("Fal returned no images for prompt")
  }

  const fetched = await fetch(first.url)
  if (!fetched.ok) {
    throw new Error(`Fal image download failed: HTTP ${fetched.status}`)
  }
  const arrayBuf = await fetched.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)
  const mime = first.content_type ?? fetched.headers.get("content-type") ?? "image/png"

  return { buffer, mime }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/lib/__tests__/fal-client.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/fal-client.ts functions/src/lib/__tests__/fal-client.test.ts
git commit -m "feat(functions): add fal client wrapper for image generation"
```

---

## Task 7: Image pipeline (sharp transcode + Supabase upload)

**Files:**
- Create: `functions/src/lib/image-pipeline.ts`
- Test: `functions/src/lib/__tests__/image-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/lib/__tests__/image-pipeline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

// Build a real 200x100 PNG fixture so sharp has actual bytes to work on
async function makePngFixture(): Promise<Buffer> {
  return await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .png()
    .toBuffer()
}

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()
vi.mock("../supabase.js", () => ({
  getSupabase: () => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  }),
}))

import { transcodeAndUpload } from "../image-pipeline.js"

describe("transcodeAndUpload", () => {
  beforeEach(() => {
    mockUpload.mockReset()
    mockGetPublicUrl.mockReset()
    mockUpload.mockResolvedValue({ data: { path: "x" }, error: null })
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://supabase.example/blog-images/x.webp" } })
  })

  it("transcodes hero to webp at exactly 1200x630 and uploads with hero filename", async () => {
    const fixture = await makePngFixture()
    const result = await transcodeAndUpload({
      buffer: fixture,
      slug: "my-test-post",
      kind: "hero",
    })

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [path, body, opts] = mockUpload.mock.calls[0] as [string, Buffer, { contentType: string; upsert: boolean }]
    expect(path).toBe("my-test-post-hero.webp")
    expect(opts.contentType).toBe("image/webp")
    expect(opts.upsert).toBe(true)

    // Verify body is webp at 1200x630
    const meta = await sharp(body).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(630)
    expect(result.url).toBe("https://supabase.example/blog-images/x.webp")
    expect(result.width).toBe(1200)
    expect(result.height).toBe(630)
  })

  it("transcodes inline section to 1024x576 with section filename", async () => {
    const fixture = await makePngFixture()
    const result = await transcodeAndUpload({
      buffer: fixture,
      slug: "my-test-post",
      kind: "inline",
      sectionIdx: 2,
    })

    const [path, body] = mockUpload.mock.calls[0] as [string, Buffer]
    expect(path).toBe("my-test-post-section-2.webp")
    const meta = await sharp(body).metadata()
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(576)
    expect(result.width).toBe(1024)
  })

  it("throws when supabase upload fails", async () => {
    const fixture = await makePngFixture()
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: "bucket missing" } })
    await expect(
      transcodeAndUpload({ buffer: fixture, slug: "x", kind: "hero" }),
    ).rejects.toThrow(/bucket missing/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/lib/__tests__/image-pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pipeline**

Create `functions/src/lib/image-pipeline.ts`:

```ts
import sharp from "sharp"
import { getSupabase } from "./supabase.js"

const BUCKET = "blog-images"

const DIMENSIONS = {
  hero: { width: 1200, height: 630 },
  inline: { width: 1024, height: 576 },
} as const

export type ImageKind = "hero" | "inline"

export interface TranscodeAndUploadInput {
  buffer: Buffer
  slug: string
  kind: ImageKind
  sectionIdx?: number  // required when kind === "inline"
}

export interface TranscodeAndUploadResult {
  url: string
  width: number
  height: number
  path: string
}

function buildPath(slug: string, kind: ImageKind, sectionIdx?: number): string {
  if (kind === "hero") return `${slug}-hero.webp`
  if (typeof sectionIdx !== "number") {
    throw new Error("sectionIdx is required for inline images")
  }
  return `${slug}-section-${sectionIdx}.webp`
}

export async function transcodeAndUpload(input: TranscodeAndUploadInput): Promise<TranscodeAndUploadResult> {
  const dims = DIMENSIONS[input.kind]
  const path = buildPath(input.slug, input.kind, input.sectionIdx)

  const webpBuffer = await sharp(input.buffer)
    .resize(dims.width, dims.height, { fit: "cover", position: "center" })
    .webp({ quality: 82 })
    .toBuffer()

  const supabase = getSupabase()
  const { error } = await supabase.storage.from(BUCKET).upload(path, webpBuffer, {
    contentType: "image/webp",
    upsert: true,
  })
  if (error) throw new Error(`Supabase upload failed (${path}): ${error.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return {
    url: pub.publicUrl,
    width: dims.width,
    height: dims.height,
    path,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/lib/__tests__/image-pipeline.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/image-pipeline.ts functions/src/lib/__tests__/image-pipeline.test.ts
git commit -m "feat(functions): add WebP transcode + Supabase Storage upload pipeline"
```

---

## Task 8: HTML splice helper

**Files:**
- Create: `functions/src/lib/html-splice.ts`
- Test: `functions/src/lib/__tests__/html-splice.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/lib/__tests__/html-splice.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { spliceInlineImages, findQualifyingSections, MIN_SECTION_WORDS } from "../html-splice.js"

describe("findQualifyingSections", () => {
  it("returns h2 sections whose following text is at least 150 words", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const shortPara = `<p>${"word ".repeat(50)}</p>`
    const html = [
      "<p>intro paragraph</p>",
      "<h2>Section A</h2>",
      longPara,
      "<h2>Section B</h2>",
      shortPara,
      "<h2>Section C</h2>",
      longPara,
    ].join("")

    const sections = findQualifyingSections(html)
    expect(sections).toHaveLength(2)
    expect(sections[0].h2Text).toBe("Section A")
    expect(sections[1].h2Text).toBe("Section C")
    expect(MIN_SECTION_WORDS).toBe(150)
  })

  it("returns empty array when no h2s qualify", () => {
    const html = "<p>short</p><h2>tiny</h2><p>only ten words here in this short test paragraph</p>"
    expect(findQualifyingSections(html)).toEqual([])
  })

  it("caps results at 3 sections", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = ["A", "B", "C", "D", "E"].map((s) => `<h2>${s}</h2>${longPara}`).join("")
    const sections = findQualifyingSections(html)
    expect(sections).toHaveLength(3)
    expect(sections.map((s) => s.h2Text)).toEqual(["A", "B", "C"])
  })
})

describe("spliceInlineImages", () => {
  it("inserts <img> immediately after the qualifying h2", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<p>intro</p><h2>Section A</h2>${longPara}`
    const out = spliceInlineImages(html, [
      {
        h2Text: "Section A",
        url: "https://supa.example/a.webp",
        alt: "Athlete training",
        width: 1024,
        height: 576,
      },
    ])
    expect(out).toContain('<h2>Section A</h2><img src="https://supa.example/a.webp" alt="Athlete training" loading="lazy" width="1024" height="576">')
  })

  it("is idempotent: running splice twice with same image does not double-insert", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<h2>Section A</h2>${longPara}`
    const image = {
      h2Text: "Section A",
      url: "https://supa.example/a.webp",
      alt: "x",
      width: 1024,
      height: 576,
    }
    const once = spliceInlineImages(html, [image])
    const twice = spliceInlineImages(once, [image])
    const matches = twice.match(/https:\/\/supa\.example\/a\.webp/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it("ignores images whose h2Text doesn't appear", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<h2>Section A</h2>${longPara}`
    const out = spliceInlineImages(html, [
      { h2Text: "Section Z", url: "x", alt: "x", width: 1024, height: 576 },
    ])
    expect(out).toBe(html)
  })

  it("html-encodes alt text to prevent XSS", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<h2>Section A</h2>${longPara}`
    const out = spliceInlineImages(html, [
      {
        h2Text: "Section A",
        url: "https://x.example/a.webp",
        alt: 'evil"<script>',
        width: 1024,
        height: 576,
      },
    ])
    expect(out).toContain('alt="evil&quot;&lt;script&gt;"')
    expect(out).not.toContain('alt="evil"<script>"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/lib/__tests__/html-splice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `functions/src/lib/html-splice.ts`:

```ts
export const MIN_SECTION_WORDS = 150
const MAX_INLINE_IMAGES = 3

export interface QualifyingSection {
  h2Text: string
  h2OuterStart: number  // index of "<" in "<h2>"
  h2OuterEnd: number    // index just after the closing ">" of "</h2>"
}

export interface InlineImageInsert {
  h2Text: string
  url: string
  alt: string
  width: number
  height: number
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ")
}

function wordCount(text: string): number {
  const stripped = stripTags(text).trim()
  if (!stripped) return 0
  return stripped.split(/\s+/).length
}

/**
 * Returns up to MAX_INLINE_IMAGES h2 sections whose following content
 * (until the next h2 or end of string) contains at least MIN_SECTION_WORDS words.
 */
export function findQualifyingSections(html: string): QualifyingSection[] {
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/g
  const matches: { start: number; end: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = h2Regex.exec(html)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[1].trim(),
    })
  }

  const out: QualifyingSection[] = []
  for (let i = 0; i < matches.length && out.length < MAX_INLINE_IMAGES; i++) {
    const cur = matches[i]
    const nextStart = matches[i + 1]?.start ?? html.length
    const sectionContent = html.slice(cur.end, nextStart)
    if (wordCount(sectionContent) >= MIN_SECTION_WORDS) {
      out.push({
        h2Text: stripTags(cur.text).trim(),
        h2OuterStart: cur.start,
        h2OuterEnd: cur.end,
      })
    }
  }
  return out
}

/**
 * Splice inline <img> tags into html, immediately after each matching h2.
 * Idempotent: skips insertion if an <img> with the same src already follows the h2.
 */
export function spliceInlineImages(html: string, images: InlineImageInsert[]): string {
  if (images.length === 0) return html

  // Process in reverse order (highest index first) so earlier indices don't shift
  const sections = findQualifyingSections(html)
  const inserts: { idx: number; tag: string }[] = []

  for (const img of images) {
    const section = sections.find((s) => s.h2Text === img.h2Text)
    if (!section) continue

    // Idempotency check: look at the next ~200 chars after the </h2>
    const lookahead = html.slice(section.h2OuterEnd, section.h2OuterEnd + 400)
    if (lookahead.includes(img.url)) continue

    const tag = `<img src="${htmlEscape(img.url)}" alt="${htmlEscape(img.alt)}" loading="lazy" width="${img.width}" height="${img.height}">`
    inserts.push({ idx: section.h2OuterEnd, tag })
  }

  inserts.sort((a, b) => b.idx - a.idx)
  let result = html
  for (const ins of inserts) {
    result = result.slice(0, ins.idx) + ins.tag + result.slice(ins.idx)
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/lib/__tests__/html-splice.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/html-splice.ts functions/src/lib/__tests__/html-splice.test.ts
git commit -m "feat(functions): add HTML splice helper for inline blog images"
```

---

## Task 9: Image-prompts AI helper

**Files:**
- Create: `functions/src/ai/image-prompts.ts`
- Test: `functions/src/ai/__tests__/image-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/ai/__tests__/image-prompts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCallAgent = vi.fn()
vi.mock("../anthropic.js", () => ({
  callAgent: mockCallAgent,
  MODEL_SONNET: "claude-sonnet-test",
}))

import { extractImagePrompts } from "../image-prompts.js"

describe("extractImagePrompts", () => {
  beforeEach(() => {
    mockCallAgent.mockReset()
  })

  it("returns hero + inline prompts validated by schema", async () => {
    mockCallAgent.mockResolvedValueOnce({
      content: {
        hero_prompt: "An athlete sprinting on a track at golden hour, photorealistic",
        inline_prompts: [
          { section_h2: "Force-Velocity Profiling", prompt: "Coach reading sport-science chart, gym setting" },
          { section_h2: "Velocity-Based Training", prompt: "Barbell mid-press with chains, photorealistic" },
        ],
      },
      tokens_used: 500,
    })

    const result = await extractImagePrompts({
      title: "Eccentric Overload",
      content: "<h2>Force-Velocity Profiling</h2><p>...</p>",
      category: "Performance",
      qualifyingSections: ["Force-Velocity Profiling", "Velocity-Based Training"],
    })

    expect(result.hero_prompt.length).toBeGreaterThan(10)
    expect(result.inline_prompts).toHaveLength(2)
    expect(result.inline_prompts[0].section_h2).toBe("Force-Velocity Profiling")
  })

  it("propagates errors from callAgent", async () => {
    mockCallAgent.mockRejectedValueOnce(new Error("Claude failed"))
    await expect(
      extractImagePrompts({
        title: "x",
        content: "<p>x</p>",
        category: "Performance",
        qualifyingSections: [],
      }),
    ).rejects.toThrow("Claude failed")
  })

  it("filters inline_prompts to only those matching qualifyingSections", async () => {
    mockCallAgent.mockResolvedValueOnce({
      content: {
        hero_prompt: "hero",
        inline_prompts: [
          { section_h2: "Real Section", prompt: "p1" },
          { section_h2: "Hallucinated Section", prompt: "p2" },
        ],
      },
      tokens_used: 100,
    })

    const result = await extractImagePrompts({
      title: "x",
      content: "x",
      category: "Performance",
      qualifyingSections: ["Real Section"],
    })

    expect(result.inline_prompts).toHaveLength(1)
    expect(result.inline_prompts[0].section_h2).toBe("Real Section")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/ai/__tests__/image-prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `functions/src/ai/image-prompts.ts`:

```ts
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./anthropic.js"

export const imagePromptsSchema = z.object({
  hero_prompt: z.string().min(10).max(500),
  inline_prompts: z
    .array(
      z.object({
        section_h2: z.string().min(1).max(200),
        prompt: z.string().min(10).max(500),
      }),
    )
    .max(5),
})

export type ImagePromptsResult = z.infer<typeof imagePromptsSchema>

const SYSTEM_PROMPT = `You write image prompts for a science-based athletic-performance blog by Darren Paul (DJP Athlete). Your prompts are sent to a text-to-image model.

Style requirements (apply to every prompt):
- Photorealistic. Real people, real gyms, real outdoor settings. No illustrations, no 3D renders, no AI-art tropes.
- No text overlays. No logos. No watermarks. No company branding.
- Performance-coaching aesthetic — strength training, sprinting, jumping, mobility, recovery, sport-specific drills. Adults unless the post is about youth development.
- Lighting: natural daylight, gym fluorescent, or stadium light. No moody fantasy lighting.
- Composition: medium-wide. Subject is identifiable but not portrait-style.

Output JSON shape (strict):
{
  "hero_prompt": "<single prompt for the post's cover image, ~30-50 words, premium image>",
  "inline_prompts": [
    { "section_h2": "<exact h2 text>", "prompt": "<prompt, ~25-40 words>" },
    ...
  ]
}

Rules:
- The hero prompt should evoke the post's overall theme.
- Each inline prompt must reference the specific section's content, not just the post topic.
- Use the EXACT h2 text supplied in the user message — do not paraphrase or generate new section names.
- If fewer qualifying sections are provided, emit fewer inline_prompts. Never invent sections.

Return ONLY the JSON object, no preamble.`

export interface ExtractImagePromptsInput {
  title: string
  content: string
  category: string
  qualifyingSections: string[]
}

export async function extractImagePrompts(input: ExtractImagePromptsInput): Promise<ImagePromptsResult> {
  const sectionList = input.qualifyingSections.length
    ? input.qualifyingSections.map((s) => `- ${s}`).join("\n")
    : "(none — emit empty inline_prompts array)"

  const userMessage = [
    `# POST`,
    `Title: ${input.title}`,
    `Category: ${input.category}`,
    "",
    `# QUALIFYING SECTIONS (use these exact strings as section_h2)`,
    sectionList,
    "",
    `# CONTENT (first 4000 chars)`,
    input.content.slice(0, 4000),
    "",
    `# INSTRUCTIONS`,
    `Generate one hero_prompt and one inline prompt per qualifying section. Use the exact h2 strings above for section_h2.`,
  ].join("\n")

  const result = await callAgent(SYSTEM_PROMPT, userMessage, imagePromptsSchema, {
    model: MODEL_SONNET,
    maxTokens: 2000,
  })

  // Filter inline_prompts to only those whose section_h2 matches a qualifying section.
  // This guards against the model hallucinating section names despite instructions.
  const allowed = new Set(input.qualifyingSections)
  const filteredInline = result.content.inline_prompts.filter((p) => allowed.has(p.section_h2))

  return {
    hero_prompt: result.content.hero_prompt,
    inline_prompts: filteredInline,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/ai/__tests__/image-prompts.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/image-prompts.ts functions/src/ai/__tests__/image-prompts.test.ts
git commit -m "feat(functions): add image-prompts extractor (Claude Sonnet)"
```

---

## Task 10: `blogGeneration` inserts blog_posts row, returns blog_post_id

**Files:**
- Modify: `functions/src/blog-generation.ts:248-394`

- [ ] **Step 1: Read current handler**

Read `functions/src/blog-generation.ts` lines 248–394 to confirm the structure (load job → process refs → call Claude → validate URLs → write `result` to ai_jobs).

- [ ] **Step 2: Modify the handler to insert blog_posts**

Update the success branch in `handleBlogGeneration` (around lines 379–383). Replace:

```ts
    await jobRef.update({
      status: "completed",
      result: finalResult,
      updatedAt: FieldValue.serverTimestamp(),
    })
```

with:

```ts
    // Step 4: Insert the blog_posts row directly so downstream listeners
    // (blog_image_generation, seo_enhance) have a target. Author is the
    // requesting userId; status is 'draft' until admin publishes.
    const supabase = getSupabase()
    const { data: insertedPost, error: insertErr } = await supabase
      .from("blog_posts")
      .insert({
        title: finalResult.title,
        slug: finalResult.slug,
        excerpt: finalResult.excerpt,
        content: finalResult.content,
        category: finalResult.category,
        cover_image_url: null,
        status: "draft",
        tags: finalResult.tags,
        meta_description: finalResult.meta_description,
        author_id: input.userId,
      })
      .select("id")
      .single()
    if (insertErr) {
      throw new Error(`blog_posts insert failed: ${insertErr.message}`)
    }
    const blogPostId = (insertedPost as { id: string }).id

    // Optionally link the source content_calendar row to the new blog post.
    // status enum is 'planned' | 'in_progress' | 'published' | 'cancelled' (see migration 00077);
    // we set 'in_progress' and populate reference_id with the new blog_post_id.
    if (input.sourceCalendarId) {
      await supabase
        .from("content_calendar")
        .update({
          status: "in_progress",
          reference_id: blogPostId,
        })
        .eq("id", input.sourceCalendarId)
    }

    await jobRef.update({
      status: "completed",
      result: { ...finalResult, blog_post_id: blogPostId },
      updatedAt: FieldValue.serverTimestamp(),
    })
```

Also update the `input` type at line 260–266:

```ts
    const input = job.input as {
      prompt: string
      tone?: string
      length?: string
      userId: string
      references?: UserReferences
      sourceCalendarId?: string  // NEW
    }
```

- [ ] **Step 3: Update the existing test**

Read `functions/src/__tests__/blog-generation.test.ts` (or create one if absent). Add/adjust to assert:
1. The handler inserts a row into `blog_posts`.
2. `ai_jobs.result.blog_post_id` is populated with the inserted ID.
3. When `input.sourceCalendarId` is supplied, `content_calendar` is updated.

If the test file does not exist, create `functions/src/__tests__/blog-generation.test.ts` with at minimum:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { FieldValue } from "firebase-admin/firestore"

const mockCallAgent = vi.fn()
const mockGetFirestore = vi.fn()
const mockGetSupabase = vi.fn()
const mockFetchResearchPapers = vi.fn().mockResolvedValue({ papers: [], source: "none", duration_ms: 0 })

vi.mock("../ai/anthropic.js", () => ({
  callAgent: mockCallAgent,
  MODEL_SONNET: "claude-sonnet-test",
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mockGetFirestore,
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: mockGetSupabase }))
vi.mock("../lib/research.js", () => ({
  fetchResearchPapers: mockFetchResearchPapers,
  formatResearchForPrompt: () => "",
}))

import { handleBlogGeneration } from "../blog-generation.js"

describe("handleBlogGeneration — insert flow", () => {
  let jobUpdate: ReturnType<typeof vi.fn>
  let blogInsert: ReturnType<typeof vi.fn>
  let blogInsertSelectSingle: ReturnType<typeof vi.fn>
  let calendarUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jobUpdate = vi.fn().mockResolvedValue(undefined)
    blogInsertSelectSingle = vi.fn().mockResolvedValue({ data: { id: "post-123" }, error: null })
    blogInsert = vi.fn(() => ({ select: () => ({ single: blogInsertSelectSingle }) }))
    calendarUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }))

    mockGetFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: vi
            .fn()
            .mockResolvedValueOnce({
              exists: true,
              data: () => ({
                status: "pending",
                input: {
                  prompt: "Test prompt",
                  tone: "professional",
                  length: "medium",
                  userId: "user-1",
                  sourceCalendarId: "cal-1",
                },
              }),
            })
            .mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) }),
          update: jobUpdate,
        }),
      }),
    })
    mockGetSupabase.mockReturnValue({
      from: (table: string) => {
        if (table === "blog_posts") return { insert: blogInsert }
        if (table === "content_calendar") return { update: calendarUpdate }
        if (table === "ai_generation_log") return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
        return {}
      },
    })
    mockCallAgent.mockResolvedValueOnce({
      content: {
        title: "T",
        slug: "t",
        excerpt: "Excerpt long enough to pass.",
        content: "<p>Body</p>",
        category: "Performance",
        tags: ["a", "b", "c"],
        meta_description: "desc",
      },
      tokens_used: 100,
    })
  })

  it("inserts blog_posts row and writes blog_post_id into ai_jobs.result", async () => {
    await handleBlogGeneration("job-1")
    expect(blogInsert).toHaveBeenCalledTimes(1)
    expect(blogInsertSelectSingle).toHaveBeenCalled()
    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall?.[0]?.result?.blog_post_id).toBe("post-123")
  })

  it("links content_calendar to new blog_post when sourceCalendarId is provided", async () => {
    await handleBlogGeneration("job-1")
    expect(calendarUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", reference_id: "post-123" }),
    )
  })
})
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/__tests__/blog-generation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog-generation.ts functions/src/__tests__/blog-generation.test.ts
git commit -m "feat(functions): blog-generation now inserts blog_posts and returns blog_post_id"
```

---

## Task 11: `blog-image-generation` handler

**Files:**
- Create: `functions/src/blog-image-generation.ts`
- Test: `functions/src/__tests__/blog-image-generation.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `functions/src/__tests__/blog-image-generation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExtractImagePrompts = vi.fn()
const mockGenerateFalImage = vi.fn()
const mockTranscodeAndUpload = vi.fn()
const mockGenerateAltText = vi.fn()
const mockGetFirestore = vi.fn()
const mockGetSupabase = vi.fn()

vi.mock("../ai/image-prompts.js", () => ({ extractImagePrompts: mockExtractImagePrompts }))
vi.mock("../lib/fal-client.js", () => ({ generateFalImage: mockGenerateFalImage }))
vi.mock("../lib/image-pipeline.js", () => ({ transcodeAndUpload: mockTranscodeAndUpload }))
vi.mock("../lib/image-alt-text.js", () => ({ generateAltText: mockGenerateAltText }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mockGetFirestore,
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: mockGetSupabase }))

import { handleBlogImageGeneration } from "../blog-image-generation.js"

describe("handleBlogImageGeneration", () => {
  let jobUpdate: ReturnType<typeof vi.fn>
  let postSelectSingle: ReturnType<typeof vi.fn>
  let postUpdate: ReturnType<typeof vi.fn>
  const longPara = `<p>${"word ".repeat(160)}</p>`

  beforeEach(() => {
    vi.clearAllMocks()
    jobUpdate = vi.fn().mockResolvedValue(undefined)
    postSelectSingle = vi.fn().mockResolvedValue({
      data: {
        id: "post-1",
        title: "Test",
        slug: "test-slug",
        content: `<h2>Section A</h2>${longPara}`,
        category: "Performance",
      },
      error: null,
    })
    postUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }))

    mockGetFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ input: { blog_post_id: "post-1" } }),
          }),
          update: jobUpdate,
        }),
      }),
    })
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: postSelectSingle }) }),
        update: postUpdate,
      }),
    })

    mockExtractImagePrompts.mockResolvedValue({
      hero_prompt: "hero prompt",
      inline_prompts: [{ section_h2: "Section A", prompt: "a prompt" }],
    })
    mockGenerateFalImage.mockResolvedValue({ buffer: Buffer.from("png"), mime: "image/png" })
    mockTranscodeAndUpload.mockImplementation(async ({ kind, sectionIdx }) => ({
      url: kind === "hero" ? "https://supa/x-hero.webp" : `https://supa/x-section-${sectionIdx}.webp`,
      width: kind === "hero" ? 1200 : 1024,
      height: kind === "hero" ? 630 : 576,
      path: kind === "hero" ? "x-hero.webp" : `x-section-${sectionIdx}.webp`,
    }))
    mockGenerateAltText.mockResolvedValue("Athlete training")
  })

  it("generates hero + inline images, uploads, splices, and updates blog_posts", async () => {
    await handleBlogImageGeneration("job-1")

    expect(mockExtractImagePrompts).toHaveBeenCalledTimes(1)
    expect(mockGenerateFalImage).toHaveBeenCalledTimes(2)
    expect(mockTranscodeAndUpload).toHaveBeenCalledTimes(2)
    expect(mockGenerateAltText).toHaveBeenCalledTimes(2)

    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_image_url: "https://supa/x-hero.webp",
        inline_images: expect.arrayContaining([
          expect.objectContaining({ url: "https://supa/x-section-1.webp", section_h2: "Section A" }),
        ]),
        content: expect.stringContaining('<img src="https://supa/x-section-1.webp"'),
      }),
    )

    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall).toBeDefined()
  })

  it("survives a single inline-image failure: hero proceeds, post is updated with cover only", async () => {
    mockGenerateFalImage
      .mockResolvedValueOnce({ buffer: Buffer.from("hero"), mime: "image/png" })
      .mockRejectedValueOnce(new Error("fal 503"))

    await handleBlogImageGeneration("job-1")

    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_image_url: "https://supa/x-hero.webp",
        inline_images: [],
      }),
    )
    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall?.[0]?.result?.failed_inline_count).toBe(1)
  })

  it("fails the job when hero generation fails", async () => {
    mockGenerateFalImage.mockRejectedValueOnce(new Error("fal 500 hero"))

    await handleBlogImageGeneration("job-1")

    const failedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "failed")
    expect(failedCall).toBeDefined()
    expect(failedCall?.[0]?.error).toContain("hero")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/blog-image-generation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `functions/src/blog-image-generation.ts`:

```ts
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { extractImagePrompts } from "./ai/image-prompts.js"
import { generateFalImage } from "./lib/fal-client.js"
import { transcodeAndUpload } from "./lib/image-pipeline.js"
import { generateAltText } from "./lib/image-alt-text.js"
import { findQualifyingSections, spliceInlineImages } from "./lib/html-splice.js"
import { getSupabase } from "./lib/supabase.js"

const HERO_MODEL = "fal-ai/flux-pro/v1.1"
const INLINE_MODEL = "fal-ai/flux/schnell"
const HERO_DIMS = { width: 1200, height: 630 }
const INLINE_DIMS = { width: 1024, height: 576 }

export interface BlogImageGenerationInput {
  blog_post_id: string
}

export interface InlineImageRecord {
  url: string
  alt: string
  prompt: string
  section_h2: string
  width: number
  height: number
}

export async function handleBlogImageGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    if (!snap.exists) {
      await failJob("ai_jobs doc missing")
      return
    }
    const data = snap.data()!
    const blogPostId = (data.input as BlogImageGenerationInput | undefined)?.blog_post_id
    if (!blogPostId) {
      await failJob("input.blog_post_id is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // Load the post
    const { data: post, error: postErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, content, category")
      .eq("id", blogPostId)
      .single()
    if (postErr || !post) {
      await failJob(`blog_posts row ${blogPostId} not found`)
      return
    }

    const slug = (post.slug as string) ?? "post"
    const html = (post.content as string) ?? ""

    // Find sections that qualify for inline images
    const qualifying = findQualifyingSections(html)
    const qualifyingTitles = qualifying.map((s) => s.h2Text)

    // Step 1: ask Claude for image prompts
    const prompts = await extractImagePrompts({
      title: post.title as string,
      content: html,
      category: (post.category as string) ?? "Performance",
      qualifyingSections: qualifyingTitles,
    })

    // Step 2: generate hero (must succeed) + inline (best-effort) in parallel
    const heroPromise = (async () => {
      const fal = await generateFalImage({
        model: HERO_MODEL,
        prompt: prompts.hero_prompt,
        ...HERO_DIMS,
      })
      const upload = await transcodeAndUpload({ buffer: fal.buffer, slug, kind: "hero" })
      const alt = await generateAltText(fal.buffer, fal.mime).catch(() =>
        prompts.hero_prompt.slice(0, 120),
      )
      return { url: upload.url, alt, width: upload.width, height: upload.height }
    })()

    const inlinePromises = prompts.inline_prompts.map(async (p, idx) => {
      const sectionIdx = idx + 1
      try {
        const fal = await generateFalImage({
          model: INLINE_MODEL,
          prompt: p.prompt,
          ...INLINE_DIMS,
        })
        const upload = await transcodeAndUpload({
          buffer: fal.buffer,
          slug,
          kind: "inline",
          sectionIdx,
        })
        const alt = await generateAltText(fal.buffer, fal.mime).catch(() =>
          p.prompt.slice(0, 120),
        )
        const record: InlineImageRecord = {
          url: upload.url,
          alt,
          prompt: p.prompt,
          section_h2: p.section_h2,
          width: upload.width,
          height: upload.height,
        }
        return { ok: true as const, record }
      } catch (err) {
        console.warn(
          `[blog-image-generation] inline section ${sectionIdx} (${p.section_h2}) failed:`,
          (err as Error).message,
        )
        return { ok: false as const, error: (err as Error).message }
      }
    })

    let hero: { url: string; alt: string; width: number; height: number }
    try {
      hero = await heroPromise
    } catch (err) {
      await failJob(`hero generation failed: ${(err as Error).message}`)
      return
    }

    const inlineResults = await Promise.all(inlinePromises)
    const successfulInline = inlineResults
      .filter((r): r is { ok: true; record: InlineImageRecord } => r.ok)
      .map((r) => r.record)
    const failedInlineCount = inlineResults.filter((r) => !r.ok).length

    // Step 3: splice <img> tags into the HTML
    const splicedContent = spliceInlineImages(
      html,
      successfulInline.map((r) => ({
        h2Text: r.section_h2,
        url: r.url,
        alt: r.alt,
        width: r.width,
        height: r.height,
      })),
    )

    // Step 4: write back to blog_posts
    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        cover_image_url: hero.url,
        content: splicedContent,
        inline_images: successfulInline,
      })
      .eq("id", blogPostId)
    if (updateErr) {
      await failJob(`blog_posts update failed: ${updateErr.message}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        cover_image_url: hero.url,
        inline_images: successfulInline,
        failed_inline_count: failedInlineCount,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown blog-image-generation error")
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/blog-image-generation.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog-image-generation.ts functions/src/__tests__/blog-image-generation.test.ts
git commit -m "feat(functions): add blog-image-generation handler (fal + sharp + alt text)"
```

---

## Task 12: `on-ai-job-completed` Firestore listener

**Files:**
- Create: `functions/src/on-ai-job-completed.ts`
- Test: `functions/src/__tests__/on-ai-job-completed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/__tests__/on-ai-job-completed.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSet = vi.fn()
const mockDoc = vi.fn(() => ({ set: mockSet, id: "new-job-id" }))
const mockCollection = vi.fn(() => ({ doc: mockDoc }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: mockCollection }),
  FieldValue: { serverTimestamp: () => "TS" },
}))

import { handleAiJobCompleted } from "../on-ai-job-completed.js"

function makeEvent(before: Record<string, unknown>, after: Record<string, unknown>) {
  return {
    data: {
      before: { exists: true, data: () => before },
      after: { exists: true, data: () => after },
    },
    params: { jobId: "parent-job" },
  }
}

describe("handleAiJobCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSet.mockResolvedValue(undefined)
  })

  it("enqueues blog_image_generation when blog_generation flips to completed", async () => {
    const event = makeEvent(
      { type: "blog_generation", status: "processing" },
      {
        type: "blog_generation",
        status: "completed",
        result: { blog_post_id: "post-123" },
        userId: "user-1",
      },
    )
    await handleAiJobCompleted(event as never)

    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "blog_image_generation",
        status: "pending",
        input: { blog_post_id: "post-123" },
        userId: "user-1",
      }),
    )
  })

  it("does NOT enqueue when type is not blog_generation", async () => {
    const event = makeEvent(
      { type: "newsletter_generation", status: "processing" },
      { type: "newsletter_generation", status: "completed", result: {} },
    )
    await handleAiJobCompleted(event as never)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("does NOT enqueue when status was already completed before", async () => {
    const event = makeEvent(
      { type: "blog_generation", status: "completed", result: { blog_post_id: "post-123" } },
      { type: "blog_generation", status: "completed", result: { blog_post_id: "post-123" } },
    )
    await handleAiJobCompleted(event as never)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("does NOT enqueue when blog_post_id is missing from result", async () => {
    const event = makeEvent(
      { type: "blog_generation", status: "processing" },
      { type: "blog_generation", status: "completed", result: {} },
    )
    await handleAiJobCompleted(event as never)
    expect(mockSet).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/on-ai-job-completed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the listener**

Create `functions/src/on-ai-job-completed.ts`:

```ts
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import type { Change, FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore"

interface JobShape {
  type?: string
  status?: string
  result?: { blog_post_id?: string } & Record<string, unknown>
  userId?: string
}

type AiJobUpdateEvent = FirestoreEvent<
  Change<QueryDocumentSnapshot> | undefined,
  { jobId: string }
>

/**
 * Fans out follow-up jobs after specific ai_jobs reach a terminal state.
 *
 * Phase 1 only handles: blog_generation completed → enqueue blog_image_generation.
 */
export async function handleAiJobCompleted(event: AiJobUpdateEvent): Promise<void> {
  const before = event.data?.before.data() as JobShape | undefined
  const after = event.data?.after.data() as JobShape | undefined
  if (!after) return

  // Only act on the transition into 'completed', not subsequent writes.
  if (before?.status === "completed") return
  if (after.status !== "completed") return

  if (after.type !== "blog_generation") return

  const blogPostId = after.result?.blog_post_id
  if (!blogPostId) {
    console.warn(`[on-ai-job-completed] blog_generation ${event.params.jobId} completed without blog_post_id`)
    return
  }

  const db = getFirestore()
  const newJobRef = db.collection("ai_jobs").doc()
  await newJobRef.set({
    type: "blog_image_generation",
    status: "pending",
    input: { blog_post_id: blogPostId },
    result: null,
    error: null,
    userId: after.userId ?? null,
    parentJobId: event.params.jobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log(
    `[on-ai-job-completed] Enqueued blog_image_generation ${newJobRef.id} for blog_post ${blogPostId}`,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/on-ai-job-completed.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/on-ai-job-completed.ts functions/src/__tests__/on-ai-job-completed.test.ts
git commit -m "feat(functions): add ai_jobs onUpdate listener for blog→image fanout"
```

---

## Task 13: Register new Functions and `FAL_KEY` secret in `index.ts`

**Files:**
- Modify: `functions/src/index.ts:5-21, 90-109`

- [ ] **Step 1: Add the new secret**

In `functions/src/index.ts`, after line 17 (`const tavilyApiKey = ...`), add:

```ts
const falKey = defineSecret("FAL_KEY")
```

- [ ] **Step 2: Add the new exports**

After the `blogGeneration` export (around line 109), add:

```ts
// ─── Blog Image Generation ──────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "blog_image_generation"
// Generates hero + inline images via fal.ai, mirrors to Supabase Storage,
// writes alt text, splices <img> tags into the post HTML.

export const blogImageGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey, falKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_image_generation") return

    const { handleBlogImageGeneration } = await import("./blog-image-generation.js")
    await handleBlogImageGeneration(event.params.jobId)
  },
)

// ─── ai_jobs onUpdate listener ──────────────────────────────────────────────
// Watches all ai_jobs docs and fans out follow-up jobs on terminal-state
// transitions (currently: blog_generation completed → blog_image_generation).

export const onAiJobCompleted = onDocumentUpdated(
  {
    document: "ai_jobs/{jobId}",
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const { handleAiJobCompleted } = await import("./on-ai-job-completed.js")
    await handleAiJobCompleted(event)
  },
)
```

- [ ] **Step 3: Add the import for `onDocumentUpdated`**

In `functions/src/index.ts` line 2, change:

```ts
import { onDocumentCreated } from "firebase-functions/v2/firestore"
```

to:

```ts
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore"
```

- [ ] **Step 4: Set the FAL_KEY secret in Firebase**

Run: `firebase functions:secrets:set FAL_KEY` and paste the fal.ai API key when prompted.
Expected: secret stored, available to functions on next deploy.

- [ ] **Step 5: Type-check**

Run: `cd functions && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat(functions): register blogImageGeneration + onAiJobCompleted with FAL_KEY"
```

---

## Task 14: Extend `seoEnhance` with `ImageObject` schema

**Files:**
- Modify: `functions/src/seo-enhance.ts:60-95, 99-206`

- [ ] **Step 1: Read current state**

Confirm `buildSeoPrompt` (lines 70–88) and `handleSeoEnhance` (99–206) by reading the file.

- [ ] **Step 2: Pull cover_image_url and inline_images into the prompt + schema**

In `seo-enhance.ts`, update the post fetch (line 129–132) to include `cover_image_url, inline_images`:

```ts
    const { data: postRow, error: postErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, content, tags, category, published_at, cover_image_url, inline_images")
      .eq("id", input.blog_post_id)
      .single()
```

Update `BuildSeoPromptParams` (around line 62–68):

```ts
interface BuildSeoPromptParams {
  title: string
  excerpt: string
  content: string
  tags: string[]
  category: string | null
  cover_image_url: string | null
  inline_images: Array<{ url: string; alt: string; width: number; height: number }>
}
```

Update `buildSeoPrompt` so the JSON-LD instruction enumerates the available images:

```ts
export function buildSeoPrompt(p: BuildSeoPromptParams): string {
  const tagLine = p.tags.length > 0 ? `Tags: ${p.tags.join(", ")}` : ""
  const catLine = p.category ? `Category: ${p.category}` : ""
  const heroLine = p.cover_image_url ? `Hero image URL: ${p.cover_image_url}` : ""
  const inlineLines = p.inline_images.length
    ? "Inline images:\n" + p.inline_images.map((i) => `  - ${i.url} (${i.width}x${i.height}, alt: ${i.alt})`).join("\n")
    : ""
  return [
    "# BLOG POST",
    `Title: ${p.title}`,
    `Excerpt: ${p.excerpt}`,
    tagLine,
    catLine,
    heroLine,
    inlineLines,
    "",
    "# CONTENT (first 4000 chars)",
    p.content.slice(0, 4000),
    "",
    "# INSTRUCTIONS",
    "Generate SEO metadata for this post. Output a JSON object with: meta_title (<=60 chars), meta_description (<=155 chars), keywords (5-10 lowercase), json_ld (schema.org Article object with at least @context, @type, headline, description, author { @type: Person, name: 'Darren Paul' }, datePublished, AND an `image` field — if a hero URL is provided above, use it; if inline images are provided, include them as an array of ImageObject with url, width, height, caption=alt).",
  ]
    .filter(Boolean)
    .join("\n")
}
```

Update the `buildSeoPrompt` call in `handleSeoEnhance` to pass the new fields:

```ts
    const seoPrompt = buildSeoPrompt({
      title: postRow.title as string,
      excerpt: (postRow.excerpt as string) ?? "",
      content: (postRow.content as string) ?? "",
      tags: (postRow.tags as string[]) ?? [],
      category: (postRow.category as string | null) ?? null,
      cover_image_url: (postRow.cover_image_url as string | null) ?? null,
      inline_images: ((postRow.inline_images as unknown) as Array<{
        url: string
        alt: string
        width: number
        height: number
      }>) ?? [],
    })
```

- [ ] **Step 3: Update existing seo-enhance test**

If `functions/src/__tests__/seo-enhance.test.ts` exists, update it to:
- Add `cover_image_url: "https://ex.com/h.webp"` and `inline_images: [...]` to mocked post row.
- Assert the user-message string passed to `callAgent` contains "Hero image URL:".

If the test doesn't already exist, skip — current behavior is covered by integration paths.

- [ ] **Step 4: Type-check + run tests**

Run: `cd functions && npm run build && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/seo-enhance.ts functions/src/__tests__/seo-enhance.test.ts
git commit -m "feat(functions): seo-enhance now includes ImageObject schema from cover + inline images"
```

---

## Task 15: Next.js API route — `generate-from-suggestion`

**Files:**
- Create: `app/api/admin/blog/generate-from-suggestion/route.ts`
- Test: `__tests__/api/admin/blog/generate-from-suggestion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/blog/generate-from-suggestion.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockGetCalendarEntryById = vi.fn()
const mockUpdateCalendarEntry = vi.fn()
const mockJobSet = vi.fn()
const mockJobDoc = vi.fn(() => ({ set: mockJobSet, id: "new-job-id" }))
const mockJobCollection = vi.fn(() => ({ doc: mockJobDoc }))
const mockGetAdminFirestore = vi.fn(() => ({ collection: mockJobCollection }))

vi.mock("@/lib/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/db/content-calendar", () => ({
  getCalendarEntryById: mockGetCalendarEntryById,
  updateCalendarEntry: mockUpdateCalendarEntry,
}))
vi.mock("@/lib/firebase-admin", () => ({ getAdminFirestore: mockGetAdminFirestore }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))

import { POST } from "@/app/api/admin/blog/generate-from-suggestion/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/blog/generate-from-suggestion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/blog/generate-from-suggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobSet.mockResolvedValue(undefined)
    mockUpdateCalendarEntry.mockResolvedValue({})
  })

  it("403 when not admin", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u1", role: "client" } })
    const res = await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(res.status).toBe(403)
  })

  it("400 when calendarId missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
  })

  it("404 when calendar entry missing or wrong type", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mockGetCalendarEntryById.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(res.status).toBe(404)
  })

  it("202 enqueues ai_jobs with sourceCalendarId and tavily_url reference", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mockGetCalendarEntryById.mockResolvedValueOnce({
      id: "cal-1",
      entry_type: "topic_suggestion",
      title: "RFD recovery",
      metadata: { tavily_url: "https://example.com/study", summary: "Study summary" },
      status: "planned",
    })
    const res = await POST(jsonRequest({ calendarId: "cal-1", tone: "professional", length: "medium" }))
    expect(res.status).toBe(202)
    expect(mockJobSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "blog_generation",
        status: "pending",
        input: expect.objectContaining({
          prompt: expect.stringContaining("RFD recovery"),
          tone: "professional",
          length: "medium",
          userId: "u1",
          sourceCalendarId: "cal-1",
          references: { urls: ["https://example.com/study"] },
        }),
      }),
    )
  })

  it("uses default tone/length when not provided", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mockGetCalendarEntryById.mockResolvedValueOnce({
      id: "cal-1",
      entry_type: "topic_suggestion",
      title: "x",
      metadata: {},
    })
    await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(mockJobSet).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ tone: "professional", length: "medium" }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/admin/blog/generate-from-suggestion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/blog/generate-from-suggestion/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { getCalendarEntryById } from "@/lib/db/content-calendar"

const requestSchema = z.object({
  calendarId: z.string().uuid().or(z.string().min(1)),
  tone: z.enum(["professional", "conversational", "motivational"]).optional().default("professional"),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
})

interface TopicMetadata {
  tavily_url?: string
  summary?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const userId = session.user.id

    const body = await request.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      )
    }
    const { calendarId, tone, length } = parsed.data

    const entry = await getCalendarEntryById(calendarId)
    if (!entry || entry.entry_type !== "topic_suggestion") {
      return NextResponse.json({ error: "Topic suggestion not found." }, { status: 404 })
    }

    const meta = (entry.metadata ?? {}) as TopicMetadata
    const promptLines = [entry.title, meta.summary].filter(Boolean).join("\n\n")
    const referenceUrls = meta.tavily_url ? [meta.tavily_url] : []

    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "blog_generation",
      status: "pending",
      input: {
        prompt: promptLines,
        tone,
        length,
        userId,
        sourceCalendarId: calendarId,
        ...(referenceUrls.length ? { references: { urls: referenceUrls } } : {}),
      },
      result: null,
      error: null,
      userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
  } catch (error) {
    console.error("[generate-from-suggestion]", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/admin/blog/generate-from-suggestion.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/blog/generate-from-suggestion/route.ts __tests__/api/admin/blog/generate-from-suggestion.test.ts
git commit -m "feat(api): add /api/admin/blog/generate-from-suggestion route"
```

---

## Task 16: "Generate post" button on TopicSuggestionsList

**Files:**
- Modify: `components/admin/topic-suggestions/TopicSuggestionsList.tsx:67-193`

- [ ] **Step 1: Add the new action handler**

Open `components/admin/topic-suggestions/TopicSuggestionsList.tsx`. Inside the `TopicSuggestionsList` component, after the existing `draftBlog` function (around line 226–230), add a new handler:

```ts
  async function generatePost(entry: ContentCalendarEntry) {
    try {
      const res = await fetch("/api/admin/blog/generate-from-suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId: entry.id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        alert(`Failed to enqueue: ${json.error ?? res.status}`)
        return
      }
      // Optimistic UX: send admin to the blog list; the post will appear as a draft when generation completes.
      router.push("/admin/blog?just_queued=1")
      router.refresh()
    } catch (err) {
      alert(`Network error: ${(err as Error).message}`)
    }
  }
```

- [ ] **Step 2: Wire `generatePost` through the component tree**

Update the `TopicCardProps` interface (around line 61–65):

```ts
interface TopicCardProps {
  entry: ContentCalendarEntry
  isHero: boolean
  draftBlog: (entry: ContentCalendarEntry) => void
  generatePost: (entry: ContentCalendarEntry) => Promise<void>
}
```

Pass `generatePost` to all `<TopicCard ... />` instances (4 call sites: search results, latest week, archive accordion).

- [ ] **Step 3: Add the button to TopicCard**

In the `TopicCard` action row (around lines 165–190), add a new button alongside "Draft blog":

```tsx
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-t border-border/40",
          isHero ? "px-5 py-3" : "px-4 py-2.5",
        )}
      >
        <button
          type="button"
          onClick={() => draftBlog(entry)}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="size-3.5" />
          Draft blog
        </button>
        <button
          type="button"
          onClick={() => generatePost(entry)}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 transition-colors"
          title="Generate full post + images via AI"
        >
          <Sparkles className="size-3.5" />
          Generate post
        </button>
        {meta.tavily_url && (
          <a
            href={meta.tavily_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline px-2 py-1.5"
          >
            <ExternalLink className="size-3" />
            Open source
          </a>
        )}
      </div>
```

- [ ] **Step 4: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/topic-suggestions/TopicSuggestionsList.tsx
git commit -m "feat(admin): add 'Generate post' button on topic suggestions"
```

---

## Task 17: Deploy and end-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all functions tests**

Run: `cd functions && npm test && cd ..`
Expected: PASS (all task tests + existing tests).

- [ ] **Step 2: Run all Next.js tests**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 3: Deploy Functions**

Run: `firebase deploy --only functions:blogGeneration,functions:blogImageGeneration,functions:onAiJobCompleted,functions:imageVision,functions:seoEnhance`
Expected: deployment succeeds, `FAL_KEY` secret bound to `blogImageGeneration`.

- [ ] **Step 4: Apply migration in production**

Run: `npx supabase db push --linked` (or apply `00095_blog_posts_inline_images.sql` via Supabase Studio).
Expected: column appears in production `blog_posts`.

- [ ] **Step 5: Manual end-to-end check (staging or prod)**

1. Log in as admin → navigate to `/admin/topic-suggestions`.
2. Pick any topic, click **Generate post**.
3. Within a few seconds the request returns 202; navigate to `/admin/blog`.
4. Wait ~60s. A new draft post should appear with a populated cover image and 1–3 inline images visible under long `<h2>` sections.
5. Open the post in the editor — confirm:
   - `cover_image_url` is a `https://...supabase.../blog-images/<slug>-hero.webp` URL.
   - Inline `<img>` tags appear in `content`.
   - `inline_images` JSON column has the matching records.
6. Publish the post → `seoEnhance` runs.
7. View the published post page; inspect `<head>` for `og:image` and JSON-LD `Article.image`. Confirm both reference the hero URL.
8. Run a Lighthouse mobile run on the published post; verify LCP < 2.5s.

- [ ] **Step 6: Final commit (no code changes — just verification record)**

If verification surfaces issues, fix in their owning task and recommit. Otherwise nothing to commit at this step.

---

## Self-review checklist (run after writing the plan)

- [x] Spec coverage — every spec section has a task:
  - D1 image plan → Task 11 (HERO_MODEL/INLINE_MODEL constants)
  - D2 storage scheme → Task 7 (image-pipeline)
  - D3 shared alt text → Tasks 4, 5
  - D4 HTML splice → Task 8
  - D5 image-prompts → Task 9
  - D6 trigger + listener → Tasks 12, 15, 16; behavioral change in Task 10
  - D7 graceful failure → Task 11 (test cases for hero failure vs inline failure)
  - D8 idempotency → Task 8 (idempotent splice test) + Task 7 (upsert: true)
  - D9 SEO ImageObject → Task 14
  - Migration → Task 1
  - Type/validator updates → Task 2
- [x] Placeholder scan — no TBDs, no "implement later", every code step has full code.
- [x] Type consistency — `BlogImageGenerationInput`, `InlineImageRecord`, `transcodeAndUpload` signatures, `extractImagePrompts` shape match across all tasks.
- [x] No references to undefined helpers — every imported symbol is defined in an earlier task.

---

## Phase 2 preview (out of scope here)

Once Phase 1 is in production and Darren wants bulk generation or per-image regeneration, Phase 2 will introduce a parent `blog_pipeline` ai_jobs doc with `childJobIds[]`, split inline image generation into one child job per image (true fan-out), and add per-stage `concurrency` + `maxInstances` tuning. Phase 2 spec to be written separately when triggered by volume.
