// @vitest-environment node
//
// enqueueBookingConversion's second singleton: getActiveGoogleAdsAccounts
// picked accounts[0] of every active account, independent of business_id.
// Asserts the PREDICATE — which `.eq()` calls were applied — not that an
// account came back. A mock that returns an account proves nothing about
// which rows the database would have matched.
import { describe, it, expect, vi, beforeEach } from "vitest"

let appliedEqs: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "google_ads_accounts") throw new Error(`unmocked table ${table}`)
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          appliedEqs.push([col, val])
          return chain
        },
        // The real query builder is itself thenable — await resolves it
        // directly, with no terminal .maybeSingle()/.select() call.
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      }
      return chain
    },
  }),
}))

import { getActiveGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"

describe("getActiveGoogleAdsAccounts tenancy", () => {
  beforeEach(() => {
    appliedEqs = []
  })

  it("filters active accounts by business", async () => {
    await getActiveGoogleAdsAccounts("00000000-0000-0000-0000-0000000000b2")
    expect(appliedEqs).toContainEqual(["business_id", "00000000-0000-0000-0000-0000000000b2"])
    expect(appliedEqs).toContainEqual(["is_active", true])
  })

  it("defaults to the singleton so existing callers are unchanged", async () => {
    await getActiveGoogleAdsAccounts()
    expect(appliedEqs).toContainEqual(["business_id", "00000000-0000-0000-0000-000000000001"])
  })
})
