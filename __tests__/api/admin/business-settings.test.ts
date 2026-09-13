// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted so the class exists by the time the factory below (which names
// it) is invoked -- mock factories are hoisted above this file's own
// top-level statements.
const { NoAccessibleBusinessError, BusinessSettingsMissingError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  class BusinessSettingsMissingError extends Error {
    constructor(businessId: string) {
      super(`business_settings row missing for ${businessId}`)
      this.name = "BusinessSettingsMissingError"
    }
  }
  return { NoAccessibleBusinessError, BusinessSettingsMissingError }
})

const settingsCalls: Array<{ patch: unknown; businessId: string }> = []
const businessCalls: Array<{ id: string; patch: unknown }> = []
const getSettingsCalls: string[] = []
let getSettingsImpl: (id: string) => Promise<unknown> = (id: string) => {
  getSettingsCalls.push(id)
  return Promise.resolve({ business_id: id, display_name: "B" })
}

vi.mock("@/lib/db/businesses", () => ({
  getBusiness: (id: string) => Promise.resolve({ id, name: "B", slug: "b", status: "active" }),
  updateBusiness: (id: string, patch: unknown) => { businessCalls.push({ id, patch }); return Promise.resolve({ id, ...(patch as object) }) },
  getBusinessSettings: (id: string) => getSettingsImpl(id),
  updateBusinessSettings: (patch: unknown, businessId: string) => { settingsCalls.push({ patch, businessId }); return Promise.resolve({ business_id: businessId }) },
  BusinessSettingsMissingError,
}))

let tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
let resolveImpl: () => Promise<unknown> = () => Promise.resolve(tenant)
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => resolveImpl(),
  NoAccessibleBusinessError,
}))
let session: unknown = { user: { id: "u", role: "staff" } }
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: () => Promise.resolve() }))

// Partial mock: keep the real senderDomainVerdict (pure exact-match logic,
// already covered by __tests__/lib/email/sender-domains.test.ts) and control
// only the network-touching listVerifiedSenderDomains per test.
let listDomainsCalls = 0
let listDomainsImpl: () => Promise<
  { ok: true; domains: string[] } | { ok: false; reason: "no_api_key" | "api_error" }
> = () => Promise.resolve({ ok: true, domains: ["send.darrenjpaul.com"] })
vi.mock("@/lib/email/sender-domains", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/sender-domains")>()
  return {
    ...actual,
    listVerifiedSenderDomains: () => {
      listDomainsCalls++
      return listDomainsImpl()
    },
  }
})

import { PATCH } from "@/app/api/admin/businesses/[id]/route"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/businesses/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  settingsCalls.length = 0
  businessCalls.length = 0
  getSettingsCalls.length = 0
  tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
  resolveImpl = () => Promise.resolve(tenant)
  session = { user: { id: "u", role: "staff" } }
  getSettingsImpl = (id: string) => {
    getSettingsCalls.push(id)
    return Promise.resolve({ business_id: id, display_name: "B" })
  }
  listDomainsCalls = 0
  listDomainsImpl = () => Promise.resolve({ ok: true, domains: ["send.darrenjpaul.com"] })
})

describe("PATCH /api/admin/businesses/[id]", () => {
  it("patches settings against the id in the URL when it is in the allowed set", async () => {
    const res = await PATCH(req({ settings: { display_name: "New Name" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(settingsCalls).toHaveLength(1)
    expect(settingsCalls[0].businessId).toBe("bbb")
    expect((settingsCalls[0].patch as { display_name: string }).display_name).toBe("New Name")
  })

  it("REFUSES an id outside the caller's allowed set and writes nothing", async () => {
    // The URL is caller-controlled. Without this check a coach could patch
    // another coach's sending identity by typing a different id.
    const res = await PATCH(req({ settings: { display_name: "Hijacked" } }), { params: Promise.resolve({ id: "aaa" }) })
    expect(res.status).toBe(403)
    expect(settingsCalls).toHaveLength(0)
    expect(businessCalls).toHaveLength(0)
  })

  it("lets the operator patch any business", async () => {
    tenant = { businessId: "aaa", choices: [{ id: "aaa", name: "A", slug: "a" }, { id: "bbb", name: "B", slug: "b" }], isOperator: true }
    const res = await PATCH(req({ settings: { display_name: "Fine" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(settingsCalls[0].businessId).toBe("bbb")
  })

  it("rejects an out-of-range quiet hour and writes nothing", async () => {
    const res = await PATCH(req({ settings: { quiet_hours_start: 99 } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(400)
    expect(settingsCalls).toHaveLength(0)
  })

  it("rejects an unrecognised timezone and writes nothing", async () => {
    const res = await PATCH(req({ settings: { timezone: "Mars/Olympus" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(400)
    expect(settingsCalls).toHaveLength(0)
  })

  it("patches the business row too when asked", async () => {
    const res = await PATCH(req({ business: { status: "paused" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(businessCalls[0]).toEqual({ id: "bbb", patch: { status: "paused" } })
  })

  it("answers 403, not a 500, when the caller has no accessible business", async () => {
    // resolveAdminTenantForRequest THROWS rather than inventing an id when
    // the allowed set is empty -- e.g. a coach whose only membership points
    // at a business that was since paused. The route must catch this, the
    // same way Task 4's POST /api/admin/businesses does.
    resolveImpl = () => Promise.reject(new NoAccessibleBusinessError())
    const res = await PATCH(req({ settings: { display_name: "X" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(403)
    expect(settingsCalls).toHaveLength(0)
    expect(businessCalls).toHaveLength(0)
  })

  it("refuses a client session and writes nothing (privilege-escalation regression)", async () => {
    // The exact chain a real client account could take before the resolver
    // fix: a client session has no membership row, so unpatched allowedSet()
    // handed it the singleton via the staff compat path. resolveAdminTenant-
    // ForRequest is mocked here, so this test documents the contract this
    // route depends on -- resolveAdminTenantForRequest now THROWS
    // NoAccessibleBusinessError for a client role (proven for real in
    // __tests__/lib/tenancy/resolve.test.ts) -- and proves the route answers
    // 403 and writes nothing when it does, rather than trusting a `choices`
    // array a non-admin-panel role should never have received.
    session = { user: { id: "cust", role: "client" } }
    resolveImpl = () => Promise.reject(new NoAccessibleBusinessError())
    const res = await PATCH(
      req({ settings: { sender_email: "attacker@example.com" } }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) },
    )
    expect(res.status).toBe(403)
    expect(settingsCalls).toHaveLength(0)
    expect(businessCalls).toHaveLength(0)
  })

  it("pins the business-row write and the settings read to the URL id, not tenant.businessId", async () => {
    // The operator's OWN business is "aaa"; the URL asks to patch "bbb".
    // Both getBusinessSettings(id) and updateBusiness(id, ...) must be
    // called with "bbb" -- the id in the URL -- not "aaa".
    tenant = { businessId: "aaa", choices: [{ id: "aaa", name: "A", slug: "a" }, { id: "bbb", name: "B", slug: "b" }], isOperator: true }
    const res = await PATCH(req({ business: { status: "paused" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(businessCalls[0].id).toBe("bbb")
    expect(getSettingsCalls).toContain("bbb")
    expect(getSettingsCalls).not.toContain("aaa")
  })

  it("answers 404, not a 500, when the business has no settings row", async () => {
    // create_business always writes the settings row; a business created
    // outside that function might not have one. Either way this must not
    // 500.
    getSettingsImpl = (id: string) => Promise.reject(new BusinessSettingsMissingError(id))
    const res = await PATCH(req({ settings: { display_name: "X" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(404)
    expect(settingsCalls).toHaveLength(0)
  })
})

describe("PATCH /api/admin/businesses/[id] -- sender_email domain verification (audit §4 #1)", () => {
  it("REFUSES a sender_email on a domain Resend has not verified, and writes nothing -- MUTANT: dropping the whole check reintroduces the 08-31 fault (apex typed back in while only the subdomain is verified)", async () => {
    listDomainsImpl = () => Promise.resolve({ ok: true, domains: ["send.darrenjpaul.com"] })
    const res = await PATCH(req({ settings: { sender_email: "noreply@darrenjpaul.com" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/darrenjpaul\.com.*not verified/i)
    expect(settingsCalls).toHaveLength(0)
  })

  it("names the domain they MEANT, and never the rest of the Resend account", async () => {
    // Resend domains are ACCOUNT-wide, not per-business: one account backs
    // every tenant. The refusal used to render `verified.domains.join(", ")`,
    // so a coach who mistyped their own sender address was shown every other
    // coach's sending domains.
    //
    // MUTANT: putting `verified.domains.join(", ")` back -- "coach-two.com"
    // appears in a message shown to somebody who has nothing to do with it.
    listDomainsImpl = () =>
      Promise.resolve({ ok: true, domains: ["send.darrenjpaul.com", "mail.coach-two.com", "coach-three.io"] })
    const res = await PATCH(req({ settings: { sender_email: "noreply@darrenjpaul.com" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    // Still useful: it names the subdomain the address should have been on.
    expect(body.error).toContain("send.darrenjpaul.com")
    // And nothing else from the account.
    expect(body.error).not.toContain("coach-two")
    expect(body.error).not.toContain("coach-three")
  })

  it("says so plainly when nothing in the account relates to what was typed", async () => {
    // MUTANT: naming a substitute anyway (e.g. the first verified domain).
    // "Use an address on mail.coach-two.com" is both a disclosure and advice
    // this admin cannot act on.
    listDomainsImpl = () => Promise.resolve({ ok: true, domains: ["mail.coach-two.com"] })
    const res = await PATCH(req({ settings: { sender_email: "noreply@brand-new.com" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/brand-new\.com.*not verified/i)
    expect(body.error).not.toContain("coach-two")
    expect(body.error).toMatch(/verify that domain at resend/i)
  })

  it("accepts a sender_email whose exact domain is verified", async () => {
    listDomainsImpl = () => Promise.resolve({ ok: true, domains: ["send.darrenjpaul.com"] })
    const res = await PATCH(req({ settings: { sender_email: "noreply@send.darrenjpaul.com" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    expect(res.status).toBe(200)
    expect(settingsCalls).toHaveLength(1)
  })

  it("always allows clearing the field, without asking Resend -- MUTANT: checking '' against the verified list would 400 every attempt to clear sender_email", async () => {
    const res = await PATCH(req({ settings: { sender_email: "" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(settingsCalls).toHaveLength(1)
    expect(listDomainsCalls).toBe(0)
  })

  it("fails closed and writes nothing when Resend cannot be asked right now", async () => {
    listDomainsImpl = () => Promise.resolve({ ok: false, reason: "api_error" })
    const res = await PATCH(req({ settings: { sender_email: "noreply@send.darrenjpaul.com" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/could not confirm/i)
    expect(settingsCalls).toHaveLength(0)
  })

  it("fails closed with the not-configured message when Resend has no API key, and writes nothing -- this is the seam review round 1's finding 1 lives in: the route must render THIS message for reason:no_api_key, distinct from the api_error message above", async () => {
    listDomainsImpl = () => Promise.resolve({ ok: false, reason: "no_api_key" })
    const res = await PATCH(req({ settings: { sender_email: "noreply@send.darrenjpaul.com" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/not configured on this server/i)
    expect(settingsCalls).toHaveLength(0)
  })

  it("presence control: never calls listVerifiedSenderDomains when the patch doesn't touch sender_email", async () => {
    // Without this control, the four tests above could be passing because
    // listVerifiedSenderDomains runs (and is mocked permissively) on every
    // request, not because the route gates on sender_email's presence.
    const res = await PATCH(req({ settings: { display_name: "New Name" } }), {
      params: Promise.resolve({ id: "bbb" }),
    })
    expect(res.status).toBe(200)
    expect(listDomainsCalls).toBe(0)
  })
})
