// @vitest-environment node
//
// hasPurchaseSince backs the Stripe webhook's checkout.session.expired guard
// (app/api/stripe/webhook/route.ts): a contact who paid on a LATER checkout
// attempt must not be treated as having abandoned an EARLIER one. This pins
// the two things that guard depends on: the tenant predicate (a same-contact
// purchase filed under a DIFFERENT business must not count) and the "at or
// after `since`" comparison (an OLDER, unrelated purchase must not count
// either). webhook-capture-tenant.test.ts pins the ROUTE's branching on this
// function's answer; this file pins the answer itself.
//
// Gap #14, fix round 1: this suite used to only ever write `source:
// "purchase"` rows, so nothing here ever exercised the query with a
// `funnel_checkout` or `shop` row -- the mock's `.eq("source", "purchase")`
// support would have passed either way, mocked-return-value suites elsewhere
// were the ones asserting the ROUTE's behaviour off a stubbed answer, and
// NOTHING ran the real `.in("source", PURCHASE_SOURCES)` query against a row
// actually carrying one of the narrowed sources. Added below: `.in()` support
// in the fake query builder, one test per `PURCHASE_SOURCES` member, a
// negative for `checkout_abandoned` (which means the OPPOSITE of a purchase),
// and a literal-argument assertion so a source silently dropped from
// `PURCHASE_SOURCES` fails a test even under this mock.
import { describe, it, expect, beforeEach, vi } from "vitest"

type TimelineRow = {
  id: string
  business_id: string
  contact_id: string
  source: string
  occurred_at: string
}

let rows: TimelineRow[] = []
// Records every `.in()` call this suite's queries make, so a test can assert
// the LITERAL column and value list `hasPurchaseSince` passed -- not merely
// that some `.in()` happened, which would tolerate a source silently dropped
// from `PURCHASE_SOURCES`.
const inCalls: Array<[string, unknown[]]> = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "contact_timeline_events") throw new Error(`unmocked table: ${table}`)
      const filters: Array<[string, unknown]> = []
      const inFilters: Array<[string, unknown[]]> = []
      let gteCol: string | null = null
      let gteVal: string | null = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
        select() {
          return api
        },
        eq(col: string, val: unknown) {
          filters.push([col, val])
          return api
        },
        in(col: string, vals: unknown[]) {
          inFilters.push([col, vals])
          inCalls.push([col, vals])
          return api
        },
        gte(col: string, val: string) {
          gteCol = col
          gteVal = val
          return api
        },
        limit() {
          return api
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(resolve: any) {
          const matched = rows.filter((r) => {
            const rec = r as unknown as Record<string, unknown>
            const eqOk = filters.every(([c, v]) => rec[c] === v)
            const inOk = inFilters.every(([c, vs]) => vs.includes(rec[c]))
            const gteOk = gteCol === null || (rec[gteCol] as string) >= (gteVal as string)
            return eqOk && inOk && gteOk
          })
          return resolve({ data: matched, error: null })
        },
      }
      return api
    },
  }),
}))

import { hasPurchaseSince, PURCHASE_SOURCES } from "@/lib/db/contacts"

beforeEach(() => {
  rows = []
  inCalls.length = 0
})

describe("hasPurchaseSince", () => {
  it("true when a purchase for this contact occurred at or after `since`", async () => {
    rows = [
      {
        id: "t1",
        business_id: "biz-a",
        contact_id: "c1",
        source: "purchase",
        occurred_at: "2026-06-01T00:00:00.000Z",
      },
    ]
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(true)
  })

  // Gap #14's fix: a funnel checkout that succeeded on a SECOND attempt now
  // writes `funnel_checkout`, not `purchase`. This is the exact row shape
  // that would have gone unnoticed by `.eq("source", "purchase")`.
  it("true when the qualifying event is `funnel_checkout`, not the bare `purchase` literal", async () => {
    rows = [
      {
        id: "t1",
        business_id: "biz-a",
        contact_id: "c1",
        source: "funnel_checkout",
        occurred_at: "2026-06-01T00:00:00.000Z",
      },
    ]
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(true)
  })

  // Same story for a shop order. `shop_order` cannot reach the
  // checkout.session.expired branch today (it's in
  // NON_COACHING_CHECKOUT_TYPES), but hasPurchaseSince is a general "has this
  // contact paid" question and must answer it correctly regardless of which
  // caller asks.
  it("true when the qualifying event is `shop`", async () => {
    rows = [
      {
        id: "t1",
        business_id: "biz-a",
        contact_id: "c1",
        source: "shop",
        occurred_at: "2026-06-01T00:00:00.000Z",
      },
    ]
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(true)
  })

  // The negative control for the two tests above: `checkout_abandoned` means
  // the OPPOSITE of a purchase and must never satisfy this guard, even though
  // it is filed on `contact_timeline_events` the same as every qualifying
  // source.
  it("false when the only qualifying-looking event is `checkout_abandoned` — it means the opposite of a purchase", async () => {
    rows = [
      {
        id: "t1",
        business_id: "biz-a",
        contact_id: "c1",
        source: "checkout_abandoned",
        occurred_at: "2026-06-01T00:00:00.000Z",
      },
    ]
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(false)
  })

  it("false when the only purchase predates `since` -- an earlier, unrelated sale", async () => {
    rows = [
      {
        id: "t1",
        business_id: "biz-a",
        contact_id: "c1",
        source: "purchase",
        occurred_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(false)
  })

  it("false when the qualifying purchase belongs to a DIFFERENT business", async () => {
    rows = [
      {
        id: "t1",
        business_id: "biz-b",
        contact_id: "c1",
        source: "purchase",
        occurred_at: "2026-06-01T00:00:00.000Z",
      },
    ]
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(false)
  })

  it("false when the contact has no purchase event at all", async () => {
    rows = []
    const result = await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(result).toBe(false)
  })

  // THE LITERAL-ARGUMENT ASSERTION the review asked for: even a suite that
  // mocks the database, rather than hasPurchaseSince's return value, would
  // stay green if a source were silently dropped from PURCHASE_SOURCES
  // UNLESS something asserts the actual list passed to `.in()`. This does.
  it('queries with .in("source", PURCHASE_SOURCES) — the literal argument, not just that .in() was called', async () => {
    await hasPurchaseSince("c1", "biz-a", new Date("2026-05-01T00:00:00.000Z"))
    expect(inCalls).toHaveLength(1)
    expect(inCalls[0][0]).toBe("source")
    expect(inCalls[0][1]).toEqual(PURCHASE_SOURCES)
    expect(inCalls[0][1]).toEqual(expect.arrayContaining(["purchase", "funnel_checkout", "shop"]))
    expect(inCalls[0][1]).not.toEqual(expect.arrayContaining(["checkout_abandoned"]))
  })
})
