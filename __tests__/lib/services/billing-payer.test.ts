import { describe, it, expect, vi, beforeEach } from "vitest"

const getBillingPayerMock = vi.fn()
vi.mock("@/lib/db/client-billing-payers", () => ({ getBillingPayer: (...a: unknown[]) => getBillingPayerMock(...a) }))

import { resolveBillingUserId } from "@/lib/services/billing-payer"

beforeEach(() => vi.clearAllMocks())

describe("resolveBillingUserId", () => {
  it("returns the client themselves when no payer is set", async () => {
    getBillingPayerMock.mockResolvedValue(null)
    expect(await resolveBillingUserId("wife")).toBe("wife")
  })

  it("returns the payer when one is set", async () => {
    getBillingPayerMock.mockResolvedValue({ client_user_id: "wife", payer_user_id: "dad" })
    expect(await resolveBillingUserId("wife")).toBe("dad")
    expect(getBillingPayerMock).toHaveBeenCalledWith("wife")
  })

  it("resolves ONE hop only — does not follow the payer's own payer", async () => {
    // wife -> dad; if dad had a payer it must NOT be followed. We only look up
    // the direct client, so a single call returns the direct payer.
    getBillingPayerMock.mockResolvedValue({ client_user_id: "wife", payer_user_id: "dad" })
    expect(await resolveBillingUserId("wife")).toBe("dad")
    expect(getBillingPayerMock).toHaveBeenCalledTimes(1)
  })
})
