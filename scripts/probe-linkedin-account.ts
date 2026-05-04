// Read-only probe: shows what's stored in platform_connections for LinkedIn.
// Does NOT call LinkedIn or refresh any tokens.
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"

async function main() {
  const conn = await getPlatformConnection("linkedin")
  if (!conn) {
    console.log("No LinkedIn connection in platform_connections.")
    console.log("→ OAuth flow has not been completed yet.")
    return
  }
  console.log("platform_connections row (read-only, no API calls):")
  console.log("  plugin_name    :", (conn as { plugin_name?: string }).plugin_name ?? "(?)")
  console.log("  status         :", conn.status)
  console.log("  account_handle :", conn.account_handle ?? "(none stored)")
  console.log("  connected_at   :", (conn as { connected_at?: string }).connected_at ?? "(?)")
  console.log("  connected_by   :", (conn as { connected_by?: string | null }).connected_by ?? "(?)")

  const creds = conn.credentials as Record<string, unknown>
  console.log(
    "  organization_id:",
    typeof creds.organization_id === "string" || typeof creds.organization_id === "number"
      ? creds.organization_id
      : "(not stored)",
  )
  const credKeys = Object.keys(creds)
  console.log("  credential keys:", credKeys.join(", "))
  console.log(
    "  has access_token:",
    typeof creds.access_token === "string" && creds.access_token.length > 0,
  )
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
