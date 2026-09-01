// @vitest-environment node
//
// Pinned to `node` deliberately. Every jsdom-environment suite in this repo
// currently cannot start at all — jsdom's html-encoding-sniffer hits
// ERR_REQUIRE_ESM on this Node version, which is why the sibling grant.test.ts
// reports "no tests" rather than a pass or a failure. A test that cannot run is
// not a guard.
//
// What is tested here is ONLY the four refusals. The granting itself belongs to
// grantFunnelPurchase and is tested there; a copy of those assertions here
// would be a second opinion about the money path, which is exactly what this
// module exists to avoid having.
import { describe, it, expect, vi } from "vitest"
import { grantWonOpportunity, type ManualGrantPorts } from "@/lib/funnels/checkout/grant-manual"

const WON = {
  id: "opp-1",
  outcome: "won" as const,
  contact_id: "c-1",
  source_session_id: null,
}

function ports(overrides: Partial<ManualGrantPorts> = {}): ManualGrantPorts {
  return {
    getOpportunity: vi.fn().mockResolvedValue(WON),
    getContactIdentity: vi.fn().mockResolvedValue({ email: "athlete@example.test", name: "Sam" }),
    runGrant: vi.fn().mockResolvedValue({
      ok: true,
      outcome: "granted",
      userId: "u-1",
      accountCreated: true,
      alreadyOwned: false,
      emailFailed: false,
    }),
    ...overrides,
  }
}

describe("grantWonOpportunity", () => {
  it("grants, and hands the card id down as the idempotency key", async () => {
    const p = ports()
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)

    expect(result).toMatchObject({ outcome: "granted", userId: "u-1", accountCreated: true })
    // The key is the whole idempotency design: one card, one grant, forever.
    expect(p.runGrant).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "opp-1", productId: "prog-1", email: "athlete@example.test" }),
    )
  })

  it("reports a second grant on the same card as already granted", async () => {
    // grantFunnelPurchase's own ledger check answers this, reached because the
    // opportunity id is the key. Nothing is granted twice.
    const p = ports({
      runGrant: vi.fn().mockResolvedValue({
        ok: true,
        outcome: "already_processed",
        userId: "",
        accountCreated: false,
        alreadyOwned: false,
        emailFailed: false,
      }),
    })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "already_granted" })
  })

  it("refuses a card that reached Won through checkout", async () => {
    // Already provisioned by the Stripe webhook under a different key, so the
    // ledger could not see a second grant as a duplicate.
    const p = ports({
      getOpportunity: vi.fn().mockResolvedValue({ ...WON, source_session_id: "cs_test_123" }),
    })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "provisioned_by_checkout" })
    expect(p.runGrant).not.toHaveBeenCalled()
  })

  it("refuses a card that is not won", async () => {
    const p = ports({ getOpportunity: vi.fn().mockResolvedValue({ ...WON, outcome: null }) })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "not_won" })
    expect(p.runGrant).not.toHaveBeenCalled()
  })

  it("refuses a lost card", async () => {
    const p = ports({ getOpportunity: vi.fn().mockResolvedValue({ ...WON, outcome: "lost" }) })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "not_won" })
    expect(p.runGrant).not.toHaveBeenCalled()
  })

  it("refuses when there is no email to invite", async () => {
    const p = ports({ getContactIdentity: vi.fn().mockResolvedValue({ email: null, name: "Sam" }) })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "no_contact_email" })
    expect(p.runGrant).not.toHaveBeenCalled()
  })

  it("refuses a card with no contact at all, without reading an identity", async () => {
    const p = ports({ getOpportunity: vi.fn().mockResolvedValue({ ...WON, contact_id: null }) })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "no_contact_email" })
    expect(p.getContactIdentity).not.toHaveBeenCalled()
  })

  it("reports an unknown card rather than treating it as not won", async () => {
    const p = ports({ getOpportunity: vi.fn().mockResolvedValue(null) })
    const result = await grantWonOpportunity({ opportunityId: "nope", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "unknown_opportunity" })
  })

  it("passes a grant failure through with its stage", async () => {
    const p = ports({
      runGrant: vi.fn().mockResolvedValue({ ok: false, stage: "create_client", error: "boom" }),
    })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result).toEqual({ outcome: "failed", stage: "create_client", error: "boom" })
  })

  it("does not swallow a read failure into a refusal", async () => {
    // Being unable to check is not permission to grant — but neither is it a
    // silent "no". The admin route has a human waiting and may surface a 500.
    const p = ports({ getOpportunity: vi.fn().mockRejectedValue(new Error("db down")) })
    await expect(grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)).rejects.toThrow("db down")
    expect(p.runGrant).not.toHaveBeenCalled()
  })
})
