// lib/db/social-post-media.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPostMediaRow, MediaAssetKind } from "@/types/database"

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

export interface PostMediaWithAsset {
  social_post_id: string
  media_asset_id: string
  position: number
  storage_path: string
  kind: MediaAssetKind
  mime_type: string
  ai_alt_text: string | null
}

/**
 * Load every attached media row for a set of posts, joined to the underlying
 * media_assets so callers can render thumbnails. Ordered by post then slide
 * position. Returns [] for an empty input (skips the round-trip).
 */
export async function listMediaForPosts(postIds: string[]): Promise<PostMediaWithAsset[]> {
  if (postIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_post_media")
    .select(
      "social_post_id, media_asset_id, position, media_assets(storage_path, kind, mime_type, ai_alt_text)",
    )
    .in("social_post_id", postIds)
    .order("position", { ascending: true })
  if (error) throw error

  type Row = {
    social_post_id: string
    media_asset_id: string
    position: number
    media_assets: {
      storage_path: string
      kind: MediaAssetKind
      mime_type: string
      ai_alt_text: string | null
    } | null
  }

  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.media_assets !== null)
    .map((r) => ({
      social_post_id: r.social_post_id,
      media_asset_id: r.media_asset_id,
      position: r.position,
      storage_path: r.media_assets!.storage_path,
      kind: r.media_assets!.kind,
      mime_type: r.media_assets!.mime_type,
      ai_alt_text: r.media_assets!.ai_alt_text,
    }))
}

export async function reorderMedia(
  socialPostId: string,
  positions: Array<{ assetId: string; position: number }>,
): Promise<void> {
  const supabase = getClient()

  const current = await supabase
    .from("social_post_media")
    .select("media_asset_id, position")
    .eq("social_post_id", socialPostId)
  if (current.error) throw current.error

  const rows = current.data ?? []

  // Validate: positions must be a permutation of currently-attached assets.
  if (positions.length !== rows.length) {
    throw new Error(
      `reorderMedia: positions.length (${positions.length}) must equal attached media count (${rows.length})`,
    )
  }
  const attachedIds = new Set(rows.map((r) => r.media_asset_id))
  const requestedIds = new Set(positions.map((p) => p.assetId))
  if (attachedIds.size !== requestedIds.size || ![...attachedIds].every((id) => requestedIds.has(id))) {
    throw new Error("reorderMedia: positions must reference exactly the currently-attached assets")
  }
  const targetPositions = positions.map((p) => p.position)
  if (targetPositions.some((p) => p < 0)) {
    throw new Error("reorderMedia: target positions must be >= 0")
  }
  if (new Set(targetPositions).size !== targetPositions.length) {
    throw new Error("reorderMedia: target positions must be unique")
  }

  if (rows.length === 0) return

  // Two-phase update to avoid tripping the (social_post_id, position) primary key on
  // intermediate states: shift each row to a unique high sentinel first, then write
  // the target. Sentinel base is computed dynamically so a crashed previous run's
  // leftover sentinels never collide with this run's.
  const existingMaxPos = rows.reduce((max, r) => Math.max(max, r.position), 0)
  const sentinelBase = Math.max(existingMaxPos, 100_000) + 1

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
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
