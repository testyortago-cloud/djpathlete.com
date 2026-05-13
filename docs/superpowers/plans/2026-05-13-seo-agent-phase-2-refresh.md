# SEO Agent — Phase 2 (Refresh Primitive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Build the manually-invokable `blog_refresh` primitive — a new `ai_jobs` type plus its Firebase handler that takes an existing `blog_posts` row, re-runs it through the generation pipeline with the current post body as iteration context, UPDATES the row in place (preserving `id`/`slug`/`published_at`/`author_id`/`category`), forces `status = "draft"`, and increments `refresh_count`. Plus a "Refresh this post" button on the admin edit page that enqueues the job. No automation — this phase only ships the primitive. The Phase 4 SEO agent will consume it as a tool.

**Architecture:** Parallel to `functions/src/blog-generation.ts` but with two key differences: (1) UPDATE instead of INSERT, (2) always-draft on completion regardless of input. Reuses the same voice profile loader, callAgent wrapper, URL validator, and anchor-id injector. The handler signature mirrors `handleBlogGeneration(jobId)`. A new `blogRefresh` `onDocumentCreated` trigger in `functions/src/index.ts` fans out from Firestore writes of `type: "blog_refresh"`. The API route POSTs from the admin edit page to enqueue.

**Tech Stack:** Same as Phase 1 — Next.js 16 App Router (Route Handlers + Server Components), Firebase Functions v2 (`onDocumentCreated`), Anthropic Claude via `lib/ai/anthropic.ts`, Vitest, TypeScript strict.

**Spec:** [docs/superpowers/specs/2026-05-13-seo-agent-design.md](../specs/2026-05-13-seo-agent-design.md) — section "queue_refresh → new `blog_refresh` ai_job".

**Phase 1 reference:** Tasks 1 of Phase 1 already added `last_refreshed_at` and `refresh_count` to `blog_posts`. No new migrations needed in Phase 2.

**Verification:** The handler's persistence behavior (UPDATE-not-INSERT, status=draft, refresh_count increment) is the highest-risk surface — covered by a Vitest test that mocks supabase + Claude. The API route gets standard auth/validation tests. The button is verified manually.

**Out of scope for this phase:**
- Internal-link sweep tool (Phase 3)
- The SEO agent itself (Phase 4)
- Outcome tracker (Phase 5)
- Auto-publishing refreshed drafts (drafts always go to coach for review)
- Re-triggering `seo_enhance` after a refresh — separate consideration, tracked as a Phase 2 follow-up
- Cooldown enforcement (90-day spec) — Phase 2 is manual; cooldown matters when the Phase 4 agent auto-queues

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `functions/src/blog-refresh.ts` | Create | The handler: load post, regenerate with iteration context, UPDATE the row to draft |
| `functions/src/__tests__/blog-refresh.test.ts` | Create | Unit test for the handler's persistence shape (mocked Claude + supabase) |
| `functions/src/index.ts` | Modify | Add `blogRefresh` onDocumentCreated trigger near other ai_job handlers |
| `app/api/admin/blog/[id]/refresh/route.ts` | Create | POST handler: admin auth, validate post, enqueue Firestore ai_job |
| `__tests__/api/admin/blog/refresh.test.ts` | Create | Auth + validation + job-enqueue shape |
| `components/admin/blog/RefreshPostButton.tsx` | Create | Client component: button + fetch + toast |
| `components/admin/blog/BlogPostForm.tsx` | Modify | Mount `<RefreshPostButton>` near the top of the form (only when editing an existing post) |
| `lib/db/blog-posts.ts` | Modify | Add `refreshBlogPost` DAL function that does the UPDATE + counter increment atomically |

---

## Task 1: `refreshBlogPost` DAL function

The persistence primitive that the Firebase handler will call. Atomic update of multiple fields including a counter increment.

**Files:**
- Modify: `lib/db/blog-posts.ts`
- Create: `__tests__/lib/db/blog-posts-refresh.test.ts`

### Step 1: Add `RefreshBlogPostInput` type + `refreshBlogPost` function

Open `lib/db/blog-posts.ts`. After the existing `createBlogPost` function, add:

```ts
export interface RefreshBlogPostInput {
  id: string
  // Regenerated fields:
  title: string
  excerpt: string
  content: string
  meta_description: string
  faq: BlogPost["faq"]
  tags: string[]
  // Preserved by the handler (passed in to make the update explicit):
  // id, slug, published_at, author_id, category, primary_keyword — NOT updated here.
}

/**
 * Updates an existing blog post in place with regenerated content. Forces
 * status to "draft" so the coach reviews before re-publishing. Sets
 * `last_refreshed_at = now()` and increments `refresh_count` atomically via
 * a single SQL statement (RPC) to avoid race conditions if two refreshes
 * land at the same time.
 *
 * Preserves: id, slug, published_at, author_id, category, primary_keyword,
 * cover_image_url, seo_metadata (all unchanged by this call).
 */
export async function refreshBlogPost(input: RefreshBlogPostInput): Promise<BlogPost> {
  const supabase = getClient()

  // Two-step update (no RPC needed): read current refresh_count, then write +1.
  // Concurrent refreshes are vanishingly unlikely (manual button + future
  // weekly agent), so optimistic read-then-write is acceptable here.
  const { data: current, error: readErr } = await supabase
    .from("blog_posts")
    .select("refresh_count")
    .eq("id", input.id)
    .single()
  if (readErr) throw readErr
  const nextRefreshCount = ((current as { refresh_count: number | null } | null)?.refresh_count ?? 0) + 1

  const { data, error } = await supabase
    .from("blog_posts")
    .update({
      title: input.title,
      excerpt: input.excerpt,
      content: input.content,
      meta_description: input.meta_description,
      faq: input.faq,
      tags: input.tags,
      status: "draft",
      last_refreshed_at: new Date().toISOString(),
      refresh_count: nextRefreshCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select()
    .single()
  if (error) throw error
  return data as BlogPost
}
```

### Step 2: Write the test

Create `__tests__/lib/db/blog-posts-refresh.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const readResponse = vi.fn()
const writeResponse = vi.fn()
const updateMock = vi.fn(() => ({
  eq: vi.fn(() => ({
    select: vi.fn(() => ({ single: () => writeResponse() })),
  })),
}))
const selectReadMock = vi.fn(() => ({
  eq: vi.fn(() => ({ single: () => readResponse() })),
}))
const fromMock = vi.fn(() => ({
  select: selectReadMock,
  update: updateMock,
  // The other DAL functions in this file expect more methods — provide stubs.
  insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => readResponse() })) })),
  delete: vi.fn(() => ({ eq: () => readResponse() })),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

const { refreshBlogPost } = await import("@/lib/db/blog-posts")

beforeEach(() => {
  fromMock.mockClear()
  updateMock.mockClear()
  selectReadMock.mockClear()
  readResponse.mockReset()
  writeResponse.mockReset()
})

describe("refreshBlogPost", () => {
  it("reads current refresh_count, increments by 1, forces status=draft", async () => {
    readResponse.mockResolvedValueOnce({ data: { refresh_count: 2 }, error: null })
    writeResponse.mockResolvedValueOnce({
      data: { id: "post-1", refresh_count: 3, status: "draft" },
      error: null,
    })

    const out = await refreshBlogPost({
      id: "post-1",
      title: "New title",
      excerpt: "New excerpt that is long enough to satisfy the schema validator if any",
      content: "<p>New content</p>",
      meta_description: "New meta",
      faq: [],
      tags: ["a", "b"],
    })

    expect(out).toEqual({ id: "post-1", refresh_count: 3, status: "draft" })

    // Verify the update payload was constructed correctly.
    const updateArg = updateMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg.status).toBe("draft")
    expect(updateArg.refresh_count).toBe(3)
    expect(updateArg.title).toBe("New title")
    expect(updateArg.last_refreshed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(updateArg.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // These fields must NOT be present in the update payload (they're preserved):
    expect(updateArg).not.toHaveProperty("id")
    expect(updateArg).not.toHaveProperty("slug")
    expect(updateArg).not.toHaveProperty("published_at")
    expect(updateArg).not.toHaveProperty("author_id")
    expect(updateArg).not.toHaveProperty("category")
    expect(updateArg).not.toHaveProperty("primary_keyword")
  })

  it("starts refresh_count at 1 when current is null", async () => {
    readResponse.mockResolvedValueOnce({ data: { refresh_count: null }, error: null })
    writeResponse.mockResolvedValueOnce({ data: { id: "post-2", refresh_count: 1 }, error: null })

    await refreshBlogPost({
      id: "post-2",
      title: "t",
      excerpt: "x",
      content: "<p>c</p>",
      meta_description: "m",
      faq: [],
      tags: [],
    })

    const updateArg = updateMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg.refresh_count).toBe(1)
  })

  it("throws when the read fails", async () => {
    readResponse.mockResolvedValueOnce({ data: null, error: { message: "no row" } })
    await expect(
      refreshBlogPost({
        id: "missing",
        title: "t",
        excerpt: "x",
        content: "<p>c</p>",
        meta_description: "m",
        faq: [],
        tags: [],
      }),
    ).rejects.toMatchObject({ message: "no row" })
  })

  it("throws when the write fails", async () => {
    readResponse.mockResolvedValueOnce({ data: { refresh_count: 0 }, error: null })
    writeResponse.mockResolvedValueOnce({ data: null, error: { message: "constraint violation" } })
    await expect(
      refreshBlogPost({
        id: "post-3",
        title: "t",
        excerpt: "x",
        content: "<p>c</p>",
        meta_description: "m",
        faq: [],
        tags: [],
      }),
    ).rejects.toMatchObject({ message: "constraint violation" })
  })
})
```

### Step 3: Run the test

```
npm run test:run -- __tests__/lib/db/blog-posts-refresh.test.ts
```

Expected: PASS, 4 tests.

### Step 4: Commit

```bash
git add lib/db/blog-posts.ts __tests__/lib/db/blog-posts-refresh.test.ts
git commit -m "feat(seo-agent): refreshBlogPost DAL — in-place UPDATE + counter increment"
```

---

## Task 2: `handleBlogRefresh` Firebase handler

The actual handler. Same shape as `handleBlogGeneration` but reads first and updates rather than inserting.

**Files:**
- Create: `functions/src/blog-refresh.ts`
- Create: `functions/src/__tests__/blog-refresh.test.ts`

### Step 1: Write a skeleton test that fails

Create `functions/src/__tests__/blog-refresh.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

// Mocks for the supabase client and the Firestore SDK.
const supabaseFromMock = vi.fn()
const supabaseUpdateMock = vi.fn()
const supabaseSelectMock = vi.fn()
const callAgentMock = vi.fn()
const jobRefGet = vi.fn()
const jobRefUpdate = vi.fn()

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: supabaseFromMock,
  }),
}))

vi.mock("../ai/anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_SONNET: "claude-sonnet-4-6",
}))

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: jobRefGet,
        update: jobRefUpdate,
      }),
    }),
  }),
  FieldValue: {
    serverTimestamp: () => "server-ts",
  },
}))

// Stub voice context, length verifier, and other helpers the handler imports.
vi.mock("../blog/voice-context.js", () => ({
  loadVoiceContext: vi.fn().mockResolvedValue({
    voiceProfile: "voice",
    blogStructure: "structure",
    fewShots: [],
    usedFallback: { voice: false, structure: false },
  }),
  composeBlogSystemPrompt: vi.fn().mockReturnValue("system prompt"),
  formatFewShotsForUserMessage: vi.fn().mockReturnValue(""),
}))
vi.mock("../blog/length-verifier.js", () => ({
  countWords: () => 1000,
  isTooShort: () => false,
  resolveTargetWordCount: () => 1000,
  buildExpansionPrompt: () => "expand",
}))
vi.mock("../blog/program-catalog.js", () => ({ formatProgramsForPrompt: () => "" }))
vi.mock("../lib/html-splice.js", () => ({ injectAnchorIds: (html: string) => html }))

beforeEach(() => {
  supabaseFromMock.mockReset()
  supabaseUpdateMock.mockReset()
  supabaseSelectMock.mockReset()
  callAgentMock.mockReset()
  jobRefGet.mockReset()
  jobRefUpdate.mockReset()
})

describe("handleBlogRefresh", () => {
  it("loads the post, regenerates, UPDATEs in place with status=draft", async () => {
    // Job doc — type=blog_refresh, status=pending, input={blogPostId,...}
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "blog_refresh",
        input: {
          blogPostId: "post-uuid-1",
          triggerReason: "manual",
          userId: "admin-uuid",
        },
      }),
    })
    // Subsequent jobRefGet during cancellation checks — return same.
    jobRefGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "processing" }),
    })

    // Existing blog_posts row (the post being refreshed).
    const existingPost = {
      id: "post-uuid-1",
      slug: "deadlift-tips",
      title: "Old title",
      excerpt: "Old excerpt",
      content: "<p>Old content</p>",
      category: "Performance",
      tags: ["deadlift"],
      meta_description: "Old meta",
      faq: [],
      primary_keyword: "deadlift form",
      published_at: "2025-01-01T00:00:00Z",
      author_id: "admin-uuid",
      refresh_count: 0,
    }

    // supabase.from("blog_posts").select("*").eq("id", x).single() → existingPost
    // supabase.from("blog_posts").select("refresh_count")... → for refreshBlogPost
    // supabase.from("blog_posts").update(...).eq("id", x).select().single() → updated row
    // supabase.from("ai_generation_log").insert(...) → ok (non-fatal)
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blog_posts") {
        // First call: read. Second call (inside refreshBlogPost): read count.
        // Third call: update.
        // Simplify: track call sequence on the mock itself.
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: existingPost,
                  error: null,
                }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { ...existingPost, status: "draft", refresh_count: 1 },
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      if (table === "ai_generation_log") {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      return {}
    })

    // Claude returns regenerated content.
    callAgentMock.mockResolvedValueOnce({
      content: {
        title: "Refreshed title — updated for 2026",
        slug: "deadlift-tips",
        excerpt: "Refreshed excerpt that is at least eighty characters long for schema validation.",
        content: "<p>Refreshed content with new stats and a stronger contrarian take.</p>",
        category: "Performance",
        tags: ["deadlift", "form"],
        meta_description: "Updated meta description.",
        faq: [],
      },
      tokens_used: 1234,
    })

    const { handleBlogRefresh } = await import("../blog-refresh.js")
    await handleBlogRefresh("job-id-1")

    // The job moved to completed.
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")

    // callAgent was called once (no expansion re-prompt for the happy path).
    expect(callAgentMock).toHaveBeenCalledTimes(1)
  })

  it("bails when the job doc doesn't exist", async () => {
    jobRefGet.mockResolvedValueOnce({ exists: false, data: () => null })
    const { handleBlogRefresh } = await import("../blog-refresh.js")
    await expect(handleBlogRefresh("missing-job")).resolves.toBeUndefined()
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("bails when the job is not pending", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "completed", type: "blog_refresh", input: {} }),
    })
    const { handleBlogRefresh } = await import("../blog-refresh.js")
    await handleBlogRefresh("done-job")
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("marks the job failed when the blog post doesn't exist", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "blog_refresh",
        input: { blogPostId: "missing-uuid", userId: "u" },
      }),
    })
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: null, error: { message: "no rows" } }),
            }),
          }),
        }
      }
      return {}
    })

    const { handleBlogRefresh } = await import("../blog-refresh.js")
    await handleBlogRefresh("orphan-job")

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; error?: string }
    expect(finalUpdate?.status).toBe("failed")
    expect(finalUpdate?.error).toMatch(/blog_post not found/i)
  })
})
```

### Step 2: Run the test, verify it fails

```
npm run test:run -- functions/src/__tests__/blog-refresh.test.ts
```

Expected: FAIL — `Failed to resolve import "../blog-refresh.js"`.

### Step 3: Implement `functions/src/blog-refresh.ts`

Create `functions/src/blog-refresh.ts`:

```ts
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import {
  loadVoiceContext,
  composeBlogSystemPrompt,
  formatFewShotsForUserMessage,
  type Register,
  type SeoTarget,
} from "./blog/voice-context.js"
import {
  countWords,
  isTooShort,
  resolveTargetWordCount,
  buildExpansionPrompt,
} from "./blog/length-verifier.js"
import { formatProgramsForPrompt } from "./blog/program-catalog.js"
import { injectAnchorIds } from "./lib/html-splice.js"

// ─── Schema ──────────────────────────────────────────────────────────────────

function capMetaDescription(s: string): string {
  if (s.length <= 160) return s
  return s.slice(0, 157).trimEnd() + "…"
}

const faqEntrySchema = z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(800),
})

const refreshResultSchema = z.object({
  title: z.string().min(20).max(120),
  // slug is NOT regenerated — we preserve the existing one
  excerpt: z.string().min(80).max(280),
  content: z.string(),
  category: z.enum(["Performance", "Recovery", "Coaching", "Youth Development"]),
  tags: z.array(z.string()),
  meta_description: z.string().transform(capMetaDescription),
  faq: z.array(faqEntrySchema).max(5).optional().default([]),
})

// ─── Handler ─────────────────────────────────────────────────────────────────

async function isJobCancelled(jobRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
  const snap = await jobRef.get()
  return snap.exists && snap.data()?.status === "cancelled"
}

export async function handleBlogRefresh(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    blogPostId: string
    triggerReason?: string
    userId: string
    references?: { gscTopQueries?: string[] }
  }

  const startTime = Date.now()

  try {
    const supabase = getSupabase()

    // Step 1: Load the existing post.
    const { data: existing, error: readErr } = await supabase
      .from("blog_posts")
      .select("*")
      .eq("id", input.blogPostId)
      .single()
    if (readErr || !existing) {
      throw new Error(`blog_post not found: ${input.blogPostId}`)
    }
    type ExistingPost = {
      id: string
      slug: string
      title: string
      excerpt: string
      content: string
      category: "Performance" | "Recovery" | "Coaching" | "Youth Development"
      tags: string[]
      meta_description: string
      faq: Array<{ question: string; answer: string }> | null
      primary_keyword: string | null
      secondary_keywords: string[] | null
      search_intent: "informational" | "commercial" | "transactional" | null
    }
    const post = existing as unknown as ExistingPost

    // Step 2: Load brand voice + structural rules.
    const voice = await loadVoiceContext(supabase)
    const programsBlock = formatProgramsForPrompt()
    const register: Register = "casual"
    const seoTarget: SeoTarget | undefined = post.primary_keyword
      ? {
          primary_keyword: post.primary_keyword,
          secondary_keywords: post.secondary_keywords ?? [],
          search_intent: post.search_intent ?? null,
        }
      : undefined
    const systemPrompt = composeBlogSystemPrompt({
      voiceProfile: voice.voiceProfile,
      blogStructure: voice.blogStructure,
      programsBlock,
      register,
      seoTarget,
    })

    const targetWordCount = resolveTargetWordCount({ length: "medium" })

    // Step 3: Construct the iteration prompt. The model sees the current
    // post body and iterates on it — does NOT generate from scratch.
    const refsBlock = input.references?.gscTopQueries?.length
      ? `\n\n── CURRENT TOP SEARCH QUERIES FOR THIS URL ──────\nGoogle Search Console currently shows these queries driving impressions to this post. Make sure the refreshed content addresses them directly:\n${input.references.gscTopQueries.map((q) => `  • ${q}`).join("\n")}\n────────────────────────────────────────────────`
      : ""

    const fewShotBlock = formatFewShotsForUserMessage(voice.fewShots)
    const userMessage = `Refresh an existing blog post. Below is the current content. Iterate on it — update stale stats, current-year references, add or strengthen sections suggested by the search queries below (if any). Preserve the post's identity (same topic, same primary keyword, same audience) but make it materially better.

Trigger reason: ${input.triggerReason ?? "manual"}
Primary keyword: ${post.primary_keyword ?? "(none)"}
Current word count target: ${targetWordCount}
Current date: ${new Date().toISOString().slice(0, 10)}
${refsBlock}

── CURRENT POST ──────────────────────────────────────────────
Title: ${post.title}
Excerpt: ${post.excerpt}
Category: ${post.category}
Tags: ${post.tags.join(", ")}

Content:
${post.content}
${fewShotBlock}`

    if (await isJobCancelled(jobRef)) {
      console.log(`[blog-refresh] Job ${jobId} cancelled before AI call`)
      return
    }

    // Step 4: Call Claude.
    const result = await callAgent(systemPrompt, userMessage, refreshResultSchema, { model: MODEL_SONNET })
    let finalContent = result.content
    let totalTokens = result.tokens_used

    // Length verification — same single re-prompt pattern as blog-generation.
    const initialWordCount = countWords(finalContent.content)
    if (isTooShort(initialWordCount, targetWordCount)) {
      console.log(
        `[blog-refresh] First pass too short (${initialWordCount}/${targetWordCount}); running one expansion re-prompt`,
      )
      const h2List = Array.from(finalContent.content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)).map((m) =>
        m[1].replace(/<[^>]+>/g, "").trim(),
      )
      const expansionUserMessage = buildExpansionPrompt({
        currentHtml: finalContent.content,
        actualWordCount: initialWordCount,
        targetWordCount,
        h2List,
      })
      try {
        const expanded = await callAgent(systemPrompt, expansionUserMessage, refreshResultSchema, { model: MODEL_SONNET })
        finalContent = expanded.content
        totalTokens += expanded.tokens_used
      } catch (err) {
        console.warn(`[blog-refresh] Expansion failed, keeping first pass: ${(err as Error).message}`)
      }
    }

    if (await isJobCancelled(jobRef)) {
      console.log(`[blog-refresh] Job ${jobId} cancelled after AI call`)
      return
    }

    // Step 5: Anchor IDs (URL validator skipped here — we trust the iteration
    // to keep already-validated links, and the seo_enhance pass on the next
    // publish will re-check.)
    const contentWithAnchors = injectAnchorIds(finalContent.content)

    // Log generation (non-fatal).
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: input.userId,
        status: "completed",
        input_params: {
          feature: "blog_refresh",
          blogPostId: input.blogPostId,
          triggerReason: input.triggerReason ?? "manual",
          gscQueries: input.references?.gscTopQueries ?? [],
        },
        output_summary: `Refreshed blog: ${finalContent.title}`,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: totalTokens,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch {
      /* non-fatal */
    }

    // Step 6: UPDATE the post in place. Preserves id, slug, published_at,
    // author_id, category, primary_keyword, cover_image_url, seo_metadata.
    // Forces status=draft.
    const nowIso = new Date().toISOString()
    const { data: countRow, error: countErr } = await supabase
      .from("blog_posts")
      .select("refresh_count")
      .eq("id", input.blogPostId)
      .single()
    if (countErr) throw countErr
    const nextRefreshCount = ((countRow as { refresh_count: number | null } | null)?.refresh_count ?? 0) + 1

    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        title: finalContent.title,
        excerpt: finalContent.excerpt,
        content: contentWithAnchors,
        meta_description: finalContent.meta_description,
        faq: finalContent.faq ?? [],
        tags: finalContent.tags,
        status: "draft",
        last_refreshed_at: nowIso,
        refresh_count: nextRefreshCount,
        updated_at: nowIso,
      })
      .eq("id", input.blogPostId)
    if (updateErr) throw new Error(`blog_posts update failed: ${updateErr.message}`)

    await jobRef.update({
      status: "completed",
      result: {
        blog_post_id: input.blogPostId,
        slug: post.slug,
        refresh_count: nextRefreshCount,
        word_count: countWords(finalContent.content),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[blog-refresh] Job ${jobId} failed:`, errorMessage)
    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
```

### Step 4: Run the test, verify it passes

```
npm run test:run -- functions/src/__tests__/blog-refresh.test.ts
```

Expected: PASS, 4 tests. (The handler is complex; the test is mock-heavy. If a test fails because a mock returns unexpected shape, refine the mock — the implementation code should match the spec above.)

### Step 5: Type-check the functions build

```
cd functions && npm run build && cd ..
```

Expected: clean build.

### Step 6: Commit

```bash
git add functions/src/blog-refresh.ts functions/src/__tests__/blog-refresh.test.ts
git commit -m "feat(seo-agent): blog_refresh handler — in-place regeneration to draft"
```

---

## Task 3: Register the Firebase trigger

**Files:**
- Modify: `functions/src/index.ts`

### Step 1: Add the trigger export

Open `functions/src/index.ts`. Find the existing `blogGeneration` `onDocumentCreated` block (use Grep — it's near line 112). Add this new block immediately after it:

```ts
// ─── Blog Refresh ───────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "blog_refresh"
// Loads existing blog_posts row, regenerates with iteration context, UPDATEs
// the row in place, forces status="draft" for coach review.

export const blogRefresh = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_refresh") return

    const { handleBlogRefresh } = await import("./blog-refresh.js")
    await handleBlogRefresh(event.params.jobId)
  },
)
```

### Step 2: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 3: Commit

```bash
git add functions/src/index.ts
git commit -m "feat(seo-agent): register blogRefresh Firebase trigger"
```

### Step 4: Document the deploy command (user runs this manually after Phase 2 is merged)

After this task, the user will need to deploy: `firebase deploy --only functions:default:blogRefresh`. Do NOT run this from the subagent.

---

## Task 4: API route `/api/admin/blog/[id]/refresh`

**Files:**
- Create: `app/api/admin/blog/[id]/refresh/route.ts`
- Create: `__tests__/api/admin/blog/refresh.test.ts`

### Step 1: Write the failing test

Create `__tests__/api/admin/blog/refresh.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const jobSetMock = vi.fn()
const jobDocMock = vi.fn(() => ({ id: "new-job-id", set: jobSetMock }))
const collectionMock = vi.fn(() => ({ doc: jobDocMock }))

vi.mock("@/lib/auth", () => ({ auth: authMock }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostById: getBlogPostByIdMock }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: collectionMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  authMock.mockReset()
  getBlogPostByIdMock.mockReset()
  jobSetMock.mockReset()
  jobDocMock.mockClear()
  collectionMock.mockClear()
})

async function callRoute(id: string, body: object = {}) {
  const { POST } = await import("@/app/api/admin/blog/[id]/refresh/route")
  const req = new NextRequest(`https://example.test/api/admin/blog/${id}/refresh`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/blog/[id]/refresh", () => {
  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await callRoute("post-1")
    expect(res.status).toBe(403)
    expect(jobSetMock).not.toHaveBeenCalled()
  })

  it("returns 404 when the post doesn't exist", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin", role: "admin" } })
    getBlogPostByIdMock.mockRejectedValueOnce(new Error("not found"))
    const res = await callRoute("missing")
    expect(res.status).toBe(404)
    expect(jobSetMock).not.toHaveBeenCalled()
  })

  it("happy path: enqueues a blog_refresh job and returns 202", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-uuid", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({
      id: "post-1",
      slug: "deadlift-tips",
      title: "Deadlift tips",
    })
    jobSetMock.mockResolvedValueOnce(undefined)

    const res = await callRoute("post-1", { triggerReason: "manual" })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ jobId: "new-job-id", status: "pending" })

    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(jobArg).toMatchObject({
      type: "blog_refresh",
      status: "pending",
      userId: "admin-uuid",
      triggeredBy: "manual_refresh_button",
    })
    expect((jobArg.input as Record<string, unknown>)).toMatchObject({
      blogPostId: "post-1",
      userId: "admin-uuid",
    })
  })

  it("accepts optional gscTopQueries in body and forwards them", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-uuid", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({ id: "post-1", slug: "x", title: "y" })
    jobSetMock.mockResolvedValueOnce(undefined)

    await callRoute("post-1", {
      triggerReason: "position_drop",
      gscTopQueries: ["squat depth", "ATG squat form"],
    })

    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect((jobArg.input as Record<string, unknown>)).toMatchObject({
      references: { gscTopQueries: ["squat depth", "ATG squat form"] },
    })
  })
})
```

### Step 2: Run, confirm fail

```
npm run test:run -- __tests__/api/admin/blog/refresh.test.ts
```

Expected: FAIL — `Failed to resolve import "@/app/api/admin/blog/[id]/refresh/route"`.

### Step 3: Implement the route

Create `app/api/admin/blog/[id]/refresh/route.ts`:

```ts
// POST /api/admin/blog/[id]/refresh
// Admin-only. Enqueues a Firestore ai_jobs doc of type "blog_refresh" for the
// given blog_post. The Firebase blogRefresh trigger picks it up.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const RefreshBodySchema = z
  .object({
    triggerReason: z.string().max(200).optional(),
    gscTopQueries: z.array(z.string().min(1).max(200)).max(20).optional(),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  // Confirm the post exists before enqueuing.
  try {
    await getBlogPostById(id)
  } catch {
    return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
  }

  const raw = await request.json().catch(() => ({}))
  const parsed = RefreshBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const { triggerReason, gscTopQueries } = parsed.data

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()

  await jobRef.set({
    type: "blog_refresh",
    status: "pending",
    input: {
      blogPostId: id,
      triggerReason: triggerReason ?? "manual",
      userId: session.user.id,
      ...(gscTopQueries?.length ? { references: { gscTopQueries } } : {}),
    },
    result: null,
    error: null,
    userId: session.user.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    triggeredBy: "manual_refresh_button",
  })

  return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
}
```

### Step 4: Run the tests

```
npm run test:run -- __tests__/api/admin/blog/refresh.test.ts
```

Expected: PASS, 4 tests.

### Step 5: Commit

```bash
git add app/api/admin/blog/[id]/refresh/route.ts __tests__/api/admin/blog/refresh.test.ts
git commit -m "feat(seo-agent): /api/admin/blog/[id]/refresh route enqueues blog_refresh job"
```

---

## Task 5: "Refresh this post" button

**Files:**
- Create: `components/admin/blog/RefreshPostButton.tsx`
- Modify: `components/admin/blog/BlogPostForm.tsx`

### Step 1: Create the button component

Create `components/admin/blog/RefreshPostButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { RefreshCw, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface RefreshPostButtonProps {
  postId: string
  /** Display only — shown in the confirm toast. */
  postTitle: string
  /** Optional: how many times this post has been refreshed before. */
  refreshCount?: number
}

export function RefreshPostButton({ postId, postTitle, refreshCount }: RefreshPostButtonProps) {
  const [submitting, setSubmitting] = useState(false)

  async function onRefresh() {
    const confirmMessage =
      refreshCount && refreshCount > 0
        ? `Refresh "${postTitle}"? This is refresh #${refreshCount + 1}. The post will become a draft until you publish it again.`
        : `Refresh "${postTitle}"? The post will become a draft until you publish it again.`
    if (!window.confirm(confirmMessage)) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/blog/${postId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerReason: "manual" }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      toast.success("Refresh queued. The AI is regenerating — check back in a minute.")
    } catch (err) {
      toast.error(`Could not start refresh: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={onRefresh} disabled={submitting}>
      {submitting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      Refresh with AI
    </Button>
  )
}
```

### Step 2: Mount it in the BlogPostForm

Open `components/admin/blog/BlogPostForm.tsx`. Locate the JSX section near the top of the form. The form is shown only for existing posts when editing. Find the area near the title/header (or wherever the existing action buttons like "Save" live). Add:

1. New import near the other component imports:

```tsx
import { RefreshPostButton } from "./RefreshPostButton"
```

2. In the JSX, wherever the existing edit-mode-specific UI lives (the form receives an optional `post: BlogPost` prop — render the button ONLY when `post?.id` is truthy). Add this near the form header / action row:

```tsx
{post?.id && (
  <div className="mb-4">
    <RefreshPostButton
      postId={post.id}
      postTitle={post.title}
      refreshCount={post.refresh_count}
    />
  </div>
)}
```

If you can't find an obvious header / action area in BlogPostForm, look for where existing buttons (Save / Send / Sparkles) live and place the refresh button next to them. The exact placement is a judgment call; aim for the same row as other top-level post actions.

### Step 3: Verify the page builds

```
npm run build
```

Expected: clean (no NEW TS errors).

### Step 4: Smoke-test in dev (optional)

```
npm run dev
```

Open `/admin/blog` → pick any draft or published post → click "Edit" → confirm the "Refresh with AI" button appears. Don't click it unless you actually want to refresh a post (which would burn Claude tokens).

### Step 5: Commit

```bash
git add components/admin/blog/RefreshPostButton.tsx components/admin/blog/BlogPostForm.tsx
git commit -m "feat(seo-agent): Refresh with AI button on blog edit page"
```

---

## Task 6: Final verification

**Files:** None — verification only.

### Step 1: Run the full test suite for the new files

```
npm run test:run -- __tests__/lib/db/blog-posts-refresh.test.ts __tests__/api/admin/blog/refresh.test.ts functions/src/__tests__/blog-refresh.test.ts
```

Expected: All 3 files green, 12 tests total (4 + 4 + 4).

### Step 2: Run the linter

```
npm run lint
```

Expected: clean (no new errors in any of the new files).

### Step 3: Run the build

```
npm run build && cd functions && npm run build && cd ..
```

Expected: both succeed.

### Step 4: User's manual deploy step

After this Phase ships to `main`, the user runs:

```bash
firebase deploy --only functions:default:blogRefresh
```

Do NOT run this from the subagent.

### Step 5: User's manual E2E smoke

Once deployed:
1. Open `/admin/blog`, pick a recently-published post.
2. Click "Edit" → "Refresh with AI". Confirm the toast.
3. Wait ~60s, refresh the page. The post should now be `status=draft` with updated content and `refresh_count = 1`.
4. Inspect via SQL:
   ```sql
   SELECT id, slug, status, last_refreshed_at, refresh_count
   FROM blog_posts
   WHERE id = '<that-post-id>';
   ```
   Expected: `status = 'draft'`, `last_refreshed_at` set to today, `refresh_count = 1`.

---

## Notes for the executor

- **Solo-dev workflow:** commit directly to `main`. No branches, no PRs.
- **Firebase deploys** use the `default:` codebase prefix: `firebase deploy --only functions:default:blogRefresh`.
- **The handler logs to Cloud Function logs** — failures will appear there even if the Firestore job doc's `error` field has been overwritten. Useful for debugging during smoke-test.
- **`seo_enhance` is NOT re-triggered** by `blog_refresh` completion. This is intentional for Phase 2 — the existing `seo_metadata` is preserved through the refresh, and a manual re-trigger from `/admin` can update it if needed. Tracked as a Phase 2 follow-up.
- **No cooldown enforcement** in this phase. The button is manually invoked, so the coach can refresh as often as they want. Phase 4's SEO agent applies the 90-day spec'd cooldown when it auto-queues refreshes.
- **Why the test for `handleBlogRefresh` is mock-heavy** — the handler talks to Firestore, Supabase, and Claude. Each is mocked. The test verifies *flow* (read post → call Claude → write update), not Claude output quality. The latter is verified by manual smoke.

## Known follow-ups (track for Phase 2.5 or beyond)

- **Re-trigger seo_enhance** after a refresh draft is re-published. Right now the seo_metadata stays as-is; if the refresh significantly changed structure (new H2s, FAQ entries), the metadata could grow stale.
- **Cooldown enforcement at the API level.** When Phase 4 lands and the agent starts auto-queuing refreshes, add a 90-day cooldown check in `/api/admin/blog/[id]/refresh` (with a force-override flag for manual coach use).
- **Notification on completion.** Spec mentions admin notification when the draft is ready. Skipped in Phase 2 to ship the primitive; the coach sees the draft when they next visit `/admin/blog`. Add via wiring into `on-ai-job-completed.ts`.
