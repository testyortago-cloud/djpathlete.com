// @vitest-environment node
//
// The two routes a coach connects their own Calendly through.
//
// NINE NEGATIVE CASES AND ONE POSITIVE CONTROL. Every rejection below asserts
// that `connectCoachCalendar` was called ZERO times -- and all nine of those
// assertions pass just as well against a callback route that is broken and
// never writes at all. The control ("a fully valid callback") is what makes
// them mean something: it pins one write, with the business and host taken
// from the SIGNED STATE rather than from anything the browser could edit.
//
// THE NONCE COOKIE IS NOT REDUNDANT WITH THE SIGNATURE. A valid HMAC proves
// WE minted the state; only the cookie proves THIS BROWSER asked for it. Two
// separate cases below pin that: a signed, in-date, otherwise perfect state
// with no nonce cookie, and the same with a nonce cookie that disagrees.
//
// BOTH COOKIES ARE CLEARED ON EVERY EXIT PATH. A verifier that outlives its
// exchange is a reusable one, so the assertion runs on the failures too, not
// only on success.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// vi.hoisted so the class exists by the time the mock factory naming it runs --
// factories are hoisted above this file's own top-level statements.
const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  return { NoAccessibleBusinessError }
})

const connectCalls: Array<Record<string, unknown>> = []
let connectImpl: (input: Record<string, unknown>) => Promise<unknown> = async (input) => ({
  id: "conn-1",
  ...input,
})
const scopeCalls: Array<unknown[]> = []
vi.mock("@/lib/db/coach-calendar-connections", () => ({
  connectCoachCalendar: (input: Record<string, unknown>) => {
    connectCalls.push(input)
    return connectImpl(input)
  },
  recordCoachCalendarGrantedScopes: (...args: unknown[]) => {
    scopeCalls.push(args)
    return Promise.resolve()
  },
}))

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; token_type: string }
const exchangeCalls: Array<Record<string, unknown>> = []
let exchangeImpl: () => Promise<TokenResponse> = async () => ({
  access_token: "access-token-1",
  refresh_token: "refresh-token-1",
  expires_in: 7200,
  token_type: "Bearer",
})
vi.mock("@/lib/calendly/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendly/oauth")>()
  return {
    ...actual,
    exchangeCodeForTokens: (input: Record<string, unknown>) => {
      exchangeCalls.push(input)
      return exchangeImpl()
    },
  }
})

const identityCalls: Array<Record<string, unknown>> = []
let identityImpl: () => Promise<unknown> = async () => ({
  uri: "https://api.calendly.com/users/U1",
  name: "Coach Nadia",
  email: "nadia@example.com",
  schedulingUrl: "https://calendly.com/nadia",
  organizationUri: "https://api.calendly.com/organizations/O1",
})
const probeCalls: Record<string, unknown>[] = []
let probeImpl: () => Promise<{ granted: string[]; missing: string[] }> = async () => ({
  granted: ["event_types:read", "scheduled_events:read"],
  missing: [],
})

vi.mock("@/lib/calendly/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendly/account")>()
  return {
    ...actual,
    fetchIdentity: (input: Record<string, unknown>) => {
      identityCalls.push(input)
      return identityImpl()
    },
    // Defaults to "everything we need survived the install", so the existing
    // happy-path tests keep testing what they were written to test. The
    // refusal is exercised explicitly below.
    probeGrantedScopes: (input: Record<string, unknown>) => {
      probeCalls.push(input)
      return probeImpl()
    },
  }
})

let tenantImpl: () => Promise<unknown> = async () => ({
  businessId: "biz-1",
  choices: [{ id: "biz-1", name: "B", slug: "b" }],
  isOperator: false,
})
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => tenantImpl(),
  NoAccessibleBusinessError,
}))

let hostImpl: () => Promise<string | null> = async () => "host-1"
vi.mock("@/lib/db/booking-hosts", () => ({
  getPrimaryBookingHostId: () => hostImpl(),
}))

let session: unknown = { user: { id: "user-1", role: "admin" } }
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))

const auditCalls: Array<Record<string, unknown>> = []
vi.mock("@/lib/audit/record", () => ({
  recordAudit: (input: Record<string, unknown>) => {
    auditCalls.push(input)
    return Promise.resolve()
  },
}))

// Neither route may reach the database directly. A call through this mock is
// the failure this line exists to catch, so it throws.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    throw new Error("a calendar OAuth route reached the database directly — it must not")
  },
}))

import { signState, verifyState, CALENDLY_STATE_TTL_SECONDS } from "@/lib/calendly/oauth"
import { GET as CONNECT } from "@/app/api/admin/bookings/calendar/connect/route"
import { GET as CALLBACK } from "@/app/api/admin/bookings/calendar/callback/route"

const SECRET = "test-nextauth-secret"
const ORIGIN = "http://localhost:3050"
const NONCE_COOKIE = "calendly_oauth_nonce"
const VERIFIER_COOKIE = "calendly_oauth_verifier"

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function mintState(overrides: Partial<Record<string, unknown>> = {}, secret = SECRET) {
  return signState(
    {
      business_id: "biz-1",
      host_id: "host-1",
      user_id: "user-1",
      nonce: "nonce-abc",
      iat: nowSeconds(),
      ...overrides,
    } as Parameters<typeof signState>[0],
    secret,
  )
}

function callbackRequest(opts: {
  code?: string | null
  state?: string | null
  error?: string
  nonceCookie?: string | null
  verifierCookie?: string | null
}) {
  const url = new URL(`${ORIGIN}/api/admin/bookings/calendar/callback`)
  if (opts.code !== null) url.searchParams.set("code", opts.code ?? "the-code")
  if (opts.state !== null && opts.state !== undefined) url.searchParams.set("state", opts.state)
  if (opts.error) url.searchParams.set("error", opts.error)

  const jar: string[] = []
  if (opts.nonceCookie !== null) jar.push(`${NONCE_COOKIE}=${opts.nonceCookie ?? "nonce-abc"}`)
  if (opts.verifierCookie !== null) jar.push(`${VERIFIER_COOKIE}=${opts.verifierCookie ?? "verifier-xyz"}`)

  return new Request(url.toString(), {
    method: "GET",
    headers: jar.length > 0 ? { cookie: jar.join("; ") } : {},
  })
}

function connectRequest() {
  return new Request(`${ORIGIN}/api/admin/bookings/calendar/connect`, { method: "GET" })
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie()
}

/**
 * Both cookies present in Set-Cookie with an EMPTY value — i.e. cleared.
 *
 * THE PATH IS PART OF THE CLEAR, NOT DECORATION. A browser matches a deletion
 * to the cookie it deletes by name AND path, so a clear emitted at the default
 * path ("/api/admin/bookings/calendar/callback", the request's own directory)
 * leaves the real, "/api/admin/bookings/calendar"-scoped cookies sitting in
 * the jar — while a Set-Cookie header with an empty value is still right
 * there in the response for a test to be satisfied by.
 */
function expectCookiesCleared(response: Response) {
  const jar = setCookies(response)
  for (const name of [NONCE_COOKIE, VERIFIER_COOKIE]) {
    const entry = jar.find((c) => c.startsWith(`${name}=`))
    expect(entry, `${name} was not in Set-Cookie`).toBeDefined()
    expect(entry!.startsWith(`${name}=;`), `${name} was set to a non-empty value: ${entry}`).toBe(true)
    expect(entry, `${name} was cleared at the wrong path: ${entry}`).toMatch(
      /(?:^|;\s*)Path=\/api\/admin\/bookings\/calendar(?:;|$)/i,
    )
  }
}

function redirectTarget(response: Response): URL {
  const location = response.headers.get("location")
  expect(location, "no Location header").toBeTruthy()
  return new URL(location!)
}

beforeEach(() => {
  connectCalls.length = 0
  scopeCalls.length = 0
  exchangeCalls.length = 0
  identityCalls.length = 0
  auditCalls.length = 0
  connectImpl = async (input) => ({ id: "conn-1", ...input })
  exchangeImpl = async () => ({
    access_token: "access-token-1",
    refresh_token: "refresh-token-1",
    expires_in: 7200,
    token_type: "Bearer",
  })
  identityImpl = async () => ({
    uri: "https://api.calendly.com/users/U1",
    name: "Coach Nadia",
    email: "nadia@example.com",
    schedulingUrl: "https://calendly.com/nadia",
    organizationUri: "https://api.calendly.com/organizations/O1",
  })
  probeCalls.length = 0
  probeImpl = async () => ({ granted: ["event_types:read", "scheduled_events:read"], missing: [] })
  tenantImpl = async () => ({
    businessId: "biz-1",
    choices: [{ id: "biz-1", name: "B", slug: "b" }],
    isOperator: false,
  })
  hostImpl = async () => "host-1"
  session = { user: { id: "user-1", role: "admin" } }

  vi.stubEnv("NEXTAUTH_SECRET", SECRET)
  vi.stubEnv("NEXTAUTH_URL", ORIGIN)
  vi.stubEnv("CALENDLY_CLIENT_ID", "client-id-1")
  vi.stubEnv("CALENDLY_CLIENT_SECRET", "client-secret-1")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /api/admin/bookings/calendar/connect", () => {
  it("redirects to Calendly with PKCE S256 and a signed state carrying the server-side tenant", async () => {
    const response = await CONNECT(connectRequest())

    expect(response.status).toBe(307)
    const target = redirectTarget(response)
    expect(target.host).toBe("auth.calendly.com")
    expect(target.pathname).toBe("/oauth/authorize")
    expect(target.searchParams.get("code_challenge_method")).toBe("S256")
    expect(target.searchParams.get("code_challenge")).toBeTruthy()
    expect(target.searchParams.get("client_id")).toBe("client-id-1")
    expect(target.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/admin/bookings/calendar/callback`)

    const state = target.searchParams.get("state")
    expect(state).toBeTruthy()
    const claim = verifyState(state!, SECRET)
    expect(claim).not.toBeNull()
    expect(claim!.business_id).toBe("biz-1")
    expect(claim!.host_id).toBe("host-1")
    expect(claim!.user_id).toBe("user-1")
    expect(claim!.nonce.length).toBeGreaterThan(0)
  })

  it("sets both cookies httpOnly, lax, path-scoped, with a 600s life", async () => {
    const response = await CONNECT(connectRequest())
    const jar = setCookies(response)

    for (const name of [NONCE_COOKIE, VERIFIER_COOKIE]) {
      const entry = jar.find((c) => c.startsWith(`${name}=`))
      expect(entry, `${name} missing`).toBeDefined()
      expect(entry).toMatch(/HttpOnly/i)
      expect(entry).toMatch(/Max-Age=600\b/)
      expect(entry).toMatch(/Path=\/api\/admin\/bookings\/calendar/)
      expect(entry).toMatch(/SameSite=lax/i)
    }
  })

  it("puts the same nonce in the cookie as in the signed state", async () => {
    const response = await CONNECT(connectRequest())
    const state = redirectTarget(response).searchParams.get("state")!
    const claim = verifyState(state, SECRET)!

    const cookie = setCookies(response).find((c) => c.startsWith(`${NONCE_COOKIE}=`))!
    expect(cookie.startsWith(`${NONCE_COOKIE}=${claim.nonce};`)).toBe(true)
  })

  it("refuses a caller the tenant resolver rejects, and starts no flow", async () => {
    tenantImpl = async () => {
      throw new NoAccessibleBusinessError()
    }
    const response = await CONNECT(connectRequest())
    expect(response.status).toBe(403)
    expect(setCookies(response)).toHaveLength(0)
  })

  it("refuses when the business has no booking host to attach a calendar to", async () => {
    hostImpl = async () => null
    const response = await CONNECT(connectRequest())
    expect(response.status).toBe(409)
    expect(setCookies(response)).toHaveLength(0)
  })

  // "Connect Calendly" is an <a>, so whatever this route answers is what the
  // coach LOOKS AT. A JSON body is a blank page of braces — and an install
  // with no CALENDLY_* variables is what production is today, so this is the
  // first thing a coach would see, not a corner case.
  it("an unconfigured server sends the coach back to the screen, not to raw JSON", async () => {
    vi.stubEnv("CALENDLY_CLIENT_ID", "")

    const response = await CONNECT(connectRequest())

    expect(response.status).toBe(307)
    const target = redirectTarget(response)
    expect(target.pathname).toBe("/admin/bookings/calendar")
    // `reason=config` is the word the page's own flash already reads: "Connecting
    // Calendly is not set up on this site yet. Ask the person who set up your
    // account to finish it."
    expect(target.searchParams.get("calendar")).toBe("error")
    expect(target.searchParams.get("reason")).toBe("config")
    // No flow was started, so there is no verifier left behind to reuse.
    expect(setCookies(response)).toHaveLength(0)
  })

  it("a missing NEXTAUTH_SECRET lands on the same screen — the redirect does not need it", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "")

    const response = await CONNECT(connectRequest())

    expect(response.status).toBe(307)
    expect(redirectTarget(response).searchParams.get("reason")).toBe("config")
    expect(setCookies(response)).toHaveLength(0)
  })

  it("a missing NEXTAUTH_URL still produces a usable target — it is built from the request", async () => {
    // NEXTAUTH_URL is one of the values readCalendlyConnectConfig needs, so it
    // is missing exactly when this redirect has to be built without it.
    vi.stubEnv("NEXTAUTH_URL", "")

    const response = await CONNECT(connectRequest())

    expect(response.status).toBe(307)
    const target = redirectTarget(response)
    expect(target.origin).toBe(ORIGIN)
    expect(target.pathname).toBe("/admin/bookings/calendar")
  })
})

describe("GET /api/admin/bookings/calendar/callback — every rejection writes nothing", () => {
  it("state absent → reason=state", async () => {
    const response = await CALLBACK(callbackRequest({ state: null }))
    const target = redirectTarget(response)
    expect(target.pathname).toBe("/admin/bookings/calendar")
    expect(target.searchParams.get("calendar")).toBe("error")
    expect(target.searchParams.get("reason")).toBe("state")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("state signed with a different secret → reason=state", async () => {
    const response = await CALLBACK(callbackRequest({ state: mintState({}, "some-other-secret") }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("state")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("state older than the 600s TTL → reason=state", async () => {
    const stale = mintState({ iat: nowSeconds() - (CALENDLY_STATE_TTL_SECONDS + 5) })
    const response = await CALLBACK(callbackRequest({ state: stale }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("state")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("nonce cookie missing → reason=state (a signature is not a browser)", async () => {
    const response = await CALLBACK(callbackRequest({ state: mintState(), nonceCookie: null }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("state")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("nonce cookie present but different from the state's nonce → reason=state", async () => {
    const response = await CALLBACK(callbackRequest({ state: mintState(), nonceCookie: "some-other-nonce" }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("state")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("verifier cookie missing → reason=pkce", async () => {
    const response = await CALLBACK(callbackRequest({ state: mintState(), verifierCookie: null }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("pkce")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("?error=access_denied → calendar=declined", async () => {
    const response = await CALLBACK(callbackRequest({ state: mintState(), error: "access_denied" }))
    const target = redirectTarget(response)
    expect(target.searchParams.get("calendar")).toBe("declined")
    expect(target.searchParams.get("reason")).toBe("declined")
    expect(connectCalls).toHaveLength(0)
    expect(exchangeCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("token exchange non-200 → reason=exchange", async () => {
    const { CalendlyOAuthError } = await vi.importActual<typeof import("@/lib/calendly/oauth")>("@/lib/calendly/oauth")
    exchangeImpl = async () => {
      throw new CalendlyOAuthError("http", "Calendly token exchange answered HTTP 400", 400)
    }
    const response = await CALLBACK(callbackRequest({ state: mintState() }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("exchange")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("GET /users/me non-200 → reason=identity", async () => {
    const { CalendlyAccountError } =
      await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
    identityImpl = async () => {
      throw new CalendlyAccountError("http", "GET /users/me answered 401", 401)
    }
    const response = await CALLBACK(callbackRequest({ state: mintState() }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("identity")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("refuses a caller the tenant resolver rejects", async () => {
    tenantImpl = async () => {
      throw new NoAccessibleBusinessError()
    }
    const response = await CALLBACK(callbackRequest({ state: mintState() }))
    expect(response.status).toBe(403)
    expect(connectCalls).toHaveLength(0)
    // "Every exit path" means every one, not every redirect: a refusal that
    // left the verifier alive would leave a reusable one.
    expectCookiesCleared(response)
  })

  it("refuses a state naming a business this caller may not act on", async () => {
    tenantImpl = async () => ({
      businessId: "biz-somebody-else",
      choices: [{ id: "biz-somebody-else", name: "X", slug: "x" }],
      isOperator: false,
    })
    const response = await CALLBACK(callbackRequest({ state: mintState() }))
    expect(response.status).toBe(403)
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })

  it("refuses when the signed state was minted for a different signed-in user", async () => {
    session = { user: { id: "someone-else", role: "admin" } }
    const response = await CALLBACK(callbackRequest({ state: mintState() }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("state")
    expect(connectCalls).toHaveLength(0)
    expectCookiesCleared(response)
  })
})

describe("GET /api/admin/bookings/calendar/callback — the positive control", () => {
  it("writes exactly one connection, with the tenant taken from the SIGNED STATE", async () => {
    // The resolver's SELECTED business is not the one the state names — which
    // is exactly what happens when a coach with two businesses flips the
    // business cookie mid-flow. The cookie is browser-editable; the signed
    // state is not, so the state wins and the connection lands where the flow
    // actually started.
    tenantImpl = async () => ({
      businessId: "biz-2",
      choices: [
        { id: "biz-2", name: "Second", slug: "second" },
        { id: "biz-1", name: "B", slug: "b" },
      ],
      isOperator: false,
    })
    // AND the host the resolver would hand back is a DIFFERENT one. Both
    // halves of the tenant have to be discriminated: while this returned
    // "host-1" the assertion below passed just as well against a route that
    // took `access.hostId`, and `host_id` is half of what the signed state
    // exists to carry.
    hostImpl = async () => "host-2"

    const response = await CALLBACK(callbackRequest({ state: mintState() }))

    const target = redirectTarget(response)
    expect(target.pathname).toBe("/admin/bookings/calendar")
    expect(target.searchParams.get("calendar")).toBe("connected")

    expect(connectCalls).toHaveLength(1)
    expect(connectCalls[0]).toMatchObject({
      businessId: "biz-1",
      hostId: "host-1",
      provider: "calendly",
      calendlyUserUri: "https://api.calendly.com/users/U1",
      calendlyOrganizationUri: "https://api.calendly.com/organizations/O1",
      connectedBy: "user-1",
    })
    expect(connectCalls[0].credentials).toEqual({
      access_token: "access-token-1",
      refresh_token: "refresh-token-1",
    })
    expect(typeof connectCalls[0].accessTokenExpiresAt).toBe("string")

    expectCookiesCleared(response)
  })

  // The 2026-09-05 failure, caught one step earlier. Without this the row is
  // written `connected`, the card looks healthy, and it fails as a 400 when the
  // coach picks their meeting -- by which point nothing on screen says why.
  it("REFUSES to connect when Calendly withheld a scope, and writes NOTHING", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    probeImpl = async () => ({ granted: ["event_types:read"], missing: ["scheduled_events:read"] })

    const res = await CALLBACK(callbackRequest({ state: mintState() }))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get("location")!)
    expect(location.searchParams.get("reason")).toBe("scopes")
    // Naming the scope is the point. A refusal that does not say which
    // permission is missing only moves the confusion earlier.
    expect(location.searchParams.get("missing")).toBe("scheduled_events:read")
    expect(connectCalls).toHaveLength(0)
    err.mockRestore()
  })

  it("records only the scopes the probe PROVED, never the ones we asked for", async () => {
    probeImpl = async () => ({ granted: ["event_types:read", "scheduled_events:read"], missing: [] })

    await CALLBACK(callbackRequest({ state: mintState() }))

    expect(connectCalls).toHaveLength(1)
    expect(scopeCalls).toHaveLength(1)
    expect(scopeCalls[0][2]).toEqual(["event_types:read", "scheduled_events:read"])
  })

  it("sends the verifier cookie on the exchange, and audits the connection", async () => {
    await CALLBACK(callbackRequest({ state: mintState(), verifierCookie: "the-verifier" }))

    expect(exchangeCalls).toHaveLength(1)
    expect(exchangeCalls[0]).toMatchObject({
      code: "the-code",
      verifier: "the-verifier",
      clientId: "client-id-1",
      clientSecret: "client-secret-1",
      redirectUri: `${ORIGIN}/api/admin/bookings/calendar/callback`,
    })
    expect(auditCalls.map((c) => c.action)).toContain("calendar.connected")
  })

  it("a failed database write leaves the coach on the screen with a reason, not a 500", async () => {
    connectImpl = async () => {
      throw new Error("connectCoachCalendar failed (PGRST301): JWT expired")
    }
    const response = await CALLBACK(callbackRequest({ state: mintState() }))
    expect(redirectTarget(response).searchParams.get("reason")).toBe("save")
    expectCookiesCleared(response)
  })
})
