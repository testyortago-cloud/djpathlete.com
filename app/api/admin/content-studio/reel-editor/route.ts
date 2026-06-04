// app/api/admin/content-studio/reel-editor/route.ts
// In-app reel editor backend. GET returns the editable snapshot + signed media
// (source video + ready b-roll clips) so the @remotion/player preview can render
// the real composition. PUT validates + upserts the snapshot (and mirrors the
// hook to video_uploads.hook_text so the legacy Split Reel panel stays in sync).
// Admin + feature_reel_editor_enabled gated. The render trigger is unchanged —
// the operator saves here, then renders via the existing split-reel/render route.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { getReelProjectForVideo, upsertReelProject } from "@/lib/db/reel-projects"
import { getVideoUploadById, updateVideoUpload } from "@/lib/db/video-uploads"
import { getBrollSegmentsForVideo } from "@/lib/db/broll-segments"
import { getMediaAssetStoragePaths, getLatestSplitReelForVideo } from "@/lib/db/media-assets"
import { getAdminStorage } from "@/lib/firebase-admin"
import {
  reelEditorSaveSchema,
  reelModeSchema,
  defaultReelProps,
  type ReelProjectProps,
} from "@/lib/validators/reel-projects"
import { withAudit } from "@/lib/audit/with-audit"

const REEL_URL_EXPIRY_MS = 6 * 60 * 60 * 1000 // 6h signed playback, matching split-reel

// Admin + feature flag gate. Returns a denial Response, or null when allowed.
async function gate(): Promise<NextResponse | null> {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const enabled = await getSetting<boolean>("feature_reel_editor_enabled", false)
  if (!enabled) return NextResponse.json({ error: "feature disabled" }, { status: 403 })
  return null
}

async function getHandler(request: Request) {
  const denied = await gate()
  if (denied) return denied

  const url = new URL(request.url)
  const videoUploadId = url.searchParams.get("videoUploadId")
  if (!videoUploadId) return NextResponse.json({ error: "videoUploadId required" }, { status: 400 })
  const modeParsed = reelModeSchema.safeParse(url.searchParams.get("mode") ?? "split_reel")
  if (!modeParsed.success) return NextResponse.json({ error: "invalid mode" }, { status: 400 })
  const mode = modeParsed.data

  const [project, video, segments, reelAsset] = await Promise.all([
    getReelProjectForVideo(videoUploadId, mode),
    getVideoUploadById(videoUploadId),
    getBrollSegmentsForVideo(videoUploadId),
    getLatestSplitReelForVideo(videoUploadId),
  ])
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 })

  const bucket = getAdminStorage().bucket()
  const sign = (p: string) =>
    bucket
      .file(p)
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + REEL_URL_EXPIRY_MS })
      .then(([u]) => u)

  // videoSrc = the SOURCE video — the composition plays the talking head / source
  // over it (TrackedVideo / SourceLayer). NOT the rendered reel.
  const videoSrc = video.storage_path ? await sign(video.storage_path) : null

  // Sign each ready b-roll clip, keyed by stable segment_index (string keys for JSON).
  const ready = segments.filter((s) => s.status === "ready" && s.media_asset_id)
  const pathById = await getMediaAssetStoragePaths(ready.map((s) => s.media_asset_id as string))
  const brollEntries = await Promise.all(
    ready.map(async (s) => {
      const sp = pathById.get(s.media_asset_id as string)
      return sp ? ([String(s.segment_index), await sign(sp)] as const) : null
    }),
  )
  const broll = Object.fromEntries(brollEntries.filter((e): e is readonly [string, string] => e !== null))

  // Effective snapshot: the saved row if present, else a provisional default
  // seeded from live truth (hook + ready b-roll). Captions/trajectory only
  // populate after a render (the worker writes them back); pre-render the preview
  // shows the source + hook + brand graphics and the UI prompts a re-render.
  const props: ReelProjectProps = project
    ? (project.props as ReelProjectProps)
    : defaultReelProps({
        hook: video.hook_text ? { text: video.hook_text } : null,
        broll: ready.map((s) => ({
          segmentIndex: s.segment_index,
          startMs: s.start_ms,
          endMs: s.end_ms,
          enabled: true,
        })),
      })

  const durationMs =
    reelAsset?.asset.duration_ms ??
    (video.duration_seconds ? Math.round(video.duration_seconds * 1000) : null)

  return NextResponse.json({
    exists: Boolean(project),
    mode,
    props,
    editedFields: project?.edited_fields ?? [],
    media: { videoSrc, broll },
    fps: 30,
    width: 1080,
    height: 1920,
    durationMs,
  })
}

async function putHandler(request: Request) {
  const denied = await gate()
  if (denied) return denied

  const parsed = reelEditorSaveSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", detail: parsed.error.flatten() }, { status: 400 })
  }
  const { videoUploadId, mode, props, editedFields } = parsed.data

  // Hook single-writer: when the operator edits the hook here, mirror it to
  // video_uploads.hook_text so the legacy Split Reel panel + the worker's
  // hook fallback stay consistent.
  if (editedFields.includes("hook")) {
    await updateVideoUpload(videoUploadId, { hook_text: props.hook?.text ?? null })
  }

  const saved = await upsertReelProject({ videoUploadId, mode, props, editedFields })
  return NextResponse.json({ ok: true, id: saved.id, updatedAt: saved.updated_at })
}

export const GET = getHandler
export const PUT = withAudit({ action: "reel_editor.save", category: "admin_write" }, putHandler)
