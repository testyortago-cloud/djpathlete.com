// @vitest-environment node
//
// platformHostId's read failure path. This was singletonHostId in
// lib/db/bookings.ts until phase 2 moved it to lib/tenancy/platform.ts,
// beside platformBusinessId; the tests came WITH it rather than being
// rewritten, because the behaviour they pin is exactly what the move must not
// drift. postgrest-js resolves rather than throws on a read failure (missing
// table, RLS misconfiguration, a transient network fault), so the function
// must check `error` explicitly instead of relying on a try/catch that would
// never fire — see the doc comment on platformHostId, and the identical fix
// applied to the business_members read in lib/bookings/ingest.ts. Since
// migration 00243, bookings.host_id is NOT NULL: a null return here now means
// the booking insert that follows WILL fail with 23502, so the console.error
// this test pins is the only surviving diagnostic for what actually went
// wrong.
//
// getBookings (Task 7, multi-tenancy): this function previously applied NO
// business predicate at all — not a default, an absence — so every admin
// bookings list read every business's rows. It now takes `businessId` as a
// required first parameter. The "bookings" table mock below is separate from
// the "booking_hosts" one above: platformHostId's SINGLETON_BUSINESS_ID
// literal is deliberately untouched by multi-tenancy (see its own comment in
// lib/tenancy/platform.ts), so its test above stays exactly as it was.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

let bookingHostsMaybeSingle: ReturnType<typeof vi.fn>
let appliedEqs: Array<[string, unknown]>
let bookingsEqCalls: Array<[string, unknown]>
// Shared shape for both getBookings (`{ data, error }`) and getBookingStats
// (`{ count, error }`) — each describe block below sets what it needs.
let bookingsResult: Record<string, unknown>

// G35. The describes above assert which `.eq()` calls were made, which is
// enough for a list read. The by-id read, the update and the range read need
// more: "a booking of another business reads as ABSENT" is a claim about
// which ROW comes back, and only a store that genuinely narrows can make it.
// When `bookingsRows` is non-null the `bookings` builder narrows it by every
// `.eq()`, `.gte()` and `.lt()` applied — so dropping a predicate returns the
// foreign row instead of recording one call fewer. `null` keeps the canned
// `bookingsResult` path the older describes rely on.
type BookingRow = Record<string, unknown>
let bookingsRows: BookingRow[] | null = null
let bookingsReadError: { code: string; message: string } | null = null

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
        const eqs: Array<[string, unknown]> = []
        const ranges: Array<[">=" | "<", string, string]> = []
        let patch: BookingRow | null = null
        const narrowed = (): BookingRow[] =>
          (bookingsRows ?? []).filter(
            (row) =>
              eqs.every(([col, val]) => row[col] === val) &&
              ranges.every(([op, col, val]) => (op === ">=" ? String(row[col]) >= val : String(row[col]) < val)),
          )
        const builder: Record<string, unknown> = {}
        builder.eq = (...args: unknown[]) => {
          bookingsEqCalls.push(args as [string, unknown])
          eqs.push(args as [string, unknown])
          return builder
        }
        builder.gte = (col: string, val: string) => {
          ranges.push([">=", col, val])
          return builder
        }
        builder.lt = (col: string, val: string) => {
          ranges.push(["<", col, val])
          return builder
        }
        builder.order = () => builder
        builder.select = () => builder
        builder.maybeSingle = async () => {
          if (bookingsReadError) return { data: null, error: bookingsReadError }
          const rows = narrowed()
          // An UPDATE touches only the rows its predicates matched — the
          // foreign row keeps its status, which the tests below check.
          if (patch) for (const row of rows) Object.assign(row, patch)
          return { data: rows[0] ?? null, error: null }
        }
        // What the old by-id read and update used. Real PostgREST answers
        // zero rows under `.single()` with PGRST116, not with `data: null` —
        // modelled so that a revert to `.single()` fails the "answers null"
        // test for the real reason instead of on a missing method.
        builder.single = async () => {
          if (bookingsReadError) return { data: null, error: bookingsReadError }
          const rows = narrowed()
          if (patch) for (const row of rows) Object.assign(row, patch)
          if (rows.length !== 1) {
            return {
              data: null,
              error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
            }
          }
          return { data: rows[0], error: null }
        }
        builder.then = (resolve: (value: unknown) => void) =>
          resolve(bookingsRows ? { data: narrowed(), error: bookingsReadError } : bookingsResult)
        return {
          select: () => builder,
          update: (p: BookingRow) => {
            patch = p
            return builder
          },
        }
      }
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

import {
  getBookings,
  getBookingStats,
  getBookingById,
  updateBookingStatus,
  getBookingsInRange,
} from "@/lib/db/bookings"
import { platformHostId } from "@/lib/tenancy/platform"

// File-level, so it runs before every describe's own beforeEach: the older
// describes get the canned `bookingsResult` path whatever order they run in.
beforeEach(() => {
  bookingsRows = null
  bookingsReadError = null
})

describe("platformHostId", () => {
  beforeEach(() => {
    appliedEqs = []
    bookingHostsMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "host-1" }, error: null })
  })

  it("returns the host id on a normal read", async () => {
    const result = await platformHostId()
    expect(result).toBe("host-1")
    expect(appliedEqs).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
  })

  it("returns null when no host row exists yet (a genuine 'none', not a failure)", async () => {
    bookingHostsMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const result = await platformHostId()
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

    const result = await platformHostId()

    expect(result).toBeNull()
    expect(err).toHaveBeenCalledWith(expect.stringContaining("platformHostId read failed"))
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

// G35. Two businesses, one booking each. Every id below is distinct from the
// platform constant, so a DAL that hard-coded its tenant would fail too.
const OWN = "bbb"
const OTHER = "ccc"
function seedTwoBusinesses() {
  bookingsRows = [
    {
      id: "bk-own",
      business_id: OWN,
      contact_name: "Own Booker",
      booking_date: "2026-09-25T15:00:00.000Z",
      status: "scheduled",
    },
    {
      id: "bk-other",
      business_id: OTHER,
      contact_name: "Other Booker",
      booking_date: "2026-09-25T16:00:00.000Z",
      status: "scheduled",
    },
  ]
}

describe("getBookingById (G35)", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    seedTwoBusinesses()
  })

  it("reads another business's booking as ABSENT, not as the row (MUTANT: drop the business_id .eq)", async () => {
    expect(await getBookingById(OWN, "bk-other")).toBeNull()
  })

  it("control: returns this business's own booking", async () => {
    expect(await getBookingById(OWN, "bk-own")).toMatchObject({ id: "bk-own", contact_name: "Own Booker" })
  })

  it("answers null for an id that does not exist, instead of throwing PGRST116 (MUTANT: .single())", async () => {
    // `.single()` turned "no such booking" into an error the route could only
    // answer with a 500. A missing row is an answer, not a failure.
    expect(await getBookingById(OWN, "bk-nope")).toBeNull()
  })

  it("still throws a real read failure rather than reporting 'no booking'", async () => {
    bookingsReadError = { code: "42P01", message: 'relation "bookings" does not exist' }
    await expect(getBookingById(OWN, "bk-own")).rejects.toMatchObject({ code: "42P01" })
  })
})

describe("updateBookingStatus (G35)", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    seedTwoBusinesses()
  })

  it("does NOT change another business's booking, and answers null (MUTANT: drop the business_id .eq on the UPDATE)", async () => {
    expect(await updateBookingStatus(OWN, "bk-other", "cancelled")).toBeNull()
    const other = bookingsRows!.find((r) => r.id === "bk-other")!
    expect(other.status).toBe("scheduled")
  })

  it("control: changes this business's own booking and returns the updated row", async () => {
    const updated = await updateBookingStatus(OWN, "bk-own", "completed", "showed up early")
    expect(updated).toMatchObject({ id: "bk-own", status: "completed", notes: "showed up early" })
    expect(bookingsRows!.find((r) => r.id === "bk-own")!.status).toBe("completed")
  })

  it("leaves notes alone when none are given", async () => {
    const updated = await updateBookingStatus(OWN, "bk-own", "no_show")
    expect(updated).not.toHaveProperty("notes")
  })

  it("throws a real write failure rather than reporting 'no booking'", async () => {
    bookingsReadError = { code: "42501", message: "permission denied for table bookings" }
    await expect(updateBookingStatus(OWN, "bk-own", "completed")).rejects.toMatchObject({ code: "42501" })
  })
})

describe("getBookingsInRange (G35)", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    seedTwoBusinesses()
  })

  const from = new Date("2026-09-25T00:00:00.000Z")
  const to = new Date("2026-09-26T00:00:00.000Z")

  it("returns this business's bookings and NOT another business's in the same range (MUTANT: drop the business_id .eq)", async () => {
    const rows = await getBookingsInRange(OWN, from, to)
    // Presence and absence on one read: the own booking is there, the other
    // business's booking — same day, same range — is not.
    expect(rows.map((r) => r.id)).toEqual(["bk-own"])
  })

  it("still applies the date range alongside the business scope (MUTANT: drop .gte/.lt)", async () => {
    const rows = await getBookingsInRange(
      OWN,
      new Date("2026-09-26T00:00:00.000Z"),
      new Date("2026-09-27T00:00:00.000Z"),
    )
    expect(rows).toEqual([])
  })
})

describe("getUpcomingBookings (G35)", () => {
  it("is gone: it had no caller, and any new one would read every business's bookings (MUTANT: the export is restored)", async () => {
    const dal = await import("@/lib/db/bookings")
    expect("getUpcomingBookings" in dal).toBe(false)
    // Presence control on the same module object: an `in` check against
    // something that is not the module would pass the line above vacuously.
    expect("getBookingsInRange" in dal).toBe(true)
  })
})
