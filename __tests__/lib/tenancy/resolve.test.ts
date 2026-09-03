// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

let session: { user: { id: string; role: string } } | null = null
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))

let cookieValue: string | undefined
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: (n: string) => (n === "djp_business" && cookieValue ? { value: cookieValue } : undefined) }),
}))

/**
 * Records every predicate. The point of this suite is that a cookie naming a
 * business the caller may not see CHANGES NOTHING, so the mock has to be able
 * to report which business_id was actually asked for.
 */
const eqCalls: Array<[string, unknown]> = []
let businessesRows: unknown[] = []
let membersRows: unknown[] = []
let membersError: unknown = null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = self
      chain.in = (col: string, vals: unknown) => {
        eqCalls.push([`in:${col}`, vals])
        return chain
      }
      chain.eq = (col: string, val: unknown) => {
        eqCalls.push([col, val])
        return chain
      }
      const result =
        table === "business_members"
          ? { data: membersError ? null : membersRows, error: membersError }
          : { data: businessesRows, error: null }
      chain.maybeSingle = () => Promise.resolve({ data: (result.data as unknown[])?.[0] ?? null, error: result.error })
      chain.single = () => Promise.resolve({ data: (result.data as unknown[])?.[0] ?? null, error: result.error })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
      return chain
    },
  }),
}))

import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const A = { id: "aaa", name: "Alpha", slug: "alpha", status: "active" }
const B = { id: "bbb", name: "Bravo", slug: "bravo", status: "active" }

beforeEach(() => {
  eqCalls.length = 0
  cookieValue = undefined
  businessesRows = []
  membersRows = []
  membersError = null
  session = null
})

describe("resolveAdminTenant — the operator", () => {
  it("gets every active business and is flagged as the operator", async () => {
    session = { user: { id: "op", role: "admin" } }
    businessesRows = [A, B]
    const t = await resolveAdminTenant()
    expect(t.isOperator).toBe(true)
    expect(t.choices.map((c) => c.id)).toEqual(["aaa", "bbb"])
    expect(t.businessId).toBe("aaa")
    // Never filtered by membership.
    expect(eqCalls.some(([c]) => c === "user_id")).toBe(false)
  })

  it("honours a cookie naming one of its own businesses", async () => {
    session = { user: { id: "op", role: "admin" } }
    businessesRows = [A, B]
    cookieValue = "bbb"
    expect((await resolveAdminTenant()).businessId).toBe("bbb")
  })
})

describe("resolveAdminTenant — a coach", () => {
  it("is scoped to the business it is a member of, and gets no switcher", async () => {
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [B]
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe("bbb")
    expect(t.choices).toHaveLength(1)
    expect(t.isOperator).toBe(false)
    // The membership read is keyed on THIS user, by value.
    expect(eqCalls).toContainEqual(["user_id", "coach"])
  })

  it("IGNORES a cookie naming a business it is not a member of", async () => {
    // The security boundary of this phase. A cookie only CHOOSES AMONG the
    // server-recomputed allowed set; it never widens it.
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [B]
    cookieValue = "aaa" // a business this coach may not see
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe("bbb")                       // unchanged
    expect(t.choices.map((c) => c.id)).toEqual(["bbb"])    // presence control
    expect(t.choices.map((c) => c.id)).not.toContain("aaa")
  })

  it("falls back to the singleton when it has no membership rows", async () => {
    // Compatibility: every staff user today has no membership row, and
    // denying them would break every existing teammate on merge day.
    session = { user: { id: "old-staff", role: "staff" } }
    membersRows = []
    businessesRows = [{ id: SINGLETON_BUSINESS_ID, name: "Primary", slug: "primary", status: "active" }]
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe(SINGLETON_BUSINESS_ID)
  })

  it("THROWS when the membership read fails — it must never read as 'no memberships'", async () => {
    // PostgREST resolves rather than throwing. Treating {data:null,error} as
    // an empty list would silently widen a coach to the singleton: the exact
    // shape of two phase-0 defects.
    session = { user: { id: "coach", role: "staff" } }
    membersError = { code: "42P01", message: "no such table" }
    await expect(resolveAdminTenant()).rejects.toThrow(/42P01|no such table/)
  })
})

describe("resolveAdminTenant — no session", () => {
  it("throws rather than returning a tenant", async () => {
    session = null
    await expect(resolveAdminTenant()).rejects.toThrow(/session/i)
  })
})
