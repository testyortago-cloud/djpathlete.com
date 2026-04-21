import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "admin" } })),
}))
const getMock = vi.fn()
const upsertMock = vi.fn()
vi.mock("@/lib/db/user-preferences", () => ({
  getPreferences: (...args: unknown[]) => getMock(...args),
  upsertPreferences: (...args: unknown[]) => upsertMock(...args),
}))

import { GET, PATCH } from "@/app/api/admin/content-studio/preferences/route"

beforeEach(() => {
  getMock.mockReset()
  upsertMock.mockReset()
})

describe("GET /api/admin/content-studio/preferences", () => {
  it("returns the preferences for the current user", async () => {
    getMock.mockResolvedValueOnce({ user_id: "user-1", calendar_default_view: "week" })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.calendar_default_view).toBe("week")
  })
})

describe("PATCH /api/admin/content-studio/preferences", () => {
  it("rejects unknown calendar_default_view", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendar_default_view: "year" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("upserts the accepted fields", async () => {
    upsertMock.mockResolvedValueOnce({ user_id: "user-1", calendar_default_view: "day" })
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendar_default_view: "day" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith("user-1", expect.objectContaining({ calendar_default_view: "day" }))
  })

  it("rejects a non-object last_pipeline_filters", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ last_pipeline_filters: "oops" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })
})
