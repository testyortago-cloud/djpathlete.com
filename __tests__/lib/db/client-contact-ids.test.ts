// @vitest-environment node
// listClientContactIds: which contacts in a business are this client. The fake APPLIES the filters it is given,
// so dropping the business predicate lets another business's contact through and goes red.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { listClientContactIds } from "@/lib/db/contacts"

type Row = Record<string, unknown>
const CONTACTS: Row[] = [
  { id: "c-user", business_id: "b1", user_id: "u1", email: "old@x.com" },
  { id: "c-email", business_id: "b1", user_id: null, email: "ath@x.com" },
  { id: "c-both", business_id: "b1", user_id: "u1", email: "ath@x.com" },
  { id: "c-elsewhere", business_id: "b2", user_id: "u1", email: "ath@x.com" },
  { id: "c-stranger", business_id: "b1", user_id: null, email: "someone@x.com" },
]
const reads: [string, unknown][][] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const eqs: [string, unknown][] = []
      reads.push(eqs)
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val])
          return chain
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve(
            resolve({
              data: (table === "contacts" ? CONTACTS : []).filter((r) => eqs.every(([c, v]) => r[c] === v)),
              error: null,
            }),
          ),
      }
      return chain
    },
  }),
}))

beforeEach(() => {
  reads.length = 0
})

describe("listClientContactIds", () => {
  it("finds contacts linked to the account AND contacts with the account's email, once each", async () => {
    const ids = await listClientContactIds("b1", { userId: "u1", email: "ath@x.com" })
    expect(ids.sort()).toEqual(["c-both", "c-email", "c-user"])
  })

  it("never returns another business's contact", async () => {
    const ids = await listClientContactIds("b1", { userId: "u1", email: "ath@x.com" })
    expect(ids).not.toContain("c-elsewhere")
    // Presence control: every read carried the business it was given.
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((eqs) => eqs.some(([c, v]) => c === "business_id" && v === "b1"))).toBe(true)
  })

  it("matches by account alone when the client has no usable email", async () => {
    expect((await listClientContactIds("b1", { userId: "u1", email: null })).sort()).toEqual(["c-both", "c-user"])
    expect(reads).toHaveLength(1)
  })

  it("answers an empty list when nobody matches", async () => {
    expect(await listClientContactIds("b1", { userId: "u9", email: "none@x.com" })).toEqual([])
  })
})
