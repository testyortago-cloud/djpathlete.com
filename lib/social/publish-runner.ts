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
import type { PendingPublish, PublishInput } from "@/lib/social/plugins/types"
import type { SocialPost } from "@/types/database"

/** How long a platform may keep processing a post's media before the post is failed. */
export const PENDING_PUBLISH_LIMIT_MS = 30 * 60 * 1000

interface SavedPublishState extends PendingPublish {
  /** The scheduled_at this wait belongs to; a reschedule or "Publish now" starts fresh. */
  scheduledFor: string
}

function readSavedState(post: SocialPost): PendingPublish | null {
  const raw = post.platform_publish_state
  if (!raw || typeof raw !== "object") return null
  const { startedAt, scheduledFor, data } = raw as Partial<SavedPublishState>
  if (typeof startedAt !== "string" || typeof scheduledFor !== "string") return null
  if (!data || typeof data !== "object") return null
  if (scheduledFor !== post.scheduled_at) return null
  return { startedAt, data }
}

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
    const result = await publishOnePost(post, now)
    if (result === "published") published++
    else if (result === "failed") failed++
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
  let mediaKinds: Array<"image" | "video"> | undefined

  if (post.post_type === "carousel") {
    const full = await getSocialPostWithMedia(post.id)
    if (!full || full.media.length === 0) {
      return { error: "Carousel post has no attached media" }
    }
    const resolved: string[] = []
    const kinds: Array<"image" | "video"> = []
    for (const slide of full.media) {
      const url = await resolveMediaUrl({
        source_video_id: null,
        media_url: slide.asset?.public_url ?? null,
      })
      if (!url) {
        return { error: `Failed to resolve URL for carousel slide at position ${slide.position}` }
      }
      resolved.push(url)
      kinds.push(slide.asset?.kind === "video" ? "video" : "image")
    }
    mediaUrls = resolved
    mediaKinds = kinds
  }

  // For single-media posts, an attached media asset (e.g. a rendered captioned
  // cut) is the EDITED version and is what should be posted — it takes
  // precedence over the raw source video. Only when nothing is attached do we
  // fall back to the source video / media_url (the "post the original as-is"
  // path — e.g. a video marked ready without a cut). The original always
  // survives as the post's source_video_id, so it's never lost.
  let attachedMediaUrl: string | null = null
  if (post.post_type !== "carousel") {
    const full = await getSocialPostWithMedia(post.id)
    const firstAsset = full?.media?.[0]?.asset
    if (firstAsset?.public_url) {
      attachedMediaUrl = await resolveMediaUrl({ source_video_id: null, media_url: firstAsset.public_url })
    }
  }

  const mediaUrl =
    mediaUrls?.[0] ??
    attachedMediaUrl ??
    (await resolveMediaUrl({
      source_video_id: post.source_video_id,
      media_url: post.media_url,
    }))

  return {
    input: {
      content: post.content,
      mediaUrl,
      mediaUrls,
      mediaKinds,
      postType: post.post_type,
      scheduledAt: null,
      ...(post.link_url && post.link_title
        ? {
            link: {
              url: post.link_url,
              title: post.link_title,
              description: post.link_description ?? null,
              imageUrl: post.link_image_url ?? null,
            },
          }
        : {}),
    },
  }
}

async function publishOnePost(post: SocialPost, now: Date): Promise<"published" | "failed" | "pending"> {
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

  const resumeState = readSavedState(post)
  const input: PublishInput = resumeState ? { ...built.input, resumeState } : built.input
  const publishResult = await plugin.publish(input)

  if (!publishResult.success) {
    await updateSocialPost(post.id, {
      approval_status: "failed",
      rejection_notes: publishResult.error ?? "Plugin returned success=false",
      platform_publish_state: null,
    })
    return "failed"
  }

  if (publishResult.pending) {
    const waited = now.getTime() - Date.parse(publishResult.pending.startedAt)
    if (waited > PENDING_PUBLISH_LIMIT_MS) {
      await updateSocialPost(post.id, {
        approval_status: "failed",
        rejection_notes: `${plugin.displayName ?? post.platform} is still processing the video after 30 minutes.`,
        platform_publish_state: null,
      })
      return "failed"
    }
    const saved: SavedPublishState = { ...publishResult.pending, scheduledFor: post.scheduled_at as string }
    await updateSocialPost(post.id, { platform_publish_state: saved as unknown as Record<string, unknown> })
    return "pending"
  }

  await updateSocialPost(post.id, {
    approval_status: "published",
    published_at: new Date().toISOString(),
    platform_post_id: publishResult.platform_post_id ?? null,
    platform_publish_state: null,
  })
  return "published"
}
