import { createServiceRoleClient } from "@/lib/supabase"
import type { ProductType, ShopProduct } from "@/types/database"
import { createDefaultVariant } from "@/lib/db/shop-variants"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

const SORT_OPTIONS = [
  { column: "is_featured", ascending: false },
  { column: "sort_order", ascending: true },
  { column: "created_at", ascending: false },
] as const

export async function listActiveProducts() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as ShopProduct[]
}

export async function listAllProducts() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as ShopProduct[]
}

export async function getProductBySlug(slug: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("slug", slug)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopProduct
}

export async function getProductById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopProduct
}

export async function getProductByPrintfulSyncId(syncId: number) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("printful_sync_id", syncId)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopProduct
}

export async function updateProduct(
  id: string,
  updates: Partial<Omit<ShopProduct, "id" | "created_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ShopProduct
}

export async function deleteProduct(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("shop_products").delete().eq("id", id)
  if (error) throw error
}

export async function upsertProductFromSync(input: {
  printful_sync_id: number
  name: string
  slug: string
  thumbnail_url: string
}) {
  const existing = await getProductByPrintfulSyncId(input.printful_sync_id)

  if (existing) {
    // Preserve: is_active, is_featured, sort_order, description, slug, thumbnail_url_override
    // Always update: name, thumbnail_url, last_synced_at
    return await updateProduct(existing.id, {
      name: input.name,
      thumbnail_url: input.thumbnail_url,
      last_synced_at: new Date().toISOString(),
    })
  }

  // Insert with defaults
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .insert({
      printful_sync_id: input.printful_sync_id,
      name: input.name,
      slug: input.slug,
      thumbnail_url: input.thumbnail_url,
      is_active: false,
      is_featured: false,
      sort_order: 0,
      description: "",
      last_synced_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data as ShopProduct
}

export async function createAffiliateProduct(input: {
  name: string
  slug: string
  description: string
  thumbnail_url: string
  affiliate_url: string
  affiliate_asin?: string | null
  affiliate_price_cents?: number | null
}): Promise<ShopProduct> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description,
      thumbnail_url: input.thumbnail_url,
      product_type: "affiliate",
      affiliate_url: input.affiliate_url,
      affiliate_asin: input.affiliate_asin ?? null,
      affiliate_price_cents: input.affiliate_price_cents ?? null,
      is_active: false,
      is_featured: false,
      sort_order: 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as ShopProduct
}

export async function listProductsByType(type: ProductType): Promise<ShopProduct[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("product_type", type)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as ShopProduct[]
}

export async function listActiveProductsByType(
  type: ProductType,
): Promise<ShopProduct[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("product_type", type)
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as ShopProduct[]
}

export async function createDigitalProduct(input: {
  name: string
  slug: string
  description: string
  thumbnail_url?: string
  digital_is_free: boolean
  retail_price_cents?: number
  digital_access_days?: number | null
  digital_signed_url_ttl_seconds: number
  digital_max_downloads?: number | null
}): Promise<ShopProduct> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description,
      thumbnail_url: input.thumbnail_url ?? "",
      product_type: "digital",
      digital_is_free: input.digital_is_free,
      digital_access_days: input.digital_access_days ?? null,
      digital_signed_url_ttl_seconds: input.digital_signed_url_ttl_seconds,
      digital_max_downloads: input.digital_max_downloads ?? null,
      is_active: false,
      is_featured: false,
      sort_order: 0,
    })
    .select()
    .single()
  if (error) throw error
  const product = data as ShopProduct

  if (!input.digital_is_free) {
    if (!input.retail_price_cents || input.retail_price_cents <= 0) {
      throw new Error("paid digital product requires retail_price_cents")
    }
    await createDefaultVariant({
      product_id: product.id,
      retail_price_cents: input.retail_price_cents,
      thumbnail_url: product.thumbnail_url,
    })
  }
  return product
}
