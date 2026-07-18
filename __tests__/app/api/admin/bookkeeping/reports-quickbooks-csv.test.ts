import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getBook: vi.fn(), listEntriesForReports: vi.fn(), listAccountsForReports: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getBook, listEntriesForReports, listAccountsForReports } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { GET } from "@/app/api/admin/bookkeeping/reports/quickbooks-csv/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const BOOK = "b0000000-0000-4000-8000-000000000001"
const admin = { user: { id: UUID, role: "admin" } }
const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/reports/quickbooks-csv?${qs}`)
const okQs = `book_id=${BOOK}&from=2026-07-01&to=2026-07-31`

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
  ;(listAccountsForReports as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([
    { book_id: BOOK, account_id: null, direction: "income", amount_cents: 5000, occurred_on: "2026-07-02", counterparty: "Client A", memo: null, source: "manual" },
  ])
})

describe("GET /api/admin/bookkeeping/reports/quickbooks-csv", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req(okQs))).status).toBe(403)
  })
  it("400 without book_id", async () => {
    expect((await GET(req("from=2026-07-01&to=2026-07-31"))).status).toBe(400)
  })
  it("404 on unknown book", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req(okQs))).status).toBe(404)
  })
  it("streams a CSV attachment with the 4-column header, scoped to the book", async () => {
    const res = await GET(req(okQs))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="quickbooks-')
    expect(res.headers.get("cache-control")).toBe("no-store")
    const text = await res.text()
    expect(text.split("\r\n")[0]).toBe("Date,Description,Credit,Debit")
    expect(text).toContain("07/02/2026,Client A,50.00,")
    expect(listEntriesForReports).toHaveBeenCalledWith("2026-07-01", "2026-07-31", BOOK)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_exported",
      category: "admin_read_sensitive",
      metadata: expect.objectContaining({ format: "quickbooks_csv", row_count: 1 }),
    }))
  })
})
