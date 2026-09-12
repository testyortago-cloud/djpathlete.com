import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The global mock in __tests__/setup.tsx only stubs `resend.emails.send` (for
// senders that don't care about domains). This module calls
// `resend.domains.list`, so it needs its own mock of the shared client.
vi.mock("@/lib/resend", () => ({
  resend: { domains: { list: vi.fn() } },
}))

import { resend } from "@/lib/resend"
import { listVerifiedSenderDomains, senderDomainVerdict } from "@/lib/email/sender-domains"

const list = resend.domains.list as ReturnType<typeof vi.fn>

// vitest.config.ts sets a global placeholder RESEND_API_KEY for every test so
// truthiness guards elsewhere don't short-circuit. Save/restore it here so
// the "no_api_key" case can delete it without leaking into other files.
let origKey: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
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

  it("fails closed with no_api_key and never calls the SDK when RESEND_API_KEY is unset -- MUTANT: calling the SDK anyway would construct a request with an empty key instead of short-circuiting", async () => {
    delete process.env.RESEND_API_KEY

    const result = await listVerifiedSenderDomains()

    expect(result).toEqual({ ok: false, reason: "no_api_key" })
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
