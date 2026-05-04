// Schedules a real text post to the connected Facebook Page ~15 minutes in the
// future. Goes through the same FacebookPlugin code path Content Studio uses.
// Facebook requires scheduled_publish_time to be 10 min – 75 days out.
//
// Run:    npx tsx scripts/test-schedule-fb.ts
// Delete: npx tsx scripts/test-schedule-fb.ts --delete <platform_post_id>
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"
import { createFacebookPlugin, type FacebookCredentials } from "@/lib/social/plugins/facebook"

const SCHEDULE_OFFSET_MINUTES = 15

async function main() {
  const conn = await getPlatformConnection("facebook")
  if (!conn || conn.status !== "connected") {
    throw new Error("Facebook not connected")
  }
  const creds = conn.credentials as unknown as FacebookCredentials
  const plugin = createFacebookPlugin(creds)

  const scheduledDate = new Date(Date.now() + SCHEDULE_OFFSET_MINUTES * 60 * 1000)
  const scheduledAtIso = scheduledDate.toISOString()

  const caption =
    "DJP Athlete — scheduled post test (" +
    new Date().toISOString() +
    "). Auto-publishes at " +
    scheduledAtIso +
    " unless deleted first."

  console.log("Scheduling post to Page", creds.page_id)
  console.log("  scheduled (UTC) :", scheduledAtIso)
  console.log("  scheduled (local):", scheduledDate.toString())
  console.log("  offset           :", SCHEDULE_OFFSET_MINUTES, "minutes from now\n")

  const result = await plugin.publish({
    content: caption,
    mediaUrl: null,
    postType: "text",
    scheduledAt: scheduledAtIso,
  })

  if (!result.success) {
    console.error("FAILED:", result.error)
    process.exit(1)
  }

  console.log("✅ Scheduled. platform_post_id:", result.platform_post_id)

  // List scheduled_posts to confirm it landed in the queue.
  const listResp = await fetch(
    `https://graph.facebook.com/v22.0/${creds.page_id}/scheduled_posts?fields=id,message,scheduled_publish_time,is_published&limit=5&access_token=${creds.access_token}`,
  )
  const listJson = (await listResp.json().catch(() => ({}))) as {
    data?: Array<{
      id: string
      message?: string
      scheduled_publish_time?: number
      is_published?: boolean
    }>
  }
  console.log("\nCurrent /scheduled_posts on Page (top 5):")
  for (const row of listJson.data ?? []) {
    const when = row.scheduled_publish_time
      ? new Date(row.scheduled_publish_time * 1000).toISOString()
      : "(unknown)"
    console.log("  -", row.id, "→", when, row.is_published ? "(published)" : "(scheduled)")
  }

  console.log("\nVerify in Meta Business Suite:")
  console.log("  https://business.facebook.com/latest/posts/scheduled_posts")
  console.log("\nTo delete before it auto-publishes:")
  console.log("  npx tsx scripts/test-schedule-fb.ts --delete " + result.platform_post_id)
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
