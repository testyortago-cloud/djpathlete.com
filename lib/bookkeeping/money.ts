import type { LedgerDirection } from "@/types/database"

/** Canonical money formatter for the bookkeeping feature. Cents → "$1,234.56". */
export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/** Signed magnitude: income positive, expense negative. */
export function signedCents(cents: number, direction: LedgerDirection): number {
  return direction === "expense" ? -Math.abs(cents) : Math.abs(cents)
}
