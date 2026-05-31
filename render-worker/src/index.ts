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
import { serveFileLocally } from "./lib/serve-file.js"

const MAX_CAPTION_CLIP_SECONDS = 180
const FPS = 30

// Brand accent (Gray Orange) for the active caption word. This is the EXACT sRGB
// of the site's `--accent: oklch(0.7 0.08 60)` token (app/globals.css). The brand
// docs' "#C49B7A" is a slightly grayer approximation; #c4936b matches what renders
// on the site. sRGB hex (not the oklch token) because H.264 video is sRGB anyway.
const BRAND_ACCENT_HEX = "#c4936b"

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
    console.log(`[render-worker] step=words transcript=${tx.assemblyai_job_id}`)
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)
    console.log(`[render-worker] step=words ok count=${words.length}`)

    // 3. Download source to local /tmp. Remotion's getVideoMetadata (and the
    // ffmpeg compositor) only accept LOCAL absolute paths — "URLs are not
    // supported" (Remotion docs). Passing a signed HTTPS URL to getVideoMetadata
    // failed with "Compositor error: No such file or directory".
    const workDir = path.join(os.tmpdir(), "captioned-cut", aiJobId)
    fs.mkdirSync(workDir, { recursive: true })
    const srcExt = path.extname(video.storage_path) || ".mp4"
    const srcPath = path.join(workDir, `source${srcExt}`)
    console.log(`[render-worker] step=download path=${video.storage_path}`)
    await bucket.file(video.storage_path).download({ destination: srcPath })
    const srcBytes = fs.statSync(srcPath).size
    console.log(`[render-worker] step=download ok bytes=${srcBytes} -> ${srcPath}`)

    // Probe real duration and enforce the cap (don't trust duration_seconds)
    console.log(`[render-worker] step=metadata`)
    const meta = await getVideoMetadata(srcPath)
    const durationInSeconds = meta.durationInSeconds
    if (durationInSeconds === null) throw new Error("could not determine video duration")
    if (durationInSeconds > MAX_CAPTION_CLIP_SECONDS) {
      throw new Error(`clip is ${Math.round(durationInSeconds)}s — exceeds the ${MAX_CAPTION_CLIP_SECONDS}s cap`)
    }
    console.log(`[render-worker] step=metadata ok duration=${durationInSeconds}s`)

    // <OffthreadVideo> runs inside headless Chrome; the compositor fetches the
    // source over HTTP and REJECTS file:// ("Can only download URLs starting with
    // http:// or https://"). getVideoMetadata needs the exact opposite (a local
    // path). Earlier we handed OffthreadVideo a remote signed URL, but a range
    // fetch to GCS dropped mid-render ("Request closed" -> "No frame found at
    // position"). So serve the already-downloaded /tmp file over loopback instead:
    // a local path for the probe above, a 127.0.0.1 URL for the compositor — no
    // external connection that can drop during the multi-minute render.
    console.log(`[render-worker] step=serve file=${srcPath}`)
    const videoServer = await serveFileLocally(srcPath)
    const videoSrcUrl = videoServer.url
    console.log(`[render-worker] step=serve ok url=${videoSrcUrl}`)

    // 4. Page captions
    const pages = pageCaptions(words)
    console.log(`[render-worker] step=paging ok pages=${pages.length}`)

    // 5. Render
    const entry = path.join(process.cwd(), "dist", "remotion", "index.js")
    console.log(`[render-worker] step=bundle entry=${entry}`)
    // publicDir lets <Img src={staticFile(...)}> resolve the baked-in brand assets
    // (the Dockerfile COPYs ./public into /app/public alongside the compiled dist/).
    const serveUrl = await bundle({ entryPoint: entry, publicDir: path.join(process.cwd(), "public") })
    console.log(`[render-worker] step=bundle ok`)
    const durationInFrames = Math.max(1, Math.ceil(durationInSeconds * FPS))
    // Optional hook title (set by the panel → route → ai_jobs.input.hook). Absent
    // for older/other jobs → no hook card. Trim + cap defensively (mirror the
    // validator) so a bad value can never blow up the render.
    const jobSnap = await jobRef.get()
    const rawHook = jobSnap.data()?.input?.hook
    const hookText = typeof rawHook === "string" ? rawHook.trim().slice(0, 80) : ""
    // Music selection (panel → route → ai_jobs.input.music). Absent → the brand
    // default; "none" → no music; otherwise the chosen track IF it exists in the
    // baked public/music dir (guard against a bad name crashing the render).
    const DEFAULT_MUSIC = "motivational-cinematic.mp3"
    const rawMusic = jobSnap.data()?.input?.music
    const musicSel = typeof rawMusic === "string" ? rawMusic.trim() : ""
    const musicExists = (name: string) =>
      name !== "" && fs.existsSync(path.join(process.cwd(), "public", "music", name))
    const musicTrack =
      musicSel === "none" ? "" : musicExists(musicSel) ? musicSel : musicExists(DEFAULT_MUSIC) ? DEFAULT_MUSIC : ""
    console.log(`[render-worker] step=music ${musicTrack ? `track=${musicTrack}` : "none"}`)
    const inputProps = {
      videoSrc: videoSrcUrl,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      ...(hookText ? { hook: { text: hookText } } : {}),
      ...(musicTrack ? { music: { track: musicTrack } } : {}),
    }
    console.log(`[render-worker] step=hook ${hookText ? `text="${hookText}"` : "none"}`)
    console.log(`[render-worker] step=selectComposition frames=${durationInFrames}`)
    const comp = await selectComposition({ serveUrl, id: "CaptionedCut", inputProps })
    console.log(`[render-worker] step=selectComposition ok`)
    const outDir = path.join(os.tmpdir(), "captioned-cut")
    fs.mkdirSync(outDir, { recursive: true }) // guarantee the output dir exists
    const outPath = path.join(outDir, `${aiJobId}.mp4`)
    console.log(`[render-worker] step=render out=${outPath}`)
    await renderMedia({
      composition: { ...comp, durationInFrames, fps: FPS, width: 1080, height: 1920 },
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      // Remotion's documented setting for headless Chrome in Docker/Linux.
      chromiumOptions: { enableMultiProcessOnLinux: true },
      // "No frame found at position" = the OffthreadVideo frame cache evicting
      // decoded frames before the compositor reads them (Remotion's documented
      // cause: too little memory). OffthreadVideo downloads the WHOLE source for
      // extraction, so on a memory-tight box the default cache thrashes and the
      // render dies mid-way (non-deterministically: frame 352 / 2480 across runs).
      // A 4 GiB shared cache (job has 16 GiB) keeps ample headroom even at
      // concurrency 4 so decoded frames survive until the compositor reads them.
      offthreadVideoCacheSizeInBytes: 4 * 1024 * 1024 * 1024,
      // Render N frames in parallel (one Chrome tab each). The job runs 4 vCPU,
      // so 4-way concurrency ~doubles throughput vs the old 2 vCPU / 2-way.
      concurrency: 4,
    })
    console.log(`[render-worker] step=render ok out=${outPath}`)
    await videoServer.close() // render done — stop serving the source
    fs.rmSync(srcPath, { force: true }) // free RAM-backed /tmp before upload + DB writes

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

    // 9. Complete. Clear any error left by a prior failed attempt on this doc
    // (the retry / re-run path) so a completed job never carries a stale error.
    await jobRef.update({
      status: "completed",
      error: null,
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
