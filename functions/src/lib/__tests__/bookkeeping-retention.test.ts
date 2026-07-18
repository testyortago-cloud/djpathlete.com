import { describe, it, expect, vi } from "vitest"
import { pruneExpiredDocuments } from "../bookkeeping-retention.js"

// `rows` is a mutable backing fixture: `.range(from, to)` slices it LIVE (not a snapshot),
// and the delete mock splices the matching row out — this is what lets a 1500-row fixture
// catch the interleaved-delete pagination bug (page 2's offset computed against an
// already-shrunk table skips rows) while passing once all pages are fetched before any
// delete happens.
function fakeSupabase(rows: Array<{ id: string; storage_path: string }>, log?: string[]) {
  return {
    from: () => ({
      select: () => ({
        lt: () => ({
          order: () => ({
            range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
          }),
        }),
      }),
      delete: () => ({
        eq: async (_col: string, id: string) => {
          const idx = rows.findIndex((r) => r.id === id)
          if (idx >= 0) rows.splice(idx, 1)
          log?.push(`row:${id}`)
          return { error: null }
        },
      }),
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

  it("deletes each doc's object before its row, in order, across multiple docs", async () => {
    const rows = [
      { id: "d1", storage_path: "p1" },
      { id: "d2", storage_path: "p2" },
    ]
    const log: string[] = []
    const bucket = {
      file: (path: string) => ({
        delete: async () => {
          log.push(`object:${path}`)
        },
      }),
    }
    const supabase = fakeSupabase(rows, log)
    const res = await pruneExpiredDocuments(supabase, bucket, "2026-07-18")
    expect(res.deleted).toBe(2)
    expect(log).toEqual(["object:p1", "row:d1", "object:p2", "row:d2"])
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

  it("prunes all 1500 docs across a >1000-row backlog without skipping any (fetch-all-then-delete)", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `d${i}`, storage_path: `p${i}` }))
    const bucket = { file: () => ({ delete: vi.fn().mockResolvedValue(undefined) }) }
    const supabase = fakeSupabase(rows)
    const res = await pruneExpiredDocuments(supabase, bucket, "2026-07-18")
    expect(res.deleted).toBe(1500)
    expect(res.ids.length).toBe(1500)
    expect(new Set(res.ids).size).toBe(1500) // no duplicates, none skipped
  })
})
