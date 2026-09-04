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

import { calendlyConfigForBusiness } from "@/lib/calendly/config-for-business"

const BUSINESS = "11111111-1111-1111-1111-111111111111"
const HOST = "22222222-2222-2222-2222-222222222222"

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

  it("falls back to the platform's calendar when the business has no calendar row at all", async () => {
    getPrimaryBookingHostId.mockResolvedValue(null)

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(config).toEqual({
      apiToken: PLATFORM.token,
      eventTypeUri: PLATFORM.eventType,
      schedulingUrl: PLATFORM.schedulingUrl,
      apiBase: "https://api.calendly.com",
    })
    expect(getCoachCalendarConnection).not.toHaveBeenCalled()
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("falls back to the platform's calendar when the business has connected no Calendly account", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(null)

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(config?.apiToken).toBe(PLATFORM.token)
    expect(config?.eventTypeUri).toBe(PLATFORM.eventType)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("falls back to the platform's calendar for a disconnected row", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(
      connectionRow({ status: "not_connected", event_type_uri: null, scheduling_url: null }),
    )

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(config?.eventTypeUri).toBe(PLATFORM.eventType)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("falls back when the connection has not chosen its consult yet — it cannot answer an availability question", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ event_type_uri: null, scheduling_url: null }))

    const config = await calendlyConfigForBusiness(BUSINESS)

    expect(config?.apiToken).toBe(PLATFORM.token)
    expect(config?.eventTypeUri).toBe(PLATFORM.eventType)
    expect(accessTokenForConnection).not.toHaveBeenCalled()
  })

  it("returns null when the platform has no Calendly of its own either", async () => {
    vi.stubEnv("CALENDLY_API_TOKEN", "")
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(null)

    await expect(calendlyConfigForBusiness(BUSINESS)).resolves.toBeNull()
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

  it("THROWS when the connection's token cannot be renewed — a dead grant is not 'not configured'", async () => {
    getPrimaryBookingHostId.mockResolvedValue(HOST)
    getCoachCalendarConnection.mockResolvedValue(connectionRow({ status: "needs_reconnect" }))
    accessTokenForConnection.mockRejectedValue(new Error("Calendly token refresh failed: invalid_grant"))

    await expect(calendlyConfigForBusiness(BUSINESS)).rejects.toThrow(/invalid_grant/)
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
