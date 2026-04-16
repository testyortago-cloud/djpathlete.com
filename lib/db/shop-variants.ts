import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopProductVariant } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function listVariantsForProduct(productId: string): Promise<ShopProductVariant[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("product_id", productId)
    .eq("is_available", true)
    .order("retail_price_cents", { ascending: true })
  if (error) throw error
  return (data ?? []) as ShopProductVariant[]
}

export async function listAllVariantsForProduct(productId: string): Promise<ShopProductVariant[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("retail_price_cents", { ascending: true })
  if (error) throw error
  return (data ?? []) as ShopProductVariant[]
}

export async function getVariantById(id: string): Promise<ShopProductVariant | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProductVariant
}

export async function getVariantsByIds(ids: string[]): Promise<ShopProductVariant[]> {
  if (ids.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .in("id", ids)
  if (error) throw error
  return (data ?? []) as ShopProductVariant[]
}

export async function getVariantByPrintfulSyncVariantId(
  syncVariantId: number,
): Promise<ShopProductVariant | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("printful_sync_variant_id", syncVariantId)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProductVariant
}

interface SyncVariantInput {
  product_id: string
  printful_sync_variant_id: number
  printful_variant_id: number
  sku: string
  name: string
  size: string | null
  color: string | null
  retail_price_cents: number
  printful_cost_cents: number
  mockup_url: string
}

export async function upsertVariantFromSync(input: SyncVariantInput): Promise<ShopProductVariant> {
  const existing = await getVariantByPrintfulSyncVariantId(input.printful_sync_variant_id)
  const supabase = getClient()

  if (existing) {
    // Update fields that sync should overwrite; preserve mockup_url_override
    const { data, error } = await supabase
      .from("shop_product_variants")
      .update({
        printful_variant_id: input.printful_variant_id,
        sku: input.sku,
        name: input.name,
        size: input.size,
        color: input.color,
        retail_price_cents: input.retail_price_cents,
        printful_cost_cents: input.printful_cost_cents,
        mockup_url: input.mockup_url,
        is_available: true,
      })
      .eq("id", existing.id)
      .select()
      .single()
    if (error) throw error
    return data as ShopProductVariant
  }

  // Insert new variant
  const { data, error } = await supabase
    .from("shop_product_variants")
    .insert({ ...input, is_available: true })
    .select()
    .single()
  if (error) throw error
  return data as ShopProductVariant
}

/**
 * Mark variants unavailable for a product.
 * If keepSyncVariantIds is non-empty, only marks those NOT in the keep list.
 * If keepSyncVariantIds is empty, marks ALL currently available variants for the product.
 * Returns the count of rows marked unavailable.
 */
export async function markVariantsUnavailable(
  productId: string,
  keepSyncVariantIds: number[],
): Promise<number> {
  const supabase = getClient()
  let query = supabase
    .from("shop_product_variants")
    .update({ is_available: false })
    .eq("product_id", productId)
    .eq("is_available", true)

  if (keepSyncVariantIds.length > 0) {
    query = query.not(
      "printful_sync_variant_id",
      "in",
      `(${keepSyncVariantIds.join(",")})`,
    )
  }

  const { data, error } = await query.select("id")
  if (error) throw error
  return (data ?? []).length
}

export async function updateVariant(
  id: string,
  updates: Partial<Pick<ShopProductVariant, "mockup_url_override">>,
): Promise<ShopProductVariant> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ShopProductVariant
}
