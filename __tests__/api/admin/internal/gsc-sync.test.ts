import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const isCronSkipped = vi.fn()
const getGscProperty = vi.fn()
const searchAnalyticsQuery = vi.fn()
const upsertGscRows = vi.fn()
const setSetting = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({
  isCronSkipped,
  setSetting,
}))
vi.mock("@/lib/db/gsc-properties", () => ({ getGscProperty }))
vi.mock("@/lib/db/gsc-query-daily", () => ({ upsertGscRows }))
vi.mock("@/lib/gsc/client", () => ({
  searchAnalyticsQuery,
  OAuthBrokenError: class OAuthBrokenError extends Error {
    name = "OAuthBrokenError"
  },
}))

beforeEach(() => {
  isCronSkipped.mockReset()
  getGscProperty.mockReset()
  searchAnalyticsQuery.mockReset()
  upsertGscRows.mockReset()
  setSetting.mockReset()
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({
  bearer = "shared-secret",
}: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/gsc-sync/route")
  const req = new NextRequest("https://example.test/api/admin/internal/gsc-sync", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
  })
  return POST(req)
}

describe("/api/admin/internal/gsc-sync", () => {
  it("returns 401 without bearer", async () => {
    const res = await call({ bearer: "" })
    expect(res.status).toBe(401)
  })

  it("returns 401 with wrong bearer", async () => {
    const res = await call({ bearer: "wrong" })
    expect(res.status).toBe(401)
  })

  it("returns { skipped } when cron is disabled", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "disabled" })
  })

  it("returns { skipped: 'not_connected' } when no gsc_properties row", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    getGscProperty.mockResolvedValueOnce(null)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "not_connected" })
  })

  it("happy path: 3 days, upserts rows, returns counts", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    getGscProperty.mockResolvedValueOnce({ id: "u1", site_url: "sc-domain:x" })
    searchAnalyticsQuery
      .mockResolvedValueOnce({
        rows: [{ keys: ["q1", "https://x/blog/a"], clicks: 1, impressions: 10, ctr: 0.1, position: 12 }],
      })
      .mockResolvedValueOnce({
        rows: [{ keys: ["q1", "https://x/blog/a"], clicks: 2, impressions: 11, ctr: 0.18, position: 11 }],
      })
      .mockResolvedValueOnce({ rows: [] })
    upsertGscRows.mockResolvedValue(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalRows).toBe(2)
    expect(searchAnalyticsQuery).toHaveBeenCalledTimes(3)
  })

  it("sets gsc_oauth_broken=true on OAuthBrokenError", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    getGscProperty.mockResolvedValueOnce({ id: "u1", site_url: "sc-domain:x" })
    const { OAuthBrokenError } = await import("@/lib/gsc/client")
    searchAnalyticsQuery.mockRejectedValueOnce(new OAuthBrokenError("revoked"))
    const res = await call()
    expect(res.status).toBe(500)
    expect(setSetting).toHaveBeenCalledWith("gsc_oauth_broken", true)
  })

  it("continues past a single-day failure that is not OAuthBroken", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    getGscProperty.mockResolvedValueOnce({ id: "u1", site_url: "sc-domain:x" })
    searchAnalyticsQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("503 transient"))
      .mockResolvedValueOnce({ rows: [] })
    upsertGscRows.mockResolvedValue(0)
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors).toHaveLength(1)
  })
})
