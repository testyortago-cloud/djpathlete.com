/** Accountant pack workbook (D9): one .xlsx, a tab per question the
 *  accountant asks. Zero IO — the route fetches and passes plain arrays.
 *  All money renders as formatCents strings (spec §3.7 — no float cells).
 *  Styling follows the lib/excel-templates.ts ARGB conventions. */
import ExcelJS from "exceljs"
import { formatCents } from "@/lib/bookkeeping/money"
import { feeLineDisplay, netAfterFeesDisplay } from "@/lib/bookkeeping/fee-lines"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ReportAccount, type ReportEntry,
} from "@/lib/bookkeeping/reports"
import { depreciationAsOf } from "@/lib/bookkeeping/depreciation"
import type { BookkeepingAsset, BookkeepingBook, BookkeepingDocument } from "@/types/database"

export interface AccountantPackInput {
  from: string
  to: string
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  documents: BookkeepingDocument[]
  assets: BookkeepingAsset[]
  /** Windowed Stripe processing fees (Track A §1.4). Report-layer only — never
   *  a ledger row. Attaches to the primary business book alone. */
  stripe_fee_cents: number
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E3F50" } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
const THIN = { style: "thin" as const, color: { argb: "FFE5E7EB" } }
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const TAB_PRIMARY = "FF0E3F50"
const TAB_ACCENT = "FFC49B7A"
const TAB_GRAY = "FF6B7280"
const DOWNLOAD_BASE = "https://www.darrenjpaul.com"

export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim()
  return (cleaned || "Sheet").slice(0, 31)
}

function addSheet(wb: ExcelJS.Workbook, name: string, tabColor: string, used: Set<string>): ExcelJS.Worksheet {
  const base = sanitizeSheetName(name)
  let candidate = base
  let n = 2
  while (used.has(candidate.toLowerCase())) candidate = sanitizeSheetName(`${base.slice(0, 26)} (${n++})`)
  used.add(candidate.toLowerCase())
  return wb.addWorksheet(candidate, { properties: { tabColor: { argb: tabColor } } })
}

function headerRow(sheet: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  sheet.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] }))
  const row = sheet.getRow(1)
  row.height = 24
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: "middle", horizontal: "left" }
    cell.border = BORDER
  })
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }]
}

function noteRow(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text])
  row.getCell(1).font = { italic: true, color: { argb: "FF6B7280" }, size: 10 }
}

/** P&L tab for one book. Renders the §3.4 empty note when the book has no entries. */
function addPnlSheet(wb: ExcelJS.Workbook, used: Set<string>, book: BookkeepingBook, entries: ReportEntry[], accounts: ReportAccount[]) {
  const sheet = addSheet(wb, `P&L — ${book.owner_label ?? book.name}`, book.is_primary ? TAB_PRIMARY : TAB_ACCENT, used)
  headerRow(sheet, ["Category", "Tax hint", "Entries", "Total"], [36, 24, 10, 16])
  if (entries.length === 0) {
    noteRow(sheet, "No entries recorded for this period. This book exists to keep its finances separate — if it has no activity, it stays empty by design.")
    return
  }
  const pnl = profitAndLossByCategory(entries, accounts)
  const section = (title: string, rows: typeof pnl.income, totalLabel: string, totalCents: number) => {
    const t = sheet.addRow([title])
    t.getCell(1).font = { bold: true, size: 11 }
    for (const r of rows) sheet.addRow([r.name, r.tax_category ?? "", r.entry_count, formatCents(r.total_cents)])
    const tot = sheet.addRow([totalLabel, "", "", formatCents(totalCents)])
    tot.eachCell((c) => { c.font = { bold: true } })
  }
  section("INCOME", pnl.income, "Total income", pnl.income_total_cents)
  sheet.addRow([])
  section("EXPENSES", pnl.expense, "Total expenses", pnl.expense_total_cents)
  sheet.addRow([])
  const net = sheet.addRow(["NET (gross income − expenses)", "", "", formatCents(pnl.net_cents)])
  net.eachCell((c) => { c.font = { bold: true, size: 12 } })
}

/** Depreciation register (Phase 6d, spec §6.4). Report-layer only — never a ledger
 *  row (D-12). Omitted ENTIRELY when no assets exist (honest empty-state). */
function addDepreciationSheet(
  wb: ExcelJS.Workbook, used: Set<string>, books: BookkeepingBook[],
  assets: BookkeepingAsset[], endYear: number,
) {
  if (assets.length === 0) return
  const sheet = addSheet(wb, "Depreciation", TAB_ACCENT, used)
  headerRow(
    sheet,
    ["Asset", "Book", "In service", "Basis", "Salvage", "Method", "Convention", "Years", `Depreciation ${endYear}`, `Accumulated thru ${endYear}`, "Note"],
    [28, 24, 12, 14, 12, 14, 12, 8, 18, 20, 32],
  )
  const bookName = new Map(books.map((b) => [b.id, b.name]))
  for (const a of assets) {
    const asOf = depreciationAsOf(a, endYear)
    // `books` (arg) comes from listBooks(), which filters archived_at IS NULL — an
    // asset on an archived book won't resolve here. Fall back to "—" (never the raw
    // UUID) for parity with the print page's identical fallback below.
    sheet.addRow([
      a.name, bookName.get(a.book_id) ?? "—", a.in_service_on,
      formatCents(a.basis_cents), formatCents(a.salvage_cents),
      a.method, a.convention, a.recovery_years,
      formatCents(asOf.year_cents), formatCents(asOf.accumulated_cents),
      a.accountant_note ?? "",
    ])
  }
  sheet.addRow([])
  noteRow(sheet, "Depreciation is tracked, not decided — straight-line book depreciation from accountant-supplied basis, method, and life. For your CPA, not a filing.")
}

export async function buildAccountantPack(input: AccountantPackInput): Promise<Buffer> {
  const { from, to, books, accounts, entries, documents, assets, stripe_fee_cents } = input
  const wb = new ExcelJS.Workbook()
  wb.creator = "DJP Athlete"
  const used = new Set<string>()

  // 1. Read Me — the honesty sheet
  const readme = addSheet(wb, "Read Me", TAB_GRAY, used)
  readme.columns = [{ header: "", key: "c0", width: 110 }]
  const lines = [
    `DJP Athlete — Accountant Pack`,
    `Period: ${from} to ${to} (occurred-on dates, inclusive)`,
    ``,
    `PRIMARY FIGURES ARE GROSS — Stripe processing fees (from ingested payouts) appear only as labeled "net after fees (est.)" lines; fees never post to the ledger.`,
    `Stripe fee lines cover only payouts already ingested; a period with no ingested payouts shows no fees, which is not a claim that no fees were charged.`,
    `Every number here is an ESTIMATE for planning. The CPA files; nothing in this workbook is a filed return.`,
    `This pack is a CANDIDATE for the accountant's review — categories were coach-confirmed but not accountant-confirmed.`,
    `Business and personal finances live in SEPARATE books; no sheet mixes them into one total.`,
    `Tax hints are the coach's free-text notes per category (e.g. "Schedule C Line 22") — the product never invents a tax line.`,
  ]
  for (const l of lines) readme.addRow([l])
  readme.getRow(1).font = { bold: true, size: 14 }

  // 2. Summary — one row per book, NO cross-book grand total (separation principle)
  // Fees only ever belong to the primary BUSINESS book (payout sync ingests
  // nowhere else). One resolution, shared with the Income-by-Service block below,
  // so a single workbook can never name two different fee-bearing books.
  const feeBook = books.find((b) => b.is_primary && b.book_kind === "business")
  const summary = addSheet(wb, "Summary", TAB_PRIMARY, used)
  headerRow(
    summary,
    // "Income after fees", NOT "Net after fees": this column nets fees off the
    // INCOME side (spec §1.4), so it is deliberately not derived from the "Net"
    // column two cells to its left (income − expenses).
    ["Book", "Kind", "Income", "Expenses", "Net", "Entries", "Stripe fees (est.)", "Income after fees (est.)"],
    [30, 12, 16, 16, 16, 10, 18, 24],
  )
  for (const s of perBookSummary(entries, books)) {
    // Other books leave the two columns blank rather than $0.00.
    const isFeeBook = feeBook?.id === s.book_id
    summary.addRow([
      s.name, s.book_kind, formatCents(s.income_cents), formatCents(s.expense_cents), formatCents(s.net_cents), s.entry_count,
      isFeeBook ? feeLineDisplay(stripe_fee_cents) : "",
      isFeeBook ? netAfterFeesDisplay(s.income_cents, stripe_fee_cents) : "",
    ])
  }

  // 3. Income by Service — primary book
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const svc = addSheet(wb, "Income by Service", TAB_PRIMARY, used)
  headerRow(svc, ["Service line", "Entries", "Total"], [32, 10, 16])
  if (primary) {
    const ibs = incomeByServiceLine(entries.filter((e) => e.book_id === primary.id), accounts)
    for (const r of ibs.rows) svc.addRow([r.label, r.entry_count, formatCents(r.total_cents)])
    const tot = svc.addRow(["Total gross income", "", formatCents(ibs.total_cents)])
    tot.eachCell((c) => { c.font = { bold: true } })
    // Only when the sheet's book IS the fee book — otherwise this sheet would
    // net the coach's fees out of some other book's income.
    if (feeBook && primary.id === feeBook.id) {
      svc.addRow(["Stripe processing fees (est., from ingested payouts)", "", feeLineDisplay(stripe_fee_cents)])
      const netRow = svc.addRow(["Net income after Stripe fees (est.)", "", netAfterFeesDisplay(ibs.total_cents, stripe_fee_cents)])
      netRow.eachCell((c) => { c.font = { bold: true } })
    }
  }

  // 4-6. P&L per book (primary, spouse, household — driven by the books list)
  for (const book of books) {
    addPnlSheet(wb, used, book, entries.filter((e) => e.book_id === book.id), accounts)
  }

  // 6b. Depreciation register (Phase 6d) — after the P&L loop, before Documents.
  addDepreciationSheet(wb, used, books, assets, Number(to.slice(0, 4)))

  // 7. Document Index
  const docs = addSheet(wb, "Documents", TAB_GRAY, used)
  headerRow(docs, ["Book", "Kind", "Filename", "Period", "Uploaded", "Posted entries", "Download (admin login required)"], [26, 10, 32, 22, 12, 14, 70])
  const bookName = new Map(books.map((b) => [b.id, b.name]))
  for (const d of documents) {
    const period = d.period_start && d.period_end ? `${d.period_start} – ${d.period_end}` : ""
    docs.addRow([
      bookName.get(d.book_id) ?? d.book_id, d.kind, d.original_filename ?? "", period,
      (d.created_at ?? "").slice(0, 10), d.posted_count ?? 0,
      `${DOWNLOAD_BASE}/api/admin/bookkeeping/documents/${d.id}/download`,
    ])
  }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}
