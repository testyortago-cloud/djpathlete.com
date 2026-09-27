// sendContactFormEmail (lib/email.ts) used to hard-code `to: INFO_EMAIL, cc:
// ADMIN_CC` for EVERY business's contact form — a cross-tenant leak (a second
// business's contact form would email DJP). It now routes through
// alertAddressing(settings) (migration 00282), the same addressing every
// other coach alert uses: `to: alert_email` (cc `reply_to` when it differs),
// or `to: reply_to` alone when `alert_email` is unset, or no send at all when
// neither is configured.

import { describe, it, expect, vi, beforeEach } from "vitest"

type SendArgs = {
  from: string
  to: string | string[]
  cc?: string | string[]
  replyTo?: string
  subject: string
  html: string
}
const sendMock = vi.fn<(args: SendArgs) => Promise<{ data: { id: string } | null; error: unknown }>>()
sendMock.mockResolvedValue({ data: { id: "msg-1" }, error: null })

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } }
  }),
}))

const getBusinessSettingsMock = vi.fn()
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettingsMock(...args),
}))

const FORM = {
  name: "Jamie Rivera",
  email: "jamie@example.com",
  subject: "Coaching inquiry",
  message: "I would like to learn more about the programs you offer.",
}

describe("sendContactFormEmail — routed through alertAddressing (migration 00282)", () => {
  beforeEach(() => {
    sendMock.mockClear()
    getBusinessSettingsMock.mockReset()
  })

  it("sends to alert_email, cc reply_to, replyTo the visitor, when the business has set alert_email", async () => {
    getBusinessSettingsMock.mockResolvedValueOnce({
      business_id: "biz-1",
      alert_email: "sales@example.com",
      reply_to: "coach@example.com",
    })

    const { sendContactFormEmail } = await import("@/lib/email")
    await sendContactFormEmail({ businessId: "biz-1", ...FORM })

    expect(getBusinessSettingsMock).toHaveBeenCalledWith("biz-1")
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe("sales@example.com")
    expect(call.cc).toBe("coach@example.com")
    expect(call.replyTo).toBe("jamie@example.com")
    expect(call.subject).toContain("Coaching inquiry")
    expect(call.html).toContain("Jamie Rivera")
  })

  it("sends to reply_to alone, no cc, when alert_email is not set", async () => {
    getBusinessSettingsMock.mockResolvedValueOnce({
      business_id: "biz-1",
      alert_email: null,
      reply_to: "coach@example.com",
    })

    const { sendContactFormEmail } = await import("@/lib/email")
    await sendContactFormEmail({ businessId: "biz-1", ...FORM })

    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe("coach@example.com")
    expect(call.cc).toBeUndefined()
    expect(call.replyTo).toBe("jamie@example.com")
  })

  it("sends nothing and warns, without throwing, when neither alert_email nor reply_to is set", async () => {
    getBusinessSettingsMock.mockResolvedValueOnce({
      business_id: "biz-1",
      alert_email: null,
      reply_to: "",
    })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { sendContactFormEmail } = await import("@/lib/email")
    await expect(sendContactFormEmail({ businessId: "biz-1", ...FORM })).resolves.toBeUndefined()

    expect(sendMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("biz-1"))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("alert_email"))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reply_to"))
    warnSpy.mockRestore()
  })

  // MUTANT this pins: reading a fixed/hard-coded business id instead of the
  // one passed in. A hard-coded id here would call getBusinessSettings with
  // that constant instead of "biz-given", failing this assertion.
  it("passes the given businessId to getBusinessSettings — a hard-coded business id must fail this test", async () => {
    getBusinessSettingsMock.mockResolvedValueOnce({
      business_id: "biz-given",
      alert_email: "sales@example.com",
      reply_to: "coach@example.com",
    })

    const { sendContactFormEmail } = await import("@/lib/email")
    await sendContactFormEmail({ businessId: "biz-given", ...FORM })

    expect(getBusinessSettingsMock).toHaveBeenCalledTimes(1)
    expect(getBusinessSettingsMock).toHaveBeenCalledWith("biz-given")
  })
})
