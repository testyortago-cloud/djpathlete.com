import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({ loadInsightsBundle: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listEntriesForInsights: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { GET } from "@/app/api/admin/bookkeeping/insights/route"
import { auth } from "@/lib/auth"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { recordAudit } from "@/lib/audit/record"
import { listEntriesForInsights } from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000003"
const ACC_MEALS = "a0000000-0000-4000-8000-000000000002"
const ACC_RENT = "a0000000-0000-4000-8000-000000000010"
const ACC_HH_SENSITIVE = "a0000000-0000-4000-8000-000000000011"

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", owner_label: null, sort_order: 0, archived_at: null, created_at: "", updated_at: "" },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false, currency: "usd", owner_label: null, sort_order: 2, archived_at: null, created_at: "", updated_at: "" },
]
const accounts = [
  { id: ACC_MEALS, book_id: BOOK_BIZ, name: "Meals (business purpose)", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: true, requires_business_purpose: true, archived_at: null },
  { id: ACC_RENT, book_id: BOOK_HH, name: "Rent", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: false, requires_business_purpose: false, archived_at: null },
  { id: ACC_HH_SENSITIVE, book_id: BOOK_HH, name: "HH Sensitive", account_type: "expense", service_line: null, tax_category: null, sort_order: 1, is_deductible_candidate: true, requires_business_purpose: true, archived_at: null },
]
// Page-window bundle entries. Dates are past-fixed → always ≥14 days aged at run time.
const entries = [
  { id: "e0000000-0000-4000-8000-000000000001", book_id: BOOK_BIZ, account_id: ACC_MEALS, direction: "expense", amount_cents: 2500, occurred_on: "2026-03-05", counterparty: "Chipotle", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000002", book_id: BOOK_HH, account_id: ACC_RENT, direction: "expense", amount_cents: 200000, occurred_on: "2026-03-01", counterparty: "Landlord", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000003", book_id: BOOK_HH, account_id: ACC_HH_SENSITIVE, direction: "expense", amount_cents: 5000, occurred_on: "2026-04-15", counterparty: "Privacy Vendor", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000004", book_id: BOOK_HH, account_id: null, direction: "expense", amount_cents: 1500, occurred_on: "2026-05-20", counterparty: "Unknown", memo: null, source: "manual", business_purpose: null, document_id: null },
]
// Dedicated YTD read (D-9). DIFFERENT from the bundle so wrong-source implementations fail.
const ytdEntries = [
  { id: "e0000000-0000-4000-8000-000000000101", book_id: BOOK_BIZ, account_id: null, direction: "income", amount_cents: 100000, occurred_on: "2026-02-01", counterparty: "Stripe", memo: null, source: "platform_import", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000102", book_id: BOOK_BIZ, account_id: ACC_MEALS, direction: "expense", amount_cents: 40000, occurred_on: "2026-02-10", counterparty: "Chipotle", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000103", book_id: BOOK_HH, account_id: ACC_RENT, direction: "expense", amount_cents: 200000, occurred_on: "2026-02-01", counterparty: "Landlord", memo: null, source: "manual", business_purpose: null, document_id: null },
]

const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/insights?${qs}`)

function settings(homeOffice: unknown, taxRate: unknown) {
  ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
    key === "bookkeeping_home_office_percent" ? homeOffice : key === "bookkeeping_tax_rate_percent" ? taxRate : null,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(loadInsightsBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books, accounts, entries })
  ;(listEntriesForInsights as ReturnType<typeof vi.fn>).mockResolvedValue(ytdEntries)
  settings(25, 25)
})

describe("GET /api/admin/bookkeeping/insights", () => {
  it("403 when unauthenticated or non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "x", role: "client" } })
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    expect(loadInsightsBundle).not.toHaveBeenCalled()
    expect(listEntriesForInsights).not.toHaveBeenCalled()
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
    const hh = body.books.find((b: { book: { id: string } }) => b.book.id === BOOK_HH)
    expect(biz.deductions.substantiation_gaps).toHaveLength(1)
    expect(biz.row_count).toBe(1)
    // cross-book regression: household rent never in the business watchlist
    expect(biz.deductions.watchlist_total_cents).toBe(2500)
    expect(body.home_office.input_total_cents).toBe(200000)
    expect(body.home_office.proposed_total_cents).toBe(50000)
    expect(body.home_office.target_book_id).toBe(BOOK_BIZ)
    // year_end_flags must exclude household pollution: substantiation_gaps flag counts only business gaps (1, not 2)
    const gapsFlag = body.year_end_flags.find((f: { id: string }) => f.id === "substantiation_gaps")
    expect(gapsFlag).toBeDefined()
    expect(gapsFlag.title).toContain("1")
    // uncategorized_expenses should not be in flags (only household entry is uncategorized, filtered out)
    expect(body.year_end_flags.map((f: { id: string }) => f.id)).not.toContain("uncategorized_expenses")
    // but household book's own payload still reports its gap (fixture is live)
    expect(hh.deductions.substantiation_gaps).toHaveLength(1)
  })
  it("junk stored percent is coerced to null (no proposal)", async () => {
    settings("25", 25)
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

  // ─── Phase 6b: forecast + watchdog sections ────────────────────────────────
  it("forecast: dedicated YTD read (Jan-1 window, independent of the page window), business books only, home-office subtracted on the primary book", async () => {
    const res = await GET(req("from=2026-06-01&to=2026-06-30"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // ONE dedicated YTD read with a Jan-1 window — NOT the page's from/to (D-9)
    expect(listEntriesForInsights).toHaveBeenCalledTimes(1)
    const [ytdFrom, ytdTo] = (listEntriesForInsights as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(ytdFrom).toMatch(/^\d{4}-01-01$/)
    expect(ytdTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.forecast.ytd_from).toBe(ytdFrom)
    expect(body.forecast.ytd_to).toBe(ytdTo)
    expect(body.forecast.rate_percent).toBe(25)
    // household book gets NO forecast row
    expect(body.forecast.books).toHaveLength(1)
    const biz = body.forecast.books[0]
    expect(biz.book_id).toBe(BOOK_BIZ)
    expect(biz.book_name).toBe("Darren — DJP Athlete")
    // 100000 − 40000 − (200000 × 25% = 50000 home-office, primary book only) = 10000 net → × 25% = 2500 tax.
    // Computed from the PAGE bundle instead, net would be −2500−50000 → tax 0 — this pins the YTD source.
    expect(biz.forecast.ytd_income_cents).toBe(100000)
    expect(biz.forecast.ytd_expense_cents).toBe(40000)
    expect(biz.forecast.home_office_deduction_cents).toBe(50000)
    expect(biz.forecast.estimated_net_cents).toBe(10000)
    expect(biz.forecast.estimated_tax_cents).toBe(2500)
    expect(biz.forecast.next_safe_harbor.date > ytdTo).toBe(true)
  })
  it("no tax rate → NULL estimated tax (the card shows a prompt, never a dollar figure)", async () => {
    settings(25, null)
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    expect(body.forecast.rate_percent).toBeNull()
    expect(body.forecast.books[0].forecast.estimated_tax_cents).toBeNull()
  })
  it("junk stored tax rate is coerced to null", async () => {
    settings(25, "25")
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    expect(body.forecast.rate_percent).toBeNull()
  })
  it("watchdog: computed from the PAGE window's entries (not the YTD read); unwatched + uncategorized excluded", async () => {
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    // Bundle has two watched aged gaps (5000 HH-Sensitive, 2500 Meals); Rent (unwatched)
    // and the account-null entry are excluded. From ytdEntries this would be ONE finding
    // (40000) — the amounts pin the source AND the amount-desc sort.
    expect(body.watchdog.map((f: { amount_cents: number }) => f.amount_cents)).toEqual([5000, 2500])
    expect(body.watchdog[0].reasons).toEqual(["no_document", "no_purpose"])
    expect(body.watchdog[0].book_id).toBe(BOOK_HH)
  })
})
