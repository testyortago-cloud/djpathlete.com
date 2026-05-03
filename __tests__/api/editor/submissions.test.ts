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
vi.mock("@/lib/storage/team-videos", () => ({
  buildVersionPath: vi.fn((sid, n, fn) => `team-videos/${sid}/v${n}/${fn}`),
  createUploadUrl: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createUploadUrl } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/route"

beforeEach(() => vi.clearAllMocks())

const post = (body: unknown) =>
  new Request("http://localhost/api/editor/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const validBody = {
  title: "Squat tutorial",
  description: "v1",
  filename: "squat.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1024 * 1024 * 50,
}

describe("POST /api/editor/submissions", () => {
  it("401 when not authenticated", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post(validBody))
    expect(res.status).toBe(401)
  })

  it("403 for non-editor non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await POST(post(validBody))
    expect(res.status).toBe(403)
  })

  it("400 for invalid input", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post({ ...validBody, mimeType: "image/gif" }))
    expect(res.status).toBe(400)
  })

  it("creates submission + version + returns signed URL on happy path", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "editor1", role: "editor" },
    })
    ;(createSubmission as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", title: "Squat tutorial", submitted_by: "editor1", status: "draft",
    })
    ;(nextVersionNumber as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(createVersion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "v1", submission_id: "sub1", version_number: 1, storage_path: "team-videos/sub1/v1/squat.mp4",
    })
    ;(createUploadUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      uploadUrl: "https://storage.googleapis.com/bucket/team-videos/sub1/v1/squat.mp4?...sig",
      storagePath: "team-videos/sub1/v1/squat.mp4",
      expiresInSeconds: 900,
    })

    const res = await POST(post(validBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.submission.id).toBe("sub1")
    expect(json.version.id).toBe("v1")
    expect(json.upload.uploadUrl).toMatch(/^https:\/\/storage\.googleapis\.com/)
    expect(json.upload.storagePath).toBe("team-videos/sub1/v1/squat.mp4")
    expect(setCurrentVersion).toHaveBeenCalledWith("sub1", "v1")
  })
})
