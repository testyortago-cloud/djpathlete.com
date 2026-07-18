// Pure parser for Amazon "Order History" / "Items" CSV exports (Phase 3).
// Reuses the money-safe primitives from statement-parse.ts (string-split cents,
// tz-independent dates) so amounts/dates are parsed identically to statements.
import { parseCsvStatement, parseAmountToCents, parseStatementDate } from "./statement-parse"

export interface AmazonRow {
  occurred_on: string
  description: string
  amount_cents: number
  direction: "expense"
  orderId: string
  lineIndex: number
  source_ref: string
}

const DATE_HEADERS = ["order date", "date"]
const ORDER_HEADERS = ["order id", "orderid"]
const TITLE_HEADERS = ["title", "product name", "item name", "name"]
const AMOUNT_HEADERS = ["item total", "total owed", "item subtotal", "purchase price per unit", "total charged"]

function findCol(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase())
  for (const c of candidates) {
    const i = lower.indexOf(c)
    if (i >= 0) return i
  }
  return -1
}

export function parseAmazonCsv(text: string): { rows: AmazonRow[]; warnings: string[] } {
  const warnings: string[] = []
  const { headers, rows } = parseCsvStatement(text)
  const dateCol = findCol(headers, DATE_HEADERS)
  const orderCol = findCol(headers, ORDER_HEADERS)
  const titleCol = findCol(headers, TITLE_HEADERS)
  const amountCol = findCol(headers, AMOUNT_HEADERS)

  if (dateCol < 0 || orderCol < 0 || amountCol < 0) {
    return { rows: [], warnings: ["Could not detect Amazon order columns (need Order Date, Order ID, and an item total)."] }
  }

  const out: AmazonRow[] = []
  const lineByOrder = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]
    const orderId = (cells[orderCol] ?? "").trim()
    const occurred_on = parseStatementDate(cells[dateCol] ?? "")
    const amt = parseAmountToCents(cells[amountCol] ?? "")
    const description = titleCol >= 0 ? (cells[titleCol] ?? "").trim() : "Amazon order"

    if (!orderId) { warnings.push(`Row ${i + 1}: missing Order ID — skipped.`); continue }
    if (!occurred_on) { warnings.push(`Row ${i + 1} (${orderId}): unreadable date — skipped.`); continue }
    if (!amt || amt.negative || amt.cents <= 0) { warnings.push(`Row ${i + 1} (${orderId}): unreadable or negative amount (refund/credit) — skipped.`); continue }

    const lineIndex = lineByOrder.get(orderId) ?? 0
    lineByOrder.set(orderId, lineIndex + 1)
    out.push({
      occurred_on, description: description || "Amazon order", amount_cents: amt.cents,
      direction: "expense", orderId, lineIndex,
      source_ref: `amazon:${orderId}:${lineIndex}`,
    })
  }

  return { rows: out, warnings }
}
