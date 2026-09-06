// @vitest-environment node
//
// listPublicEvents() is the one direct `.from()` reader in
// lib/lead-engine/chat/facts.ts that had NO tenant predicate at all before
// this file existed. Every other visibility rule in facts.ts (is_public,
// status='published', is_active) is pinned by chat-facts.test.ts's own
// filter-applying mock — this file adds the same discipline for
// business_id, because before this change a coach's public /ask chat
// answered questions using the PLATFORM's own camps and clinics: a live
// cross-tenant leak, not a hypothetical one.
//
// The mock below deliberately APPLIES the filters the code under test asks
// for (same idiom as chat-facts.test.ts), rather than handing back canned
// rows regardless. A mock that ignored `.eq("business_id", ...)` would pass
// just as happily with the predicate deleted.
import { describe, it, expect, beforeEach, vi } from "vitest"

const applied: Array<Record<string, unknown>> = []
let rows: Record<string, unknown>[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = { __table: table }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq(col: string, val: unknown) {
          filters[col] = val
          return chain
        },
        gte(col: string, val: unknown) {
          filters[`${col}__gte`] = val
          return chain
        },
        then(res: (v: unknown) => unknown) {
          applied.push(filters)
          const matching = rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => k.startsWith("__") || k.endsWith("__gte") || r[k] === v),
          )
          return Promise.resolve({ data: matching, error: null }).then(res)
        },
      }
      return chain
    },
  }),
}))

const HOST_BIZ = "host-biz"
const OTHER_BIZ = "other-biz"

const CAMP = {
  title: "Camp",
  type: "camp",
  status: "published",
  start_date: "2026-09-01T12:00:00Z",
  end_date: "2026-09-03T12:00:00Z",
  location_name: "Field",
  price_cents: 16500,
  capacity: 12,
  signup_count: 0,
}

beforeEach(() => {
  applied.length = 0
  rows = []
})

describe("listPublicEvents tenancy", () => {
  it("only offers the conversation's own business's events as chat facts", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    rows = [{ ...CAMP, business_id: HOST_BIZ }]
    const facts = await listPublicEvents(HOST_BIZ)
    expect(applied[0]).toMatchObject({ business_id: HOST_BIZ })
    expect(facts).toHaveLength(1)
  })

  it("never surfaces another business's event, even one published and unended", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    // Real row belongs to a DIFFERENT tenant than the one asking — the mock
    // APPLIES the business_id filter, so this proves the predicate actually
    // excludes it rather than merely being present in the query builder.
    rows = [{ ...CAMP, business_id: OTHER_BIZ }]
    const facts = await listPublicEvents(HOST_BIZ)
    expect(facts).toHaveLength(0)
  })

  it("never substitutes the platform's own id for the tenant the caller named", async () => {
    const { listPublicEvents } = await import("@/lib/lead-engine/chat/facts")
    rows = [{ ...CAMP, business_id: HOST_BIZ }]
    await listPublicEvents(HOST_BIZ)
    expect(applied[0].business_id).toBe(HOST_BIZ)
    expect(applied[0].business_id).not.toBe("00000000-0000-0000-0000-000000000001")
  })
})
