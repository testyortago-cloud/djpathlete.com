// lib/db/social-post-media.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPostMediaRow } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface AttachMediaOptions {
  overlayText?: string | null
  overlayMetadata?: Record<string, unknown> | null
}

export async function attachMedia(
  socialPostId: string,
  mediaAssetId: string,
  position: number,
  options: AttachMediaOptions = {},
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("social_post_media").insert({
    social_post_id: socialPostId,
    media_asset_id: mediaAssetId,
    position,
    overlay_text: options.overlayText ?? null,
    overlay_metadata: options.overlayMetadata ?? null,
  })
  if (error) throw error
}

export async function listMediaForPost(socialPostId: string): Promise<SocialPostMediaRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_post_media")
    .select("*")
    .eq("social_post_id", socialPostId)
    .order("position", { ascending: true })
  if (error) throw error
  return (data ?? []) as SocialPostMediaRow[]
}

export async function reorderMedia(
  socialPostId: string,
  positions: Array<{ assetId: string; position: number }>,
): Promise<void> {
  const supabase = getClient()
  // Two-phase update to avoid tripping the (social_post_id, position) primary key on
  // intermediate states: first shift each affected row to a unique high sentinel
  // position, then write the target positions. The high sentinels are still >= 0 so
  // the CHECK (position >= 0) constraint is preserved.
  const current = await supabase
    .from("social_post_media")
    .select("media_asset_id, position")
    .eq("social_post_id", socialPostId)
  if (current.error) throw current.error

  const sentinelBase = 100_000
  for (let i = 0; i < (current.data ?? []).length; i += 1) {
    const row = current.data![i]
    const { error } = await supabase
      .from("social_post_media")
      .update({ position: sentinelBase + i })
      .eq("social_post_id", socialPostId)
      .eq("media_asset_id", row.media_asset_id)
    if (error) throw error
  }

  for (const { assetId, position } of positions) {
    const { error } = await supabase
      .from("social_post_media")
      .update({ position })
      .eq("social_post_id", socialPostId)
      .eq("media_asset_id", assetId)
    if (error) throw error
  }
}

export async function detachMedia(socialPostId: string, mediaAssetId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("social_post_media")
    .delete()
    .eq("social_post_id", socialPostId)
    .eq("media_asset_id", mediaAssetId)
  if (error) throw error
}
