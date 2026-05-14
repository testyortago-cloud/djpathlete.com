import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setSubmissionStatus: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  finalizeVersion: vi.fn(),
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-submission-images", () => ({
  listImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/storage/team-videos", () => ({
  imageStorageObjectExists: vi.fn(),
}))
vi.mock("@/lib/email", () => ({ sendVideoUploadedEmail: vi.fn() }))
vi.mock("@/lib/url", () => ({ getBaseUrl: () => "http://localhost" }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => ({ data: [] }) }) }) })) }))

import { auth } from "@/lib/auth"
import { getSubmissionById, setSubmissionStatus } from "@/lib/db/team-video-submissions"
import { finalizeVersion, getCurrentVersion } from "@/lib/db/team-video-versions"
import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { imageStorageObjectExists } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/[id]/finalize/route"

beforeEach(() => vi.clearAllMocks())
const params = Promise.resolve({ id: "sub1" })
const req = () => new Request("http://localhost/api/editor/submissions/sub1/finalize", { method: "POST" })

describe("finalize for image_set", () => {
  it("409 when any image is missing from storage", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "draft", title: "T",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1", status: "pending" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "i1", storage_path: "p0", position: 0 },
      { id: "i2", storage_path: "p1", position: 1 },
    ])
    ;(imageStorageObjectExists as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const res = await POST(req(), { params })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.missingPositions).toEqual([1])
    expect(setSubmissionStatus).not.toHaveBeenCalled()
  })

  it("happy path flips submission to submitted when all images present", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "draft", title: "T",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1", status: "pending" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "i1", storage_path: "p0", position: 0 },
    ])
    ;(imageStorageObjectExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)

    const res = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(finalizeVersion).toHaveBeenCalledWith("v1")
    expect(setSubmissionStatus).toHaveBeenCalledWith("sub1", "submitted")
  })
})
