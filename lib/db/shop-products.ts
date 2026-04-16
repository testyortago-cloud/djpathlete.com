import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopProduct } from "@/types/database"

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
