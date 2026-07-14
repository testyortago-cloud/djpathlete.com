// Regression cover for the conversion-tracking outage.
//
// Prod state that prompted this: 242 attribution rows carried a gclid, ZERO had
// a user_id, and google_ads_conversion_uploads had never received a single row.
// findAttributionByEmail joins `users!inner(email)` through user_id, so with
// user_id always NULL it could never match — the Stripe webhook's email fallback was
// dead, no payment ever got a gclid, and both conversion actions never fired.
//
// The subtle part: the fix (claim at registration) sets claimed_at, and the
// checkout routes used getUnclaimedAttribution — which filters claimed_at IS
// NULL. Claiming would have silently stripped the gclid off every checkout a
// registered user made, breaking the one path that worked. Hence
// getAttributionBySession. These tests pin both halves.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: mocks.from }),
}))

import {
  getAttributionBySession,
  getUnclaimedAttribution,
} from "@/lib/db/marketing-attribution"

const CLAIMED_ROW = {
  id: "attr-1",
  session_id: "sess-1",
  user_id: "user-1",
  gclid: "Cj0KCQ_test_gclid",
  claimed_at: "2026-07-14T00:00:00Z",
}

/**
 * Minimal PostgREST chain double. Records whether `.is("claimed_at", null)` was
 * applied, and returns the row only if the filter permits it.
 */
function makeChain(row: Record<string, unknown> | null) {
  const state = { claimedFilter: false }
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    select: self,
    eq: self,
    order: self,
    limit: self,
    is: (col: string) => {
      if (col === "claimed_at") state.claimedFilter = true
      return chain
    },
    maybeSingle: async () => ({
      // A claimed row is invisible to a query that demands claimed_at IS NULL.
      data: state.claimedFilter && row?.claimed_at ? null : row,
      error: null,
    }),
  })
  return { chain, state }
}

describe("attribution reads vs. claim status", () => {
  beforeEach(() => {
    mocks.from.mockReset()
  })

  it("getAttributionBySession still returns the gclid AFTER the row is claimed", async () => {
    const { chain, state } = makeChain(CLAIMED_ROW)
    mocks.from.mockReturnValue(chain)

    const row = await getAttributionBySession("sess-1")

    // The whole point: reading tracking params must not depend on claim status.
    expect(state.claimedFilter).toBe(false)
    expect(row?.gclid).toBe("Cj0KCQ_test_gclid")
  })

  it("getUnclaimedAttribution hides a claimed row — why checkout must not use it", async () => {
    const { chain, state } = makeChain(CLAIMED_ROW)
    mocks.from.mockReturnValue(chain)

    const row = await getUnclaimedAttribution("sess-1")

    expect(state.claimedFilter).toBe(true)
    // Documents the trap: had checkout kept this call, claiming at registration
    // would have silently dropped the gclid from every subsequent checkout.
    expect(row).toBeNull()
  })

  it("getAttributionBySession returns null when the session has no row", async () => {
    const { chain } = makeChain(null)
    mocks.from.mockReturnValue(chain)

    await expect(getAttributionBySession("nope")).resolves.toBeNull()
  })
})
