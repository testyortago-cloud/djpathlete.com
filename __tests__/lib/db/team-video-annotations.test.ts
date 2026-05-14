import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const selectMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      select: selectMock,
    }),
  }),
}))

import {
  createAnnotationForComment,
  listAnnotationsForCommentIds,
} from "@/lib/db/team-video-annotations"

beforeEach(() => vi.clearAllMocks())

describe("createAnnotationForComment", () => {
  it("inserts a drawing for a comment and returns the row", async () => {
    const drawing = { paths: [{ tool: "arrow", color: "#FF3B30", width: 3,
                                 points: [[0.1, 0.1], [0.9, 0.9]] }] }
    const row = { id: "ann1", comment_id: "c1", drawing_json: drawing }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createAnnotationForComment("c1", drawing as never)
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.comment_id).toBe("c1")
    expect(args.drawing_json).toEqual(drawing)
  })
})

describe("listAnnotationsForCommentIds", () => {
  it("returns a map keyed by comment_id", async () => {
    selectMock.mockReturnValue({
      in: () => Promise.resolve({
        data: [
          { comment_id: "c1", drawing_json: { paths: [{ tool: "pen", color: "#000", width: 2, points: [[0,0],[1,1]] }] } },
          { comment_id: "c2", drawing_json: { paths: [] } },
        ],
        error: null,
      }),
    })
    const result = await listAnnotationsForCommentIds(["c1", "c2", "c3"])
    expect(result.size).toBe(2)
    // StoredAnnotation is a union of DrawingJson | ImageIndexAnnotation —
    // the fixtures here are drawings, narrow via the absence of `kind`.
    const c1 = result.get("c1")
    const c2 = result.get("c2")
    expect(c1 && !("kind" in c1) ? c1.paths[0].tool : null).toBe("pen")
    expect(c2 && !("kind" in c2) ? c2.paths.length : -1).toBe(0)
    expect(result.get("c3")).toBeUndefined()
  })
  it("returns empty map for empty input", async () => {
    const result = await listAnnotationsForCommentIds([])
    expect(result.size).toBe(0)
    expect(selectMock).not.toHaveBeenCalled()
  })
})
