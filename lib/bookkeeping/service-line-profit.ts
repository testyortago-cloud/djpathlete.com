// Pure profit-by-service-line ESTIMATE (Phase 5): income per line minus DIRECT-assigned
// costs; untagged expense accounts stay an honest "shared / overhead" bucket.
import type { InsightAccount, InsightEntry } from "./insight-types"
import { SERVICE_LINE_LABELS, incomeByServiceLine } from "./reports"

export interface ServiceLineProfitRow {
  service_line: string | null
  label: string
  income_cents: number
  direct_cost_cents: number
  net_estimate_cents: number
}

export interface ServiceLineProfit {
  rows: ServiceLineProfitRow[]
  income_total_cents: number
  direct_cost_total_cents: number
  shared_cost_cents: number
  uncategorized_expense_cents: number
}

/** entries must be pre-filtered to ONE book by the caller. */
export function serviceLineProfit(entries: InsightEntry[], accounts: InsightAccount[]): ServiceLineProfit {
  const income = incomeByServiceLine(entries, accounts)
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const directByLine = new Map<string, number>()
  let shared = 0
  let uncategorized = 0
  for (const e of entries) {
    if (e.direction !== "expense") continue
    const account = e.account_id === null ? undefined : accountById.get(e.account_id)
    if (!account) {
      uncategorized += e.amount_cents
    } else if (account.service_line === null) {
      shared += e.amount_cents
    } else {
      directByLine.set(account.service_line, (directByLine.get(account.service_line) ?? 0) + e.amount_cents)
    }
  }

  const rowByLine = new Map<string | null, ServiceLineProfitRow>()
  for (const r of income.rows) {
    rowByLine.set(r.service_line, {
      service_line: r.service_line,
      label: r.label,
      income_cents: r.total_cents,
      direct_cost_cents: 0,
      net_estimate_cents: r.total_cents,
    })
  }
  for (const [line, cost] of directByLine) {
    const existing = rowByLine.get(line)
    if (existing) {
      existing.direct_cost_cents = cost
      existing.net_estimate_cents = existing.income_cents - cost
    } else {
      rowByLine.set(line, {
        service_line: line,
        label: SERVICE_LINE_LABELS[line] ?? line,
        income_cents: 0,
        direct_cost_cents: cost,
        net_estimate_cents: -cost,
      })
    }
  }

  return {
    rows: [...rowByLine.values()].sort(
      (a, b) => b.income_cents - a.income_cents || a.label.localeCompare(b.label),
    ),
    income_total_cents: income.total_cents,
    direct_cost_total_cents: [...directByLine.values()].reduce((sum, v) => sum + v, 0),
    shared_cost_cents: shared,
    uncategorized_expense_cents: uncategorized,
  }
}
