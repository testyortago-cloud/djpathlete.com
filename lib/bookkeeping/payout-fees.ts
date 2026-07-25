// Pure fee aggregation for the net-revenue report layer (Track A §1.4).
// Fees attribute by BALANCE-TXN date, not payout arrival date (Decision A-3),
// so the fee sum aligns with the same window as gross income — a January
// charge paid out in February counts against January. Honest caveat rendered
// beside the number: fees appear only after their payout is ingested.
// type:"payout" self-rows are never stored (filtered at sync), so every line
// here is a constituent transaction. Integer cents end-to-end.
//
// A bare fee SUM is not enough to describe a window honestly. Stripe's
// per-payout balance-transaction filter works "for automatic Stripe payouts
// only", so a MANUAL payout ingests with no constituent lines at all — a real
// payout that contributes $0.00 of fees. "$0.00" and "we have no payout data"
// must therefore be different signals, and a window holding an unexplained
// payout must never render a clean net number. stripeFeeWindow carries the
// three facts the display layer needs: the sum, how many payouts produced it,
// and how many of those the sync could not fully explain
// (bookkeeping_payouts.fees_reconciled = gross − fee = payout net).
export interface PayoutLineRef {
  txn_date: string // YYYY-MM-DD
  fee_cents: number
  /** Parent payout. Optional so pre-join test doubles still type-check. */
  payout_id?: string | null
  /** False when the parent payout's lines do not explain its net. */
  fees_reconciled?: boolean | null
}

/** A payout that landed in the window, whether or not it produced any lines.
 *  A MANUAL payout produces none at all — counting only line-bearing payouts
 *  would report "no payouts ingested" for a window made entirely of them, which
 *  is the precise falsehood this module exists to prevent. */
export interface PayoutWindowRef {
  id: string
  fees_reconciled: boolean
}

export interface StripeFeeWindow {
  fee_cents: number
  /** DISTINCT ingested payouts touching the window — by line date OR by arrival. */
  payout_count: number
  /** Of those, how many carry fees the sync could not reconcile. */
  unreconciled_count: number
}

/** The ONLY shape that may render "no payouts ingested for this period". */
export const NO_FEE_DATA: StripeFeeWindow = Object.freeze({
  fee_cents: 0, payout_count: 0, unreconciled_count: 0,
})

/** `lines` are windowed by BALANCE-TXN date (where the money is); `payouts` are
 *  the window's payouts by ARRIVAL date (where the availability is). The two
 *  sets are UNIONED by payout id, so a payout counted through its lines is
 *  never counted twice, and a payout with no lines at all still counts. */
export function stripeFeeWindow(
  lines: PayoutLineRef[], payouts: PayoutWindowRef[], from: string, to: string,
): StripeFeeWindow {
  let total = 0
  // A line whose parent id is missing (legacy/unjoined row) still proves data
  // exists; bucketing them under one sentinel keeps payout_count ≥ 1 rather
  // than collapsing to the zero-state. Counting DISTINCT payouts (not lines) is
  // what makes the "N of M payouts" note true.
  const seen = new Set<string>()
  const unreconciled = new Set<string>()
  for (const l of lines) {
    if (l.txn_date < from || l.txn_date > to) continue
    total += l.fee_cents
    const key = l.payout_id ?? "__unattributed__"
    seen.add(key)
    if (l.fees_reconciled === false) unreconciled.add(key)
  }
  for (const p of payouts) {
    seen.add(p.id)
    if (!p.fees_reconciled) unreconciled.add(p.id)
  }
  return { fee_cents: total, payout_count: seen.size, unreconciled_count: unreconciled.size }
}

// NOTE: there is deliberately no scalar `stripeFeesInWindow` any more. A bare
// number is exactly what let the display layer infer "no payouts ingested" from
// "the sum is zero"; every consumer takes the window so the availability facts
// travel with the money.
