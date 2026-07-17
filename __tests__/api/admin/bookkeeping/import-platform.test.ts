import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listPlatformIncomeMock = vi.fn()
const insertImportedEntriesMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listPlatformIncome: (...a: unknown[]) => listPlatformIncomeMock(...a),
  insertImportedEntries: (...a: unknown[]) => insertImportedEntriesMock(...a),
}))

import { POST as PREVIEW } from "@/app/api/admin/bookkeeping/import-platform/route"
import { POST as COMMIT } from "@/app/api/admin/bookkeeping/import-platform/commit/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  authMock.mockReset(); listPlatformIncomeMock.mockReset(); insertImportedEntriesMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("import-platform preview", () => {
  it("403s non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await PREVIEW(new Request("http://x", { method: "POST", body: "{}" }) as never)
    expect(res.status).toBe(403)
    expect(listPlatformIncomeMock).not.toHaveBeenCalled()
  })
  it("returns drafts + warnings from real sources", async () => {
    listPlatformIncomeMock.mockResolvedValue({
      payments: [{ id: "11111111-1111-4111-8111-111111111111", user_id: null, stripe_payment_id: null,
        stripe_customer_id: null, amount_cents: 9900, currency: "usd", status: "succeeded",
        description: "Program purchase", metadata: { customerEmail: "a@b.com" },
        created_at: "2026-03-02T10:00:00Z", updated_at: "2026-03-02T10:00:00Z",
        gclid: null, gbraid: null, wbraid: null, fbclid: null }],
      shopOrders: [], clientPackages: [], eventSignups: [], memberships: [],
    })
    const res = await PREVIEW(new Request("http://x", { method: "POST",
      body: JSON.stringify({ book_id: BOOK, from: "2026-01-01", to: "2026-12-31" }) }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.drafts).toHaveLength(1)
    expect(json.drafts[0].source_ref).toBe("payments:11111111-1111-4111-8111-111111111111")
  })
  it("400s an oversized or reversed date range", async () => {
    const res = await PREVIEW(new Request("http://x", { method: "POST",
      body: JSON.stringify({ book_id: BOOK, from: "2020-01-01", to: "2026-12-31" }) }) as never)
    expect(res.status).toBe(400)
    expect(listPlatformIncomeMock).not.toHaveBeenCalled()
  })
})

describe("import-platform commit", () => {
  it("403s non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries: [
        { direction: "income", amount_cents: 9900, occurred_on: "2026-03-02", memo: "x",
          counterparty: "a@b.com", service_line: "performance_training", source: "platform_import", source_ref: "payments:1" },
      ] }) }) as never)
    expect(res.status).toBe(403)
    expect(insertImportedEntriesMock).not.toHaveBeenCalled()
  })
  it("400s an empty entries array", async () => {
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries: [] }) }) as never)
    expect(res.status).toBe(400)
    expect(insertImportedEntriesMock).not.toHaveBeenCalled()
  })
  it("posts reviewed drafts and returns inserted count", async () => {
    insertImportedEntriesMock.mockResolvedValue({ inserted: 2 })
    const entries = [
      { direction: "income", amount_cents: 9900, occurred_on: "2026-03-02", memo: "x",
        counterparty: "a@b.com", service_line: "performance_training", source: "platform_import", source_ref: "payments:1" },
      { direction: "income", amount_cents: 100, occurred_on: "2026-03-03", memo: "y",
        counterparty: null, service_line: "shop", source: "platform_import", source_ref: "shop_orders:2" },
    ]
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries }) }) as never)
    expect(res.status).toBe(200)
    expect(insertImportedEntriesMock).toHaveBeenCalledWith(BOOK, expect.any(String), entries)
    expect((await res.json()).inserted).toBe(2)
  })
})
