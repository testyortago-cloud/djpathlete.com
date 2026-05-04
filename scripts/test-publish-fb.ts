// Real publish test — pushes a text-only post to the connected Facebook Page
// via the actual FacebookPlugin (same code path Content Studio uses).
//
// Run: npx tsx scripts/test-publish-fb.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"
import { createFacebookPlugin, type FacebookCredentials } from "@/lib/social/plugins/facebook"

async function main() {
  const conn = await getPlatformConnection("facebook")
  if (!conn || conn.status !== "connected") {
    throw new Error("Facebook not connected")
  }
  const creds = conn.credentials as unknown as FacebookCredentials
  const plugin = createFacebookPlugin(creds)

  const caption =
    "DJP Athlete — publishing test (" +
    new Date().toISOString() +
    "). This is a real post. Will be deleted shortly."

  console.log("Publishing to Page", creds.page_id, "...")
  const result = await plugin.publish({
    content: caption,
    mediaUrl: null,
    postType: "text",
    scheduledAt: null,
  })

  if (!result.success) {
    console.error("FAILED:", result.error)
    process.exit(1)
  }

  console.log("\n✅ Published. platform_post_id:", result.platform_post_id)

  // Fetch the permalink so the user can open it.
  const permalinkResp = await fetch(
    `https://graph.facebook.com/v22.0/${result.platform_post_id}?fields=permalink_url,message,created_time&access_token=${creds.access_token}`,
  )
  const meta = (await permalinkResp.json().catch(() => ({}))) as {
    permalink_url?: string
    message?: string
    created_time?: string
  }
  console.log("\nPost details:")
  console.log("  url     :", meta.permalink_url ?? "(not returned)")
  console.log("  created :", meta.created_time ?? "(unknown)")
  console.log(
    "\nTo delete after verifying, run:\n  npx tsx scripts/test-publish-fb.ts --delete " +
      result.platform_post_id,
  )
}

async function del() {
  const id = process.argv[3]
  if (!id) throw new Error("usage: --delete <platform_post_id>")
  const conn = await getPlatformConnection("facebook")
  if (!conn) throw new Error("Facebook not connected")
  const creds = conn.credentials as { access_token: string }
  const resp = await fetch(
    `https://graph.facebook.com/v22.0/${id}?access_token=${creds.access_token}`,
    { method: "DELETE" },
  )
  console.log("delete status:", resp.status, "body:", await resp.text())
}

const action = process.argv[2] === "--delete" ? del : main
action().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
