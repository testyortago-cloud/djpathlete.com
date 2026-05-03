import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCallAgent, mockGetFirestore, mockGetSupabase, mockFetchResearchPapers, mockLoadVoiceContext } = vi.hoisted(
  () => {
    return {
      mockCallAgent: vi.fn(),
      mockGetFirestore: vi.fn(),
      mockGetSupabase: vi.fn(),
      mockFetchResearchPapers: vi.fn().mockResolvedValue({ papers: [], source: "none", duration_ms: 0 }),
      mockLoadVoiceContext: vi.fn().mockResolvedValue({
        voiceProfile: "TEST_VOICE",
        blogStructure: "TEST_STRUCTURE",
        fewShots: [],
        usedFallback: { voice: false, structure: false },
      }),
    }
  },
)

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
vi.mock("../blog/voice-context.js", () => ({
  loadVoiceContext: mockLoadVoiceContext,
  composeBlogSystemPrompt: vi.fn(() => "COMPOSED_PROMPT"),
  formatFewShotsForUserMessage: vi.fn(() => ""),
}))

import { handleBlogGeneration } from "../blog-generation.js"

describe("handleBlogGeneration — insert flow", () => {
  let jobUpdate: ReturnType<typeof vi.fn>
  let blogInsert: ReturnType<typeof vi.fn>
  let blogInsertSelectSingle: ReturnType<typeof vi.fn>
  let calendarUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    // Restore mockLoadVoiceContext default after vi.clearAllMocks() wipes it.
    mockLoadVoiceContext.mockResolvedValue({
      voiceProfile: "TEST_VOICE",
      blogStructure: "TEST_STRUCTURE",
      fewShots: [],
      usedFallback: { voice: false, structure: false },
    })

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
                  register: "casual",
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
    mockFetchResearchPapers.mockResolvedValue({ papers: [], source: "none", duration_ms: 0 })
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

  it("loads voice context and uses the composed prompt as the system message", async () => {
    // Reuse the same fixtures the existing happy-path test uses (the beforeEach
    // sets up everything we need). Trigger one run, then check our mocks.
    mockCallAgent.mockResolvedValue({
      content: {
        title: "T",
        slug: "t",
        excerpt: "e",
        content: "<p>c</p>",
        category: "Performance",
        tags: ["a"],
        meta_description: "m",
      },
      tokens_used: 100,
    })
    await handleBlogGeneration("job-1")
    expect(mockLoadVoiceContext).toHaveBeenCalledTimes(1)
    expect(mockCallAgent).toHaveBeenCalledWith(
      "COMPOSED_PROMPT",
      expect.any(String),
      expect.anything(),
      expect.anything(),
    )
  })
})
