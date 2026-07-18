import { describe, it, expect, vi } from "vitest"
import { pruneExpiredDocuments } from "../bookkeeping-retention.js"

function fakeSupabase(rows: Array<{ id: string; storage_path: string }>) {
  const del = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  return {
    _del: del,
    from: () => ({
      select: () => ({ lt: () => ({ range: async () => ({ data: rows, error: null }) }) }),
      delete: del,
    }),
  } as never
}

describe("pruneExpiredDocuments", () => {
  it("deletes object then row for each expired doc", async () => {
    const rows = [{ id: "d1", storage_path: "p1" }]
    const fileDelete = vi.fn().mockResolvedValue(undefined)
    const bucket = { file: () => ({ delete: fileDelete }) }
    const supabase = fakeSupabase(rows)
    const res = await pruneExpiredDocuments(supabase, bucket, "2026-07-18")
    expect(res.deleted).toBe(1)
    expect(res.ids).toEqual(["d1"])
    expect(fileDelete).toHaveBeenCalledWith({ ignoreNotFound: true })
  })

  it("swallows a missing-object error and still deletes the row", async () => {
    const bucket = { file: () => ({ delete: vi.fn().mockRejectedValue(new Error("not found")) }) }
    const res = await pruneExpiredDocuments(fakeSupabase([{ id: "d1", storage_path: "p1" }]), bucket, "2026-07-18")
    expect(res.deleted).toBe(1)
  })

  it("returns zero when nothing is expired", async () => {
    const bucket = { file: () => ({ delete: vi.fn() }) }
    const res = await pruneExpiredDocuments(fakeSupabase([]), bucket, "2026-07-18")
    expect(res).toEqual({ deleted: 0, ids: [] })
  })
})
