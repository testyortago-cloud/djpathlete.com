import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The module under test builds its OWN Resend client per call (see the
// comment on listVerifiedSenderDomains in lib/email/sender-domains.ts for
// why) instead of importing the shared singleton from lib/resend.ts, so this
// mocks the "resend" package directly. The global mock in
// __tests__/setup.tsx also mocks "resend", but only exposes `emails.send` on
// the constructed instance -- a per-file vi.mock wins, and this one also
// lets tests assert on whether `new Resend()` itself was ever called, not
// just its `domains.list` method.
const list = vi.fn()
vi.mock("resend", () => ({
  // A regular function (not an arrow) so `new Resend()` is constructable --
  // arrow functions can't be used with `new`. Matches the pattern in
  // __tests__/setup.tsx.
  Resend: vi.fn(function () {
    return { domains: { list } }
  }),
}))

import { Resend } from "resend"
import { listVerifiedSenderDomains, relatedVerifiedDomains, senderDomainVerdict } from "@/lib/email/sender-domains"

const ResendCtor = Resend as unknown as ReturnType<typeof vi.fn>

// vitest.config.ts sets a global placeholder RESEND_API_KEY for every test so
// truthiness guards elsewhere don't short-circuit. Save/restore it here so
// the "no_api_key" cases can delete it without leaking into other files.
let origKey: string | undefined

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: the last test in this file reconfigures
  // ResendCtor's implementation to throw. clearAllMocks only wipes call
  // history, not a sticky mockImplementation -- a leaked "always throws"
  // implementation would silently break every test that happened to run
  // after it. Re-arm the default (working) implementation right after.
  vi.resetAllMocks()
  ResendCtor.mockImplementation(function () {
    return { domains: { list } }
  })
  origKey = process.env.RESEND_API_KEY
  process.env.RESEND_API_KEY = "re_test"
})

afterEach(() => {
  if (origKey !== undefined) process.env.RESEND_API_KEY = origKey
  else delete process.env.RESEND_API_KEY
})

describe("listVerifiedSenderDomains", () => {
  it("keeps only status:verified domains, lowercased -- MUTANT: dropping the status filter (so pending/failed domains pass too) would let a domain Resend has not verified reach senderDomainVerdict as if it were safe", async () => {
    list.mockResolvedValue({
      data: {
        object: "list",
        has_more: false,
        data: [
          { id: "1", name: "Send.DarrenJPaul.com", status: "verified" },
          { id: "2", name: "darrenjpaul.com", status: "pending" },
          { id: "3", name: "old.example.com", status: "failed" },
        ],
      },
      error: null,
    })

    const result = await listVerifiedSenderDomains()

    expect(result).toEqual({ ok: true, domains: ["send.darrenjpaul.com"] })
  })

  it("fails closed with api_error when the SDK reports an error -- MUTANT: returning ok:true with domains:[] here reads identically to 'no domains verified' downstream, but the caller's copy ('could not confirm') is specifically about Resend being unreachable, not about an empty account", async () => {
    list.mockResolvedValue({ data: null, error: { name: "rate_limit_exceeded", message: "slow down" } })

    const result = await listVerifiedSenderDomains()

    expect(result).toEqual({ ok: false, reason: "api_error" })
  })

  it("fails closed with api_error when domains.list rejects -- MUTANT: no try/catch around the call would let this reject propagate uncaught instead of degrading to a 400", async () => {
    list.mockRejectedValue(new Error("network blip"))

    const result = await listVerifiedSenderDomains()

    expect(result).toEqual({ ok: false, reason: "api_error" })
  })

  it("fails closed with no_api_key and never constructs a client or calls the SDK when RESEND_API_KEY is unset -- MUTANT: constructing the client before checking the key would reach the SDK (or the SDK's own constructor) with an empty key instead of short-circuiting", async () => {
    delete process.env.RESEND_API_KEY

    const result = await listVerifiedSenderDomains()

    expect(result).toEqual({ ok: false, reason: "no_api_key" })
    expect(ResendCtor).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})

describe("senderDomainVerdict", () => {
  it("matches the domain case-insensitively -- MUTANT: comparing without lowercasing either side would reject a real, verified domain typed in mixed case", () => {
    expect(senderDomainVerdict("noreply@Send.DarrenJPaul.com", ["send.darrenjpaul.com"])).toEqual({ ok: true })
  })

  it("refuses the apex when only the subdomain is verified -- MUTANT: this is the exact 08-31 fault (sender_email on the apex, only the subdomain verified). A suffix/subdomain match in either direction (apex accepted because a subdomain is verified, or vice versa) would let it back in", () => {
    expect(senderDomainVerdict("noreply@darrenjpaul.com", ["send.darrenjpaul.com"])).toEqual({
      ok: false,
      domain: "darrenjpaul.com",
    })
  })
})

// Kept as its own describe block, last in the file: it deliberately leaves
// the "resend" mock's constructor configured to throw, and relies on being
// the final thing this file runs so that state can't leak into an earlier
// test (see the resetAllMocks note above -- this is the scenario it guards
// against elsewhere in the file, but nothing runs after this one).
describe("listVerifiedSenderDomains -- decoupled from the shared client (review round 1, finding 1)", () => {
  it("does not construct a client at module-evaluation time, even when the key is absent and the constructor would throw -- MUTANT: reintroducing a module-scope client (the lib/resend.ts eager-singleton pattern: `const client = new Resend(process.env.RESEND_API_KEY!)` at the top of the file) would throw during THIS import, before listVerifiedSenderDomains's own key guard ever runs -- which is exactly how loading the businesses route crashed on any PATCH when RESEND_API_KEY was unset", async () => {
    delete process.env.RESEND_API_KEY
    vi.resetModules()

    // Grab whatever "resend" resolves to fresh, post-reset, rather than
    // reusing the top-of-file ResendCtor reference -- resetModules may or may
    // not re-run the vi.mock factory, and this way the test is correct either
    // way instead of assuming one behavior.
    const { Resend: FreshResend } = await import("resend")
    const freshResendCtor = FreshResend as unknown as ReturnType<typeof vi.fn>
    // Mirror the REAL Resend SDK's own behavior (and lib/resend.ts's eager
    // construction of it): throw synchronously when constructed with no key.
    freshResendCtor.mockImplementation(() => {
      throw new Error("Missing API key. Pass it to the constructor `new Resend(apiKey)`")
    })

    // The import itself must not throw, even though the (mocked) constructor
    // now throws unconditionally -- proving nothing at this module's own top
    // level ever calls it.
    const mod = await import("@/lib/email/sender-domains")
    expect(freshResendCtor).not.toHaveBeenCalled()

    // And the function's own guard must short-circuit before ever reaching
    // that throwing constructor.
    const result = await mod.listVerifiedSenderDomains()
    expect(result).toEqual({ ok: false, reason: "no_api_key" })
    expect(freshResendCtor).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// WHAT THE REFUSAL IS ALLOWED TO NAME.
//
// Resend domains are ACCOUNT-wide: one Resend account backs every tenant on
// the platform, so rendering the whole verified list in an error message shows
// one coach another coach's sending domains.
// ---------------------------------------------------------------------------
describe("relatedVerifiedDomains", () => {
  it("names the verified SUBDOMAIN of an apex that was typed -- the 08-31 shape", () => {
    expect(relatedVerifiedDomains("darrenjpaul.com", ["send.darrenjpaul.com"])).toEqual(["send.darrenjpaul.com"])
  })

  it("names the verified APEX when a subdomain was typed -- the mirror direction", () => {
    // MUTANT: checking only one direction. Someone who typed
    // mail.example.com while example.com is the verified domain gets a
    // refusal with no idea what to type instead.
    expect(relatedVerifiedDomains("mail.example.com", ["example.com"])).toEqual(["example.com"])
  })

  it("returns NOTHING for the rest of the account -- MUTANT: returning the full verified list leaks every other coach's sending domain into one coach's error message", () => {
    expect(
      relatedVerifiedDomains("brand-new.com", ["send.darrenjpaul.com", "mail.coach-two.com", "coach-three.io"]),
    ).toEqual([])
  })

  it("does not treat a shared SUFFIX as related -- MUTANT: `endsWith(typed)` without the dot separator matches notdarrenjpaul.com", () => {
    expect(relatedVerifiedDomains("notdarrenjpaul.com", ["send.darrenjpaul.com"])).toEqual([])
    expect(relatedVerifiedDomains("darrenjpaul.com", ["sendxdarrenjpaul.com"])).toEqual([])
  })

  it("is presentation only: it does NOT make senderDomainVerdict accept a relative", () => {
    // CONTROL. The verdict stays an exact match -- that is the whole 08-31
    // lesson -- and this helper runs only after it has already refused.
    // MUTANT: wiring relatedVerifiedDomains into senderDomainVerdict, which
    // would accept the apex because a subdomain of it is verified.
    expect(senderDomainVerdict("noreply@darrenjpaul.com", ["send.darrenjpaul.com"])).toEqual({
      ok: false,
      domain: "darrenjpaul.com",
    })
  })
})
