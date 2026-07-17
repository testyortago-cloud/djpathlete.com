import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listEntriesMock = vi.fn()
const entryTotalsMock = vi.fn()
const getEntryMock = vi.fn()
const assertAccountInBookMock = vi.fn()
const updateEntryMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: (...a: unknown[]) => listEntriesMock(...a),
  entryTotals: (...a: unknown[]) => entryTotalsMock(...a),
  getEntry: (...a: unknown[]) => getEntryMock(...a),
  assertAccountInBook: (...a: unknown[]) => assertAccountInBookMock(...a),
  updateEntry: (...a: unknown[]) => updateEntryMock(...a),
  deleteEntry: vi.fn(),
}))

import { GET } from "@/app/api/admin/bookkeeping/entries/route"
import { PATCH } from "@/app/api/admin/bookkeeping/entries/[id]/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ENTRY = "e0000000-0000-4000-8000-000000000002"
const ACCOUNT = "a0000000-0000-4000-8000-000000000003"

function mk(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

beforeEach(() => {
  authMock.mockReset()
  listEntriesMock.mockReset()
  entryTotalsMock.mockReset()
  getEntryMock.mockReset()
  assertAccountInBookMock.mockReset()
  updateEntryMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  listEntriesMock.mockResolvedValue({ rows: [], total: 0 })
  entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
})

describe("GET /api/admin/bookkeeping/entries — M4 enum validation", () => {
  it("400s an invalid direction", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&direction=foo`) as never)
    expect(res.status).toBe(400)
    expect(listEntriesMock).not.toHaveBeenCalled()
  })
  it("400s an invalid source", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&source=bar`) as never)
    expect(res.status).toBe(400)
    expect(listEntriesMock).not.toHaveBeenCalled()
  })
  it("200s a valid direction", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&direction=income`) as never)
    expect(res.status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ direction: "income" }))
  })
  it("200s a valid source", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&source=manual`) as never)
    expect(res.status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ source: "manual" }))
  })
  it("200s with no direction/source (absent means no filter)", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ direction: undefined, source: undefined }))
  })
})

describe("GET /api/admin/bookkeeping/entries — M6 search escaping", () => {
  it("does not throw on a search query containing a dot", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&q=coach.com`) as never)
    expect(res.status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ search: "coach.com" }))
  })
})

describe("PATCH /api/admin/bookkeeping/entries/[id] — M5 book/type scoping", () => {
  it("409s when assertAccountInBook rejects with WRONG_BOOK", async () => {
    getEntryMock.mockResolvedValue({ id: ENTRY, book_id: BOOK, direction: "expense" })
    assertAccountInBookMock.mockRejectedValue(mk("WRONG_BOOK", "account belongs to a different book"))
    const res = await PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ account_id: ACCOUNT }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(409)
    expect(updateEntryMock).not.toHaveBeenCalled()
  })

  it("409s when assertAccountInBook rejects with WRONG_TYPE", async () => {
    getEntryMock.mockResolvedValue({ id: ENTRY, book_id: BOOK, direction: "expense" })
    assertAccountInBookMock.mockRejectedValue(mk("WRONG_TYPE", "account type does not match entry direction"))
    const res = await PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ account_id: ACCOUNT }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(409)
    expect(updateEntryMock).not.toHaveBeenCalled()
  })

  it("404s when getEntry returns null", async () => {
    getEntryMock.mockResolvedValue(null)
    const res = await PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ account_id: ACCOUNT }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(404)
    expect(assertAccountInBookMock).not.toHaveBeenCalled()
    expect(updateEntryMock).not.toHaveBeenCalled()
  })

  it("200s a valid account_id patch (assertAccountInBook resolves)", async () => {
    getEntryMock.mockResolvedValue({ id: ENTRY, book_id: BOOK, direction: "expense" })
    assertAccountInBookMock.mockResolvedValue(undefined)
    const updated = { id: ENTRY, book_id: BOOK, account_id: ACCOUNT, direction: "expense" }
    updateEntryMock.mockResolvedValue(updated)
    const res = await PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ account_id: ACCOUNT }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(200)
    expect(assertAccountInBookMock).toHaveBeenCalledWith(ACCOUNT, BOOK, "expense")
    expect(updateEntryMock).toHaveBeenCalledWith(ENTRY, expect.objectContaining({ account_id: ACCOUNT }))
    const json = await res.json()
    expect(json.entry).toEqual(updated)
  })

  it("skips the book/type guard entirely when no account_id is in the patch", async () => {
    updateEntryMock.mockResolvedValue({ id: ENTRY, memo: "updated" })
    const res = await PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ memo: "updated" }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(200)
    expect(getEntryMock).not.toHaveBeenCalled()
    expect(assertAccountInBookMock).not.toHaveBeenCalled()
    expect(updateEntryMock).toHaveBeenCalledWith(ENTRY, expect.objectContaining({ memo: "updated" }))
  })
})
