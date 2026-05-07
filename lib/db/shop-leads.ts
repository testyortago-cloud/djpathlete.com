import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopLead } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function upsertLead(input: {
  product_id: string
  email: string
  ip_address?: string | null
}): Promise<ShopLead> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_leads")
    .upsert(
      {
        product_id: input.product_id,
        email: input.email.toLowerCase(),
        ip_address: input.ip_address ?? null,
      },
      { onConflict: "product_id,email", ignoreDuplicates: false },
    )
    .select()
    .single()
  if (error) throw error
  return data as ShopLead
}

export async function markLeadSynced(id: string, resendContactId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_leads")
    .update({
      resend_sync_status: "synced",
      resend_contact_id: resendContactId,
      resend_sync_error: null,
    })
    .eq("id", id)
  if (error) throw error
}

export async function markLeadFailed(id: string, errorMessage: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_leads")
    .update({
      resend_sync_status: "failed",
      resend_sync_error: errorMessage.slice(0, 1000),
    })
    .eq("id", id)
  if (error) throw error
}

export async function listLeads(filter: {
  productId?: string
  status?: "pending" | "synced" | "failed"
  sinceIso?: string
  untilIso?: string
  limit?: number
}): Promise<ShopLead[]> {
  const supabase = getClient()
  let q = supabase
    .from("shop_leads")
    .select("*")
    .order("created_at", { ascending: false })
  if (filter.productId) q = q.eq("product_id", filter.productId)
  if (filter.status) q = q.eq("resend_sync_status", filter.status)
  if (filter.sinceIso) q = q.gte("created_at", filter.sinceIso)
  if (filter.untilIso) q = q.lte("created_at", filter.untilIso)
  if (filter.limit) q = q.limit(filter.limit)
  const { data, error } = await q
  if (error) throw error
  return data as ShopLead[]
}

export async function countLeadsForProduct(productId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_leads")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId)
  if (error) throw error
  return count ?? 0
}

export async function getLead(id: string): Promise<ShopLead | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_leads")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopLead
}

export async function countLeadsInRange(from: Date, to: Date): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_leads")
    .select("id", { head: true, count: "exact" })
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
  if (error) throw error
  return count ?? 0
}
