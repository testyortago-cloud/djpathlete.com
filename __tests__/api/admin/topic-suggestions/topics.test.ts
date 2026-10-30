import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), setSettings: vi.fn(), getSetting: vi.fn() }))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/system-settings", () => ({ setSettings: mocks.setSettings, getSetting: mocks.getSetting }))

import { GET, POST } from "@/app/api/admin/topic-suggestions/topics/route"

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/admin/topic-suggestions/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

const agility = { id: "t1", name: "Agility", keywords: ["deceleration", "cutting"], active: true }
const energy = { id: "t2", name: "energy system conditioning research", keywords: [], active: false }

describe("/api/admin/topic-suggestions/topics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  })

  it("saves the topics and, in the same write, the searches of the ones switched on", async () => {
    const res = await post({ topics: [agility, energy] })
    expect(res.status).toBe(200)
    expect(mocks.setSettings).toHaveBeenCalledTimes(1)
    expect(mocks.setSettings).toHaveBeenCalledWith(
      {
        blog_scan_topics: [agility, energy],
        blog_scan_queries: ["Agility deceleration research", "Agility cutting research"],
      },
      "u1",
    )
  })

  it("refuses a list with every topic switched off", async () => {
    const res = await post({ topics: [{ ...agility, active: false }, energy] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least one/)
    expect(mocks.setSettings).not.toHaveBeenCalled()
  })

  it("refuses a malformed topic", async () => {
    expect((await post({ topics: [{ ...agility, name: "" }] })).status).toBe(400)
    expect(mocks.setSettings).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await post({ topics: [agility] })).status).toBe(401)
    expect(mocks.setSettings).not.toHaveBeenCalled()
  })

  it("before the first save, shows the old list as one box per line", async () => {
    mocks.getSetting.mockImplementation(async (key: string, fallback: unknown) =>
      key === "blog_scan_queries" ? ["sprint speed research", "sleep recovery research"] : fallback,
    )
    const { topics } = await (await GET()).json()
    expect(topics).toEqual([
      { id: "q1", name: "sprint speed research", keywords: [], active: true },
      { id: "q2", name: "sleep recovery research", keywords: [], active: true },
    ])
  })
})
