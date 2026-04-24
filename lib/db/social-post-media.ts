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
