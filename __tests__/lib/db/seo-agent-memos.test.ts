import { describe, expect, it, vi, beforeEach } from "vitest"

const singleResponse = vi.fn()
const listResponse = vi.fn()
const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle: () => singleResponse() })),
    order: vi.fn(() => ({ limit: () => listResponse() })),
  })),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

const { getMemoById, listMemos } = await import("@/lib/db/seo-agent-memos")

beforeEach(() => {
  fromMock.mockClear()
  singleResponse.mockReset()
  listResponse.mockReset()
})

describe("seo_agent_memos DAL", () => {
  it("getMemoById returns null when no row", async () => {
    singleResponse.mockResolvedValueOnce({ data: null, error: null })
    expect(await getMemoById("missing")).toBeNull()
  })

  it("getMemoById returns the row", async () => {
    const row = { id: "m1", rationale: "..." }
    singleResponse.mockResolvedValueOnce({ data: row, error: null })
    expect(await getMemoById("m1")).toEqual(row)
  })

  it("listMemos returns sorted rows up to limit", async () => {
    const rows = [{ id: "m1" }, { id: "m2" }]
    listResponse.mockResolvedValueOnce({ data: rows, error: null })
    expect(await listMemos(25)).toEqual(rows)
  })

  it("listMemos returns [] on null data", async () => {
    listResponse.mockResolvedValueOnce({ data: null, error: null })
    expect(await listMemos()).toEqual([])
  })

  it("throws on supabase error", async () => {
    singleResponse.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    await expect(getMemoById("x")).rejects.toMatchObject({ message: "boom" })
  })
})
