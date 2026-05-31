import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const getLatestCutMock = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoUploadByIdMock(...a),
}))
vi.mock("@/lib/db/media-assets", () => ({
  getLatestCaptionedCutForVideo: (...a: unknown[]) => getLatestCutMock(...a),
}))

import { isVideoPostable, assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"

describe("isVideoPostable", () => {
  it("not postable when gated and no cut", () => {
    expect(isVideoPostable({ needs_edit: true }, false)).toBe(false)
  })
  it("postable when gated but a cut exists", () => {
    expect(isVideoPostable({ needs_edit: true }, true)).toBe(true)
  })
  it("postable when not gated and no cut", () => {
    expect(isVideoPostable({ needs_edit: false }, false)).toBe(true)
  })
  it("postable when not gated and a cut exists", () => {
    expect(isVideoPostable({ needs_edit: false }, true)).toBe(true)
  })
})

describe("assertSourceVideoPostable", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ok when sourceVideoId is null and makes no DB calls", async () => {
    expect(await assertSourceVideoPostable(null)).toEqual({ ok: true })
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })
  it("ok when the video is not found and skips the cut query", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
    expect(getLatestCutMock).not.toHaveBeenCalled()
  })
  it("not ok when gated and no cut", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: true })
    getLatestCutMock.mockResolvedValue(null)
    const r = await assertSourceVideoPostable("v1")
    expect(r.ok).toBe(false)
  })
  it("ok when gated but a cut exists", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: true })
    getLatestCutMock.mockResolvedValue({ asset: { id: "a1" } })
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
  it("ok when not gated", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: false })
    getLatestCutMock.mockResolvedValue(null)
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
})
