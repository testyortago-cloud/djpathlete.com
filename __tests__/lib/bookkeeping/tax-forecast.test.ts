import { describe, expect, it } from "vitest"
import type { InsightEntry } from "@/lib/bookkeeping/insight-types"
import { bookYtdTotals, nextSafeHarbor, taxForecast, type TaxForecastInput } from "@/lib/bookkeeping/tax-forecast"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_OTHER = "b0000000-0000-4000-8000-000000000002"

let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK_BIZ, account_id: null, direction: "income", amount_cents: 1000,
    occurred_on: "2026-03-01", counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}

function input(over: Partial<TaxForecastInput>): TaxForecastInput {
  return {
    ytd_income_cents: 0, ytd_expense_cents: 0, home_office_deduction_cents: null,
    rate_percent: null, today: "2026-07-18",
    ...over,
  }
}

describe("taxForecast", () => {
  it("null rate → NULL estimated tax (never 0 — the card shows a prompt, no dollar figure)", () => {
    const r = taxForecast(input({ ytd_income_cents: 100000, ytd_expense_cents: 40000 }))
    expect(r.estimated_net_cents).toBe(60000)
    expect(r.estimated_tax_cents).toBeNull()
    expect(r.rate_percent).toBeNull()
    // safe-harbor wiring: today 2026-07-18 → Sep 15 2026
    expect(r.next_safe_harbor).toEqual({ label: "Sep 15, 2026", date: "2026-09-15" })
  })
  it("Math.round at the single defined point: odd cents × 12.34% (trunc gives 152345)", () => {
    // 1234567 × 12.34% = 152345.5678 → Math.round 152346; Math.trunc/floor 152345
    const r = taxForecast(input({ ytd_income_cents: 1234567, rate_percent: 12.34 }))
    expect(r.estimated_tax_cents).toBe(152346)
  })
  it("negative net floors the TAX at 0 but preserves the negative net (dropped-guard discriminator)", () => {
    const r = taxForecast(input({ ytd_income_cents: 1000, ytd_expense_cents: 5000, rate_percent: 20 }))
    expect(r.estimated_net_cents).toBe(-4000) // still shown on the card
    expect(r.estimated_tax_cents).toBe(0)     // NOT -800
  })
  it("home-office deduction subtracts when present and is inert when null", () => {
    const withHo = taxForecast(
      input({ ytd_income_cents: 100000, ytd_expense_cents: 40000, home_office_deduction_cents: 12000, rate_percent: 10 }),
    )
    expect(withHo.estimated_net_cents).toBe(48000)
    expect(withHo.estimated_tax_cents).toBe(4800)
    const withoutHo = taxForecast(input({ ytd_income_cents: 100000, ytd_expense_cents: 40000, rate_percent: 10 }))
    expect(withoutHo.estimated_net_cents).toBe(60000)
    expect(withoutHo.estimated_tax_cents).toBe(6000)
  })
})

describe("nextSafeHarbor (pinned generic calendar)", () => {
  it("strictly-after: Apr 14 → Apr 15; Apr 15 itself → Jun 15 (> vs >= discriminator)", () => {
    expect(nextSafeHarbor("2026-04-14")).toEqual({ label: "Apr 15, 2026", date: "2026-04-15" })
    expect(nextSafeHarbor("2026-04-15")).toEqual({ label: "Jun 15, 2026", date: "2026-06-15" })
  })
  it("Jan rolls the year: Sep 16 and Dec 31 → Jan 15 of NEXT year", () => {
    expect(nextSafeHarbor("2026-09-16")).toEqual({ label: "Jan 15, 2027", date: "2027-01-15" })
    expect(nextSafeHarbor("2026-12-31")).toEqual({ label: "Jan 15, 2027", date: "2027-01-15" })
  })
  it("early January still hits THIS year's Jan 15", () => {
    expect(nextSafeHarbor("2026-01-10")).toEqual({ label: "Jan 15, 2026", date: "2026-01-15" })
  })
})

describe("bookYtdTotals", () => {
  it("splits by direction and never leaks another book's money", () => {
    const totals = bookYtdTotals(
      [
        entry({ amount_cents: 5000 }),
        entry({ amount_cents: 2000, direction: "expense" }),
        entry({ amount_cents: 99999, book_id: BOOK_OTHER }),
      ],
      BOOK_BIZ,
    )
    expect(totals).toEqual({ ytd_income_cents: 5000, ytd_expense_cents: 2000 })
  })
})
