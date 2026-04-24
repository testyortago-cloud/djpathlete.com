// One-off smoke test: verify that each platform_connections row actually works
// by calling the plugin's connect() against the live provider API.
// Run with: npx tsx scripts/smoke-social-connections.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { listPlatformConnections } from "@/lib/db/platform-connections"
import { createFacebookPlugin, type FacebookCredentials } from "@/lib/social/plugins/facebook"
import { createInstagramPlugin, type InstagramCredentials } from "@/lib/social/plugins/instagram"
import { createYouTubePlugin, type YouTubeCredentials } from "@/lib/social/plugins/youtube"
import { createYouTubeShortsPlugin } from "@/lib/social/plugins/youtube-shorts"
import { createTikTokPlugin, type TikTokCredentials } from "@/lib/social/plugins/tiktok"
import { createLinkedInPlugin, type LinkedInCredentials } from "@/lib/social/plugins/linkedin"
import type { PlatformConnection, SocialPlatform } from "@/types/database"
import type { PublishPlugin } from "@/lib/social/plugins/types"

const TARGET_PLATFORMS: SocialPlatform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "youtube_shorts",
]

function pad(s: string, n: number) {
  return (s + " ".repeat(n)).slice(0, n)
}

function hasKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => typeof obj[k] === "string" && (obj[k] as string).length > 0)
}

function instantiate(conn: PlatformConnection): PublishPlugin | { error: string } {
  const creds = (conn.credentials ?? {}) as Record<string, unknown>
  switch (conn.plugin_name) {
    case "facebook":
      if (!hasKeys(creds, ["access_token", "page_id"])) {
        return { error: "missing access_token or page_id in stored credentials" }
      }
      return createFacebookPlugin(creds as unknown as FacebookCredentials)
    case "instagram":
      if (!hasKeys(creds, ["access_token", "ig_user_id"])) {
        return { error: "missing access_token or ig_user_id in stored credentials" }
      }
      return createInstagramPlugin(creds as unknown as InstagramCredentials)
    case "youtube":
      if (!hasKeys(creds, ["access_token", "refresh_token", "client_id", "client_secret"])) {
        return { error: "missing one of access_token/refresh_token/client_id/client_secret" }
      }
      return createYouTubePlugin(creds as unknown as YouTubeCredentials)
    case "youtube_shorts":
      if (!hasKeys(creds, ["access_token", "refresh_token", "client_id", "client_secret"])) {
        return { error: "missing one of access_token/refresh_token/client_id/client_secret" }
      }
      return createYouTubeShortsPlugin(creds as unknown as YouTubeCredentials)
    case "tiktok":
      if (!hasKeys(creds, ["access_token", "refresh_token", "client_key", "client_secret"])) {
        return { error: "missing one of access_token/refresh_token/client_key/client_secret" }
      }
      return createTikTokPlugin(creds as unknown as TikTokCredentials)
    case "linkedin":
      if (!hasKeys(creds, ["access_token", "organization_id"])) {
        return { error: "missing access_token or organization_id" }
      }
      return createLinkedInPlugin(creds as unknown as LinkedInCredentials)
    default:
      return { error: `unknown plugin_name: ${conn.plugin_name}` }
  }
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — check .env.local")
  }

  console.log("Fetching platform_connections rows (decrypted via fn_list_platform_connections)...\n")
  const rows = await listPlatformConnections()
  const byPlatform = new Map<SocialPlatform, PlatformConnection>()
  for (const r of rows) byPlatform.set(r.plugin_name, r)

  console.log("=".repeat(84))
  console.log(
    pad("PLATFORM", 16) +
      pad("DB STATUS", 14) +
      pad("HANDLE", 24) +
      pad("LIVE PING", 14) +
      "DETAIL",
  )
  console.log("=".repeat(84))

  let passed = 0
  let failed = 0
  let skipped = 0

  for (const platform of TARGET_PLATFORMS) {
    const conn = byPlatform.get(platform)
    if (!conn) {
      console.log(pad(platform, 16) + pad("— no row —", 14) + pad("-", 24) + pad("SKIP", 14) + "not in DB")
      skipped++
      continue
    }

    const dbStatus = conn.status
    const handle = conn.account_handle ?? "-"

    if (dbStatus !== "connected") {
      console.log(
        pad(platform, 16) +
          pad(dbStatus, 14) +
          pad(handle, 24) +
          pad("SKIP", 14) +
          (conn.last_error ?? "not connected in DB"),
      )
      skipped++
      continue
    }

    const plugin = instantiate(conn)
    if ("error" in plugin) {
      console.log(
        pad(platform, 16) + pad(dbStatus, 14) + pad(handle, 24) + pad("FAIL", 14) + plugin.error,
      )
      failed++
      continue
    }

    try {
      const result = await plugin.connect(conn.credentials as Record<string, unknown>)
      if (result.status === "connected") {
        console.log(
          pad(platform, 16) +
            pad(dbStatus, 14) +
            pad(handle, 24) +
            pad("OK", 14) +
            (result.account_handle ? `live handle: ${result.account_handle}` : "token valid"),
        )
        passed++
      } else {
        console.log(
          pad(platform, 16) +
            pad(dbStatus, 14) +
            pad(handle, 24) +
            pad("FAIL", 14) +
            (result.error ?? "unknown error"),
        )
        failed++
      }
    } catch (err) {
      console.log(
        pad(platform, 16) +
          pad(dbStatus, 14) +
          pad(handle, 24) +
          pad("THROW", 14) +
          (err as Error).message,
      )
      failed++
    }
  }

  console.log("=".repeat(84))
  console.log(`\nSummary: ${passed} OK, ${failed} failed, ${skipped} skipped`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e)
  process.exit(1)
})
