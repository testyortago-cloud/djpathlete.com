// lib/db/marketing-products.ts
// DAL for the marketing_products catalog (00154). The ads agent reads from
// here when assembling its promotable_inventory signal; the admin UI at
// /admin/marketing/products owns writes.

import { createServiceRoleClient } from "@/lib/supabase"

export interface MarketingProduct {
  slug: string
  name: string
  one_liner: string
  target_audience: string
  signature_phrases: string[]
  pain_points: string[]
  landing_url: string
  lead_form_url: string | null
  price_cents: number | null
  regular_price_cents: number | null
  geo_focus: string[]
  conversion_type: "purchase" | "lead" | "booking"
  status: "active" | "draft" | "archived"
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MarketingProductInput {
  slug: string
  name: string
  one_liner: string
  target_audience: string
  signature_phrases: string[]
  pain_points: string[]
  landing_url: string
  lead_form_url: string | null
  price_cents: number | null
  regular_price_cents: number | null
  geo_focus: string[]
  conversion_type: "purchase" | "lead" | "booking"
  status: "active" | "draft" | "archived"
  notes: string | null
}

export async function listMarketingProducts(): Promise<MarketingProduct[]> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("marketing_products")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as MarketingProduct[]
}

export async function getMarketingProduct(slug: string): Promise<MarketingProduct | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("marketing_products")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingProduct | null) ?? null
}

export async function createMarketingProduct(
  input: MarketingProductInput,
): Promise<MarketingProduct> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("marketing_products")
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as MarketingProduct
}

export async function updateMarketingProduct(
  slug: string,
  patch: Partial<MarketingProductInput>,
): Promise<MarketingProduct> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("marketing_products")
    .update(patch)
    .eq("slug", slug)
    .select()
    .single()
  if (error) throw error
  return data as MarketingProduct
}

export async function deleteMarketingProduct(slug: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from("marketing_products")
    .delete()
    .eq("slug", slug)
  if (error) throw error
}
