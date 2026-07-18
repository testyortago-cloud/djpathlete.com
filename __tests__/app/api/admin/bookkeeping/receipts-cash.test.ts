import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getAccount: vi.fn(), assertAccountInBook: vi.fn(), createEntry: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getAccount, createEntry } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/receipts/cash/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin) })

describe("POST /api/admin/bookkeeping/receipts/cash", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    const res = await POST(body({}))
    expect(res.status).toBe(403)
  })

  it("400 on invalid input", async () => {
    const res = await POST(body({ book_id: "not-a-uuid" }))
    expect(res.status).toBe(400)
  })

  it("409 when account is not in the book", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID, book_id: "22222222-2222-4333-8444-555555555555", account_type: "expense", requires_business_purpose: false,
    })
    const res = await POST(body({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18" }))
    expect(res.status).toBe(409)
    expect(createEntry).not.toHaveBeenCalled()
  })

  it("409 when account is not an expense category", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: UUID, book_id: UUID, account_type: "income", requires_business_purpose: false,
    })
    const res = await POST(body({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18" }))
    expect(res.status).toBe(409)
    expect(createEntry).not.toHaveBeenCalled()
  })

  it("422 when a sensitive account has no business_purpose", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID, account_type: "expense", requires_business_purpose: true })
    const res = await POST(body({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18" }))
    expect(res.status).toBe(422)
    expect(createEntry).not.toHaveBeenCalled()
  })

  it("posts a source=receipt expense entry", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID, account_type: "expense", requires_business_purpose: false })
    ;(createEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, memo: null })
    const res = await POST(body({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18", counterparty: "Gas Station" }))
    expect(res.status).toBe(201)
    const arg = (createEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      book_id: UUID, account_id: UUID, source: "receipt", direction: "expense",
      source_ref: null, import_batch_id: null, document_id: null, amount_cents: 1200,
    })
  })
})
