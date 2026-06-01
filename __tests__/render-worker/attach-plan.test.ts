import { describe, expect, it } from "vitest"
// Pure helper lives in the render-worker package; imported here (test-only, no
// runtime cross-package dependency) so it runs in the repo's existing vitest.
import { planCutAttachment } from "../../render-worker/src/lib/attach-plan"

describe("planCutAttachment", () => {
  it("maps each connected platform to its existing caption post", () => {
    const plan = planCutAttachment(
      ["instagram", "tiktok"],
      [
        { id: "ig-post", platform: "instagram" },
        { id: "tt-post", platform: "tiktok" },
      ],
    )
    expect(plan).toEqual([
      { platform: "instagram", postId: "ig-post" },
      { platform: "tiktok", postId: "tt-post" },
    ])
  })

  it("returns postId null for a connected platform that has no caption post (skip, never create)", () => {
    const plan = planCutAttachment(["instagram", "youtube"], [{ id: "ig-post", platform: "instagram" }])
    expect(plan).toEqual([
      { platform: "instagram", postId: "ig-post" },
      { platform: "youtube", postId: null },
    ])
  })

  it("ignores caption posts for platforms that are not connected", () => {
    const plan = planCutAttachment(
      ["instagram"],
      [
        { id: "ig-post", platform: "instagram" },
        { id: "fb-post", platform: "facebook" },
      ],
    )
    expect(plan).toEqual([{ platform: "instagram", postId: "ig-post" }])
  })

  it("picks the first matching post when a platform has several (stable, caller-ordered)", () => {
    const plan = planCutAttachment(
      ["instagram"],
      [
        { id: "ig-old", platform: "instagram" },
        { id: "ig-new", platform: "instagram" },
      ],
    )
    expect(plan).toEqual([{ platform: "instagram", postId: "ig-old" }])
  })
})
