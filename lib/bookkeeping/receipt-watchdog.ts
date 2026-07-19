// Pure missing-receipt watchdog (Phase 6b, D-10). Zero IO; integer cents; today injected.
// A CHORE LIST for the coach — never tax advice, never a ledger write. Superset of the
// Phase-5 substantiation-gap predicate: adds document ageing on deductible accounts.
import type { InsightAccount, InsightEntry } from "./insight-types"
import { isBlankPurpose } from "./insight-types"

/** Entries younger than this many days are not nagged about yet (spec §4.1, pinned). */
export const MIN_AGE_DAYS = 14

export type WatchdogReason = "no_document" | "no_purpose"

export interface WatchdogFinding {
  entry_id: string
  book_id: string
  account_id: string
  account_name: string
  occurred_on: string
  amount_cents: number
  counterparty: string | null
  reasons: WatchdogReason[]
}

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** Expense entries on watched accounts (deductible-candidate OR purpose-required —
 *  archived accounts stay watched, the watchlist precedent), aged >= minAgeDays,
 *  missing a document (deductible accounts) and/or a business purpose (purpose-required
 *  accounts). Sorted amount desc, tie occurred_on desc, tie entry_id asc. */
export function receiptWatchdogFindings(
  entries: InsightEntry[],
  accounts: InsightAccount[],
  opts: { today: string; minAgeDays: number },
): WatchdogFinding[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const todayNum = dayNumber(opts.today)
  const findings: WatchdogFinding[] = []
  for (const e of entries) {
    if (e.direction !== "expense") continue
    if (e.account_id === null) continue
    const account = accountById.get(e.account_id)
    if (!account) continue
    if (!account.is_deductible_candidate && !account.requires_business_purpose) continue
    if (todayNum - dayNumber(e.occurred_on) < opts.minAgeDays) continue
    const reasons: WatchdogReason[] = []
    if (account.is_deductible_candidate && e.document_id === null) reasons.push("no_document")
    if (account.requires_business_purpose && isBlankPurpose(e.business_purpose)) reasons.push("no_purpose")
    if (reasons.length === 0) continue
    findings.push({
      entry_id: e.id,
      book_id: e.book_id,
      account_id: account.id,
      account_name: account.name,
      occurred_on: e.occurred_on,
      amount_cents: e.amount_cents,
      counterparty: e.counterparty,
      reasons,
    })
  }
  findings.sort(
    (a, b) =>
      b.amount_cents - a.amount_cents ||
      b.occurred_on.localeCompare(a.occurred_on) ||
      a.entry_id.localeCompare(b.entry_id),
  )
  return findings
}
