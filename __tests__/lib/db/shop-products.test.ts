import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

import {
  listActiveProducts,
  listAllProducts,
  getProductBySlug,
  getProductById,
  updateProduct,
  upsertProductFromSync,
} from "@/lib/db/shop-products"

function chainable(data: unknown, error: unknown = null) {
  const chain: any = {}
  const methods = ["select", "eq", "order", "insert", "update", "upsert", "single", "limit"]
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  chain.then = (resolve: (v: unknown) => void) => resolve({ data, error })
  chain.single.mockResolvedValue({ data, error })
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

describe("shop-products DAL", () => {
  it("listActiveProducts filters by is_active=true sorted by featured/sort_order", async () => {
    const rows = [{ id: "1", name: "Tee", is_active: true }]
    fromMock.mockReturnValueOnce(chainable(rows))
    const result = await listActiveProducts()
    expect(result).toEqual(rows)
    expect(fromMock).toHaveBeenCalledWith("shop_products")
  })

  it("getProductBySlug returns null when not found", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    const result = await getProductBySlug("missing")
    expect(result).toBeNull()
  })

  it("updateProduct throws on DB error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { message: "boom" }))
    await expect(updateProduct("id1", { is_active: true })).rejects.toThrow()
  })

  it("upsertProductFromSync preserves is_active/is_featured/sort_order/description", async () => {
    const existing = { id: "p1", is_active: true, is_featured: true, sort_order: 5, description: "custom" }
    fromMock.mockReturnValueOnce(chainable(existing))
    fromMock.mockReturnValueOnce(chainable({ ...existing, name: "New Name" }))

    const result = await upsertProductFromSync({
      printful_sync_id: 12345,
      name: "New Name",
      slug: "new-name",
      thumbnail_url: "http://example.com/thumb.jpg",
    })

    expect(result.is_active).toBe(true)
    expect(result.is_featured).toBe(true)
    expect(result.sort_order).toBe(5)
    expect(result.description).toBe("custom")
  })
})
