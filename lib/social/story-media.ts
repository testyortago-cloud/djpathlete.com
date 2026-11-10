// lib/social/story-media.ts
// Decides what a Story post puts on Instagram, for the publish runner and for
// the story row's length warning (same answer in both places).

import { getSocialPostWithMedia } from "@/lib/db/social-posts"
import { findReelCutForVideo } from "@/lib/db/social-post-media"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { resolveMediaUrl, resolveStoryImageUrl } from "@/lib/social/resolve-media-url"
import { isStoryVideoTooLong, storyTooLongMessage } from "@/lib/content-studio/stories"
import type { SocialPost } from "@/types/database"

type StoryPost = Pick<SocialPost, "id" | "source_video_id">

export interface StoryVideo {
  /** Storage path (media_assets.public_url / video_uploads.storage_path). */
  path: string
  durationMs: number | null
}

type StoryMediaChoice = { kind: "image"; path: string } | { kind: "video"; video: StoryVideo } | null

async function pickStoryMedia(post: StoryPost): Promise<StoryMediaChoice> {
  const full = await getSocialPostWithMedia(post.id)
  const asset = full?.media?.[0]?.asset
  if (asset?.kind === "image") return { kind: "image", path: asset.storage_path }
  if (asset?.kind === "video") {
    return { kind: "video", video: { path: asset.public_url, durationMs: asset.duration_ms ?? null } }
  }
  if (!post.source_video_id) return null

  // The render worker attaches the edited cut to the video's Instagram REEL post,
  // not to the story, so borrow that cut rather than posting raw footage.
  const cut = await findReelCutForVideo(post.source_video_id)
  if (cut) return { kind: "video", video: { path: cut.storage_path, durationMs: cut.duration_ms } }

  const upload = await getVideoUploadById(post.source_video_id)
  if (!upload?.storage_path) return null
  const durationMs = typeof upload.duration_seconds === "number" ? upload.duration_seconds * 1000 : null
  return { kind: "video", video: { path: upload.storage_path, durationMs } }
}

/** The video a story will post, or null for a photo story / nothing attached. */
export async function storyVideoFor(post: StoryPost): Promise<StoryVideo | null> {
  const picked = await pickStoryMedia(post)
  return picked?.kind === "video" ? picked.video : null
}

/** Signed URL to hand the platform plugin, or the plain-words reason it can't post. */
export async function resolveStoryMedia(post: StoryPost): Promise<{ url: string } | { error: string }> {
  const picked = await pickStoryMedia(post)
  if (!picked) return { error: "This story has no photo or video attached." }

  if (picked.kind === "image") {
    const url = await resolveStoryImageUrl(picked.path)
    return url ? { url } : { error: "The story photo could not be found. Add the photo again." }
  }

  if (isStoryVideoTooLong(picked.video.durationMs)) {
    return { error: storyTooLongMessage(picked.video.durationMs as number) }
  }
  const url = await resolveMediaUrl({ source_video_id: null, media_url: picked.video.path })
  return url ? { url } : { error: "The story video could not be found." }
}
