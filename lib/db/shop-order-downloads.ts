import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopOrderDownload } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createOrderDownload(input: {
  order_id: string
  product_id: string
  file_id: string
  access_expires_at: string | null
  max_downloads: number | null
}): Promise<ShopOrderDownload> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_order_downloads")
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as ShopOrderDownload
}

export async function listDownloadsForOrder(
  orderId: string,
): Promise<ShopOrderDownload[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_order_downloads")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data as ShopOrderDownload[]
}

export async function getOrderDownload(
  id: string,
): Promise<ShopOrderDownload | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_order_downloads")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopOrderDownload
}

export async function consumeDownload(
  downloadId: string,
): Promise<ShopOrderDownload | null> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("consume_shop_download", {
    download_id: downloadId,
  })
  if (error) throw error
  // PostgREST returns a NULL composite as an object with all-null fields.
  if (!data || (data as { id: string | null }).id === null) return null
  return data as ShopOrderDownload
}

export async function revokeDownload(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ access_expires_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function revokeAllDownloadsForOrder(orderId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ access_expires_at: new Date().toISOString() })
    .eq("order_id", orderId)
  if (error) throw error
}

export async function extendDownloadAccess(id: string, newExpiresAtIso: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ access_expires_at: newExpiresAtIso })
    .eq("id", id)
  if (error) throw error
}

export async function bumpMaxDownloads(id: string, newMax: number | null) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ max_downloads: newMax })
    .eq("id", id)
  if (error) throw error
}
