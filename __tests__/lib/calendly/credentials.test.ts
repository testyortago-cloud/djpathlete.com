// @vitest-environment node
//
// Calendly refresh tokens are single-use: revoked the instant a refresh
// succeeds. The failures pinned here are the two that brick a connection --
// the loser of a concurrent refresh writing its failure over a healthy row,
// and a transient 5xx being mistaken for a dead grant.
import { describe, it, expect, vi, beforeEach } from "vitest"

const storeRefreshed = vi.fn()
const setError = vi.fn()
const refresh = vi.fn()

vi.mock("@/lib/db/coach-calendar-connections", () => ({
  storeRefreshedCalendarCredentials: (...a: unknown[]) => storeRefreshed(...a),
  setCoachCalendarError: (...a: unknown[]) => setError(...a),
}))
vi.mock("@/lib/calendly/oauth", async (orig) => ({
  ...(await orig<typeof import("@/lib/calendly/oauth")>()),
  refreshAccessToken: (...a: unknown[]) => refresh(...a),
}))

import { accessTokenForConnection, needsRefresh, REFRESH_SKEW_SECONDS } from "@/lib/calendly/credentials"
import { CalendlyOAuthError } from "@/lib/calendly/oauth"
import { CalendlyUnavailable } from "@/lib/calendly/client"

const NOW = Date.parse("2026-09-04T12:00:00.000Z")
function conn(over: Record<string, unknown> = {}) {
  return {
    id: "conn-1", business_id: "biz-1", host_id: "host-1", provider: "calendly", status: "connected",
    credentials: { access_token: "a1", refresh_token: "r1" },
    access_token_expires_at: new Date(NOW + 3_600_000).toISOString(),
    ...over,
  } as never
}

beforeEach(() => {
  storeRefreshed.mockReset(); setError.mockReset(); refresh.mockReset()
  process.env.CALENDLY_CLIENT_ID = "cid"; process.env.CALENDLY_CLIENT_SECRET = "csec"
})

describe("needsRefresh", () => {
  it("is false well before expiry", () => {
    expect(needsRefresh(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(false)
  })
  it("is true inside the skew window", () => {
    expect(needsRefresh(new Date(NOW + (REFRESH_SKEW_SECONDS - 10) * 1000).toISOString(), NOW)).toBe(true)
  })
  it("is true when the expiry is unknown — an unknown expiry is not a valid token", () => {
    expect(needsRefresh(null, NOW)).toBe(true)
  })
  it("is true for an unparseable expiry — NaN comparisons are false, not a free pass", () => {
    expect(needsRefresh("", NOW)).toBe(true)
    expect(needsRefresh("garbage", NOW)).toBe(true)
  })
})

describe("accessTokenForConnection", () => {
  it("returns the stored token without refreshing when it is still fresh", async () => {
    expect(await accessTokenForConnection(conn(), { now: () => NOW })).toBe("a1")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("refreshes and returns the NEW access token", async () => {
    refresh.mockResolvedValue({ access_token: "a2", refresh_token: "r2", expires_in: 7200, token_type: "Bearer" })
    storeRefreshed.mockResolvedValue({ stored: true, credentials: { access_token: "a2", refresh_token: "r2" } })
    const token = await accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })
    expect(token).toBe("a2")
  })

  it("uses the WINNER's token when the swap was refused, and does not error the row", async () => {
    refresh.mockResolvedValue({ access_token: "mine", refresh_token: "r-mine", expires_in: 7200, token_type: "Bearer" })
    storeRefreshed.mockResolvedValue({ stored: false, credentials: { access_token: "theirs", refresh_token: "r-theirs" } })
    const token = await accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })
    expect(token).toBe("theirs")
    expect(setError).not.toHaveBeenCalled()
  })

  it("marks needs_reconnect on invalid_grant", async () => {
    refresh.mockRejectedValue(new CalendlyOAuthError("invalid_grant", "dead", 400))
    await expect(accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })).rejects.toThrow()
    expect(setError).toHaveBeenCalledWith("conn-1", "needs_reconnect", expect.any(String))
  })

  it("does NOT mark needs_reconnect on a 503 — status must stay untouched", async () => {
    refresh.mockRejectedValue(new CalendlyOAuthError("http", "upstream", 503))
    await expect(accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })).rejects.toThrow()
    const statuses = setError.mock.calls.map((c) => c[1])
    expect(statuses).not.toContain("needs_reconnect")
  })

  it("throws CalendlyUnavailable — not undefined — when a refused swap has no usable access token", async () => {
    // fn_store_refreshed_calendar_credentials returns credentials: '{}'::jsonb
    // when it has no secret to hand back (e.g. disconnected mid-race).
    refresh.mockResolvedValue({ access_token: "mine", refresh_token: "r-mine", expires_in: 7200, token_type: "Bearer" })
    storeRefreshed.mockResolvedValue({ stored: false, credentials: {} })
    await expect(
      accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW }),
    ).rejects.toBeInstanceOf(CalendlyUnavailable)
  })

  it("still throws CalendlyUnavailable, not the DB error, when setCoachCalendarError itself rejects", async () => {
    refresh.mockRejectedValue(new CalendlyOAuthError("http", "upstream", 503))
    setError.mockRejectedValue(new Error("db write failed"))
    await expect(
      accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW }),
    ).rejects.toBeInstanceOf(CalendlyUnavailable)
  })
})
