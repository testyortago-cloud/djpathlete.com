// app/api/admin/content-studio/quote-cards/route.ts
// Phase 2f Chunk A endpoint. Given a video upload ID, pulls the transcript,
// asks Claude to extract up to N punchy quote lines, renders each as a
// 1080x1080 PNG via @vercel/og, uploads the PNGs to Firebase Storage,
// registers each as a media_asset row, and creates a single draft Facebook
// carousel social_post with the slides attached in order.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isContentStudioMultimediaEnabled } from "@/lib/content-studio/feature-flag"
import { extractQuotesFromTranscript } from "@/lib/ai/quote-extraction"
import { renderQuoteCard } from "@/lib/content-studio/quote-card-renderer"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptByVideoId } from "@/lib/db/video-transcripts"
import { getAdminStorage } from "@/lib/firebase-admin"
import { createMediaAsset } from "@/lib/db/media-assets"
import { createSocialPost, deleteSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"

const DEFAULT_COUNT = 5
const MIN_COUNT = 2
const MAX_COUNT = 10
const MIN_TRANSCRIPT_LENGTH = 50

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isContentStudioMultimediaEnabled()) {
    return NextResponse.json(
      { error: "Multimedia features disabled. Set CS_MULTIMEDIA_ENABLED=true." },
      { status: 400 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    videoUploadId?: string
    count?: number
  } | null

  if (!body?.videoUploadId) {
    return NextResponse.json({ error: "videoUploadId is required" }, { status: 400 })
  }

  const count = Math.max(MIN_COUNT, Math.min(MAX_COUNT, body.count ?? DEFAULT_COUNT))

  // Load the video + its transcript.
  const video = await getVideoUploadById(body.videoUploadId)
  if (!video) {
    return NextResponse.json(
      { error: `Video ${body.videoUploadId} not found` },
      { status: 404 },
    )
  }
  const transcript = await getTranscriptByVideoId(body.videoUploadId)
  if (
    !transcript ||
    !transcript.transcript_text ||
    transcript.transcript_text.trim().length < MIN_TRANSCRIPT_LENGTH
  ) {
    return NextResponse.json(
      { error: "Video has no transcript or transcript is too short." },
      { status: 422 },
    )
  }

  // Extract quotes.
  const quotes = await extractQuotesFromTranscript(transcript.transcript_text, count)
  if (quotes.length === 0) {
    return NextResponse.json(
      { error: "Claude could not extract any usable quotes from this transcript." },
      { status: 422 },
    )
  }

  // Render each quote -> PNG -> upload to Firebase -> create media_asset.
  const bucket = getAdminStorage().bucket()
  const mediaAssetIds: string[] = []
  const userId = session.user.id

  for (let i = 0; i < quotes.length; i += 1) {
    const quote = quotes[i]
    const png = await renderQuoteCard(quote)
    const storagePath = `images/${userId}/${Date.now()}-quote-${i}.png`
    await bucket.file(storagePath).save(png, { contentType: "image/png" })

    const asset = await createMediaAsset({
      kind: "image",
      storage_path: storagePath,
      public_url: storagePath,
      mime_type: "image/png",
      bytes: png.length,
      width: 1080,
      height: 1080,
      duration_ms: null,
      derived_from_video_id: body.videoUploadId,
      ai_alt_text: quote.slice(0, 125),
      ai_analysis: { origin: "quote_card", quote },
      created_by: userId,
    })
    mediaAssetIds.push(asset.id)
  }

  // Create the draft FB carousel post + attach each asset.
  const post = await createSocialPost({
    platform: "facebook",
    content: "",
    media_url: null,
    post_type: "carousel",
    approval_status: "draft",
    scheduled_at: null,
    source_video_id: null,
    created_by: userId,
  })

  try {
    for (let i = 0; i < mediaAssetIds.length; i += 1) {
      await attachMedia(post.id, mediaAssetIds[i], i)
    }
  } catch (err) {
    try {
      await deleteSocialPost(post.id)
    } catch {
      // Swallow cleanup errors — the original failure is what matters.
    }
    return NextResponse.json(
      { error: `Failed to attach media: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ postId: post.id, mediaAssetIds })
}
