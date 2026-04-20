import { describe, it, expect } from "vitest"
import { buildUserMessage, resolveApprovalStatus } from "../social-fanout.js"

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

  it("resolveApprovalStatus returns awaiting_connection when plugin not in connected set", () => {
    const connected = new Set(["instagram", "facebook"])
    expect(resolveApprovalStatus("tiktok", connected)).toBe("awaiting_connection")
    expect(resolveApprovalStatus("instagram", connected)).toBe("draft")
    expect(resolveApprovalStatus("facebook", connected)).toBe("draft")
  })

  it("resolveApprovalStatus returns awaiting_connection when connected set empty", () => {
    expect(resolveApprovalStatus("instagram", new Set())).toBe("awaiting_connection")
  })
})
