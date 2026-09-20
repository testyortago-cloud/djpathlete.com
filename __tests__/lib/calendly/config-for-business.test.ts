// @vitest-environment node
//
// The property under test is WHOSE CALENDAR ANSWERS. `readCalendlyConfig()`
// knows exactly one Calendly account — the platform's — so every assertion
// here names the value it expects rather than merely checking that a config
// came back: a test that "a config was returned" passes just as happily when
// one coach's availability is answered from another coach's calendar.
//
// The platform's env vars are stubbed to values that are OBVIOUSLY not the
// coach's, so the connected case cannot accidentally pass on the fallback.
//
// SINCE G19b THE FALLBACK IS THE PLATFORM'S ALONE, and that is why the
// "falls back" cases below run against PLATFORM_BUSINESS while an identically
// shaped OTHER_BUSINESS gets nothing. They used to run against a business that
// was not the platform and assert it received the platform's calendar — which
// is exactly the cross-tenant leak this row closed, written down as an
// expectation. Each pair is kept together deliberately: the platform case is
// the presence control for the refusal beside it, because "returns null" would
// pass just as well for a function that had stopped resolving anything at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import type { CoachCalendarConnection } from "@/types/database"

const getPrimaryBookingHostId = vi.fn()
const getCoachCalendarConnection = vi.fn()
const accessTokenForConnection = vi.fn()

vi.mock("@/lib/db/booking-hosts", () => ({
  getPrimaryBookingHostId: (...args: unknown[]) => getPrimaryBookingHostId(...args),
}))
vi.mock("@/lib/db/coach-calendar-connections", () => ({
  getCoachCalendarConnection: (...args: unknown[]) => getCoachCalendarConnection(...args),
}))
vi.mock("@/lib/calendly/credentials", () => ({
  accessTokenForConnection: (...args: unknown[]) => accessTokenForConnection(...args),
}))

import { calendlyBookingOfferForBusiness, calendlyConfigForBusiness } from "@/lib/calendly/config-for-business"

const BUSINESS = "11111111-1111-1111-1111-111111111111"
const HOST = "22222222-2222-2222-2222-222222222222"

/** The one business the environment's single Calendly account legitimately describes. */
const PLATFORM_BUSINESS = "00000000-0000-0000-0000-000000000001"
/** Any other coach. Same shape, same reads — different answer, and that is the point. */
const OTHER_BUSINESS = BUSINESS

/** The platform's single account — what `readCalendlyConfig()` answers with. */
const PLATFORM = {
  token: "platform-token",
  eventType: "https://api.calendly.com/event_types/platform",
  schedulingUrl: "https://calendly.com/platform/consult",
}

function connectionRow(overrides: Partial<CoachCalendarConnection> = {}): CoachCalendarConnection {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    business_id: BUSINESS,
    host_id: HOST,
    provider: "calendly",
    status: "connected",
    credentials: { access_token: "stored", refresh_token: "stored-refresh" },
    calendly_user_uri: "https://api.calendly.com/users/coach",
    calendly_organization_uri: "https://api.calendly.com/organizations/coach",
    calendly_role: null,
    granted_scopes: [],
    event_type_uri: "https://api.calendly.com/event_types/coach",
    scheduling_url: "https://calendly.com/coach/consult",
    webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/abc",
    webhook_state: "active",
    webhook_checked_at: null,
    access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    conflict_check_confirmed_at: null,
    last_refresh_at: null,
    last_error: null,
    connected_by: null,
    connected_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once implementation that
  // survives a test boundary misattributes the next test's failure.
  vi.resetAllMocks()
  vi.stubEnv("CALENDLY_API_TOKEN", PLATFORM.token)
  vi.stubEnv("CALENDLY_EVENT_TYPE_URI", PLATFORM.eventType)
  vi.stubEnv("CALENDLY_SCHEDULING_URL", PLATFORM.schedulingUrl)
  vi.stubEnv("CALENDLY_API_BASE", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("calendlyConfigForBusiness", () => {
  it("answers from the business's OWN connection — its token, its event type, its page", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow())
    accessTokenForConnection.mockResolvedValue("coach-token-fresh")

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(config).toEqual({
      apiToken: "coach-token-fresh",
      eventTypeUri: "https://api.calendly.com/event_types/coach",
      schedulingUrl: "https://calendly.com/coach/consult",
      apiBase: "https://api.calendly.com",
    })
    // Not the platform's, on any of the three.
    expect(config?.apiToken).not.toBe(PLATFORM.token)
    expect(config?.eventTypeUri).not.toBe(PLATFORM.eventType)
    expect(config?.schedulingUrl).not.toBe(PLATFORM.schedulingUrl)
  })

  it("takes the token through the refresher, so an expired one is renewed before it is handed out", async () => {
    const row = connectionRow({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(row)
    accessTokenForConnection.mockResolvedValue("refreshed-token")

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(accessTokenForConnection).toHaveBeenCalledTimes(1)
    expect(accessTokenForConnection).toHaveBeenCalledWith(row)
    expect(config?.apiToken).toBe("refreshed-token")
  })

  it("falls back to the environment for THE PLATFORM when it has no calendar row at all", async () => {
    getPrimaryBookingHostId.mockResolvedValue(null)

    const config = await calendlyConfigForBusiness(PLATFORM_BUSINESS)

    expect(config).toEqual({
      apiToken: PLATFORM.token,
      eventTypeUri: PLATFORM.eventType,
      schedulingUrl: PLATFORM.schedulingUrl,
      apiBase: "https://api.calendly.com",
    })
    expect(getCoachCalendarConnection).not.toHaveBeenCalled()
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("gives ANOTHER coach with no calendar row nothing — never the platform's account", async () => {
    getPrimaryBookingHostId.mockResolvedValue(null)

    await expect(calendlyConfigForBusiness(OTHER_BUSINESS)).resolves.toBeNull()
  })

  it("falls back to the environment for THE PLATFORM when it has connected no Calendly account", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(null)

    const config = await calendlyConfigForBusiness(PLATFORM_BUSINESS)

    expect(config?.apiToken).toBe(PLATFORM.token)
    expect(config?.eventTypeUri).toBe(PLATFORM.eventType)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("gives ANOTHER coach who has connected nothing nothing — never the platform's account", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(null)

    await expect(calendlyConfigForBusiness(OTHER_BUSINESS)).resolves.toBeNull()
  })

  it("falls back to the environment for THE PLATFORM on a disconnected row", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(
      connectionRow({ status: "not_connected", event_type_uri: null, scheduling_url: null }),
    )

    const config = await calendlyConfigForBusiness(PLATFORM_BUSINESS)

    expect(config?.eventTypeUri).toBe(PLATFORM.eventType)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("gives ANOTHER coach who disconnected their account nothing — a removed calendar is not the platform's", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(
      connectionRow({ status: "not_connected", event_type_uri: null, scheduling_url: null }),
    )

    await expect(calendlyConfigForBusiness(OTHER_BUSINESS)).resolves.toBeNull()
  })

  it("falls back for THE PLATFORM when its connection has not chosen a consult yet", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ event_type_uri: null, scheduling_url: null }))

    const config = await calendlyConfigForBusiness(PLATFORM_BUSINESS)

    expect(config?.apiToken).toBe(PLATFORM.token)
    expect(config?.eventTypeUri).toBe(PLATFORM.eventType)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("gives ANOTHER coach who has not chosen a consult nothing — it cannot answer an availability question", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ event_type_uri: null, scheduling_url: null }))

    await expect(calendlyConfigForBusiness(OTHER_BUSINESS)).resolves.toBeNull()
  })

  it("returns null when the platform has no Calendly of its own either", async () => {
    vi.stubEnv("CALENDLY_API_TOKEN", "")
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(null)

    await expect(calendlyConfigForBusiness(PLATFORM_BUSINESS)).resolves.toBeNull()
  })

  it("THROWS when the host read fails — it must not fall back to another calendar", async () => {
    getPrimaryBookingHostId.mockRejectedValue(new Error("getPrimaryBookingHostId failed (57014): timeout"))

    await expect(calendlyConfigForBusiness(BUSINESS)).rejects.toThrow(/getPrimaryBookingHostId failed/)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("THROWS when the connection read fails — it must not fall back to another calendar", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockRejectedValue(
      new Error("getCoachCalendarConnection failed (57014): canceling statement"),
    )

    await expect(calendlyConfigForBusiness(BUSINESS)).rejects.toThrow(/getCoachCalendarConnection failed/)
  })

  it("answers NO TIMES when the connection's token cannot be renewed — and still not from another calendar", async () => {
    // This used to assert a throw. The property it was protecting is that a
    // coach whose Calendly access has lapsed must not have their availability
    // answered out of somebody else's diary, and that still holds exactly:
    // `config` is null, so no times are read at all. What changed is that the
    // failure no longer takes their own booking page down with it — see the
    // token's own try/catch for why "whose calendar is this?" and "can I read
    // their times?" are different failed reads.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ status: "needs_reconnect" }))
    accessTokenForConnection.mockRejectedValue(new Error("Calendly token refresh failed: invalid_grant"))

    await expect(calendlyConfigForBusiness(BUSINESS)).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid_grant"))
    warn.mockRestore()
  })

  it("answers nothing for a connection that chose a meeting but recorded no public page", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ scheduling_url: null }))

    const config = await calendlyConfigForBusiness(BUSINESS)

    // Null, NOT the platform's config: this business has its own connection,
    // so answering from the platform's calendar would be the wrong coach.
    expect(config).toBeNull()
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("honours CALENDLY_API_BASE, which the acceptance script points at a local fixture server", async () => {
    vi.stubEnv("CALENDLY_API_BASE", "http://127.0.0.1:4599")
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow())
    accessTokenForConnection.mockResolvedValue("coach-token-fresh")

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(config?.apiBase).toBe("http://127.0.0.1:4599")
  })
})

// The offer is the two halves that fail independently: real times, and a page
// to click. `calendlyConfigForBusiness` can only express the first, which is
// why a half-configured install needed the wider shape — the owner pastes the
// public booking page long before they paste an API token.
describe("calendlyBookingOfferForBusiness", () => {
  it("gives a connected coach both halves, both their own", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow())
    accessTokenForConnection.mockResolvedValue("coach-token-fresh")

    const offer = await calendlyBookingOfferForBusiness(OTHER_BUSINESS)

    expect(offer.schedulingUrl).toBe("https://calendly.com/coach/consult")
    expect(offer.config?.eventTypeUri).toBe("https://api.calendly.com/event_types/coach")
    expect(offer.schedulingUrl).not.toBe(PLATFORM.schedulingUrl)
  })

  it("gives THE PLATFORM a page but no times when only the public page is set", async () => {
    // readCalendlyConfig() needs all three; the page alone still buys a link.
    vi.stubEnv("CALENDLY_API_TOKEN", "")
    getPrimaryBookingHostId.mockResolvedValue(null)

    const offer = await calendlyBookingOfferForBusiness(PLATFORM_BUSINESS)

    expect(offer.config).toBeNull()
    expect(offer.schedulingUrl).toBe(PLATFORM.schedulingUrl)
  })

  it("gives ANOTHER coach neither half from that same half-configured environment", async () => {
    vi.stubEnv("CALENDLY_API_TOKEN", "")
    getPrimaryBookingHostId.mockResolvedValue(null)

    const offer = await calendlyBookingOfferForBusiness(OTHER_BUSINESS)

    expect(offer).toEqual({ config: null, schedulingUrl: null })
  })

  it("warns whenever it hands over the environment, so the ramp's lifetime is visible in the logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getPrimaryBookingHostId.mockResolvedValue(null)

    await calendlyBookingOfferForBusiness(PLATFORM_BUSINESS)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CALENDLY_SCHEDULING_URL"))
    warn.mockRestore()
  })

  it("does NOT warn when there is no environment to fall back to — that is unconfigured, not a ramp", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("CALENDLY_API_TOKEN", "")
    vi.stubEnv("CALENDLY_SCHEDULING_URL", "")
    getPrimaryBookingHostId.mockResolvedValue(null)

    await calendlyBookingOfferForBusiness(PLATFORM_BUSINESS)

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("keeps a connected coach's OWN booking page when only the token fails", async () => {
    // The two halves fail independently, which is this type's whole reason for
    // existing. A dead grant or one 503 from the token endpoint must not
    // replace a perfectly good stored booking page with the generic path.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow())
    accessTokenForConnection.mockRejectedValue(new Error("Calendly token refresh failed: invalid_grant"))

    const offer = await calendlyBookingOfferForBusiness(OTHER_BUSINESS)

    expect(offer.config).toBeNull()
    expect(offer.schedulingUrl).toBe("https://calendly.com/coach/consult")
    // Theirs, not the platform's — the fallback must not fire here at all.
    expect(offer.schedulingUrl).not.toBe(PLATFORM.schedulingUrl)
    warn.mockRestore()
  })

  it("does the same for a TRANSIENT token failure, which is not a dead grant", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow())
    accessTokenForConnection.mockRejectedValue(new Error("Calendly is unreachable (network)"))

    const offer = await calendlyBookingOfferForBusiness(OTHER_BUSINESS)

    expect(offer).toEqual({ config: null, schedulingUrl: "https://calendly.com/coach/consult" })
    warn.mockRestore()
  })

  it("answers neither half for a connection that chose a meeting but recorded no public page", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ scheduling_url: null }))

    const offer = await calendlyBookingOfferForBusiness(PLATFORM_BUSINESS)

    // Null even for the PLATFORM: a business with its own connection has
    // demonstrably answered the "whose calendar" question, and a broken row is
    // not licence to re-answer it from the environment.
    expect(offer).toEqual({ config: null, schedulingUrl: null })
  })
})
