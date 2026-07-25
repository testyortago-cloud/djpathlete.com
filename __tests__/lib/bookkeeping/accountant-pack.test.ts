import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { buildAccountantPack, sanitizeSheetName } from "@/lib/bookkeeping/accountant-pack"
import type { ReportEntry, ReportAccount } from "@/lib/bookkeeping/reports"
import type { BookkeepingAsset, BookkeepingBook, BookkeepingDocument } from "@/types/database"

const B1 = "b0000000-0000-4000-8000-000000000001"
const B2 = "b0000000-0000-4000-8000-000000000002"
const B3 = "b0000000-0000-4000-8000-000000000003"
const ACC = "a0000000-0000-4000-8000-000000000001"

const books = [
  { id: B1, name: "Darren — DJP Athlete", book_kind: "business", owner_label: "Darren", is_primary: true, currency: "usd", sort_order: 0 },
  { id: B2, name: "Spouse — Business", book_kind: "business", owner_label: "Spouse", is_primary: false, currency: "usd", sort_order: 1 },
  { id: B3, name: "Household & Personal", book_kind: "household", owner_label: "Household", is_primary: false, currency: "usd", sort_order: 2 },
] as BookkeepingBook[]

const accounts: ReportAccount[] = [
  { id: ACC, book_id: B1, name: "Session Packs", account_type: "income", service_line: "session_packs", tax_category: null, sort_order: 0 },
]

const entries: ReportEntry[] = [
  { book_id: B1, account_id: ACC, direction: "income", amount_cents: 150200, occurred_on: "2026-07-02", counterparty: "Client A", memo: null, source: "platform_import" },
  // Primary-book EXPENSE: makes income (150200) ≠ net (100200) so the Summary's
  // "Income after fees" column discriminates income−fee from net−fee.
  { book_id: B1, account_id: null, direction: "expense", amount_cents: 50000, occurred_on: "2026-07-05", counterparty: "Gym Rent", memo: null, source: "manual" },
  { book_id: B3, account_id: null, direction: "expense", amount_cents: 120000, occurred_on: "2026-07-03", counterparty: "Landlord", memo: "July rent", source: "statement_import" },
  // Household-only amount — must never leak into Darren's (or any other book's) sheet.
  { book_id: B3, account_id: null, direction: "expense", amount_cents: 99999, occurred_on: "2026-07-04", counterparty: "Misc Vendor", memo: "household misc", source: "manual" },
]

const documents = [
  { id: "d0000000-0000-4000-8000-000000000001", book_id: B1, kind: "receipt", original_filename: "hd-receipt.jpg", storage_path: "x", mime_type: "image/jpeg", file_size_bytes: 1, sha256: null, retain_until: "2033-12-31", uploaded_by: null, import_batch_id: null, row_count: null, posted_count: 1, period_start: null, period_end: null, created_at: "2026-07-03T00:00:00Z", updated_at: "2026-07-03T00:00:00Z" },
] as BookkeepingDocument[]

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as never)
  return wb
}

describe("sanitizeSheetName", () => {
  it("strips Excel-forbidden chars and caps at 31", () => {
    expect(sanitizeSheetName("P&L: a/very[long]name?*that\\keeps//going and going")).toHaveLength(31)
    expect(sanitizeSheetName("a:b")).not.toContain(":")
    expect(sanitizeSheetName("   ")).toBe("Sheet")
  })
})

describe("buildAccountantPack", () => {
  it("builds the expected tabs with formatCents money and the honesty sheet", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 4550 })
    const wb = await load(buf)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Spouse", "P&L — Household", "Documents",
    ])
    expect(names).not.toContain("Depreciation") // no assets → no sheet, no empty tab
    const summary = wb.getWorksheet("Summary")!
    // header + 3 book rows
    expect(summary.actualRowCount).toBe(4)
    expect(String(summary.getRow(2).getCell(3).value)).toBe("$1,502.00") // Darren income
    const readme = wb.getWorksheet("Read Me")!
    const readmeText = JSON.stringify(readme.getSheetValues())
    expect(readmeText).toContain("GROSS")
    expect(readmeText).toContain("CPA")
    // Fee 4550 is a mutation discriminator: $45.50 and income-after-fees
    // $1,456.50 (1502.00 − 45.50) appear nowhere else in the fixture arithmetic.
    const svcText = JSON.stringify(wb.getWorksheet("Income by Service")!.getSheetValues())
    expect(svcText).toContain("Stripe processing fees")
    expect(svcText).toContain("$45.50")
    expect(svcText).toContain("Net income after Stripe fees")
    expect(svcText).toContain("$1,456.50")
    expect(readmeText).toContain("net after fees")
    // Summary columns by ADDRESS — the fee columns are income-side and must not
    // be confusable with column 5 "Net" (income − expenses = $1,002.00). If the
    // fee column ever computed net−fee it would read $956.50 here.
    const darrenRow = summary.getRow(2)
    expect(String(darrenRow.getCell(5).value)).toBe("$1,002.00")
    expect(String(darrenRow.getCell(7).value)).toBe("−$45.50")
    expect(String(darrenRow.getCell(8).value)).toBe("$1,456.50")
    expect(summary.getRow(1).getCell(8).value).toBe("Income after fees (est.)")
  })
  it("fee columns attach to the PRIMARY BUSINESS book only — spouse/household stay blank", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 4550 })
    const wb = await load(buf)
    const summary = wb.getWorksheet("Summary")!
    // Row 3 = Spouse — Business (business, NOT primary): widening the guard to
    // book_kind alone would hand it the coach's entire Stripe fee bill.
    for (const rowNo of [3, 4]) {
      expect(summary.getRow(rowNo).getCell(7).value ?? "").toBe("")
      expect(summary.getRow(rowNo).getCell(8).value ?? "").toBe("")
    }
    expect(String(summary.getRow(3).getCell(1).value)).toBe("Spouse — Business")
  })
  it("zero fees never assert '$0.00 fees' — both sheets hedge and the Read Me says why", async () => {
    // The payout-sync flag ships OFF, so this is the state on arrival: the pack
    // is the artifact that leaves the building (Resend → CPA).
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 0 })
    const wb = await load(buf)
    const summary = wb.getWorksheet("Summary")!
    expect(String(summary.getRow(2).getCell(7).value)).toContain("no payouts ingested")
    expect(String(summary.getRow(2).getCell(8).value)).toContain("available after the first payout sync")
    // Never restates gross income under an after-fees label.
    expect(String(summary.getRow(2).getCell(8).value)).not.toContain("$1,502.00")
    const svcText = JSON.stringify(wb.getWorksheet("Income by Service")!.getSheetValues())
    expect(svcText).toContain("no payouts ingested")
    expect(svcText).toContain("available after the first payout sync")
    const readmeText = JSON.stringify(wb.getWorksheet("Read Me")!.getSheetValues())
    expect(readmeText).toContain("not a claim that no fees were charged")
  })
  it("spouse sheet carries the explicit empty note when the book has no entries", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 0 })
    const wb = await load(buf)
    const spouse = wb.getWorksheet("P&L — Spouse")!
    expect(JSON.stringify(spouse.getSheetValues())).toContain("No entries recorded for this period")
  })
  it("document index lists every document with a download ref", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 0 })
    const wb = await load(buf)
    const docs = wb.getWorksheet("Documents")!
    const text = JSON.stringify(docs.getSheetValues())
    expect(text).toContain("hd-receipt.jpg")
    expect(text).toContain("/api/admin/bookkeeping/documents/d0000000-0000-4000-8000-000000000001/download")
  })
  it("Darren's P&L sheet contains only Darren's amounts — no cross-book leakage", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 0 })
    const wb = await load(buf)
    const darren = wb.getWorksheet("P&L — Darren")!
    const text = JSON.stringify(darren.getSheetValues())
    expect(text).toContain("$1,502.00") // Darren's own income
    expect(text).not.toContain("$999.99") // household-only expense must not leak in
    expect(text).not.toContain("$1,200.00") // household-only rent must not leak in
  })
  it("Income by Service reflects only the primary book — no cross-book leakage", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents, assets: [], stripe_fee_cents: 0 })
    const wb = await load(buf)
    const svc = wb.getWorksheet("Income by Service")!
    const text = JSON.stringify(svc.getSheetValues())
    expect(text).toContain("Session Packs")
    expect(text).toContain("$1,502.00")
    expect(text).not.toContain("$999.99")
    expect(text).not.toContain("$1,200.00")
  })
  it("de-dupes a triple sheet-name collision by suffixing from the base name each time", async () => {
    const triple = [
      { id: B1, name: "Darren Co", book_kind: "business", owner_label: "Darren", is_primary: true, currency: "usd", sort_order: 0 },
      { id: B2, name: "Darren Co 2", book_kind: "business", owner_label: "Darren", is_primary: false, currency: "usd", sort_order: 1 },
      { id: B3, name: "Darren Co 3", book_kind: "business", owner_label: "Darren", is_primary: false, currency: "usd", sort_order: 2 },
    ] as BookkeepingBook[]
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books: triple, accounts: [], entries: [], documents: [], assets: [], stripe_fee_cents: 0 })
    const wb = await load(buf)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Darren (2)", "P&L — Darren (3)", "Documents",
    ])
  })
})

describe("buildAccountantPack — Depreciation sheet (Phase 6d)", () => {
  const assets = [
    { // Darren: 10000¢/3yr full-month Jan-2024 → 3333/3333/3334; 2026 is the final (remainder) year
      id: "ad000000-0000-4000-8000-000000000001", book_id: B1, name: "Squat Rack",
      basis_cents: 10000, salvage_cents: 0, in_service_on: "2024-01-15",
      method: "straight_line", convention: "full_month", recovery_years: 3,
      accountant_note: "life per CPA", created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
    },
    { // Household: 240000¢/5yr full-month Jun-2025 → 2025 = round(48000·7/12) = 28000; 2026 = 48000; thru 2026 = 76000
      id: "ad000000-0000-4000-8000-000000000002", book_id: B3, name: "Garage Shelving",
      basis_cents: 240000, salvage_cents: 0, in_service_on: "2025-06-10",
      method: "straight_line", convention: "full_month", recovery_years: 5,
      accountant_note: null, created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
    },
  ] as BookkeepingAsset[]

  it("sits after the per-book P&L sheets and before Documents", async () => {
    const buf = await buildAccountantPack({ from: "2026-01-01", to: "2026-07-31", books, accounts, entries, documents, assets, stripe_fee_cents: 0 })
    const wb = await load(buf)
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Spouse", "P&L — Household", "Depreciation", "Documents",
    ])
  })

  it("computes this-year + accumulated for the window's END year, per row, with the right book label", async () => {
    const buf = await buildAccountantPack({ from: "2026-01-01", to: "2026-07-31", books, accounts, entries, documents, assets, stripe_fee_cents: 0 })
    const wb = await load(buf)
    const sheet = wb.getWorksheet("Depreciation")!
    // Row 2 = Squat Rack (as passed): final-remainder year 2026 → $33.34 this year, $100.00 accumulated.
    const darren = sheet.getRow(2)
    expect(String(darren.getCell(1).value)).toBe("Squat Rack")
    expect(String(darren.getCell(2).value)).toBe("Darren — DJP Athlete")
    expect(String(darren.getCell(9).value)).toBe("$33.34")
    expect(String(darren.getCell(10).value)).toBe("$100.00")
    // Row 3 = Garage Shelving, labeled with ITS book — cross-book rows never merge or swap.
    const household = sheet.getRow(3)
    expect(String(household.getCell(1).value)).toBe("Garage Shelving")
    expect(String(household.getCell(2).value)).toBe("Household & Personal")
    expect(String(household.getCell(9).value)).toBe("$480.00")
    expect(String(household.getCell(10).value)).toBe("$760.00")
    // Cross-book exclusion at row level (the Phase-4 lesson): the household numbers
    // must not appear anywhere in Darren's row.
    expect(JSON.stringify(darren.values)).not.toContain("$480.00")
    expect(JSON.stringify(darren.values)).not.toContain("$760.00")
  })

  it("carries the tracked-not-decided honesty line", async () => {
    const buf = await buildAccountantPack({ from: "2026-01-01", to: "2026-07-31", books, accounts, entries, documents, assets, stripe_fee_cents: 0 })
    const wb = await load(buf)
    const text = JSON.stringify(wb.getWorksheet("Depreciation")!.getSheetValues())
    expect(text).toContain("tracked, not decided")
    expect(text).toContain("not a filing")
  })
})
