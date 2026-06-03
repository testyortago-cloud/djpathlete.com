// render-worker/src/index.ts
// Cloud Run Job entrypoint. Inputs via env: AI_JOB_ID, VIDEO_UPLOAD_ID.
// Steps mirror the spec: load -> words -> sign -> probe/cap -> page -> render ->
// upload -> media_asset + draft posts -> flip ai_job. Any throw -> ai_job failed.

import { createClient } from "@supabase/supabase-js"
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { bundle } from "@remotion/bundler"
import { selectComposition, renderMedia, getVideoMetadata } from "@remotion/renderer"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { pageCaptions } from "./lib/caption-paging.js"
import { fetchTranscriptWords } from "./lib/assemblyai-words.js"
import { serveFileLocally } from "./lib/serve-file.js"
import { planCutAttachment } from "./lib/attach-plan.js"
import { detectFaceTrajectory } from "./lib/detect-face.js"
import { smoothTrajectory } from "./lib/face-track.js"
import { loadReadyBrollClips } from "./lib/broll-fetch.js"

const MAX_CAPTION_CLIP_SECONDS = 180
const FPS = 30

// Brand accent (Gray Orange) for the active caption word. This is the EXACT sRGB
// of the site's `--accent: oklch(0.7 0.08 60)` token (app/globals.css). The brand
// docs' "#C49B7A" is a slightly grayer approximation; #c4936b matches what renders
// on the site. sRGB hex (not the oklch token) because H.264 video is sRGB anyway.
const BRAND_ACCENT_HEX = "#c4936b"

const VIDEO_PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "youtube_shorts"] as const
const PLUGIN_TO_PLATFORM: Record<string, string | null> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
  youtube_shorts: "youtube_shorts",
  google_ads: null,
  gmail: null,
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
    // Optional — only needed for the live render-progress writes to Realtime
    // Database. Absent = progress writes are silently skipped (render still works).
    ...(process.env.FIREBASE_DATABASE_URL ? { databaseURL: process.env.FIREBASE_DATABASE_URL } : {}),
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

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  // Live render progress → Realtime Database, keyed by the ai_jobs doc id so the
  // client (renderJobIdByVideo) can subscribe at renderProgress/{aiJobId}. Entirely
  // best-effort: if FIREBASE_DATABASE_URL is unset or the SA lacks RTDB access, every
  // call below no-ops and the render proceeds normally (client falls back to the
  // elapsed timer). Throttled to ≤~2.5 writes/sec and only on a whole-% change.
  const progressRef = (() => {
    try {
      if (!process.env.FIREBASE_DATABASE_URL) return null
      return getDatabase(app).ref(`renderProgress/${aiJobId}`)
    } catch (e) {
      console.warn(`[render-worker] RTDB progress disabled: ${(e as Error).message}`)
      return null
    }
  })()
  let lastProgressPct = -1
  let lastProgressAt = 0
  async function writeProgress(progress: number, stage: string) {
    if (!progressRef) return
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)))
    const now = Date.now()
    if (pct === lastProgressPct && now - lastProgressAt < 1000) return
    if (now - lastProgressAt < 400) return
    lastProgressPct = pct
    lastProgressAt = now
    try {
      await progressRef.set({ progress, pct, stage, updatedAt: now })
    } catch (e) {
      console.warn(`[render-worker] progress write failed: ${(e as Error).message}`)
    }
  }
  async function clearProgress() {
    if (!progressRef) return
    try {
      await progressRef.remove()
    } catch {
      /* best-effort */
    }
  }

  try {
    // 1. Load video + speech transcript
    const { data: video, error: vErr } = await supabase
      .from("video_uploads")
      .select("*")
      .eq("id", videoUploadId)
      .single()
    if (vErr || !video) throw new Error(`video_uploads ${videoUploadId} not found`)

    const { data: tx, error: tErr } = await supabase
      .from("video_transcripts")
      .select("*")
      .eq("video_upload_id", videoUploadId)
      .eq("source", "speech")
      .not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
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
    // Music selection (panel → route → ai_jobs.input.music). Music is OFF by
    // default — only an explicitly chosen track that exists in the baked
    // public/music dir plays; absent / "none" / unknown → no music bed.
    const rawMusic = jobSnap.data()?.input?.music
    const musicSel = typeof rawMusic === "string" ? rawMusic.trim() : ""
    const musicExists = (name: string) =>
      name !== "" && fs.existsSync(path.join(process.cwd(), "public", "music", name))
    const musicTrack = musicSel !== "none" && musicExists(musicSel) ? musicSel : ""
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
      // Stream coarse progress to RTDB for the client's live "rendering" bar.
      // progress is 0..1 across render+encode; stitchStage distinguishes the tail.
      onProgress: ({ progress, stitchStage }) => {
        void writeProgress(progress, stitchStage === "muxing" ? "finalizing" : "rendering")
      },
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
    const { data: asset, error: aErr } = await supabase
      .from("media_assets")
      .insert({
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
      })
      .select()
      .single()
    if (aErr || !asset) throw new Error(`media_asset insert failed: ${aErr?.message}`)

    // 8. Attach the rendered cut to the EXISTING caption posts. The social
    // fanout (functions/src/social-fanout.ts) already created one draft caption
    // post per platform, so the render must NOT create its own posts — doing so
    // produced blank, caption-less duplicates. For each connected video platform
    // we attach the reel to that platform's existing caption post; a platform
    // with no caption post is skipped (the asset still exists, just unattached).
    // fn_list_platform_connections returns every row (including
    // not_connected/error/paused), so filter to connected.
    const { data: connections, error: cErr } = await supabase.rpc("fn_list_platform_connections")
    if (cErr) throw new Error(`fn_list_platform_connections failed: ${cErr.message}`)
    const platforms = ((connections ?? []) as { plugin_name: string; status: string }[])
      .filter((c) => c.status === "connected")
      .map((c) => PLUGIN_TO_PLATFORM[c.plugin_name])
      .filter((p): p is string => p !== null && (VIDEO_PLATFORMS as readonly string[]).includes(p))

    // Existing posts for this video, oldest first so the original fanout caption
    // is preferred over any later row for the same platform.
    const { data: existingPosts, error: epErr } = await supabase
      .from("social_posts")
      .select("id, platform, created_at")
      .eq("source_video_id", videoUploadId)
      .neq("approval_status", "rejected")
      .order("created_at", { ascending: true })
    if (epErr) throw new Error(`load existing posts failed: ${epErr.message}`)

    const plan = planCutAttachment(platforms, (existingPosts ?? []) as { id: string; platform: string }[])

    const postIds: string[] = []
    for (const { platform, postId } of plan) {
      if (!postId) {
        console.log(`[render-worker] no caption post for ${platform} — cut not attached`)
        continue
      }
      // Re-render replace: drop any prior cut of THIS source video already
      // attached to the post before attaching the new one, so re-renders never
      // stack multiple videos on a single post.
      const { data: links } = await supabase
        .from("social_post_media")
        .select("media_asset_id")
        .eq("social_post_id", postId)
      const linkedIds = (links ?? []).map((l) => l.media_asset_id as string)
      if (linkedIds.length > 0) {
        const { data: priorCuts } = await supabase
          .from("media_assets")
          .select("id")
          .in("id", linkedIds)
          .eq("kind", "video")
          .eq("derived_from_video_id", videoUploadId)
        const priorCutIds = (priorCuts ?? []).map((a) => a.id as string)
        if (priorCutIds.length > 0) {
          await supabase
            .from("social_post_media")
            .delete()
            .eq("social_post_id", postId)
            .in("media_asset_id", priorCutIds)
        }
      }
      const { error: mErr } = await supabase.from("social_post_media").insert({
        social_post_id: postId,
        media_asset_id: asset.id,
        position: 0,
      })
      if (mErr) throw new Error(`attach media to ${platform} post ${postId} failed: ${mErr.message}`)
      postIds.push(postId)
    }

    // 9. Complete. Clear any error left by a prior failed attempt on this doc
    // (the retry / re-run path) so a completed job never carries a stale error.
    await jobRef.update({
      status: "completed",
      error: null,
      result: { assetId: asset.id, postIds },
      updatedAt: FieldValue.serverTimestamp(),
    })
    await clearProgress() // render done — drop the live-progress node
    process.exit(0)
  } catch (err) {
    await clearProgress() // failed — drop the live-progress node (card → needs edit)
    await jobRef
      .update({
        status: "failed",
        error: (err as Error).message ?? "render failed",
        updatedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {})
    console.error("[render-worker]", err)
    process.exit(1)
  }
}

// ── Split Reel path (RENDER_MODE=split_reel) ─────────────────────────────────
// Mirrors main() but renders the SplitReel composition with a detected face
// trajectory + the ready fal b-roll clips. Reuses the same helpers (download,
// metadata, serveFileLocally, pageCaptions, bundle, render, upload) and the same
// attach-to-existing-posts logic (planCutAttachment) so a Split Reel lands on the
// same draft posts as a captioned cut. main() is left untouched.
async function runSplitReel(): Promise<void> {
  const aiJobId = process.env.AI_JOB_ID
  const videoUploadId = process.env.VIDEO_UPLOAD_ID
  if (!aiJobId || !videoUploadId) throw new Error("AI_JOB_ID and VIDEO_UPLOAD_ID required")

  const app = fbApp()
  const firestore = getFirestore(app)
  const bucket = getStorage(app).bucket()
  const jobRef = firestore.collection("ai_jobs").doc(aiJobId)
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const servers: Array<{ close: () => Promise<void> }> = []
  try {
    // 1. video + speech transcript
    const { data: video, error: vErr } = await supabase.from("video_uploads").select("*").eq("id", videoUploadId).single()
    if (vErr || !video) throw new Error(`video_uploads ${videoUploadId} not found`)
    const { data: tx } = await supabase
      .from("video_transcripts").select("*").eq("video_upload_id", videoUploadId)
      .eq("source", "speech").not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (!tx?.assemblyai_job_id) throw new Error("no speech transcript with an AssemblyAI id")

    // 2. words + pages
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)
    const pages = pageCaptions(words)

    // 3. download source
    const workDir = path.join(os.tmpdir(), "split-reel", aiJobId)
    fs.mkdirSync(workDir, { recursive: true })
    const srcExt = path.extname(video.storage_path) || ".mp4"
    const srcPath = path.join(workDir, `source${srcExt}`)
    await bucket.file(video.storage_path).download({ destination: srcPath })

    const meta = await getVideoMetadata(srcPath)
    const durationInSeconds = meta.durationInSeconds
    if (durationInSeconds === null) throw new Error("could not determine video duration")
    if (durationInSeconds > MAX_CAPTION_CLIP_SECONDS) throw new Error(`clip exceeds ${MAX_CAPTION_CLIP_SECONDS}s cap`)

    // 4. face trajectory (detect on the local file, then smooth)
    const rawTrajectory = await detectFaceTrajectory(srcPath, { sampleEveryMs: 200 })
    const trajectory = smoothTrajectory(rawTrajectory, 600)

    // 5. serve source + ready b-roll clips over loopback
    const srcServer = await serveFileLocally(srcPath)
    servers.push(srcServer)
    const brollClips = await loadReadyBrollClips(supabase, bucket, videoUploadId, workDir)
    brollClips.forEach((c) => servers.push({ close: c.close }))

    // 6. render SplitReel
    const entry = path.join(process.cwd(), "dist", "remotion", "index.js")
    const serveUrl = await bundle({ entryPoint: entry, publicDir: path.join(process.cwd(), "public") })
    const durationInFrames = Math.max(1, Math.ceil(durationInSeconds * FPS))
    const inputProps = {
      videoSrc: srcServer.url,
      pages,
      accentHex: BRAND_ACCENT_HEX,
      trajectory,
      broll: brollClips.map((c) => ({ startMs: c.startMs, endMs: c.endMs, src: c.url })),
    }
    const comp = await selectComposition({ serveUrl, id: "SplitReel", inputProps })
    const outDir = path.join(os.tmpdir(), "split-reel")
    fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, `${aiJobId}.mp4`)
    await renderMedia({
      composition: { ...comp, durationInFrames, fps: FPS, width: 1080, height: 1920 },
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      chromiumOptions: { enableMultiProcessOnLinux: true },
      offthreadVideoCacheSizeInBytes: 4 * 1024 * 1024 * 1024,
      concurrency: 4,
    })

    await Promise.all(servers.map((s) => s.close().catch(() => {})))
    fs.rmSync(srcPath, { force: true })

    // 7. upload + media_asset(origin='split_reel')
    const userId = (video.uploaded_by as string | null) ?? "system"
    const storagePath = `videos/${userId}/${Date.now()}-split-reel.mp4`
    await bucket.upload(outPath, { destination: storagePath, contentType: "video/mp4" })
    const bytes = fs.statSync(outPath).size
    fs.rmSync(outPath, { force: true })

    const { data: asset, error: aErr } = await supabase.from("media_assets").insert({
      kind: "video", storage_path: storagePath, public_url: storagePath, mime_type: "video/mp4",
      bytes, width: 1080, height: 1920, duration_ms: Math.round(durationInSeconds * 1000),
      derived_from_video_id: videoUploadId, ai_alt_text: null,
      ai_analysis: { origin: "split_reel" }, created_by: video.uploaded_by ?? null,
    }).select().single()
    if (aErr || !asset) throw new Error(`media_asset insert failed: ${aErr?.message}`)

    // 8. Attach to the EXISTING caption posts — same approach as the captioned-cut
    // path (reuse planCutAttachment; never create new posts).
    const { data: connections, error: cErr } = await supabase.rpc("fn_list_platform_connections")
    if (cErr) throw new Error(`fn_list_platform_connections failed: ${cErr.message}`)
    const platforms = ((connections ?? []) as { plugin_name: string; status: string }[])
      .filter((c) => c.status === "connected")
      .map((c) => PLUGIN_TO_PLATFORM[c.plugin_name])
      .filter((p): p is string => p !== null && (VIDEO_PLATFORMS as readonly string[]).includes(p))
    const { data: existingPosts, error: epErr } = await supabase
      .from("social_posts")
      .select("id, platform, created_at")
      .eq("source_video_id", videoUploadId)
      .neq("approval_status", "rejected")
      .order("created_at", { ascending: true })
    if (epErr) throw new Error(`load existing posts failed: ${epErr.message}`)
    const plan = planCutAttachment(platforms, (existingPosts ?? []) as { id: string; platform: string }[])
    const postIds: string[] = []
    for (const { platform, postId } of plan) {
      if (!postId) {
        console.log(`[split-reel] no caption post for ${platform} — reel not attached`)
        continue
      }
      const { data: links } = await supabase
        .from("social_post_media").select("media_asset_id").eq("social_post_id", postId)
      const linkedIds = (links ?? []).map((l) => l.media_asset_id as string)
      if (linkedIds.length > 0) {
        const { data: priorCuts } = await supabase
          .from("media_assets").select("id").in("id", linkedIds)
          .eq("kind", "video").eq("derived_from_video_id", videoUploadId)
        const priorCutIds = (priorCuts ?? []).map((a) => a.id as string)
        if (priorCutIds.length > 0) {
          await supabase.from("social_post_media").delete().eq("social_post_id", postId).in("media_asset_id", priorCutIds)
        }
      }
      const { error: mErr } = await supabase.from("social_post_media").insert({
        social_post_id: postId, media_asset_id: asset.id, position: 0,
      })
      if (mErr) throw new Error(`attach media to ${platform} post ${postId} failed: ${mErr.message}`)
      postIds.push(postId)
    }

    // 9. complete
    await jobRef.update({ status: "completed", error: null, result: { assetId: asset.id, postIds }, updatedAt: FieldValue.serverTimestamp() })
    process.exit(0)
  } catch (err) {
    await Promise.all(servers.map((s) => s.close().catch(() => {})))
    await jobRef.update({ status: "failed", error: (err as Error).message ?? "split render failed", updatedAt: FieldValue.serverTimestamp() }).catch(() => {})
    console.error("[split-reel]", err)
    process.exit(1)
  }
}

const mode = process.env.RENDER_MODE === "split_reel" ? "split_reel" : "caption"
void (mode === "split_reel" ? runSplitReel() : main())
