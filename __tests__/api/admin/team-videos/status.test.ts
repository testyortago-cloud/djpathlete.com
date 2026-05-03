import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setSubmissionStatus: vi.fn(),
  approveSubmission: vi.fn(),
  reopenSubmission: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/db/team-video-versions", () => ({ getCurrentVersion: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/db/team-video-comments", () => ({ countOpenCommentsForVersion: vi.fn().mockResolvedValue(0) }))
vi.mock("@/lib/email", () => ({
  sendVideoApprovedEmail: vi.fn(),
  sendVideoReopenedEmail: vi.fn(),
  sendVideoRevisionRequestedEmail: vi.fn(),
}))
vi.mock("@/lib/url", () => ({ getBaseUrl: () => "http://localhost:3050" }))

import { auth } from "@/lib/auth"
import {
  getSubmissionById, setSubmissionStatus, approveSubmission, reopenSubmission,
} from "@/lib/db/team-video-submissions"
import { POST } from "@/app/api/admin/team-videos/[id]/status/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = (body: unknown) =>
  new Request("http://localhost/api/admin/team-videos/sub1/status", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/admin/team-videos/[id]/status", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post({ action: "approve" }), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post({ action: "approve" }), { params })
    expect(res.status).toBe(404)
  })
  it("400 on invalid action", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    const res = await POST(post({ action: "nuke" }), { params })
    expect(res.status).toBe(400)
  })
  it("approve calls approveSubmission", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    const res = await POST(post({ action: "approve" }), { params })
    expect(res.status).toBe(200)
    expect(approveSubmission).toHaveBeenCalledWith("sub1", "admin1")
  })
  it("request_revision sets status revision_requested", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    const res = await POST(post({ action: "request_revision" }), { params })
    expect(res.status).toBe(200)
    expect(setSubmissionStatus).toHaveBeenCalledWith("sub1", "revision_requested")
  })
  it("reopen calls reopenSubmission only when approved", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved",
    })
    const res = await POST(post({ action: "reopen" }), { params })
    expect(res.status).toBe(200)
    expect(reopenSubmission).toHaveBeenCalledWith("sub1")
  })
  it("reopen on a non-approved row 409s", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    const res = await POST(post({ action: "reopen" }), { params })
    expect(res.status).toBe(409)
  })
})
