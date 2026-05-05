// app/api/admin/social/posts/[id]/schedule/route.ts
// POST { scheduled_at: ISO datetime } — schedules a post for automatic
// publishing.
//
// Two delivery paths:
// 1. Native platform scheduling (currently Facebook only): we call the
//    platform's Graph API now with `scheduled_publish_time`, the platform
//    holds the post in its own queue, and we store the platform-side post
//    id in `platform_post_id`. The publish-due cron skips these rows.
// 2. DB-cron scheduling (TikTok, YouTube, LinkedIn, Instagram, FB stories):
//    we just flip status to "scheduled". The publish-due cron picks them up
//    when `scheduled_at <= now()`.
//
// This auto-approves the post first, so the coach only has to answer "when?"
// instead of stepping through a draft → approved → scheduled state machine.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"
import { buildPluginInput } from "@/lib/social/publish-runner"

const SCHEDULABLE_STATUSES = new Set([
  "draft",
  "edited",
  "approved",
  "scheduled",
  "awaiting_connection",
  "failed",
])

// Facebook's scheduled_publish_time hard minimum is 10 min; we add a 5 min
// safety margin so the API doesn't reject the call due to clock skew or
// processing time between user click and Graph API receipt.
const FB_NATIVE_SCHEDULE_MIN_MS = 15 * 60 * 1000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { scheduled_at?: string } | null
  const scheduledAtRaw = body?.scheduled_at?.trim()
  if (!scheduledAtRaw) {
    return NextResponse.json({ error: "scheduled_at is required (ISO datetime string)" }, { status: 400 })
  }

  const scheduledAt = new Date(scheduledAtRaw)
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "scheduled_at is not a valid datetime" }, { status: 400 })
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  if (!SCHEDULABLE_STATUSES.has(post.approval_status)) {
    return NextResponse.json(
      { error: `Cannot schedule a ${post.approval_status} post` },
      { status: 409 },
    )
  }

  const connections = await listPlatformConnections()
  const connected = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.plugin_name),
  )
  if (!connected.has(post.platform)) {
    return NextResponse.json(
      { error: `Connect ${post.platform} first to schedule this post` },
      { status: 409 },
    )
  }

  // Try native platform scheduling first (FB pages support this; other
  // platforms fall through to the DB-cron path).
  bootstrapPlugins(connections)
  const plugin = pluginRegistry.get(post.platform)

  if (plugin?.scheduleOnPlatform) {
    if (scheduledAt.getTime() - Date.now() < FB_NATIVE_SCHEDULE_MIN_MS) {
      return NextResponse.json(
        {
          error: `${post.platform} requires scheduled time to be at least 15 min in the future`,
        },
        { status: 400 },
      )
    }

    const built = await buildPluginInput(post)
    if ("error" in built) {
      return NextResponse.json({ error: built.error }, { status: 400 })
    }

    const platformResult = await plugin.scheduleOnPlatform({
      ...built.input,
      scheduledAt: scheduledAt.toISOString(),
    })

    if (platformResult.supported && !platformResult.success) {
      return NextResponse.json({ error: platformResult.error }, { status: 502 })
    }

    if (platformResult.supported && platformResult.success) {
      // If the row had a previous native-scheduled post id (rescheduling),
      // cancel that one before overwriting so we don't leak ghost posts.
      if (post.platform_post_id && plugin.unscheduleOnPlatform) {
        await plugin.unscheduleOnPlatform(post.platform_post_id).catch(() => null)
      }

      const updated = await updateSocialPost(id, {
        approval_status: "scheduled",
        scheduled_at: scheduledAt.toISOString(),
        platform_post_id: platformResult.platform_post_id,
      })
      return NextResponse.json({
        id: updated.id,
        approval_status: updated.approval_status,
        scheduled_at: updated.scheduled_at,
        platform_post_id: updated.platform_post_id,
        delivery: "platform_native",
      })
    }

    // platformResult.supported === false → fall through to cron path.
  }

  // DB-cron path: row sits with status="scheduled", publish-due cron picks
  // it up at scheduled_at and calls plugin.publish() then.
  const updated = await updateSocialPost(id, {
    approval_status: "scheduled",
    scheduled_at: scheduledAt.toISOString(),
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
    delivery: "cron",
  })
}
