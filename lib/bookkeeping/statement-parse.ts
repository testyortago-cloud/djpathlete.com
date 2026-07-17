import Papa from "papaparse"
import { createHash } from "node:crypto"

/**
 * Pure statement parser for bank/Venmo CSV imports (AI Bookkeeper Phase 2, Task 3).
 * Zero IO — parsing, column detection, row normalization, transfer suspicion,
 * and stable source_ref computation all live here so they can be unit-tested
 * without a database or filesystem.
 *
 * Money rule: amount_cents is always computed via STRING split on the decimal
 * point (never parseFloat * 100 — floats truncate/round unpredictably).
 * Date rule: occurred_on is date-only and timezone-independent — built from
 * string parts or sliced from an ISO prefix, never from local-time Date math.
 */

export interface NormalizedStatementRow {
  occurred_on: string
  description: string
  amount_cents: number
  direction: "income" | "expense"
}

export interface StatementColumnMap {
  date: number
  description: number
  amountMode: "signed" | "debit_credit"
  amount?: number
  debit?: number
  credit?: number
  signConvention?: "negative_is_expense" | "positive_is_expense"
}

/** Quote-aware CSV parse. First row is treated as headers. */
export function parseCsvStatement(text: string): { headers: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const data = (result.data ?? []) as string[][]
  const headers = data[0] ?? []
  const rows = data.slice(1)
  return { headers, rows }
}

/**
 * Parse a raw amount string to integer cents via STRING split on the decimal
 * point — never parseFloat*100 (float drift/truncation). Handles $, commas,
 * parentheses-as-negative, trailing/leading minus, and CR/DR suffixes.
 */
export function parseAmountToCents(raw: string): { cents: number; negative: boolean } | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (s === "") return null

  let negative = false

  // Parentheses denote a negative amount, e.g. "(1,234.56)".
  const parenMatch = s.match(/^\((.*)\)$/)
  if (parenMatch) {
    negative = true
    s = parenMatch[1].trim()
  }

  // CR (credit/inflow) / DR (debit/outflow) suffix.
  const crDrMatch = s.match(/\s*(CR|DR)$/i)
  if (crDrMatch && crDrMatch.index !== undefined) {
    if (crDrMatch[1].toUpperCase() === "DR") negative = true
    s = s.slice(0, crDrMatch.index).trim()
  }

  // Trailing minus, e.g. "1234.56-".
  if (s.endsWith("-")) {
    negative = true
    s = s.slice(0, -1).trim()
  }
  // Leading minus, e.g. "-1234.56" or "- $5.00".
  if (s.startsWith("-")) {
    negative = true
    s = s.slice(1).trim()
  }

  // Strip currency symbol, thousands separators, and stray whitespace.
  s = s.replace(/[$,\s]/g, "")

  if (s === "" || !/\d/.test(s) || !/^\d*\.?\d*$/.test(s)) return null

  const [intPartRaw = "", fracPartRaw = ""] = s.split(".")
  const intPart = intPartRaw === "" ? 0 : parseInt(intPartRaw, 10)
  let fracPart = fracPartRaw
  if (fracPart.length > 2) fracPart = fracPart.slice(0, 2)
  while (fracPart.length < 2) fracPart += "0"
  const fracNum = parseInt(fracPart, 10)

  const cents = intPart * 100 + fracNum
  return { cents, negative }
}

/**
 * Parse a raw date string to YYYY-MM-DD, timezone-independently. Never routes
 * through `new Date()` local-time math — either slices an ISO prefix or
 * builds the string directly from M/D/Y parts.
 */
export function parseStatementDate(raw: string): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (s === "") return null

  // ISO date or ISO datetime — slice the date-only prefix (tz-independent).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  // M/D/YYYY or M/D/YY.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (m) {
    const month = m[1].padStart(2, "0")
    const day = m[2].padStart(2, "0")
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${month}-${day}`
  }

  return null
}

/**
 * Strip volatile tokens (card sub-refs, trailing balance text, embedded money
 * amounts) so descriptions can be compared/hashed stably across re-imports.
 */
export function normalizeDescription(desc: string): string {
  return (desc ?? "")
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/#\S+/g, " ")
    .replace(/\bbal\b.*$/, "")
    .replace(/\d[\d,]*\.\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const DATE_HEADER_RE = /date/
const DESCRIPTION_HEADER_RE = /description|note|name|memo|details/
const AMOUNT_HEADER_RE = /amount/
const DEBIT_HEADER_RE = /debit/
const CREDIT_HEADER_RE = /credit/

/**
 * Detect which columns hold the date/description/amount(s) for an unknown
 * CSV layout. Returns null when it cannot confidently locate a date column
 * AND either a signed amount column or a debit+credit pair.
 */
export function detectStatementColumns(headers: string[], rows: string[][]): StatementColumnMap | null {
  const headersLower = headers.map((h) => (h ?? "").toLowerCase())

  let dateIdx = headersLower.findIndex((h) => DATE_HEADER_RE.test(h))
  if (dateIdx === -1 && rows.length > 0 && rows.every((r) => parseStatementDate(r[0] ?? "") !== null)) {
    dateIdx = 0
  }
  if (dateIdx === -1) return null

  const debitIdx = headersLower.findIndex((h) => DEBIT_HEADER_RE.test(h))
  const creditIdx = headersLower.findIndex((h) => CREDIT_HEADER_RE.test(h))
  const hasDebitCredit = debitIdx !== -1 && creditIdx !== -1

  const amountIdx = headersLower.findIndex((h) => AMOUNT_HEADER_RE.test(h))

  if (!hasDebitCredit && amountIdx === -1) return null

  const used = new Set<number>([dateIdx])
  if (hasDebitCredit) {
    used.add(debitIdx)
    used.add(creditIdx)
  } else {
    used.add(amountIdx)
  }

  let descIdx = headersLower.findIndex((h) => DESCRIPTION_HEADER_RE.test(h))
  if (descIdx === -1) {
    descIdx = headersLower.findIndex((_, i) => !used.has(i))
    if (descIdx === -1) descIdx = dateIdx
  }

  if (hasDebitCredit) {
    return { date: dateIdx, description: descIdx, amountMode: "debit_credit", debit: debitIdx, credit: creditIdx }
  }
  return { date: dateIdx, description: descIdx, amountMode: "signed", amount: amountIdx }
}

/**
 * Normalize raw CSV rows into `{ occurred_on, description, amount_cents,
 * direction }` per the detected column map. Rows with an unparseable date or
 * amount are silently dropped; ambiguous debit/credit rows (both non-zero)
 * are dropped WITH a warning.
 */
export function normalizeStatementRows(
  rows: string[][],
  map: StatementColumnMap,
): { rows: NormalizedStatementRow[]; warnings: string[] } {
  const warnings: string[] = []
  const out: NormalizedStatementRow[] = []

  rows.forEach((row, i) => {
    const occurred_on = parseStatementDate(row[map.date] ?? "")
    if (!occurred_on) return // unparseable date — skip

    const description = (row[map.description] ?? "").trim()

    if (map.amountMode === "signed") {
      const parsed = parseAmountToCents(row[map.amount!] ?? "")
      if (!parsed) return // unparseable amount — skip
      const signConvention = map.signConvention ?? "negative_is_expense"
      const direction: "income" | "expense" =
        signConvention === "negative_is_expense"
          ? parsed.negative
            ? "expense"
            : "income"
          : parsed.negative
            ? "income"
            : "expense"
      out.push({ occurred_on, description, amount_cents: parsed.cents, direction })
      return
    }

    // debit_credit mode: pick the non-zero column; 0.00/blank counts as absent.
    const debitRaw = (row[map.debit!] ?? "").trim()
    const creditRaw = (row[map.credit!] ?? "").trim()
    const debitParsed = debitRaw === "" ? null : parseAmountToCents(debitRaw)
    const creditParsed = creditRaw === "" ? null : parseAmountToCents(creditRaw)
    const debitNonZero = debitParsed !== null && debitParsed.cents !== 0
    const creditNonZero = creditParsed !== null && creditParsed.cents !== 0

    if (debitNonZero && creditNonZero) {
      warnings.push(`Row ${i + 1}: both debit and credit columns are non-zero (ambiguous) — skipped`)
      return
    }
    if (!debitNonZero && !creditNonZero) return // neither present — skip silently

    if (debitNonZero) {
      // Debit's natural direction is expense; a negative value flips it to income.
      const direction: "income" | "expense" = debitParsed!.negative ? "income" : "expense"
      out.push({ occurred_on, description, amount_cents: debitParsed!.cents, direction })
    } else {
      // Credit's natural direction is income; a negative value flips it to expense.
      const direction: "income" | "expense" = creditParsed!.negative ? "expense" : "income"
      out.push({ occurred_on, description, amount_cents: creditParsed!.cents, direction })
    }
  })

  return { rows: out, warnings }
}

const NON_TRANSACTION_RE =
  /(beginning|ending) balance|^balance\s*(forward|due)?\s*$|subtotal|^total (deposits|withdrawals|credits|debits)|running balance/

/** Drop balance/total/subtotal summary lines and zero-amount lines. */
export function dropNonTransactionRows(
  rows: NormalizedStatementRow[],
): { rows: NormalizedStatementRow[]; dropped: number } {
  const kept: NormalizedStatementRow[] = []
  let dropped = 0
  for (const row of rows) {
    const normalized = normalizeDescription(row.description)
    if (row.amount_cents === 0 || NON_TRANSACTION_RE.test(normalized)) {
      dropped++
      continue
    }
    kept.push(row)
  }
  return { rows: kept, dropped }
}

const HARD_TRANSFER_RE =
  /transfer|xfer|zelle|wire| ach |to savings|to checking|payment.*credit card|credit card.*payment|cc payment|card payment|loan payment|owner draw|\batm\b|cash withdrawal|payment - thank you|payment thank you/

const MERCHANT_MARKER_RE = /[#*]|\b(llc|inc|corp|co|ltd)\b/i

/** Person-like name check on the RAW description (pre-normalize, so `#`/`*` markers still count). */
function isPersonLikeName(desc: string): boolean {
  const trimmed = (desc ?? "").trim()
  if (trimmed === "") return false
  if (!/^[A-Za-z][A-Za-z\s.'-]*$/.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length > 3) return false
  if (MERCHANT_MARKER_RE.test(trimmed)) return false
  return true
}

/** Sparse (≤2-token), merchant-marker-free description check on the RAW description. */
function isSparseNoMerchant(desc: string): boolean {
  const trimmed = (desc ?? "").trim()
  if (trimmed === "") return false
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length > 2) return false
  if (MERCHANT_MARKER_RE.test(trimmed)) return false
  return true
}

/**
 * Classify a normalized row's likelihood of being an internal transfer
 * (rather than real income/expense) so it can be excluded from the ledger by
 * default. "hard" = explicit transfer keyword. "soft" = round/person-like
 * outbound heuristic (expense only). null = ordinary transaction.
 */
export function transferSuspicion(row: NormalizedStatementRow): "hard" | "soft" | null {
  const normalized = normalizeDescription(row.description)
  if (HARD_TRANSFER_RE.test(normalized)) return "hard"

  if (row.direction === "expense") {
    // Person-to-person transfers (Zelle/Venmo-style) are typically ≥ $100 —
    // gate on amount so small person-named merchants (e.g. "Blue Bottle")
    // aren't pre-excluded from the ledger.
    if (row.amount_cents >= 10000 && isPersonLikeName(row.description)) return "soft"
    if (row.amount_cents % 10000 === 0 && isSparseNoMerchant(row.description)) return "soft"
  }

  return null
}

/**
 * Stable per-import dedupe key: sha1 over occurred_on|amount_cents|direction|
 * normalizeDescription(desc)|occurrenceIndex. occurrenceIndex disambiguates
 * two otherwise-identical same-day rows (see assignOccurrenceIndexes).
 */
export function computeStatementSourceRef(row: NormalizedStatementRow, occurrenceIndex: number): string {
  const key = `${row.occurred_on}|${row.amount_cents}|${row.direction}|${normalizeDescription(row.description)}|${occurrenceIndex}`
  const hash = createHash("sha1").update(key).digest("hex")
  return `statement:${hash}`
}

/**
 * Assign a stable, 0-based occurrence index to each row keyed on its
 * (occurred_on, amount_cents, direction, normalized description) tuple.
 * MUST be computed over the full row set so re-importing the same file (or a
 * checked subset of it) reproduces identical indexes/refs.
 */
export function assignOccurrenceIndexes(rows: NormalizedStatementRow[]): number[] {
  const counts = new Map<string, number>()
  return rows.map((row) => {
    const key = `${row.occurred_on}|${row.amount_cents}|${row.direction}|${normalizeDescription(row.description)}`
    const count = counts.get(key) ?? 0
    counts.set(key, count + 1)
    return count
  })
}
