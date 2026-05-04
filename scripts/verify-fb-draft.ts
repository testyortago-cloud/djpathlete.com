// Verify the FB unpublished post created earlier still exists, and list all
// unpublished posts on the Page so we can see where they actually surface.
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"

const POST_ID = process.argv[2] ?? "102439129265158_937601662422386"

async function main() {
  const conn = await getPlatformConnection("facebook")
  if (!conn) throw new Error("Facebook not connected")
  const creds = conn.credentials as { access_token: string; page_id: string }

  console.log("1) Direct fetch of the post by id:")
  const direct = await fetch(
    `https://graph.facebook.com/v22.0/${POST_ID}?fields=id,message,is_published,created_time,permalink_url&access_token=${creds.access_token}`,
  )
  console.log("   status:", direct.status)
  console.log("   body  :", await direct.text(), "\n")

  console.log("2) List unpublished promotable_posts on the Page:")
  const list = await fetch(
    `https://graph.facebook.com/v22.0/${creds.page_id}/promotable_posts?is_published=false&fields=id,message,is_published,created_time&limit=10&access_token=${creds.access_token}`,
  )
  console.log("   status:", list.status)
  console.log("   body  :", await list.text())
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
