import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoUploadByIdMock(...a),
}))

import { isVideoPostable, assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"

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
