// @vitest-environment node
//
// Picking the consult event type, disconnecting, and confirming "Check for
// conflicts" — the three routes that only exist once a coach has connected.
//
// THREE OF THESE ASSERTIONS ARE ABOUT WORDS, NOT STATUS CODES. A Free Calendly
// plan and an event type another coach already claimed are the two failures a
// coach can actually act on, and "an error was returned" passes for the
// generic message those exist to avoid. So the exact sentence is pinned.
//
// ONE IS ABOUT ORDER. Disconnect deletes the Calendly subscription BEFORE the
// vault secret, because a failure between the two must leave credentials that
// can still authenticate the retry. A single shared call log is what makes
// that assertion possible.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  return { NoAccessibleBusinessError }
})

/** Every mocked side effect appends here, in the order it actually happened. */
const callLog: string[] = []

type Connection = Record<string, unknown> | null
let connection: Connection = null
const updateCalls: Array<Record<string, unknown>> = []
let updateImpl: (input: Record<string, unknown>) => Promise<void> = async () => {}
const clearCalls: string[] = []
const disconnectCalls: string[] = []
const setErrorCalls: Array<[string, string, string]> = []
const confirmCalls: Array<[string, boolean]> = []

vi.mock("@/lib/db/coach-calendar-connections", () => ({
  getCoachCalendarConnection: async () => connection,
  updateCoachCalendarEventType: async (input: Record<string, unknown>) => {
    callLog.push("updateCoachCalendarEventType")
    updateCalls.push(input)
    return updateImpl(input)
  },
  clearCoachCalendarEventType: async (connectionId: string) => {
    callLog.push("clearCoachCalendarEventType")
    clearCalls.push(connectionId)
  },
  disconnectCoachCalendar: async (hostId: string) => {
    callLog.push("disconnectCoachCalendar")
    disconnectCalls.push(hostId)
    return { id: "conn-1", status: "not_connected" }
  },
  setCoachCalendarError: async (id: string, status: string, message: string) => {
    callLog.push(`setCoachCalendarError:${status}`)
    setErrorCalls.push([id, status, message])
  },
  confirmCoachCalendarConflictCheck: async (id: string, confirmed: boolean) => {
    callLog.push("confirmCoachCalendarConflictCheck")
    confirmCalls.push([id, confirmed])
  },
}))

let tokenImpl: () => Promise<string> = async () => "access-token-1"
vi.mock("@/lib/calendly/credentials", () => ({
  accessTokenForConnection: () => tokenImpl(),
}))

const listCalls: Array<Record<string, unknown>> = []
let listImpl: () => Promise<unknown[]> = async () => [
  {
    uri: "https://api.calendly.com/event_types/ET1",
    name: "Free consult",
    durationMinutes: 30,
    schedulingUrl: "https://calendly.com/nadia/consult",
    active: true,
  },
  {
    uri: "https://api.calendly.com/event_types/ET2",
    name: "Follow-up",
    durationMinutes: 15,
    schedulingUrl: "https://calendly.com/nadia/follow-up",
    active: true,
  },
]

const createSubCalls: Array<Record<string, unknown>> = []
let createSubImpl: () => Promise<{ uri: string; state: string }> = async () => ({
  uri: "https://api.calendly.com/webhook_subscriptions/WS1",
  state: "active",
})

const deleteSubCalls: Array<Record<string, unknown>> = []
let deleteSubImpl: (input: Record<string, unknown>) => Promise<void> = async () => {}

vi.mock("@/lib/calendly/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendly/account")>()
  return {
    ...actual,
    listEventTypes: (input: Record<string, unknown>) => {
      callLog.push("listEventTypes")
      listCalls.push(input)
      return listImpl()
    },
    createWebhookSubscription: (input: Record<string, unknown>) => {
      callLog.push("createWebhookSubscription")
      createSubCalls.push(input)
      return createSubImpl()
    },
    deleteWebhookSubscription: (input: Record<string, unknown>) => {
      callLog.push("deleteWebhookSubscription")
      deleteSubCalls.push(input)
      return deleteSubImpl(input)
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

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    throw new Error("a calendar route reached the database directly — it must not")
  },
}))

import { GET as LIST_EVENT_TYPES, POST as SELECT_EVENT_TYPE } from "@/app/api/admin/bookings/calendar/event-type/route"
import { POST as DISCONNECT } from "@/app/api/admin/bookings/calendar/disconnect/route"
import { POST as CONFLICT_CHECK } from "@/app/api/admin/bookings/calendar/conflict-check/route"

const ORIGIN = "http://localhost:3050"
const ET1 = "https://api.calendly.com/event_types/ET1"

/** withAudit's second argument — the route handlers ignore it. */
const routeContext = { params: Promise.resolve({} as Record<string, string>) }

function connectedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    business_id: "biz-1",
    host_id: "host-1",
    provider: "calendly",
    status: "connected",
    // fn_get_coach_calendar_connection decrypts and returns these. Disconnect
    // reads them to tell "the grant might still work" from "there is nothing
    // left to authenticate with".
    credentials: { access_token: "access-token-1", refresh_token: "refresh-token-1" },
    calendly_user_uri: "https://api.calendly.com/users/U1",
    calendly_organization_uri: "https://api.calendly.com/organizations/O1",
    event_type_uri: null,
    scheduling_url: null,
    webhook_subscription_uri: null,
    webhook_state: null,
    conflict_check_confirmed_at: null,
    ...overrides,
  }
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function getRequest(path: string) {
  return new Request(`${ORIGIN}${path}`, { method: "GET" })
}

beforeEach(() => {
  callLog.length = 0
  updateCalls.length = 0
  clearCalls.length = 0
  disconnectCalls.length = 0
  setErrorCalls.length = 0
  confirmCalls.length = 0
  listCalls.length = 0
  createSubCalls.length = 0
  deleteSubCalls.length = 0
  auditCalls.length = 0

  connection = connectedRow()
  updateImpl = async () => {}
  tokenImpl = async () => "access-token-1"
  listImpl = async () => [
    {
      uri: ET1,
      name: "Free consult",
      durationMinutes: 30,
      schedulingUrl: "https://calendly.com/nadia/consult",
      active: true,
    },
    {
      uri: "https://api.calendly.com/event_types/ET2",
      name: "Follow-up",
      durationMinutes: 15,
      schedulingUrl: "https://calendly.com/nadia/follow-up",
      active: true,
    },
  ]
  createSubImpl = async () => ({ uri: "https://api.calendly.com/webhook_subscriptions/WS1", state: "active" })
  deleteSubImpl = async () => {}
  tenantImpl = async () => ({
    businessId: "biz-1",
    choices: [{ id: "biz-1", name: "B", slug: "b" }],
    isOperator: false,
  })
  hostImpl = async () => "host-1"
  session = { user: { id: "user-1", role: "admin" } }

  vi.stubEnv("NEXTAUTH_URL", ORIGIN)
  vi.stubEnv("CALENDLY_WEBHOOK_SIGNING_KEY", "signing-key-1")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /api/admin/bookings/calendar/event-type", () => {
  it("lists the connected account's active event types", async () => {
    const response = await LIST_EVENT_TYPES(getRequest("/api/admin/bookings/calendar/event-type"))
    expect(response.status).toBe(200)

    const body = (await response.json()) as { eventTypes: Array<Record<string, unknown>> }
    expect(body.eventTypes).toHaveLength(2)
    expect(body.eventTypes[0]).toMatchObject({ uri: ET1, name: "Free consult", durationMinutes: 30 })

    // The user whose event types we asked for came from the connection row,
    // never from the request.
    expect(listCalls[0]).toMatchObject({
      accessToken: "access-token-1",
      userUri: "https://api.calendly.com/users/U1",
    })
  })

  it("refuses a caller the tenant resolver rejects", async () => {
    tenantImpl = async () => {
      throw new NoAccessibleBusinessError()
    }
    const response = await LIST_EVENT_TYPES(getRequest("/api/admin/bookings/calendar/event-type"))
    expect(response.status).toBe(403)
    expect(listCalls).toHaveLength(0)
  })

  it("says so when nothing is connected yet, rather than answering an empty list", async () => {
    connection = null
    const response = await LIST_EVENT_TYPES(getRequest("/api/admin/bookings/calendar/event-type"))
    expect(response.status).toBe(409)
    expect(listCalls).toHaveLength(0)
  })
})

describe("POST /api/admin/bookings/calendar/event-type", () => {
  it("writes the event type AND registers the subscription, storing its uri", async () => {
    const response = await SELECT_EVENT_TYPE(
      jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
      routeContext,
    )
    expect(response.status).toBe(200)

    // Claim first, then register: a uniqueness conflict must be discovered
    // before a subscription exists in the coach's Calendly account.
    expect(callLog.indexOf("updateCoachCalendarEventType")).toBeLessThan(callLog.indexOf("createWebhookSubscription"))

    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0]).toMatchObject({
      connectionId: "conn-1",
      eventTypeUri: ET1,
      schedulingUrl: "https://calendly.com/nadia/consult",
      webhookSubscriptionUri: null,
    })
    expect(updateCalls[1]).toMatchObject({
      connectionId: "conn-1",
      eventTypeUri: ET1,
      webhookSubscriptionUri: "https://api.calendly.com/webhook_subscriptions/WS1",
      webhookState: "active",
    })

    expect(createSubCalls[0]).toMatchObject({
      accessToken: "access-token-1",
      organizationUri: "https://api.calendly.com/organizations/O1",
      userUri: "https://api.calendly.com/users/U1",
      callbackUrl: `${ORIGIN}/api/webhooks/calendly`,
      signingKey: "signing-key-1",
    })

    expect(auditCalls.map((c) => c.action)).toContain("calendar.event_type_selected")
  })

  it("refuses an event type that is not on the connected account, and writes nothing", async () => {
    const response = await SELECT_EVENT_TYPE(
      jsonRequest("/api/admin/bookings/calendar/event-type", {
        eventTypeUri: "https://api.calendly.com/event_types/SOMEONE-ELSE",
      }),
      routeContext,
    )
    expect(response.status).toBe(400)
    expect(updateCalls).toHaveLength(0)
    expect(createSubCalls).toHaveLength(0)
  })

  it("a Free plan answers 402, sets plan_lapsed, and names the plans that work", async () => {
    const { CalendlyPlanRequiredError } =
      await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
    createSubImpl = async () => {
      throw new CalendlyPlanRequiredError()
    }

    const response = await SELECT_EVENT_TYPE(
      jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
      routeContext,
    )

    expect(response.status).toBe(402)
    const body = (await response.json()) as { error: string; status: string }
    expect(body.error).toBe(
      "Calendly only sends us bookings on a paid plan (Standard, Teams or Enterprise). Upgrade in Calendly, then pick your meeting again.",
    )
    expect(body.status).toBe("plan_lapsed")
    expect(setErrorCalls[0][0]).toBe("conn-1")
    expect(setErrorCalls[0][1]).toBe("plan_lapsed")
  })

  it("an event type another calendar already claims answers 409, in words", async () => {
    updateImpl = async () => {
      // Exactly how lib/db/coach-calendar-connections.ts flattens a PostgREST
      // error: `<fn> failed (<code>): <message>`. The route matches on that
      // shape, so the fixture has to be that shape.
      throw new Error(
        'updateCoachCalendarEventType failed (23505): duplicate key value violates unique constraint "coach_calendar_connections_event_type_key"',
      )
    }

    const response = await SELECT_EVENT_TYPE(
      jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
      routeContext,
    )

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe("That meeting is already connected to another coach's calendar.")
    // The claim failed, so no subscription was created for it.
    expect(createSubCalls).toHaveLength(0)
  })

  it("re-picking on a connection that already has a subscription does not create a second one", async () => {
    connection = connectedRow({
      event_type_uri: "https://api.calendly.com/event_types/ET2",
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
      webhook_state: "active",
    })

    const response = await SELECT_EVENT_TYPE(
      jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
      routeContext,
    )

    expect(response.status).toBe(200)
    expect(createSubCalls).toHaveLength(0)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toMatchObject({
      eventTypeUri: ET1,
      webhookSubscriptionUri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
  })

  it("refuses a caller the tenant resolver rejects", async () => {
    tenantImpl = async () => {
      throw new NoAccessibleBusinessError()
    }
    const response = await SELECT_EVENT_TYPE(
      jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
      routeContext,
    )
    expect(response.status).toBe(403)
    expect(updateCalls).toHaveLength(0)
  })

  // WHAT THE ROW LOOKS LIKE AFTERWARDS IS THE ASSERTION, not the status code.
  // `event_type_uri` is claimed before the Calendly call, and between that
  // claim and a stored subscription uri the screen renders a green "Connected"
  // badge whose only action is Disconnect. So every way this route can exit in
  // that window has to be pinned: the state it leaves is what a coach is stuck
  // with, and no status-code assertion can see it.
  describe("what a failed pick leaves behind", () => {
    it("an unconfigured server claims NOTHING — the check happens before the write", async () => {
      // Exactly production today: no CALENDLY_* variables at all.
      vi.stubEnv("CALENDLY_WEBHOOK_SIGNING_KEY", "")

      const response = await SELECT_EVENT_TYPE(
        jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
        routeContext,
      )

      expect(response.status).toBe(500)
      // The row is untouched, so the screen still shows the picker rather than
      // a Connected badge over a calendar that can never receive a booking.
      expect(updateCalls).toHaveLength(0)
      expect(clearCalls).toHaveLength(0)
      expect(createSubCalls).toHaveLength(0)
    })

    it("a connection with no organisation uri claims NOTHING either", async () => {
      connection = connectedRow({ calendly_organization_uri: null })

      const response = await SELECT_EVENT_TYPE(
        jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
        routeContext,
      )

      expect(response.status).toBe(409)
      expect(updateCalls).toHaveLength(0)
      expect(createSubCalls).toHaveLength(0)
    })

    it("a transient registration failure gives the claim back, returning the coach to the picker", async () => {
      const { CalendlyAccountError } =
        await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
      createSubImpl = async () => {
        throw new CalendlyAccountError("http", "POST /webhook_subscriptions answered 500", 500)
      }

      const response = await SELECT_EVENT_TYPE(
        jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
        routeContext,
      )

      expect(response.status).toBe(502)
      // Claimed, then released — and released AFTER the failed registration,
      // not instead of the claim.
      expect(updateCalls).toHaveLength(1)
      expect(clearCalls).toEqual(["conn-1"])
      expect(callLog.indexOf("createWebhookSubscription")).toBeLessThan(callLog.indexOf("clearCoachCalendarEventType"))
      // Nothing was recorded as a subscription, so Disconnect has nothing to chase.
      expect(updateCalls[0]).toMatchObject({ webhookSubscriptionUri: null })
    })

    it("a Free plan KEEPS the pick, so upgrading and re-picking does not start over", async () => {
      const { CalendlyPlanRequiredError } =
        await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
      createSubImpl = async () => {
        throw new CalendlyPlanRequiredError()
      }

      const response = await SELECT_EVENT_TYPE(
        jsonRequest("/api/admin/bookings/calendar/event-type", { eventTypeUri: ET1 }),
        routeContext,
      )

      expect(response.status).toBe(402)
      // The control for the test above: plan_lapsed and transient are the two
      // branches of the same catch, and only one of them releases the claim.
      expect(clearCalls).toHaveLength(0)
      expect(updateCalls[0]).toMatchObject({ eventTypeUri: ET1 })
      expect(setErrorCalls[0][1]).toBe("plan_lapsed")
    })
  })
})

describe("POST /api/admin/bookings/calendar/disconnect", () => {
  it("deletes the Calendly subscription BEFORE the vault secret", async () => {
    connection = connectedRow({
      event_type_uri: ET1,
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(200)

    const deletedAt = callLog.indexOf("deleteWebhookSubscription")
    const disconnectedAt = callLog.indexOf("disconnectCoachCalendar")
    expect(deletedAt).toBeGreaterThanOrEqual(0)
    expect(disconnectedAt).toBeGreaterThanOrEqual(0)
    expect(deletedAt).toBeLessThan(disconnectedAt)

    expect(deleteSubCalls[0]).toMatchObject({
      accessToken: "access-token-1",
      subscriptionUri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    expect(disconnectCalls).toEqual(["host-1"])
    expect(auditCalls.map((c) => c.action)).toContain("calendar.disconnected")
  })

  it("a subscription Calendly has already removed (404) does not stop the disconnect", async () => {
    connection = connectedRow({
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    // The real helper, driven by a 404. Already-gone is the desired end state,
    // and this runs the actual 404 tolerance rather than a mock that assumes it.
    const real = await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
    deleteSubImpl = (input) =>
      real.deleteWebhookSubscription({
        accessToken: String(input.accessToken),
        subscriptionUri: String(input.subscriptionUri),
        fetchImpl: async () => new Response(null, { status: 404 }),
      })

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(200)
    expect(disconnectCalls).toEqual(["host-1"])
  })

  it("a TRANSIENT failure stops before the credentials are destroyed", async () => {
    connection = connectedRow({
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    const real = await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
    deleteSubImpl = (input) =>
      real.deleteWebhookSubscription({
        accessToken: String(input.accessToken),
        subscriptionUri: String(input.subscriptionUri),
        fetchImpl: async () => new Response("boom", { status: 500 }),
      })

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(502)
    expect(disconnectCalls).toHaveLength(0)
  })

  // The two branches of the fault-class split. Stopping is only worth doing
  // while a retry could still succeed; once the grant provably cannot
  // authenticate, refusing to disconnect just traps the coach.
  it("a grant that can no longer authenticate does not block the disconnect", async () => {
    connection = connectedRow({
      status: "connected",
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    const real = await vi.importActual<typeof import("@/lib/calendly/account")>("@/lib/calendly/account")
    deleteSubImpl = (input) =>
      real.deleteWebhookSubscription({
        accessToken: String(input.accessToken),
        subscriptionUri: String(input.subscriptionUri),
        // 401: these credentials do not work and no retry will change that.
        fetchImpl: async () => new Response("unauthorized", { status: 401 }),
      })

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(200)
    expect(disconnectCalls).toEqual(["host-1"])

    // The orphan is named, in the answer and in an audit row — it is the one
    // fact the nulled row can no longer carry.
    const body = (await response.json()) as { orphanedWebhookSubscriptionUri: string; message: string }
    expect(body.orphanedWebhookSubscriptionUri).toBe("https://api.calendly.com/webhook_subscriptions/WS1")
    expect(body.message).toContain("Calendly")
    const orphanAudit = auditCalls.find(
      (c) =>
        (c.metadata as Record<string, unknown> | undefined)?.orphaned_webhook_subscription_uri ===
        "https://api.calendly.com/webhook_subscriptions/WS1",
    )
    expect(orphanAudit, "the orphaned subscription was not audited").toBeDefined()
    expect(orphanAudit!.action).toBe("calendar.disconnected")
  })

  it("a 2xx token response with an unparseable body is transient, not a dead grant", async () => {
    connection = connectedRow({
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    // Exactly the shape lib/calendly/credentials.ts produces when a refresh
    // gets HTTP 200 with a body that does not parse: parseTokenResponse raises
    // CalendlyOAuthError("shape", …, response.status) carrying THAT 2xx, and
    // unavailableReasonFor passes `shape` straight through. Calendly rejected
    // nothing — only the body was garbled — so abandoning the coach's live
    // subscription over it would be wrong, and telling them "Calendly would
    // not let us switch it off" would be false.
    const { CalendlyUnavailable } =
      await vi.importActual<typeof import("@/lib/calendly/client")>("@/lib/calendly/client")
    tokenImpl = async () => {
      throw new CalendlyUnavailable("shape", "Calendly token response had an unexpected shape", 200)
    }

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(502)
    expect(disconnectCalls).toHaveLength(0)
    expect(deleteSubCalls).toHaveLength(0)
  })

  it("a needs_reconnect connection disconnects without even asking Calendly", async () => {
    connection = connectedRow({
      status: "needs_reconnect",
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    tokenImpl = async () => {
      throw new Error("accessTokenForConnection must not be called for a grant already known dead")
    }

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(200)
    expect(deleteSubCalls).toHaveLength(0)
    expect(disconnectCalls).toEqual(["host-1"])

    const body = (await response.json()) as { orphanedWebhookSubscriptionUri: string }
    expect(body.orphanedWebhookSubscriptionUri).toBe("https://api.calendly.com/webhook_subscriptions/WS1")
  })

  it("a connection with no stored credentials disconnects without asking Calendly", async () => {
    connection = connectedRow({
      credentials: {},
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/WS1",
    })
    tokenImpl = async () => {
      throw new Error("accessTokenForConnection must not be called with no stored credentials")
    }

    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(200)
    expect(deleteSubCalls).toHaveLength(0)
    expect(disconnectCalls).toEqual(["host-1"])
  })

  it("disconnects a connection that never registered a subscription", async () => {
    connection = connectedRow({ webhook_subscription_uri: null })
    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(200)
    expect(deleteSubCalls).toHaveLength(0)
    expect(disconnectCalls).toEqual(["host-1"])
    const body = (await response.json()) as { orphanedWebhookSubscriptionUri: string | null }
    expect(body.orphanedWebhookSubscriptionUri).toBeNull()
  })

  it("refuses a caller the tenant resolver rejects", async () => {
    tenantImpl = async () => {
      throw new NoAccessibleBusinessError()
    }
    const response = await DISCONNECT(jsonRequest("/api/admin/bookings/calendar/disconnect", {}), routeContext)
    expect(response.status).toBe(403)
    expect(disconnectCalls).toHaveLength(0)
    expect(deleteSubCalls).toHaveLength(0)
  })
})

describe("POST /api/admin/bookings/calendar/conflict-check", () => {
  it("{confirmed: true} stamps the confirmation, and records the attestation", async () => {
    const response = await CONFLICT_CHECK(
      jsonRequest("/api/admin/bookings/calendar/conflict-check", { confirmed: true }),
      routeContext,
    )
    expect(response.status).toBe(200)
    expect(confirmCalls).toEqual([["conn-1", true]])
    // The column holds one timestamp that the next tick overwrites, so the
    // audit row is the only lasting evidence the claim was ever made.
    const attestation = auditCalls.find((c) => c.action === "calendar.conflict_check_confirmed")
    expect(attestation, "the attestation was not audited").toBeDefined()
    expect(attestation!.category).toBe("compliance")
  })

  it("{confirmed: false} clears it, and records the withdrawal", async () => {
    const response = await CONFLICT_CHECK(
      jsonRequest("/api/admin/bookings/calendar/conflict-check", { confirmed: false }),
      routeContext,
    )
    expect(response.status).toBe(200)
    expect(confirmCalls).toEqual([["conn-1", false]])
    expect(auditCalls.map((c) => c.action)).toContain("calendar.conflict_check_confirmed")
  })

  it("rejects a body that says nothing", async () => {
    const response = await CONFLICT_CHECK(jsonRequest("/api/admin/bookings/calendar/conflict-check", {}), routeContext)
    expect(response.status).toBe(400)
    expect(confirmCalls).toHaveLength(0)
  })

  it("refuses a caller the tenant resolver rejects", async () => {
    tenantImpl = async () => {
      throw new NoAccessibleBusinessError()
    }
    const response = await CONFLICT_CHECK(
      jsonRequest("/api/admin/bookings/calendar/conflict-check", { confirmed: true }),
      routeContext,
    )
    expect(response.status).toBe(403)
    expect(confirmCalls).toHaveLength(0)
  })
})
