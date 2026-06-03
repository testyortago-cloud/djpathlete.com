import type { VideoUpload } from "@/types/database"

// Pure, client-safe edit-gate predicate. A video is postable once it is no longer
// gated: it has been marked ready (needs_edit === false). A rendered reel/cut does
// NOT auto-unblock posting — the operator releases it via "Mark ready". Kept in its
// OWN module with no DB/server imports so client bundles can import it.
// The server-side route guard (assertSourceVideoPostable) lives in ./edit-gate.
export function isVideoPostable(video: Pick<VideoUpload, "needs_edit">): boolean {
  return video.needs_edit === false
}
