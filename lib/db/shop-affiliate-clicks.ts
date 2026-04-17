import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export async function recordAffiliateClick(input: {
  product_id: string
  ip_address?: string | null
  user_agent?: string | null
  referrer?: string | null
}) {
  const supabase = getClient()
  const { error } = await supabase.from("shop_affiliate_clicks").insert({
    product_id: input.product_id,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    referrer: input.referrer ?? null,
  })
  if (error) throw error
}

export async function countClicksForProduct(productId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_affiliate_clicks")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId)
  if (error) throw error
  return count ?? 0
}

export async function countClicksForProductSince(
  productId: string,
  sinceIso: string,
): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_affiliate_clicks")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId)
    .gte("clicked_at", sinceIso)
  if (error) throw error
  return count ?? 0
}
