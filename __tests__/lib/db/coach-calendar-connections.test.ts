// @vitest-environment node
//
// The read-failure path is the point of this suite. postgrest-js RESOLVES
// rather than throws: a missing table, a missing column or a transient fault
// all arrive as { data: null, error }. Treating that as "no connection matched"
// is what would silently file another coach's booking into the platform's
// tenant -- see the tenant resolver in lib/bookings/calendly-tenant.ts, whose
// whole failure story rests on this function throwing instead of returning null.
import { describe, it, expect, vi, beforeEach } from "vitest"

let rpcResult: { data: unknown; error: unknown }
let selectResult: { data: unknown; error: unknown }
let rpcCalls: Array<[string, Record<string, unknown>]>
let eqCalls: Array<[string, unknown]>

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
    }),
  }),
}))

import {
  getCoachCalendarConnection,
  findCoachCalendarConnectionByEventType,
  storeRefreshedCalendarCredentials,
} from "@/lib/db/coach-calendar-connections"

beforeEach(() => {
  rpcCalls = []
  eqCalls = []
  rpcResult = { data: [], error: null }
  selectResult = { data: null, error: null }
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
