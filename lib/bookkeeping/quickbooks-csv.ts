/** QuickBooks Online 4-column bank-transaction CSV (D8, spec §3.2):
 *  header Date,Description,Credit,Debit — Credit = money in (income),
 *  Debit = money out (expense), amounts positive two-decimal, dates
 *  MM/DD/YYYY, blank (not 0) in the unused column. The 4-column shape is
 *  deliberate: the 3-column shape needs signed amounts, and csvCell's
 *  injection defense would corrupt a leading "-" string. Full export
 *  always — QBO's 1,000-line upload cap is a UI hint, never a truncation. */
import { csvDocument } from "@/lib/csv/serialize"
import type { ReportAccount, ReportEntry } from "@/lib/bookkeeping/reports"

export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`centsToDecimalString expects a non-negative integer, got ${cents}`)
  }
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
}

export function toQuickBooksDate(occurredOn: string): string {
  return `${occurredOn.slice(5, 7)}/${occurredOn.slice(8, 10)}/${occurredOn.slice(0, 4)}`
}

export function buildQuickBooksCsv(entries: ReportEntry[], accounts: ReportAccount[]): string {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const rows: Array<Array<string | null>> = [["Date", "Description", "Credit", "Debit"]]
  const sorted = [...entries].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))
  for (const e of sorted) {
    const account = e.account_id ? accountById.get(e.account_id) : undefined
    const description = [e.counterparty, e.memo].filter(Boolean).join(" — ") || account?.name || "Ledger entry"
    const amount = centsToDecimalString(e.amount_cents)
    rows.push([
      toQuickBooksDate(e.occurred_on),
      description,
      e.direction === "income" ? amount : null,
      e.direction === "expense" ? amount : null,
    ])
  }
  return csvDocument(rows)
}
