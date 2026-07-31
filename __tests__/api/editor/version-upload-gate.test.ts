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
vi.mock("@/lib/storage/team-videos", () => ({
  buildVersionPath: vi.fn((sid, n, fn) => `team-videos/${sid}/v${n}/${fn}`),
  createUploadUrl: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createUploadUrl } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/[id]/versions/route"
import type { TeamVideoSubmissionStatus } from "@/types/database"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })

function req() {
  return new Request("http://localhost/api/editor/submissions/sub1/versions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "revised.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024 * 1024 * 20,
    }),
  })
}

function arrange(status: TeamVideoSubmissionStatus) {
  ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "editor1", role: "editor" },
  })
  ;(getSubmissionById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "sub1",
    submitted_by: "editor1",
    kind: "video",
    status,
  })
  ;(nextVersionNumber as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(3)
  ;(createVersion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v3" })
  ;(createUploadUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    uploadUrl: "https://storage.googleapis.com/bucket/x?sig",
    storagePath: "team-videos/sub1/v3/revised.mp4",
    expiresInSeconds: 900,
  })
}

describe("POST /api/editor/submissions/[id]/versions — upload gate", () => {
  it("accepts a new cut while the submission is still under review", async () => {
    // The regression that stranded the Liam submission: Darren left a note but
    // never clicked "Request revision", so status stayed `submitted` and the
    // editor's upload 409'd with nothing on screen to explain it.
    arrange("submitted")
    const res = await POST(req(), { params } as never)
    expect(res.status).toBe(201)
    expect(createVersion).toHaveBeenCalled()
  })

  it("accepts a new cut mid in_review and on draft / revision_requested", async () => {
    for (const status of ["in_review", "draft", "revision_requested"] as const) {
      vi.clearAllMocks()
      arrange(status)
      const res = await POST(req(), { params } as never)
      expect(res.status, `status ${status} should be uploadable`).toBe(201)
    }
  })

  it("409s on an approved submission, and never mints an upload URL", async () => {
    arrange("approved")
    const res = await POST(req(), { params } as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error:
        "Darren has approved this cut. Ask him to reopen it before uploading a new version.",
    })
    // The refusal must come BEFORE any row or signed URL is created.
    expect(createVersion).not.toHaveBeenCalled()
    expect(createUploadUrl).not.toHaveBeenCalled()
  })

  it("409s on a locked submission", async () => {
    arrange("locked")
    const res = await POST(req(), { params } as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("locked")
    expect(createVersion).not.toHaveBeenCalled()
  })

  it("still refuses another editor's submission", async () => {
    arrange("submitted")
    ;(getSubmissionById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1",
      submitted_by: "someone-else",
      kind: "video",
      status: "submitted",
    })
    const res = await POST(req(), { params } as never)
    expect(res.status).toBe(403)
    expect(createVersion).not.toHaveBeenCalled()
  })
})
