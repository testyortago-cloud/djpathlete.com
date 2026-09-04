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

import { addBusinessMember } from "@/lib/db/business-members"

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
