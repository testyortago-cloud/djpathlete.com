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
  createSubmission,
  approveSubmission,
} from "@/lib/db/team-video-submissions"

beforeEach(() => vi.clearAllMocks())

describe("createSubmission", () => {
  it("inserts with status=draft and returns the row", async () => {
    const row = { id: "sub1", title: "T", submitted_by: "u1", status: "draft" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createSubmission({
      title: "T", description: "D", submittedBy: "u1",
    })
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.title).toBe("T")
    expect(args.description).toBe("D")
    expect(args.submitted_by).toBe("u1")
    expect(args.status).toBe("draft")
  })
})

describe("approveSubmission", () => {
  it("sets status=approved + approved_at + approved_by", async () => {
    updateMock.mockReturnValue({
      eq: () => Promise.resolve({ data: null, error: null }),
    })
    await approveSubmission("sub1", "admin1")
    const args = updateMock.mock.calls[0][0]
    expect(args.status).toBe("approved")
    expect(args.approved_by).toBe("admin1")
    expect(args.approved_at).toBeTruthy()
  })
})
