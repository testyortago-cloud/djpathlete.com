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
/**
 * Money column, in priority order — Amazon has shipped several export schemas
 * over the years and one file can carry more than one of these. "total amount"
 * is the current (2026) Order History export's per-LINE charged total: unit
 * price x quantity plus that line's tax, so summing an order's lines
 * reproduces the order total.
 *
 * Deliberately NOT accepted: "shipment item subtotal", which repeats the whole
 * SHIPMENT's subtotal on every line of that shipment — picking it would post
 * the same shipment total two or three times for a multi-item order.
 */
const AMOUNT_HEADERS = [
  "item total",
  "total owed",
  "total amount",
  "item subtotal",
  "purchase price per unit",
  "total charged",
]
const STATUS_HEADERS = ["order status"]

/** Cancelled lines still carry their would-be price in the export, but were
 *  never charged — they must never post as an expense. */
const CANCELLED_RE = /^cancell?ed$/

const BOM = 0xfeff

/** Drop a leading UTF-8 BOM — Amazon's export is sometimes BOM-prefixed, which
 *  would otherwise hide the very first column (often "Order Date") from
 *  detection and fail the whole import. */
function stripBom(header: string): string {
  return header.charCodeAt(0) === BOM ? header.slice(1) : header
}

function findCol(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => stripBom(h ?? "").trim().toLowerCase())
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
  const statusCol = findCol(headers, STATUS_HEADERS)

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
    const status = statusCol >= 0 ? (cells[statusCol] ?? "").trim().toLowerCase() : ""

    if (!orderId) { warnings.push(`Row ${i + 1}: missing Order ID — skipped.`); continue }
    if (CANCELLED_RE.test(status)) { warnings.push(`Row ${i + 1} (${orderId}): order was cancelled — skipped.`); continue }
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
