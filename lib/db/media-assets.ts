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

export type UpdateMediaAssetInput = Partial<
  Pick<MediaAsset, "width" | "height" | "bytes" | "mime_type">
>

/**
 * Partial update of a media_asset. Scoped to dimension/metadata fields that
 * the upload flow populates after the PUT completes. AI metadata has its
 * own function (`updateMediaAssetAiMetadata`); immutable fields (kind,
 * storage_path, public_url, derived_from_video_id, created_by) stay out.
 */
export async function updateMediaAsset(id: string, patch: UpdateMediaAssetInput): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").update(patch).eq("id", id)
  if (error) throw error
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").delete().eq("id", id)
  if (error) throw error
}

export interface AssetWithPostCount extends MediaAsset {
  post_count: number
}

export interface ListAssetsWithPostCountsFilters {
  kind?: MediaAsset["kind"]
  derived_from_video_id?: string
}

export async function listAssetsWithPostCounts(
  filters: ListAssetsWithPostCountsFilters = {},
): Promise<AssetWithPostCount[]> {
  const supabase = getClient()
  let query = supabase
    .from("media_assets")
    .select("*, social_post_media(media_asset_id)")
    .order("created_at", { ascending: false })
  if (filters.kind) query = query.eq("kind", filters.kind)
  if (filters.derived_from_video_id) query = query.eq("derived_from_video_id", filters.derived_from_video_id)

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as Array<MediaAsset & { social_post_media: Array<{ media_asset_id: string }> }>)
    .map((row) => {
      const { social_post_media, ...asset } = row
      return { ...asset, post_count: (social_post_media ?? []).length }
    })
}
