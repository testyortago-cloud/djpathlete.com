import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({ loadInsightsBundle: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { GET } from "@/app/api/admin/bookkeeping/insights/route"
import { auth } from "@/lib/auth"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { recordAudit } from "@/lib/audit/record"
import { getSetting } from "@/lib/db/system-settings"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000003"
const ACC_MEALS = "a0000000-0000-4000-8000-000000000002"
const ACC_RENT = "a0000000-0000-4000-8000-000000000010"

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", owner_label: null, sort_order: 0, archived_at: null, created_at: "", updated_at: "" },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false, currency: "usd", owner_label: null, sort_order: 2, archived_at: null, created_at: "", updated_at: "" },
]
const accounts = [
  { id: ACC_MEALS, book_id: BOOK_BIZ, name: "Meals (business purpose)", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: true, requires_business_purpose: true, archived_at: null },
  { id: ACC_RENT, book_id: BOOK_HH, name: "Rent", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: false, requires_business_purpose: false, archived_at: null },
]
const entries = [
  { id: "e0000000-0000-4000-8000-000000000001", book_id: BOOK_BIZ, account_id: ACC_MEALS, direction: "expense", amount_cents: 2500, occurred_on: "2026-03-05", counterparty: "Chipotle", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000002", book_id: BOOK_HH, account_id: ACC_RENT, direction: "expense", amount_cents: 200000, occurred_on: "2026-03-01", counterparty: "Landlord", memo: null, source: "manual", business_purpose: null, document_id: null },
]

const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/insights?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(loadInsightsBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books, accounts, entries })
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(25)
})

describe("GET /api/admin/bookkeeping/insights", () => {
  it("403 when unauthenticated or non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "x", role: "client" } })
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    expect(loadInsightsBundle).not.toHaveBeenCalled()
  })
  it("400 on a bad window", async () => {
    expect((await GET(req("from=2026-12-31&to=2026-01-01"))).status).toBe(400)
    expect((await GET(req("from=nope&to=2026-01-01"))).status).toBe(400)
  })
  it("200: per-book findings, home_office at top level, percent passthrough", async () => {
    const res = await GET(req("from=2026-01-01&to=2026-12-31"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(loadInsightsBundle).toHaveBeenCalledWith("2026-01-01", "2026-12-31")
    expect(body.home_office_percent).toBe(25)
    expect(body.books).toHaveLength(2)
    const biz = body.books.find((b: { book: { id: string } }) => b.book.id === BOOK_BIZ)
    expect(biz.deductions.substantiation_gaps).toHaveLength(1)
    expect(biz.row_count).toBe(1)
    // cross-book regression: household rent never in the business watchlist
    expect(biz.deductions.watchlist_total_cents).toBe(2500)
    expect(body.home_office.input_total_cents).toBe(200000)
    expect(body.home_office.proposed_total_cents).toBe(50000)
    expect(body.home_office.target_book_id).toBe(BOOK_BIZ)
    // gaps flag derives from BUSINESS books
    expect(body.year_end_flags.map((f: { id: string }) => f.id)).toContain("substantiation_gaps")
  })
  it("junk stored percent is coerced to null (no proposal)", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue("25")
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    expect(body.home_office_percent).toBeNull()
    expect(body.home_office.proposed_total_cents).toBeNull()
  })
  it("never audits (JSON screen-read precedent) and 500s on loader failure", async () => {
    await GET(req("from=2026-01-01&to=2026-12-31"))
    expect(recordAudit).not.toHaveBeenCalled()
    ;(loadInsightsBundle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(500)
  })
})
