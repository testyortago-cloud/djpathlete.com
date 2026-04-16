import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

import {
  listVariantsForProduct,
  listAllVariantsForProduct,
  getVariantById,
  getVariantsByIds,
  getVariantByPrintfulSyncVariantId,
  upsertVariantFromSync,
  markVariantsUnavailable,
  updateVariant,
} from "@/lib/db/shop-variants"

function chainable(data: unknown, error: unknown = null) {
  const chain: any = {}
  const methods = [
    "select",
    "eq",
    "order",
    "insert",
    "update",
    "upsert",
    "single",
    "limit",
    "in",
    "not",
  ]
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

describe("shop-variants DAL", () => {
  // Test 1: listVariantsForProduct filters by product_id + is_available=true, sorts by price asc
  it("listVariantsForProduct filters by product_id and is_available=true sorted by price asc", async () => {
    const rows = [
      { id: "v1", product_id: "p1", retail_price_cents: 1000, is_available: true },
      { id: "v2", product_id: "p1", retail_price_cents: 2000, is_available: true },
    ]
    const chain = chainable(rows)
    fromMock.mockReturnValueOnce(chain)
    const result = await listVariantsForProduct("p1")
    expect(result).toEqual(rows)
    expect(fromMock).toHaveBeenCalledWith("shop_product_variants")
    expect(chain.eq).toHaveBeenCalledWith("product_id", "p1")
    expect(chain.eq).toHaveBeenCalledWith("is_available", true)
    expect(chain.order).toHaveBeenCalledWith("retail_price_cents", { ascending: true })
  })

  // Test 2: getVariantById returns null on PGRST116
  it("getVariantById returns null when not found (PGRST116)", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    const result = await getVariantById("missing-id")
    expect(result).toBeNull()
  })

  it("getVariantById throws on non-PGRST116 error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "OTHER", message: "DB error" }))
    await expect(getVariantById("id1")).rejects.toMatchObject({ code: "OTHER" })
  })

  // Test 3: getVariantsByIds([]) returns empty array without calling DB
  it("getVariantsByIds([]) returns empty array without calling DB", async () => {
    const result = await getVariantsByIds([])
    expect(result).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("getVariantsByIds with ids calls .in('id', ids)", async () => {
    const rows = [{ id: "v1" }, { id: "v2" }]
    const chain = chainable(rows)
    fromMock.mockReturnValueOnce(chain)
    const result = await getVariantsByIds(["v1", "v2"])
    expect(result).toEqual(rows)
    expect(chain.in).toHaveBeenCalledWith("id", ["v1", "v2"])
  })

  // Test 4: upsertVariantFromSync preserves mockup_url_override on update
  it("upsertVariantFromSync preserves mockup_url_override on update", async () => {
    const existing = {
      id: "v1",
      product_id: "p1",
      printful_sync_variant_id: 99,
      mockup_url: "http://old.com/mock.jpg",
      mockup_url_override: "http://custom.com/override.jpg",
      is_available: true,
    }
    const updated = {
      ...existing,
      sku: "NEW-SKU",
      mockup_url: "http://new.com/mock.jpg",
      mockup_url_override: "http://custom.com/override.jpg", // preserved
    }

    // First call: getVariantByPrintfulSyncVariantId (uses .single())
    fromMock.mockReturnValueOnce(chainable(existing))
    // Second call: the update query (uses .single())
    fromMock.mockReturnValueOnce(chainable(updated))

    const result = await upsertVariantFromSync({
      product_id: "p1",
      printful_sync_variant_id: 99,
      printful_variant_id: 100,
      sku: "NEW-SKU",
      name: "Updated Variant",
      size: "L",
      color: "Red",
      retail_price_cents: 2500,
      printful_cost_cents: 1200,
      mockup_url: "http://new.com/mock.jpg",
    })

    // The override should be preserved (not overwritten by the new mockup_url)
    expect(result.mockup_url_override).toBe("http://custom.com/override.jpg")
    expect(result.sku).toBe("NEW-SKU")
  })

  it("upsertVariantFromSync inserts new variant with is_available=true when not existing", async () => {
    const newVariant = {
      id: "v-new",
      product_id: "p1",
      printful_sync_variant_id: 200,
      is_available: true,
    }

    // First call: getVariantByPrintfulSyncVariantId returns null (not found)
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    // Second call: insert
    fromMock.mockReturnValueOnce(chainable(newVariant))

    const result = await upsertVariantFromSync({
      product_id: "p1",
      printful_sync_variant_id: 200,
      printful_variant_id: 201,
      sku: "NEW-SKU-2",
      name: "Brand New Variant",
      size: "M",
      color: "Blue",
      retail_price_cents: 3000,
      printful_cost_cents: 1500,
      mockup_url: "http://new.com/mock2.jpg",
    })

    expect(result.is_available).toBe(true)
  })

  // Test 5: markVariantsUnavailable with empty keep list marks all
  it("markVariantsUnavailable with empty keep list marks ALL available variants unavailable", async () => {
    const markedRows = [{ id: "v1" }, { id: "v2" }, { id: "v3" }]
    const chain = chainable(markedRows)
    fromMock.mockReturnValueOnce(chain)

    const count = await markVariantsUnavailable("p1", [])

    expect(count).toBe(3)
    // Should NOT call .not() when keep list is empty
    expect(chain.not).not.toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("product_id", "p1")
    expect(chain.eq).toHaveBeenCalledWith("is_available", true)
  })

  it("markVariantsUnavailable with keep list excludes kept sync variant ids", async () => {
    const markedRows = [{ id: "v3" }]
    const chain = chainable(markedRows)
    fromMock.mockReturnValueOnce(chain)

    const count = await markVariantsUnavailable("p1", [101, 102])

    expect(count).toBe(1)
    expect(chain.not).toHaveBeenCalledWith(
      "printful_sync_variant_id",
      "in",
      "(101,102)",
    )
  })

  // Test 6: updateVariant throws on error
  it("updateVariant throws on DB error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { message: "update failed" }))
    await expect(
      updateVariant("v1", { mockup_url_override: "http://x.com/img.jpg" }),
    ).rejects.toThrow()
  })

  it("updateVariant returns updated variant on success", async () => {
    const updated = { id: "v1", mockup_url_override: "http://x.com/img.jpg" }
    fromMock.mockReturnValueOnce(chainable(updated))
    const result = await updateVariant("v1", {
      mockup_url_override: "http://x.com/img.jpg",
    })
    expect(result.mockup_url_override).toBe("http://x.com/img.jpg")
  })
})
