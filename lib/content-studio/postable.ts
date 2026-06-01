import type { VideoUpload } from "@/types/database"

// Pure, client-safe edit-gate predicate. A video is postable once it is no longer
// gated: it was never gated / has been marked ready (needs_edit === false), or it
// already has a rendered captioned cut. Kept in its OWN module with no DB/server
// imports so client bundles (e.g. the pipeline board's pipeline-columns) can import
// it without dragging in server-only code (next/headers via lib/supabase).
// The server-side route guard (assertSourceVideoPostable) lives in ./edit-gate.
export function isVideoPostable(video: Pick<VideoUpload, "needs_edit">, hasCut: boolean): boolean {
  return video.needs_edit === false || hasCut
}
