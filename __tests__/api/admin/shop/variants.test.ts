import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/db/shop-variants", () => ({
  updateVariant: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { updateVariant } from "@/lib/db/shop-variants"

const mockAuth = vi.mocked(auth)
const mockUpdateVariant = vi.mocked(updateVariant)

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/shop/variants/var-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const mockParams = Promise.resolve({ id: "var-1" })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PATCH /api/admin/shop/variants/[id]", () => {
  it("returns 403 without admin session (no session)", async () => {
    mockAuth.mockResolvedValue(null as never)

    const { PATCH } = await import("@/app/api/admin/shop/variants/[id]/route")
    const res = await PATCH(makeRequest({ mockup_url_override: "https://example.com/img.png" }), {
      params: mockParams,
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Forbidden")
    expect(mockUpdateVariant).not.toHaveBeenCalled()
  })

  it("returns 403 without admin session (client role)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "client" } } as never)

    const { PATCH } = await import("@/app/api/admin/shop/variants/[id]/route")
    const res = await PATCH(makeRequest({ mockup_url_override: "https://example.com/img.png" }), {
      params: mockParams,
    })

    expect(res.status).toBe(403)
    expect(mockUpdateVariant).not.toHaveBeenCalled()
  })

  it("returns 400 with invalid body (non-URL string)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)

    const { PATCH } = await import("@/app/api/admin/shop/variants/[id]/route")
    const res = await PATCH(makeRequest({ mockup_url_override: "not-a-url" }), {
      params: mockParams,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(mockUpdateVariant).not.toHaveBeenCalled()
  })

  it("returns 200 with updated variant on valid mockup_url_override", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const updatedVariant = {
      id: "var-1",
      product_id: "prod-1",
      name: "Black / M",
      mockup_url_override: "https://example.com/custom-mockup.png",
    }
    mockUpdateVariant.mockResolvedValue(updatedVariant as never)

    const { PATCH } = await import("@/app/api/admin/shop/variants/[id]/route")
    const res = await PATCH(
      makeRequest({ mockup_url_override: "https://example.com/custom-mockup.png" }),
      { params: mockParams },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(updatedVariant)
    expect(mockUpdateVariant).toHaveBeenCalledWith("var-1", {
      mockup_url_override: "https://example.com/custom-mockup.png",
    })
  })

  it("returns 200 when clearing override with null", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const updatedVariant = { id: "var-1", mockup_url_override: null }
    mockUpdateVariant.mockResolvedValue(updatedVariant as never)

    const { PATCH } = await import("@/app/api/admin/shop/variants/[id]/route")
    const res = await PATCH(makeRequest({ mockup_url_override: null }), { params: mockParams })

    expect(res.status).toBe(200)
    expect(mockUpdateVariant).toHaveBeenCalledWith("var-1", { mockup_url_override: null })
  })
})
