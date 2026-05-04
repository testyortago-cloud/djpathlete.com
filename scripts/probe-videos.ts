// Quick probe: list video_uploads and check what's actually in the DB.
import { config } from "dotenv"
config({ path: ".env.local" })

import { listVideoUploads } from "@/lib/db/video-uploads"
import { listMediaAssets } from "@/lib/db/media-assets"

async function main() {
  const videos = await listVideoUploads({ limit: 50 })
  console.log(`video_uploads: ${videos.length} row(s)`)
  for (const v of videos) {
    console.log(
      `  ${v.id}  status=${v.status}  ${v.original_filename}  ${v.size_bytes ?? "?"}B  ${v.duration_seconds ?? "?"}s  storage=${v.storage_path}`,
    )
  }

  console.log()
  const allAssets = await listMediaAssets()
  console.log(`media_assets (all kinds): ${allAssets.length} row(s)`)
  for (const a of allAssets) {
    console.log(`  ${a.id}  kind=${a.kind}  mime=${a.mime_type}  url=${a.public_url}`)
  }
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
