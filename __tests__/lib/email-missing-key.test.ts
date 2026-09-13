// What `lib/email.ts` does when RESEND_API_KEY is missing.
//
// The wrapper at the top of that file used to answer `{ data: null, error:
// null }` — the exact shape of a successful send — so a sender that reads
// `error` reported success for a message nothing transmitted. It now answers
// an `error`, which each of them already knows how to handle: the log-only
// ones log, the throwing ones throw, and the batch counter counts the batch as
// failed. `sendChatEscalationEmail` and `sendQuizAlertEmail` were never part
// of that: they check the key themselves and have always answered
// `{ delivered: false }`.
//
// Two things this file is careful about:
//
//  1. The mocked Resend constructor below THROWS when no key is available,
//     exactly the way the real SDK does (node_modules/resend/dist/index.mjs).
//     That is what makes the lazy-construction test meaningful: with the
//     client built at module scope, merely importing `lib/email.ts` without a
//     key throws, and the missing-key branch is unreachable outside tests.
//  2. `vitest.config.ts` sets a global placeholder RESEND_API_KEY, so every
//     test that wants the missing-key branch has to delete it and put it back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const sendMock = vi.fn()
const batchMock = vi.fn()

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
    batch = { send: (...a: unknown[]) => batchMock(...a) }
    constructor(key?: string) {
      // Mirrors the real SDK: `if (!this.key) throw new Error("Missing API
      // key. ...")`, after falling back to process.env.RESEND_API_KEY.
      if (!key && !process.env.RESEND_API_KEY) {
        throw new Error('Missing API key. Pass it to the constructor `new Resend("re_123")`')
      }
    }
  },
}))

const getActiveSubscribers = vi.fn()
vi.mock("@/lib/db/newsletter", () => ({
  getActiveSubscribers: () => getActiveSubscribers(),
}))

import { sendPasswordResetEmail, sendProgramAvailableForPurchaseEmail, sendStandaloneNewsletter } from "@/lib/email"

const originalKey = process.env.RESEND_API_KEY

beforeEach(() => {
  vi.resetAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ data: { id: "e_1" }, error: null })
  batchMock.mockResolvedValue({ data: { data: [{ id: "e_1" }] }, error: null })
  getActiveSubscribers.mockResolvedValue([{ email: "sub@example.com" }])
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalKey
  vi.restoreAllMocks()
})

describe("a sender that THROWS on a provider error (sendPasswordResetEmail)", () => {
  it("sends, and does not throw, when the key is there", async () => {
    // The presence control for the absence assertion below: without it, the
    // "not called" expectation would also pass if the sender never ran.
    await expect(sendPasswordResetEmail("a@b.com", "https://x/reset", "Ada")).resolves.toBeUndefined()

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0].to).toBe("a@b.com")
  })

  it("rejects, naming RESEND_API_KEY, and does not reach the provider when the key is missing", async () => {
    // MUTANT: restore the wrapper's `return { data: null, error: null }` for
    // the missing-key branch — this sender then resolves as if the reset link
    // had been delivered, and the person never receives it.
    delete process.env.RESEND_API_KEY

    await expect(sendPasswordResetEmail("a@b.com", "https://x/reset", "Ada")).rejects.toThrow(/Failed to send email/)
    expect(sendMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send password reset email"),
      expect.objectContaining({ message: expect.stringContaining("RESEND_API_KEY") }),
    )
  })
})

describe("a sender that only LOGS on a provider error (sendProgramAvailableForPurchaseEmail)", () => {
  it("sends when the key is there", async () => {
    await sendProgramAvailableForPurchaseEmail("a@b.com", "Ada", "Off-season", "prog-1")

    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it("logs an error naming RESEND_API_KEY, instead of returning silently, when the key is missing", async () => {
    // MUTANT: restore `{ data: null, error: null }` — the sender then takes
    // its success path and nothing at all is written to the error log, so a
    // deployment with no key looks identical to one that is sending.
    delete process.env.RESEND_API_KEY

    await sendProgramAvailableForPurchaseEmail("a@b.com", "Ada", "Off-season", "prog-1")

    expect(sendMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send program available email"),
      expect.objectContaining({ message: expect.stringContaining("RESEND_API_KEY") }),
    )
  })
})

describe("the batch wrapper (sendStandaloneNewsletter)", () => {
  it("counts the batch as sent when the key is there", async () => {
    const out = await sendStandaloneNewsletter({
      subject: "Week 1",
      previewText: "hello",
      htmlContent: "<p>hi</p>",
    })

    expect(out).toEqual({ sent: 1, failed: 0 })
    expect(batchMock).toHaveBeenCalledTimes(1)
  })

  it("counts the batch as FAILED, not sent, when the key is missing", async () => {
    // MUTANT: restore `{ data: null, error: null }` in the batch twin —
    // sendBatched's success arm runs `sent += data?.data?.length ?? batch
    // .length`, so a null `data` reported the whole batch as SENT. The
    // newsletter admin screen reads these counts.
    delete process.env.RESEND_API_KEY

    const out = await sendStandaloneNewsletter({
      subject: "Week 1",
      previewText: "hello",
      htmlContent: "<p>hi</p>",
    })

    expect(out).toEqual({ sent: 0, failed: 1 })
    expect(batchMock).not.toHaveBeenCalled()
  })
})

describe("the module itself", () => {
  it("can be imported with no RESEND_API_KEY, so the guard is reachable in a real process", async () => {
    // MUTANT: restore `const _resendClient = new Resend(process.env
    // .RESEND_API_KEY)` at module scope. The mocked constructor above throws
    // the way the real SDK does, so an eager client makes this import throw —
    // which in production means every route importing lib/email.ts dies on an
    // env drift, and the missing-key branch above can only ever run in tests.
    delete process.env.RESEND_API_KEY
    vi.resetModules()

    const mod = await import("@/lib/email")

    expect(typeof mod.sendPasswordResetEmail).toBe("function")
  })
})
