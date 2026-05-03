import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  lockSubmission: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  createVideoUpload: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { POST } from "@/app/api/admin/team-videos/[id]/send-to-content-studio/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = () =>
  new Request("http://localhost/api/admin/team-videos/sub1/send-to-content-studio", {
    method: "POST",
  })

describe("POST send-to-content-studio", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post(), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post(), { params })
    expect(res.status).toBe(404)
  })
  it("409 if not approved", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review", title: "T",
    })
    const res = await POST(post(), { params })
    expect(res.status).toBe(409)
  })
  it("creates video_uploads + locks submission on happy path", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "Squat",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "v1", storage_path: "team-videos/sub1/v1/squat.mp4",
      original_filename: "squat.mp4", duration_seconds: 120,
      size_bytes: 1024, mime_type: "video/mp4",
    })
    ;(createVideoUpload as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "vu1" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.videoUpload.id).toBe("vu1")
    expect(createVideoUpload).toHaveBeenCalledWith(expect.objectContaining({
      title: "Squat",
      storage_path: "team-videos/sub1/v1/squat.mp4",
      uploaded_by: "admin1",
    }))
    expect(lockSubmission).toHaveBeenCalledWith("sub1")
  })
})
