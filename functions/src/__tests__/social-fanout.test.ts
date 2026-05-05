import { describe, it, expect } from "vitest"
import { buildUserMessage, buildReviewMessage } from "../social-fanout.js"

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
