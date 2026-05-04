// Read-only probe: shows what's stored in platform_connections for TikTok.
// Does NOT call the TikTok API or refresh any tokens.
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"

async function main() {
  const conn = await getPlatformConnection("tiktok")
  if (!conn) {
    console.log("No TikTok connection in platform_connections.")
    return
  }
  console.log("platform_connections row (read-only, no API calls):")
  console.log("  plugin_name    :", (conn as { plugin_name?: string }).plugin_name ?? "(?)")
  console.log("  status         :", conn.status)
  console.log("  account_handle :", conn.account_handle ?? "(none stored)")
  console.log("  connected_at   :", (conn as { connected_at?: string }).connected_at ?? "(?)")
  console.log("  connected_by   :", (conn as { connected_by?: string | null }).connected_by ?? "(?)")

  const creds = conn.credentials as Record<string, unknown>
  console.log("  open_id (cred) :", creds.open_id ?? "(not stored)")

  const credKeys = Object.keys(creds)
  console.log("  credential keys:", credKeys.join(", "))
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
