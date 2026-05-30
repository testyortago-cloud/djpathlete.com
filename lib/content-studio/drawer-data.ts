import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { getSocialPostById, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import { listMediaForPosts } from "@/lib/db/social-post-media"
import { getSetting } from "@/lib/db/system-settings"
import type { VideoUpload, VideoTranscript, SocialPost } from "@/types/database"

const PREVIEW_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes
const SLIDE_URL_EXPIRY_MS = 60 * 60 * 1000 // 1 hour

/** One attached image slide for a post, with a short-lived signed preview URL. */
export interface PostSlide {
  assetId: string
  position: number
  url: string | null
  alt: string | null
}

export interface DrawerData {
  mode: "video" | "post-only"
  video: VideoUpload | null
  previewUrl: string | null
  transcript: VideoTranscript | null
  posts: SocialPost[]
  /** Attached image slides per post id (carousel/image/story), ordered by position. */
  mediaByPost: Record<string, PostSlide[]>
  /** When opened from a post card, echoed back so the client can pre-expand. */
  highlightPostId: string | null
  /** Whether the Captioned Cut feature flag is on (gates the drawer button). */
  captionedCutEnabled: boolean
}

/**
 * Load + sign the attached image media for a set of posts, keyed by post id.
 * Slides render as thumbnails in the drawer; the stored public_url is just a
 * storage path, so each path is signed into a short-lived READ URL here (same
 * mechanism as the video preview and the asset library). A file that can't be
 * signed yields url:null so one missing slide never blanks the whole strip.
 */
async function signMediaByPost(postIds: string[]): Promise<Record<string, PostSlide[]>> {
  const rows = await listMediaForPosts(postIds)
  const images = rows.filter((r) => r.kind === "image")
  if (images.length === 0) return {}

  const bucket = getAdminStorage().bucket()
  const signed = await Promise.all(
    images.map(async (row) => {
      let url: string | null = null
      try {
        ;[url] = await bucket.file(row.storage_path).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SLIDE_URL_EXPIRY_MS,
        })
      } catch {
        url = null
      }
      return { row, url }
    }),
  )

  const out: Record<string, PostSlide[]> = {}
  for (const { row, url } of signed) {
    ;(out[row.social_post_id] ??= []).push({
      assetId: row.media_asset_id,
      position: row.position,
      url,
      alt: row.ai_alt_text,
    })
  }
  return out
}

async function signPreviewUrl(storagePath: string): Promise<string> {
  const bucket = getAdminStorage().bucket()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + PREVIEW_URL_EXPIRY_MS,
  })
  return url
}

export async function getDrawerData(videoId: string): Promise<DrawerData | null> {
  const video = await getVideoUploadById(videoId)
  if (!video) return null

  const [transcript, posts, previewUrl, captionedCutEnabled] = await Promise.all([
    getTranscriptForVideo(videoId),
    listSocialPostsBySourceVideo(videoId),
    signPreviewUrl(video.storage_path),
    getSetting<boolean>("feature_captioned_cut_enabled", false),
  ])

  const mediaByPost = await signMediaByPost(posts.map((p) => p.id))

  return {
    mode: "video",
    video,
    previewUrl,
    transcript,
    posts,
    mediaByPost,
    highlightPostId: null,
    captionedCutEnabled,
  }
}

export async function getDrawerDataForPost(postId: string): Promise<DrawerData | null> {
  const post = await getSocialPostById(postId)
  if (!post) return null

  if (!post.source_video_id) {
    return {
      mode: "post-only",
      video: null,
      previewUrl: null,
      transcript: null,
      posts: [post],
      mediaByPost: await signMediaByPost([post.id]),
      highlightPostId: post.id,
      captionedCutEnabled: false,
    }
  }

  const base = await getDrawerData(post.source_video_id)
  if (!base) {
    return {
      mode: "post-only",
      video: null,
      previewUrl: null,
      transcript: null,
      posts: [post],
      mediaByPost: await signMediaByPost([post.id]),
      highlightPostId: post.id,
      captionedCutEnabled: false,
    }
  }

  return { ...base, highlightPostId: post.id }
}
