import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listPostedForDedupeMock = vi.fn()
const listPayoutsForDedupeMock = vi.fn()
const listDocumentsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listPostedForDedupe: (...a: unknown[]) => listPostedForDedupeMock(...a),
  listPayoutsForDedupe: (...a: unknown[]) => listPayoutsForDedupeMock(...a),
  listDocuments: (...a: unknown[]) => listDocumentsMock(...a),
}))

import { POST } from "@/app/api/admin/bookkeeping/statement-import/dedupe/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"

interface RawRow {
  occurred_on: string
  amount_cents: number
  direction: "income" | "expense"
  description: string
  suggested_category: string | null
  is_transfer: boolean
  confidence: "low" | "medium" | "high"
}

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    occurred_on: "2026-01-05",
    amount_cents: 5000,
    direction: "expense",
    description: "Office Depot",
    suggested_category: null,
    is_transfer: false,
    confidence: "medium",
    ...overrides,
  }
}

function req(body: unknown): Request {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never
}

beforeEach(() => {
  authMock.mockReset()
  listPostedForDedupeMock.mockReset()
  listPayoutsForDedupeMock.mockReset()
  listDocumentsMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  listPostedForDedupeMock.mockResolvedValue([])
  listPayoutsForDedupeMock.mockResolvedValue([])
  listDocumentsMock.mockResolvedValue([])
})

describe("POST /api/admin/bookkeeping/statement-import/dedupe", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ book_id: BOOK, rows: [row()] }) as never)
    expect(res.status).toBe(403)
    expect(listPostedForDedupeMock).not.toHaveBeenCalled()
    expect(listDocumentsMock).not.toHaveBeenCalled()
  })

  it("400s on invalid input", async () => {
    const res = await POST(req({ book_id: "not-a-uuid", rows: [] }) as never)
    expect(res.status).toBe(400)
    expect(listPostedForDedupeMock).not.toHaveBeenCalled()
  })

  // Regression for C1: RTDB strips `null` leaf values on write, so an
  // uncategorized row's `suggested_category` comes back with the key
  // entirely absent, not `null`. Previously the schema's `.nullable()` (no
  // `.optional()`) rejected this with a 400, blocking every statement that
  // contained ANY uncategorized row from ever reaching review.
  it("does not 400 a row with suggested_category key entirely missing (RTDB null-stripping)", async () => {
    const { suggested_category: _drop, ...rowWithoutCategory } = row()
    const res = await POST(req({ book_id: BOOK, rows: [rowWithoutCategory] }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rows).toHaveLength(1)
  })

  it("short-circuits on empty rows with NO DAL read", async () => {
    const res = await POST(req({ book_id: BOOK, rows: [] }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ rows: [], excludedTransferTotalCents: 0, documentOverlapWarning: null })
    expect(listPostedForDedupeMock).not.toHaveBeenCalled()
    expect(listDocumentsMock).not.toHaveBeenCalled()
  })

  it("flags a row matching a posted income entry as a possible duplicate defaulted to excluded", async () => {
    listPostedForDedupeMock.mockResolvedValue([
      { id: "posted-1", occurred_on: "2026-01-04", amount_cents: 5000, direction: "income", memo: "Stripe payout", source: "platform_import" },
    ])
    const incomeRow = row({ direction: "income", amount_cents: 5000, description: "Client payment", occurred_on: "2026-01-05" })
    const res = await POST(req({ book_id: BOOK, rows: [incomeRow] }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(listPostedForDedupeMock).toHaveBeenCalledWith(BOOK, "2026-01-01", "2026-01-09")
    expect(json.rows).toHaveLength(1)
    expect(json.rows[0].possibleDuplicate).toBe(true)
    expect(json.rows[0].defaultInclude).toBe(false)
    expect(json.rows[0].matchedEntry).toEqual({ id: "posted-1", occurred_on: "2026-01-04", memo: "Stripe payout", source: "platform_import" })
  })

  it("sums excludedTransferTotalCents across is_transfer rows only", async () => {
    const transferRow = row({ is_transfer: true, amount_cents: 20000, description: "Owner draw" })
    const ordinaryRow = row({ amount_cents: 500, description: "Office Depot" })
    const res = await POST(req({ book_id: BOOK, rows: [transferRow, ordinaryRow] }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.excludedTransferTotalCents).toBe(20000)
  })

  it("returns a non-null documentOverlapWarning when a prior document's period overlaps the row span", async () => {
    listDocumentsMock.mockResolvedValue([
      { id: "doc-1", original_filename: "jan-statement.csv", period_start: "2026-01-01", period_end: "2026-01-10" },
    ])
    const res = await POST(req({ book_id: BOOK, rows: [row({ occurred_on: "2026-01-05" })] }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.documentOverlapWarning).not.toBeNull()
    expect(json.documentOverlapWarning).toContain("jan-statement.csv")
  })

  it("fetches payouts over the widened window and flags an exact payout-net deposit", async () => {
    listPayoutsForDedupeMock.mockResolvedValue([
      { id: "bp-1", stripe_payout_id: "po_1", net_cents: 5000, arrival_date: "2026-01-05", status: "paid" },
    ])
    const incomeRow = row({ direction: "income", amount_cents: 5000, description: "STRIPE PAYOUT", occurred_on: "2026-01-05" })
    const res = await POST(req({ book_id: BOOK, rows: [incomeRow] }) as never)
    expect(res.status).toBe(200)
    expect(listPayoutsForDedupeMock).toHaveBeenCalledWith(BOOK, "2026-01-01", "2026-01-09")
    const json = await res.json()
    expect(json.rows[0].possibleDuplicate).toBe(true)
    expect(json.rows[0].matchedPayoutId).toBe("bp-1")
    expect(json.rows[0].reason).toContain("po_1")
  })

  it("empty rows short-circuit still makes NO payout DAL read", async () => {
    await POST(req({ book_id: BOOK, rows: [] }) as never)
    expect(listPayoutsForDedupeMock).not.toHaveBeenCalled()
  })

  it("returns a null documentOverlapWarning when no prior document period overlaps", async () => {
    listDocumentsMock.mockResolvedValue([
      { id: "doc-1", original_filename: "old-statement.csv", period_start: "2025-01-01", period_end: "2025-01-10" },
    ])
    const res = await POST(req({ book_id: BOOK, rows: [row({ occurred_on: "2026-01-05" })] }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.documentOverlapWarning).toBeNull()
  })
})
