import type { LedgerSource } from "@/types/database"
import { normalizeDescription, type NormalizedStatementRow } from "./statement-parse"
import { formatCents } from "./money"

/**
 * Pure fuzzy-duplicate flagger for statement imports (AI Bookkeeper Phase 2,
 * Task 4). Zero IO — takes normalized statement rows + already-posted ledger
 * entries and annotates each row with a duplicate/new-candidate verdict so
 * the review UI can pre-check/pre-exclude sensibly. No row is ever silently
 * dropped or auto-posted here; this only computes defaults + reasons.
 *
 * Money-critical defaults (do not relax without a spec change):
 *   - Income defaults to include=false (expense-first: unverified income
 *     must never silently land in the ledger).
 *   - Expense defaults to include=true UNLESS it's a transfer/transfer-
 *     suspect or a cross-statement duplicate of an already-posted expense.
 *   - A posted ledger entry is consumed by at most one statement row (once
 *     matched — exact or as part of an aggregate payout — it's removed from
 *     the pool for every subsequent row in this same call).
 */

export interface PostedRef {
  id: string
  occurred_on: string
  amount_cents: number
  direction: "income" | "expense"
  memo: string | null
  source: LedgerSource
}

/** Track A exact payout layer — a stored Stripe payout the bank line may BE. */
export interface PayoutRef {
  id: string
  stripe_payout_id: string
  net_cents: number
  arrival_date: string
  status: string
}

export interface DedupeInputRow extends NormalizedStatementRow {
  source_ref: string
  is_transfer: boolean
  suggested_category: string | null
  confidence: "low" | "medium" | "high"
  transferSuspect?: boolean
}

export interface AnnotatedStatementRow {
  row: DedupeInputRow
  possibleDuplicate: boolean
  matchedEntry: { id: string; occurred_on: string; memo: string | null; source: LedgerSource } | null
  /** Set only by the exact payout layer — the `bookkeeping_payouts.id` this bank line IS. */
  matchedPayoutId?: string | null
  reason: string | null
  defaultInclude: boolean
  newCandidate: boolean
}

const DEFAULT_WINDOW_DAYS = 4
const DEFAULT_FEE_TOLERANCE_PCT = 4
const PAYOUT_WINDOW_DAYS = 2

/** `YYYY-MM-DD` → whole UTC days since epoch (tz-independent, never local `Date` math). */
function toUtcDays(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Absolute day difference between two `YYYY-MM-DD` strings. */
function dayDiff(a: string, b: string): number {
  return Math.abs(toUtcDays(a) - toUtcDays(b))
}

function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean)
}

/**
 * Fuzzy description match: substring containment either direction, OR token
 * Jaccard similarity >= 0.5. Deliberately conservative — a plain amount+date
 * match is NOT enough to flag two expense rows as duplicates (e.g. two
 * unrelated $50 charges a few days apart); the description must also line up.
 */
function similar(aRaw: string, bRaw: string): boolean {
  const a = normalizeDescription(aRaw)
  const b = normalizeDescription(bRaw)
  if (!a || !b) return false
  if (a.includes(b) || b.includes(a)) return true

  const aTokens = new Set(tokenize(a))
  const bTokens = new Set(tokenize(b))
  const union = new Set([...aTokens, ...bTokens])
  if (union.size === 0) return false

  let intersectionCount = 0
  for (const t of aTokens) if (bTokens.has(t)) intersectionCount++

  return intersectionCount / union.size >= 0.5
}

/** Unconsumed posted platform-import income entries within `[rowDate - windowDays, rowDate]`. */
function platformIncomeInWindow(
  rowDate: string,
  posted: PostedRef[],
  consumed: Set<string>,
  windowDays: number,
): PostedRef[] {
  const rowDays = toUtcDays(rowDate)
  return posted.filter((p) => {
    if (consumed.has(p.id)) return false
    if (p.direction !== "income" || p.source !== "platform_import") return false
    const diff = rowDays - toUtcDays(p.occurred_on)
    return diff >= 0 && diff <= windowDays
  })
}

function toMatchedEntry(p: PostedRef): AnnotatedStatementRow["matchedEntry"] {
  return { id: p.id, occurred_on: p.occurred_on, memo: p.memo, source: p.source }
}

function annotateIncome(
  row: DedupeInputRow,
  posted: PostedRef[],
  consumed: Set<string>,
  windowDays: number,
  feeTolerancePct: number,
  payouts: PayoutRef[],
  consumedPayouts: Set<string>,
): AnnotatedStatementRow {
  // 1. Exact match: nearest unconsumed posted income at the same amount, within window.
  let best: PostedRef | null = null
  let bestDiff = Infinity
  for (const p of posted) {
    if (consumed.has(p.id)) continue
    if (p.direction !== "income") continue
    if (p.amount_cents !== row.amount_cents) continue
    const diff = dayDiff(row.occurred_on, p.occurred_on)
    if (diff > windowDays) continue
    if (diff < bestDiff) {
      best = p
      bestDiff = diff
    }
  }
  if (best) {
    consumed.add(best.id)
    return {
      row,
      possibleDuplicate: true,
      matchedEntry: toMatchedEntry(best),
      reason: `matches ${best.source} entry on ${best.occurred_on}`,
      defaultInclude: false,
      newCandidate: false,
    }
  }

  // 1b. Exact payout-net (Decision A-8): the bank line IS a Stripe payout
  // deposit — net match ±0¢, arrival ±2d, status 'paid' only. SEPARATE
  // consumedPayouts set: one bank line consumes one payout, and this layer
  // never touches the posted-entry pool (layers 1/2 keep their pool intact
  // for other rows). Flags, never drops — the coach can still include the
  // row (the membership-revenue escape hatch).
  let bestPayout: PayoutRef | null = null
  let bestPayoutDiff = Infinity
  for (const po of payouts) {
    if (consumedPayouts.has(po.id)) continue
    if (po.status !== "paid") continue
    if (po.net_cents !== row.amount_cents) continue
    const diff = dayDiff(row.occurred_on, po.arrival_date)
    if (diff > PAYOUT_WINDOW_DAYS) continue
    if (diff < bestPayoutDiff) {
      bestPayout = po
      bestPayoutDiff = diff
    }
  }
  if (bestPayout) {
    consumedPayouts.add(bestPayout.id)
    return {
      row,
      possibleDuplicate: true,
      matchedEntry: null,
      matchedPayoutId: bestPayout.id,
      reason: `Stripe payout deposit — net ${formatCents(bestPayout.net_cents)} arriving ${bestPayout.arrival_date} (${bestPayout.stripe_payout_id})`,
      defaultInclude: false,
      newCandidate: false,
    }
  }

  // 2. Aggregate-payout: row ≈ sum of unconsumed platform-import income in the trailing window
  //    (± feeTolerancePct, to absorb processor fees skimmed off a batched payout).
  const windowEntries = platformIncomeInWindow(row.occurred_on, posted, consumed, windowDays)
  if (windowEntries.length > 0) {
    const sum = windowEntries.reduce((s, p) => s + p.amount_cents, 0)
    const tolerance = (sum * feeTolerancePct) / 100
    if (Math.abs(sum - row.amount_cents) <= tolerance) {
      for (const p of windowEntries) consumed.add(p.id)
      return {
        row,
        possibleDuplicate: true,
        matchedEntry: null,
        reason: `probable Stripe payout of ${formatCents(sum)}`,
        defaultInclude: false,
        newCandidate: false,
      }
    }
  }

  // 3. Period-overlap: no confirmed match, but there IS unconsumed platform income nearby —
  //    a soft caution surfaced to the reviewer. This is NOT a duplicate verdict, so it must
  //    not flip `newCandidate` false — the row may still be genuinely new income.
  if (windowEntries.length > 0) {
    return {
      row,
      possibleDuplicate: false,
      matchedEntry: null,
      reason: "falls in a period with recorded platform income",
      defaultInclude: false,
      newCandidate: true,
    }
  }

  return {
    row,
    possibleDuplicate: false,
    matchedEntry: null,
    reason: null,
    defaultInclude: false,
    newCandidate: true,
  }
}

function annotateExpense(
  row: DedupeInputRow,
  posted: PostedRef[],
  consumed: Set<string>,
  windowDays: number,
): AnnotatedStatementRow {
  // Cross-statement duplicate: nearest unconsumed posted expense at the same amount,
  // within window, AND with a similar description. Amount+date alone is NOT enough —
  // two unrelated same-amount charges a few days apart must not be flagged.
  let best: PostedRef | null = null
  let bestDiff = Infinity
  for (const p of posted) {
    if (consumed.has(p.id)) continue
    if (p.direction !== "expense") continue
    if (p.source !== "statement_import" && p.source !== "manual") continue
    if (p.amount_cents !== row.amount_cents) continue
    const diff = dayDiff(row.occurred_on, p.occurred_on)
    if (diff > windowDays) continue
    if (!similar(row.description, p.memo ?? "")) continue
    if (diff < bestDiff) {
      best = p
      bestDiff = diff
    }
  }

  if (best) {
    consumed.add(best.id)
    return {
      row,
      possibleDuplicate: true,
      matchedEntry: toMatchedEntry(best),
      reason: `matches a previously imported expense on ${best.occurred_on}`,
      defaultInclude: false,
      newCandidate: false,
    }
  }

  return {
    row,
    possibleDuplicate: false,
    matchedEntry: null,
    reason: null,
    defaultInclude: true,
    newCandidate: false,
  }
}

function annotateRow(
  row: DedupeInputRow,
  posted: PostedRef[],
  consumed: Set<string>,
  windowDays: number,
  feeTolerancePct: number,
  payouts: PayoutRef[],
  consumedPayouts: Set<string>,
): AnnotatedStatementRow {
  if (row.is_transfer) {
    return {
      row,
      possibleDuplicate: false,
      matchedEntry: null,
      reason: "internal transfer / card payment — excluded from P&L",
      defaultInclude: false,
      newCandidate: false,
    }
  }
  if (row.transferSuspect) {
    return {
      row,
      possibleDuplicate: false,
      matchedEntry: null,
      reason: "possible transfer — verify",
      defaultInclude: false,
      newCandidate: false,
    }
  }

  return row.direction === "income"
    ? annotateIncome(row, posted, consumed, windowDays, feeTolerancePct, payouts, consumedPayouts)
    : annotateExpense(row, posted, consumed, windowDays)
}

/**
 * Flag likely duplicates across four signals (exact match, exact Stripe-payout
 * net, aggregate payout, period-overlap for income; exact+description-
 * similarity for expense) and compute a sane default include/exclude verdict
 * per row.
 *
 * Rows are matched in `(occurred_on, inputIndex)` order so a posted entry is
 * consumed deterministically, but the returned array preserves INPUT order.
 */
export function flagStatementDuplicates(
  rows: DedupeInputRow[],
  posted: PostedRef[],
  opts?: { windowDays?: number; feeTolerancePct?: number; payouts?: PayoutRef[] },
): AnnotatedStatementRow[] {
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS
  const feeTolerancePct = opts?.feeTolerancePct ?? DEFAULT_FEE_TOLERANCE_PCT
  const payouts = opts?.payouts ?? []

  const consumed = new Set<string>()
  // Deliberately SEPARATE from `consumed` — the payout layer must never remove
  // a posted entry from layers 1/2's pool (Decision A-8).
  const consumedPayouts = new Set<string>()
  const results: AnnotatedStatementRow[] = new Array(rows.length)

  const matchOrder = rows
    .map((_, i) => i)
    .sort((a, b) => {
      const byDate = rows[a].occurred_on.localeCompare(rows[b].occurred_on)
      return byDate !== 0 ? byDate : a - b
    })

  for (const idx of matchOrder) {
    results[idx] = annotateRow(rows[idx], posted, consumed, windowDays, feeTolerancePct, payouts, consumedPayouts)
  }

  return results
}
