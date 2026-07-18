import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { buildAccountantPack, sanitizeSheetName } from "@/lib/bookkeeping/accountant-pack"
import type { ReportEntry, ReportAccount } from "@/lib/bookkeeping/reports"
import type { BookkeepingBook, BookkeepingDocument } from "@/types/database"

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
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Spouse", "P&L — Household", "Documents",
    ])
    const summary = wb.getWorksheet("Summary")!
    // header + 3 book rows
    expect(summary.actualRowCount).toBe(4)
    expect(String(summary.getRow(2).getCell(3).value)).toBe("$1,502.00") // Darren income
    const readme = wb.getWorksheet("Read Me")!
    const readmeText = JSON.stringify(readme.getSheetValues())
    expect(readmeText).toContain("GROSS")
    expect(readmeText).toContain("CPA")
  })
  it("spouse sheet carries the explicit empty note when the book has no entries", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const spouse = wb.getWorksheet("P&L — Spouse")!
    expect(JSON.stringify(spouse.getSheetValues())).toContain("No entries recorded for this period")
  })
  it("document index lists every document with a download ref", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const docs = wb.getWorksheet("Documents")!
    const text = JSON.stringify(docs.getSheetValues())
    expect(text).toContain("hd-receipt.jpg")
    expect(text).toContain("/api/admin/bookkeeping/documents/d0000000-0000-4000-8000-000000000001/download")
  })
  it("Darren's P&L sheet contains only Darren's amounts — no cross-book leakage", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const darren = wb.getWorksheet("P&L — Darren")!
    const text = JSON.stringify(darren.getSheetValues())
    expect(text).toContain("$1,502.00") // Darren's own income
    expect(text).not.toContain("$999.99") // household-only expense must not leak in
    expect(text).not.toContain("$1,200.00") // household-only rent must not leak in
  })
  it("Income by Service reflects only the primary book — no cross-book leakage", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
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
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books: triple, accounts: [], entries: [], documents: [] })
    const wb = await load(buf)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Darren (2)", "P&L — Darren (3)", "Documents",
    ])
  })
})
