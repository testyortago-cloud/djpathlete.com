// @vitest-environment node
//
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
//
// Task 7 (multi-tenancy): `ContactFilters.businessId` is now REQUIRED, and it
// is what `applyFilters` scopes `.eq("business_id", …)` on — it used to be the
// SINGLETON_BUSINESS_ID constant, applied regardless of who was asking.
// `BUSINESS` below is deliberately NOT SINGLETON_BUSINESS_ID, so a test that
// asserts the caller-supplied id reached `.eq()` cannot be satisfied by code
// that quietly kept scoping to the singleton underneath it.

import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { table: string; select: string; selectArgs: unknown[]; ops: [string, ...unknown[]][] }[] = []

/**
 * A chainable stand-in for the PostgREST builder that RECORDS what was asked of
 * it — the same fake `__tests__/lib/db/funnel-leads.test.ts` uses, and a fake
 * rather than a mock of the DAL for the same reason: mocking `listContacts` to
 * assert `listContacts` was called proves nothing, and the claim here is about
 * the filters that reach the query.
 *
 * `selectArgs` records the WHOLE argument list, not just the column string.
 * Recording only the columns is how the count test below used to pass with
 * `{ count: "exact", head: true }` deleted — see its own comment.
 */
function makeBuilder(table: string, selectArgs: unknown[], result: unknown) {
  const record = { table, select: String(selectArgs[0]), selectArgs, ops: [] as [string, ...unknown[]][] }
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
      select: (...args: unknown[]) =>
        makeBuilder(table, args, (args[1] as { head?: boolean } | undefined)?.head ? countResult : listResult),
    }),
  }),
}))

import { contactSearchClause, countContacts, listContacts, parseContactFilters } from "@/lib/db/contacts-list"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

// A caller's real business id — distinct from SINGLETON_BUSINESS_ID, see the
// header note.
const BUSINESS = "22222222-2222-2222-2222-222222222222"

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
    expect(parseContactFilters({ has: "everything" })).toEqual({ page: 1 })
    expect(parseContactFilters({ has: "EMAIL" })).toEqual({ page: 1 })
    expect(parseContactFilters({ has: "" })).toEqual({ page: 1 })
  })

  it("accepts exactly `email` and `phone`", () => {
    expect(parseContactFilters({ has: "email" })).toEqual({ hasEmail: true, page: 1 })
    expect(parseContactFilters({ has: "phone" })).toEqual({ hasPhone: true, page: 1 })
  })

  it("ignores a `days` value that is not 1-4 digits, and ignores zero", () => {
    // MUTANT: `Number(days)` unchecked. `Number("")` is 0 and `Number("junk")`
    // is NaN — `new Date(Date.now() - NaN)` is an Invalid Date, whose
    // toISOString() THROWS, so one junk URL takes the whole page down.
    expect(parseContactFilters({ days: "junk" })).toEqual({ page: 1 })
    expect(parseContactFilters({ days: "-7" })).toEqual({ page: 1 })
    expect(parseContactFilters({ days: "7.5" })).toEqual({ page: 1 })
    expect(parseContactFilters({ days: "99999" })).toEqual({ page: 1 })
    expect(parseContactFilters({ days: "0" })).toEqual({ page: 1 })
  })

  it("reads a `page` number, and falls back to page 1 for anything that is not one", () => {
    // The whole reason the contacts page could only ever reach its first 100
    // rows: nothing parsed a page, so nothing could pass an offset. Validated
    // the same way `days` is, and for the same reason — every value here comes
    // out of the URL bar, so junk is the normal case.
    expect(parseContactFilters({ page: "3" }).page).toBe(3)
    expect(parseContactFilters({ page: "1" }).page).toBe(1)

    for (const junk of ["0", "-2", "1.5", "junk", "", " ", "99999", "1e3"]) {
      expect(parseContactFilters({ page: junk }).page).toBe(1)
    }
    expect(parseContactFilters({}).page).toBe(1)
  })

  it("keeps `page` out of what the query is narrowed by", async () => {
    // A page number is an OFFSET, decided by the call site that knows the page
    // size. If it leaked into `applyFilters` it would silently become a filter
    // on a column named "page", which `contacts` does not have.
    await listContacts({ ...parseContactFilters({ page: "4" }), businessId: BUSINESS })
    expect(filterOps(calls[0])).toEqual([["eq", "business_id", BUSINESS]])
  })

  it("turns a valid `days` into an ISO instant that many days back", () => {
    const parsed = parseContactFilters({ days: "30" })
    expect(parsed.since).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const ageDays = (Date.now() - new Date(parsed.since as string).getTime()) / 86_400_000
    expect(ageDays).toBeGreaterThan(29.9)
    expect(ageDays).toBeLessThan(30.1)
  })

  it("drops a blank search and caps a very long one", () => {
    expect(parseContactFilters({ search: "   " })).toEqual({ page: 1 })
    const long = "a".repeat(500)
    expect((parseContactFilters({ search: long }).search ?? "").length).toBeLessThanOrEqual(120)
  })
})

describe("listContacts and countContacts narrow identically", () => {
  const filters = {
    businessId: BUSINESS,
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

  // The essential Task 7 assertion: `applyFilters` is the ONE place the scope
  // is applied, used by both the list read and the count, so this proves BOTH
  // reach the caller-supplied businessId — and that neither one is quietly
  // reading SINGLETON_BUSINESS_ID underneath the caller-supplied value.
  it("scopes both the list and the count to the businessId it was given, not the singleton", async () => {
    await listContacts({ businessId: BUSINESS, limit: 20 })
    await countContacts({ businessId: BUSINESS })

    const eqCalls = calls.flatMap((c) => c.ops).filter(([method]) => method === "eq") as [
      "eq",
      string,
      unknown,
    ][]
    const scoped = eqCalls.filter(([, column]) => column === "business_id")

    expect(scoped.length).toBeGreaterThanOrEqual(2) // list AND count
    expect(scoped.every(([, , value]) => value === BUSINESS)).toBe(true)
    expect(scoped.some(([, , value]) => value === SINGLETON_BUSINESS_ID)).toBe(false)
  })

  it("scopes to the given business even with no other filters at all", async () => {
    await listContacts({ businessId: BUSINESS })
    await countContacts({ businessId: BUSINESS })
    expect(filterOps(calls[0])).toEqual([["eq", "business_id", BUSINESS]])
    expect(filterOps(calls[1])).toEqual([["eq", "business_id", BUSINESS]])
  })

  it("has-phone narrows on phone_e164, both together narrow on both", async () => {
    await listContacts({ businessId: BUSINESS, hasPhone: true })
    expect(filterOps(calls[0])).toEqual([
      ["eq", "business_id", BUSINESS],
      ["not", "phone_e164", "is", null],
    ])

    calls.length = 0
    await listContacts({ businessId: BUSINESS, hasEmail: true, hasPhone: true })
    expect(filterOps(calls[0])).toEqual([
      ["eq", "business_id", BUSINESS],
      ["not", "email", "is", null],
      ["not", "phone_e164", "is", null],
    ])
  })

  it("counts with head:true rather than pulling the rows back to length them", async () => {
    // MUTANT: dropping `{ count: "exact", head: true }` from the select. Without
    // it PostgREST returns rows and no count, `countContacts` answers 0 for
    // EVERY query, and the footer reads "0 contacts" above a hundred visible
    // rows — which also hides the "· showing 100" hint, because `100 < 0` is
    // false.
    //
    // This test used to assert `calls[0].select === "id"` alone, which is true
    // with or without the options object: it pinned the column name and nothing
    // its own title claimed. The whole argument list is the assertion.
    await countContacts({ businessId: BUSINESS })
    expect(calls[0].selectArgs).toEqual(["id", { count: "exact", head: true }])
  })

  it("throws rather than returning 0 when the COUNT fails", async () => {
    // The list read has this test and the count did not, which is the more
    // dangerous half: a failed list throws and reaches the admin error boundary,
    // but a count that swallowed its error would render "0 contacts" over a full
    // table and read as "the import did not work".
    countResult = { count: null, error: { message: "count exploded" } }
    await expect(countContacts({ businessId: BUSINESS })).rejects.toThrow(/countContacts: count exploded/)
  })

  it("orders newest first and never asks for more than the page cap", async () => {
    await listContacts({ businessId: BUSINESS, limit: 5000 })
    const ops = Object.fromEntries(calls[0].ops.map(([method, ...args]) => [method, args]))
    expect(ops.order).toEqual(["created_at", { ascending: false }])
    expect(ops.range).toEqual([0, 999])
  })

  it("pages with range(offset, offset + limit - 1)", async () => {
    await listContacts({ businessId: BUSINESS, limit: 100, offset: 200 })
    const ops = Object.fromEntries(calls[0].ops.map(([method, ...args]) => [method, args]))
    expect(ops.range).toEqual([200, 299])
  })

  it("throws rather than returning [] when the read fails", async () => {
    // `null` and `[]` are different answers: a page that renders an empty list
    // for a failed read tells the operator there are no contacts.
    listResult = { data: null, error: { message: "boom" } }
    await expect(listContacts({ businessId: BUSINESS })).rejects.toThrow(/listContacts: boom/)
  })
})
