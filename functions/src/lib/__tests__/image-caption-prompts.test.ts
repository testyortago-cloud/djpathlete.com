import { describe, expect, it } from "vitest"
import { buildCaptionPrompt, type CaptionPlatform } from "../image-caption-prompts.js"

describe("buildCaptionPrompt", () => {
  it("includes platform-specific instructions for instagram", () => {
    const p = buildCaptionPrompt("instagram", 1)
    expect(p).toMatch(/hashtags/i)
    expect(p).toMatch(/instagram/i)
  })

  it("includes carousel guidance when imageCount > 1", () => {
    const p = buildCaptionPrompt("instagram", 4)
    expect(p).toMatch(/swipe|sequence|progression/i)
  })

  it("includes no-hashtag rule for facebook", () => {
    const p = buildCaptionPrompt("facebook", 1)
    expect(p).toMatch(/no hashtags|without hashtags/i)
  })

  it("includes hook-first for tiktok", () => {
    const p = buildCaptionPrompt("tiktok", 1)
    expect(p).toMatch(/hook/i)
  })

  it("includes professional/longer-form for linkedin", () => {
    const p = buildCaptionPrompt("linkedin", 1)
    expect(p).toMatch(/professional|story|sentences/i)
  })

  it("requires JSON output in every platform's prompt", () => {
    const platforms: CaptionPlatform[] = ["instagram", "facebook", "tiktok", "linkedin"]
    for (const p of platforms) {
      expect(buildCaptionPrompt(p, 1)).toMatch(/JSON object/i)
    }
  })
})
