// Cleanup-only: delete the orphan FB unpublished post created earlier.
// (Originally also created a scheduled-as-draft, but that requires explicit
// user authorization since it auto-publishes — left out here.)
//
// Run: npx tsx scripts/cleanup-and-schedule-fb.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"

const ORPHAN_POST_ID = "102439129265158_937601662422386"

async function main() {
  const conn = await getPlatformConnection("facebook")
  if (!conn) throw new Error("Facebook not connected")
  const creds = conn.credentials as { access_token: string; page_id: string }

  console.log("Deleting orphan unpublished post", ORPHAN_POST_ID, "...")
  const del = await fetch(
    `https://graph.facebook.com/v22.0/${ORPHAN_POST_ID}?access_token=${creds.access_token}`,
    { method: "DELETE" },
  )
  const body = await del.text()
  console.log("  status:", del.status)
  console.log("  body  :", body)
  if (!del.ok) {
    throw new Error(`Delete failed: ${body}`)
  }
  console.log("\nDONE — orphan removed.")
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
