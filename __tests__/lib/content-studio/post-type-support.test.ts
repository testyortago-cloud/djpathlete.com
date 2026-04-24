import { describe, it, expect } from "vitest"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"

describe("isPlatformPostTypeSupported", () => {
  it("accepts instagram + video (existing)", () => {
    expect(isPlatformPostTypeSupported("instagram", "video")).toBe(true)
  })

  it("accepts instagram + image (new in Phase 1a)", () => {
    expect(isPlatformPostTypeSupported("instagram", "image")).toBe(true)
  })

  it("rejects instagram + text (IG requires media)", () => {
    expect(isPlatformPostTypeSupported("instagram", "text")).toBe(false)
  })

  it("accepts facebook + image (new in Phase 1a)", () => {
    expect(isPlatformPostTypeSupported("facebook", "image")).toBe(true)
  })

  it("accepts facebook + text", () => {
    expect(isPlatformPostTypeSupported("facebook", "text")).toBe(true)
  })

  it("accepts linkedin + image (new in Phase 1c)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "image")).toBe(true)
  })

  it("rejects linkedin + video (disabled in Phase 1c — legacy ARTICLE path removed)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "video")).toBe(false)
  })

  it("rejects tiktok + image (deferred to Phase 1d)", () => {
    expect(isPlatformPostTypeSupported("tiktok", "image")).toBe(false)
  })

  it("rejects youtube + image (not applicable)", () => {
    expect(isPlatformPostTypeSupported("youtube", "image")).toBe(false)
  })

  it("accepts instagram + carousel (new in Phase 2a)", () => {
    expect(isPlatformPostTypeSupported("instagram", "carousel")).toBe(true)
  })

  it("accepts facebook + carousel (new in Phase 2b)", () => {
    expect(isPlatformPostTypeSupported("facebook", "carousel")).toBe(true)
  })

  it("rejects carousel on linkedin and tiktok (pending Phases 2c and 2d)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "carousel")).toBe(false)
    expect(isPlatformPostTypeSupported("tiktok", "carousel")).toBe(false)
  })

  it("accepts instagram + story (new in Phase 3)", () => {
    expect(isPlatformPostTypeSupported("instagram", "story")).toBe(true)
  })

  it("accepts facebook + story (new in Phase 3)", () => {
    expect(isPlatformPostTypeSupported("facebook", "story")).toBe(true)
  })

  it("rejects story on linkedin, tiktok, youtube (no API support)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "story")).toBe(false)
    expect(isPlatformPostTypeSupported("tiktok", "story")).toBe(false)
    expect(isPlatformPostTypeSupported("youtube", "story")).toBe(false)
  })
})
