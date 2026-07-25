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

export interface AllocatedServiceLineRow extends ServiceLineProfitRow {
  allocated_shared_cents: number
  net_after_allocated_cents: number
}

/** Largest-remainder allocation of shared_cost_cents by income share (5b, B-4).
 *  Floors every raw share, then hands out the leftover cents by fractional
 *  remainder desc (tie → row order) so allocated cents sum EXACTLY to
 *  shared_cost_cents — naive per-row rounding loses or invents cents.
 *  Zero-income lines get 0; income_total 0 → no allocation. This file's first
 *  division: labeled an ESTIMATE in the UI, never a ledger write. */
export function allocateSharedCosts(profit: ServiceLineProfit): {
  rows: AllocatedServiceLineRow[]
  allocated_total_cents: number
} {
  const shared = profit.shared_cost_cents
  const total = profit.income_total_cents
  if (shared <= 0 || total <= 0) {
    return {
      rows: profit.rows.map((r) => ({
        ...r,
        allocated_shared_cents: 0,
        net_after_allocated_cents: r.net_estimate_cents,
      })),
      allocated_total_cents: 0,
    }
  }
  const raw = profit.rows.map((r) => (r.income_cents > 0 ? (shared * r.income_cents) / total : 0))
  const alloc = raw.map(Math.floor)
  let leftover = shared - alloc.reduce((s, v) => s + v, 0)
  const byRemainder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    // Redundant guard: zero-income rows have frac 0 and sort last, and
    // leftover < count(frac > 0), so they can never reach a leftover cent.
    .filter((x) => profit.rows[x.i].income_cents > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of byRemainder) {
    if (leftover <= 0) break
    alloc[i] += 1
    leftover -= 1
  }
  return {
    rows: profit.rows.map((r, i) => ({
      ...r,
      allocated_shared_cents: alloc[i],
      net_after_allocated_cents: r.net_estimate_cents - alloc[i],
    })),
    allocated_total_cents: alloc.reduce((s, v) => s + v, 0),
  }
}
