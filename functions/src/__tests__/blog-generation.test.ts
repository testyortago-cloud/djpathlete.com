import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCallAgent,
  mockGetFirestore,
  mockGetSupabase,
  mockFetchResearchPapers,
  mockLoadVoiceContext,
  mockComposeBlogSystemPrompt,
  mockCountWords,
  mockIsTooShort,
} = vi.hoisted(() => {
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
    mockComposeBlogSystemPrompt: vi.fn(() => "COMPOSED_PROMPT"),
    mockCountWords: vi.fn(() => 1000),
    mockIsTooShort: vi.fn(() => false),
  }
})

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
  composeBlogSystemPrompt: mockComposeBlogSystemPrompt,
  formatFewShotsForUserMessage: vi.fn(() => ""),
}))

vi.mock("../blog/length-verifier.js", () => ({
  countWords: mockCountWords,
  isTooShort: mockIsTooShort,
  resolveTargetWordCount: vi.fn(() => 1000),
  buildExpansionPrompt: vi.fn(() => "EXPANSION_PROMPT"),
  LENGTH_PRESETS: { short: 500, medium: 1000, long: 1500 },
}))

import { handleBlogGeneration } from "../blog-generation.js"

describe("handleBlogGeneration — insert flow", () => {
  let jobUpdate: ReturnType<typeof vi.fn>
  let blogInsert: ReturnType<typeof vi.fn>
  let blogInsertSelectSingle: ReturnType<typeof vi.fn>
  let calendarUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    // Restore mock defaults after vi.clearAllMocks() wipes them.
    mockLoadVoiceContext.mockResolvedValue({
      voiceProfile: "TEST_VOICE",
      blogStructure: "TEST_STRUCTURE",
      fewShots: [],
      usedFallback: { voice: false, structure: false },
    })
    mockComposeBlogSystemPrompt.mockReturnValue("COMPOSED_PROMPT")
    mockCountWords.mockReturnValue(1000)
    mockIsTooShort.mockReturnValue(false)

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
                  primary_keyword: "youth pitching velocity",
                  secondary_keywords: ["arm care"],
                  search_intent: "informational",
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
    expect(blogInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        primary_keyword: "youth pitching velocity",
        secondary_keywords: ["arm care"],
        search_intent: "informational",
      }),
    )
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

  it("does NOT re-prompt when first pass meets target word count", async () => {
    mockCountWords.mockReturnValue(1000)
    mockIsTooShort.mockReturnValue(false)
    mockCallAgent.mockResolvedValue({
      content: {
        title: "T",
        slug: "t",
        excerpt: "e",
        content: "<p>1000-word draft</p>",
        category: "Performance",
        tags: ["a"],
        meta_description: "m",
      },
      tokens_used: 100,
    })
    await handleBlogGeneration("job-1")
    expect(mockCallAgent).toHaveBeenCalledTimes(1)
  })

  it("runs ONE expansion re-prompt when first pass is too short", async () => {
    mockIsTooShort.mockReturnValueOnce(true)
    mockCountWords
      .mockReturnValueOnce(600)
      .mockReturnValueOnce(1100)

    const baseDraft = {
      title: "T",
      slug: "t",
      excerpt: "e",
      content: "<p>short</p>",
      category: "Performance" as const,
      tags: ["a"],
      meta_description: "m",
    }

    mockCallAgent
      .mockResolvedValueOnce({ content: baseDraft, tokens_used: 100 })
      .mockResolvedValueOnce({
        content: { ...baseDraft, content: "<p>expanded much longer draft</p>" },
        tokens_used: 200,
      })

    await handleBlogGeneration("job-1")
    expect(mockCallAgent).toHaveBeenCalledTimes(2)
    expect(mockCallAgent).toHaveBeenNthCalledWith(2, "COMPOSED_PROMPT", "EXPANSION_PROMPT", expect.anything(), expect.anything())
  })

  it("does NOT re-prompt twice even if expansion still too short", async () => {
    mockIsTooShort.mockReturnValue(true)
    mockCountWords.mockReturnValue(700)
    mockCallAgent.mockResolvedValue({
      content: {
        title: "T",
        slug: "t",
        excerpt: "e",
        content: "<p>still short</p>",
        category: "Performance",
        tags: ["a"],
        meta_description: "m",
      },
      tokens_used: 100,
    })
    await handleBlogGeneration("job-1")
    expect(mockCallAgent).toHaveBeenCalledTimes(2)
  })

  it("injects anchor ids on h2s and persists faq from the AI response", async () => {
    mockIsTooShort.mockReturnValue(false)
    mockCountWords.mockReturnValue(1000)
    mockCallAgent.mockReset()
    mockCallAgent.mockResolvedValue({
      content: {
        title: "T",
        slug: "t",
        excerpt: "e",
        content: "<h2>First Section</h2><p>x</p><h2>Second Section</h2>",
        category: "Performance",
        tags: ["a"],
        meta_description: "m",
        faq: [
          { question: "How long does it take?", answer: "It takes about 8 weeks to see results." },
          { question: "Is it safe for youth?", answer: "Yes — when supervised by a qualified coach." },
          { question: "Do I need equipment?", answer: "Bodyweight is enough for the first 4 weeks." },
        ],
      },
      tokens_used: 100,
    })
    await handleBlogGeneration("job-1")

    expect(blogInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('<h2 id="first-section">'),
        faq: expect.arrayContaining([
          expect.objectContaining({ question: "How long does it take?" }),
        ]),
      }),
    )
  })
})
