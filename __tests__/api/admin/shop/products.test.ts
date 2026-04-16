import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/db/shop-products", () => ({
  updateProduct: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { updateProduct } from "@/lib/db/shop-products"

const mockAuth = vi.mocked(auth)
const mockUpdateProduct = vi.mocked(updateProduct)

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/shop/products/prod-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const mockParams = Promise.resolve({ id: "prod-1" })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PATCH /api/admin/shop/products/[id]", () => {
  it("returns 403 without admin session (no session)", async () => {
    mockAuth.mockResolvedValue(null as never)

    const { PATCH } = await import("@/app/api/admin/shop/products/[id]/route")
    const res = await PATCH(makeRequest({ is_active: true }), { params: mockParams })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Forbidden")
    expect(mockUpdateProduct).not.toHaveBeenCalled()
  })

  it("returns 403 without admin session (client role)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "client" } } as never)

    const { PATCH } = await import("@/app/api/admin/shop/products/[id]/route")
    const res = await PATCH(makeRequest({ is_active: true }), { params: mockParams })

    expect(res.status).toBe(403)
    expect(mockUpdateProduct).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)

    const { PATCH } = await import("@/app/api/admin/shop/products/[id]/route")
    // sort_order must be an integer, not a string
    const res = await PATCH(makeRequest({ sort_order: "not-a-number" }), { params: mockParams })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(mockUpdateProduct).not.toHaveBeenCalled()
  })

  it("returns 200 with updated product on valid body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const updatedProduct = {
      id: "prod-1",
      name: "Test Tee",
      is_active: true,
      is_featured: false,
    }
    mockUpdateProduct.mockResolvedValue(updatedProduct as never)

    const { PATCH } = await import("@/app/api/admin/shop/products/[id]/route")
    const res = await PATCH(makeRequest({ is_active: true }), { params: mockParams })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(updatedProduct)
    expect(mockUpdateProduct).toHaveBeenCalledWith("prod-1", { is_active: true })
  })

  it("returns 200 when toggling is_featured", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } } as never)
    const updatedProduct = { id: "prod-1", name: "Test Tee", is_featured: true }
    mockUpdateProduct.mockResolvedValue(updatedProduct as never)

    const { PATCH } = await import("@/app/api/admin/shop/products/[id]/route")
    const res = await PATCH(makeRequest({ is_featured: true }), { params: mockParams })

    expect(res.status).toBe(200)
    expect(mockUpdateProduct).toHaveBeenCalledWith("prod-1", { is_featured: true })
  })
})
