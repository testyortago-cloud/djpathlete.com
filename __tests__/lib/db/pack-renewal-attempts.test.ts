import { describe, it, expect, vi, beforeEach } from "vitest"

const upsert = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => ({ upsert, select: vi.fn(), update: vi.fn() }) }),
}))

describe("createRenewalAttemptIfAbsent", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null when an attempt already exists for the pack", async () => {
    // ignoreDuplicates means PostgREST returns no row on conflict
    upsert.mockReturnValue({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    const { createRenewalAttemptIfAbsent } = await import("@/lib/db/pack-renewal-attempts")
    const result = await createRenewalAttemptIfAbsent({
      source_package_id: "pack-1",
      new_package_id: null,
      user_id: "u1",
      billing_user_id: "u1",
      amount_cents: 75000,
      status: "pending",
      stripe_payment_intent_id: null,
      failure_reason: null,
    })
    expect(result).toBeNull()
    expect(upsert).toHaveBeenCalledWith(expect.anything(), {
      onConflict: "source_package_id",
      ignoreDuplicates: true,
    })
  })
})
