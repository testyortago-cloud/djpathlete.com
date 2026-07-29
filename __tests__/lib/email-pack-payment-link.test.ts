import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
    batch = { send: vi.fn() }
  },
}))

import { sendPackPaymentLinkEmail } from "@/lib/email"

const base = {
  to: "dad@example.com",
  ccClientEmail: "luca@example.com",
  clientName: "Luca",
  packLabel: "10× Performance training",
  amountCents: 150000,
  url: "https://stripe.test/cs_1",
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ error: null })
})

describe("sendPackPaymentLinkEmail", () => {
  it("addresses the payer and CCs the client", async () => {
    await sendPackPaymentLinkEmail(base)
    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("dad@example.com")
    expect(arg.cc).toBe("luca@example.com")
  })

  it("drops the CC when the payer IS the client", async () => {
    // Otherwise an ordinary sale CCs someone their own email.
    await sendPackPaymentLinkEmail({ ...base, ccClientEmail: "dad@example.com" })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("drops the CC when the client has no email", async () => {
    await sendPackPaymentLinkEmail({ ...base, ccClientEmail: null })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("puts the payment URL in the body twice — button and paste-able fallback", async () => {
    await sendPackPaymentLinkEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html.split("https://stripe.test/cs_1").length - 1).toBeGreaterThanOrEqual(2)
  })

  it("formats the amount as dollars, not raw cents", async () => {
    await sendPackPaymentLinkEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("$1,500.00")
    expect(html).not.toContain("150000")
  })

  it("names the client in the subject so a parent knows which kid it's for", async () => {
    await sendPackPaymentLinkEmail(base)
    expect(sendMock.mock.calls[0][0].subject).toContain("Luca")
  })

  it("throws when Resend reports an error, so the coach learns the send failed", async () => {
    sendMock.mockResolvedValue({ error: { message: "bad recipient" } })
    await expect(sendPackPaymentLinkEmail(base)).rejects.toThrow()
  })
})
