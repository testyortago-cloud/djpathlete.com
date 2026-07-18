import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_SOFT = "a0000000-0000-4000-8000-000000000001"
const ACC_PHONE = "a0000000-0000-4000-8000-000000000002"

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_SOFT, book_id: BOOK, name: "Software & Subscriptions", account_type: "expense",
    service_line: null, tax_category: null, sort_order: 0,
    is_deductible_candidate: true, requires_business_purpose: false, archived_at: null,
    ...over,
  }
}
let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK, account_id: ACC_SOFT, direction: "expense", amount_cents: 1000,
    occurred_on: "2026-01-01", counterparty: "Trainerize", memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}
const accounts = [account({}), account({ id: ACC_PHONE, name: "Phone & Internet" })]

function charges(vendor: string, days: string[], cents: number | number[], accountId = ACC_SOFT): InsightEntry[] {
  return days.map((d, i) =>
    entry({ counterparty: vendor, occurred_on: d, amount_cents: Array.isArray(cents) ? cents[i] : cents, account_id: accountId }),
  )
}

describe("vendorSweep — monthly detection", () => {
  it("detects a monthly subscription (28–31d gaps, amounts within ±20% of median)", () => {
    const r = vendorSweep(charges("Trainerize", ["2026-01-03", "2026-02-02", "2026-03-04"], [999, 1001, 1000]), accounts)
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0]).toMatchObject({
      key: "trainerize", cadence: "monthly", charge_count: 3,
      typical_amount_cents: 1000, annualized_cents: 12000, total_cents: 3000,
      first_seen: "2026-01-03", last_seen: "2026-03-04",
      account_id: ACC_SOFT, account_name: "Software & Subscriptions",
    })
  })
  it("gap boundaries: 25 and 35 pass; 24 and 36 fail", () => {
    expect(vendorSweep(charges("A", ["2026-01-01", "2026-01-26", "2026-02-20"], 1000), accounts).recurring).toHaveLength(1) // gaps 25,25
    expect(vendorSweep(charges("B", ["2026-01-01", "2026-02-05", "2026-03-12"], 1000), accounts).recurring).toHaveLength(1) // gaps 35,35
    expect(vendorSweep(charges("C", ["2026-01-01", "2026-01-25", "2026-02-18"], 1000), accounts).recurring).toHaveLength(0) // gaps 24,24
    expect(vendorSweep(charges("D", ["2026-01-01", "2026-02-06", "2026-03-14"], 1000), accounts).recurring).toHaveLength(0) // gaps 36,36
  })
  it("one skipped month tolerated via median with 4 events (gaps 30,30,60 → median 30)", () => {
    const r = vendorSweep(charges("E", ["2026-01-01", "2026-01-31", "2026-03-02", "2026-05-01"], 1000), accounts)
    expect(r.recurring).toHaveLength(1)
  })
  it("amount tolerance boundary: exactly +20% of median passes, +20%+1¢ fails", () => {
    expect(vendorSweep(charges("F", ["2026-01-01", "2026-01-31", "2026-03-02"], [1000, 1000, 1200]), accounts).recurring).toHaveLength(1)
    expect(vendorSweep(charges("G", ["2026-01-01", "2026-01-31", "2026-03-02"], [1000, 1000, 1201]), accounts).recurring).toHaveLength(0)
  })
  it("same-day charges collapse into one event before cadence math", () => {
    const r = vendorSweep([
      ...charges("H", ["2026-01-01"], 500), ...charges("H", ["2026-01-01"], 500), // one 1000¢ event
      ...charges("H", ["2026-01-31"], 1000), ...charges("H", ["2026-03-02"], 1000),
    ], accounts)
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0].charge_count).toBe(3)
  })
  it("2 events are never monthly; zero-median vendors are skipped", () => {
    expect(vendorSweep(charges("I", ["2026-01-01", "2026-01-31"], 1000), accounts).recurring).toHaveLength(0)
    expect(vendorSweep(charges("J", ["2026-01-01", "2026-01-31", "2026-03-02"], 0), accounts).recurring).toHaveLength(0)
  })
  it("income-direction entries are ignored", () => {
    const rows = charges("K", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000).map((e) => ({ ...e, direction: "income" as const }))
    expect(vendorSweep(rows, accounts).recurring).toHaveLength(0)
  })
})

describe("vendorSweep — annual, duplicates, unattributed, sorting", () => {
  it("detects annual with 2 events in [330,400]; 329/401 fail", () => {
    expect(vendorSweep(charges("Y1", ["2025-01-01", "2026-01-01"], 9900), accounts).recurring[0]).toMatchObject({ cadence: "annual", annualized_cents: 9900 }) // 365
    expect(vendorSweep(charges("Y2", ["2025-01-01", "2025-11-26"], 9900), accounts).recurring).toHaveLength(0) // 329
    expect(vendorSweep(charges("Y3", ["2025-01-01", "2026-02-06"], 9900), accounts).recurring).toHaveLength(0) // 401
  })
  it("flags duplicate tools: two monthly vendors sharing a dominant account", () => {
    const r = vendorSweep([
      ...charges("Zoom", ["2026-01-01", "2026-01-31", "2026-03-02"], 1500),
      ...charges("Meet", ["2026-01-05", "2026-02-04", "2026-03-06"], 1200),
      ...charges("Verizon", ["2026-01-02", "2026-02-01", "2026-03-03"], 8000, ACC_PHONE),
    ], accounts)
    const zoom = r.recurring.find((v) => v.key === "zoom")
    const meet = r.recurring.find((v) => v.key === "meet")
    const verizon = r.recurring.find((v) => v.key === "verizon")
    expect(zoom?.duplicate_group).toBe(ACC_SOFT)
    expect(meet?.duplicate_group).toBe(ACC_SOFT)
    expect(verizon?.duplicate_group).toBeNull()
  })
  it("counts unattributed (blank counterparty) expenses; sorts recurring by annualized desc", () => {
    const r = vendorSweep([
      entry({ counterparty: null, amount_cents: 700 }),
      entry({ counterparty: "  ", amount_cents: 300 }),
      ...charges("Big", ["2026-01-01", "2026-01-31", "2026-03-02"], 5000),
      ...charges("Small", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000),
    ], accounts)
    expect(r.unattributed_expense_count).toBe(2)
    expect(r.unattributed_expense_cents).toBe(1000)
    expect(r.recurring.map((v) => v.key)).toEqual(["big", "small"])
    expect(r.vendor_count).toBe(2)
  })
  it("empty input → well-shaped empty", () => {
    expect(vendorSweep([], accounts)).toEqual({
      recurring: [], vendor_count: 0, unattributed_expense_count: 0, unattributed_expense_cents: 0,
    })
  })
})

// Review follow-up: the six invariants below were pinned in the implementation and
// self-review write-up but had no discriminating test — every prior fixture either used an
// odd-length array (median's even branch never ran) or never produced a genuine tie. Each
// test here is built so a plausible-but-wrong implementation of its invariant flips the
// assertion. See the red-proof note in the task-5 fix report for the median cases.
describe("vendorSweep — pinned invariant discrimination", () => {
  it("even-n median for amounts: [1000,1000,1100,1100] -> Math.round(avg) = 1050, not the lower-middle element", () => {
    // gaps 30,30,30 (median 30, monthly); amounts sorted are already [1000,1000,1100,1100]
    const r = vendorSweep(
      charges("MedAmt", ["2026-01-01", "2026-01-31", "2026-03-02", "2026-04-01"], [1000, 1000, 1100, 1100]),
      accounts,
    )
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0]).toMatchObject({
      cadence: "monthly", charge_count: 4,
      typical_amount_cents: 1050, annualized_cents: 12600,
    })
  })

  it("even-n median for gaps: sorted gaps [10,20,44,90] -> Math.round(avg of 20,44) = 32 (monthly); the lower-middle element (20) would misclassify it out of range entirely", () => {
    const r = vendorSweep(
      charges("MedGap", ["2026-01-01", "2026-01-11", "2026-01-31", "2026-03-16", "2026-06-14"], 1000),
      accounts,
    )
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0]).toMatchObject({ cadence: "monthly", charge_count: 5 })
  })

  it("dominant-account tie-break: equal totals on two accounts -> lexicographically smaller account name wins", () => {
    // "Ties" charged twice on ACC_SOFT and twice on ACC_PHONE, 1000 each -> 2000 vs 2000 tie.
    // "Phone & Internet" < "Software & Subscriptions" alphabetically.
    const r = vendorSweep(
      [
        ...charges("Ties", ["2026-01-01", "2026-03-02"], 1000, ACC_SOFT),
        ...charges("Ties", ["2026-01-31", "2026-04-01"], 1000, ACC_PHONE),
      ],
      accounts,
    )
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0]).toMatchObject({
      cadence: "monthly", charge_count: 4,
      account_id: ACC_PHONE, account_name: "Phone & Internet",
    })
  })

  it("duplicate_group is tagged only on MONTHLY vendors sharing a dominant account; an annual vendor on the same account stays null", () => {
    const r = vendorSweep(
      [
        ...charges("AnnualCo", ["2025-01-01", "2026-01-01"], 9900, ACC_SOFT), // gap 365 -> annual
        ...charges("MonA", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000, ACC_SOFT), // gaps 30,30 -> monthly
        ...charges("MonB", ["2026-01-05", "2026-02-04", "2026-03-06"], 1200, ACC_SOFT), // gaps 30,30 -> monthly
      ],
      accounts,
    )
    const annual = r.recurring.find((v) => v.key === "annualco")
    const monA = r.recurring.find((v) => v.key === "mona")
    const monB = r.recurring.find((v) => v.key === "monb")
    expect(annual).toMatchObject({ cadence: "annual", duplicate_group: null })
    expect(monA?.duplicate_group).toBe(ACC_SOFT)
    expect(monB?.duplicate_group).toBe(ACC_SOFT)
  })

  it("display_name keeps the casing of the first entry in array order (\"TRAINERIZE\"), not a later-cased duplicate (\"trainerize\")", () => {
    const r = vendorSweep(
      [
        entry({ counterparty: "TRAINERIZE", occurred_on: "2026-01-01", amount_cents: 1000 }),
        entry({ counterparty: "trainerize", occurred_on: "2026-01-31", amount_cents: 1000 }),
        entry({ counterparty: "trainerize", occurred_on: "2026-03-02", amount_cents: 1000 }),
      ],
      accounts,
    )
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0].display_name).toBe("TRAINERIZE")
  })

  it("an account_id not present in the accounts list falls back to account_id null / account_name \"(uncategorized)\"", () => {
    const UNKNOWN_ACC = "a0000000-0000-4000-8000-000000000099"
    const r = vendorSweep(
      charges("Ghost", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000, UNKNOWN_ACC),
      accounts,
    )
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0]).toMatchObject({ account_id: null, account_name: "(uncategorized)" })
  })

  it("sort tie-break: equal annualized_cents -> ordered by display_name asc (the Big/Small fixture never ties, so this was undiscriminated)", () => {
    const r = vendorSweep(
      [
        ...charges("beta", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000), // annualized 12000
        ...charges("alpha", ["2026-01-05", "2026-02-04", "2026-03-06"], 1000), // annualized 12000, tie
      ],
      accounts,
    )
    expect(r.recurring.map((v) => v.display_name)).toEqual(["alpha", "beta"])
  })
})
