// lib/db/media-assets.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { MediaAsset } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export type CreateMediaAssetInput = Omit<MediaAsset, "id" | "created_at" | "updated_at">

export async function createMediaAsset(input: CreateMediaAssetInput): Promise<MediaAsset> {
  const supabase = getClient()
  const { data, error } = await supabase.from("media_assets").insert(input).select().single()
  if (error) throw error
  return data as MediaAsset
}

export async function getMediaAssetById(id: string): Promise<MediaAsset | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("media_assets")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as MediaAsset | null) ?? null
}

export interface ListMediaAssetsFilters {
  kind?: MediaAsset["kind"]
  derived_from_video_id?: string
}

export async function listMediaAssets(filters: ListMediaAssetsFilters = {}): Promise<MediaAsset[]> {
  const supabase = getClient()
  let query = supabase.from("media_assets").select("*").order("created_at", { ascending: false })
  if (filters.kind) query = query.eq("kind", filters.kind)
  if (filters.derived_from_video_id) query = query.eq("derived_from_video_id", filters.derived_from_video_id)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as MediaAsset[]
}

export interface MediaAssetAiMetadata {
  ai_alt_text: string | null
  ai_analysis: Record<string, unknown> | null
}

export async function updateMediaAssetAiMetadata(
  id: string,
  metadata: Partial<MediaAssetAiMetadata>,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").update(metadata).eq("id", id)
  if (error) throw error
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").delete().eq("id", id)
  if (error) throw error
}
