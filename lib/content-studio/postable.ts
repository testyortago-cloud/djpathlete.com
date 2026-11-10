import type { SocialPost, VideoUpload } from "@/types/database"

type SentFields = Pick<SocialPost, "approval_status" | "platform_post_id" | "scheduled_at">

/** Scheduled in Facebook's OWN queue: the platform holds it and posts it itself. */
export function isInPlatformQueue(post: SentFields): boolean {
  return post.approval_status === "scheduled" && !!post.platform_post_id
}

/**
 * The post is live on the platform. A post in Facebook's own queue is never marked
 * "published" here (nothing reads back what Facebook did), so once its time has
 * passed it counts as gone out.
 */
export function hasGoneOut(post: SentFields, now: number = Date.now()): boolean {
  if (post.approval_status === "published") return true
  return isInPlatformQueue(post) && !!post.scheduled_at && new Date(post.scheduled_at).getTime() <= now
}

// Pure, client-safe edit-gate predicate. A video is postable once it is no longer
// gated: it has been marked ready (needs_edit === false). A rendered reel/cut does
// NOT auto-unblock posting — the operator releases it via "Mark ready". Kept in its
// OWN module with no DB/server imports so client bundles can import it.
// The server-side route guard (assertSourceVideoPostable) lives in ./edit-gate.
export function isVideoPostable(video: Pick<VideoUpload, "needs_edit">): boolean {
  return video.needs_edit === false
}
