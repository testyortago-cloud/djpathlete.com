// The posting "edit gate" in one place. A video is postable once it is no longer
// gated: it has been marked ready (needs_edit === false). A rendered reel/cut does
// NOT auto-unblock posting — the operator releases it via "Mark ready".
import { getVideoUploadById, updateVideoUpload } from "@/lib/db/video-uploads"
import { isVideoPostable } from "./postable"

// The pure predicate lives in ./postable (no server imports) so client bundles can
// use it; re-exported here for existing callers of this module.
export { isVideoPostable }

export type PostableGuardResult = { ok: true } | { ok: false; reason: string }

const GATED_REASON = "Source video still needs editing — mark it ready to post."

// Async guard for route handlers. Returns ok when the post is NOT gated:
//  - sourceVideoId null → ok (manual / image / carousel posts are never gated)
//  - video not found    → ok (let the route's own validation handle the 404)
export async function assertSourceVideoPostable(sourceVideoId: string | null): Promise<PostableGuardResult> {
  if (!sourceVideoId) return { ok: true }
  const video = await getVideoUploadById(sourceVideoId)
  if (!video) return { ok: true }
  if (isVideoPostable(video)) return { ok: true }
  return { ok: false, reason: GATED_REASON }
}

/**
 * Release the edit gate because the operator is sending this post BY HAND.
 *
 * Publish now / Schedule (and their batch equivalents, which call the same
 * per-post routes) are an explicit "send this" — refusing them until a separate
 * "Mark as ready" click made one intent cost two switches. So a manual send
 * clears the gate and carries on instead of answering 409.
 *
 * needs_edit is per VIDEO, so this releases that video's other posts too —
 * exactly what the "Mark as ready" button it replaces already did.
 *
 * This is deliberately NOT called from post creation, approve, or the column
 * status change: those are not sends, and the gate still has to stop unedited
 * footage reaching the scheduled-publish cron unattended.
 */
export async function releaseSourceVideoForSend(sourceVideoId: string | null): Promise<{ released: boolean }> {
  if (!sourceVideoId) return { released: false }
  const video = await getVideoUploadById(sourceVideoId)
  if (!video) return { released: false }
  if (isVideoPostable(video)) return { released: false }
  await updateVideoUpload(sourceVideoId, { needs_edit: false })
  return { released: true }
}
