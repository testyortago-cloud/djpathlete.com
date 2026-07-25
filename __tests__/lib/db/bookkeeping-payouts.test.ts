import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable Supabase mock — house idiom, see __tests__/lib/db/bookkeeping-period-guard.test.ts.
type Row = Record<string, unknown>
const state = {
  selectRows: [] as Row[],
  maybeSingleRow: null as Row | null,
  upsertCalls: [] as Array<{ table: string; rows: Row[]; opts: unknown }>,
  selectCalls: [] as Array<{
    table: string
    cols: string
    eqMap: Record<string, string>
    inArgs: { col: string; vals: string[] } | null
    gteMap: Record<string, string>
    lteMap: Record<string, string>
  }>,
}
function resetState() {
  state.selectRows = []
  state.maybeSingleRow = null
  state.upsertCalls = []
  state.selectCalls = []
}
function makeBuilder(table: string) {
  let op: "select" | "upsert" | null = null
  let cols = ""
  let upsertRows: Row[] = []
  const eqMap: Record<string, string> = {}
  const gteMap: Record<string, string> = {}
  const lteMap: Record<string, string> = {}
  let inArgs: { col: string; vals: string[] } | null = null
  const resolve = (): Promise<{ data: unknown; error: unknown }> => {
    if (op === "select") {
      state.selectCalls.push({ table, cols, eqMap, inArgs, gteMap, lteMap })
      return Promise.resolve({ data: state.selectRows, error: null })
    }
    // upsert path: echo rows back with ids so the caller can map them
    return Promise.resolve({ data: upsertRows.map((r, i) => ({ id: `row-${i}`, ...r })), error: null })
  }
  const builder = {
    select: (c?: string) => {
      if (op === null) op = "select"
      cols = c ?? ""
      return builder
    },
    upsert: (rows: Row[], opts: unknown) => {
      op = "upsert"
      upsertRows = rows
      state.upsertCalls.push({ table, rows, opts })
      return builder
    },
    eq: (c: string, v: string) => {
      eqMap[c] = v
      return builder
    },
    in: (c: string, vals: string[]) => {
      inArgs = { col: c, vals }
      return builder
    },
    gte: (c: string, v: string) => {
      gteMap[c] = v
      return builder
    },
    lte: (c: string, v: string) => {
      lteMap[c] = v
      return builder
    },
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    maybeSingle: () => {
      state.selectCalls.push({ table, cols, eqMap, inArgs, gteMap, lteMap })
      return Promise.resolve({ data: state.maybeSingleRow, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable protocol
    then: (onF?: any, onR?: any) => resolve().then(onF, onR),
  }
  return builder
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

import {
  upsertPayouts,
  upsertPayoutLines,
  latestPayoutArrivalDate,
  listPayoutsForDedupe,
  listNonTerminalPayouts,
  listPayoutLinesForWindow,
} from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const payoutRow = {
  stripe_payout_id: "po_1",
  book_id: BOOK,
  amount_cents: 9600,
  gross_cents: 10000,
  fee_cents: 400,
  arrival_date: "2026-07-07",
  status: "paid" as const,
  currency: "usd",
  raw: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetState()
})

describe("upsertPayouts", () => {
  it("MERGE-mode upsert on stripe_payout_id (no ignoreDuplicates — status flips must land)", async () => {
    const out = await upsertPayouts([payoutRow])
    const call = state.upsertCalls.at(-1)!
    expect(call.table).toBe("bookkeeping_payouts")
    expect(call.opts).toEqual({ onConflict: "stripe_payout_id" })
    expect(call.rows[0]).toMatchObject({ stripe_payout_id: "po_1", amount_cents: 9600 })
    expect(out[0]).toMatchObject({ id: "row-0", stripe_payout_id: "po_1" })
  })
  it("empty input → no builder call", async () => {
    expect(await upsertPayouts([])).toEqual([])
    expect(state.upsertCalls).toHaveLength(0)
  })
})

describe("upsertPayoutLines", () => {
  it("MERGE-mode upsert on stripe_balance_txn_id, returns count", async () => {
    const n = await upsertPayoutLines([
      {
        payout_id: "row-0",
        stripe_balance_txn_id: "txn_1",
        type: "charge",
        amount_cents: 10000,
        fee_cents: 400,
        net_cents: 9600,
        txn_date: "2026-07-03",
        description: null,
        source_ref: "ch_1",
      },
    ])
    expect(n).toBe(1)
    expect(state.upsertCalls.at(-1)).toMatchObject({
      table: "bookkeeping_payout_lines",
      opts: { onConflict: "stripe_balance_txn_id" },
    })
  })
  it("empty input → 0 without a builder call", async () => {
    expect(await upsertPayoutLines([])).toBe(0)
    expect(state.upsertCalls).toHaveLength(0)
  })
})

describe("latestPayoutArrivalDate", () => {
  it("returns the newest arrival_date", async () => {
    state.maybeSingleRow = { arrival_date: "2026-07-20" }
    expect(await latestPayoutArrivalDate(BOOK)).toBe("2026-07-20")
    expect(state.selectCalls.at(-1)!.eqMap.book_id).toBe(BOOK)
  })
  it("null when no payouts exist", async () => {
    state.maybeSingleRow = null
    expect(await latestPayoutArrivalDate(BOOK)).toBeNull()
  })
})

describe("listPayoutsForDedupe", () => {
  it("selects with the net_cents:amount_cents alias, scoped to book + window", async () => {
    state.selectRows = [
      { id: "p1", stripe_payout_id: "po_1", net_cents: 9600, arrival_date: "2026-07-07", status: "paid" },
    ]
    const rows = await listPayoutsForDedupe(BOOK, "2026-07-01", "2026-07-31")
    expect(rows[0].net_cents).toBe(9600)
    const call = state.selectCalls.at(-1)!
    expect(call.cols).toContain("net_cents:amount_cents")
    expect(call.eqMap.book_id).toBe(BOOK)
    expect(call.gteMap.arrival_date).toBe("2026-07-01")
    expect(call.lteMap.arrival_date).toBe("2026-07-31")
  })
})

describe("listNonTerminalPayouts", () => {
  it("filters status in (pending, in_transit) for the book", async () => {
    state.selectRows = []
    await listNonTerminalPayouts(BOOK)
    const call = state.selectCalls.at(-1)!
    expect(call.inArgs).toEqual({ col: "status", vals: ["pending", "in_transit"] })
    expect(call.eqMap.book_id).toBe(BOOK)
  })
})

describe("listPayoutLinesForWindow", () => {
  it("windows on txn_date inclusive", async () => {
    state.selectRows = [
      { txn_date: "2026-07-03", fee_cents: 400, net_cents: 9600, amount_cents: 10000, type: "charge" },
    ]
    const rows = await listPayoutLinesForWindow("2026-07-01", "2026-07-31")
    expect(rows).toHaveLength(1)
    const call = state.selectCalls.at(-1)!
    expect(call.gteMap.txn_date).toBe("2026-07-01")
    expect(call.lteMap.txn_date).toBe("2026-07-31")
  })
})
