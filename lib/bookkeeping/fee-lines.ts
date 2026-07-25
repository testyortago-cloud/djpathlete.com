/** Display strings for the net-revenue second line (Track A §1.4). ONE place so
 *  the web report, the print view and the accountant xlsx cannot drift apart on
 *  wording or on sign.
 *
 *  Three honesty rules live here:
 *  1. The zero-state is driven by DATA AVAILABILITY, never by "the sum is 0".
 *     `cron_bookkeeping_payout_sync_enabled` seeds false, so no-payout-data is
 *     the DEFAULT state on arrival — but once payouts ARE ingested and they
 *     genuinely carried no capturable fee, "$0.00" is the truthful cell and
 *     claiming "no payouts ingested" would be a false statement in a workbook
 *     that leaves the building. Hence StripeFeeWindow.payout_count, not
 *     fee_cents, decides the hedge.
 *  2. A window holding payouts the sync could not explain (Stripe enumerates
 *     constituent balance transactions for AUTOMATIC payouts only, so a manual
 *     "Pay out now" ingests with zero fee lines) never renders a clean number:
 *     both cells carry "fees incomplete for N of M payouts".
 *  3. The minus sign is applied here, never by the caller — formatCents
 *     delegates to Intl, which already signs negatives (a fee-refund window can
 *     sum below zero), so hand-prefixing would print "−-$3.00".
 *  Integer cents in, strings out; no float math. */
import { formatCents } from "@/lib/bookkeeping/money"
import type { StripeFeeWindow } from "@/lib/bookkeeping/payout-fees"

export const NO_PAYOUTS_FEE_NOTE = "$0.00 — no payouts ingested for this period"
export const NET_AFTER_FEES_PENDING = "— available after the first payout sync"

/** "fees incomplete for 2 of 5 payouts" — appended to BOTH cells so neither the
 *  fee total nor the net figure can be read as complete. */
export function feesIncompleteNote(unreconciled: number, total: number): string {
  return `fees incomplete for ${unreconciled} of ${total} payout${total === 1 ? "" : "s"}`
}

function withCaveat(value: string, w: StripeFeeWindow): string {
  return w.unreconciled_count > 0
    ? `${value} — ${feesIncompleteNote(w.unreconciled_count, w.payout_count)}`
    : value
}

/** The "Stripe processing fees (est.)" cell. */
export function feeLineDisplay(w: StripeFeeWindow): string {
  if (w.payout_count === 0) return NO_PAYOUTS_FEE_NOTE
  return withCaveat(w.fee_cents > 0 ? `−${formatCents(w.fee_cents)}` : formatCents(w.fee_cents), w)
}

/** The "…after Stripe fees (est.)" cell, netted off the GROSS INCOME side
 *  (spec §1.4 — the sibling of "Total gross income", not of P&L net). */
export function netAfterFeesDisplay(grossCents: number, w: StripeFeeWindow): string {
  if (w.payout_count === 0) return NET_AFTER_FEES_PENDING
  return withCaveat(formatCents(grossCents - w.fee_cents), w)
}
