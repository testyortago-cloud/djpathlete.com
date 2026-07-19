import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Chainable Supabase mock (house idiom — see __tests__/lib/db/google-ads-onoff-dal.test.ts) ──
// A fresh builder is created per `.from(table)` call. It only implements the
// exact chains lib/db/bookkeeping.ts's six writers + their two read helpers
// (getEntry, listClosedPeriods) issue — not a general-purpose Postgrest shim.
// The builder is itself thenable so `await db().from(t)...eq(...)` resolves
// without a trailing `.single()`/`.maybeSingle()` (used by listClosedPeriods,
// deleteEntry, and the upsert-then-select-"id" writers).

type Row = Record<string, unknown>

const state = {
  closedPeriods: {} as Record<string, string[]>, // book_id -> closed YYYY-MM periods
  entriesById: {} as Record<string, Row>, // fixture rows returned by getEntry()
  // F1: source_refs already posted, for insertImportedEntries' alt_ref
  // cross-run dedupe pre-check (a plain .select("source_ref")....in(...) query
  // — distinct from the by-id getEntry() lookup above).
  existingSourceRefs: [] as string[],
  insertCalled: false,
  insertPayloads: [] as Row[],
  updateCalled: false,
  updateCalls: [] as Array<{ id: string; payload: Row }>,
  deleteCalled: false,
  deleteCalls: [] as string[],
  upsertCalled: false,
  upsertCalls: [] as Array<{ table: string; rows: Row[]; opts: unknown }>,
}

function resetState() {
  state.closedPeriods = {}
  state.entriesById = {}
  state.existingSourceRefs = []
  state.insertCalled = false
  state.insertPayloads = []
  state.updateCalled = false
  state.updateCalls = []
  state.deleteCalled = false
  state.deleteCalls = []
  state.upsertCalled = false
  state.upsertCalls = []
}

function makeBuilder(table: string) {
  let op: "select" | "insert" | "update" | "delete" | "upsert" | null = null
  let payload: Row | Row[] | undefined
  const eqMap: Record<string, string> = {}
  let inVals: string[] | null = null

  const resolve = (): Promise<{ data: unknown; error: unknown }> => {
    if (table === "bookkeeping_period_closes") {
      const periods = state.closedPeriods[eqMap.book_id] ?? []
      return Promise.resolve({ data: periods.map((period) => ({ period })), error: null })
    }
    // table === "bookkeeping_ledger_entries"
    if (op === "select" && inVals != null) {
      // alt_ref pre-check: plain select("source_ref")...in("source_ref", [...]) —
      // returns every fixture ref that's both already-posted AND requested.
      const requested = new Set(inVals)
      const rows = state.existingSourceRefs.filter((r) => requested.has(r)).map((r) => ({ source_ref: r }))
      return Promise.resolve({ data: rows, error: null })
    }
    if (op === "select") {
      const row = state.entriesById[eqMap.id] ?? null
      return Promise.resolve({ data: row, error: null })
    }
    if (op === "insert") {
      const row = { id: `inserted-${state.insertPayloads.length}`, ...(payload as Row) }
      return Promise.resolve({ data: row, error: null })
    }
    if (op === "update") {
      const existing = state.entriesById[eqMap.id] ?? {}
      const row = { ...existing, ...(payload as Row) }
      return Promise.resolve({ data: row, error: null })
    }
    if (op === "delete") {
      return Promise.resolve({ data: null, error: null })
    }
    if (op === "upsert") {
      const rows = payload as Row[]
      return Promise.resolve({ data: rows.map((_, i) => ({ id: `upserted-${i}` })), error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }

  const builder = {
    select: (_cols?: string) => {
      if (op === null) op = "select"
      return builder
    },
    insert: (p: Row) => {
      op = "insert"
      payload = p
      state.insertCalled = true
      state.insertPayloads.push(p)
      return builder
    },
    update: (p: Row) => {
      op = "update"
      payload = p
      state.updateCalled = true
      return builder
    },
    delete: () => {
      op = "delete"
      state.deleteCalled = true
      return builder
    },
    upsert: (rows: Row[], opts: unknown) => {
      op = "upsert"
      payload = rows
      state.upsertCalled = true
      state.upsertCalls.push({ table, rows, opts })
      return builder
    },
    eq: (col: string, val: string) => {
      eqMap[col] = val
      if (table === "bookkeeping_ledger_entries" && col === "id" && op === "update") {
        state.updateCalls.push({ id: val, payload: payload as Row })
      }
      if (table === "bookkeeping_ledger_entries" && col === "id" && op === "delete") {
        state.deleteCalls.push(val)
      }
      return builder
    },
    in: (_col: string, vals: string[]) => {
      if (op === null) op = "select"
      inVals = vals
      return builder
    },
    maybeSingle: () => resolve(),
    single: () => resolve(),
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

import {
  createEntry,
  updateEntry,
  deleteEntry,
  insertImportedEntries,
  insertReceiptEntry,
  insertAmazonEntries,
  PeriodClosedError,
} from "@/lib/db/bookkeeping"

// ── Fixtures (RFC-4122-shaped UUIDs, house style) ───────────────────────────
const BOOK_ID = "11111111-2222-4333-8444-555555555555"
const CLOSED_PERIOD = "2026-03"
const ENTRY_CLOSED_ID = "22222222-3333-4444-8555-666666666666"
const ENTRY_OPEN_ID = "33333333-4444-4555-8666-777777777777"
const IMPORT_BATCH_ID = "44444444-5555-4666-8777-888888888888"

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    book_id: BOOK_ID,
    account_id: null,
    direction: "expense",
    amount_cents: 1000,
    currency: "usd",
    occurred_on: "2026-04-05",
    memo: "orig-memo",
    business_purpose: null,
    counterparty: null,
    source: "manual",
    source_ref: null,
    import_batch_id: null,
    created_at: "2026-04-05T00:00:00Z",
    updated_at: "2026-04-05T00:00:00Z",
    document_id: null,
    ...overrides,
  }
}

function makeCreateInput(overrides: Partial<Row> = {}): Row {
  return {
    book_id: BOOK_ID,
    account_id: null,
    direction: "expense",
    amount_cents: 500,
    currency: "usd",
    occurred_on: "2026-04-10",
    memo: null,
    business_purpose: null,
    counterparty: null,
    source: "manual",
    source_ref: null,
    import_batch_id: null,
    document_id: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetState()
})

// ── 1. createEntry ───────────────────────────────────────────────────────────
describe("createEntry", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = [CLOSED_PERIOD]
  })

  it("rejects a closed-period entry with PeriodClosedError and never touches the insert builder", async () => {
    const input = makeCreateInput({ occurred_on: "2026-03-10" })
    await expect(createEntry(input as never)).rejects.toBeInstanceOf(PeriodClosedError)
    await expect(createEntry(input as never)).rejects.toMatchObject({ code: "PERIOD_CLOSED" })
    expect(state.insertCalled).toBe(false)
  })

  it("inserts when the period is open", async () => {
    const input = makeCreateInput({ occurred_on: "2026-04-10" })
    const row = await createEntry(input as never)
    expect(state.insertCalled).toBe(true)
    expect(row).toMatchObject({ occurred_on: "2026-04-10" })
  })
})

// ── 2. updateEntry ───────────────────────────────────────────────────────────
describe("updateEntry", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = [CLOSED_PERIOD]
    state.entriesById[ENTRY_CLOSED_ID] = makeRow({ id: ENTRY_CLOSED_ID, occurred_on: "2026-03-05" })
    state.entriesById[ENTRY_OPEN_ID] = makeRow({ id: ENTRY_OPEN_ID, occurred_on: "2026-04-05" })
  })

  it("rejects when the EXISTING row is in a closed period, even for a memo-only payload (unconditional old-row fetch)", async () => {
    await expect(updateEntry(ENTRY_CLOSED_ID, { memo: "x" } as never)).rejects.toMatchObject({
      code: "PERIOD_CLOSED",
    })
    expect(state.updateCalled).toBe(false)
  })

  it("rejects when the update MOVES an open-period row into a closed period", async () => {
    await expect(
      updateEntry(ENTRY_OPEN_ID, { occurred_on: "2026-03-15" } as never),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" })
    expect(state.updateCalled).toBe(false)
  })

  it("succeeds for an open-to-open move", async () => {
    const row = await updateEntry(ENTRY_OPEN_ID, { occurred_on: "2026-05-20" } as never)
    expect(state.updateCalled).toBe(true)
    expect(state.updateCalls).toContainEqual({ id: ENTRY_OPEN_ID, payload: { occurred_on: "2026-05-20" } })
    expect(row).toMatchObject({ occurred_on: "2026-05-20" })
  })
})

// ── 3. deleteEntry ───────────────────────────────────────────────────────────
describe("deleteEntry", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = [CLOSED_PERIOD]
    state.entriesById[ENTRY_CLOSED_ID] = makeRow({ id: ENTRY_CLOSED_ID, occurred_on: "2026-03-05" })
    state.entriesById[ENTRY_OPEN_ID] = makeRow({ id: ENTRY_OPEN_ID, occurred_on: "2026-04-05" })
  })

  it("rejects a closed-period row and never touches the delete builder", async () => {
    await expect(deleteEntry(ENTRY_CLOSED_ID)).rejects.toMatchObject({ code: "PERIOD_CLOSED" })
    expect(state.deleteCalled).toBe(false)
  })

  it("deletes an open-period row", async () => {
    await expect(deleteEntry(ENTRY_OPEN_ID)).resolves.toBeUndefined()
    expect(state.deleteCalled).toBe(true)
    expect(state.deleteCalls).toContain(ENTRY_OPEN_ID)
  })
})

// ── 4. insertImportedEntries ─────────────────────────────────────────────────
describe("insertImportedEntries", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = [CLOSED_PERIOD]
  })

  it("upserts ONLY the open drafts — partition must run BEFORE the upsert", async () => {
    const drafts = [
      { direction: "expense" as const, amount_cents: 100, occurred_on: "2026-04-01", memo: "open-1", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "ref-open-1", account_id: null },
      { direction: "expense" as const, amount_cents: 200, occurred_on: "2026-03-02", memo: "closed-1", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "ref-closed-1", account_id: null },
      { direction: "income" as const, amount_cents: 300, occurred_on: "2026-04-03", memo: "open-2", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "ref-open-2", account_id: null },
      { direction: "expense" as const, amount_cents: 400, occurred_on: "2026-03-04", memo: "closed-2", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "ref-closed-2", account_id: null },
    ]

    const result = await insertImportedEntries(BOOK_ID, IMPORT_BATCH_ID, drafts)

    expect(result.inserted).toBe(2)
    expect(result.rejected_closed).toBe(2)
    expect(result.rejected_closed_rows.map((r) => r.occurred_on)).toEqual(["2026-03-02", "2026-03-04"])

    // The load-bearing assertion: inspect what actually reached the upsert
    // builder, not just the returned counts — this fails if the partition
    // ran AFTER the upsert (all 4 drafts would ride the wire instead of 2).
    expect(state.upsertCalled).toBe(true)
    const call = state.upsertCalls.at(-1)!
    expect(call.rows).toHaveLength(2)
    expect(call.rows.map((r) => r.source_ref)).toEqual(["ref-open-1", "ref-open-2"])
    expect(call.rows.every((r) => r.occurred_on !== "2026-03-02" && r.occurred_on !== "2026-03-04")).toBe(true)
  })

  // F1: cross-run dedupe. A draft's alt_ref names the OTHER source_ref form
  // this exact sale could have posted under — if that alt form is already
  // posted, drop the draft (the plain source_ref uniqueness constraint
  // wouldn't catch it, since the two refs differ).
  it("drops a draft whose alt_ref already exists in the ledger; others insert; skipped_alt_ref reflects the drop", async () => {
    state.existingSourceRefs = ["payments:already-posted-1"]
    const drafts = [
      { direction: "income" as const, amount_cents: 500, occurred_on: "2026-04-01", memo: "dup-via-alt", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "client_packages:cp-1", alt_ref: "payments:already-posted-1", account_id: null },
      { direction: "income" as const, amount_cents: 600, occurred_on: "2026-04-02", memo: "keep", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "client_packages:cp-2", alt_ref: "payments:not-posted", account_id: null },
    ]

    const result = await insertImportedEntries(BOOK_ID, IMPORT_BATCH_ID, drafts)

    expect(result.skipped_alt_ref).toBe(1)
    expect(result.inserted).toBe(1)
    expect(state.upsertCalled).toBe(true)
    const call = state.upsertCalls.at(-1)!
    expect(call.rows.map((r) => r.source_ref)).toEqual(["client_packages:cp-2"])
  })

  it("skips the alt_ref pre-check entirely when no draft carries an alt_ref (no-op, unchanged behavior)", async () => {
    const drafts = [
      { direction: "income" as const, amount_cents: 700, occurred_on: "2026-04-05", memo: "no-alt", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "shop_orders:so-1", account_id: null },
    ]
    const result = await insertImportedEntries(BOOK_ID, IMPORT_BATCH_ID, drafts)
    expect(result.skipped_alt_ref).toBe(0)
    expect(result.inserted).toBe(1)
  })
})

// ── 5. insertAmazonEntries ────────────────────────────────────────────────────
describe("insertAmazonEntries", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = [CLOSED_PERIOD]
  })

  it("upserts ONLY the open drafts — partition must run BEFORE the upsert", async () => {
    const drafts = [
      { direction: "expense" as const, amount_cents: 150, occurred_on: "2026-04-11", memo: "amz-open-1", counterparty: "Amazon", source_ref: "amz-open-1", account_id: null },
      { direction: "expense" as const, amount_cents: 250, occurred_on: "2026-03-12", memo: "amz-closed-1", counterparty: "Amazon", source_ref: "amz-closed-1", account_id: null },
      { direction: "expense" as const, amount_cents: 350, occurred_on: "2026-04-13", memo: "amz-open-2", counterparty: "Amazon", source_ref: "amz-open-2", account_id: null },
      { direction: "expense" as const, amount_cents: 450, occurred_on: "2026-03-14", memo: "amz-closed-2", counterparty: "Amazon", source_ref: "amz-closed-2", account_id: null },
    ]

    const result = await insertAmazonEntries(BOOK_ID, IMPORT_BATCH_ID, drafts)

    expect(result.inserted).toBe(2)
    expect(result.rejected_closed).toBe(2)
    expect(result.rejected_closed_rows.map((r) => r.occurred_on)).toEqual(["2026-03-12", "2026-03-14"])

    expect(state.upsertCalled).toBe(true)
    const call = state.upsertCalls.at(-1)!
    expect(call.rows).toHaveLength(2)
    expect(call.rows.map((r) => r.source_ref)).toEqual(["amz-open-1", "amz-open-2"])
  })
})

// ── 6. insertReceiptEntry ─────────────────────────────────────────────────────
describe("insertReceiptEntry", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = [CLOSED_PERIOD]
  })

  function receiptInput(overrides: Partial<Row> = {}) {
    return {
      book_id: BOOK_ID,
      account_id: null,
      amount_cents: 1200,
      occurred_on: "2026-04-15",
      counterparty: "Gas Station",
      business_purpose: null,
      memo: null,
      source_ref: "receipt-ref-1",
      document_id: null,
      import_batch_id: null,
      ...overrides,
    }
  }

  it("rejects a closed-period receipt and never touches the upsert builder", async () => {
    await expect(insertReceiptEntry(receiptInput({ occurred_on: "2026-03-15" }) as never)).rejects.toMatchObject({
      code: "PERIOD_CLOSED",
    })
    expect(state.upsertCalled).toBe(false)
  })

  it("inserts an open-period receipt", async () => {
    const result = await insertReceiptEntry(receiptInput() as never)
    expect(state.upsertCalled).toBe(true)
    expect(result.inserted).toBe(1)
  })
})

// ── 7. No-closes fast path: zero close rows → every writer behaves as before ──
describe("no-closes fast path (empty bookkeeping_period_closes)", () => {
  beforeEach(() => {
    state.closedPeriods[BOOK_ID] = []
    state.entriesById[ENTRY_OPEN_ID] = makeRow({ id: ENTRY_OPEN_ID, occurred_on: "2026-03-05" })
  })

  it("createEntry inserts a row dated in what would otherwise be a closed month", async () => {
    const row = await createEntry(makeCreateInput({ occurred_on: "2026-03-10" }) as never)
    expect(state.insertCalled).toBe(true)
    expect(row).toMatchObject({ occurred_on: "2026-03-10" })
  })

  it("updateEntry updates a row whose existing occurred_on is in that same month", async () => {
    const row = await updateEntry(ENTRY_OPEN_ID, { memo: "updated" } as never)
    expect(state.updateCalled).toBe(true)
    expect(row).toMatchObject({ memo: "updated" })
  })

  it("deleteEntry deletes that row", async () => {
    await expect(deleteEntry(ENTRY_OPEN_ID)).resolves.toBeUndefined()
    expect(state.deleteCalled).toBe(true)
  })

  it("insertImportedEntries upserts every draft (none rejected)", async () => {
    const drafts = [
      { direction: "expense" as const, amount_cents: 100, occurred_on: "2026-03-01", memo: "a", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "fast-1", account_id: null },
      { direction: "income" as const, amount_cents: 200, occurred_on: "2026-03-02", memo: "b", counterparty: null, service_line: null, source: "platform_import" as const, source_ref: "fast-2", account_id: null },
    ]
    const result = await insertImportedEntries(BOOK_ID, IMPORT_BATCH_ID, drafts)
    expect(result).toMatchObject({ inserted: 2, rejected_closed: 0, rejected_closed_rows: [] })
    expect(state.upsertCalls.at(-1)!.rows).toHaveLength(2)
  })

  it("insertAmazonEntries upserts every draft (none rejected)", async () => {
    const drafts = [
      { direction: "expense" as const, amount_cents: 100, occurred_on: "2026-03-01", memo: "a", counterparty: "Amazon", source_ref: "fast-amz-1", account_id: null },
    ]
    const result = await insertAmazonEntries(BOOK_ID, IMPORT_BATCH_ID, drafts)
    expect(result).toMatchObject({ inserted: 1, rejected_closed: 0, rejected_closed_rows: [] })
    expect(state.upsertCalls.at(-1)!.rows).toHaveLength(1)
  })

  it("insertReceiptEntry inserts", async () => {
    const result = await insertReceiptEntry({
      book_id: BOOK_ID, account_id: null, amount_cents: 500, occurred_on: "2026-03-01",
      counterparty: "Shop", business_purpose: null, memo: null, source_ref: "fast-receipt-1",
      document_id: null, import_batch_id: null,
    } as never)
    expect(state.upsertCalled).toBe(true)
    expect(result.inserted).toBe(1)
  })
})
