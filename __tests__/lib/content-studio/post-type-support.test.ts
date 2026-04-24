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

  it("rejects linkedin + image (deferred to Phase 1c)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "image")).toBe(false)
  })

  it("accepts linkedin + video (existing)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "video")).toBe(true)
  })

  it("rejects tiktok + image (deferred to Phase 1d)", () => {
    expect(isPlatformPostTypeSupported("tiktok", "image")).toBe(false)
  })

  it("rejects youtube + image (not applicable)", () => {
    expect(isPlatformPostTypeSupported("youtube", "image")).toBe(false)
  })

  it("rejects carousel and story for all platforms in Phase 1a", () => {
    expect(isPlatformPostTypeSupported("instagram", "carousel")).toBe(false)
    expect(isPlatformPostTypeSupported("instagram", "story")).toBe(false)
  })
})
