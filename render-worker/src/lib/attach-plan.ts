// render-worker/src/lib/attach-plan.ts
// Pure decision logic for where a rendered captioned cut should attach.
//
// The social caption fanout (functions/src/social-fanout.ts) already creates one
// draft caption post per platform. The captioned-cut render must therefore NOT
// create its own posts — it attaches the rendered reel to the EXISTING caption
// post for each connected platform. This helper turns the connected-platform
// list + the video's existing posts into that attach plan.

export interface ExistingPost {
  id: string
  platform: string
}

export interface AttachPlanEntry {
  platform: string
  /** Existing caption post to attach the cut to, or null when none exists
   *  (skip — the cut asset is still created, just not attached; never create a
   *  new post, which is what produced the blank duplicates). */
  postId: string | null
}

/**
 * For each connected platform, pick the existing caption post to attach the cut
 * to. Picks the FIRST post matching the platform, so callers should pass
 * `existingPosts` in a stable order (e.g. created_at ascending) to prefer the
 * original fanout caption over any later row.
 */
export function planCutAttachment(
  connectedPlatforms: readonly string[],
  existingPosts: readonly ExistingPost[],
): AttachPlanEntry[] {
  return connectedPlatforms.map((platform) => ({
    platform,
    postId: existingPosts.find((p) => p.platform === platform)?.id ?? null,
  }))
}
