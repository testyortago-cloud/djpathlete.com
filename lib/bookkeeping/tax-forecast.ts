// Pure rolling tax forecast (Phase 6b, D-8/D-9). Flat coach/CPA-entered effective
// rate × calendar-YTD net. Deliberately dumb: brackets / SE / QBI would be fake
// precision the honesty guardrails forbid. Estimate only — the CPA files.
import type { InsightEntry } from "./insight-types"

export interface TaxForecastInput {
  ytd_income_cents: number
  ytd_expense_cents: number
  home_office_deduction_cents: number | null
  rate_percent: number | null
  today: string
}

export interface SafeHarborDate {
  label: string
  date: string
}

export interface TaxForecast {
  ytd_income_cents: number
  ytd_expense_cents: number
  home_office_deduction_cents: number | null
  estimated_net_cents: number
  rate_percent: number | null
  estimated_tax_cents: number | null
  next_safe_harbor: SafeHarborDate
}

// Generic US quarterly estimated-tax calendar. Fixed list, never computed from
// entity type — the CPA confirms the coach's actual dates.
const SAFE_HARBOR_MONTH_DAYS = [
  { md: "01-15", month: "Jan" },
  { md: "04-15", month: "Apr" },
  { md: "06-15", month: "Jun" },
  { md: "09-15", month: "Sep" },
] as const

/** First generic safe-harbor date STRICTLY after today; Jan rolls into next year. */
export function nextSafeHarbor(today: string): SafeHarborDate {
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    for (const { md, month } of SAFE_HARBOR_MONTH_DAYS) {
      const date = `${y}-${md}`
      if (date > today) return { label: `${month} 15, ${y}`, date }
    }
  }
  // Unreachable: next year's Jan 15 is always strictly after any date in `year`.
  throw new Error(`nextSafeHarbor: no candidate after ${today}`)
}

/** Per-book YTD income/expense sums (integer cents, no rounding, book-scoped). */
export function bookYtdTotals(
  entries: InsightEntry[],
  bookId: string,
): { ytd_income_cents: number; ytd_expense_cents: number } {
  let income = 0
  let expense = 0
  for (const e of entries) {
    if (e.book_id !== bookId) continue
    if (e.direction === "income") income += e.amount_cents
    else expense += e.amount_cents
  }
  return { ytd_income_cents: income, ytd_expense_cents: expense }
}

export function taxForecast(input: TaxForecastInput): TaxForecast {
  const net =
    input.ytd_income_cents - input.ytd_expense_cents - (input.home_office_deduction_cents ?? 0)
  const estimatedTax =
    input.rate_percent === null
      ? null
      : Math.round((Math.max(0, net) * input.rate_percent) / 100) // the ONLY rounding point
  return {
    ytd_income_cents: input.ytd_income_cents,
    ytd_expense_cents: input.ytd_expense_cents,
    home_office_deduction_cents: input.home_office_deduction_cents,
    estimated_net_cents: net,
    rate_percent: input.rate_percent,
    estimated_tax_cents: estimatedTax,
    next_safe_harbor: nextSafeHarbor(input.today),
  }
}
