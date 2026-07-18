/** Accountant pack workbook (D9): one .xlsx, a tab per question the
 *  accountant asks. Zero IO — the route fetches and passes plain arrays.
 *  All money renders as formatCents strings (spec §3.7 — no float cells).
 *  Styling follows the lib/excel-templates.ts ARGB conventions. */
import ExcelJS from "exceljs"
import { formatCents } from "@/lib/bookkeeping/money"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ReportAccount, type ReportEntry,
} from "@/lib/bookkeeping/reports"
import type { BookkeepingBook, BookkeepingDocument } from "@/types/database"

export interface AccountantPackInput {
  from: string
  to: string
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  documents: BookkeepingDocument[]
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

export async function buildAccountantPack(input: AccountantPackInput): Promise<Buffer> {
  const { from, to, books, accounts, entries, documents } = input
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
    `ALL FIGURES ARE GROSS — Stripe fees and payouts are not netted (they arrive in a later phase).`,
    `Every number here is an ESTIMATE for planning. The CPA files; nothing in this workbook is a filed return.`,
    `This pack is a CANDIDATE for the accountant's review — categories were coach-confirmed but not accountant-confirmed.`,
    `Business and personal finances live in SEPARATE books; no sheet mixes them into one total.`,
    `Tax hints are the coach's free-text notes per category (e.g. "Schedule C Line 22") — the product never invents a tax line.`,
  ]
  for (const l of lines) readme.addRow([l])
  readme.getRow(1).font = { bold: true, size: 14 }

  // 2. Summary — one row per book, NO cross-book grand total (separation principle)
  const summary = addSheet(wb, "Summary", TAB_PRIMARY, used)
  headerRow(summary, ["Book", "Kind", "Income", "Expenses", "Net", "Entries"], [30, 12, 16, 16, 16, 10])
  for (const s of perBookSummary(entries, books)) {
    summary.addRow([s.name, s.book_kind, formatCents(s.income_cents), formatCents(s.expense_cents), formatCents(s.net_cents), s.entry_count])
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
  }

  // 4-6. P&L per book (primary, spouse, household — driven by the books list)
  for (const book of books) {
    addPnlSheet(wb, used, book, entries.filter((e) => e.book_id === book.id), accounts)
  }

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
