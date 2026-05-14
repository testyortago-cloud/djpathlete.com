import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  createSubmission: vi.fn(),
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
vi.mock("@/lib/team-images/feature-flag", () => ({
  isTeamImagesEnabled: vi.fn(() => true),
}))

import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { createImageUploadUrls } from "@/lib/storage/team-videos"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"
import { POST } from "@/app/api/editor/submissions/photos/route"

beforeEach(() => vi.clearAllMocks())

function req(body: unknown) {
  return new Request("http://localhost/api/editor/submissions/photos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/editor/submissions/photos", () => {
  it("401 unauthenticated", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(req({ title: "T", images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }))
    expect(res.status).toBe(401)
  })

  it("403 non-editor non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ title: "T", images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }))
    expect(res.status).toBe(403)
  })

  it("400 when feature flag disabled", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(isTeamImagesEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const res = await POST(req({ title: "T", images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }))
    expect(res.status).toBe(400)
  })

  it("400 invalid input", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    const res = await POST(req({ title: "T", images: [] }))
    expect(res.status).toBe(400)
  })

  it("creates submission, version, image rows, and returns signed PUTs", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(createSubmission as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1", kind: "image_set" })
    ;(nextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(createVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "img1", position: 0 }])
    ;(createImageUploadUrls as ReturnType<typeof vi.fn>).mockResolvedValue([
      { storagePath: "team-videos/sub1/v1/0_a.jpg", uploadUrl: "https://put.example", expiresInSeconds: 900 },
    ])
    const res = await POST(req({
      title: "Carousel",
      images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }],
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.submission.id).toBe("sub1")
    expect(json.version.id).toBe("v1")
    expect(json.uploads).toHaveLength(1)
    expect(json.uploads[0].position).toBe(0)
    expect(setCurrentVersion).toHaveBeenCalledWith("sub1", "v1")
  })
})
