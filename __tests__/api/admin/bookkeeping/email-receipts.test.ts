import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listPendingMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listPendingEmailReceiptDocuments: (...a: unknown[]) => listPendingMock(...a),
}))

import { GET } from "@/app/api/admin/bookkeeping/email-receipts/route"

const DOC = {
  id: "d0000000-0000-4000-8000-000000000002",
  book_id: "b0000000-0000-4000-8000-000000000001",
  kind: "receipt",
  external_ref: "gmail:m1:0",
  posted_count: null,
  scan_result: {
    vendor: "Home Depot",
    amount_cents: 12555,
    occurred_on: "2026-07-20",
    suggested_category: "Equipment",
    business_purpose_hint: null,
    currency: "USD",
    confidence: "high",
    warnings: [],
  },
}

beforeEach(() => {
  authMock.mockReset()
  listPendingMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("GET /api/admin/bookkeeping/email-receipts", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET()).status).toBe(403)
    expect(listPendingMock).not.toHaveBeenCalled()
  })

  it("returns pending gmail receipt documents with their scan_result", async () => {
    listPendingMock.mockResolvedValue([DOC])
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).documents).toEqual([DOC])
  })

  it("500s when the DAL throws", async () => {
    listPendingMock.mockRejectedValue(new Error("boom"))
    expect((await GET()).status).toBe(500)
  })
})
