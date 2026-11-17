// app/api/admin/social/posts/[id]/tiktok/draft/route.ts
// POST — "Send to TikTok drafts" (the video.upload scope). Uploads the post's
// video to the coach's TikTok inbox; they add the caption, choose who can see
// it and post it inside the TikTok app. Writes NOTHING here: a draft is not a
// published post, so the row's status, caption and settings stay as they are.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { buildPluginInput } from "@/lib/social/publish-runner"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"
import type { TikTokPlugin } from "@/lib/social/plugins/tiktok"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post || post.platform !== "tiktok") {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }
  if (post.approval_status === "published" || post.approval_status === "rejected") {
    return NextResponse.json({ error: `Cannot change a ${post.approval_status} post` }, { status: 409 })
  }

  bootstrapPlugins(await listPlatformConnections())
  const plugin = pluginRegistry.get("tiktok") as TikTokPlugin | undefined
  if (!plugin) {
    return NextResponse.json({ error: "Connect TikTok on the Connections page first." }, { status: 409 })
  }

  // The publisher's own choice of file (an attached cut wins over the raw upload).
  const built = await buildPluginInput(post)
  const mediaUrl = "input" in built ? built.input.mediaUrl : null
  if (!mediaUrl) {
    return NextResponse.json({ error: "This post has no video to send." }, { status: 409 })
  }

  const result = await plugin.uploadDraft({ mediaUrl })
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ publish_id: result.platform_post_id })
}
