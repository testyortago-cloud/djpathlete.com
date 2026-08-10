// __tests__/lib/db/funnel-leads.test.ts
//
// The two things about this DAL that are worth a test without a database: what
// a search term turns into on the wire, and whether the list and the count
// narrow the table the SAME way.

import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { table: string; select: string; ops: [string, ...unknown[]][] }[] = []

/**
 * A chainable stand-in for the PostgREST builder that RECORDS what was asked of
 * it. It is a fake rather than a mock of the DAL itself on purpose: mocking
 * `listLeads` to assert `listLeads` was called proves nothing, and the claim
 * here is about the filters that reach the query.
 */
function makeBuilder(table: string, select: string, result: unknown) {
  const record = { table, select, ops: [] as [string, ...unknown[]][] }
  calls.push(record)

  const builder: Record<string, unknown> = {
    then: undefined,
  }
  for (const method of ["eq", "gte", "or", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  // Awaiting the builder resolves it, exactly as PostgREST's does.
  builder.then = (resolve: (value: unknown) => void) => resolve(result)
  return builder
}

let listResult: unknown = { data: [], error: null }
let countResult: unknown = { count: 0, error: null }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (select: string, options?: { head?: boolean }) =>
        makeBuilder(table, select, options?.head ? countResult : listResult),
    }),
  }),
}))

import { countLeads, listLeads, searchClause } from "@/lib/db/funnel-leads"

beforeEach(() => {
  calls.length = 0
  listResult = { data: [], error: null }
  countResult = { count: 0, error: null }
})

describe("searchClause", () => {
  it("searches all three contact columns", () => {
    // MUTANT: searching only `name`. A coach pasting an email address to find
    // someone gets "no leads match" for a lead that is right there.
    expect(searchClause("sam")).toBe("name.ilike.%sam%,email.ilike.%sam%,phone.ilike.%sam%")
  })

  it("strips the characters that are GRAMMAR in a PostgREST filter", () => {
    // MUTANT: interpolating the term raw. Commas separate conditions and
    // parentheses group them, so searching for "Smith, John" would be parsed as
    // two extra filter clauses — a wrong result at best and a 400 at worst,
    // which reads to the user as "search is broken".
    const clause = searchClause("Smith, John (coach)")
    expect(clause).toBe("name.ilike.%Smith John coach%,email.ilike.%Smith John coach%,phone.ilike.%Smith John coach%")
    expect(clause).not.toContain("(")
    expect(clause?.split(",")).toHaveLength(3)
  })

  it("is null for nothing, so no clause is added at all", () => {
    // MUTANT: returning `%%`, which matches every row with a non-null name and
    // silently DROPS every lead who left the name blank.
    expect(searchClause(undefined)).toBeNull()
    expect(searchClause("   ")).toBeNull()
    expect(searchClause("()")).toBeNull()
  })
})

describe("listLeads and countLeads narrow identically", () => {
  const filters = {
    funnelId: "f1",
    status: "new" as const,
    since: "2026-08-01T00:00:00.000Z",
    search: "sam",
  }

  it("applies the same filter operations to both", async () => {
    // MUTANT: filtering the list and counting the whole table. The footer would
    // read "412 leads" above a list of 3 — and the operator would reasonably
    // conclude the page is broken, or worse, that 409 leads are missing.
    await listLeads(filters)
    await countLeads(filters)

    const [list, count] = calls
    const filterOps = (record: (typeof calls)[number]) =>
      record.ops.filter(([method]) => ["eq", "gte", "or"].includes(method))

    expect(filterOps(list)).toEqual(filterOps(count))
    expect(filterOps(list)).toEqual([
      ["eq", "funnel_id", "f1"],
      ["eq", "status", "new"],
      ["gte", "created_at", "2026-08-01T00:00:00.000Z"],
      ["or", "name.ilike.%sam%,email.ilike.%sam%,phone.ilike.%sam%"],
    ])
  })

  it("adds no filter clauses at all when nothing is filtered", () => {
    // MUTANT: `eq("status", undefined)`. PostgREST would match nothing and the
    // unfiltered inbox would render empty.
    return listLeads().then(() => {
      expect(calls[0].ops.filter(([method]) => ["eq", "gte", "or"].includes(method))).toEqual([])
    })
  })

  it("counts with head:true rather than pulling the rows back to length them", async () => {
    // MUTANT: `(await listLeads(filters)).length`. It is capped at ~1000 by
    // PostgREST, so the count would silently plateau exactly when the number
    // starts to matter.
    await countLeads({})
    expect(calls[0].select).toBe("id")
  })

  it("orders newest first and never asks for more than the page cap", async () => {
    await listLeads({ limit: 5000 })
    const ops = Object.fromEntries(calls[0].ops.map(([method, ...args]) => [method, args]))
    expect(ops.order).toEqual(["created_at", { ascending: false }])
    // 1000 rows starting at 0 -> range(0, 999). A limit above the cap is
    // clamped rather than passed through to be silently truncated.
    expect(ops.range).toEqual([0, 999])
  })
})
