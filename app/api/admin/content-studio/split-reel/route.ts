// app/api/admin/content-studio/split-reel/route.ts
// Admin-only Split Reel route. GET returns current pipeline state (in-flight
// generation/render jobs + b-roll segments) so a panel can rehydrate. POST is
// gated by feature_split_reel_enabled, validates the payload, requires a speech
// transcript, dedupes against an in-flight generation, then queues a
// broll_generation ai_job (which auto-chains to split_reel_render on completion).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { splitReelGenerateSchema } from "@/lib/validators/split-reel"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightBrollGeneration, findInFlightSplitRender } from "@/lib/ai-jobs"
import { getBrollSegmentsForVideo } from "@/lib/db/broll-segments"
import { getLatestSplitReelForVideo, getMediaAssetStoragePaths } from "@/lib/db/media-assets"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getAdminStorage } from "@/lib/firebase-admin"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const REEL_URL_EXPIRY_MS = 6 * 60 * 60 * 1000 // 6h signed playback, matching captioned-cut

async function getHandler(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const videoUploadId = new URL(request.url).searchParams.get("videoUploadId")
  if (!videoUploadId) return NextResponse.json({ error: "videoUploadId required" }, { status: 400 })

  const [genJob, renderJob, segments, reelAsset, video] = await Promise.all([
    findInFlightBrollGeneration(videoUploadId),
    findInFlightSplitRender(videoUploadId),
    getBrollSegmentsForVideo(videoUploadId),
    getLatestSplitReelForVideo(videoUploadId),
    getVideoUploadById(videoUploadId),
  ])

  // Sign each ready window's b-roll clip so the review strip can preview it.
  const bucket = getAdminStorage().bucket()
  const readyAssetIds = segments
    .filter((s) => s.status === "ready" && s.media_asset_id)
    .map((s) => s.media_asset_id as string)
  const pathById = await getMediaAssetStoragePaths(readyAssetIds)
  const signed = new Map<string, string>()
  await Promise.all(
    [...pathById.entries()].map(async ([assetId, storagePath]) => {
      const [url] = await bucket
        .file(storagePath)
        .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + REEL_URL_EXPIRY_MS })
      signed.set(assetId, url)
    }),
  )

  const windows = segments
    .filter((s) => s.status !== "dropped")
    .map((s) => ({
      id: s.id,
      index: s.segment_index,
      concept: s.concept,
      prompt: s.prompt,
      status: s.status,
      startMs: s.start_ms,
      endMs: s.end_ms,
      clipUrl: s.media_asset_id ? (signed.get(s.media_asset_id) ?? null) : null,
    }))
  const dropped = segments
    .filter((s) => s.status === "dropped")
    .map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, concept: s.concept }))

  let reel = null
  if (reelAsset) {
    const [signedUrl] = await bucket
      .file(reelAsset.asset.storage_path)
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + REEL_URL_EXPIRY_MS })
    reel = {
      assetId: reelAsset.asset.id,
      signedUrl,
      width: reelAsset.asset.width,
      height: reelAsset.asset.height,
      durationMs: reelAsset.asset.duration_ms,
      createdAt: reelAsset.asset.created_at,
      posts: reelAsset.posts.map((p) => ({ id: p.id, platform: p.platform, approvalStatus: p.approval_status })),
    }
  }

  return NextResponse.json({
    inFlightBrollJobId: genJob,
    inFlightRenderJobId: renderJob,
    windows,
    dropped,
    reel,
    hookText: typeof video?.hook_text === "string" ? video.hook_text : "",
  })
}

async function postHandler(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const enabled = await getSetting<boolean>("feature_split_reel_enabled", false)
  if (!enabled) return NextResponse.json({ error: "feature disabled" }, { status: 403 })

  const parsed = splitReelGenerateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  const { videoUploadId } = parsed.data

  const transcript = await getSpeechTranscriptForVideo(videoUploadId)
  if (!transcript) return NextResponse.json({ error: "no speech transcript" }, { status: 409 })

  const existing = await findInFlightBrollGeneration(videoUploadId)
  if (existing) return NextResponse.json({ jobId: existing }, { status: 200 })

  const { jobId } = await createAiJob({ type: "broll_generation", userId: session.user.id, input: { videoUploadId } })
  return NextResponse.json({ jobId }, { status: 202 })
}

// GET is a plain state read (not audited — reads of render state don't need an
// audit trail, and the single "split_reel.broll_generate" slug is admin_write).
export const GET = getHandler
export const POST = withAudit({ action: "split_reel.broll_generate", category: "admin_write" }, postHandler)
