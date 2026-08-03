// The single gather for close readiness. Both the readiness GET (what the coach
// SEES) and the close POST (what the server ENFORCES) go through this function,
// so the panel and the refusal can never disagree about whether a month is ready.
import {
  listAccountsForInsights,
  listCloses,
  listDismissedFingerprints,
  listEntriesForDuplicateScan,
  listEntriesForInsights,
} from "@/lib/db/bookkeeping"
import { findCandidatePairs } from "./duplicate-scan"
import { closeReadiness, type CloseReadiness } from "./close-readiness"
import { monthBounds } from "./period-close"

/** Generous vs. the scan dialog's 40 — the readiness COUNT should be the real
 *  number, not a page size. A book big enough to truncate here would report a
 *  floor, which still blocks; it just understates by how much. */
const READINESS_MAX_PAIRS = 2000

export async function gatherCloseReadiness(
  bookId: string,
  period: string,
  today: string,
): Promise<CloseReadiness> {
  const { from, to } = monthBounds(period)
  const [entries, accounts, scanEntries, dismissed, closes] = await Promise.all([
    listEntriesForInsights(from, to),
    listAccountsForInsights(),
    listEntriesForDuplicateScan(bookId),
    listDismissedFingerprints(bookId),
    listCloses(bookId),
  ])
  const { pairs } = findCandidatePairs(scanEntries, new Set(dismissed), { maxPairs: READINESS_MAX_PAIRS })
  return closeReadiness({
    period,
    bookId,
    entries,
    accounts,
    duplicatePairs: pairs,
    bookEntryDates: scanEntries.map((e) => e.occurred_on),
    closedPeriods: closes.map((c) => c.period),
    today,
  })
}
