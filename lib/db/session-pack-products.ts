import { createServiceRoleClient } from "@/lib/supabase"
import type { SessionPackProduct } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function listActiveProducts() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_pack_products")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return data as SessionPackProduct[]
}

export async function listAllProducts() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_pack_products")
    .select("*")
    .order("sort_order", { ascending: true })
  if (error) throw error
  return data as SessionPackProduct[]
}

export async function getProductById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_pack_products").select("*").eq("id", id).single()
  if (error) throw error
  return data as SessionPackProduct
}

export async function createProduct(p: Omit<SessionPackProduct, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_pack_products").insert(p).select().single()
  if (error) throw error
  return data as SessionPackProduct
}

export async function updateProduct(id: string, patch: Partial<SessionPackProduct>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_pack_products").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as SessionPackProduct
}
