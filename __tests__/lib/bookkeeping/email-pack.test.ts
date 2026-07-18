import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: vi.fn() } },
  FROM_EMAIL: "DJP <no-reply@darrenjpaul.com>",
}))

import { resend } from "@/lib/resend"
import { sendAccountantPack, accountantPackEmailHtml } from "@/lib/bookkeeping/email-pack"

const send = resend.emails.send as ReturnType<typeof vi.fn>

let origResendKey: string | undefined
let origCoachEmail: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  origResendKey = process.env.RESEND_API_KEY
  origCoachEmail = process.env.COACH_EMAIL
  process.env.RESEND_API_KEY = "re_test"
  process.env.COACH_EMAIL = "darren@darrenjpaul.com"
})

afterAll(() => {
  if (origResendKey !== undefined) {
    process.env.RESEND_API_KEY = origResendKey
  } else {
    delete process.env.RESEND_API_KEY
  }
  if (origCoachEmail !== undefined) {
    process.env.COACH_EMAIL = origCoachEmail
  } else {
    delete process.env.COACH_EMAIL
  }
})

describe("accountantPackEmailHtml", () => {
  it("carries the honesty block", () => {
    const html = accountantPackEmailHtml("2026-01-01", "2026-03-31")
    expect(html).toContain("GROSS")
    expect(html).toContain("CPA")
    expect(html).toContain("candidate")
    expect(html).toContain("2026-01-01")
  })
})

describe("sendAccountantPack", () => {
  it("sends the xlsx as a base64 attachment with the period filename, cc'ing the coach", async () => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const buffer = Buffer.from("xlsx-bytes")
    const res = await sendAccountantPack({
      recipient: "cpa@firm.com",
      from: "2026-01-01",
      to: "2026-03-31",
      buffer,
    })
    expect(res.error).toBeNull()
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe("cpa@firm.com")
    expect(arg.cc).toBe("darren@darrenjpaul.com")
    expect(arg.attachments).toEqual([
      { filename: "djp-accountant-pack-2026-01-01-2026-03-31.xlsx", content: buffer.toString("base64") },
    ])
    expect(arg.subject).toContain("Accountant pack")
  })

  it("does not cc when the recipient IS the coach", async () => {
    send.mockResolvedValue({ data: { id: "e" }, error: null })
    await sendAccountantPack({
      recipient: "darren@darrenjpaul.com",
      from: "2026-01-01",
      to: "2026-03-31",
      buffer: Buffer.from("x"),
    })
    expect(send.mock.calls[0][0].cc).toBeUndefined()
  })

  it("returns the resend error message on failure", async () => {
    send.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await sendAccountantPack({
      recipient: "cpa@firm.com",
      from: "2026-01-01",
      to: "2026-03-31",
      buffer: Buffer.from("x"),
    })
    expect(res.error).toBe("boom")
  })

  it("fails fast when RESEND_API_KEY is unset (never a silent no-op on the money path)", async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendAccountantPack({
      recipient: "cpa@firm.com",
      from: "2026-01-01",
      to: "2026-03-31",
      buffer: Buffer.from("x"),
    })
    expect(res.error).toMatch(/RESEND_API_KEY/)
    expect(send).not.toHaveBeenCalled()
  })
})
