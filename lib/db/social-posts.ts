// lib/db/social-posts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPost, SocialPlatform, SocialApprovalStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSocialPost(
  post: Omit<
    SocialPost,
    "id" | "created_at" | "updated_at" | "published_at" | "platform_post_id" | "rejection_notes" | "post_type"
  > & { post_type?: SocialPost["post_type"] },
): Promise<SocialPost> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_posts").insert(post).select().single()
  if (error) throw error
  return data as SocialPost
}

export async function getSocialPostById(id: string): Promise<SocialPost | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as SocialPost | null) ?? null
}

export interface ListSocialPostsFilters {
  platform?: SocialPlatform
  approval_status?: SocialApprovalStatus
}

export async function listSocialPosts(
  filters: ListSocialPostsFilters = {},
): Promise<SocialPost[]> {
  const supabase = getClient()
  let query = supabase.from("social_posts").select("*").order("created_at", { ascending: false })
  if (filters.platform) query = query.eq("platform", filters.platform)
  if (filters.approval_status) query = query.eq("approval_status", filters.approval_status)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SocialPost[]
}

export async function listSocialPostsBySourceVideo(videoId: string): Promise<SocialPost[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .select("*")
    .eq("source_video_id", videoId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as SocialPost[]
}

export async function updateSocialPost(
  id: string,
  updates: Partial<Omit<SocialPost, "id" | "created_at">>,
): Promise<SocialPost> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as SocialPost
}

export async function deleteSocialPost(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("social_posts").delete().eq("id", id)
  if (error) throw error
}

export interface PipelinePostRow extends SocialPost {
  source_video_filename: string | null
}

export async function listSocialPostsForPipeline(): Promise<PipelinePostRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .select("*, video_uploads(original_filename)")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []).map(
    (row: SocialPost & { video_uploads?: { original_filename: string } | null }) => ({
      ...(row as SocialPost),
      source_video_filename: row.video_uploads?.original_filename ?? null,
    }),
  )
}

export interface SocialPostMediaWithAsset {
  media_asset_id: string
  position: number
  overlay_text: string | null
  overlay_metadata: Record<string, unknown> | null
  asset: {
    id: string
    kind: "video" | "image"
    public_url: string
    storage_path: string
    mime_type: string
    width: number | null
    height: number | null
    duration_ms: number | null
  } | null
}

export interface SocialPostWithMedia extends SocialPost {
  media: SocialPostMediaWithAsset[]
}

export async function getSocialPostWithMedia(id: string): Promise<SocialPostWithMedia | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "*, social_post_media(media_asset_id, position, overlay_text, overlay_metadata, media_assets(id, kind, public_url, storage_path, mime_type, width, height, duration_ms))",
    )
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const raw = data as SocialPost & {
    social_post_media?: Array<{
      media_asset_id: string
      position: number
      overlay_text: string | null
      overlay_metadata: Record<string, unknown> | null
      media_assets: SocialPostMediaWithAsset["asset"] | null
    }>
  }
  const media: SocialPostMediaWithAsset[] = (raw.social_post_media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      media_asset_id: m.media_asset_id,
      position: m.position,
      overlay_text: m.overlay_text,
      overlay_metadata: m.overlay_metadata,
      asset: m.media_assets,
    }))

  const { social_post_media: _drop, ...rest } = raw as SocialPost & {
    social_post_media?: unknown
  }
  return { ...(rest as SocialPost), media }
}
