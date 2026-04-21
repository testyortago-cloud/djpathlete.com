import { describe, expect, it } from "vitest"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"

describe("defaultPublishTimeForPlatform", () => {
  it("returns a Date on the given day", () => {
    // Use a far-future day so the "never in past" guard doesn't kick in.
    const day = new Date("2099-04-20T00:00:00Z")
    const t = defaultPublishTimeForPlatform("instagram", day)
    expect(t.getUTCFullYear()).toBe(2099)
    expect(t.getUTCMonth()).toBe(3)
    expect(t.getUTCDate()).toBe(20)
  })

  it("Instagram defaults to 12:00 UTC", () => {
    const t = defaultPublishTimeForPlatform("instagram", new Date("2099-04-20T00:00:00Z"))
    expect(t.getUTCHours()).toBe(12)
  })

  it("TikTok defaults to 19:00 UTC", () => {
    const t = defaultPublishTimeForPlatform("tiktok", new Date("2099-04-20T00:00:00Z"))
    expect(t.getUTCHours()).toBe(19)
  })

  it("LinkedIn defaults to 09:00 UTC weekdays", () => {
    const t = defaultPublishTimeForPlatform("linkedin", new Date("2099-04-20T00:00:00Z"))
    expect(t.getUTCHours()).toBe(9)
  })

  it("never returns a time in the past — pushes forward if past", () => {
    const now = new Date()
    const day = new Date(now)
    day.setUTCHours(0, 0, 0, 0)
    const t = defaultPublishTimeForPlatform("instagram", day)
    expect(t.getTime()).toBeGreaterThan(now.getTime())
  })
})
