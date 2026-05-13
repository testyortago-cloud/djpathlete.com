// One-off purge: delete every object under team-videos/ in the default
// Firebase Storage bucket. Pair with the team_video_* TRUNCATE done via the
// Supabase MCP. Run with: npx tsx scripts/clear-team-videos-storage.ts
import { config } from "dotenv"
config({ path: ".env.local" })
import { getAdminStorage } from "@/lib/firebase-admin"
import { TEAM_VIDEO_PATH_PREFIX } from "@/lib/storage/team-videos-config"

async function main() {
  const bucket = getAdminStorage().bucket()
  const prefix = `${TEAM_VIDEO_PATH_PREFIX}/`
  console.log(`[1/3] Listing gs://${bucket.name}/${prefix}*`)
  const [files] = await bucket.getFiles({ prefix })
  console.log(`[2/3] Found ${files.length} object(s)`)
  if (files.length === 0) {
    console.log("        (nothing to delete — already empty)")
    return
  }
  for (const f of files) console.log(`        - ${f.name}`)
  await bucket.deleteFiles({ prefix, force: true })
  console.log(`[3/3] ✓ Deleted ${files.length} object(s) under ${prefix}`)
}

main().catch((e) => {
  console.error("PURGE FAILED:", e)
  process.exit(1)
})
