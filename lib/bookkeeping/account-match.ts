// Deterministic service_line → account resolution for import drafts. When a
// book has several accounts on one service line (e.g. "Performance Training —
// Sports" AND "— Stripe"), platform imports must not depend on array order:
// prefer the Stripe-named account, then alphabetical. Pure, zero IO.
import type { BookkeepingAccount } from "@/types/database"

export function matchAccountForServiceLine(
  direction: "income" | "expense",
  serviceLine: string | null,
  accounts: BookkeepingAccount[],
): BookkeepingAccount | null {
  if (!serviceLine) return null
  const matches = accounts.filter(
    (a) =>
      a.account_type === direction &&
      a.service_line === serviceLine &&
      (a as { archived_at?: string | null }).archived_at == null,
  )
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => {
    const aStripe = /stripe/i.test(a.name) ? 0 : 1
    const bStripe = /stripe/i.test(b.name) ? 0 : 1
    if (aStripe !== bStripe) return aStripe - bStripe
    return a.name.localeCompare(b.name)
  })[0]
}
