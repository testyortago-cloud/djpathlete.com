import { describe, it, expect, vi, afterEach } from "vitest"
import { stripe, createSetupCheckoutSession } from "@/lib/stripe"

afterEach(() => vi.restoreAllMocks())

describe("createSetupCheckoutSession", () => {
  it("passes currency + setup mode (Stripe rejects setup sessions without currency)", async () => {
    const spy = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ id: "cs_setup", url: "https://stripe.test/setup" } as never)

    const session = await createSetupCheckoutSession({ customerId: "cus_1", userId: "u1" })

    expect(session.url).toBe("https://stripe.test/setup")
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "setup",
        currency: "usd",
        customer: "cus_1",
        metadata: expect.objectContaining({ type: "save_card", userId: "u1" }),
      }),
    )
  })
})
