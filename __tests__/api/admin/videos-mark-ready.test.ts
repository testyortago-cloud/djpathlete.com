import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/video-uploads", () => ({
  updateVideoUpload: (...a: unknown[]) => updateMock(...a),
  getVideoUploadById: vi.fn(),
  deleteVideoUpload: vi.fn(),
}))
// The route module also wires GET/DELETE handlers — mock their deps so importing
// the module doesn't touch Firebase or the transcripts DAL during the PATCH tests.
vi.mock("@/lib/firebase-admin", () => ({ getAdminStorage: vi.fn() }))
vi.mock("@/lib/db/video-transcripts", () => ({ getTranscriptForVideo: vi.fn() }))

import { PATCH } from "@/app/api/admin/videos/[id]/route"

function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/videos/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return PATCH(req as never, { params: Promise.resolve({ id }) })
}

describe("PATCH /api/admin/videos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
  })

  it("401 for non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call("v1", { needs_edit: false })).status).toBe(401)
  })

  it("400 when needs_edit is missing or not a boolean", async () => {
    expect((await call("v1", {})).status).toBe(400)
  })

  it("marks a video ready", async () => {
    updateMock.mockResolvedValue({ id: "v1", needs_edit: false })
    const res = await call("v1", { needs_edit: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "v1", needs_edit: false, hook_text: null })
    expect(updateMock).toHaveBeenCalledWith("v1", { needs_edit: false })
  })
})
