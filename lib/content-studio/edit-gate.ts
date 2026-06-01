// The posting "edit gate" in one place. A video is postable once it is no longer
// gated: either it was never gated / has been marked ready (needs_edit === false),
// or it already has a rendered captioned cut. Postability is therefore DERIVED from
// the existing cut signal — the render-worker writes nothing extra.
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getLatestCaptionedCutForVideo } from "@/lib/db/media-assets"
import { isVideoPostable } from "./postable"

// The pure predicate lives in ./postable (no server imports) so client bundles can
// use it; re-exported here for existing callers of this module.
export { isVideoPostable }

export type PostableGuardResult = { ok: true } | { ok: false; reason: string }

const GATED_REASON = "Source video still needs editing — render a captioned cut or mark it ready."

// Async guard for route handlers. Returns ok when the post is NOT gated:
//  - sourceVideoId null → ok (manual / image / carousel posts are never gated)
//  - video not found    → ok (let the route's own validation handle the 404)
export async function assertSourceVideoPostable(sourceVideoId: string | null): Promise<PostableGuardResult> {
  if (!sourceVideoId) return { ok: true }
  const video = await getVideoUploadById(sourceVideoId)
  if (!video) return { ok: true }
  const cut = await getLatestCaptionedCutForVideo(sourceVideoId)
  if (isVideoPostable(video, !!cut)) return { ok: true }
  return { ok: false, reason: GATED_REASON }
}
