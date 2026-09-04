// @vitest-environment node
//
// upsertGoogleAdsAccount was singleton-only by construction: it never took or
// wrote a business_id, so no business but the singleton could ever have an
// ads account (getActiveGoogleAdsAccounts filters on business_id, but
// nothing wrote it). This suite pins the write half: businessId is a
// required second argument, gets written on insert, and re-discovery cannot
// silently move an account from one business to another.
//
// Fixture note: "aaa"/"bbb" are deliberately NOT SINGLETON_BUSINESS_ID
// ("00000000-0000-0000-0000-000000000001") — a fixture using the singleton
// as the "subject" business would pass identically against a
// hardcoded-singleton implementation and prove nothing.
import { describe, it, expect, vi, beforeEach } from "vitest"

let existing: { customer_id: string; business_id: string } | null
let existingError: { message: string; code?: string } | null
let inserted: Array<Record<string, unknown>>
let updates: Array<Record<string, unknown>>
let eqCalls: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "google_ads_accounts") throw new Error(`unmocked table ${table}`)
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return {
              maybeSingle: () => Promise.resolve({ data: existing, error: existingError }),
            }
          },
        }),
        insert: (payload: Record<string, unknown>) => {
          inserted.push(payload)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { ...payload }, error: null }),
            }),
          }
        },
        update: (payload: Record<string, unknown>) => {
          updates.push(payload)
          return {
            eq: (col: string, val: unknown) => {
              eqCalls.push([col, val])
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: { ...payload }, error: null }),
                }),
              }
            },
          }
        },
      }
    },
  }),
}))

import { upsertGoogleAdsAccount, AdsAccountOwnedByAnotherBusinessError } from "@/lib/db/google-ads-accounts"

beforeEach(() => {
  existing = null
  existingError = null
  inserted = []
  updates = []
  eqCalls = []
})

describe("upsertGoogleAdsAccount", () => {
  it("writes business_id on insert — the whole missing write half", async () => {
    existing = null
    await upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")
    expect(inserted[0]?.business_id).toBe("bbb")
  })

  it("keeps matching on customer_id alone, which is the primary key", async () => {
    existing = { customer_id: "123", business_id: "bbb" }
    await upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")
    expect(eqCalls.filter(([c]) => c === "customer_id")).not.toHaveLength(0)
  })

  it("REFUSES to move an account between businesses", async () => {
    // Re-discovery silently reassigning a coach's ad account is the failure
    // this guard exists for.
    existing = { customer_id: "123", business_id: "aaa" }
    await expect(upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")).rejects.toBeInstanceOf(
      AdsAccountOwnedByAnotherBusinessError,
    )
    expect(updates).toHaveLength(0)
  })

  it("does not clobber is_active on the update branch", async () => {
    existing = { customer_id: "123", business_id: "bbb" }
    await upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")
    expect(Object.keys(updates[0] ?? {})).not.toContain("is_active")
  })

  it("allows the SAME business to re-discover its own account", async () => {
    existing = { customer_id: "123", business_id: "bbb" }
    await expect(upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")).resolves.toBeTruthy()
    expect(updates).toHaveLength(1)
  })

  it("a failed existence read throws — it must NOT read as 'no existing row'", async () => {
    // PostgREST resolves rather than throws. Falling through here would turn
    // a transient read failure into a silent overwrite of another business's
    // account (the INSERT path would fire, then 23505 or worse).
    existing = null
    existingError = { message: "connection reset", code: "08006" }
    await expect(upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")).rejects.toBeTruthy()
    expect(inserted).toHaveLength(0)
  })
})
