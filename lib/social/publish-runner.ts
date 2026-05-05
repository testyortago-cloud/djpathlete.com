// lib/social/publish-runner.ts
// Core publishing logic called by /api/admin/internal/publish-due.
// Separated from the route handler so it's unit-testable with mocked DAL
// and plugin registry. The route wires in the real bootstrap with push
// + email senders, then delegates here.

import { listSocialPosts, updateSocialPost, getSocialPostWithMedia } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { pluginRegistry } from "@/lib/social/registry"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { resolveMediaUrl } from "@/lib/social/resolve-media-url"
import type { PublishInput } from "@/lib/social/plugins/types"
import type { SocialPost } from "@/types/database"

export interface RunScheduledPublishOptions {
  now?: Date
  bootstrap?: (connections: unknown) => Promise<void>
}

export interface RunScheduledPublishResult {
  considered: number
  published: number
  failed: number
}

export async function runScheduledPublish(
  options: RunScheduledPublishOptions = {},
): Promise<RunScheduledPublishResult> {
  const now = options.now ?? new Date()

  const scheduledPosts = await listSocialPosts({ approval_status: "scheduled" })
  const due = scheduledPosts.filter((p) => {
    if (!p.scheduled_at) return false
    if (new Date(p.scheduled_at).getTime() > now.getTime()) return false
    // Posts that already have platform_post_id were scheduled natively on
    // the platform (e.g. Facebook scheduled_publish_time). The platform owns
    // their delivery — we must not re-publish or we'd double-post.
    if (p.platform_post_id) return false
    return true
  })

  if (due.length === 0) {
    return { considered: scheduledPosts.length, published: 0, failed: 0 }
  }

  const connections = await listPlatformConnections()
  if (options.bootstrap) {
    await options.bootstrap(connections)
  } else {
    bootstrapPlugins(connections)
  }

  let published = 0
  let failed = 0

  for (const post of due) {
    const result = await publishOnePost(post)
    if (result === "published") published++
    else failed++
  }

  return { considered: scheduledPosts.length, published, failed }
}

/**
 * Resolves a SocialPost row into the PublishInput shape plugins consume.
 * Handles carousel-vs-single media, signed URLs, and post-type. Returned
 * `error` is set if the post can't be turned into a publishable input
 * (e.g. carousel with no media); callers should mark the row as failed.
 *
 * Shared between the publish-due cron and the /schedule route, which both
 * need to hand a SocialPost to a plugin (for live publish or native schedule).
 */
export async function buildPluginInput(
  post: SocialPost,
): Promise<{ input: PublishInput } | { error: string }> {
  let mediaUrls: string[] | undefined

  if (post.post_type === "carousel") {
    const full = await getSocialPostWithMedia(post.id)
    if (!full || full.media.length === 0) {
      return { error: "Carousel post has no attached media" }
    }
    const resolved: string[] = []
    for (const slide of full.media) {
      const url = await resolveMediaUrl({
        source_video_id: null,
        media_url: slide.asset?.public_url ?? null,
      })
      if (!url) {
        return { error: `Failed to resolve URL for carousel slide at position ${slide.position}` }
      }
      resolved.push(url)
    }
    mediaUrls = resolved
  }

  const mediaUrl =
    mediaUrls?.[0] ??
    (await resolveMediaUrl({
      source_video_id: post.source_video_id,
      media_url: post.media_url,
    }))

  return {
    input: {
      content: post.content,
      mediaUrl,
      mediaUrls,
      postType: post.post_type,
      scheduledAt: null,
    },
  }
}

async function publishOnePost(post: SocialPost): Promise<"published" | "failed"> {
  const plugin = pluginRegistry.get(post.platform)
  if (!plugin) {
    await updateSocialPost(post.id, {
      approval_status: "failed",
      rejection_notes: `No plugin registered for platform "${post.platform}" — connect the platform and retry.`,
    })
    return "failed"
  }

  const built = await buildPluginInput(post)
  if ("error" in built) {
    await updateSocialPost(post.id, {
      approval_status: "failed",
      rejection_notes: built.error,
    })
    return "failed"
  }

  const publishResult = await plugin.publish(built.input)

  if (!publishResult.success) {
    await updateSocialPost(post.id, {
      approval_status: "failed",
      rejection_notes: publishResult.error ?? "Plugin returned success=false",
    })
    return "failed"
  }

  await updateSocialPost(post.id, {
    approval_status: "published",
    published_at: new Date().toISOString(),
    platform_post_id: publishResult.platform_post_id ?? null,
  })
  return "published"
}
