import { describe, expect, it } from "vitest"
import { deriveRenderSignals } from "@/lib/content-studio/pipeline-data"
import type { RecentCaptionRender } from "@/lib/ai-jobs"

const r = (videoUploadId: string, status: RecentCaptionRender["status"], jobId: string): RecentCaptionRender => ({
  jobId,
  videoUploadId,
  status,
})

describe("deriveRenderSignals", () => {
  it("maps an in-flight render to renderJobIdByVideo (newest row per video wins)", () => {
    // Rows arrive newest-first. v1's latest is pending.
    const renders = [r("v1", "pending", "job-new"), r("v1", "failed", "job-old")]
    const { renderJobIdByVideo, failedRenderVideoIds } = deriveRenderSignals(renders, new Set())
    expect(renderJobIdByVideo).toEqual({ v1: "job-new" })
    expect([...failedRenderVideoIds]).toEqual([])
  })

  it("treats processing as in-flight", () => {
    const { renderJobIdByVideo } = deriveRenderSignals([r("v1", "processing", "j1")], new Set())
    expect(renderJobIdByVideo).toEqual({ v1: "j1" })
  })

  it("flags a video whose latest render failed and that has no cut", () => {
    const { renderJobIdByVideo, failedRenderVideoIds } = deriveRenderSignals([r("v1", "failed", "j1")], new Set())
    expect(renderJobIdByVideo).toEqual({})
    expect([...failedRenderVideoIds]).toEqual(["v1"])
  })

  it("does NOT flag a failed render when the video already has a cut", () => {
    const { failedRenderVideoIds } = deriveRenderSignals([r("v1", "failed", "j1")], new Set(["v1"]))
    expect([...failedRenderVideoIds]).toEqual([])
  })

  it("does NOT flag failed when the latest render succeeded after an earlier failure", () => {
    const renders = [r("v1", "completed", "j-new"), r("v1", "failed", "j-old")]
    const { renderJobIdByVideo, failedRenderVideoIds } = deriveRenderSignals(renders, new Set())
    expect(renderJobIdByVideo).toEqual({})
    expect([...failedRenderVideoIds]).toEqual([])
  })
})
