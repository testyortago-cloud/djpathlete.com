import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { SYSTEM_USER_ID } from "@/lib/system-user"

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
// G35. The seam is mocked to an id nothing else in the job could produce.
// SYSTEM_USER_ID (the job's userId) and the platform business id are the SAME
// literal, "00000000-0000-0000-0000-000000000001", so an assertion on the real
// id could not tell a stamp read from the seam from `businessId: userId`.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz-g35" }))

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

  // G35. MUTANTS: no businessId (today's input); `businessId: SYSTEM_USER_ID`;
  // the platform literal inline. The last two equal the REAL platform id, so
  // only the seam mocked to a distinct id above tells them apart.
  it("stamps the platform business into the job input, read from the seam", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    jobSetMock.mockResolvedValueOnce(undefined)
    await call()
    const jobArg = jobSetMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }
    expect(jobArg.input).toEqual({
      userId: SYSTEM_USER_ID,
      businessId: "platform-biz-g35",
      runDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })
})
