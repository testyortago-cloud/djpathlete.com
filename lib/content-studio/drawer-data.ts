import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { getSocialPostById, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import type { VideoUpload, VideoTranscript, SocialPost } from "@/types/database"

const PREVIEW_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export interface DrawerData {
  mode: "video" | "post-only"
  video: VideoUpload | null
  previewUrl: string | null
  transcript: VideoTranscript | null
  posts: SocialPost[]
  /** When opened from a post card, echoed back so the client can pre-expand. */
  highlightPostId: string | null
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

  const [transcript, posts, previewUrl] = await Promise.all([
    getTranscriptForVideo(videoId),
    listSocialPostsBySourceVideo(videoId),
    signPreviewUrl(video.storage_path),
  ])

  return {
    mode: "video",
    video,
    previewUrl,
    transcript,
    posts,
    highlightPostId: null,
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
      highlightPostId: post.id,
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
      highlightPostId: post.id,
    }
  }

  return { ...base, highlightPostId: post.id }
}
