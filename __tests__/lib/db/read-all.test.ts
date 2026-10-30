import { describe, it, expect, vi } from "vitest"
import { readAllRows } from "@/lib/db/read-all"

/** A fake query over `total` numbered rows that, like PostgREST, answers at most 1000 per request. */
function fakeQuery(total: number, failFrom?: number) {
  const calls: [number, number][] = []
  const page = vi.fn(async (from: number, to: number) => {
    calls.push([from, to])
    if (from === failFrom) return { data: null, error: { message: "boom" }, count: null }
    const end = Math.min(to, from + 999, total - 1)
    const data = Array.from({ length: Math.max(0, end - from + 1) }, (_, i) => from + i)
    return { data, error: null, count: total }
  })
  return { page, calls }
}

describe("readAllRows", () => {
  it("asks once when everything fits in one page", async () => {
    const { page, calls } = fakeQuery(640)
    expect(await readAllRows(page)).toHaveLength(640)
    expect(calls).toEqual([[0, 999]])
  })
  it("reads every page past the 1000-row cap, in order", async () => {
    const { page, calls } = fakeQuery(2500)
    const rows = await readAllRows(page)
    expect(rows).toHaveLength(2500)
    expect(rows[1000]).toBe(1000)
    expect(rows[2499]).toBe(2499)
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })
  it("throws when a later page fails instead of returning part of the list", async () => {
    const { page } = fakeQuery(2500, 1000)
    await expect(readAllRows(page)).rejects.toEqual({ message: "boom" })
  })
  it("throws when the query did not ask for a count, since it cannot know there are more pages", async () => {
    await expect(readAllRows(async () => ({ data: [1], error: null, count: null }))).rejects.toThrow(/count/)
  })
})
