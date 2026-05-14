import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  createVersion: vi.fn(),
  nextVersionNumber: vi.fn(),
}))
vi.mock("@/lib/db/team-submission-images", () => ({
  createImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/storage/team-videos", () => ({
  buildImagePath: vi.fn((sub, ver, pos, name) => `team-videos/${sub}/v${ver}/${pos}_${name}`),
  createImageUploadUrls: vi.fn(),
}))
vi.mock("@/lib/team-images/feature-flag", () => ({ isTeamImagesEnabled: vi.fn(() => true) }))

import { auth } from "@/lib/auth"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { createImageUploadUrls } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/[id]/photo-versions/route"

beforeEach(() => vi.clearAllMocks())
const params = Promise.resolve({ id: "sub1" })

function req(body: unknown) {
  return new Request("http://localhost/api/editor/submissions/sub1/photo-versions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST photo-versions", () => {
  it("403 editor on someone else's submission", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u2", kind: "image_set", status: "revision_requested",
    })
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(403)
  })

  it("409 wrong kind", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "video", status: "revision_requested",
    })
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(409)
  })

  it("409 wrong status", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "approved",
    })
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(409)
  })

  it("happy path creates v2 with new images", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "revision_requested",
    })
    ;(nextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(2)
    ;(createVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v2" })
    ;(createImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "img1" }])
    ;(createImageUploadUrls as ReturnType<typeof vi.fn>).mockResolvedValue([
      { storagePath: "team-videos/sub1/v2/0_a.jpg", uploadUrl: "https://put", expiresInSeconds: 900 },
    ])
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(201)
    expect(setCurrentVersion).toHaveBeenCalledWith("sub1", "v2")
  })
})
