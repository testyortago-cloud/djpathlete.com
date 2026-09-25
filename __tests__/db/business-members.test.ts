// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const eqCalls: Array<[string, unknown]> = []
const inserts: unknown[] = []
let existingRow: unknown = null
let existingError: unknown = null
let insertError: unknown = null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = self
      chain.delete = self
      chain.is = self
      chain.eq = (c: string, v: unknown) => { eqCalls.push([c, v]); return chain }
      chain.insert = (row: unknown) => { inserts.push(row); return { select: () => ({ single: () => Promise.resolve({ data: row, error: insertError }) }) } }
      chain.update = (row: unknown) => { inserts.push(row); return chain }
      chain.maybeSingle = () => Promise.resolve({ data: existingRow, error: existingError })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: existingRow ? [existingRow] : [], error: existingError }).then(res)
      return chain
    },
  }),
}))

import { addBusinessMember, isBusinessMember } from "@/lib/db/business-members"

beforeEach(() => {
  eqCalls.length = 0
  inserts.length = 0
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
