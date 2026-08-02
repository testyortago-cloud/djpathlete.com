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

/**
 * Parse a hand-typed dollar amount ("249", "$1,249.5", "1,249.50") to integer
 * cents via STRING split on the decimal point — never `parseFloat * 100`,
 * which drifts. Client-safe twin of statement-parse.ts's `parseAmountToCents`,
 * which additionally decodes bank conventions (parentheses, CR/DR suffixes) a
 * coach typing into a review grid never uses.
 *
 * Returns null for anything that isn't a plain non-negative number — blank,
 * negative, or "abc". Direction (income/expense) carries the sign in this
 * feature, so a typed minus is a mistake, not a credit.
 */
export function parseDollarsToCents(input: string): number | null {
  const s = String(input ?? "").trim().replace(/[$,\s]/g, "")
  if (s === "" || !/\d/.test(s) || !/^\d*\.?\d*$/.test(s)) return null

  const [intPartRaw = "", fracPartRaw = ""] = s.split(".")
  const intPart = intPartRaw === "" ? 0 : parseInt(intPartRaw, 10)
  let fracPart = fracPartRaw
  if (fracPart.length > 2) fracPart = fracPart.slice(0, 2)
  while (fracPart.length < 2) fracPart += "0"

  return intPart * 100 + parseInt(fracPart, 10)
}

/** Cents → the plain "249.00" string used as a money input's editable value.
 *  Integer math only, so it round-trips through parseDollarsToCents exactly. */
export function centsToDollarInput(cents: number): string {
  const abs = Math.abs(Math.trunc(cents))
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}
