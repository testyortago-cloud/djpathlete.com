import { describe, it, expect, vi } from "vitest"
import { fetchAllRows } from "@/lib/db/paginate"

describe("fetchAllRows", () => {
  it("pages until a short page and concatenates", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    const page2 = Array.from({ length: 3 }, (_, i) => ({ id: 1000 + i }))
    const build = vi.fn(async (from: number) => ({
      data: from === 0 ? page1 : page2,
      error: null,
    }))
    const rows = await fetchAllRows<{ id: number }>(build, 1000)
    expect(rows).toHaveLength(1003)
    expect(build).toHaveBeenCalledTimes(2)
    expect(build).toHaveBeenNthCalledWith(1, 0, 999)
    expect(build).toHaveBeenNthCalledWith(2, 1000, 1999)
  })
  it("stops after one page when under pageSize", async () => {
    const build = vi.fn(async () => ({ data: [{ id: 1 }], error: null }))
    const rows = await fetchAllRows<{ id: number }>(build, 1000)
    expect(rows).toHaveLength(1)
    expect(build).toHaveBeenCalledTimes(1)
  })
  it("throws on error", async () => {
    const build = vi.fn(async () => ({ data: null, error: { message: "boom" } }))
    await expect(fetchAllRows(build)).rejects.toThrow("boom")
  })
})
