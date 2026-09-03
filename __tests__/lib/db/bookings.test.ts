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
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

let bookingHostsMaybeSingle: ReturnType<typeof vi.fn>
let appliedEqs: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "booking_hosts") throw new Error(`unmocked table ${table}`)
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
    },
  }),
}))

import { singletonHostId } from "@/lib/db/bookings"

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
