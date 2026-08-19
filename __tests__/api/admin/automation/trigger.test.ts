import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))

import { POST, VERCEL_ROUTE_JOBS } from "@/app/api/admin/automation/trigger/route"
import { CRON_CATALOG } from "@/lib/cron-catalog"

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/automation/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/automation/trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    process.env.INTERNAL_CRON_TOKEN = "tok"
    process.env.FIREBASE_PROJECT_ID = "djp-test"
    delete process.env.FIREBASE_RUN_JOB_URL
  })

  it("returns 403 without an admin session", async () => {
    authMock.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ jobName: "sync-platform-analytics" }))
    expect(res.status).toBe(403)
  })

  it("returns 403 for non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await POST(makeRequest({ jobName: "sync-platform-analytics" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 for unknown jobName", async () => {
    const res = await POST(makeRequest({ jobName: "not-a-job" }))
    expect(res.status).toBe(400)
  })

  it("returns 500 when INTERNAL_CRON_TOKEN is missing", async () => {
    delete process.env.INTERNAL_CRON_TOKEN
    const res = await POST(makeRequest({ jobName: "sync-platform-analytics" }))
    expect(res.status).toBe(500)
  })

  it("forwards to the Firebase runJob URL with Bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, jobName: "sync-platform-analytics", result: { synced: 1 } }), {
          status: 200,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const res = await POST(makeRequest({ jobName: "sync-platform-analytics" }))
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://us-central1-djp-test.cloudfunctions.net/runJob")
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok")
    expect(JSON.parse(init.body as string)).toEqual({ jobName: "sync-platform-analytics" })

    vi.unstubAllGlobals()
  })

  it("honors FIREBASE_RUN_JOB_URL override", async () => {
    process.env.FIREBASE_RUN_JOB_URL = "https://custom.fn/runJob/"
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await POST(makeRequest({ jobName: "send-daily-pulse" }))
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe("https://custom.fn/runJob")
    vi.unstubAllGlobals()
  })

  it("returns 502 when the upstream call throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const res = await POST(makeRequest({ jobName: "voice-drift-monitor" }))
    expect(res.status).toBe(502)
    vi.unstubAllGlobals()
  })

  it("forwards a Vercel-route job (sequence-tick) to its internal route with Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, claimed: 0 }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const res = await POST(makeRequest({ jobName: "sequence-tick" }))
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost/api/admin/internal/sequence-tick")
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok")

    vi.unstubAllGlobals()
  })
})

describe("the cron catalog and the Vercel trigger map agree", () => {
  // lib/cron-catalog.ts and VERCEL_ROUTE_JOBS are edited in different files
  // (task-8-brief.md) — a catalog entry with no matching route entry (or
  // vice versa) makes the admin "Run now" button 500 silently.
  it("sequence-tick exists in the catalog and has a Vercel route", () => {
    expect(CRON_CATALOG.find((c) => c.name === "sequence-tick")).toBeTruthy()
    expect(VERCEL_ROUTE_JOBS["sequence-tick"]).toBe("/api/admin/internal/sequence-tick")
  })

  it("pipeline-reconcile exists in the catalog and has a Vercel route", () => {
    expect(CRON_CATALOG.find((c) => c.name === "pipeline-reconcile")).toBeTruthy()
    expect(VERCEL_ROUTE_JOBS["pipeline-reconcile"]).toBe("/api/admin/internal/pipeline-reconcile")
  })

  it("every VERCEL_ROUTE_JOBS key names a real catalog entry", () => {
    const catalogNames = new Set(CRON_CATALOG.map((c) => c.name))
    for (const jobName of Object.keys(VERCEL_ROUTE_JOBS)) {
      expect(catalogNames.has(jobName as (typeof CRON_CATALOG)[number]["name"])).toBe(true)
    }
  })
})
