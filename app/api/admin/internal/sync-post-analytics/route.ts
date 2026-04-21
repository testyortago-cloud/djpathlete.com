// app/api/admin/internal/sync-post-analytics/route.ts
// Internal route hit by the syncPlatformAnalytics Firebase Function nightly.
// Given a social_post_id, invokes the matching plugin's fetchAnalytics() and
// returns the AnalyticsResult (or null if the platform isn't connected).
//
// Guarded by INTERNAL_CRON_TOKEN — same shared bearer token used by publish-due.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSocialPostById } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"

const BodySchema = z.object({ socialPostId: z.string().uuid() })

async function noopBootstrap() {
  const connections = await listPlatformConnections()
  bootstrapPlugins(connections, {
    // fetchAnalytics paths don't need real push/email senders — TikTok's
    // analytics stub ignores them. Stub them anyway so bootstrap is safe.
    tiktokEmail: "",
    tiktokFcmToken: null,
    async sendPush() {
      /* not used on the analytics path */
    },
    async sendEmail() {
      /* not used on the analytics path */
    },
  })
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "socialPostId (uuid) is required" }, { status: 400 })
  }

  const post = await getSocialPostById(parsed.data.socialPostId)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }
  if (post.approval_status !== "published" || !post.platform_post_id) {
    return NextResponse.json({ error: "Post is not published or has no platform_post_id" }, { status: 409 })
  }

  await noopBootstrap()
  const plugin = pluginRegistry.get(post.platform)
  if (!plugin) {
    return NextResponse.json(
      {
        socialPostId: post.id,
        platform: post.platform,
        platformPostId: post.platform_post_id,
        metrics: null,
        reason: "plugin_not_connected",
      },
      { status: 200 },
    )
  }

  try {
    const metrics = await plugin.fetchAnalytics(post.platform_post_id)
    const isEmpty = !metrics || Object.keys(metrics).length === 0
    return NextResponse.json(
      {
        socialPostId: post.id,
        platform: post.platform,
        platformPostId: post.platform_post_id,
        metrics: isEmpty ? null : metrics,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("[sync-post-analytics] plugin fetchAnalytics failed:", error)
    return NextResponse.json({ error: (error as Error).message ?? "plugin error" }, { status: 502 })
  }
}
