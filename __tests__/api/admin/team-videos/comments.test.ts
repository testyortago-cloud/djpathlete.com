import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setSubmissionStatus: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-video-comments", () => ({
  createComment: vi.fn(),
  listCommentsForVersion: vi.fn(),
  // Threading: route now joins author info via this helper.
  // Default to empty so existing test assertions keep working.
  listAuthorsForIds: vi.fn().mockResolvedValue(new Map()),
  // Reply validation: route may call getCommentById to confirm the parent.
  getCommentById: vi.fn(),
}))
vi.mock("@/lib/db/team-video-annotations", () => ({
  createAnnotationForComment: vi.fn(),
  listAnnotationsForCommentIds: vi.fn().mockResolvedValue(new Map()),
}))

import { auth } from "@/lib/auth"
import { getSubmissionById, setSubmissionStatus } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createComment, listCommentsForVersion } from "@/lib/db/team-video-comments"
import { createAnnotationForComment, listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
import { POST, GET } from "@/app/api/admin/team-videos/[id]/comments/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = (body: unknown) =>
  new Request("http://localhost/api/admin/team-videos/sub1/comments", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/admin/team-videos/[id]/comments", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post({ timecodeSeconds: 0, commentText: "x" }), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post({ timecodeSeconds: 0, commentText: "x" }), { params })
    expect(res.status).toBe(404)
  })
  it("400 on invalid input", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    const res = await POST(post({ timecodeSeconds: 0, commentText: "" }), { params })
    expect(res.status).toBe(400)
  })
  it("creates comment + transitions submitted→in_review", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "submitted",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1" })

    const res = await POST(post({ timecodeSeconds: 42, commentText: "Tighten" }), { params })
    expect(res.status).toBe(201)
    expect(createComment).toHaveBeenCalledWith({
      versionId: "v1", authorId: "admin1", timecodeSeconds: 42, commentText: "Tighten",
      parentId: null,
    })
    expect(setSubmissionStatus).toHaveBeenCalledWith("sub1", "in_review")
  })
  it("does NOT transition status when already in_review", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c2" })

    const res = await POST(post({ timecodeSeconds: 10, commentText: "Note" }), { params })
    expect(res.status).toBe(201)
    expect(setSubmissionStatus).not.toHaveBeenCalled()
  })

  it("creates annotation when annotation payload is included", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1" })

    const drawing = {
      paths: [{ tool: "arrow", color: "#FF3B30", width: 3,
                points: [[0.1, 0.1], [0.9, 0.9]] }],
    }
    const res = await POST(
      post({ timecodeSeconds: 10, commentText: "Note", annotation: drawing }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(createAnnotationForComment).toHaveBeenCalledWith("c1", drawing)
  })

  it("returns 201 with annotationError when annotation persist throws", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1" })
    ;(createAnnotationForComment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    )

    const drawing = {
      paths: [{ tool: "arrow", color: "#FF3B30", width: 3,
                points: [[0.1, 0.1], [0.9, 0.9]] }],
    }
    const res = await POST(
      post({ timecodeSeconds: 10, commentText: "Note", annotation: drawing }),
      { params },
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.comment).toBeDefined()
    expect(json.annotationError).toBe("db down")
  })

  it("does NOT create annotation when payload is absent", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c2" })

    const res = await POST(
      post({ timecodeSeconds: 10, commentText: "No drawing" }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(createAnnotationForComment).not.toHaveBeenCalled()
  })
})

describe("GET /api/admin/team-videos/[id]/comments", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await GET(new Request("http://x"), { params })
    expect(res.status).toBe(403)
  })
  it("returns the list for admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listCommentsForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "c1" }])
    const res = await GET(new Request("http://x"), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.comments).toHaveLength(1)
    expect(json.comments[0].annotation).toBeNull()
  })

  it("returns comments with annotation field merged in", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listCommentsForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "c1", timecode_seconds: 10, comment_text: "with drawing" },
      { id: "c2", timecode_seconds: null, comment_text: "general, no drawing" },
    ])
    const drawing = { paths: [{ tool: "pen", color: "#000000", width: 2,
                                points: [[0, 0], [1, 1]] }] }
    ;(listAnnotationsForCommentIds as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["c1", drawing]]),
    )
    const res = await GET(new Request("http://x"), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.comments).toHaveLength(2)
    expect(json.comments[0].annotation).toEqual(drawing)
    expect(json.comments[1].annotation).toBeNull()
  })
})
