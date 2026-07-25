import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listEntriesMock = vi.fn()
const entryTotalsMock = vi.fn()
const createEntryMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: (...a: unknown[]) => listEntriesMock(...a),
  entryTotals: (...a: unknown[]) => entryTotalsMock(...a),
  createEntry: (...a: unknown[]) => createEntryMock(...a),
  assertAccountInBook: vi.fn(),
}))

import { GET, POST } from "@/app/api/admin/bookkeeping/entries/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  authMock.mockReset(); listEntriesMock.mockReset(); entryTotalsMock.mockReset(); createEntryMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("GET /api/admin/bookkeeping/entries", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(403)
    expect(listEntriesMock).not.toHaveBeenCalled()
    expect(entryTotalsMock).not.toHaveBeenCalled()
  })
  it("400s without book_id", async () => {
    const res = await GET(new Request("http://x/api") as never)
    expect(res.status).toBe(400)
  })
  it("returns rows + totals for an admin", async () => {
    listEntriesMock.mockResolvedValue({ rows: [{ id: "e1" }], total: 1 })
    entryTotalsMock.mockResolvedValue({ income_cents: 9900, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.total).toBe(1)
    expect(json.totals.income_cents).toBe(9900)
  })
  it("returns 500 when the DAL throws", async () => {
    listEntriesMock.mockRejectedValue(new Error("db boom"))
    entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain("boom")
  })
  it("does not crash on a non-numeric page param", async () => {
    listEntriesMock.mockResolvedValue({ rows: [], total: 0 })
    entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&page=abc`) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.page).toBe(1)
  })
  it("passes the account_id=none sentinel through to listEntries untouched", async () => {
    listEntriesMock.mockResolvedValue({ rows: [], total: 0 })
    entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&account_id=none`) as never)
    expect(res.status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ accountId: "none" }))
    // The stat cards read entryTotals — it must see the same filter or the
    // income/expense totals would not match the rows below them.
    expect(entryTotalsMock).toHaveBeenCalledWith(expect.objectContaining({ accountId: "none" }))
  })
  it("400s a malformed account_id instead of letting Postgres 22P02 become a 500", async () => {
    // account_id travels in shareable deep links now, so it arrives from links
    // and hand-edited URLs, not just from the select. The server page validates
    // the same parameter (app/(admin)/admin/books/page.tsx); an unvalidated
    // pass-through here reached the uuid column and surfaced as "Failed to load
    // entries".
    listEntriesMock.mockResolvedValue({ rows: [], total: 0 })
    entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}&account_id=Uncategorized`) as never)
    expect(res.status).toBe(400)
    expect(listEntriesMock).not.toHaveBeenCalled()
    expect(entryTotalsMock).not.toHaveBeenCalled()
  })
  it("still accepts a real uuid account_id and an omitted one", async () => {
    listEntriesMock.mockResolvedValue({ rows: [], total: 0 })
    entryTotalsMock.mockResolvedValue({ income_cents: 0, expense_cents: 0 })
    const acct = "a0000000-0000-4000-8000-00000000000f"
    expect((await GET(new Request(`http://x/api?book_id=${BOOK}&account_id=${acct}`) as never)).status).toBe(200)
    expect(listEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ accountId: acct }))
    // An empty value keeps its long-standing "no filter" meaning.
    expect((await GET(new Request(`http://x/api?book_id=${BOOK}&account_id=`) as never)).status).toBe(200)
  })
})

describe("POST /api/admin/bookkeeping/entries", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ book_id: BOOK, direction: "expense", amount_cents: 4200, occurred_on: "2026-07-01" }),
    }) as never)
    expect(res.status).toBe(403)
    expect(createEntryMock).not.toHaveBeenCalled()
  })
  it("creates a manual entry", async () => {
    const returnedEntry = { id: "e9", memo: "Bands", direction: "expense", amount_cents: 4200, occurred_on: "2026-07-01" }
    createEntryMock.mockResolvedValue(returnedEntry)
    const res = await POST(new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ book_id: BOOK, direction: "expense", amount_cents: 4200, occurred_on: "2026-07-01" }),
    }) as never)
    expect(res.status).toBe(201)
    expect(createEntryMock).toHaveBeenCalledOnce()
    expect(createEntryMock).toHaveBeenCalledWith(expect.objectContaining({
      source: "manual",
      source_ref: null,
      direction: "expense",
      amount_cents: 4200,
      occurred_on: "2026-07-01",
    }))
    const json = await res.json()
    expect(json.entry).toEqual(returnedEntry)
  })
  it("400s invalid input", async () => {
    const res = await POST(new Request("http://x/api", {
      method: "POST", body: JSON.stringify({ book_id: BOOK, direction: "credit", amount_cents: -1, occurred_on: "nope" }),
    }) as never)
    expect(res.status).toBe(400)
  })
})
