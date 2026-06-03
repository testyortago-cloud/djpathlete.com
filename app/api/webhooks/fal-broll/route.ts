// app/api/webhooks/fal-broll/route.ts
// fal calls this when a b-roll clip finishes. We download the result, store it as a
// media_asset, mark the segment ready, and (when the batch is done) complete the
// broll_generation ai_job — which on-ai-job-completed then chains to the render.
import { NextResponse, type NextRequest } from "next/server"
import { getAdminStorage, getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { getBrollSegmentById, updateBrollSegment, getBrollSegmentsForJob } from "@/lib/db/broll-segments"
import { createMediaAsset } from "@/lib/db/media-assets"
import { fetchBrollResultUrl } from "@/lib/split-reel/fal-result"

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const segmentId = searchParams.get("segment_id")
  const token = searchParams.get("token")
  if (!segmentId || token !== process.env.BROLL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const segment = await getBrollSegmentById(segmentId)
  if (!segment) return NextResponse.json({ error: "unknown segment" }, { status: 404 })
  if (segment.status === "ready") return NextResponse.json({ ok: true }) // idempotent

  const payload = (await request.json().catch(() => ({}))) as {
    status?: string
    payload?: { video?: { url?: string } }
    error?: string
  }

  try {
    if (payload.status && payload.status !== "OK" && payload.status !== "completed") {
      await updateBrollSegment(segmentId, { status: "failed" })
      await maybeCompleteGenerationJob(segment.generation_job_id)
      return NextResponse.json({ ok: true })
    }

    // Prefer the URL in the webhook payload; fall back to fetching the result.
    const videoUrl =
      payload.payload?.video?.url ??
      (segment.fal_request_id ? await fetchBrollResultUrl(segment.fal_request_id, segment.video_upload_id) : null)
    if (!videoUrl) throw new Error("no video url in fal result")

    // Download → Firebase Storage
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`download fal clip failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const storagePath = `videos/broll/${segment.video_upload_id}/${segment.segment_index}-${Date.now()}.mp4`
    await getAdminStorage().bucket().file(storagePath).save(buf, { contentType: "video/mp4" })

    const asset = await createMediaAsset({
      kind: "video",
      storage_path: storagePath,
      public_url: storagePath,
      mime_type: "video/mp4",
      width: 1080,
      height: 960,
      duration_ms: segment.end_ms - segment.start_ms,
      bytes: buf.length,
      derived_from_video_id: segment.video_upload_id,
      ai_alt_text: null,
      ai_analysis: { origin: "ai_broll", cache_key: segment.cache_key, concept: segment.concept },
      created_by: null,
    })

    await updateBrollSegment(segmentId, { status: "ready", media_asset_id: asset.id })
    await maybeCompleteGenerationJob(segment.generation_job_id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    await updateBrollSegment(segmentId, { status: "failed" }).catch(() => {})
    await maybeCompleteGenerationJob(segment.generation_job_id).catch(() => {})
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

async function maybeCompleteGenerationJob(jobId: string): Promise<void> {
  const segments = await getBrollSegmentsForJob(jobId)
  if (segments.some((s) => s.status === "pending" || s.status === "generating")) return
  const ready = segments.filter((s) => s.status === "ready").length
  const db = getAdminFirestore()
  await db.collection("ai_jobs").doc(jobId).update({
    status: "completed",
    error: null,
    result: { segmentCount: ready },
    updatedAt: FieldValue.serverTimestamp(),
  })
}
