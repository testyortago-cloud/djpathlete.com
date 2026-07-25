// Pure fee aggregation for the net-revenue report layer (Track A §1.4).
// Fees attribute by BALANCE-TXN date, not payout arrival date (Decision A-3),
// so the fee sum aligns with the same window as gross income — a January
// charge paid out in February counts against January. Honest caveat rendered
// beside the number: fees appear only after their payout is ingested.
// type:"payout" self-rows are never stored (filtered at sync), so every line
// here is a constituent transaction. Integer cents end-to-end.
export interface PayoutLineRef {
  txn_date: string // YYYY-MM-DD
  fee_cents: number
}

export function stripeFeesInWindow(lines: PayoutLineRef[], from: string, to: string): number {
  let total = 0
  for (const l of lines) {
    if (l.txn_date >= from && l.txn_date <= to) total += l.fee_cents
  }
  return total
}
