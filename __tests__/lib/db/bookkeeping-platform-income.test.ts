import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Chainable Supabase mock (house idiom — see __tests__/lib/db/bookkeeping-period-guard.test.ts) ──
// A fresh builder is created per `.from(table)` call. listPlatformIncome issues
// two query shapes against it:
//  1. Paginated source-table reads (payments/shop_orders/client_packages/
//     event_signups/client_memberships): `.select().gte().lte()[.or()].range(f,t)`,
//     resolved via fetchAllRows — one short page is enough to end pagination.
//  2. Chunked id lookups (users/programs): `.select().in("id", chunk)`, resolved
//     directly (no `.range()`).
// The builder is itself thenable so `await db().from(t)...` resolves without a
// trailing `.single()`/`.maybeSingle()`.

type Row = Record<string, unknown>

const state = {
  sourceRows: {} as Record<string, Row[]>,
  usersRows: [] as Row[],
  usersMode: "ok" as "ok" | "error",
  usersInCalls: [] as string[][],
  programsRows: [] as Row[],
  programsInCalls: [] as string[][],
}

function resetState() {
  state.sourceRows = {
    payments: [], shop_orders: [], client_packages: [], event_signups: [], client_memberships: [],
  }
  state.usersRows = []
  state.usersMode = "ok"
  state.usersInCalls = []
  state.programsRows = []
  state.programsInCalls = []
}
resetState()

function makeBuilder(table: string) {
  let inVals: string[] | null = null

  const resolve = (): Promise<{ data: unknown; error: unknown }> => {
    if (table === "users") {
      state.usersInCalls.push(inVals ?? [])
      if (state.usersMode === "error") return Promise.resolve({ data: null, error: { message: "users lookup boom" } })
      const ids = new Set(inVals ?? [])
      return Promise.resolve({ data: state.usersRows.filter((r) => ids.has(r.id as string)), error: null })
    }
    if (table === "programs") {
      state.programsInCalls.push(inVals ?? [])
      const ids = new Set(inVals ?? [])
      return Promise.resolve({ data: state.programsRows.filter((r) => ids.has(r.id as string)), error: null })
    }
    // Paginated source-table reads: one page is always enough here — every
    // fixture is well under the 1000-row page size, so fetchAllRows stops
    // after the first call.
    return Promise.resolve({ data: state.sourceRows[table] ?? [], error: null })
  }

  const builder = {
    select: (_cols?: string) => builder,
    gte: (_c: string, _v: string) => builder,
    lte: (_c: string, _v: string) => builder,
    or: (_s: string) => builder,
    range: (_f: number, _t: number) => builder,
    in: (_col: string, vals: string[]) => {
      inVals = vals
      return builder
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable protocol, signature must match PromiseLike
    then: (onFulfilled?: any, onRejected?: any) => resolve().then(onFulfilled, onRejected),
  }
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}))

import { listPlatformIncome } from "@/lib/db/bookkeeping"

const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"
const PR = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  vi.clearAllMocks()
  resetState()
})

describe("listPlatformIncome — enrichment wiring", () => {
  it("stamps payer_name/payer_email/program_name/client_name from the users+programs reads", async () => {
    // Wiring test: this fails if listPlatformIncome stopped calling
    // stampIncomeEnrichment (or collectEnrichmentIds) after the raw reads.
    state.sourceRows.payments = [{
      id: "p1", user_id: U1, metadata: { programId: PR }, amount_cents: 9900,
      status: "succeeded", created_at: "2026-03-02T10:00:00Z", description: "x",
    }]
    state.sourceRows.client_packages = [{
      id: "cp1", client_user_id: U2, payment_status: "paid", price_cents: 50000,
      purchased_at: "2026-03-03T00:00:00Z",
    }]
    state.usersRows = [
      { id: U1, first_name: "Cannon", last_name: "Kremer", email: "ck@x.com" },
      { id: U2, first_name: "Sandeep", last_name: "Chennadi", email: "sc@x.com" },
    ]
    state.programsRows = [{ id: PR, name: "Cannon Baller!" }]

    const result = await listPlatformIncome("2026-01-01", "2026-12-31")

    expect(result.payments[0]).toMatchObject({
      payer_name: "Cannon Kremer", payer_email: "ck@x.com", program_name: "Cannon Baller!",
    })
    expect(result.clientPackages[0]).toMatchObject({ client_name: "Sandeep Chennadi" })
  })
})

describe("listPlatformIncome — user id chunking", () => {
  it("chunks 250 distinct user ids into exactly two .in() calls", async () => {
    state.sourceRows.client_packages = Array.from({ length: 250 }, (_, i) => ({
      id: `cp-${i}`, client_user_id: `u-${i}`, payment_status: "paid", price_cents: 1000,
      purchased_at: "2026-03-01T00:00:00Z",
    }))

    await listPlatformIncome("2026-01-01", "2026-12-31")

    expect(state.usersInCalls).toHaveLength(2)
    expect(state.usersInCalls[0]).toHaveLength(200)
    expect(state.usersInCalls[1]).toHaveLength(50)
    const allIds = new Set([...state.usersInCalls[0], ...state.usersInCalls[1]])
    expect(allIds.size).toBe(250)
  })
})

describe("listPlatformIncome — graceful degrade", () => {
  it("still returns rows (with null enrichment fields) when the users lookup rejects", async () => {
    state.sourceRows.payments = [{
      id: "p1", user_id: U1, metadata: {}, amount_cents: 9900,
      status: "succeeded", created_at: "2026-03-02T10:00:00Z", description: "x",
    }]
    state.usersMode = "error"

    const result = await listPlatformIncome("2026-01-01", "2026-12-31")

    expect(result.payments).toHaveLength(1)
    expect(result.payments[0]).toMatchObject({ payer_name: null, payer_email: null })
  })
})
