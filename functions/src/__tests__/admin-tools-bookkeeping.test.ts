import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { ADMIN_TOOLS, TOOL_LABELS, executeAdminTool } from "../ai/admin-tools.js"
import { getSupabase } from "../lib/supabase.js"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000002"
const ACC_PT = "a0000000-0000-4000-8000-000000000001"

const BOOKS = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
]
const ACCOUNTS = [{ id: ACC_PT, name: "Performance Training", service_line: "performance_training" }]

type ChainResult = { data?: unknown; error?: unknown; count?: number | null }

/** Thenable self-chaining supabase query stub (house idiom: social-outcome-tracker.test.ts).
 *  `resolve` sees the LAST .range(from, to) so the paginate loop gets real pages. */
function chain(resolve: (from: number, to: number) => ChainResult) {
  let f = 0
  let t = 999
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  for (const m of ["select", "is", "eq", "gte", "lte", "or", "order", "limit"]) c[m] = vi.fn(() => c)
  c.range = vi.fn((from: number, to: number) => {
    f = from
    t = to
    return c
  })
  c.then = (onFulfilled: (v: ChainResult) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...resolve(f, t) }).then(onFulfilled)
  return c
}

function entryRow(over: Record<string, unknown> = {}) {
  return {
    book_id: BOOK_BIZ,
    account_id: ACC_PT,
    direction: "expense",
    amount_cents: 1000,
    occurred_on: "2026-03-01",
    counterparty: "Rogue Fitness",
    memo: null,
    source: "manual",
    ...over,
  }
}

function mockSupabase(tables: Record<string, ReturnType<typeof chain>>) {
  ;(getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      const c = tables[table]
      if (!c) throw new Error(`unexpected table ${table}`)
      return c
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-07-18T12:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("bookkeeping tool declarations", () => {
  it("declares all 4 tools in ADMIN_TOOLS with TOOL_LABELS entries", () => {
    const names = ADMIN_TOOLS.map((tool) => tool.name)
    for (const n of [
      "bookkeeping_summary",
      "bookkeeping_income_by_service",
      "bookkeeping_top_vendors",
      "bookkeeping_find_entries",
    ]) {
      expect(names).toContain(n)
      expect(TOOL_LABELS[n]).toBeTruthy()
    }
  })
})

describe("bookkeeping_summary", () => {
  it("unknown book name → available names, never a guess", async () => {
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })) })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", { book: "Bizness" }))
    expect(out.error).toContain('Unknown book "Bizness"')
    expect(out.available_books).toEqual(["Darren — DJP Athlete", "Household & Personal"])
    expect(out.books).toBeUndefined()
  })

  it("defaults to calendar YTD, self-cites window + per-book names, exact cents math", async () => {
    const entries = [
      entryRow({ direction: "income", amount_cents: 50000 }),
      entryRow({ direction: "expense", amount_cents: 12500 }),
      entryRow({ book_id: BOOK_HH, direction: "expense", amount_cents: 200000 }),
    ]
    const entriesChain = chain(() => ({ data: entries }))
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })), bookkeeping_ledger_entries: entriesChain })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", {}))
    expect(out.from).toBe("2026-01-01")
    expect(out.to).toBe("2026-07-18")
    expect(entriesChain.gte).toHaveBeenCalledWith("occurred_on", "2026-01-01")
    expect(entriesChain.lte).toHaveBeenCalledWith("occurred_on", "2026-07-18")
    // mutation discriminator: sign-flip nets −37500 / 62500; cross-book leak changes either row
    expect(out.books).toEqual([
      { book_name: "Darren — DJP Athlete", book_kind: "business", income_cents: 50000, expense_cents: 12500, net_cents: 37500, entry_count: 2 },
      { book_name: "Household & Personal", book_kind: "household", income_cents: 0, expense_cents: 200000, net_cents: -200000, entry_count: 1 },
    ])
    expect(out.partial).toBe(false)
    expect(out.note).toContain("integer cents")
  })

  it("book filter resolves case-insensitively and scopes the query to that book", async () => {
    const entriesChain = chain(() => ({ data: [entryRow({ direction: "income", amount_cents: 700 })] }))
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })), bookkeeping_ledger_entries: entriesChain })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", { book: "darren — djp athlete" }))
    expect(entriesChain.eq).toHaveBeenCalledWith("book_id", BOOK_BIZ)
    expect(out.books).toHaveLength(1)
    expect(out.books[0]).toMatchObject({ book_name: "Darren — DJP Athlete", income_cents: 700 })
  })

  it("hard stop at 20000 rows → partial:true + explicit note + capped totals", async () => {
    // Endless full pages: the hard stop must terminate the loop AND cap the math.
    const entriesChain = chain((from, to) => ({
      data: Array.from({ length: to - from + 1 }, () => entryRow({ amount_cents: 1 })),
    }))
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })), bookkeeping_ledger_entries: entriesChain })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", {}))
    expect(out.partial).toBe(true)
    expect(out.partial_note).toContain("first 20,000")
    const biz = out.books.find((b: { book_name: string }) => b.book_name === "Darren — DJP Athlete")
    expect(biz.entry_count).toBe(20000)
    expect(biz.expense_cents).toBe(20000)
  })

  it("rejects a malformed window instead of querying", async () => {
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })) })
    const out = JSON.parse(await executeAdminTool("bookkeeping_summary", { from: "2026-07-19", to: "2026-01-01" }))
    expect(out.error).toContain("on or before")
  })
})

describe("bookkeeping_income_by_service", () => {
  it("defaults to the primary business book; income-only rollup with Uncategorized bucket", async () => {
    const entries = [
      entryRow({ direction: "income", amount_cents: 50000 }),
      entryRow({ direction: "income", amount_cents: 700, account_id: null }),
      entryRow({ direction: "expense", amount_cents: 99999 }), // excluded from income rollup
    ]
    const entriesChain = chain(() => ({ data: entries }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_income_by_service", {}))
    expect(out.book_name).toBe("Darren — DJP Athlete")
    expect(entriesChain.eq).toHaveBeenCalledWith("book_id", BOOK_BIZ)
    expect(out.rows).toEqual([
      { service_line: "performance_training", label: "Performance Training", total_cents: 50000, entry_count: 1 },
      { service_line: null, label: "Uncategorized", total_cents: 700, entry_count: 1 },
    ])
    expect(out.income_total_cents).toBe(50700)
    expect(out.from).toBe("2026-01-01")
    expect(out.to).toBe("2026-07-18")
  })
})

describe("bookkeeping_top_vendors", () => {
  it("caps limit at 20, defaults direction to expense, merges normalized names, cites all books", async () => {
    const manyVendors = Array.from({ length: 25 }, (_, i) =>
      entryRow({ counterparty: `Vendor ${String(i).padStart(2, "0")}`, amount_cents: 10000 - i * 100 }),
    )
    const entries = [
      ...manyVendors,
      entryRow({ counterparty: " Rogue  Fitness ", amount_cents: 90000 }),
      entryRow({ counterparty: "rogue fitness", amount_cents: 10000 }),
      entryRow({ direction: "income", counterparty: "Stripe", amount_cents: 500000 }), // wrong direction
    ]
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: chain(() => ({ data: entries })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_top_vendors", { limit: 999 }))
    expect(out.direction).toBe("expense")
    expect(out.vendors).toHaveLength(20) // mutation discriminator: unclamped limit → 27
    expect(out.vendors[0]).toEqual({ counterparty: "rogue fitness", total_cents: 100000, entry_count: 2 })
    expect(out.vendors.some((v: { counterparty: string | null }) => v.counterparty === "stripe")).toBe(false)
    expect(out.book_names).toEqual(["Darren — DJP Athlete", "Household & Personal"])
  })

  it("junk direction → error JSON, no query", async () => {
    mockSupabase({ bookkeeping_books: chain(() => ({ data: BOOKS })) })
    const out = JSON.parse(await executeAdminTool("bookkeeping_top_vendors", { direction: "both" }))
    expect(out.error).toContain("direction")
  })

  it("defaults limit to 10 when omitted (mutation discriminator: fallback 10 -> 50 against >=11 distinct vendors)", async () => {
    const manyVendors = Array.from({ length: 15 }, (_, i) =>
      entryRow({ counterparty: `Vendor ${String(i).padStart(2, "0")}`, amount_cents: 10000 - i * 100 }),
    )
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: chain(() => ({ data: manyVendors })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_top_vendors", {}))
    expect(out.vendors).toHaveLength(10)
  })
})

describe("bookkeeping_find_entries", () => {
  it("total_count via count:'exact', showing-X-of-Y note, limit clamped to 50, ilike on memo+counterparty", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => entryRow({ amount_cents: 100 + i }))
    const entriesChain = chain(() => ({ data: rows, count: 137 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_find_entries", { query: "rogue", limit: 999 }))
    expect(entriesChain.select).toHaveBeenCalledWith(expect.any(String), { count: "exact" })
    expect(entriesChain.range).toHaveBeenCalledWith(0, 49) // mutation discriminator: unclamped → (0, 998)
    expect(entriesChain.or).toHaveBeenCalledWith("memo.ilike.%rogue%,counterparty.ilike.%rogue%")
    expect(out.total_count).toBe(137)
    expect(out.showing).toBe("showing 20 of 137 matching entries")
    expect(out.rows).toHaveLength(20)
    expect(out.rows[0]).toMatchObject({
      account: "Performance Training",
      amount_cents: 100,
      book_name: "Darren — DJP Athlete",
      direction: "expense",
      occurred_on: "2026-03-01",
    })
    expect(out.note).toContain("integer cents")
  })

  it("offset pages via range(offset, offset+limit-1)", async () => {
    const entriesChain = chain(() => ({ data: [], count: 0 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    await executeAdminTool("bookkeeping_find_entries", { offset: 30, limit: 10 })
    expect(entriesChain.range).toHaveBeenCalledWith(30, 39)
  })

  it("empty window → 0 of 0, empty rows, no invented data, default limit/offset applied", async () => {
    const entriesChain = chain(() => ({ data: [], count: 0 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    const out = JSON.parse(await executeAdminTool("bookkeeping_find_entries", {}))
    expect(out.total_count).toBe(0)
    expect(out.rows).toEqual([])
    expect(out.showing).toBe("showing 0 of 0 matching entries")
    // mutation discriminator: default limit fallback 20 -> 50 (spec-pinned cap) or
    // default offset fallback 0 -> nonzero would both pass every other test here.
    expect(entriesChain.range).toHaveBeenCalledWith(0, 19)
  })

  it("escapes ilike metacharacters with the house idiom (%/_ escaped; ,(). flattened)", async () => {
    const entriesChain = chain(() => ({ data: [], count: 0 }))
    mockSupabase({
      bookkeeping_books: chain(() => ({ data: BOOKS })),
      bookkeeping_ledger_entries: entriesChain,
      bookkeeping_accounts: chain(() => ({ data: ACCOUNTS })),
    })
    await executeAdminTool("bookkeeping_find_entries", { query: "50%_off,(really)" })
    expect(entriesChain.or).toHaveBeenCalledWith(
      "memo.ilike.%50\\%\\_off  really %,counterparty.ilike.%50\\%\\_off  really %",
    )
  })
})
