// lib/db/social-posts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPost, SocialPlatform, SocialApprovalStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSocialPost(
  post: Omit<
    SocialPost,
    "id" | "created_at" | "updated_at" | "published_at" | "platform_post_id" | "rejection_notes"
  >,
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
