import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}))

import {
  createComment,
  resolveComment,
} from "@/lib/db/team-video-comments"

beforeEach(() => vi.clearAllMocks())

describe("createComment", () => {
  it("inserts a timecoded comment with author + version", async () => {
    const row = { id: "c1", version_id: "v1", author_id: "a1" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createComment({
      versionId: "v1",
      authorId: "a1",
      timecodeSeconds: 42.5,
      commentText: "Tighten",
    })
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.version_id).toBe("v1")
    expect(args.author_id).toBe("a1")
    expect(args.timecode_seconds).toBe(42.5)
    expect(args.comment_text).toBe("Tighten")
    expect(args.status).toBe("open")
  })
  it("accepts a null timecode for general comments", async () => {
    const row = { id: "c2" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    await createComment({
      versionId: "v1", authorId: "a1", timecodeSeconds: null, commentText: "Overall",
    })
    expect(insertMock.mock.calls[0][0].timecode_seconds).toBeNull()
  })
})

describe("resolveComment", () => {
  it("sets status=resolved + resolved_at + resolved_by", async () => {
    updateMock.mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) })
    await resolveComment("c1", "a1")
    const args = updateMock.mock.calls[0][0]
    expect(args.status).toBe("resolved")
    expect(args.resolved_by).toBe("a1")
    expect(args.resolved_at).toBeTruthy()
  })
})
