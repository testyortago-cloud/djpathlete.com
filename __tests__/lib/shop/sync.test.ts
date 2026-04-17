import { describe, it, expect, vi, beforeEach } from "vitest"

// --- Mocks must be declared before any imports that use the mocked modules ---

vi.mock("@/lib/printful", () => ({
  listSyncProducts: vi.fn(),
  getSyncProduct: vi.fn(),
}))

vi.mock("@/lib/db/shop-products", () => ({
  getProductByPrintfulSyncId: vi.fn(),
  upsertProductFromSync: vi.fn(),
}))

vi.mock("@/lib/db/shop-variants", () => ({
  upsertVariantFromSync: vi.fn(),
  markVariantsUnavailable: vi.fn(),
}))

import { listSyncProducts, getSyncProduct } from "@/lib/printful"
import { getProductByPrintfulSyncId, upsertProductFromSync } from "@/lib/db/shop-products"
import { upsertVariantFromSync, markVariantsUnavailable } from "@/lib/db/shop-variants"
import { syncPrintfulCatalog } from "@/lib/shop/sync"

const mockListSyncProducts = vi.mocked(listSyncProducts)
const mockGetSyncProduct = vi.mocked(getSyncProduct)
const mockGetProductByPrintfulSyncId = vi.mocked(getProductByPrintfulSyncId)
const mockUpsertProductFromSync = vi.mocked(upsertProductFromSync)
const mockUpsertVariantFromSync = vi.mocked(upsertVariantFromSync)
const mockMarkVariantsUnavailable = vi.mocked(markVariantsUnavailable)

// Helper builders
function makeSummary(overrides = {}) {
  return {
    id: 101,
    external_id: "ext-101",
    name: "Cool T-Shirt",
    variants: 2,
    synced: 2,
    thumbnail_url: "https://example.com/thumb.png",
    ...overrides,
  }
}

function makeVariant(overrides = {}): import("@/lib/printful").SyncVariant {
  return {
    id: 201,
    external_id: "ext-v-201",
    sync_product_id: 101,
    name: "Cool T-Shirt / S / Black",
    variant_id: 9001,
    retail_price: "24.99",
    currency: "USD",
    sku: "SKU-001",
    product: { image: "https://example.com/product.png", name: "Cool T-Shirt" },
    files: [{ type: "preview", preview_url: "https://example.com/preview.png" }],
    options: [
      { id: "size", value: "S" },
      { id: "color", value: "Black" },
    ],
    is_ignored: false,
    ...overrides,
  }
}

function makeProduct(overrides = {}) {
  return {
    id: "uuid-product-1",
    printful_sync_id: 101,
    slug: "cool-t-shirt",
    name: "Cool T-Shirt",
    description: "",
    thumbnail_url: "https://example.com/thumb.png",
    thumbnail_url_override: null,
    is_active: false,
    is_featured: false,
    sort_order: 0,
    last_synced_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    product_type: "pod" as const,
    affiliate_url: null,
    affiliate_asin: null,
    affiliate_price_cents: null,
    digital_access_days: null,
    digital_signed_url_ttl_seconds: 3600,
    digital_max_downloads: null,
    digital_is_free: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("syncPrintfulCatalog", () => {
  it("iterates Printful products and calls getSyncProduct for each", async () => {
    const summary = makeSummary()
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockListSyncProducts).toHaveBeenCalledOnce()
    expect(mockGetSyncProduct).toHaveBeenCalledOnce()
    expect(mockGetSyncProduct).toHaveBeenCalledWith(101)
  })

  it("passes correct mapped input to upsertProductFromSync (new product — generates slug)", async () => {
    const summary = makeSummary({ name: "Cool T-Shirt", thumbnail_url: "https://example.com/thumb.png" })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockUpsertProductFromSync).toHaveBeenCalledWith({
      printful_sync_id: 101,
      name: "Cool T-Shirt",
      slug: "cool-t-shirt",
      thumbnail_url: "https://example.com/thumb.png",
    })
  })

  it("preserves existing slug on update", async () => {
    const summary = makeSummary({ name: "Cool T-Shirt Updated" })
    const existing = makeProduct({ slug: "my-custom-slug" })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(existing)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct({ slug: "my-custom-slug" }))
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockUpsertProductFromSync).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "my-custom-slug" }),
    )
  })

  it("passes correct mapped input to upsertVariantFromSync (price string to cents)", async () => {
    const summary = makeSummary()
    const variant = makeVariant({ retail_price: "24.99" })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [variant] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockUpsertVariantFromSync.mockResolvedValue({} as never)
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockUpsertVariantFromSync).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "uuid-product-1",
        printful_sync_variant_id: 201,
        printful_variant_id: 9001,
        sku: "SKU-001",
        name: "Cool T-Shirt / S / Black",
        size: "S",
        color: "Black",
        retail_price_cents: 2499,
        printful_cost_cents: 0,
        mockup_url: "https://example.com/preview.png",
      }),
    )
  })

  it("converts whole-dollar price string correctly (\"10\" → 1000)", async () => {
    const summary = makeSummary()
    const variant = makeVariant({ retail_price: "10" })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [variant] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockUpsertVariantFromSync.mockResolvedValue({} as never)
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockUpsertVariantFromSync).toHaveBeenCalledWith(
      expect.objectContaining({ retail_price_cents: 1000 }),
    )
  })

  it("calls markVariantsUnavailable with the list of current sync variant IDs", async () => {
    const summary = makeSummary()
    const v1 = makeVariant({ id: 201 })
    const v2 = makeVariant({ id: 202, sku: "SKU-002" })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [v1, v2] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockUpsertVariantFromSync.mockResolvedValue({} as never)
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockMarkVariantsUnavailable).toHaveBeenCalledWith("uuid-product-1", [201, 202])
  })

  it("returns correct summary { added, updated, deactivated_variants }", async () => {
    // Two products: one new, one existing
    const s1 = makeSummary({ id: 101, name: "Product One" })
    const s2 = makeSummary({ id: 102, name: "Product Two" })
    const existingProduct = makeProduct({ printful_sync_id: 102, slug: "product-two" })

    mockListSyncProducts.mockResolvedValue([s1, s2])
    mockGetSyncProduct.mockResolvedValue({ sync_product: s1, sync_variants: [] })
    mockGetProductByPrintfulSyncId
      .mockResolvedValueOnce(null)        // s1 is new
      .mockResolvedValueOnce(existingProduct) // s2 is existing
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockMarkVariantsUnavailable
      .mockResolvedValueOnce(3) // s1: 3 deactivated
      .mockResolvedValueOnce(1) // s2: 1 deactivated

    const result = await syncPrintfulCatalog()

    expect(result).toEqual({ added: 1, updated: 1, deactivated_variants: 4 })
  })

  it("skips variants where is_ignored=true", async () => {
    const summary = makeSummary()
    const ignoredVariant = makeVariant({ id: 201, is_ignored: true })
    const normalVariant = makeVariant({ id: 202, sku: "SKU-002", is_ignored: false })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({
      sync_product: summary,
      sync_variants: [ignoredVariant, normalVariant],
    })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockUpsertVariantFromSync.mockResolvedValue({} as never)
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    // upsertVariantFromSync should only be called once (for the non-ignored variant)
    expect(mockUpsertVariantFromSync).toHaveBeenCalledOnce()
    // markVariantsUnavailable should only include the non-ignored variant id
    expect(mockMarkVariantsUnavailable).toHaveBeenCalledWith("uuid-product-1", [202])
  })

  it("falls back to product.image when no preview file is present", async () => {
    const summary = makeSummary()
    const variant = makeVariant({
      files: [{ type: "default", preview_url: "https://example.com/default.png" }],
      product: { image: "https://example.com/fallback-product.png", name: "Cool T-Shirt" },
    })
    mockListSyncProducts.mockResolvedValue([summary])
    mockGetSyncProduct.mockResolvedValue({ sync_product: summary, sync_variants: [variant] })
    mockGetProductByPrintfulSyncId.mockResolvedValue(null)
    mockUpsertProductFromSync.mockResolvedValue(makeProduct())
    mockUpsertVariantFromSync.mockResolvedValue({} as never)
    mockMarkVariantsUnavailable.mockResolvedValue(0)

    await syncPrintfulCatalog()

    expect(mockUpsertVariantFromSync).toHaveBeenCalledWith(
      expect.objectContaining({ mockup_url: "https://example.com/fallback-product.png" }),
    )
  })
})
