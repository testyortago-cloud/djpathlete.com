import { describe, it, expect } from "vitest"
import { buildUserMessage } from "../social-fanout.js"

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
})
