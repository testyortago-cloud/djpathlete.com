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
  const { data, error } = await supabase.from("media_assets").select("*").eq("id", id).maybeSingle()
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

export async function updateMediaAssetAiMetadata(id: string, metadata: Partial<MediaAssetAiMetadata>): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").update(metadata).eq("id", id)
  if (error) throw error
}

export type UpdateMediaAssetInput = Partial<Pick<MediaAsset, "width" | "height" | "bytes" | "mime_type">>

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

/**
 * The set of video_upload ids that have at least one rendered reel or captioned
 * cut (a media_asset with ai_analysis.origin === 'split_reel' OR 'captioned_cut').
 * Used by the Content Studio pipeline to badge videos that have a rendered
 * output, distinct from videos that only have text-caption posts.
 */
export async function listRenderedVideoIds(): Promise<Set<string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("media_assets")
    .select("derived_from_video_id, ai_analysis")
    .eq("kind", "video")
    .not("derived_from_video_id", "is", null)
  if (error) throw error
  const ids = new Set<string>()
  const RENDERED_ORIGINS = new Set(["captioned_cut", "split_reel"])
  for (const row of (data ?? []) as Array<{
    derived_from_video_id: string | null
    ai_analysis: Record<string, unknown> | null
  }>) {
    if (row.derived_from_video_id && RENDERED_ORIGINS.has(row.ai_analysis?.origin as string)) {
      ids.add(row.derived_from_video_id)
    }
  }
  return ids
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

  return ((data ?? []) as Array<MediaAsset & { social_post_media: Array<{ media_asset_id: string }> }>).map((row) => {
    const { social_post_media, ...asset } = row
    return { ...asset, post_count: (social_post_media ?? []).length }
  })
}

export interface AssetLinkedPost {
  id: string
  platform: string
  content: string
  approval_status: string
  post_type: string
  scheduled_at: string | null
  published_at: string | null
}

export interface AssetWithLinkedPosts {
  asset: MediaAsset
  posts: AssetLinkedPost[]
}

export async function getAssetWithLinkedPosts(id: string): Promise<AssetWithLinkedPosts | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("media_assets")
    .select(
      "*, social_post_media(social_posts(id, platform, content, approval_status, post_type, scheduled_at, published_at))",
    )
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const raw = data as MediaAsset & {
    social_post_media?: Array<{ social_posts: AssetLinkedPost | null }>
  }
  const { social_post_media, ...asset } = raw
  const posts: AssetLinkedPost[] = (social_post_media ?? [])
    .map((row) => row.social_posts)
    .filter((p): p is AssetLinkedPost => p !== null)
  return { asset: asset as MediaAsset, posts }
}

/**
 * Map of media_asset id → storage_path for a set of ids (Phase 3: sign per-window
 * b-roll clips in the review panel). Missing ids are simply absent from the map.
 */
export async function getMediaAssetStoragePaths(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase.from("media_assets").select("id,storage_path").in("id", ids)
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.id as string, r.storage_path as string]))
}

/**
 * The most recent Split Reel render for a source video, with its linked draft
 * posts — powers the Split Reel drawer panel (Phase 3). Returns null if the video
 * has no reel yet. Mirrors the captioned-cut pattern, filtering
 * `ai_analysis.origin === "split_reel"` (the worker stamps this on the reel asset).
 */
export async function getLatestSplitReelForVideo(videoUploadId: string): Promise<AssetWithLinkedPosts | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("media_assets")
    .select(
      "*, social_post_media(social_posts(id, platform, content, approval_status, post_type, scheduled_at, published_at))",
    )
    .eq("kind", "video")
    .eq("derived_from_video_id", videoUploadId)
    .order("created_at", { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as Array<
    MediaAsset & {
      ai_analysis: Record<string, unknown> | null
      social_post_media?: Array<{ social_posts: AssetLinkedPost | null }>
    }
  >
  const match = rows.find((r) => r.ai_analysis?.origin === "split_reel")
  if (!match) return null

  const { social_post_media, ...asset } = match
  const posts: AssetLinkedPost[] = (social_post_media ?? [])
    .map((row) => row.social_posts)
    .filter((p): p is AssetLinkedPost => p !== null)
  return { asset: asset as MediaAsset, posts }
}
