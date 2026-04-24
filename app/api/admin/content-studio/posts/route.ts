import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSocialPost, deleteSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"
import { getMediaAssetById } from "@/lib/db/media-assets"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"
import { isContentStudioMultimediaEnabled } from "@/lib/content-studio/feature-flag"
import type { SocialPlatform, PostType } from "@/types/database"

const VALID_PLATFORMS: readonly SocialPlatform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "youtube_shorts",
  "linkedin",
]

const VALID_POST_TYPES: readonly PostType[] = ["video", "image", "carousel", "story", "text"]
const CAROUSEL_MIN_SLIDES = 2
const CAROUSEL_MAX_SLIDES = 10

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    platform?: string
    caption?: string
    scheduled_at?: string | null
    source_video_id?: string | null
    postType?: string
    mediaAssetId?: string | null
    mediaAssetIds?: string[]
  } | null

  const platform = body?.platform as SocialPlatform | undefined
  const caption = (body?.caption ?? "").trim()

  if (!platform || !(VALID_PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json({ error: "platform must be one of " + VALID_PLATFORMS.join(", ") }, { status: 400 })
  }

  const postType = (body?.postType ?? "video") as PostType
  if (!(VALID_POST_TYPES as readonly string[]).includes(postType)) {
    return NextResponse.json({ error: "postType is invalid" }, { status: 400 })
  }

  // Platform-level support check first — a legitimately-unsupported combo
  // (e.g. carousel on TikTok) should surface a specific error, not a flag error.
  if (!isPlatformPostTypeSupported(platform, postType)) {
    return NextResponse.json(
      { error: `${platform} does not support ${postType} posts` },
      { status: 400 },
    )
  }

  if (postType !== "video" && !isContentStudioMultimediaEnabled()) {
    return NextResponse.json(
      { error: "Multimedia posts are disabled. Set CS_MULTIMEDIA_ENABLED=true." },
      { status: 400 },
    )
  }

  if (postType === "image" && !body?.mediaAssetId) {
    return NextResponse.json({ error: "mediaAssetId is required for image posts" }, { status: 400 })
  }

  if (postType === "carousel") {
    const ids = body?.mediaAssetIds
    if (!Array.isArray(ids) || ids.length < CAROUSEL_MIN_SLIDES || ids.length > CAROUSEL_MAX_SLIDES) {
      return NextResponse.json(
        { error: `Carousels require between ${CAROUSEL_MIN_SLIDES} and ${CAROUSEL_MAX_SLIDES} mediaAssetIds` },
        { status: 400 },
      )
    }
    for (const id of ids) {
      const asset = await getMediaAssetById(id)
      if (!asset) {
        return NextResponse.json({ error: `mediaAsset ${id} not found` }, { status: 400 })
      }
      if (asset.kind !== "image") {
        return NextResponse.json(
          { error: `mediaAsset ${id} is not an image (kind=${asset.kind})` },
          { status: 400 },
        )
      }
      if (platform === "instagram" && asset.mime_type !== "image/jpeg") {
        return NextResponse.json(
          { error: `Instagram carousels require JPEG images — ${id} is ${asset.mime_type}` },
          { status: 400 },
        )
      }
    }
  }

  let scheduledAt: string | null = null
  if (body?.scheduled_at) {
    const d = new Date(body.scheduled_at)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "scheduled_at is not a valid datetime" }, { status: 400 })
    }
    if (d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 })
    }
    scheduledAt = d.toISOString()
  }

  // Image and carousel posts never carry source_video_id — if both were set
  // the resolver would prefer the video path and sign the wrong asset at
  // publish time.
  const sourceVideoId =
    postType === "image" || postType === "carousel" ? null : body?.source_video_id ?? null

  const post = await createSocialPost({
    platform,
    content: caption,
    media_url: null,
    post_type: postType,
    approval_status: scheduledAt ? "scheduled" : "approved",
    scheduled_at: scheduledAt,
    source_video_id: sourceVideoId,
    created_by: session.user.id,
  })

  try {
    if (postType === "image" && body?.mediaAssetId) {
      await attachMedia(post.id, body.mediaAssetId, 0)
    } else if (postType === "carousel" && body?.mediaAssetIds) {
      for (let i = 0; i < body.mediaAssetIds.length; i += 1) {
        await attachMedia(post.id, body.mediaAssetIds[i], i)
      }
    }
  } catch (err) {
    // Roll back the freshly-created post so we don't leave a ghost row that
    // would later fail to publish (no asset, but post_type=image|carousel).
    await deleteSocialPost(post.id).catch(() => {})
    return NextResponse.json(
      { error: `Failed to attach media asset: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ id: post.id, approval_status: post.approval_status })
}
