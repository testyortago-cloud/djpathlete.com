// Pre-close readiness gate. Pure — zero IO, `today` injected, integer cents.
// Answers ONE question: "if I freeze this month right now, will the frozen
// number be worth trusting?" Two severities:
//   blocker — the snapshot would be WRONG (duplicates) or unusable for reports
//             and tax categorization (uncategorized). The close route refuses
//             unless the caller passes an explicit override.
//   warning — the snapshot is probably fine but the month looks under-fed.
//             Never blocks; shown so the omission is a decision, not an accident.
// The gate is always VISIBLE with its reason and its override (the silent-gate
// lesson: a gate that hides its control reads as broken software).
import type { CandidatePair } from "./duplicate-scan"
import type { InsightAccount, InsightEntry } from "./insight-types"
import { receiptWatchdogFindings } from "./receipt-watchdog"
import { PERIOD_RE, periodOf, snapshotTotals, type SnapshotTotals } from "./period-close"

export type ReadinessSeverity = "blocker" | "warning"

export interface ReadinessCheck {
  key: string
  title: string
  severity: ReadinessSeverity
  /** "ok" = nothing to do. "flagged" = the detail below applies. */
  status: "ok" | "flagged"
  /** How many things tripped it (0 when ok). Drives the UI count badge. */
  count: number
  detail: string
  /** Periods the fix lives in, when the fix is "go deal with another month"
   *  (earlier_open). Oldest first — the UI jumps the picker to targets[0]
   *  rather than re-parsing them back out of `detail`. */
  targets?: string[]
}

export interface CloseReadiness {
  period: string
  checks: ReadinessCheck[]
  /** Keys of FLAGGED blockers — empty means the close route will accept. */
  blocking: string[]
  /** Keys of flagged warnings. */
  warning: string[]
  ready: boolean
  /** Exactly what the close would freeze, computed the same way the close does. */
  totals: SnapshotTotals
}

export interface CloseReadinessInput {
  period: string
  bookId: string
  /** Any window / any book — filtered to (period, bookId) here so the filtering
   *  itself is under test rather than trusted to the caller. */
  entries: InsightEntry[]
  accounts: InsightAccount[]
  /** Whole-book candidate pairs, already dismissal-filtered by findCandidatePairs. */
  duplicatePairs: CandidatePair[]
  /** Every occurred_on in the book, any period — powers the earlier-open-months check. */
  bookEntryDates: readonly string[]
  closedPeriods: readonly string[]
  today: string
}

/** The one sentence the close route returns when blockers are unresolved. */
export const NOT_READY_MESSAGE =
  "This month isn't ready to close. Clear the blockers listed in the readiness check, or close it anyway if you know they're fine."

function check(
  key: string,
  title: string,
  severity: ReadinessSeverity,
  count: number,
  okDetail: string,
  flaggedDetail: string,
): ReadinessCheck {
  return {
    key,
    title,
    severity,
    status: count > 0 ? "flagged" : "ok",
    count,
    detail: count > 0 ? flaggedDetail : okDetail,
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Readiness for one (book, period). Returns every check in a stable order —
 * blockers first — including the ones that passed, so the panel reads as a
 * checklist rather than an error list.
 */
export function closeReadiness(input: CloseReadinessInput): CloseReadiness {
  const { period, bookId, today } = input
  const inPeriod = (date: string) => periodOf(date) === period

  const monthEntries = input.entries.filter((e) => e.book_id === bookId && inPeriod(e.occurred_on))

  // ── Blocker 1: uncategorized ───────────────────────────────────────────────
  // The net is arithmetically right without a category, but every report and
  // every tax bucket downstream is wrong — this is the classic clear-suspense-
  // before-close step.
  const uncategorized = monthEntries.filter((e) => e.account_id === null).length

  // ── Blocker 2: possible duplicates ─────────────────────────────────────────
  // EITHER side in the period counts: a June/July pair still means July's total
  // may be overstated, and the July side is the one you can still delete.
  const duplicates = input.duplicatePairs.filter(
    (p) => inPeriod(p.a.occurred_on) || inPeriod(p.b.occurred_on),
  ).length

  // ── Warning 1: substantiation ──────────────────────────────────────────────
  // minAgeDays 0 — the watchdog's 14-day grace exists so the weekly email
  // doesn't nag about fresh spend; at close time the month is already over.
  const substantiation = receiptWatchdogFindings(monthEntries, input.accounts, {
    today,
    minAgeDays: 0,
  }).length

  // ── Warning 2: statement coverage ──────────────────────────────────────────
  const statementRows = monthEntries.filter((e) => e.source === "statement_import").length

  // ── Warning 3: earlier months still open ───────────────────────────────────
  const closed = new Set(input.closedPeriods)
  const earlierOpen = [
    ...new Set(
      input.bookEntryDates
        .map(periodOf)
        .filter((p) => PERIOD_RE.test(p) && p < period && !closed.has(p)),
    ),
  ].sort()

  const checks: ReadinessCheck[] = [
    check(
      "uncategorized",
      "Everything categorized",
      "blocker",
      uncategorized,
      "Every entry this month has a category.",
      `${plural(uncategorized, "entry", "entries")} still ${uncategorized === 1 ? "has" : "have"} no category — reports and tax buckets would be wrong.`,
    ),
    check(
      "duplicates",
      "No possible duplicates",
      "blocker",
      duplicates,
      "No same-amount, same-week pairs touching this month.",
      `${plural(duplicates, "possible duplicate", "possible duplicates")} touch this month — run the duplicate scan before freezing the total.`,
    ),
    check(
      "substantiation",
      "Receipts and purposes",
      "warning",
      substantiation,
      "Every expense that needs a receipt or a purpose has one.",
      `${plural(substantiation, "expense", "expenses")} ${substantiation === 1 ? "is" : "are"} missing a receipt or a business purpose.`,
    ),
    check(
      "statement_coverage",
      "Bank statement imported",
      "warning",
      statementRows === 0 ? 1 : 0,
      `${plural(statementRows, "entry", "entries")} came from a bank/card statement.`,
      "No statement-imported entries this month — spending without a receipt may be missing.",
    ),
    {
      ...check(
        "earlier_open",
        "Earlier months closed",
        "warning",
        earlierOpen.length,
        "No earlier months are left open.",
        `${plural(earlierOpen.length, "earlier month has", "earlier months have")} entries but ${earlierOpen.length === 1 ? "is" : "are"} still open (${earlierOpen.join(", ")}).`,
      ),
      targets: earlierOpen,
    },
  ]

  const blocking = checks.filter((c) => c.severity === "blocker" && c.status === "flagged").map((c) => c.key)
  const warning = checks.filter((c) => c.severity === "warning" && c.status === "flagged").map((c) => c.key)

  return {
    period,
    checks,
    blocking,
    warning,
    ready: blocking.length === 0,
    totals: snapshotTotals(monthEntries),
  }
}
