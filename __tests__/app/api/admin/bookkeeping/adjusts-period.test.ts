import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: vi.fn(),
  entryTotals: vi.fn(),
  createEntry: vi.fn(),
  getAccount: vi.fn(),
  assertAccountInBook: vi.fn(),
}))

import { POST as ENTRIES_POST } from "@/app/api/admin/bookkeeping/entries/route"
import { POST as CASH_POST } from "@/app/api/admin/bookkeeping/receipts/cash/route"
import { auth } from "@/lib/auth"
import { createEntry, getAccount } from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(createEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "e1", memo: null })
  ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: ACCOUNT, book_id: BOOK, account_type: "expense", requires_business_purpose: false,
  })
})

describe("adjusts_period plumbing", () => {
  it("POST /entries forwards adjusts_period to createEntry", async () => {
    const res = await ENTRIES_POST(post({
      book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-02-01", adjusts_period: "2019-01",
    }))
    expect(res.status).toBe(201)
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ adjusts_period: "2019-01" }))
  })
  it("POST /entries defaults it to null when absent", async () => {
    await ENTRIES_POST(post({ book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-02-01" }))
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ adjusts_period: null }))
  })
  it("POST /entries 400s a malformed adjusts_period", async () => {
    const res = await ENTRIES_POST(post({
      book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-02-01", adjusts_period: "2019-13",
    }))
    expect(res.status).toBe(400)
    expect(createEntry).not.toHaveBeenCalled()
  })
  it("POST /receipts/cash always writes adjusts_period: null (receipts are not adjustments)", async () => {
    const res = await CASH_POST(post({
      book_id: BOOK, account_id: ACCOUNT, amount_cents: 100, occurred_on: "2026-02-01",
    }))
    expect(res.status).toBe(201)
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ adjusts_period: null }))
  })
})
