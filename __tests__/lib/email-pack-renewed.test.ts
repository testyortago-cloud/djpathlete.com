import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
    batch = { send: vi.fn() }
  },
}))

import { sendPackRenewedEmail } from "@/lib/email"

const base = {
  to: "dad@example.com",
  ccClientEmail: "luca@example.com",
  firstName: "Dad",
  clientName: "Luca",
  packLabel: "10× Performance training",
  amountCents: 150000,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ error: null })
})

describe("sendPackRenewedEmail", () => {
  it("addresses the payer and CCs the client", async () => {
    await sendPackRenewedEmail(base)
    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("dad@example.com")
    expect(arg.cc).toBe("luca@example.com")
  })

  it("drops the CC when the payer IS the client", async () => {
    // Otherwise a self-pay renewal CCs someone their own email.
    await sendPackRenewedEmail({ ...base, ccClientEmail: "dad@example.com" })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("drops the CC when the client has no email on file", async () => {
    await sendPackRenewedEmail({ ...base, ccClientEmail: null })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("formats the amount as dollars, not raw cents", async () => {
    await sendPackRenewedEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("$1,500.00")
    expect(html).not.toContain("150000")
  })

  it("names the client in the subject so a household with multiple athletes knows which one renewed", async () => {
    await sendPackRenewedEmail(base)
    expect(sendMock.mock.calls[0][0].subject).toContain("Luca")
  })

  it("greets the payer by first name", async () => {
    await sendPackRenewedEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("Hi Dad,")
  })

  it("does not throw when Resend reports an error — a receipt failure must never break the money path", async () => {
    sendMock.mockResolvedValue({ error: { message: "bad recipient" } })
    await expect(sendPackRenewedEmail(base)).resolves.toBeUndefined()
  })
})
