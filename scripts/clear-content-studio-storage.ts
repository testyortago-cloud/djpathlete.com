// One-off purge: delete every object under videos/ and images/ in the
// default Firebase Storage bucket. Pair with the social_*/video_*/media_assets
// TRUNCATE done via the Supabase MCP. Topic suggestions are NOT touched —
// they live in content_calendar with no storage.
// Run with: npx tsx scripts/clear-content-studio-storage.ts
import { config } from "dotenv"
config({ path: ".env.local" })
import { getAdminStorage } from "@/lib/firebase-admin"

const PREFIXES = ["videos/", "images/"]

async function purgePrefix(prefix: string): Promise<number> {
  const bucket = getAdminStorage().bucket()
  console.log(`\n[${prefix}] Listing gs://${bucket.name}/${prefix}*`)
  const [files] = await bucket.getFiles({ prefix })
  console.log(`[${prefix}] Found ${files.length} object(s)`)
  if (files.length === 0) {
    console.log(`[${prefix}] (nothing to delete)`)
    return 0
  }
  for (const f of files) console.log(`        - ${f.name}`)
  await bucket.deleteFiles({ prefix, force: true })
  console.log(`[${prefix}] ✓ Deleted ${files.length} object(s)`)
  return files.length
}

async function main() {
  let total = 0
  for (const prefix of PREFIXES) {
    total += await purgePrefix(prefix)
  }
  console.log(`\nTotal deleted: ${total}`)
}

main().catch((e) => {
  console.error("PURGE FAILED:", e)
  process.exit(1)
})
