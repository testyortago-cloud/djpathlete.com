// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const eqCalls: Array<[string, unknown]> = []
const inCalls: Array<[string, unknown]> = []
const orderCalls: Array<[string, unknown]> = []
const fromCalls: string[] = []
const inserts: unknown[] = []
// Rows a LIST read resolves with. Null falls back to the single-row fixture.
let listRows: unknown[] | null = null
let existingRow: unknown = null
let existingError: unknown = null
let insertError: unknown = null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      fromCalls.push(table)
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = (c: string, o: unknown) => { orderCalls.push([c, o]); return chain }
      chain.in = (c: string, v: unknown) => { inCalls.push([c, v]); return chain }
      chain.delete = self
      chain.is = self
      chain.eq = (c: string, v: unknown) => { eqCalls.push([c, v]); return chain }
      chain.insert = (row: unknown) => { inserts.push(row); return { select: () => ({ single: () => Promise.resolve({ data: row, error: insertError }) }) } }
      chain.update = (row: unknown) => { inserts.push(row); return chain }
      chain.maybeSingle = () => Promise.resolve({ data: existingRow, error: existingError })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: listRows ?? (existingRow ? [existingRow] : []), error: existingError }).then(res)
      return chain
    },
  }),
}))

import {
  addBusinessMember,
  isBusinessMember,
  LEAD_ALERT_ROLES,
  listBusinessMemberUserIds,
} from "@/lib/db/business-members"

beforeEach(() => {
  eqCalls.length = 0
  inCalls.length = 0
  orderCalls.length = 0
  fromCalls.length = 0
  inserts.length = 0
  listRows = null
  existingRow = null
  existingError = null
  insertError = null
})

describe("addBusinessMember", () => {
  it("inserts the membership scoped to BOTH the business and the user", async () => {
    const out = await addBusinessMember("bbb", "u9", "coach")
    expect(out).toBe("added")
    expect(inserts[0]).toEqual({ business_id: "bbb", user_id: "u9", role: "coach" })
    expect(eqCalls).toContainEqual(["business_id", "bbb"])
    expect(eqCalls).toContainEqual(["user_id", "u9"])
  })

  it("reports 'already' when the row exists, without inserting", async () => {
    existingRow = { business_id: "bbb", user_id: "u9", role: "coach" }
    expect(await addBusinessMember("bbb", "u9", "coach")).toBe("already")
    expect(inserts).toHaveLength(0)
  })

  it("treats a 23505 from a concurrent accept as 'already', not a failure", async () => {
    // business_members is primary key (business_id, user_id), so a double
    // accept races. Read-then-insert, and 23505 means the other one won.
    // NEVER .upsert(onConflict) -- that answers 42P10 against a partial index.
    insertError = { code: "23505", message: "duplicate key" }
    expect(await addBusinessMember("bbb", "u9", "coach")).toBe("already")
  })

  it("throws when the existence read fails — a failed read is not 'no row'", async () => {
    existingError = { code: "42P01", message: "no such table" }
    await expect(addBusinessMember("bbb", "u9", "coach")).rejects.toThrow(/42P01|no such table/)
  })
})

// Written for the `/go/<slug>?preview=1` escalation (fix wave item 2): a
// staff session's global `role` cannot answer whether THIS caller may see
// THIS tenant's unpublished funnel, only whether they hold a business_members
// row on it.
describe("isBusinessMember", () => {
  it("is true when a business_members row exists for that exact pair", async () => {
    existingRow = { business_id: "bbb", user_id: "u9", role: "staff" }
    expect(await isBusinessMember("bbb", "u9")).toBe(true)
    expect(eqCalls).toContainEqual(["business_id", "bbb"])
    expect(eqCalls).toContainEqual(["user_id", "u9"])
  })

  it("is false — the permissive control — when no row exists", async () => {
    // Without this control, a stubbed-true membership check would pass the
    // test above and every refusal this function is meant to back.
    existingRow = null
    expect(await isBusinessMember("bbb", "u9")).toBe(false)
  })

  it("throws when the read fails — a failed read is not 'not a member'", async () => {
    // The CALLER (the /go page) is what decides to fail closed on this; the
    // DAL function itself must not silently launder an error into "false".
    existingError = { code: "42P01", message: "no such table" }
    await expect(isBusinessMember("bbb", "u9")).rejects.toThrow(/42P01|no such table/)
  })
})

// G35. The contact and inquiry routes bell these people instead of every
// `users.role = 'admin'` row. The mock records the filters the reader asks
// for; it does not apply them, so each filter is asserted by name.
describe("listBusinessMemberUserIds", () => {
  it("reads only THIS business's members, only in the roles asked for, oldest first", async () => {
    // MUTANT: drop `.eq("business_id", …)` — every business's owners and
    // coaches get this business's lead alerts. MUTANT: drop `.in("role", …)` —
    // staff get them too. MUTANT: drop either `.order` — the inquiry route's
    // analysis requester becomes whichever row Postgres returned first.
    listRows = [{ user_id: "u-owner" }, { user_id: "u-coach" }]

    const ids = await listBusinessMemberUserIds("bbb", ["owner", "coach"])

    expect(ids).toEqual(["u-owner", "u-coach"])
    expect(fromCalls).toEqual(["business_members"])
    expect(eqCalls).toEqual([["business_id", "bbb"]])
    expect(inCalls).toEqual([["role", ["owner", "coach"]]])
    expect(orderCalls).toEqual([
      ["created_at", { ascending: true }],
      ["user_id", { ascending: true }],
    ])
  })

  it("passes the roles it was given, not a fixed set (the control for the role filter)", async () => {
    listRows = []
    await listBusinessMemberUserIds("bbb", ["owner"])
    expect(inCalls).toEqual([["role", ["owner"]]])
  })

  it("answers [] for a business with nobody in those roles — an empty result, not an error", async () => {
    listRows = []
    expect(await listBusinessMemberUserIds("bbb", ["owner", "coach"])).toEqual([])
  })

  it("throws when the read fails — a failed read is not 'nobody to tell'", async () => {
    // MUTANT: `return []` on error. The routes could then not tell a business
    // with no owner from a read that never happened, and the log line that is
    // the only trace of a lost alert would never be written.
    existingError = { code: "42P01", message: "no such table" }
    await expect(listBusinessMemberUserIds("bbb", ["owner", "coach"])).rejects.toThrow(/42P01/)
  })
})

describe("LEAD_ALERT_ROLES", () => {
  it("is exactly owners and coaches — the owner's ruling for contact and inquiry bells (G35)", () => {
    // Exact, so `staff` joining the list fails here as well as in the routes'
    // own call assertions.
    expect([...LEAD_ALERT_ROLES]).toEqual(["owner", "coach"])
  })
})
