// Pure recurring-vendor detection (Phase 5). Thresholds pinned in the design spec §3.5;
// tests assert the exact numbers. Expense direction only; integer cents.
import type { InsightAccount, InsightEntry } from "./insight-types"
import { normalizeCounterparty } from "./insight-types"

export type VendorCadence = "monthly" | "annual"

export interface RecurringVendor {
  key: string
  display_name: string
  account_id: string | null
  account_name: string
  cadence: VendorCadence
  charge_count: number
  typical_amount_cents: number
  annualized_cents: number
  total_cents: number
  first_seen: string
  last_seen: string
  duplicate_group: string | null
}

export interface VendorSweep {
  recurring: RecurringVendor[]
  vendor_count: number
  unattributed_expense_count: number
  unattributed_expense_cents: number
}

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** odd n → middle; even n → Math.round(avg of two middle). Input must be sorted asc. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** entries must be pre-filtered to ONE book by the caller. */
export function vendorSweep(entries: InsightEntry[], accounts: InsightAccount[]): VendorSweep {
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  let unattributedCount = 0
  let unattributedCents = 0
  const byVendor = new Map<string, { display: string; rows: InsightEntry[] }>()
  for (const e of entries) {
    if (e.direction !== "expense") continue
    const key = normalizeCounterparty(e.counterparty)
    if (key === null) {
      unattributedCount += 1
      unattributedCents += e.amount_cents
      continue
    }
    const vendor = byVendor.get(key)
    if (vendor) vendor.rows.push(e)
    else byVendor.set(key, { display: (e.counterparty ?? "").trim(), rows: [e] })
  }

  const recurring: RecurringVendor[] = []
  for (const [key, vendor] of byVendor) {
    // Collapse same-day charges into one event (a multi-line order is one purchase).
    const byDay = new Map<string, number>()
    let total = 0
    for (const row of vendor.rows) {
      byDay.set(row.occurred_on, (byDay.get(row.occurred_on) ?? 0) + row.amount_cents)
      total += row.amount_cents
    }
    const events = [...byDay.entries()]
      .map(([day, amount]) => ({ day, amount }))
      .sort((a, b) => a.day.localeCompare(b.day))
    if (events.length < 2) continue

    const amountsSorted = events.map((ev) => ev.amount).sort((a, b) => a - b)
    const medAmount = median(amountsSorted)
    if (medAmount === 0) continue
    if (!events.every((ev) => Math.abs(ev.amount - medAmount) <= 0.2 * medAmount)) continue

    const gaps: number[] = []
    for (let i = 1; i < events.length; i++) gaps.push(dayNumber(events[i].day) - dayNumber(events[i - 1].day))
    const medGap = median([...gaps].sort((a, b) => a - b))

    let cadence: VendorCadence | null = null
    if (events.length >= 3 && medGap >= 25 && medGap <= 35) cadence = "monthly"
    else if (medGap >= 330 && medGap <= 400) cadence = "annual"
    if (cadence === null) continue

    const totals = new Map<string | null, number>()
    for (const row of vendor.rows) {
      const id = row.account_id !== null && accountById.has(row.account_id) ? row.account_id : null
      totals.set(id, (totals.get(id) ?? 0) + row.amount_cents)
    }
    const nameOf = (id: string | null) => (id === null ? "(uncategorized)" : accountById.get(id)?.name ?? "(uncategorized)")
    const dominant = [...totals.entries()].sort(
      (a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])),
    )[0][0]

    recurring.push({
      key,
      display_name: vendor.display,
      account_id: dominant,
      account_name: nameOf(dominant),
      cadence,
      charge_count: events.length,
      typical_amount_cents: medAmount,
      annualized_cents: cadence === "monthly" ? medAmount * 12 : medAmount,
      total_cents: total,
      first_seen: events[0].day,
      last_seen: events[events.length - 1].day,
      duplicate_group: null,
    })
  }

  const monthlyByAccount = new Map<string, RecurringVendor[]>()
  for (const v of recurring) {
    if (v.cadence !== "monthly" || v.account_id === null) continue
    const group = monthlyByAccount.get(v.account_id)
    if (group) group.push(v)
    else monthlyByAccount.set(v.account_id, [v])
  }
  for (const [accountId, group] of monthlyByAccount) {
    if (group.length >= 2) for (const v of group) v.duplicate_group = accountId
  }

  recurring.sort((a, b) => b.annualized_cents - a.annualized_cents || a.display_name.localeCompare(b.display_name))

  return {
    recurring,
    vendor_count: byVendor.size,
    unattributed_expense_count: unattributedCount,
    unattributed_expense_cents: unattributedCents,
  }
}
