// __tests__/app/api/admin/bookkeeping/entries-create-scope.test.ts
// D(i): manual entry create is a ledger write path — when the caller names an
// account it must pass the same scope check PATCH already runs, mapping
// AccountScopeError codes to 404 / 409. Uncategorized entries stay unguarded.
import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: vi.fn(), entryTotals: vi.fn(),
  createEntry: vi.fn().mockResolvedValue({ id: "e0000000-0000-4000-8000-000000000001", memo: null }),
  assertAccountInBook: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
import { auth } from "@/lib/auth"
import { createEntry, assertAccountInBook } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/entries/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000003"
const req = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never
const okBody = { book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-07-01", account_id: ACCOUNT }
beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  ;(createEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "e0000000-0000-4000-8000-000000000001", memo: null })
})

describe("entries POST — inline account scope (D-i)", () => {
  it("409 on WRONG_TYPE and createEntry never runs", async () => {
    ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_TYPE" }))
    const res = await POST(req(okBody))
    expect(res.status).toBe(409)
    expect(createEntry).not.toHaveBeenCalled()
  })
  it("409 on WRONG_BOOK and createEntry never runs", async () => {
    ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_BOOK" }))
    const res = await POST(req(okBody))
    expect(res.status).toBe(409)
    expect(createEntry).not.toHaveBeenCalled()
  })
  it("404 on ACCOUNT_NOT_FOUND", async () => {
    ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "ACCOUNT_NOT_FOUND" }))
    expect((await POST(req(okBody))).status).toBe(404)
  })
  it("guard runs with the entry's own book + direction, then creates", async () => {
    ;(assertAccountInBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const res = await POST(req(okBody))
    expect(res.status).toBe(201)
    expect(assertAccountInBook).toHaveBeenCalledWith(ACCOUNT, BOOK, "expense")
  })
  it("no account_id → guard skipped entirely (uncategorized entry unchanged)", async () => {
    const { account_id: _drop, ...noAccount } = okBody
    const res = await POST(req(noAccount))
    expect(res.status).toBe(201)
    expect(assertAccountInBook).not.toHaveBeenCalled()
  })
})
