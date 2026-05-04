// Cleanup the two in-app test drafts created earlier in social_posts.
// Run: npx tsx scripts/cleanup-inapp-drafts.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { deleteSocialPost, getSocialPostById } from "@/lib/db/social-posts"

const IDS = [
  "17e4d06f-34ab-47c6-8c87-265348a4e19e", // facebook
  "1d103e28-af9c-496c-a913-0ef2727858b1", // instagram
]

async function main() {
  for (const id of IDS) {
    const before = await getSocialPostById(id)
    if (!before) {
      console.log(id, "— not found (already gone)")
      continue
    }
    await deleteSocialPost(id)
    console.log(id, `— deleted (${before.platform}, status=${before.approval_status})`)
  }
  console.log("\nDONE.")
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
