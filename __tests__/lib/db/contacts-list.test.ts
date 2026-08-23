// __tests__/lib/db/contacts-list.test.ts
//
// Three claims about the contacts read layer that are worth a test without a
// database:
//
//   1. `parseContactFilters` REJECTS junk before it reaches the query. Every
//      value on this page arrives from the URL bar, so "days=; drop table" and
//      "has=everything" are the normal case, not the exotic one.
//   2. `listContacts` and `countContacts` narrow the table IDENTICALLY — the
//      "12 contacts above a list of 3" bug lib/db/funnel-leads.ts's own comment
//      warns about.
//   3. The search clause names the REAL columns. `phone_e164`, not `phone`:
//      migration 00213 has no `phone` column at all, so getting this wrong is a
//      400 from PostgREST that reads to a coach as "search is broken".

import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { table: string; select: string; ops: [string, ...unknown[]][] }[] = []

/**
 * A chainable stand-in for the PostgREST builder that RECORDS what was asked of
 * it — the same fake `__tests__/lib/db/funnel-leads.test.ts` uses, and a fake
 * rather than a mock of the DAL for the same reason: mocking `listContacts` to
 * assert `listContacts` was called proves nothing, and the claim here is about
 * the filters that reach the query.
 */
function makeBuilder(table: string, select: string, result: unknown) {
  const record = { table, select, ops: [] as [string, ...unknown[]][] }
  calls.push(record)

  const builder: Record<string, unknown> = { then: undefined }
  for (const method of ["eq", "gte", "or", "not", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
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

import { contactSearchClause, countContacts, listContacts, parseContactFilters } from "@/lib/db/contacts-list"

const BUSINESS = "00000000-0000-0000-0000-000000000001"

beforeEach(() => {
  calls.length = 0
  listResult = { data: [], error: null }
  countResult = { count: 0, error: null }
})

const filterOps = (record: (typeof calls)[number]) =>
  record.ops.filter(([method]) => ["eq", "gte", "or", "not"].includes(method))

describe("contactSearchClause", () => {
  it("searches name, email and phone_e164 — the columns migration 00213 actually has", () => {
    // MUTANT: `phone.ilike...`. There is no `phone` column on contacts; the
    // whole request 400s and every search looks broken, not just phone ones.
    expect(contactSearchClause("sam")).toBe("name.ilike.%sam%,email.ilike.%sam%,phone_e164.ilike.%sam%")
  })

  it("strips the characters that are GRAMMAR in a PostgREST filter", () => {
    // MUTANT: interpolating the term raw. Commas separate conditions and
    // parentheses group them, so "Smith, John" would parse as extra clauses.
    const clause = contactSearchClause("Smith, John (coach)")
    expect(clause).toBe(
      "name.ilike.%Smith John coach%,email.ilike.%Smith John coach%,phone_e164.ilike.%Smith John coach%",
    )
    expect(clause).not.toContain("(")
    expect(clause?.split(",")).toHaveLength(3)
  })

  it("is null for nothing, so no clause is added at all", () => {
    // MUTANT: returning `%%`, which matches every row with a non-null name and
    // silently DROPS every contact imported with only a phone number.
    expect(contactSearchClause(undefined)).toBeNull()
    expect(contactSearchClause("   ")).toBeNull()
    expect(contactSearchClause("()")).toBeNull()
  })
})

describe("parseContactFilters rejects junk before it reaches the DAL", () => {
  it("ignores a `has` value that is not one of the two real ones", () => {
    // MUTANT: passing `has` straight through. `not("everything","is",null)`
    // is a 400, and the page renders the admin error boundary instead of a list.
    expect(parseContactFilters({ has: "everything" })).toEqual({})
    expect(parseContactFilters({ has: "EMAIL" })).toEqual({})
    expect(parseContactFilters({ has: "" })).toEqual({})
  })

  it("accepts exactly `email` and `phone`", () => {
    expect(parseContactFilters({ has: "email" })).toEqual({ hasEmail: true })
    expect(parseContactFilters({ has: "phone" })).toEqual({ hasPhone: true })
  })

  it("ignores a `days` value that is not 1-4 digits, and ignores zero", () => {
    // MUTANT: `Number(days)` unchecked. `Number("")` is 0 and `Number("junk")`
    // is NaN — `new Date(Date.now() - NaN)` is an Invalid Date, whose
    // toISOString() THROWS, so one junk URL takes the whole page down.
    expect(parseContactFilters({ days: "junk" })).toEqual({})
    expect(parseContactFilters({ days: "-7" })).toEqual({})
    expect(parseContactFilters({ days: "7.5" })).toEqual({})
    expect(parseContactFilters({ days: "99999" })).toEqual({})
    expect(parseContactFilters({ days: "0" })).toEqual({})
  })

  it("turns a valid `days` into an ISO instant that many days back", () => {
    const parsed = parseContactFilters({ days: "30" })
    expect(parsed.since).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const ageDays = (Date.now() - new Date(parsed.since as string).getTime()) / 86_400_000
    expect(ageDays).toBeGreaterThan(29.9)
    expect(ageDays).toBeLessThan(30.1)
  })

  it("drops a blank search and caps a very long one", () => {
    expect(parseContactFilters({ search: "   " })).toEqual({})
    const long = "a".repeat(500)
    expect((parseContactFilters({ search: long }).search ?? "").length).toBeLessThanOrEqual(120)
  })
})

describe("listContacts and countContacts narrow identically", () => {
  const filters = {
    search: "sam",
    hasEmail: true,
    since: "2026-08-01T00:00:00.000Z",
  }

  it("applies the same filter operations to both", async () => {
    // MUTANT: filtering the list and counting the whole table. The footer would
    // read "412 contacts" above a list of 3, and the operator would reasonably
    // conclude 409 people are missing.
    await listContacts(filters)
    await countContacts(filters)

    const [list, count] = calls
    expect(filterOps(list)).toEqual(filterOps(count))
    expect(filterOps(list)).toEqual([
      ["eq", "business_id", BUSINESS],
      ["not", "email", "is", null],
      ["gte", "created_at", "2026-08-01T00:00:00.000Z"],
      ["or", "name.ilike.%sam%,email.ilike.%sam%,phone_e164.ilike.%sam%"],
    ])
  })

  it("scopes to the one business even with no filters at all", async () => {
    // MUTANT: dropping the business scope. Harmless today (one business) and
    // a cross-tenant leak the day a second row exists in `businesses`.
    await listContacts()
    await countContacts()
    expect(filterOps(calls[0])).toEqual([["eq", "business_id", BUSINESS]])
    expect(filterOps(calls[1])).toEqual([["eq", "business_id", BUSINESS]])
  })

  it("has-phone narrows on phone_e164, both together narrow on both", async () => {
    await listContacts({ hasPhone: true })
    expect(filterOps(calls[0])).toEqual([
      ["eq", "business_id", BUSINESS],
      ["not", "phone_e164", "is", null],
    ])

    calls.length = 0
    await listContacts({ hasEmail: true, hasPhone: true })
    expect(filterOps(calls[0])).toEqual([
      ["eq", "business_id", BUSINESS],
      ["not", "email", "is", null],
      ["not", "phone_e164", "is", null],
    ])
  })

  it("counts with head:true rather than pulling the rows back to length them", async () => {
    // MUTANT: `(await listContacts(f)).length`. PostgREST caps a select at
    // ~1000, so the count would plateau exactly when the number starts to matter.
    await countContacts({})
    expect(calls[0].select).toBe("id")
  })

  it("orders newest first and never asks for more than the page cap", async () => {
    await listContacts({ limit: 5000 })
    const ops = Object.fromEntries(calls[0].ops.map(([method, ...args]) => [method, args]))
    expect(ops.order).toEqual(["created_at", { ascending: false }])
    expect(ops.range).toEqual([0, 999])
  })

  it("pages with range(offset, offset + limit - 1)", async () => {
    await listContacts({ limit: 100, offset: 200 })
    const ops = Object.fromEntries(calls[0].ops.map(([method, ...args]) => [method, args]))
    expect(ops.range).toEqual([200, 299])
  })

  it("throws rather than returning [] when the read fails", async () => {
    // `null` and `[]` are different answers: a page that renders an empty list
    // for a failed read tells the operator there are no contacts.
    listResult = { data: null, error: { message: "boom" } }
    await expect(listContacts()).rejects.toThrow(/listContacts: boom/)
  })
})
