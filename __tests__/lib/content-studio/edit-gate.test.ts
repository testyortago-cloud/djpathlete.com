import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const updateVideoUploadMock = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoUploadByIdMock(...a),
  updateVideoUpload: (...a: unknown[]) => updateVideoUploadMock(...a),
}))

import { isVideoPostable, assertSourceVideoPostable, releaseSourceVideoForSend } from "@/lib/content-studio/edit-gate"

describe("isVideoPostable", () => {
  it("postable when not gated (needs_edit=false)", () => {
    expect(isVideoPostable({ needs_edit: false })).toBe(true)
  })
  it("not postable when gated (needs_edit=true)", () => {
    expect(isVideoPostable({ needs_edit: true })).toBe(false)
  })
})

describe("assertSourceVideoPostable", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ok when sourceVideoId is null and makes no DB calls", async () => {
    expect(await assertSourceVideoPostable(null)).toEqual({ ok: true })
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })
  it("ok when the video is not found", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
  it("not ok when gated (needs_edit=true)", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: true })
    const r = await assertSourceVideoPostable("v1")
    expect(r.ok).toBe(false)
  })
  it("ok when not gated (needs_edit=false)", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: false })
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
})

// Sending a post by hand IS the operator releasing the edit gate. Requiring a
// separate "Mark as ready" click first made it two switches for one intent.
describe("releaseSourceVideoForSend", () => {
  beforeEach(() => vi.clearAllMocks())

  it("clears the gate and reports it when the video still needs editing", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: true })
    updateVideoUploadMock.mockResolvedValue({ id: "v1", needs_edit: false })

    expect(await releaseSourceVideoForSend("v1")).toEqual({ released: true })
    expect(updateVideoUploadMock).toHaveBeenCalledWith("v1", { needs_edit: false })
  })

  it("writes nothing when the video is already ready", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: false })

    expect(await releaseSourceVideoForSend("v1")).toEqual({ released: false })
    expect(updateVideoUploadMock).not.toHaveBeenCalled()
  })

  it("writes nothing and reads nothing for a post with no source video", async () => {
    expect(await releaseSourceVideoForSend(null)).toEqual({ released: false })
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
    expect(updateVideoUploadMock).not.toHaveBeenCalled()
  })

  it("writes nothing when the video row is missing", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)

    expect(await releaseSourceVideoForSend("gone")).toEqual({ released: false })
    expect(updateVideoUploadMock).not.toHaveBeenCalled()
  })
})
