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
import { describe, it, expect, beforeEach, vi } from "vitest"

type TimelineRow = {
  id: string
  business_id: string
  contact_id: string
  source: string
  occurred_at: string
}

let rows: TimelineRow[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "contact_timeline_events") throw new Error(`unmocked table: ${table}`)
      const filters: Array<[string, unknown]> = []
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
            const gteOk = gteCol === null || (rec[gteCol] as string) >= (gteVal as string)
            return eqOk && gteOk
          })
          return resolve({ data: matched, error: null })
        },
      }
      return api
    },
  }),
}))

import { hasPurchaseSince } from "@/lib/db/contacts"

beforeEach(() => {
  rows = []
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
})
