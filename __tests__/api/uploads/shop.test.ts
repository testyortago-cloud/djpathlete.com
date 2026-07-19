// @vitest-environment node
// Server-route test: must run under the node environment. jsdom shadows
// File/FormData, and Node 24's undici multipart parser brand-checks the Files
// it builds against its own class — under jsdom, parsing ANY file part throws
// (webidl.is.File assert) or hangs. Node env keeps every web global coherent.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

const mockSave = vi.fn()
const mockMakePublic = vi.fn()
const mockFile = vi.fn(() => ({ save: mockSave, makePublic: mockMakePublic }))
const mockBucket = vi.fn(() => ({ name: "test-bucket", file: mockFile }))

vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: vi.fn(() => ({ bucket: mockBucket })),
}))

import { auth } from "@/lib/auth"
import { POST } from "@/app/api/uploads/shop/route"
// jsdom's File hangs Node-undici's request-body serializer (multipart header is
// set but formData() never resolves under Node 24). node:buffer's File is the
// runtime's real implementation and streams correctly; jsdom's FormData wrapper
// itself is fine. Probe-verified 2026-07-19.
import { File as NodeFile } from "node:buffer"

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockResolvedValue(undefined)
  mockMakePublic.mockResolvedValue(undefined)
})

function makeFormData(file?: File): FormData {
  const fd = new FormData()
  if (file) fd.append("file", file)
  return fd
}

function makeRequest(formData: FormData): Request {
  return new Request("http://localhost/api/uploads/shop", {
    method: "POST",
    body: formData,
  })
}

describe("POST /api/uploads/shop", () => {
  it("returns 403 when there is no session", async () => {
    mockAuth.mockResolvedValue(null as never)
    const fd = makeFormData(new NodeFile([Buffer.from("hi")], "x.png", { type: "image/png" }))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Forbidden")
  })

  it("returns 403 when the user is not an admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "client" } } as never)
    const fd = makeFormData(new NodeFile([Buffer.from("hi")], "x.png", { type: "image/png" }))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(403)
  })

  it("returns 400 when form data is missing the file field", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const fd = new FormData()
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Missing file")
  })

  it("returns 413 when file exceeds 5MB", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    // File.size is a read-only getter and FormData won't carry plain objects,
    // so we mock formData() on the request directly.
    const bigFileLike = {
      size: 6 * 1024 * 1024,
      type: "image/png",
      arrayBuffer: async () => new ArrayBuffer(1),
    }
    const mockFd = { get: (key: string) => (key === "file" ? bigFileLike : null) }
    const request = { formData: async () => mockFd } as unknown as Request
    // Provide a fake session via auth mock (already set above)
    const res = await POST(request)
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toContain("too large")
  })

  it("returns 415 when content type is not allowed", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const fd = makeFormData(new NodeFile([Buffer.from("gif89a")], "x.gif", { type: "image/gif" }))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toBe("Unsupported type")
  })

  it("returns 200 with a public storage URL on success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const fd = makeFormData(new NodeFile([Buffer.from("png-data")], "photo.png", { type: "image/png" }))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toMatch(/^https:\/\/storage\.googleapis\.com\/test-bucket\/shop\/.+\.png$/)
    expect(mockSave).toHaveBeenCalledOnce()
    expect(mockMakePublic).toHaveBeenCalledOnce()
  })

  it("returns 200 with .jpg extension for image/jpeg uploads", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const fd = makeFormData(new NodeFile([Buffer.from("jpeg-data")], "photo.jpg", { type: "image/jpeg" }))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toMatch(/\.jpg$/)
  })

  it("returns 200 with .webp extension for image/webp uploads", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const fd = makeFormData(new NodeFile([Buffer.from("webp-data")], "photo.webp", { type: "image/webp" }))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toMatch(/\.webp$/)
  })
})
