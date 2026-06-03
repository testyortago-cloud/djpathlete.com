// The posting "edit gate" in one place. A video is postable once it is no longer
// gated: it has been marked ready (needs_edit === false). A rendered reel/cut does
// NOT auto-unblock posting — the operator releases it via "Mark ready".
import { getVideoUploadById } from "@/lib/db/video-uploads"
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
