import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopProductFile } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function attachFileToProduct(input: {
  product_id: string
  file_name: string
  display_name: string
  storage_path: string
  file_size_bytes: number
  mime_type: string
  sort_order?: number
}): Promise<ShopProductFile> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_files")
    .insert({ ...input, sort_order: input.sort_order ?? 0 })
    .select()
    .single()
  if (error) throw error
  return data as ShopProductFile
}

export async function listFilesForProduct(
  productId: string,
): Promise<ShopProductFile[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_files")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw error
  return data as ShopProductFile[]
}

export async function getProductFile(fileId: string): Promise<ShopProductFile | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_files")
    .select("*")
    .eq("id", fileId)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopProductFile
}

export async function updateProductFile(
  fileId: string,
  updates: Partial<Pick<ShopProductFile, "display_name" | "sort_order">>,
) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_product_files")
    .update(updates)
    .eq("id", fileId)
  if (error) throw error
}

export async function deleteProductFile(fileId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_product_files")
    .delete()
    .eq("id", fileId)
  if (error) throw error
}
