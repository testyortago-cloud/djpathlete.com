// Creates an UNPUBLISHED Instagram media container — IG's closest analogue to
// a "draft." The container holds a creation_id that COULD be passed to
// /media_publish later, but we deliberately stop short. Containers auto-expire
// after 24 hours, so no cleanup is needed.
//
// IMPORTANT: nothing becomes visible. Not on the IG profile, not in MBS,
// nowhere. This script only proves the upload pipeline works (auth + image URL
// + Meta processing).
//
// Run: npx tsx scripts/test-draft-ig.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"
import type { InstagramCredentials } from "@/lib/social/plugins/instagram"
import { fetchJson } from "@/lib/social/plugins/shared/fetch-helpers"

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0"
const IMAGE_URL =
  "https://images.unsplash.com/photo-1761839257789-20147513121a?q=80&w=1169&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDF8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"

const POLL_MAX_ATTEMPTS = 8
const POLL_INITIAL_DELAY_MS = 500

async function main() {
  const conn = await getPlatformConnection("instagram")
  if (!conn || conn.status !== "connected") {
    throw new Error("Instagram not connected")
  }
  const creds = conn.credentials as unknown as InstagramCredentials

  const caption =
    "DJP Athlete — IG draft container test (" +
    new Date().toISOString() +
    "). This was never published — just a media container Meta will auto-expire in 24h."

  console.log("Creating IG media container for ig_user_id", creds.ig_user_id)
  console.log("  image_url:", IMAGE_URL.slice(0, 80) + "…")

  const create = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${creds.ig_user_id}/media`,
    {
      method: "POST",
      body: {
        image_url: IMAGE_URL,
        caption,
        access_token: creds.access_token,
      },
    },
  )

  if (!create.ok || !create.data?.id) {
    console.error("FAILED to create container.")
    console.error("  status:", create.status)
    console.error("  error :", create.errorText)
    process.exit(1)
  }

  const containerId = create.data.id
  console.log("\n✅ Container created. id:", containerId)

  let finalStatus: string | undefined
  let delay = POLL_INITIAL_DELAY_MS

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const status = await fetchJson<{ status_code?: string; status?: string }>(
      `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(creds.access_token)}`,
    )
    const code = status.data?.status_code
    const detail = status.data?.status ?? ""
    console.log(
      `  poll ${attempt + 1}/${POLL_MAX_ATTEMPTS}: ${code ?? "(no code)"}${detail ? " — " + detail : ""}`,
    )
    finalStatus = code

    if (code === "FINISHED" || code === "ERROR" || code === "EXPIRED") break
    if (attempt < POLL_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
    }
  }

  console.log("\nResult:")
  console.log("  container_id  :", containerId)
  console.log("  final status  :", finalStatus ?? "(unknown)")
  console.log("  publish state : NEVER PUBLISHED — auto-expires in ~24h")
  console.log(
    "\nThis container is invisible to humans — not on the IG profile, not in MBS.",
  )
  console.log("Nothing to clean up.")
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
