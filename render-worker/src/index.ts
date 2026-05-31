// render-worker/src/index.ts
// Cloud Run Job entrypoint. Inputs via env: AI_JOB_ID, VIDEO_UPLOAD_ID.
// Steps mirror the spec: load -> words -> sign -> probe/cap -> page -> render ->
// upload -> media_asset + draft posts -> flip ai_job. Any throw -> ai_job failed.

import { createClient } from "@supabase/supabase-js"
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { bundle } from "@remotion/bundler"
import { selectComposition, renderMedia, getVideoMetadata } from "@remotion/renderer"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { pageCaptions } from "./lib/caption-paging.js"
import { fetchTranscriptWords } from "./lib/assemblyai-words.js"
import { oklchToHex } from "./lib/color.js"

const MAX_CAPTION_CLIP_SECONDS = 180
const FPS = 30

// Deterministic brand accent palette (mirror of lib/content-studio/video-accent.ts)
const PALETTE = [
  "oklch(0.68 0.12 180)", "oklch(0.72 0.11 45)", "oklch(0.62 0.14 260)",
  "oklch(0.70 0.13 140)", "oklch(0.66 0.16 25)", "oklch(0.74 0.10 85)",
  "oklch(0.64 0.12 320)", "oklch(0.70 0.11 215)",
]
function accentForVideo(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const VIDEO_PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "youtube_shorts"] as const
const PLUGIN_TO_PLATFORM: Record<string, string | null> = {
  instagram: "instagram", facebook: "facebook", linkedin: "linkedin",
  tiktok: "tiktok", youtube: "youtube", youtube_shorts: "youtube_shorts",
  google_ads: null, gmail: null,
}

function fbApp() {
  if (getApps().length) return getApps()[0]
  const bucket = process.env.FIREBASE_STORAGE_BUCKET
  if (!bucket) throw new Error("FIREBASE_STORAGE_BUCKET not set")
  // On Cloud Run the job's bound service account supplies credentials via ADC —
  // no long-lived key file. Signed URLs are produced through the IAM signBlob
  // API (the SA holds Token Creator on itself + iamcredentials.googleapis.com is
  // enabled), so getSignedUrl works without a local private key.
  return initializeApp({
    credential: applicationDefault(),
    storageBucket: bucket,
  })
}

async function main() {
  const aiJobId = process.env.AI_JOB_ID
  const videoUploadId = process.env.VIDEO_UPLOAD_ID
  if (!aiJobId || !videoUploadId) throw new Error("AI_JOB_ID and VIDEO_UPLOAD_ID required")

  const app = fbApp()
  const firestore = getFirestore(app)
  const bucket = getStorage(app).bucket()
  const jobRef = firestore.collection("ai_jobs").doc(aiJobId)

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  try {
    // 1. Load video + speech transcript
    const { data: video, error: vErr } = await supabase
      .from("video_uploads").select("*").eq("id", videoUploadId).single()
    if (vErr || !video) throw new Error(`video_uploads ${videoUploadId} not found`)

    const { data: tx, error: tErr } = await supabase
      .from("video_transcripts").select("*")
      .eq("video_upload_id", videoUploadId).eq("source", "speech")
      .not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (tErr || !tx?.assemblyai_job_id) throw new Error("no speech transcript with an AssemblyAI id")

    // 2. Word timestamps
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)

    // 3. Sign source URL (7-day default is plenty for a <5min render)
    const [signedUrl] = await bucket.file(video.storage_path).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })

    // Probe real duration and enforce the cap (don't trust duration_seconds)
    const meta = await getVideoMetadata(signedUrl)
    const durationInSeconds = meta.durationInSeconds
    if (durationInSeconds === null) throw new Error("could not determine video duration")
    if (durationInSeconds > MAX_CAPTION_CLIP_SECONDS) {
      throw new Error(`clip is ${Math.round(durationInSeconds)}s — exceeds the ${MAX_CAPTION_CLIP_SECONDS}s cap`)
    }

    // 4. Page captions
    const pages = pageCaptions(words)

    // 5. Render
    const entry = path.join(process.cwd(), "dist", "remotion", "index.js")
    const serveUrl = await bundle({ entryPoint: entry })
    const durationInFrames = Math.max(1, Math.ceil(durationInSeconds * FPS))
    const inputProps = { videoSrc: signedUrl, pages, accentHex: oklchToHex(accentForVideo(videoUploadId)) }
    const comp = await selectComposition({ serveUrl, id: "CaptionedCut", inputProps })
    const outPath = path.join(os.tmpdir(), `captioned-${aiJobId}.mp4`)
    await renderMedia({
      composition: { ...comp, durationInFrames, fps: FPS, width: 1080, height: 1920 },
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
    })

    // 6. Upload
    const userId = (video.uploaded_by as string | null) ?? "system"
    const storagePath = `videos/${userId}/${Date.now()}-captioned-cut.mp4`
    await bucket.upload(outPath, { destination: storagePath, contentType: "video/mp4" })
    const bytes = fs.statSync(outPath).size
    fs.rmSync(outPath, { force: true }) // free RAM-backed /tmp before the DB writes

    // 7. media_asset
    const { data: asset, error: aErr } = await supabase.from("media_assets").insert({
      kind: "video",
      storage_path: storagePath,
      public_url: storagePath, // signed on read
      mime_type: "video/mp4",
      bytes,
      width: 1080,
      height: 1920,
      duration_ms: Math.round(durationInSeconds * 1000),
      derived_from_video_id: videoUploadId,
      ai_alt_text: null,
      ai_analysis: { origin: "captioned_cut" },
      created_by: video.uploaded_by ?? null,
    }).select().single()
    if (aErr || !asset) throw new Error(`media_asset insert failed: ${aErr?.message}`)

    // 8. One draft post per video-capable CONNECTED platform. fn_list_platform_connections
    // returns every row (including not_connected/error/paused), so filter to connected.
    const { data: connections, error: cErr } = await supabase.rpc("fn_list_platform_connections")
    if (cErr) throw new Error(`fn_list_platform_connections failed: ${cErr.message}`)
    const platforms = ((connections ?? []) as { plugin_name: string; status: string }[])
      .filter((c) => c.status === "connected")
      .map((c) => PLUGIN_TO_PLATFORM[c.plugin_name])
      .filter((p): p is string => p !== null && (VIDEO_PLATFORMS as readonly string[]).includes(p))
    if (platforms.length === 0) {
      console.log("[render-worker] no video-capable connected platforms — asset created, no draft posts")
    }

    const postIds: string[] = []
    for (const platform of platforms) {
      const { data: post, error: pErr } = await supabase.from("social_posts").insert({
        platform,
        content: "",
        media_url: null,
        post_type: "video",
        approval_status: "draft",
        scheduled_at: null,
        source_video_id: videoUploadId,
        created_by: video.uploaded_by ?? null,
      }).select().single()
      if (pErr || !post) throw new Error(`social_post insert failed: ${pErr?.message}`)
      const { error: mErr } = await supabase.from("social_post_media").insert({
        social_post_id: post.id, media_asset_id: asset.id, position: 0,
      })
      if (mErr) throw new Error(`attach media failed: ${mErr.message}`)
      postIds.push(post.id)
    }

    // 9. Complete
    await jobRef.update({
      status: "completed",
      result: { assetId: asset.id, postIds },
      updatedAt: FieldValue.serverTimestamp(),
    })
    process.exit(0)
  } catch (err) {
    await jobRef.update({
      status: "failed",
      error: (err as Error).message ?? "render failed",
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    console.error("[render-worker]", err)
    process.exit(1)
  }
}

void main()
