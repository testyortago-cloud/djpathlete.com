import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable Supabase mock — house idiom, see __tests__/lib/db/bookkeeping-period-guard.test.ts.
// Pagination knobs (`pages` + `rangeCalls`) follow __tests__/lib/ads/pipeline.test.ts so a
// dropped fetchAllRows is a discriminating failure, not a silent pass.
type Row = Record<string, unknown>
type OrderArgs = [string, unknown]
const state = {
  selectRows: [] as Row[],
  /** When set, each .range() page resolves to pages[pageIndex] instead of selectRows. */
  pages: null as Row[][] | null,
  maybeSingleRow: null as Row | null,
  /** When set, every resolve returns this error so the `if (error) throw` guards are exercised. */
  error: null as { message: string } | null,
  upsertCalls: [] as Array<{ table: string; rows: Row[]; opts: unknown }>,
  rangeCalls: [] as Array<[number, number]>,
  selectCalls: [] as Array<{
    table: string
    cols: string
    eqMap: Record<string, string>
    inArgs: { col: string; vals: string[] } | null
    gteMap: Record<string, string>
    lteMap: Record<string, string>
    orderArgs: OrderArgs[]
    limitArgs: number[]
  }>,
}
function resetState() {
  state.selectRows = []
  state.pages = null
  state.maybeSingleRow = null
  state.error = null
  state.upsertCalls = []
  state.rangeCalls = []
  state.selectCalls = []
}
function makeBuilder(table: string) {
  let op: "select" | "upsert" | null = null
  let cols = ""
  let upsertRows: Row[] = []
  const eqMap: Record<string, string> = {}
  const gteMap: Record<string, string> = {}
  const lteMap: Record<string, string> = {}
  const orderArgs: OrderArgs[] = []
  const limitArgs: number[] = []
  let inArgs: { col: string; vals: string[] } | null = null
  const record = () => state.selectCalls.push({ table, cols, eqMap, inArgs, gteMap, lteMap, orderArgs, limitArgs })
  const selectData = (): Row[] => {
    if (state.pages === null) return state.selectRows
    // rangeCalls is pushed by .range() before the thenable resolves; index 0 when a
    // (wrong) bare .select() never paged at all.
    return state.pages[Math.max(state.rangeCalls.length - 1, 0)] ?? []
  }
  const resolve = (): Promise<{ data: unknown; error: unknown }> => {
    if (state.error) return Promise.resolve({ data: null, error: state.error })
    if (op === "select") {
      record()
      return Promise.resolve({ data: selectData(), error: null })
    }
    // upsert path: echo rows back with ids so the caller can map them
    return Promise.resolve({
      data: upsertRows.map((r, i) => ({ id: `row-${i}`, ...r })),
      error: null,
    })
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
    order: (c: string, opts?: unknown) => {
      orderArgs.push([c, opts])
      return builder
    },
    limit: (n: number) => {
      limitArgs.push(n)
      return builder
    },
    range: (f: number, t: number) => {
      state.rangeCalls.push([f, t])
      return builder
    },
    maybeSingle: () => {
      if (state.error) return Promise.resolve({ data: null, error: state.error })
      record()
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
const lineRow = {
  payout_id: "row-0",
  stripe_balance_txn_id: "txn_1",
  type: "charge",
  amount_cents: 10000,
  fee_cents: 400,
  net_cents: 9600,
  txn_date: "2026-07-03",
  description: null,
  source_ref: "ch_1",
}
/** N synthetic rows — enough to force fetchAllRows past the 1000-row PostgREST cap. */
function fill(n: number, mk: (i: number) => Row): Row[] {
  return Array.from({ length: n }, (_, i) => mk(i))
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
    // 00191 has no set_updated_at trigger and `default now()` does not re-fire on
    // ON CONFLICT DO UPDATE — the merged row's updated_at must be stamped here.
    expect(call.rows[0]).toHaveProperty("updated_at")
    expect(out[0]).toMatchObject({ id: "row-0", stripe_payout_id: "po_1" })
  })
  it("empty input → no builder call", async () => {
    expect(await upsertPayouts([])).toEqual([])
    expect(state.upsertCalls).toHaveLength(0)
  })
  it("throws on a DB error instead of reporting an empty successful write", async () => {
    state.error = { message: "boom" }
    await expect(upsertPayouts([payoutRow])).rejects.toMatchObject({ message: "boom" })
  })
})

describe("upsertPayoutLines", () => {
  it("MERGE-mode upsert on stripe_balance_txn_id, returns count", async () => {
    const n = await upsertPayoutLines([lineRow])
    expect(n).toBe(1)
    const call = state.upsertCalls.at(-1)!
    expect(call).toMatchObject({
      table: "bookkeeping_payout_lines",
      opts: { onConflict: "stripe_balance_txn_id" },
    })
    expect(call.rows[0]).toHaveProperty("updated_at")
  })
  it("empty input → 0 without a builder call", async () => {
    expect(await upsertPayoutLines([])).toBe(0)
    expect(state.upsertCalls).toHaveLength(0)
  })
  it("throws on a DB error instead of returning 0", async () => {
    state.error = { message: "boom" }
    await expect(upsertPayoutLines([lineRow])).rejects.toMatchObject({ message: "boom" })
  })
})

describe("latestPayoutArrivalDate", () => {
  it("returns the newest arrival_date", async () => {
    state.maybeSingleRow = { arrival_date: "2026-07-20" }
    expect(await latestPayoutArrivalDate(BOOK)).toBe("2026-07-20")
    expect(state.selectCalls.at(-1)!.eqMap.book_id).toBe(BOOK)
  })
  it("orders arrival_date DESC and takes 1 — an ASC watermark would pin the sync window to the oldest payout forever", async () => {
    state.maybeSingleRow = { arrival_date: "2026-07-20" }
    await latestPayoutArrivalDate(BOOK)
    const call = state.selectCalls.at(-1)!
    expect(call.orderArgs).toEqual([["arrival_date", { ascending: false }]])
    expect(call.limitArgs).toEqual([1])
  })
  it("null when no payouts exist", async () => {
    state.maybeSingleRow = null
    expect(await latestPayoutArrivalDate(BOOK)).toBeNull()
  })
  it("throws on a DB error rather than degrading to null (which would re-pull all history)", async () => {
    state.error = { message: "boom" }
    await expect(latestPayoutArrivalDate(BOOK)).rejects.toMatchObject({ message: "boom" })
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
  it("orders by arrival_date ASC then id ASC — arrival_date ties are routine, so a page boundary without the id tiebreaker can duplicate or skip a payout", async () => {
    await listPayoutsForDedupe(BOOK, "2026-07-01", "2026-07-31")
    expect(state.selectCalls.at(-1)!.orderArgs).toEqual([
      ["arrival_date", { ascending: true }],
      ["id", { ascending: true }],
    ])
  })
  it("paginates past the 1000-row cap", async () => {
    state.pages = [
      fill(1000, (i) => ({
        id: `a${i}`,
        stripe_payout_id: `po_a${i}`,
        net_cents: 1,
        arrival_date: "2026-07-07",
        status: "paid",
      })),
      fill(7, (i) => ({
        id: `b${i}`,
        stripe_payout_id: `po_b${i}`,
        net_cents: 1,
        arrival_date: "2026-07-08",
        status: "paid",
      })),
    ]
    const rows = await listPayoutsForDedupe(BOOK, "2026-07-01", "2026-07-31")
    expect(rows).toHaveLength(1007)
    expect(rows.at(-1)!.id).toBe("b6")
    expect(state.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
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
  it("orders by arrival_date ASC then id ASC (deterministic page boundaries)", async () => {
    await listNonTerminalPayouts(BOOK)
    expect(state.selectCalls.at(-1)!.orderArgs).toEqual([
      ["arrival_date", { ascending: true }],
      ["id", { ascending: true }],
    ])
  })
  it("paginates past the 1000-row cap", async () => {
    state.pages = [
      fill(1000, (i) => ({ id: `a${i}`, status: "pending" })),
      fill(3, (i) => ({ id: `b${i}`, status: "in_transit" })),
    ]
    const rows = await listNonTerminalPayouts(BOOK)
    expect(rows).toHaveLength(1003)
    expect(state.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })
})

describe("listPayoutLinesForWindow", () => {
  it("windows on txn_date inclusive and projects the fee columns the report layer sums", async () => {
    state.selectRows = [
      { txn_date: "2026-07-03", fee_cents: 400, net_cents: 9600, amount_cents: 10000, type: "charge" },
    ]
    const rows = await listPayoutLinesForWindow("2026-07-01", "2026-07-31")
    expect(rows).toHaveLength(1)
    const call = state.selectCalls.at(-1)!
    expect(call.gteMap.txn_date).toBe("2026-07-01")
    expect(call.lteMap.txn_date).toBe("2026-07-31")
    expect(call.cols).toContain("fee_cents")
    expect(call.cols).toContain("net_cents")
    expect(call.cols).toContain("amount_cents")
  })
  it("orders by txn_date ASC then id ASC", async () => {
    await listPayoutLinesForWindow("2026-07-01", "2026-07-31")
    expect(state.selectCalls.at(-1)!.orderArgs).toEqual([
      ["txn_date", { ascending: true }],
      ["id", { ascending: true }],
    ])
  })
  it("paginates past the 1000-row cap — a bare .select() would silently truncate a year of balance transactions", async () => {
    state.pages = [
      fill(1000, () => ({
        txn_date: "2026-07-03",
        fee_cents: 400,
        net_cents: 9600,
        amount_cents: 10000,
        type: "charge",
      })),
      fill(12, () => ({ txn_date: "2026-07-04", fee_cents: 30, net_cents: 970, amount_cents: 1000, type: "charge" })),
    ]
    const rows = await listPayoutLinesForWindow("2026-07-01", "2026-07-31")
    expect(rows).toHaveLength(1012)
    expect(rows.reduce((s, r) => s + r.fee_cents, 0)).toBe(1000 * 400 + 12 * 30)
    expect(state.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })
})
