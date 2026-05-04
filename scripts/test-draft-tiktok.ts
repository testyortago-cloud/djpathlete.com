// Uploads a video from video_uploads (Firebase Storage) to TikTok using the
// Inbox/Draft flow — the video lands as a draft notification inside the user's
// TikTok app where they can review caption/effects/cover and choose to publish
// or discard. Nothing goes live until the user posts from the app.
//
// Endpoint: POST /v2/post/publish/inbox/video/init/   (requires `video.upload` scope)
//
// If the scope wasn't granted at OAuth time, the API returns
// `scope_not_authorized` and we fall back to instructions for the
// production-equivalent path (Direct Post with privacy=SELF_ONLY).
//
// Usage:
//   npx tsx scripts/test-draft-tiktok.ts --list
//   npx tsx scripts/test-draft-tiktok.ts                              # show pick, no upload
//   npx tsx scripts/test-draft-tiktok.ts --upload                     # upload most recent video_upload (Firebase)
//   npx tsx scripts/test-draft-tiktok.ts --upload --id <uuid>         # specific video_upload (Firebase)
//   npx tsx scripts/test-draft-tiktok.ts --upload --public-url <url>  # upload from a verified-domain URL
//   npx tsx scripts/test-draft-tiktok.ts --status <publish_id>        # poll status
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"
import { listVideoUploads, getVideoUploadById } from "@/lib/db/video-uploads"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import type { TikTokCredentials } from "@/lib/social/plugins/tiktok"
import type { VideoUpload } from "@/types/database"

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const INBOX_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
const STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"

// TikTok needs to be able to fetch the URL while it ingests. 1h is generous.
const SIGNED_URL_TTL_MS = 60 * 60 * 1000

function parseArgs() {
  const args = process.argv.slice(2)
  const idIdx = args.indexOf("--id")
  const statusIdx = args.indexOf("--status")
  const urlIdx = args.indexOf("--public-url")
  return {
    list: args.includes("--list"),
    upload: args.includes("--upload"),
    id: idIdx >= 0 ? args[idIdx + 1] : undefined,
    statusId: statusIdx >= 0 ? args[statusIdx + 1] : undefined,
    publicUrl: urlIdx >= 0 ? args[urlIdx + 1] : undefined,
  }
}

function fmtBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return "(?)"
  const mb = n / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`
}

function fmtDuration(s: number | null | undefined): string {
  if (!s && s !== 0) return "(?)"
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${Math.round(s)}s`
}

async function pickVideo(idArg: string | undefined): Promise<VideoUpload> {
  if (idArg) {
    const v = await getVideoUploadById(idArg)
    if (!v) throw new Error(`No video_upload with id ${idArg}`)
    return v
  }
  const videos = await listVideoUploads({ limit: 1 })
  if (videos.length === 0) throw new Error("No videos in video_uploads.")
  return videos[0]
}

async function refreshAccessToken(creds: TikTokCredentials): Promise<string> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: creds.client_key,
      client_secret: creds.client_secret,
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
    }).toString(),
  })
  if (!resp.ok) {
    throw new Error(`TikTok token refresh failed (${resp.status}): ${await resp.text()}`)
  }
  const data = (await resp.json()) as { access_token?: string }
  if (!data.access_token) throw new Error("Token refresh response missing access_token")
  return data.access_token
}

interface InboxInitResult {
  publish_id: string
  ingestion?: { upload_url?: string }
}

async function inboxInit(args: {
  bearer: string
  videoUrl: string
}): Promise<InboxInitResult> {
  const body = JSON.stringify({
    source_info: {
      source: "PULL_FROM_URL",
      video_url: args.videoUrl,
    },
  })

  const resp = await fetch(INBOX_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.bearer}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body,
  })
  const text = await resp.text()
  let parsed: {
    data?: { publish_id?: string; ingestion?: { upload_url?: string } }
    error?: { code?: string; message?: string; log_id?: string }
  } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* keep parsed empty, fall through */
  }

  if (!resp.ok || (parsed.error?.code && parsed.error.code !== "ok")) {
    const code = parsed.error?.code ?? `http_${resp.status}`
    const msg = parsed.error?.message ?? text.slice(0, 300)
    throw new TikTokApiError(code, msg, parsed.error?.log_id)
  }

  if (!parsed.data?.publish_id) {
    throw new Error(`Inbox init returned no publish_id. Body: ${text.slice(0, 300)}`)
  }
  return {
    publish_id: parsed.data.publish_id,
    ingestion: parsed.data.ingestion,
  }
}

class TikTokApiError extends Error {
  code: string
  log_id?: string
  constructor(code: string, message: string, log_id?: string) {
    super(message)
    this.code = code
    this.log_id = log_id
  }
}

async function fetchStatus(args: { bearer: string; publishId: string }) {
  const resp = await fetch(STATUS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.bearer}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: args.publishId }),
  })
  const text = await resp.text()
  console.log("  http  :", resp.status)
  console.log("  body  :", text.slice(0, 600))
}

async function main() {
  const args = parseArgs()

  if (args.statusId) {
    const conn = await getPlatformConnection("tiktok")
    if (!conn || conn.status !== "connected") throw new Error("TikTok not connected")
    const creds = conn.credentials as unknown as TikTokCredentials
    const bearer = await refreshAccessToken(creds)
    console.log(`Fetching status for publish_id ${args.statusId}…`)
    await fetchStatus({ bearer, publishId: args.statusId })
    return
  }

  if (args.list) {
    const videos = await listVideoUploads({ limit: 50 })
    if (videos.length === 0) {
      console.log("No videos in video_uploads.")
      return
    }
    console.log(`Found ${videos.length} video(s) in video_uploads:\n`)
    for (const v of videos) {
      console.log(`  id           : ${v.id}`)
      console.log(`  filename     : ${v.original_filename}`)
      console.log(`  status       : ${v.status}`)
      console.log(`  mime         : ${v.mime_type ?? "(?)"}`)
      console.log(`  size         : ${fmtBytes(v.size_bytes)}`)
      console.log(`  duration     : ${fmtDuration(v.duration_seconds)}`)
      console.log(`  storage_path : ${v.storage_path}`)
      console.log()
    }
    return
  }

  let signedUrl: string
  if (args.publicUrl) {
    console.log("Using --public-url:")
    console.log(`  url: ${args.publicUrl}`)
    if (!args.upload) {
      console.log("\n(dry run — re-run with --upload to send to TikTok inbox)")
      return
    }
    signedUrl = args.publicUrl
  } else {
    const video = await pickVideo(args.id)
    console.log("Selected video:")
    console.log(`  id           : ${video.id}`)
    console.log(`  filename     : ${video.original_filename}`)
    console.log(`  size         : ${fmtBytes(video.size_bytes)}`)
    console.log(`  duration     : ${fmtDuration(video.duration_seconds)}`)
    console.log(`  storage_path : ${video.storage_path}`)

    if (!args.upload) {
      console.log("\n(dry run — re-run with --upload to send to TikTok inbox)")
      return
    }

    console.log("\nGenerating signed Firebase URL (1h TTL)…")
    signedUrl = await getSignedVideoUrl(video.storage_path, SIGNED_URL_TTL_MS)
  }

  const conn = await getPlatformConnection("tiktok")
  if (!conn || conn.status !== "connected") throw new Error("TikTok not connected")
  const creds = conn.credentials as unknown as TikTokCredentials

  console.log("Refreshing TikTok access token…")
  const bearer = await refreshAccessToken(creds)

  console.log("POST /v2/post/publish/inbox/video/init/ (PULL_FROM_URL)…")
  let result: InboxInitResult
  try {
    result = await inboxInit({ bearer, videoUrl: signedUrl })
  } catch (e) {
    if (e instanceof TikTokApiError) {
      console.error(`\n❌ TikTok rejected the inbox request.`)
      console.error(`   code   : ${e.code}`)
      console.error(`   message: ${e.message}`)
      if (e.log_id) console.error(`   log_id : ${e.log_id}`)
      if (e.code === "scope_not_authorized" || e.code === "access_token_invalid") {
        console.error(`\nThe connected token is missing the \`video.upload\` scope.`)
        console.error(`Inbox/Draft uploads require \`video.upload\` (the production plugin uses`)
        console.error(`\`video.publish\` for Direct Post). Fix:`)
        console.error(`  1. Update the OAuth handshake to request both \`video.publish\` and \`video.upload\`.`)
        console.error(`  2. Reconnect TikTok via the platform-connections UI.`)
        console.error(`\nAs a workaround, the existing plugin can already produce a private-equivalent`)
        console.error(`post via Direct Post (privacy_level=SELF_ONLY) — visible only to you on your`)
        console.error(`TikTok profile. Run scripts/test-publish-fb.ts-style flow against the TikTok plugin if you want that.`)
      }
    }
    throw e
  }

  console.log(`\n✅ Sent to TikTok inbox. publish_id: ${result.publish_id}`)
  console.log(
    "\nOpen your TikTok app — within ~30s a notification should appear:",
  )
  console.log("   📩 \"You have a video draft ready to publish\"")
  console.log("\nFrom there you can:")
  console.log("   • tap the notification → review the video")
  console.log("   • add caption / effects / cover from inside TikTok")
  console.log("   • choose Post or Discard")
  console.log("\nNothing publishes unless you tap Post in the TikTok app.")
  console.log(`\nPoll ingest status: npx tsx scripts/test-draft-tiktok.ts --status ${result.publish_id}`)
}

main().catch((e) => {
  if (!(e instanceof TikTokApiError)) {
    console.error("FAILED:", e instanceof Error ? e.message : e)
  }
  process.exit(1)
})
