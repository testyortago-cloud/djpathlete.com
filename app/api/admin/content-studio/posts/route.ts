import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSocialPost } from "@/lib/db/social-posts"
import type { SocialPlatform } from "@/types/database"

const VALID_PLATFORMS: readonly SocialPlatform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "youtube_shorts",
  "linkedin",
]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | {
        platform?: string
        caption?: string
        scheduled_at?: string | null
        source_video_id?: string | null
      }
    | null

  const platform = body?.platform as SocialPlatform | undefined
  const caption = (body?.caption ?? "").trim()

  if (!platform || !(VALID_PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json(
      { error: "platform must be one of " + VALID_PLATFORMS.join(", ") },
      { status: 400 },
    )
  }

  let scheduledAt: string | null = null
  if (body?.scheduled_at) {
    const d = new Date(body.scheduled_at)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "scheduled_at is not a valid datetime" },
        { status: 400 },
      )
    }
    if (d.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "scheduled_at must be in the future" },
        { status: 400 },
      )
    }
    scheduledAt = d.toISOString()
  }

  const post = await createSocialPost({
    platform,
    content: caption,
    media_url: null,
    approval_status: scheduledAt ? "scheduled" : "approved",
    scheduled_at: scheduledAt,
    source_video_id: body?.source_video_id ?? null,
    created_by: session.user.id,
  })

  return NextResponse.json({ id: post.id, approval_status: post.approval_status })
}
