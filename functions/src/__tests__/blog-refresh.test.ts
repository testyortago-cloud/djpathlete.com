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
            // The handler does a final update without `.select()` — accept that too.
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
