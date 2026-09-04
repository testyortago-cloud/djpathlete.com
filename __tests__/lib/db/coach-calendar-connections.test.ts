// @vitest-environment node
//
// The read-failure path is the point of this suite. postgrest-js RESOLVES
// rather than throws: a missing table, a missing column or a transient fault
// all arrive as { data: null, error }. Treating that as "no connection matched"
// is what would silently file another coach's booking into the platform's
// tenant -- see the tenant resolver in lib/bookings/calendly-tenant.ts, whose
// whole failure story rests on this function throwing instead of returning null.
//
// THE TWO WRITERS ARE PINNED ON THEIR COLUMN SET, NOT ON "a write happened".
// Both exist to leave the row in one exact shape, and both are read by a screen
// that renders the result as a promise to a coach -- so the failure that
// matters is a write that runs and touches the wrong columns, which no
// "an update was issued" assertion can see. `webhook_checked_at` in
// particular had NO writer anywhere until 2026-09-05; dropping it from the
// update would put it straight back to having none.
import { describe, it, expect, vi, beforeEach } from "vitest"

let rpcResult: { data: unknown; error: unknown }
let selectResult: { data: unknown; error: unknown }
let rpcCalls: Array<[string, Record<string, unknown>]>
let eqCalls: Array<[string, unknown]>
/** The write path: the exact object handed to `.update()`, and the row it was aimed at. */
let updateCalls: Array<{ payload: Record<string, unknown>; eq: [string, unknown] }>
let updateResult: { error: unknown }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve(rpcResult)
    },
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val])
          return { maybeSingle: () => Promise.resolve(selectResult) }
        },
      }),
      // Kept out of `eqCalls` on purpose: the read assertions match that array
      // exactly, so a write leaking into it would make them pass or fail for
      // the wrong reason.
      update: (payload: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          updateCalls.push({ payload, eq: [col, val] })
          return Promise.resolve(updateResult)
        },
      }),
    }),
  }),
}))

import {
  getCoachCalendarConnection,
  findCoachCalendarConnectionByEventType,
  storeRefreshedCalendarCredentials,
  recordCoachCalendarWebhookState,
  clearCoachCalendarEventType,
} from "@/lib/db/coach-calendar-connections"

beforeEach(() => {
  rpcCalls = []
  eqCalls = []
  updateCalls = []
  rpcResult = { data: [], error: null }
  selectResult = { data: null, error: null }
  updateResult = { error: null }
})

describe("getCoachCalendarConnection", () => {
  it("passes the host id and provider to the RPC, not the business id", async () => {
    rpcResult = { data: [{ id: "conn-1", host_id: "host-1" }], error: null }
    await getCoachCalendarConnection("host-1")
    expect(rpcCalls[0][0]).toBe("fn_get_coach_calendar_connection")
    expect(rpcCalls[0][1]).toEqual({ p_host_id: "host-1", p_provider: "calendly" })
  })

  it("returns null when the RPC returns no rows", async () => {
    rpcResult = { data: [], error: null }
    expect(await getCoachCalendarConnection("host-1")).toBeNull()
  })

  it("THROWS on a read error rather than returning null", async () => {
    rpcResult = { data: null, error: { code: "42883", message: "function does not exist" } }
    await expect(getCoachCalendarConnection("host-1")).rejects.toThrow(/42883/)
  })
})

describe("findCoachCalendarConnectionByEventType", () => {
  it("matches on event_type_uri", async () => {
    selectResult = { data: { id: "conn-1", business_id: "biz-1", host_id: "host-1" }, error: null }
    const row = await findCoachCalendarConnectionByEventType("https://api.calendly.com/event_types/E1")
    expect(eqCalls).toEqual([["event_type_uri", "https://api.calendly.com/event_types/E1"]])
    expect(row?.id).toBe("conn-1")
  })

  it("returns null when nothing matched", async () => {
    selectResult = { data: null, error: null }
    expect(await findCoachCalendarConnectionByEventType("https://x/E9")).toBeNull()
  })

  it("THROWS on a read error — a failed read is not 'no match'", async () => {
    selectResult = { data: null, error: { code: "PGRST301", message: "JWT expired" } }
    await expect(findCoachCalendarConnectionByEventType("https://x/E1")).rejects.toThrow(/PGRST301/)
  })
})

describe("storeRefreshedCalendarCredentials", () => {
  it("returns the winner's credentials when the swap was refused", async () => {
    rpcResult = { data: [{ stored: false, credentials: { refresh_token: "winner" } }], error: null }
    const out = await storeRefreshedCalendarCredentials({
      connectionId: "conn-1",
      expectedRefreshToken: "stale",
      credentials: { refresh_token: "mine" },
      accessTokenExpiresAt: "2026-09-04T00:00:00.000Z",
    })
    expect(out.stored).toBe(false)
    expect(out.credentials).toEqual({ refresh_token: "winner" })
  })
})

describe("recordCoachCalendarWebhookState", () => {
  it("writes BOTH webhook_state and webhook_checked_at — the column SET is the assertion", async () => {
    await recordCoachCalendarWebhookState("conn-1", "disabled")

    expect(updateCalls).toHaveLength(1)
    const [call] = updateCalls
    // Exactly these two keys. `webhook_checked_at` is the reason this function
    // exists — the column had no writer anywhere before it — so dropping it
    // must fail here, and a `toMatchObject` on webhook_state alone would not
    // notice. The screen's "you last checked on …" line has nothing else to read.
    expect(Object.keys(call.payload).sort()).toEqual(["webhook_checked_at", "webhook_state"])
    expect(call.payload.webhook_state).toBe("disabled")
    expect(call.eq).toEqual(["id", "conn-1"])
  })

  it("stamps webhook_checked_at with NOW, not a fixed or empty value", async () => {
    const before = Date.now()
    await recordCoachCalendarWebhookState("conn-1", "active")
    const stamped = Date.parse(String(updateCalls[0].payload.webhook_checked_at))

    // "when we last successfully asked Calendly" is the whole meaning of the
    // column, so a constant would satisfy the key check above and still be a lie.
    expect(Number.isNaN(stamped)).toBe(false)
    expect(stamped).toBeGreaterThanOrEqual(before - 1000)
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it("passes Calendly's own word through — it does not normalise the state", async () => {
    // `removed` is ours, for a subscription Calendly 404s; `active`/`disabled`
    // are Calendly's. The card tells them apart, so this must not flatten them.
    await recordCoachCalendarWebhookState("conn-1", "removed")
    expect(updateCalls[0].payload.webhook_state).toBe("removed")
  })

  it("THROWS on a write error rather than reporting a check that never happened", async () => {
    updateResult = { error: { code: "42703", message: "column does not exist" } }
    await expect(recordCoachCalendarWebhookState("conn-1", "active")).rejects.toThrow(/42703/)
  })
})

describe("clearCoachCalendarEventType", () => {
  it("nulls exactly the five columns a failed pick has to give back", async () => {
    await clearCoachCalendarEventType("conn-1")

    expect(updateCalls).toHaveLength(1)
    const [call] = updateCalls
    // BOTH directions matter, which is why this is toEqual and not a subset
    // match. Clearing too LITTLE puts back the bug this function was written
    // for: a row that still claims an event type it holds no subscription for,
    // rendered as a green "Connected" badge on a calendar that can never
    // receive a booking. Clearing too MUCH strands the coach a different way.
    expect(call.payload).toEqual({
      event_type_uri: null,
      scheduling_url: null,
      webhook_subscription_uri: null,
      webhook_state: null,
      webhook_checked_at: null,
    })
    expect(Object.keys(call.payload).sort()).toEqual([
      "event_type_uri",
      "scheduling_url",
      "webhook_checked_at",
      "webhook_state",
      "webhook_subscription_uri",
    ])
    expect(call.eq).toEqual(["id", "conn-1"])
  })

  it("leaves `status` and `credentials` alone — the grant still works", async () => {
    await clearCoachCalendarEventType("conn-1")
    const keys = Object.keys(updateCalls[0].payload)

    // The caller is a 502 from Calendly's subscription endpoint, not an
    // authentication failure. Touching either of these would turn "pick your
    // meeting again" into "connect your account again", or destroy a working
    // grant over a transient outage.
    expect(keys).not.toContain("status")
    expect(keys).not.toContain("credentials")
    expect(keys).not.toContain("conflict_check_confirmed_at")
  })

  it("THROWS on a write error — a claim that was not released must not read as released", async () => {
    updateResult = { error: { code: "PGRST301", message: "JWT expired" } }
    await expect(clearCoachCalendarEventType("conn-1")).rejects.toThrow(/PGRST301/)
  })
})
