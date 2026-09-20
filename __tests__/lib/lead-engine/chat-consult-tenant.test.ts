// @vitest-environment node
//
// WHOSE CALENDAR DOES THE CHAT OFFER? The inbound half of Calendly has been
// per-tenant since 00240 (`resolveCalendlyTenant` matches a delivery's event
// type against `coach_calendar_connections`); the OUTBOUND half — the times
// the assistant shows a visitor and the page it sends them to — read four
// environment variables naming the platform's own account. One tenant, one
// connection, so the two agreed and nothing was visibly wrong. The day a
// second coach connects, a visitor on coach B's site is shown coach A's free
// times and books into coach A's diary: silent, 200, indistinguishable from
// working.
//
// Every assertion below therefore names the value it expects. "A slots card
// came back" passes just as happily when the slots are the wrong coach's —
// which is the entire failure this file exists to catch. The two businesses
// are given obviously different event types and pages so a leak cannot hide
// behind a shared fixture, and the platform's env vars are stubbed to a third
// set of values so neither coach can accidentally pass on the fallback.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import type { Slot } from "@/lib/calendly/client"
import type { CoachCalendarConnection } from "@/types/database"

// tools.ts imports facts.ts, which imports the Supabase client module. A stray
// query throws rather than reaching anything; the tenant reads below are
// mocked at the DAL, so the real resolution logic still runs.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    throw new Error("book_consult must not open a database client")
  },
}))

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

import { createToolExecutor, CONSULT_PATH } from "@/lib/lead-engine/chat/tools"

/** The platform's own tenant — the one business the env vars legitimately describe. */
const PLATFORM_BUSINESS = "00000000-0000-0000-0000-000000000001"

const COACH_A = {
  businessId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  hostId: "a1111111-1111-1111-1111-111111111111",
  connectionId: "a2222222-2222-2222-2222-222222222222",
  eventType: "https://api.calendly.com/event_types/COACH-A-EVENT",
  page: "https://calendly.com/coach-a/consultation",
  token: "coach-a-token",
}

const COACH_B = {
  businessId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  hostId: "b1111111-1111-1111-1111-111111111111",
  connectionId: "b2222222-2222-2222-2222-222222222222",
  eventType: "https://api.calendly.com/event_types/COACH-B-EVENT",
  page: "https://calendly.com/coach-b/consultation",
  token: "coach-b-token",
}

/** A third set of values, so a fallback to the environment is never mistaken for a coach's own. */
const PLATFORM = {
  token: "platform-token",
  eventType: "https://api.calendly.com/event_types/PLATFORM-EVENT",
  page: "https://calendly.com/platform/consultation",
}

const NOW = () => new Date("2026-09-07T12:00:00Z")

function slotsOn(page: string): Slot[] {
  return [
    {
      startAt: "2026-09-08T14:00:00.000000Z",
      schedulingUrl: `${page}/2026-09-08T14:00:00Z`,
      inviteesRemaining: 1,
    },
  ]
}

function connectionFor(coach: typeof COACH_A): CoachCalendarConnection {
  return {
    id: coach.connectionId,
    business_id: coach.businessId,
    host_id: coach.hostId,
    provider: "calendly",
    status: "connected",
    credentials: { access_token: "stored", refresh_token: "stored-refresh" },
    calendly_user_uri: `https://api.calendly.com/users/${coach.connectionId}`,
    calendly_organization_uri: "https://api.calendly.com/organizations/org",
    calendly_role: null,
    granted_scopes: [],
    event_type_uri: coach.eventType,
    scheduling_url: coach.page,
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
  } as CoachCalendarConnection
}

/** Route both coaches' reads through one pair of mocks, keyed the way the real DAL keys them. */
function wireBothCoaches(): void {
  getPrimaryBookingHostId.mockImplementation(async (businessId: string) => {
    if (businessId === COACH_A.businessId) return COACH_A.hostId
    if (businessId === COACH_B.businessId) return COACH_B.hostId
    return null
  })
  getCoachCalendarConnection.mockImplementation(async (hostId: string) => {
    if (hostId === COACH_A.hostId) return connectionFor(COACH_A)
    if (hostId === COACH_B.hostId) return connectionFor(COACH_B)
    return null
  })
  accessTokenForConnection.mockImplementation(async (row: CoachCalendarConnection) =>
    row.host_id === COACH_A.hostId ? COACH_A.token : COACH_B.token,
  )
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once implementation that
  // survives a test boundary misattributes the next test's failure.
  vi.resetAllMocks()
  vi.stubEnv("CALENDLY_API_TOKEN", PLATFORM.token)
  vi.stubEnv("CALENDLY_EVENT_TYPE_URI", PLATFORM.eventType)
  vi.stubEnv("CALENDLY_SCHEDULING_URL", PLATFORM.page)
  vi.stubEnv("CALENDLY_API_BASE", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("book_consult answers from the CONVERSATION'S OWN tenant", () => {
  it("gives two connected businesses their own event type, their own token and their own page", async () => {
    wireBothCoaches()

    const availabilityA = vi.fn(async () => slotsOn(COACH_A.page))
    const exA = createToolExecutor({ businessId: COACH_A.businessId, availability: availabilityA, now: NOW })
    await exA.execute("book_consult", {})

    const availabilityB = vi.fn(async () => slotsOn(COACH_B.page))
    const exB = createToolExecutor({ businessId: COACH_B.businessId, availability: availabilityB, now: NOW })
    await exB.execute("book_consult", {})

    // The availability read is the question "when is THIS coach free?".
    expect(availabilityA).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypeUri: COACH_A.eventType, apiToken: COACH_A.token }),
    )
    expect(availabilityB).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypeUri: COACH_B.eventType, apiToken: COACH_B.token }),
    )

    // And the card is the page the visitor is actually sent to.
    const cardA = exA.outcome().cards.find((c) => c.kind === "slots")
    const cardB = exB.outcome().cards.find((c) => c.kind === "slots")
    expect(cardA?.kind === "slots" && cardA.href).toContain(COACH_A.page)
    expect(cardB?.kind === "slots" && cardB.href).toContain(COACH_B.page)

    // Neither coach is shown the other's calendar, nor the platform's.
    expect(cardA?.kind === "slots" && cardA.href).not.toContain("coach-b")
    expect(cardB?.kind === "slots" && cardB.href).not.toContain("coach-a")
    expect(cardA?.kind === "slots" && cardA.href).not.toContain("platform")
    expect(cardB?.kind === "slots" && cardB.href).not.toContain("platform")
  })

  it("offers the plain consult path to a business with no connection — never the platform's calendar", async () => {
    // The env vars ARE set (see beforeEach). Pre-G19b this business would have
    // been handed the platform's page and the platform's free times.
    getPrimaryBookingHostId.mockResolvedValue(null)
    const availability = vi.fn(async () => slotsOn(PLATFORM.page))

    const ex = createToolExecutor({ businessId: COACH_A.businessId, availability, now: NOW })
    const result = await ex.execute("book_consult", {})

    expect(availability).not.toHaveBeenCalled()
    const card = ex.outcome().cards.find((c) => c.kind === "consult")
    expect(card?.kind === "consult" && card.href).toBe(CONSULT_PATH)
    expect(result).not.toContain(PLATFORM.page)
    expect(await ex.consultHref()).toBe(CONSULT_PATH)
  })

  it("PRESENCE CONTROL — the same wiring on the PLATFORM tenant does reach the environment's calendar", async () => {
    // Without this, the test above passes for an executor that offers
    // CONSULT_PATH to everybody, which would be a different bug wearing the
    // same green tick.
    getPrimaryBookingHostId.mockResolvedValue(null)
    const availability = vi.fn(async () => slotsOn(PLATFORM.page))

    const ex = createToolExecutor({ businessId: PLATFORM_BUSINESS, availability, now: NOW })
    await ex.execute("book_consult", {})

    expect(availability).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypeUri: PLATFORM.eventType, apiToken: PLATFORM.token }),
    )
    const card = ex.outcome().cards.find((c) => c.kind === "slots")
    expect(card?.kind === "slots" && card.href).toContain(PLATFORM.page)
  })

  it("warns when it takes the platform's environment ramp, so its lifetime is visible in the logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    getPrimaryBookingHostId.mockResolvedValue(null)

    const ex = createToolExecutor({
      businessId: PLATFORM_BUSINESS,
      availability: async () => slotsOn(PLATFORM.page),
      now: NOW,
    })
    await ex.execute("book_consult", {})

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CALENDLY_SCHEDULING_URL"))
    warn.mockRestore()
  })

  it("offers the plain consult path when the turn carries no tenant at all — it cannot know whose calendar to show", async () => {
    const availability = vi.fn(async () => slotsOn(PLATFORM.page))

    const ex = createToolExecutor({ availability, now: NOW })
    await ex.execute("book_consult", {})

    expect(availability).not.toHaveBeenCalled()
    expect(getPrimaryBookingHostId).not.toHaveBeenCalled()
    const card = ex.outcome().cards.find((c) => c.kind === "consult")
    expect(card?.kind === "consult" && card.href).toBe(CONSULT_PATH)
  })

  it("resolves the tenant ONCE per turn, however many times the model asks to book", async () => {
    wireBothCoaches()
    const availability = vi.fn(async () => slotsOn(COACH_A.page))

    const ex = createToolExecutor({ businessId: COACH_A.businessId, availability, now: NOW })
    await ex.execute("book_consult", {})
    await ex.execute("book_consult", {})
    await ex.consultHref()

    // Two lookups for one person can disagree; one resolution per turn means
    // the second card cannot land on a different link from the first.
    expect(getPrimaryBookingHostId).toHaveBeenCalledTimes(1)
    expect(getCoachCalendarConnection).toHaveBeenCalledTimes(1)
    expect(accessTokenForConnection).toHaveBeenCalledTimes(1)
  })

  it("sends the visitor to the COACH'S OWN page when only their token is dead", async () => {
    // A lapsed grant costs the times, not the booking page. Getting this wrong
    // hands a working coach's visitors `/contact` because of a token problem
    // that has nothing to do with their public page.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    wireBothCoaches()
    accessTokenForConnection.mockRejectedValue(new Error("Calendly token refresh failed: invalid_grant"))
    const availability = vi.fn(async () => slotsOn(COACH_A.page))

    const ex = createToolExecutor({ businessId: COACH_A.businessId, availability, now: NOW })
    await ex.execute("book_consult", {})

    expect(availability).not.toHaveBeenCalled()
    const card = ex.outcome().cards.find((c) => c.kind === "consult")
    expect(card?.kind === "consult" && card.href).toContain(COACH_A.page)
    expect(card?.kind === "consult" && card.href).not.toBe(CONSULT_PATH)
    expect(card?.kind === "consult" && card.href).not.toContain("platform")
    warn.mockRestore()
  })

  it("leaves the visitor a link rather than an error when the tenant read fails", async () => {
    // A could-not-read must not 500 the visitor's chat, and must not fall
    // through to somebody else's calendar either. CONSULT_PATH is both.
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    getPrimaryBookingHostId.mockRejectedValue(new Error("getPrimaryBookingHostId failed (57014): timeout"))
    const availability = vi.fn(async () => slotsOn(PLATFORM.page))

    const ex = createToolExecutor({ businessId: COACH_A.businessId, availability, now: NOW })
    const result = await ex.execute("book_consult", {})

    expect(result).not.toContain(PLATFORM.page)
    expect(availability).not.toHaveBeenCalled()
    const card = ex.outcome().cards.find((c) => c.kind === "consult")
    expect(card?.kind === "consult" && card.href).toBe(CONSULT_PATH)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
