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

import { resolveAdminTenant, resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
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
    // The operator is an implicit owner of EVERY business regardless of
    // status -- a status filter here would lock the operator out the moment
    // the last active business got paused, including out of the one page
    // that could un-pause it.
    expect(eqCalls.some(([c]) => c === "status")).toBe(false)
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
    // A coach only ever sees ACTIVE businesses -- a paused tenant is not
    // operating.
    expect(eqCalls).toContainEqual(["status", "active"])
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

  it("throws NoAccessibleBusinessError when it has no membership rows", async () => {
    // No more compatibility fallback. Migration 00246 backfilled every
    // existing admin/staff/editor with a real membership row, and both
    // invite paths write one on accept, so absence of a row now means
    // exactly one thing: no access -- never "predates multi-tenancy". The
    // old fallback to SINGLETON_BUSINESS_ID here is exactly what let
    // offboarding a coach (deleting their membership row) PROMOTE them into
    // the operator's own tenant.
    session = { user: { id: "old-staff", role: "staff" } }
    membersRows = []
    businessesRows = [{ id: SINGLETON_BUSINESS_ID, name: "Primary", slug: "primary", status: "active" }]
    await expect(resolveAdminTenant()).rejects.toThrow(NoAccessibleBusinessError)
  })

  it("THROWS when the membership read fails — it must never read as 'no memberships'", async () => {
    // PostgREST resolves rather than throwing. Treating {data:null,error} as
    // an empty list would silently widen a coach to the singleton: the exact
    // shape of two phase-0 defects.
    session = { user: { id: "coach", role: "staff" } }
    membersError = { code: "42P01", message: "no such table" }
    await expect(resolveAdminTenant()).rejects.toThrow(/42P01|no such table/)
  })

  it("THROWS NoAccessibleBusinessError when the allowed set is empty, rather than falling back to the singleton", async () => {
    // A coach with a REAL membership row for "bbb" whose business was since
    // paused (status in ('active','paused') is a reachable state per
    // migration 00240) does NOT take the ids.length===0 compat branch above
    // -- it has a membership row. Its active-status business read comes back
    // empty. Falling back to SINGLETON_BUSINESS_ID here would hand this coach
    // the operator's own tenant: every contact, pipeline card and booking in
    // it. This is the security-critical path: select() must invent no id.
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [] // "bbb" is paused -- excluded by the active filter
    await expect(resolveAdminTenant()).rejects.toThrow(NoAccessibleBusinessError)
  })
})

describe("resolveAdminTenantForRequest — cookie header parsing", () => {
  it("resolves from a cookie header, honouring a value in the allowed set", async () => {
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [B]
    const req = new Request("https://example.test/", { headers: { cookie: "djp_business=bbb" } })
    const t = await resolveAdminTenantForRequest(req)
    expect(t.businessId).toBe("bbb")
  })

  it("IGNORES a cookie naming a business outside the allowed set", async () => {
    // Same security boundary as the page resolver, driven from a Request
    // instead of next/headers.
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [B]
    const req = new Request("https://example.test/", { headers: { cookie: "djp_business=aaa" } })
    const t = await resolveAdminTenantForRequest(req)
    expect(t.businessId).toBe("bbb") // unchanged
    expect(t.choices.map((c) => c.id)).toContain("bbb") // presence control
  })

  it("the cookie-name anchor prevents matching inside a similarly-named cookie", async () => {
    // Without the `(?:^|;\s*)` anchor, a plain substring search for
    // "djp_business=" would match INSIDE "x_djp_business=aaa" (which
    // literally contains the substring "djp_business=aaa") before ever
    // reaching the real "djp_business=bbb" cookie later in the header.
    session = { user: { id: "op", role: "admin" } }
    businessesRows = [A, B]
    const req = new Request("https://example.test/", {
      headers: { cookie: "x_djp_business=aaa; djp_business=bbb" },
    })
    const t = await resolveAdminTenantForRequest(req)
    expect(t.businessId).toBe("bbb")
  })

  it("a similarly-prefixed cookie with no real djp_business present resolves as if no cookie were sent", async () => {
    session = { user: { id: "op", role: "admin" } }
    businessesRows = [B, A] // choices = [bbb, aaa]; "bbb" is first
    const req = new Request("https://example.test/", { headers: { cookie: "x_djp_business=aaa" } })
    const t = await resolveAdminTenantForRequest(req)
    // The anchored parser finds no djp_business cookie here at all, so
    // select() falls back to the first allowed choice, "bbb" -- NOT "aaa",
    // which only an unanchored substring match would wrongly extract.
    expect(t.businessId).toBe("bbb")
  })

  it("throws rather than returning a tenant when there is no session", async () => {
    session = null
    const req = new Request("https://example.test/", { headers: { cookie: "djp_business=bbb" } })
    await expect(resolveAdminTenantForRequest(req)).rejects.toThrow(/session/i)
  })
})

describe("resolveAdminTenant — no session", () => {
  it("throws rather than returning a tenant", async () => {
    session = null
    await expect(resolveAdminTenant()).rejects.toThrow(/session/i)
  })
})

describe("resolveAdminTenant — roles with no business in /admin", () => {
  // `client` and `editor` have no membership row in practice, so without a
  // role guard they fall into the SAME compat branch a pre-multi-coach staff
  // user takes and get handed the singleton -- and proxy.ts gates /api/*
  // for `staff` only, so a self-registered client account can reach these
  // routes today. The guard must sit in allowedSet() itself, before it
  // computes anything, so every caller of the resolver is covered.
  it("THROWS for a client role, even with zero membership rows (same shape as the old staff compat path)", async () => {
    session = { user: { id: "cust", role: "client" } }
    membersRows = []
    businessesRows = [{ id: SINGLETON_BUSINESS_ID, name: "Primary", slug: "primary", status: "active" }]
    await expect(resolveAdminTenant()).rejects.toThrow(NoAccessibleBusinessError)
  })

  it("THROWS for an editor role, even with zero membership rows", async () => {
    session = { user: { id: "ed", role: "editor" } }
    membersRows = []
    businessesRows = [{ id: SINGLETON_BUSINESS_ID, name: "Primary", slug: "primary", status: "active" }]
    await expect(resolveAdminTenant()).rejects.toThrow(NoAccessibleBusinessError)
  })

  it("PRESENCE CONTROL — staff WITH a real membership row resolves normally", async () => {
    // Proves the two tests above throw because of the ROLE, not because this
    // mock setup makes every call throw. Zero-membership staff can no longer
    // serve as this control (step 13 removed that fallback -- staff with no
    // membership row now throws too, same as client/editor), so this gives
    // staff a real row, same as every teammate has post-migration-00246.
    session = { user: { id: "staffer", role: "staff" } }
    membersRows = [{ business_id: SINGLETON_BUSINESS_ID }]
    businessesRows = [{ id: SINGLETON_BUSINESS_ID, name: "Primary", slug: "primary", status: "active" }]
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe(SINGLETON_BUSINESS_ID)
  })
})
