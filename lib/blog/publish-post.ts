// lib/blog/publish-post.ts
// The one publish path. Called by the Publish button's route and by the
// scheduled-content runner, so the two can never drift apart.

import { revalidatePath } from "next/cache"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { createAiJob } from "@/lib/ai-jobs"
import { submitUrlToIndexNow } from "@/lib/indexnow"

export interface PublishBlogPostResult {
  id: string
  slug: string | null
  published_at: string | null
}

/**
 * Publishes a blog post and runs every side effect the manual button runs.
 *
 * `actorId` is explicit rather than read from the session because the cron
 * has no session — it passes the post's own author_id.
 */
export async function publishBlogPost(args: {
  id: string
  actorId: string
}): Promise<PublishBlogPostResult> {
  const post = await getBlogPostById(args.id)

  // Mirrors sendNewsletterNow's `status === "sent"` guard. Without it, a
  // manual Publish click racing the cron (or a second cron tick) double-fires
  // every side effect below: two newsletter_from_blog jobs (two duplicate AI
  // drafts) and two seo_enhance jobs (real API spend), for zero benefit since
  // the post is already live.
  if (post.status === "published") {
    return { id: post.id, slug: post.slug, published_at: post.published_at }
  }

  const updated = await updateBlogPost(args.id, {
    status: "published",
    published_at: post.published_at ?? new Date().toISOString(),
    // A published post is no longer queued for anything.
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  // Flip any linked content_calendar row so the SEO agent's outcome tracker
  // sees the lifecycle terminate. Fire-and-forget.
  try {
    const { createServiceRoleClient } = await import("@/lib/supabase")
    await createServiceRoleClient()
      .from("content_calendar")
      .update({ status: "published" })
      .eq("reference_id", args.id)
  } catch (err) {
    console.error("[Blog publish] content_calendar status flip failed:", err)
  }

  createAiJob({
    type: "newsletter_from_blog",
    userId: args.actorId,
    input: { blog_post_id: args.id },
  }).catch((err) => console.error("[Blog] newsletter_from_blog queue failed:", err))

  createAiJob({
    type: "seo_enhance",
    userId: args.actorId,
    input: { blog_post_id: args.id },
  }).catch((err) => console.error("[Blog] seo_enhance queue failed:", err))

  if (updated.slug) {
    submitUrlToIndexNow(`/blog/${updated.slug}`).catch((err) =>
      console.error("[Blog] IndexNow submit failed:", err),
    )
  }

  revalidatePath("/blog")
  if (updated.slug) revalidatePath(`/blog/${updated.slug}`)

  return { id: updated.id, slug: updated.slug, published_at: updated.published_at }
}
