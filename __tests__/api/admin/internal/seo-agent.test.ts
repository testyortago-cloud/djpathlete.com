import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const isCronSkipped = vi.fn()
const jobSetMock = vi.fn()
const jobDocMock = vi.fn(() => ({ id: "new-job-id", set: jobSetMock }))
const collectionMock = vi.fn(() => ({ doc: jobDocMock }))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: collectionMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  isCronSkipped.mockReset()
  jobSetMock.mockReset()
  jobDocMock.mockClear()
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/seo-agent/route")
  const req = new NextRequest("https://example.test/api/admin/internal/seo-agent", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/seo-agent", () => {
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

  it("happy path: enqueues ai_job and returns 202", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    jobSetMock.mockResolvedValueOnce(undefined)
    const res = await call()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: "new-job-id", status: "pending" })
    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(jobArg).toMatchObject({
      type: "seo_agent_run",
      status: "pending",
      triggeredBy: "seo_agent_cron",
    })
  })
})
