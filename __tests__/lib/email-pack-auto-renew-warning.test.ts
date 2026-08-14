import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
    batch = { send: vi.fn() }
  },
}))

import { sendPackAutoRenewWarningEmail } from "@/lib/email"

const base = {
  to: "dad@example.com",
  ccClientEmail: "luca@example.com",
  firstName: "Dad",
  clientName: "Luca",
  remaining: 2,
  sessionType: "Performance training",
  credits: 10,
  cardBrand: "visa",
  cardLast4: "4242",
  amountCents: 75000,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ error: null })
})

describe("sendPackAutoRenewWarningEmail", () => {
  it("addresses the payer and CCs the client", async () => {
    await sendPackAutoRenewWarningEmail(base)
    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("dad@example.com")
    expect(arg.cc).toBe("luca@example.com")
  })

  it("drops the CC when the payer IS the client", async () => {
    await sendPackAutoRenewWarningEmail({ ...base, ccClientEmail: "dad@example.com" })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("drops the CC when the client has no email on file", async () => {
    await sendPackAutoRenewWarningEmail({ ...base, ccClientEmail: null })
    expect(sendMock.mock.calls[0][0].cc).toBeUndefined()
  })

  it("names sessions remaining, card brand + last4, the formatted amount, and what it buys", async () => {
    await sendPackAutoRenewWarningEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("2 session")
    expect(html).toContain("4242")
    expect(html).toMatch(/visa/i)
    expect(html).toContain("$750.00")
    expect(html).not.toContain("75000")
    expect(html).toContain("10")
    expect(html).toContain("Performance training")
  })

  it("explains how to turn auto-renew off", async () => {
    await sendPackAutoRenewWarningEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toMatch(/turn off auto-renew/i)
  })

  it("never promises a date or time window — tied to the event, not a schedule the system can't keep", async () => {
    await sendPackAutoRenewWarningEmail(base)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html.toLowerCase()).not.toMatch(/\btomorrow\b|\bnext week\b|\bin \d+ days?\b/)
  })

  it("does not throw when Resend reports an error — a warning failure must never break the cron", async () => {
    sendMock.mockResolvedValue({ error: { message: "bad recipient" } })
    await expect(sendPackAutoRenewWarningEmail(base)).resolves.toBeUndefined()
  })
})
