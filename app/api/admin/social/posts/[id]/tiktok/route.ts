// app/api/admin/social/posts/[id]/tiktok/route.ts
// GET — what the "Post to TikTok" screen needs when it opens: the account's
// fresh creator info (TikTok requires it be fetched on every open), a playable
// URL of the exact file that will be posted, and any settings saved earlier.
// PUT — saves the coach's choices on the post. Neither queues anything: the
// caption goes through the PATCH route and sending through publish-now.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { buildPluginInput } from "@/lib/social/publish-runner"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"
import type { TikTokPlugin } from "@/lib/social/plugins/tiktok"
import { creatorInfoRefusal } from "@/lib/social/tiktok-post-rules"
import { tiktokPostSettingsSchema } from "@/lib/validators/tiktok-post-settings"

// Same six statuses publish-now accepts.
const PUBLISHABLE_STATUSES = new Set([
  "draft",
  "edited",
  "approved",
  "scheduled",
  "awaiting_connection",
  "failed",
])

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post || post.platform !== "tiktok") {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  bootstrapPlugins(await listPlatformConnections())
  const plugin = pluginRegistry.get("tiktok") as TikTokPlugin | undefined
  if (!plugin) {
    return NextResponse.json({ error: "Connect TikTok on the Connections page first." }, { status: 409 })
  }

  // The publisher's own choice of file (an attached cut wins over the raw upload),
  // so the preview and the length check see exactly what TikTok will receive.
  const built = await buildPluginInput(post)
  const previewUrl = "input" in built ? built.input.mediaUrl : null
  if (!previewUrl) {
    return NextResponse.json({ error: "This post has no video to send." }, { status: 409 })
  }

  const result = await plugin.creatorInfo()
  if (!result.ok) {
    // A 5xx with no TikTok error body (code http_5xx) is TikTok being down, not a refusal.
    if (result.code === "network_error" || /^http_5\d\d$/.test(result.code)) {
      return NextResponse.json({ error: "Couldn't reach TikTok. Try again." }, { status: 502 })
    }
    return NextResponse.json({ error: creatorInfoRefusal(result.code, result.message) }, { status: 409 })
  }

  return NextResponse.json({
    creator: result.creator,
    previewUrl,
    saved: post.tiktok_settings ?? null,
  })
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post || post.platform !== "tiktok") {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }
  if (!PUBLISHABLE_STATUSES.has(post.approval_status)) {
    return NextResponse.json({ error: `Cannot change a ${post.approval_status} post` }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  const parsed = tiktokPostSettingsSchema.safeParse(body?.settings)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 })
  }

  await updateSocialPost(id, { tiktok_settings: parsed.data })
  return NextResponse.json({ tiktok_settings: parsed.data })
}
