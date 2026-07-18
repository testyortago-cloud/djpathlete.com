import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  insertImportedEntries: vi.fn().mockResolvedValue({ inserted: 1 }),
  linkDocumentBatch: vi.fn(),
  assertAccountsInBook: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
import { auth } from "@/lib/auth"
import { assertAccountsInBook } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/statement-import/commit/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const SHA = "a".repeat(40)
const body = (b: unknown) => ({ json: async () => b }) as never
beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } }) })

describe("statement-import commit — batch account scope", () => {
  it("409 when an account fails the batch scope check", async () => {
    ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_BOOK" }))
    const res = await POST(body({ book_id: UUID, entries: [{ direction: "expense", amount_cents: 100, occurred_on: "2026-07-01", memo: "x", counterparty: null, service_line: null, source: "statement_import", source_ref: `statement:${SHA}`, account_id: UUID }] }))
    expect(res.status).toBe(409)
  })
})
