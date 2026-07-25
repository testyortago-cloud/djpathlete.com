// __tests__/app/api/admin/bookkeeping/import-platform-scope.test.ts
// D(i): the platform-income commit route is a ledger write path, so it must run
// the same batch account-scope guard as statement commit and map
// AccountScopeError codes to 404 / 409 identically.
import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  insertImportedEntries: vi.fn().mockResolvedValue({ inserted: 1, rejected_closed: 0, rejected_closed_rows: [], skipped_alt_ref: 0 }),
  assertAccountsInBook: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
import { auth } from "@/lib/auth"
import { insertImportedEntries, assertAccountsInBook } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/import-platform/commit/route"

// Deliberately distinct so a mutation that swaps book_id for an account id (or
// hardcodes a direction) cannot keep these assertions green.
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT_A = "a0000000-0000-4000-8000-00000000000a"
const ACCOUNT_B = "a0000000-0000-4000-8000-00000000000b"
const ADMIN = "11111111-2222-4333-8444-555555555555"
const body = (b: unknown) => ({ json: async () => b }) as never
const incomeEntry = {
  direction: "income", amount_cents: 5000, occurred_on: "2026-07-01", memo: "pack",
  counterparty: null, service_line: "session_packs", source: "platform_import",
  source_ref: "client_packages:22222222-3333-4444-8555-666666666666", account_id: ACCOUNT_A,
}
const expenseEntry = {
  direction: "expense", amount_cents: 1200, occurred_on: "2026-07-02", memo: "processor fee",
  counterparty: null, service_line: null, source: "platform_import",
  source_ref: "stripe_fees:33333333-4444-4555-8666-777777777777", account_id: ACCOUNT_B,
}
const entries = [incomeEntry, expenseEntry]
beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: ADMIN, role: "admin" } })
  ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ inserted: 1, rejected_closed: 0, rejected_closed_rows: [], skipped_alt_ref: 0 })
})

describe("import-platform commit — batch account scope (D-i)", () => {
  it("409 on WRONG_BOOK and the insert never runs", async () => {
    ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_BOOK" }))
    const res = await POST(body({ book_id: BOOK, entries }))
    expect(res.status).toBe(409)
    expect(insertImportedEntries).not.toHaveBeenCalled()
  })
  it("409 on WRONG_TYPE and the insert never runs", async () => {
    ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_TYPE" }))
    const res = await POST(body({ book_id: BOOK, entries }))
    expect(res.status).toBe(409)
    expect(insertImportedEntries).not.toHaveBeenCalled()
  })
  it("404 on ACCOUNT_NOT_FOUND", async () => {
    ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "ACCOUNT_NOT_FOUND" }))
    expect((await POST(body({ book_id: BOOK, entries }))).status).toBe(404)
  })
  it("guard is handed the book id and every entry's own account + direction", async () => {
    ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const res = await POST(body({ book_id: BOOK, entries }))
    expect(res.status).toBe(200)
    expect(assertAccountsInBook).toHaveBeenCalledWith(BOOK, [
      { accountId: ACCOUNT_A, direction: "income" },
      { accountId: ACCOUNT_B, direction: "expense" },
    ])
    expect(insertImportedEntries).toHaveBeenCalled()
  })
  it("an entry with no account_id is passed through as accountId: null", async () => {
    ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const { account_id: _drop, ...noAccount } = expenseEntry
    const res = await POST(body({ book_id: BOOK, entries: [incomeEntry, noAccount] }))
    expect(res.status).toBe(200)
    expect(assertAccountsInBook).toHaveBeenCalledWith(BOOK, [
      { accountId: ACCOUNT_A, direction: "income" },
      { accountId: null, direction: "expense" },
    ])
  })
})
