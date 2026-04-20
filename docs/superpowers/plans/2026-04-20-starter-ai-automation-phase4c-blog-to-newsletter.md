# Starter AI Automation — Phase 4c: Blog → Newsletter Auto-Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishing a blog post generates an AI-curated newsletter draft (rich HTML) in the `newsletters` table for admin approval. Also adds a "From blog post" tab to `NewsletterGenerateDialog` so drafts can be manually generated from any published post. Replaces the existing immediate blast from `sendBlogNewsletterToAll`.

**Architecture:** New `newsletterFromBlog` Firebase Function — reads blog, calls Claude via `callAgent`, inserts into `newsletters` with `source_blog_post_id` FK. Triggered from two entry points: (1) the existing blog publish route (auto) and (2) a new manual-trigger route called by the dialog. One new migration (00085) for the FK column. Dialog gets a tab strip mirroring 4b's BlogGenerateDialog pattern.

**Tech Stack:** Firebase Functions 2nd gen, Anthropic Claude via existing `callAgent(systemPrompt, userMessage, schema, options)` positional signature, Supabase service-role client, Vitest + @testing-library/react.

## Existing infrastructure this plan builds on (no changes)

- [functions/src/newsletter-generation.ts](../../../functions/src/newsletter-generation.ts) — existing prompt-based newsletter Function. Reference for prompt structure. NOT modified.
- [functions/src/ai/anthropic.ts](../../../functions/src/ai/anthropic.ts) — `callAgent` + `MODEL_SONNET`. Reused.
- [lib/ai-jobs.ts](../../../lib/ai-jobs.ts) — `newsletter_from_blog` type already in `AiJobType` union.
- [lib/db/newsletters.ts](../../../lib/db/newsletters.ts) — existing DAL with `createNewsletter`. We add `createDraftFromBlog` helper.
- [lib/db/blog-posts.ts](../../../lib/db/blog-posts.ts) — reused via `getBlogPostById`.
- [app/api/admin/blog/route.ts](../../../app/api/admin/blog/route.ts) — `GET /api/admin/blog?status=published` already supports status filter. Response is a bare array (not `{ posts: [...] }`) — clients handle accordingly.
- [components/admin/newsletter/NewsletterGenerateDialog.tsx](../../../components/admin/newsletter/NewsletterGenerateDialog.tsx) — existing dialog modified in Task 5 to add tabs.

---

## File Structure

### Supabase migration (new)

- `supabase/migrations/00085_newsletters_source_blog_post_id.sql` — adds `source_blog_post_id uuid REFERENCES blog_posts(id) ON DELETE SET NULL` + partial index.

### Types (modify)

- `types/database.ts` — add `source_blog_post_id: string | null` to `Newsletter` interface.

### Firebase Functions (new + modify)

- `functions/src/newsletter-from-blog.ts` — `handleNewsletterFromBlog(jobId)` orchestrator + pure helper `buildUserMessage({ post, tone, length })`.
- `functions/src/__tests__/newsletter-from-blog.test.ts` — 2 helper tests.
- `functions/src/index.ts` — register `newsletterFromBlog` export with type `newsletter_from_blog`.

### Next.js API routes (new + modify)

- `app/api/admin/newsletter/generate-from-blog/route.ts` (new) — `POST { blog_post_id, tone?, length? }` → `createAiJob` + 202.
- `app/api/admin/blog/[id]/publish/route.ts` (modify) — replace `sendBlogNewsletterToAll(...)` with `createAiJob({ type: "newsletter_from_blog", ... })`. Remove the `lib/email` import if it's unused elsewhere in the file.

### Next.js DAL (modify)

- `lib/db/newsletters.ts` — add `createDraftFromBlog({ subject, previewText, content, sourceBlogPostId, authorId })` helper.

### UI components (modify)

- `components/admin/newsletter/NewsletterGenerateDialog.tsx` — add "From prompt" / "From blog post" tabs, blog picker (list of published blogs), submit for blog mode.

### Tests (new)

- `functions/src/__tests__/newsletter-from-blog.test.ts` — 2 tests
- `__tests__/api/admin/newsletter/generate-from-blog.test.ts` — 4 tests
- `__tests__/api/admin/blog/publish.test.ts` — 3 tests (auto-trigger)
- `__tests__/components/newsletter-generate-dialog-from-blog.test.tsx` — 3 tests

---

## Tasks

### Task 1: Migration 00085 + Newsletter type update

**Files:**
- Create: `supabase/migrations/00085_newsletters_source_blog_post_id.sql`
- Modify: `types/database.ts` — add `source_blog_post_id` to `Newsletter` interface

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/00085_newsletters_source_blog_post_id.sql
-- Phase 4c — link auto-drafted newsletters back to the blog post that spawned them.

ALTER TABLE newsletters
  ADD COLUMN source_blog_post_id uuid REFERENCES blog_posts(id) ON DELETE SET NULL;

CREATE INDEX idx_newsletters_source_blog_post
  ON newsletters(source_blog_post_id)
  WHERE source_blog_post_id IS NOT NULL;
```

- [ ] **Step 2: Controller applies via Supabase MCP**

Controller (user/parent agent) runs this. Subagent should NOT attempt to apply. Just commit the SQL file.

- [ ] **Step 3: Update `types/database.ts`**

Find the `Newsletter` interface (around line 704). After `failed_count`, add:

```typescript
source_blog_post_id: string | null
```

No other changes.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -iE "newsletter" | head
```

Expected: no errors referencing `Newsletter`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00085_newsletters_source_blog_post_id.sql types/database.ts
git commit -m "feat(newsletter): add source_blog_post_id FK (migration 00085)"
```

---

### Task 2: `newsletterFromBlog` Firebase Function + DAL helper

**Files:**
- Create: `functions/src/newsletter-from-blog.ts`
- Create: `functions/src/__tests__/newsletter-from-blog.test.ts`
- Modify: `functions/src/index.ts` (register export)
- Modify: `lib/db/newsletters.ts` (add `createDraftFromBlog`)

- [ ] **Step 1: Add DAL helper**

In `lib/db/newsletters.ts`, add after `createNewsletter`:

```typescript
export async function createDraftFromBlog(params: {
  subject: string
  previewText: string
  content: string
  sourceBlogPostId: string
  authorId: string
}): Promise<Newsletter> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletters")
    .insert({
      subject: params.subject,
      preview_text: params.previewText,
      content: params.content,
      source_blog_post_id: params.sourceBlogPostId,
      author_id: params.authorId,
      status: "draft",
    })
    .select()
    .single()
  if (error) throw error
  return data as Newsletter
}
```

Note: `sent_count` and `failed_count` have DB defaults; `sent_at` is nullable. No other fields required.

- [ ] **Step 2: Write failing Function test**

File `functions/src/__tests__/newsletter-from-blog.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildUserMessage } from "../newsletter-from-blog.js"

describe("newsletter-from-blog helpers", () => {
  it("buildUserMessage embeds post title + excerpt + content + tone + length under clear headings", () => {
    const msg = buildUserMessage({
      post: {
        title: "Shoulder Rehab for Overhead Athletes",
        excerpt: "A 6-12 week framework for returning to throwing.",
        content: "<p>Scapular stabilization is the foundation.</p>",
        category: "Recovery",
        tags: ["shoulder", "rehab"],
      },
      tone: "conversational",
      length: "medium",
    })
    expect(msg).toContain("BLOG POST TITLE")
    expect(msg).toContain("Shoulder Rehab for Overhead Athletes")
    expect(msg).toContain("BLOG POST EXCERPT")
    expect(msg).toContain("6-12 week framework")
    expect(msg).toContain("BLOG POST CONTENT")
    expect(msg).toContain("Scapular stabilization")
    expect(msg).toMatch(/tone.*conversational/i)
    expect(msg).toMatch(/length.*medium/i)
  })

  it("buildUserMessage handles empty tags + missing category gracefully", () => {
    const msg = buildUserMessage({
      post: {
        title: "t",
        excerpt: "e",
        content: "<p>c</p>",
        category: null,
        tags: [],
      },
      tone: "professional",
      length: "short",
    })
    expect(msg).toContain("BLOG POST TITLE")
    expect(msg).not.toMatch(/tags:\s*\n\s*-/i)
  })
})
```

- [ ] **Step 3: Run → FAIL**

```bash
npm --prefix functions test -- newsletter-from-blog
```

Expected: module not found.

- [ ] **Step 4: Create `functions/src/newsletter-from-blog.ts`**

```typescript
// functions/src/newsletter-from-blog.ts
// Firebase Function: generate an AI newsletter draft from a published blog post.
// Triggered by ai_jobs docs with type "newsletter_from_blog".

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

export interface NewsletterFromBlogInput {
  blog_post_id: string
  tone?: "professional" | "conversational" | "motivational"
  length?: "short" | "medium" | "long"
}

interface BuildMessageParams {
  post: {
    title: string
    excerpt: string
    content: string
    category: string | null
    tags: string[]
  }
  tone: string
  length: string
}

export function buildUserMessage({ post, tone, length }: BuildMessageParams): string {
  const tagLines = post.tags.length > 0 ? `Tags:\n${post.tags.map((t) => `- ${t}`).join("\n")}` : ""
  const categoryLine = post.category ? `Category: ${post.category}` : ""

  return [
    "# BLOG POST TITLE",
    post.title,
    "",
    "# BLOG POST EXCERPT",
    post.excerpt,
    "",
    "# BLOG POST CONTENT",
    post.content,
    "",
    categoryLine,
    tagLines,
    "",
    "# INSTRUCTIONS",
    `Write a newsletter that distills the blog post above into an email readers will actually open. Tone: ${tone}. Length: ${length}. Do NOT just summarize — write a standalone email that teases + elaborates on the blog's key idea and links readers to the full article.`,
  ]
    .filter(Boolean)
    .join("\n")
}

const NEWSLETTER_FROM_BLOG_PROMPT = `You are an expert email copywriter for DJP Athlete. Given a blog post, write a standalone email newsletter that distills its key idea, entices subscribers to read the full post, and can stand on its own in an inbox.

Style: direct, personal, value-packed, concise. Open with a hook, use <h2> for 2-4 section breaks, end with a clear takeaway. Mix paragraphs and bullet lists for scannability.

HTML rules: ONLY <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">. No <h1>, no inline styles, no classes, no <br>.

Length guidelines:
- "short": ~200 words, 2 sections
- "medium": ~400 words, 3-4 sections
- "long": ~600 words, 4-5 sections

Output JSON with: subject (max 80 chars, no emoji spam), preview_text (max 120 chars), content (semantic HTML per the rules above).`

const NewsletterSchema = z.object({
  subject: z.string().max(200),
  preview_text: z.string().max(200),
  content: z.string(),
})

export async function handleNewsletterFromBlog(jobId: string): Promise<void> {
  const firestore = getFirestore()
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

    const input = data.input as NewsletterFromBlogInput
    if (!input?.blog_post_id) {
      await failJob("input.blog_post_id is required")
      return
    }

    const userId = (data.input.userId as string) ?? (data.userId as string)
    if (!userId) {
      await failJob("userId missing from ai_jobs input")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const supabase = getSupabase()
    const { data: postRow, error: postErr } = await supabase
      .from("blog_posts")
      .select("title, excerpt, content, category, tags")
      .eq("id", input.blog_post_id)
      .single()
    if (postErr || !postRow) {
      await failJob(`Blog post not found: ${postErr?.message ?? "missing"}`)
      return
    }

    const userMessage = buildUserMessage({
      post: {
        title: postRow.title as string,
        excerpt: (postRow.excerpt as string) ?? "",
        content: postRow.content as string,
        category: (postRow.category as string | null) ?? null,
        tags: (postRow.tags as string[]) ?? [],
      },
      tone: input.tone ?? "professional",
      length: input.length ?? "medium",
    })

    const result = await callAgent(NEWSLETTER_FROM_BLOG_PROMPT, userMessage, NewsletterSchema, {
      model: MODEL_SONNET,
    })

    const { data: inserted, error: insertErr } = await supabase
      .from("newsletters")
      .insert({
        subject: result.content.subject,
        preview_text: result.content.preview_text,
        content: result.content.content,
        source_blog_post_id: input.blog_post_id,
        author_id: userId,
        status: "draft",
      })
      .select("id, subject")
      .single()
    if (insertErr || !inserted) {
      await failJob(`Newsletter insert failed: ${insertErr?.message ?? "unknown"}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        newsletter_id: inserted.id,
        subject: inserted.subject,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown newsletter-from-blog error")
  }
}
```

- [ ] **Step 5: Register in `functions/src/index.ts`**

After the `blogFromVideo` export (added in Phase 4b Task 4), add:

```typescript
// ─── Newsletter From Blog ─────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "newsletter_from_blog"

export const newsletterFromBlog = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "newsletter_from_blog") return

    const { handleNewsletterFromBlog } = await import("./newsletter-from-blog.js")
    await handleNewsletterFromBlog(event.params.jobId)
  },
)
```

- [ ] **Step 6: Run tests + build**

```bash
npm --prefix functions test -- newsletter-from-blog
npm --prefix functions run build
```

Expected: 2 tests pass, build exits 0.

- [ ] **Step 7: Commit**

```bash
git add functions/src/newsletter-from-blog.ts functions/src/__tests__/newsletter-from-blog.test.ts functions/src/index.ts lib/db/newsletters.ts
git commit -m "feat(functions): newsletterFromBlog generates draft from published blog"
```

---

### Task 3: Manual-trigger route `/api/admin/newsletter/generate-from-blog`

**Files:**
- Create: `app/api/admin/newsletter/generate-from-blog/route.ts`
- Create: `__tests__/api/admin/newsletter/generate-from-blog.test.ts`

- [ ] **Step 1: Write failing test**

File `__tests__/api/admin/newsletter/generate-from-blog.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getBlogPostByIdMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
}))

import { POST } from "@/app/api/admin/newsletter/generate-from-blog/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/newsletter/generate-from-blog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/newsletter/generate-from-blog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ blog_post_id: "bp-1" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when blog_post_id missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when blog post not found", async () => {
    const notFound = Object.assign(new Error("not found"), { code: "PGRST116" })
    getBlogPostByIdMock.mockRejectedValue(notFound)
    const res = await POST(makeRequest({ blog_post_id: "bp-1" }))
    expect(res.status).toBe(404)
  })

  it("returns 202 and creates ai_job", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "t" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(makeRequest({ blog_post_id: "bp-1", tone: "conversational", length: "short" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "newsletter_from_blog",
      userId: "admin-1",
      input: { blog_post_id: "bp-1", tone: "conversational", length: "short" },
    })
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm run test:run -- __tests__/api/admin/newsletter/generate-from-blog.test.ts
```

- [ ] **Step 3: Create route**

File `app/api/admin/newsletter/generate-from-blog/route.ts`:

```typescript
// app/api/admin/newsletter/generate-from-blog/route.ts
// POST { blog_post_id, tone?, length? } — queues an AI newsletter draft generated from a blog post.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getBlogPostById } from "@/lib/db/blog-posts"

const ALLOWED_TONES = ["professional", "conversational", "motivational"] as const
const ALLOWED_LENGTHS = ["short", "medium", "long"] as const
type Tone = (typeof ALLOWED_TONES)[number]
type Length = (typeof ALLOWED_LENGTHS)[number]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    blog_post_id?: string
    tone?: string
    length?: string
  } | null
  const blogPostId = body?.blog_post_id
  if (!blogPostId) {
    return NextResponse.json({ error: "blog_post_id is required" }, { status: 400 })
  }
  const tone: Tone = (ALLOWED_TONES as readonly string[]).includes(body?.tone ?? "")
    ? (body!.tone as Tone)
    : "professional"
  const length: Length = (ALLOWED_LENGTHS as readonly string[]).includes(body?.length ?? "")
    ? (body!.length as Length)
    : "medium"

  try {
    await getBlogPostById(blogPostId)
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === "PGRST116") {
      return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
    }
    throw err
  }

  const { jobId, status } = await createAiJob({
    type: "newsletter_from_blog",
    userId: session.user.id,
    input: { blog_post_id: blogPostId, tone, length },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 4: Run → PASS**

```bash
npm run test:run -- __tests__/api/admin/newsletter/generate-from-blog.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/newsletter/generate-from-blog/route.ts __tests__/api/admin/newsletter/generate-from-blog.test.ts
git commit -m "feat(api): POST /api/admin/newsletter/generate-from-blog"
```

---

### Task 4: Modify blog publish route — replace blast with AI draft

**Files:**
- Modify: `app/api/admin/blog/[id]/publish/route.ts`
- Create: `__tests__/api/admin/blog/publish.test.ts`

- [ ] **Step 1: Write failing test**

File `__tests__/api/admin/blog/publish.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const createAiJobMock = vi.fn()
const sendBlogNewsletterToAllMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/email", () => ({ sendBlogNewsletterToAll: (x: unknown) => sendBlogNewsletterToAllMock(x) }))

import { POST } from "@/app/api/admin/blog/[id]/publish/route"

function ctx(id = "bp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/admin/blog/[id]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "t", published_at: null })
    updateBlogPostMock.mockResolvedValue({
      id: "bp-1",
      title: "t",
      slug: "t",
      excerpt: "e",
      category: "Performance",
      cover_image_url: null,
    })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })
  })

  it("creates a newsletter_from_blog ai_job with the blog post id", async () => {
    const res = await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(res.status).toBe(200)
    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "newsletter_from_blog",
      userId: "admin-1",
      input: { blog_post_id: "bp-1" },
    })
  })

  it("does NOT call the old sendBlogNewsletterToAll blast", async () => {
    await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(sendBlogNewsletterToAllMock).not.toHaveBeenCalled()
  })

  it("returns 200 even when createAiJob throws (fire-and-forget)", async () => {
    createAiJobMock.mockRejectedValueOnce(new Error("firestore unavailable"))
    const res = await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm run test:run -- __tests__/api/admin/blog/publish.test.ts
```

Expected: FAIL — the route currently calls `sendBlogNewsletterToAll` not `createAiJob`.

- [ ] **Step 3: Rewrite `app/api/admin/blog/[id]/publish/route.ts`**

Replace the file contents:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const post = await getBlogPostById(id)

    const updated = await updateBlogPost(id, {
      status: "published",
      published_at: post.published_at ?? new Date().toISOString(),
    })

    // Queue an AI-drafted newsletter for admin review (replaces the old plain blast).
    // Fire-and-forget: if queuing fails, publishing still succeeds.
    createAiJob({
      type: "newsletter_from_blog",
      userId: session.user.id,
      input: { blog_post_id: id },
    }).catch((err) => console.error("[Blog] newsletter_from_blog queue failed:", err))

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Blog publish error:", error)
    return NextResponse.json({ error: "Failed to publish post" }, { status: 500 })
  }
}
```

Note: fully removed the `sendBlogNewsletterToAll` import and call. The `createAiJob` call is NOT awaited (fire-and-forget) — we only hook a `.catch` to log failures so they don't bubble up as unhandled rejections. This matches today's `.catch()` pattern on the old blast.

- [ ] **Step 4: Run → PASS**

```bash
npm run test:run -- __tests__/api/admin/blog/publish.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Verify `lib/email.ts` still builds with `sendBlogNewsletterToAll` unreferenced**

```bash
grep -rn "sendBlogNewsletterToAll" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v ".next"
```

Expected: only the definition in `lib/email.ts` remains, no other callers. If any other file still imports it, flag — it should still work fine (it's an unused export now), but worth noting.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/blog/[id]/publish/route.ts __tests__/api/admin/blog/publish.test.ts
git commit -m "feat(blog): publish queues newsletter_from_blog instead of immediate blast"
```

---

### Task 5: NewsletterGenerateDialog — "From blog post" tab

**Files:**
- Modify: `components/admin/newsletter/NewsletterGenerateDialog.tsx`
- Create: `__tests__/components/newsletter-generate-dialog-from-blog.test.tsx`

- [ ] **Step 1: Read current `NewsletterGenerateDialog.tsx`**

Existing state: `prompt`, `tone`, `length`, `jobId`, `submitting`, `confirmed`, `elapsed`. Uses `useAiJob(jobId)` for polling.

- [ ] **Step 2: Write failing test**

File `__tests__/components/newsletter-generate-dialog-from-blog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({
    status: "pending", result: null, error: null, text: "", chunks: [],
    analysis: null, programCreated: null, messageId: null, activeTools: [], reset: vi.fn(),
  }),
}))

import { NewsletterGenerateDialog } from "@/components/admin/newsletter/NewsletterGenerateDialog"

describe("NewsletterGenerateDialog — From blog post tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/blog?status=published")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "bp-1", title: "Shoulder Rehab", published_at: "2026-04-01" },
            { id: "bp-2", title: "Knee Drills", published_at: "2026-03-28" },
          ],
        })
      }
      if (url === "/api/admin/newsletter/generate-from-blog") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ jobId: "job-1", status: "pending" }),
        })
      }
      return Promise.reject(new Error("unexpected url " + url))
    })
  })

  it("renders tabs and defaults to From prompt", () => {
    render(<NewsletterGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /from prompt/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /from blog post/i })).toBeInTheDocument()
  })

  it("switching to From blog post fetches published blogs and shows picker", async () => {
    render(<NewsletterGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from blog post/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/blog?status=published"))
    })
    expect(await screen.findByText(/shoulder rehab/i)).toBeInTheDocument()
  })

  it("submitting From blog post POSTs to /generate-from-blog", async () => {
    render(<NewsletterGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from blog post/i }))
    await screen.findByText(/shoulder rehab/i)
    fireEvent.click(screen.getByText(/shoulder rehab/i))
    fireEvent.click(screen.getByRole("button", { name: /generate from blog/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/newsletter/generate-from-blog",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })
})
```

- [ ] **Step 3: Run → FAIL**

```bash
npm run test:run -- __tests__/components/newsletter-generate-dialog-from-blog.test.tsx
```

- [ ] **Step 4: Modify `NewsletterGenerateDialog.tsx`**

Pattern mirrors 4b Task 7's `BlogGenerateDialog` changes. Add:

Imports at top (add to existing):
```typescript
import { useRouter } from "next/navigation"
```

State near existing state (after `elapsed`):
```typescript
const [mode, setMode] = useState<"prompt" | "blog">("prompt")
const [blogs, setBlogs] = useState<Array<{ id: string; title: string; published_at: string }>>([])
const [selectedBlogId, setSelectedBlogId] = useState<string | null>(null)
const router = useRouter()
```

Fetch effect:
```typescript
useEffect(() => {
  if (mode !== "blog" || !open) return
  let cancelled = false
  fetch("/api/admin/blog?status=published")
    .then((r) => r.json())
    .then((data: Array<{ id: string; title: string; published_at: string }>) => {
      // Route returns a bare array (not { posts })
      if (!cancelled) setBlogs(Array.isArray(data) ? data : [])
    })
    .catch(() => undefined)
  return () => {
    cancelled = true
  }
}, [mode, open])
```

JSX — tab strip at the top of `<DialogContent>`:
```tsx
<div className="flex border-b border-border mb-4">
  <button
    type="button"
    role="tab"
    onClick={() => setMode("prompt")}
    className={cn(
      "px-4 py-2 text-sm font-medium border-b-2",
      mode === "prompt" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
    )}
  >
    From prompt
  </button>
  <button
    type="button"
    role="tab"
    onClick={() => setMode("blog")}
    className={cn(
      "px-4 py-2 text-sm font-medium border-b-2",
      mode === "blog" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
    )}
  >
    From blog post
  </button>
</div>
```

Gate existing form body with `{mode === "prompt" && (...)}`. Add blog-mode branch:

```tsx
{mode === "blog" && (
  <div className="space-y-4">
    <div>
      <label className="text-sm font-medium">Pick a published blog post</label>
      <ul className="mt-2 border border-border rounded-md divide-y divide-border max-h-60 overflow-y-auto">
        {blogs.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">No published posts yet.</li>
        )}
        {blogs.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => setSelectedBlogId(b.id)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-surface/50",
                selectedBlogId === b.id && "bg-primary/5",
              )}
            >
              <div className="font-medium text-primary">{b.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(b.published_at).toLocaleDateString()}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>

    {/* Lift tone/length controls above both branches if not already (4b Task 7 pattern) */}

    <button
      type="button"
      disabled={!selectedBlogId}
      onClick={async () => {
        if (!selectedBlogId) return
        const res = await fetch("/api/admin/newsletter/generate-from-blog", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blog_post_id: selectedBlogId, tone, length }),
        })
        if (res.ok) {
          onOpenChange(false)
          router.push("/admin/newsletter")
        }
      }}
      className={cn(
        "w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-white font-medium",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      Generate from blog
    </button>
  </div>
)}
```

If `cn` isn't already imported, add `import { cn } from "@/lib/utils"` at the top.

**Lift tone/length decision:** if the existing prompt form has tone/length selectors inside it (most likely), lift them outside the `mode === "prompt"` block so both modes share them. If the existing code stores them in shared state (`tone`, `length` at component level), just move the JSX up without touching state.

- [ ] **Step 5: Run → PASS**

```bash
npm run test:run -- __tests__/components/newsletter-generate-dialog-from-blog.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/admin/newsletter/NewsletterGenerateDialog.tsx __tests__/components/newsletter-generate-dialog-from-blog.test.tsx
git commit -m "feat(ui): NewsletterGenerateDialog — From blog post tab + picker"
```

---

### Task 6: Post-Phase-4c verification

- [ ] **Step 1: Full Next.js test suite**

```bash
npm run test:run
```

Expected: 4c's new tests all pass. Pre-existing failures (~19 from 4a/4b baseline) unchanged. No NEW failures outside 4c's files.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Functions build + tests**

```bash
npm --prefix functions run build
npm --prefix functions test
```

Expected: both pass (52 + 2 new = 54 tests).

- [ ] **Step 4: Controller applies migration 00085 via Supabase MCP**

Handled by controller.

- [ ] **Step 5: Push branch**

```bash
git push origin feature/starter-ai-automation
```

- [ ] **Step 6: Deploy Firebase Function**

```bash
firebase deploy --only functions:newsletterFromBlog
```

- [ ] **Step 7: Smoke test**

1. Pick an existing draft blog post. Publish it.
2. Confirm subscribers do NOT receive the old plain blast (check the mailbox — should be silent).
3. Open `/admin/newsletter`. A new draft should appear within ~30s with AI-written subject + preview + content + `source_blog_post_id` set (check via Supabase — not surfaced in UI in 4c scope).
4. Open NewsletterGenerateDialog from the admin UI. Click "From blog post" tab. Pick a different published post. Submit. Confirm a second draft lands in the list.
5. Approve one draft and send via existing newsletter send flow — confirm subscribers receive the richer AI content.

---

## What Phase 4c Unblocks / Concludes

- **Phase 4d** weekly trending scan results → draft blog post → publish → auto-drafts a newsletter. One continuous content production loop.
- Future analytics can filter newsletters by `source_blog_post_id` for attribution.

---

## Self-Review

**Spec coverage:**
- ✅ Auto-draft on publish → Task 4
- ✅ Manual "From blog post" tab → Task 5
- ✅ `source_blog_post_id` FK → Task 1
- ✅ `newsletterFromBlog` Function → Task 2
- ✅ Manual route → Task 3
- ✅ Replace old blast → Task 4
- ✅ Tests: 2 + 4 + 3 + 3 = 12 new tests

**Placeholder scan:** no TODOs, every step has concrete code.

**Type consistency:** `Newsletter.source_blog_post_id: string | null` matches migration shape. Tone/length literals consistent between route (Task 3), Function (Task 2), and dialog (Task 5).

**Handoff checklist:**
- Task 1 migration applied by controller before Task 2 Function test — the Function insert references `source_blog_post_id`, but since it's nullable in the new column, inserts without it would still work. However the Supabase types/PostgREST still need the column to exist before Task 2 deploys.
- Task 2 DAL helper (`createDraftFromBlog`) is added but NOT called by the Function — the Function inlines the same INSERT. The DAL helper stays for future use. (This is intentional — the Function can't import from Next.js DAL anyway.)
- Task 4 publish route test mocks `sendBlogNewsletterToAll` to prove it's NOT called. This locks in the breaking change.
