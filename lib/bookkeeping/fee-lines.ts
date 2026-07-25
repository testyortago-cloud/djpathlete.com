/** Display strings for the net-revenue second line (Track A §1.4). ONE place so
 *  the web report, the print view and the accountant xlsx cannot drift apart on
 *  wording or on sign.
 *
 *  Two honesty rules live here:
 *  1. Zero fees never render as a bare "$0.00" and the net line never restates
 *     gross under a "net" label — `cron_bookkeeping_payout_sync_enabled` seeds
 *     false, so zero-fees is the DEFAULT state on arrival, and a workbook that
 *     leaves the building must not assert a Stripe-run business paid no fees.
 *  2. The minus sign is applied here, never by the caller — formatCents
 *     delegates to Intl, which already signs negatives (a fee-refund window can
 *     sum below zero), so hand-prefixing would print "−-$3.00".
 *  Integer cents in, strings out; no float math. */
import { formatCents } from "@/lib/bookkeeping/money"

export const NO_PAYOUTS_FEE_NOTE = "$0.00 — no payouts ingested for this period"
export const NET_AFTER_FEES_PENDING = "— available after the first payout sync"

/** The "Stripe processing fees (est.)" cell. */
export function feeLineDisplay(feeCents: number): string {
  if (feeCents === 0) return NO_PAYOUTS_FEE_NOTE
  return feeCents > 0 ? `−${formatCents(feeCents)}` : formatCents(feeCents)
}

/** The "…after Stripe fees (est.)" cell, netted off the GROSS INCOME side
 *  (spec §1.4 — the sibling of "Total gross income", not of P&L net). */
export function netAfterFeesDisplay(grossCents: number, feeCents: number): string {
  if (feeCents === 0) return NET_AFTER_FEES_PENDING
  return formatCents(grossCents - feeCents)
}
