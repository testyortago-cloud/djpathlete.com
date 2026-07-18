import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))

import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { GET } from "@/app/api/admin/bookkeeping/reports/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const BOOK = "b0000000-0000-4000-8000-000000000001"
const admin = { user: { id: UUID, role: "admin" } }
const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/reports?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({
    books: [{ id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", sort_order: 0 }],
    accounts: [],
    entries: [
      { book_id: BOOK, account_id: null, direction: "income", amount_cents: 1500, occurred_on: "2026-07-02", counterparty: null, memo: null, source: "manual" },
      { book_id: BOOK, account_id: null, direction: "expense", amount_cents: 400, occurred_on: "2026-07-03", counterparty: null, memo: null, source: "manual" },
    ],
  })
})

describe("GET /api/admin/bookkeeping/reports", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    const res = await GET(req("from=2026-07-01&to=2026-07-31"))
    expect(res.status).toBe(403)
  })
  it("400 on a bad window", async () => {
    expect((await GET(req("from=2026-08-01&to=2026-07-01"))).status).toBe(400)
    expect((await GET(req("to=2026-07-31"))).status).toBe(400)
  })
  it("aggregates per book and reports row_count", async () => {
    const res = await GET(req("from=2026-07-01&to=2026-07-31"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.books).toHaveLength(1)
    expect(body.books[0].summary).toMatchObject({ income_cents: 1500, expense_cents: 400, net_cents: 1100, entry_count: 2 })
    expect(body.books[0].row_count).toBe(2)
    expect(body.books[0].pnl.net_cents).toBe(1100)
    expect(loadReportBundle).toHaveBeenCalledWith("2026-07-01", "2026-07-31")
  })
})
