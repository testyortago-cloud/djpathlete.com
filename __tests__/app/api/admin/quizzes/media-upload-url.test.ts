// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const auth = vi.fn()
const resolveAdminTenantForRequest = vi.fn()
const getQuizDefinition = vi.fn()
const getSignedUrl = vi.fn(async () => ["https://signed.example/put"])
const file = vi.fn(() => ({ getSignedUrl }))

vi.mock("@/lib/auth", () => ({ auth: () => auth() }))
vi.mock("@/lib/db/quizzes", () => ({ getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a) }))
vi.mock("@/lib/firebase-admin", () => ({ getAdminStorage: () => ({ bucket: () => ({ name: "bucket-x", file }) }) }))
vi.mock("@/lib/tenancy/resolve", async () => {
  class NoAccessibleBusinessError extends Error {}
  return { NoAccessibleBusinessError, resolveAdminTenantForRequest: (...a: unknown[]) => resolveAdminTenantForRequest(...a) }
})

import { POST } from "@/app/api/admin/quizzes/[id]/media-upload-url/route"

const QUIZ_ID = "1b93a8c7-c08f-4716-a6e0-226d61bdf820"
const call = (body: unknown, id = QUIZ_ID) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: "u", role: "admin" } })
  resolveAdminTenantForRequest.mockResolvedValue({ businessId: "biz" })
  getQuizDefinition.mockResolvedValue({ id: QUIZ_ID, key: "rotational-performance-index" })
})

describe("POST media-upload-url", () => {
  it("404s a non-admin and signs nothing", async () => {
    auth.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await call({ filename: "a.mp4", contentType: "video/mp4" })).status).toBe(404)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it("404s a quiz outside the caller's business", async () => {
    getQuizDefinition.mockResolvedValue(null)
    expect((await call({ filename: "a.mp4", contentType: "video/mp4" })).status).toBe(404)
    expect(getQuizDefinition).toHaveBeenCalledWith("biz", QUIZ_ID)
  })

  it("400s a content type that is not a clip or a poster", async () => {
    expect((await call({ filename: "a.exe", contentType: "application/octet-stream" })).status).toBe(400)
  })

  it("signs a WRITE url under quiz-media/<quizKey>/ and returns the durable public url", async () => {
    const res = await call({ filename: "Test 3.mov", contentType: "video/quicktime" })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { uploadUrl: string; publicUrl: string }
    expect(json.uploadUrl).toBe("https://signed.example/put")
    const path = (file.mock.calls[0] as unknown as [string])[0]
    expect(path).toMatch(/^quiz-media\/rotational-performance-index\/\d+-Test_3\.mov$/)
    expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ version: "v4", action: "write", contentType: "video/quicktime" }))
    expect(json.publicUrl).toBe(`https://firebasestorage.googleapis.com/v0/b/bucket-x/o/${encodeURIComponent(path)}?alt=media`)
  })
})
