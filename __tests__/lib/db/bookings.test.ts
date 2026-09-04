// @vitest-environment node
//
// singletonHostId's read failure path. postgrest-js resolves rather than
// throws on a read failure (missing table, RLS misconfiguration, a transient
// network fault), so the function must check `error` explicitly instead of
// relying on a try/catch that would never fire — see the doc comment on
// singletonHostId, and the identical fix applied to the business_members read
// in lib/bookings/ingest.ts. Since migration 00243, bookings.host_id is NOT
// NULL: a null return here now means the booking insert that follows WILL
// fail with 23502, so the console.error this test pins is the only surviving
// diagnostic for what actually went wrong.
//
// getBookings (Task 7, multi-tenancy): this function previously applied NO
// business predicate at all — not a default, an absence — so every admin
// bookings list read every business's rows. It now takes `businessId` as a
// required first parameter. The "bookings" table mock below is separate from
// the "booking_hosts" one above: singletonHostId's SINGLETON_BUSINESS_ID
// literal is deliberately untouched by Task 7 (see lib/db/bookings.ts's own
// comment on singletonHostId), so its own test above stays exactly as it was.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

let bookingHostsMaybeSingle: ReturnType<typeof vi.fn>
let appliedEqs: Array<[string, unknown]>
let bookingsEqCalls: Array<[string, unknown]>
// Shared shape for both getBookings (`{ data, error }`) and getBookingStats
// (`{ count, error }`) — each describe block below sets what it needs.
let bookingsResult: Record<string, unknown>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "booking_hosts") {
        return {
          select: () => ({
            eq: (...args: unknown[]) => {
              appliedEqs.push(args as [string, unknown])
              return {
                order: () => ({
                  limit: () => ({ maybeSingle: bookingHostsMaybeSingle }),
                }),
              }
            },
          }),
        }
      }
      if (table === "bookings") {
        const builder: Record<string, unknown> = {}
        builder.eq = (...args: unknown[]) => {
          bookingsEqCalls.push(args as [string, unknown])
          return builder
        }
        builder.order = () => builder
        builder.then = (resolve: (value: unknown) => void) => resolve(bookingsResult)
        return { select: () => builder }
      }
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

import { getBookings, getBookingStats, singletonHostId } from "@/lib/db/bookings"

describe("singletonHostId", () => {
  beforeEach(() => {
    appliedEqs = []
    bookingHostsMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "host-1" }, error: null })
  })

  it("returns the host id on a normal read", async () => {
    const result = await singletonHostId()
    expect(result).toBe("host-1")
    expect(appliedEqs).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
  })

  it("returns null when no host row exists yet (a genuine 'none', not a failure)", async () => {
    bookingHostsMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const result = await singletonHostId()
    expect(result).toBeNull()
  })

  it("logs and returns null — rather than throwing — when the read RESOLVES with an error", async () => {
    // The regression this pins: postgrest-js never throws on a read failure,
    // it resolves { data: null, error: {...} }. A version of this function
    // that only destructures `data` reports that back as the same "there is
    // no host" answer as a genuine empty table — indistinguishable from the
    // caller's side, and after 00243 that ambiguity ends in a 500 with no
    // clue about the real cause, because the only thing that knew (the
    // error) was thrown away here.
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    bookingHostsMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42P01", message: 'relation "booking_hosts" does not exist' },
    })

    const result = await singletonHostId()

    expect(result).toBeNull()
    expect(err).toHaveBeenCalledWith(expect.stringContaining("singletonHostId read failed"))
    expect(err).toHaveBeenCalledWith(expect.stringContaining("42P01"))
    err.mockRestore()
  })
})

describe("getBookings", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    bookingsResult = { data: [], error: null }
  })

  // This predicate did not exist at all before Task 7 — every admin bookings
  // list read every business's rows. Harmless while one business existed; a
  // cross-tenant leak the moment a second one does.
  it("scopes getBookings to the business, which it previously did not do", async () => {
    await getBookings("bbb")
    expect(bookingsEqCalls).toContainEqual(["business_id", "bbb"])
  })

  it("still applies the status filter alongside the business scope", async () => {
    await getBookings("bbb", "scheduled")
    expect(bookingsEqCalls).toContainEqual(["business_id", "bbb"])
    expect(bookingsEqCalls).toContainEqual(["status", "scheduled"])
  })

  it("does not apply a status filter when none is given", async () => {
    await getBookings("bbb")
    expect(bookingsEqCalls).toEqual([["business_id", "bbb"]])
  })
})

describe("getBookingStats", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    bookingsResult = { count: 3, error: null }
  })

  // Fix round 1 review: these four counts previously carried NO business
  // predicate at all, so the tiles on the bookings page counted every
  // business's rows while the list beneath them showed only one.
  it("scopes every one of its four counts to the business, which it previously did not do", async () => {
    await getBookingStats("bbb")
    const businessEqs = bookingsEqCalls.filter(([column]) => column === "business_id")
    expect(businessEqs).toHaveLength(4)
    expect(businessEqs.every(([, value]) => value === "bbb")).toBe(true)
  })

  it("still narrows each count by its own status", async () => {
    await getBookingStats("bbb")
    const statuses = bookingsEqCalls.filter(([column]) => column === "status").map(([, value]) => value)
    expect(statuses.sort()).toEqual(["cancelled", "completed", "no_show", "scheduled"])
  })
})
