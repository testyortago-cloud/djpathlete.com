// functions/src/ads/__tests__/dal.test.ts
//
// getActiveGoogleAdsAccounts is a Firebase TWIN of
// lib/db/google-ads-accounts.ts:getActiveGoogleAdsAccounts (functions/
// cannot import from lib/ — see CLAUDE.md) and, until this task, applied NO
// business filter at all. Asserts the PREDICATE applied — which `.eq()`
// calls were made — not merely that an account came back; a mock that
// returns a row proves nothing about which rows the real database would
// have matched.
//
// Fixture note: "bbb" is deliberately NOT the singleton
// ("00000000-0000-0000-0000-000000000001") — a fixture using the singleton
// as the "subject" business would pass identically against a
// hardcoded-singleton implementation and prove nothing.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { getActiveGoogleAdsAccounts } from "../dal.js"
import { getSupabase } from "../../lib/supabase.js"
import { SINGLETON_BUSINESS_ID } from "../../lib/tenancy-constants.js"

let appliedEqs: Array<[string, unknown]>

function mockSupabase() {
  ;(getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
    from: (table: string) => {
      if (table !== "google_ads_accounts") throw new Error(`unmocked table ${table}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          appliedEqs.push([col, val])
          return chain
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      }
      return chain
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  appliedEqs = []
  mockSupabase()
})

describe("functions/src/ads/dal.ts getActiveGoogleAdsAccounts tenancy", () => {
  it("filters active accounts by the given business", async () => {
    await getActiveGoogleAdsAccounts("bbb")
    expect(appliedEqs).toContainEqual(["business_id", "bbb"])
    expect(appliedEqs).toContainEqual(["is_active", true])
  })

  it("defaults to the singleton so the existing nightly-cron caller is unchanged", async () => {
    await getActiveGoogleAdsAccounts()
    expect(appliedEqs).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
  })
})
