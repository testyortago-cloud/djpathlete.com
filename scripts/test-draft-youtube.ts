// Uploads a video from video_uploads (Firebase Storage) to YouTube as
// privacyStatus="private" — a real draft only visible in YouTube Studio.
// Bypasses the plugin (which hardcodes "public" at
// lib/social/plugins/youtube.ts:51) and calls the Data API v3 videos.insert
// endpoint directly.
//
// Usage:
//   npx tsx scripts/test-draft-youtube.ts --list
//   npx tsx scripts/test-draft-youtube.ts                          # show pick, no upload
//   npx tsx scripts/test-draft-youtube.ts --upload                 # upload most recent
//   npx tsx scripts/test-draft-youtube.ts --upload --id <uuid>     # specific video_upload
//   npx tsx scripts/test-draft-youtube.ts --upload --shorts        # mark as Shorts
//   npx tsx scripts/test-draft-youtube.ts --delete <youtube_id>    # delete a YT video
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"
import { listVideoUploads, getVideoUploadById } from "@/lib/db/video-uploads"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import type { YouTubeCredentials } from "@/lib/social/plugins/youtube"
import type { VideoUpload } from "@/types/database"

const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status"
const TOKEN_URL = "https://oauth2.googleapis.com/token"

function parseArgs() {
  const args = process.argv.slice(2)
  const deleteIdx = args.indexOf("--delete")
  return {
    list: args.includes("--list"),
    upload: args.includes("--upload"),
    shorts: args.includes("--shorts"),
    id: (() => {
      const i = args.indexOf("--id")
      return i >= 0 ? args[i + 1] : undefined
    })(),
    deleteId: deleteIdx >= 0 ? args[deleteIdx + 1] : undefined,
  }
}

async function deleteYouTubeVideo(creds: YouTubeCredentials, videoId: string) {
  const bearer = await refreshAccessToken(creds)
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${bearer}` } },
  )
  if (resp.status !== 204) {
    throw new Error(`Delete failed (${resp.status}): ${await resp.text()}`)
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

async function refreshAccessToken(creds: YouTubeCredentials): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`)
  }
  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) throw new Error("Token refresh response missing access_token")
  return data.access_token
}

async function uploadAsPrivateDraft(args: {
  videoBytes: ArrayBuffer
  title: string
  description: string
  tags: string[]
  bearer: string
}): Promise<{ id: string }> {
  const metadata = JSON.stringify({
    snippet: { title: args.title, description: args.description, tags: args.tags },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  })

  const boundary = "djp_yt_draft_" + Math.random().toString(36).slice(2)
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
  )
  const tail = enc.encode(`\r\n--${boundary}--`)
  const body = new Uint8Array(head.byteLength + args.videoBytes.byteLength + tail.byteLength)
  body.set(head, 0)
  body.set(new Uint8Array(args.videoBytes), head.byteLength)
  body.set(tail, head.byteLength + args.videoBytes.byteLength)

  const resp = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.bearer}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!resp.ok) {
    throw new Error(`YouTube upload failed (${resp.status}): ${await resp.text()}`)
  }
  const data = (await resp.json()) as { id?: string }
  if (!data.id) throw new Error("YouTube response missing video id")
  return { id: data.id }
}

async function main() {
  const args = parseArgs()

  if (args.deleteId) {
    const conn = await getPlatformConnection("youtube")
    if (!conn || conn.status !== "connected") throw new Error("YouTube not connected")
    const creds = conn.credentials as unknown as YouTubeCredentials
    console.log(`Deleting YouTube video ${args.deleteId}…`)
    await deleteYouTubeVideo(creds, args.deleteId)
    console.log("✅ Deleted.")
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
      console.log(`  created      : ${v.created_at}`)
      console.log()
    }
    return
  }

  const video = await pickVideo(args.id)

  console.log("Selected video:")
  console.log(`  id           : ${video.id}`)
  console.log(`  filename     : ${video.original_filename}`)
  console.log(`  status       : ${video.status}`)
  console.log(`  mime         : ${video.mime_type ?? "(?)"}`)
  console.log(`  size         : ${fmtBytes(video.size_bytes)}`)
  console.log(`  duration     : ${fmtDuration(video.duration_seconds)}`)
  console.log(`  storage_path : ${video.storage_path}`)

  if (!args.upload) {
    console.log("\n(dry run — re-run with --upload to actually upload)")
    return
  }

  const conn = await getPlatformConnection("youtube")
  if (!conn || conn.status !== "connected") {
    throw new Error("YouTube not connected")
  }
  const creds = conn.credentials as unknown as YouTubeCredentials

  console.log("\nGenerating signed Firebase URL…")
  const signedUrl = await getSignedVideoUrl(video.storage_path, 60 * 60 * 1000)

  console.log("Downloading video bytes from signed URL…")
  const fileResp = await fetch(signedUrl)
  if (!fileResp.ok) {
    throw new Error(`Could not download from Firebase (${fileResp.status})`)
  }
  const videoBytes = await fileResp.arrayBuffer()
  console.log(`  downloaded   : ${fmtBytes(videoBytes.byteLength)}`)

  const ts = new Date().toISOString()
  const baseTitle = `DJP Athlete — draft test ${ts}`.slice(0, 100)
  const title = args.shorts ? `${baseTitle} (Shorts)`.slice(0, 100) : baseTitle
  const description = [
    "DJP Athlete — YouTube draft upload test.",
    `Source video_upload: ${video.id}`,
    `File: ${video.original_filename}`,
    `Created: ${ts}`,
    "",
    "Privacy: private. Only the channel owner can view this in YouTube Studio.",
    args.shorts ? "#Shorts" : "",
  ]
    .filter(Boolean)
    .join("\n")
  const tags = args.shorts ? ["djp-test", "Shorts"] : ["djp-test"]

  console.log("\nRefreshing YouTube access token…")
  const bearer = await refreshAccessToken(creds)

  console.log("Uploading to YouTube as privacyStatus=private…")
  const result = await uploadAsPrivateDraft({
    videoBytes,
    title,
    description,
    tags,
    bearer,
  })

  console.log(`\n✅ Uploaded. video_id: ${result.id}`)
  console.log(`   YouTube Studio: https://studio.youtube.com/video/${result.id}/edit`)
  console.log(`   Direct (private — only you can see): https://youtu.be/${result.id}`)
  console.log("\nThis video is PRIVATE — only your channel sees it. To delete:")
  console.log(`   YouTube Studio → Content → find the video → ⋮ → Delete forever`)
  console.log(`   (Or via Data API: DELETE https://www.googleapis.com/youtube/v3/videos?id=${result.id})`)
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
