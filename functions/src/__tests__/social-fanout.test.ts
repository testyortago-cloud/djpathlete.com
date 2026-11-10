import { describe, it, expect } from "vitest"
import { buildUserMessage, buildReviewMessage, ensureVideoStory } from "../social-fanout.js"

/** Records every query; `existing` is what the story lookup returns. */
function fakeSupabase(existing: Array<{ id: string }>, opts: { insertError?: string } = {}) {
  const filters: Array<[string, string, unknown]> = []
  const inserts: unknown[] = []
  const lookup = {
    select: () => lookup,
    eq: (col: string, val: unknown) => (filters.push(["eq", col, val]), lookup),
    neq: (col: string, val: unknown) => (filters.push(["neq", col, val]), lookup),
    limit: async () => ({ data: existing, error: null }),
  }
  const client = {
    from: (table: string) => {
      expect(table).toBe("social_posts")
      return {
        ...lookup,
        insert: (row: unknown) => {
          inserts.push(row)
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: { message: opts.insertError } }
                  : { data: { id: "story-1" }, error: null },
            }),
          }
        },
      }
    },
  }
  return { client, filters, inserts }
}

describe("ensureVideoStory", () => {
  it("adds one Instagram story for the video, waiting for review", async () => {
    const { client, inserts, filters } = fakeSupabase([])
    expect(await ensureVideoStory(client as never, "vid-1")).toBe("story-1")
    expect(inserts).toEqual([
      { platform: "instagram", post_type: "story", content: "", approval_status: "draft", source_video_id: "vid-1" },
    ])
    expect(filters).toEqual([
      ["eq", "source_video_id", "vid-1"],
      ["eq", "post_type", "story"],
      ["neq", "approval_status", "rejected"],
    ])
  })

  it("adds nothing when the video already has a story (a fanout re-run)", async () => {
    const { client, inserts } = fakeSupabase([{ id: "old" }])
    expect(await ensureVideoStory(client as never, "vid-1")).toBeNull()
    expect(inserts).toEqual([])
  })

  it("answers null instead of throwing when the insert fails", async () => {
    const { client } = fakeSupabase([], { insertError: "boom" })
    expect(await ensureVideoStory(client as never, "vid-1")).toBeNull()
  })
})

describe("social-fanout helpers", () => {
  it("buildUserMessage embeds transcript + platform under clear headings", () => {
    const msg = buildUserMessage({
      transcript: "Today we're working the landmine press.",
      platform: "instagram",
      videoTitle: "Landmine Press",
    })
    expect(msg).toContain("Platform: instagram")
    expect(msg).toContain("Video title: Landmine Press")
    expect(msg).toContain("landmine press")
  })

  it("buildReviewMessage exposes writer rules, draft text, and hashtags to the reviewer", () => {
    const msg = buildReviewMessage({
      platform: "facebook",
      writerRules: "Hook on line 1, 120-250 words, no hashtags inside the body.",
      draft: {
        caption_text: "Coaches train you for perfect conditions...",
        hashtags: ["coaching", "athletes"],
      },
    })
    expect(msg).toContain("Platform: facebook")
    expect(msg).toContain("Writer rules")
    expect(msg).toContain("Hook on line 1")
    expect(msg).toContain("DRAFT caption_text")
    expect(msg).toContain("Coaches train you for perfect conditions")
    expect(msg).toContain("DRAFT hashtags: coaching, athletes")
  })

  it("buildReviewMessage shows '(none)' when the draft has no hashtags", () => {
    const msg = buildReviewMessage({
      platform: "tiktok",
      writerRules: "Short.",
      draft: { caption_text: "x", hashtags: [] },
    })
    expect(msg).toContain("DRAFT hashtags: (none)")
  })
})
