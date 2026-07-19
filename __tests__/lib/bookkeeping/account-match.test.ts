import { describe, it, expect } from "vitest"
import { matchAccountForServiceLine } from "@/lib/bookkeeping/account-match"
import type { BookkeepingAccount } from "@/types/database"

function acct(over: Partial<BookkeepingAccount>): BookkeepingAccount {
  return { id: "a1", name: "X", account_type: "income", service_line: null, archived_at: null, ...over } as BookkeepingAccount
}

describe("matchAccountForServiceLine", () => {
  it("returns the single matching account", () => {
    const a = acct({ id: "p1", name: "Session Packs", service_line: "session_packs" })
    expect(matchAccountForServiceLine("income", "session_packs", [a])?.id).toBe("p1")
  })

  it("prefers the Stripe-named account when several share the service line", () => {
    const sports = acct({ id: "s1", name: "Performance Training — Sports", service_line: "performance_training" })
    const stripe = acct({ id: "s2", name: "Performance Training — Stripe", service_line: "performance_training" })
    expect(matchAccountForServiceLine("income", "performance_training", [sports, stripe])?.id).toBe("s2")
    expect(matchAccountForServiceLine("income", "performance_training", [stripe, sports])?.id).toBe("s2")
  })

  it("falls back to alphabetical-first when no Stripe name exists", () => {
    const b = acct({ id: "b", name: "Bravo", service_line: "other" })
    const a = acct({ id: "a", name: "Alpha", service_line: "other" })
    expect(matchAccountForServiceLine("income", "other", [b, a])?.id).toBe("a")
  })

  it("never matches wrong type, archived accounts, or null service line", () => {
    const wrongType = acct({ id: "w", name: "W", account_type: "expense", service_line: "camps" })
    const archived = acct({ id: "x", name: "X", service_line: "camps", archived_at: "2026-01-01T00:00:00Z" })
    expect(matchAccountForServiceLine("income", "camps", [wrongType, archived])).toBeNull()
    expect(matchAccountForServiceLine("income", null, [acct({ service_line: "camps" })])).toBeNull()
  })
})
