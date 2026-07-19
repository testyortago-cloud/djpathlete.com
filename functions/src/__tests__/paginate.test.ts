import { describe, expect, it } from "vitest"
import { fetchAllRows } from "../lib/paginate.js"

/** Simulates a DB table: buildQuery slices [from, to] out of `rows`. */
function pagesOf<T>(rows: T[]) {
  return (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null })
}

const SEVEN = [1, 2, 3, 4, 5, 6, 7]

describe("fetchAllRows (functions twin with maxRows hard stop)", () => {
  it("fetches every page and preserves order when under the cap", async () => {
    const r = await fetchAllRows(pagesOf(SEVEN), 100, 3)
    expect(r).toEqual({ rows: [1, 2, 3, 4, 5, 6, 7], partial: false })
  })

  it("empty source → empty rows, partial false", async () => {
    expect(await fetchAllRows(pagesOf([]), 100, 3)).toEqual({ rows: [], partial: false })
  })

  it("throws the builder error message", async () => {
    const failing = () => Promise.resolve({ data: null, error: { message: "boom" } })
    await expect(fetchAllRows(failing, 100, 3)).rejects.toThrow("boom")
  })

  describe("hard stop — pinned invariant discrimination", () => {
    it("overshooting page is sliced to exactly maxRows with partial true (mutation: missing slice or off-by-one)", async () => {
      // pages of 3 → after page 2 all=6 > maxRows 5 → first 5 rows only
      const r = await fetchAllRows(pagesOf(SEVEN), 5, 3)
      expect(r).toEqual({ rows: [1, 2, 3, 4, 5], partial: true })
    })

    it("exactly maxRows via a SHORT final page is complete → partial false (mutation: >= instead of > at the boundary)", async () => {
      // 5 rows, pages of 3 → page 2 returns 2 (short) → data exhausted at exactly the cap
      const r = await fetchAllRows(pagesOf([1, 2, 3, 4, 5]), 5, 3)
      expect(r).toEqual({ rows: [1, 2, 3, 4, 5], partial: false })
    })

    it("exactly maxRows via a FULL final page reports partial true (pinned: no extra probe fetch)", async () => {
      // 6 rows, pages of 3, maxRows 6 → page 2 is full → cannot prove completeness → honest cap
      const r = await fetchAllRows(pagesOf([1, 2, 3, 4, 5, 6]), 6, 3)
      expect(r).toEqual({ rows: [1, 2, 3, 4, 5, 6], partial: true })
    })

    it("terminates against an endless source (mutation: dropped hard stop = infinite loop)", async () => {
      const endless = (from: number, to: number) =>
        Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null })
      const r = await fetchAllRows(endless, 10, 4)
      expect(r.partial).toBe(true)
      expect(r.rows).toHaveLength(10)
      expect(r.rows[9]).toBe(9)
    })
  })
})
