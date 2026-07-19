import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
const getEntryMock = vi.fn()
const updateEntryMock = vi.fn()
const assertAccountInBookMock = vi.fn()
vi.mock("@/lib/db/bookkeeping", () => ({
  getEntry: (...a: unknown[]) => getEntryMock(...a),
  updateEntry: (...a: unknown[]) => updateEntryMock(...a),
  deleteEntry: vi.fn(),
  assertAccountInBook: (...a: unknown[]) => assertAccountInBookMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { PATCH } from "@/app/api/admin/bookkeeping/entries/[id]/route"

const ID = "e0000000-0000-4000-8000-000000000001"
const ACC = "a0000000-0000-4000-8000-000000000001"

function req(body: unknown): Request {
  return new Request(`http://x/api/admin/bookkeeping/entries/${ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: ID }) }

function entry(over: Record<string, unknown> = {}) {
  return { id: ID, book_id: "b1", direction: "income", source: "platform_import", ...over }
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1", role: "admin" } })
  getEntryMock.mockReset()
  updateEntryMock.mockReset().mockResolvedValue(entry())
  assertAccountInBookMock.mockReset().mockResolvedValue(undefined)
})

describe("PATCH locked fields on imported entries", () => {
  it.each([
    ["amount_cents", { amount_cents: 5000 }],
    ["occurred_on", { occurred_on: "2026-07-01" }],
    ["direction", { direction: "expense" }],
    ["adjusts_period", { adjusts_period: "2026-06" }],
  ])("422 when %s present on a platform_import entry", async (_name, body) => {
    getEntryMock.mockResolvedValue(entry())
    const res = await PATCH(req(body), ctx)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe("amount, date and direction are locked on imported entries")
    expect(updateEntryMock).not.toHaveBeenCalled()
  })

  it("allows the editable fields on an imported entry", async () => {
    getEntryMock.mockResolvedValue(entry())
    const res = await PATCH(req({ account_id: ACC, memo: "Cannon Baller! — program purchase", counterparty: "Cannon Kremer", business_purpose: null }), ctx)
    expect(res.status).toBe(200)
    expect(assertAccountInBookMock).toHaveBeenCalledWith(ACC, "b1", "income")
    expect(updateEntryMock).toHaveBeenCalledWith(ID, expect.objectContaining({ account_id: ACC, memo: "Cannon Baller! — program purchase" }))
  })

  it("manual entries keep full editability", async () => {
    getEntryMock.mockResolvedValue(entry({ source: "manual" }))
    const res = await PATCH(req({ amount_cents: 123, occurred_on: "2026-07-02", direction: "expense" }), ctx)
    expect(res.status).toBe(200)
    expect(updateEntryMock).toHaveBeenCalled()
  })

  it("404s on a missing entry even without account_id", async () => {
    getEntryMock.mockResolvedValue(null)
    const res = await PATCH(req({ memo: "x" }), ctx)
    expect(res.status).toBe(404)
    expect(updateEntryMock).not.toHaveBeenCalled()
  })
})
