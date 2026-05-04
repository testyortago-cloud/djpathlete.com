// One-off: create test drafts.
//
// (a) In-app drafts in the Content Studio (`social_posts` rows with
//     approval_status='draft') for both Facebook and Instagram. These never
//     leave your server.
//
// (b) A real Facebook Page draft via Graph API `published: false` on /feed.
//     This appears in Meta Business Suite → Content → Drafts on the Page.
//     Instagram does NOT have a corresponding native-draft API, so step (b)
//     is Facebook-only.
//
// Run: npx tsx scripts/test-create-drafts.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { createServiceRoleClient } from "@/lib/supabase"
import { createSocialPost } from "@/lib/db/social-posts"
import { getPlatformConnection } from "@/lib/db/platform-connections"

const TEST_CAPTION =
  "DJP Athlete — test draft created by tooling. Safe to delete. (" +
  new Date().toISOString() +
  ")"

async function findAdminUserId(): Promise<string> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error("No admin user found in users table")
  return data.id as string
}

async function createInAppDraft(
  platform: "facebook" | "instagram",
  adminId: string,
): Promise<string> {
  const post = await createSocialPost({
    platform,
    content: TEST_CAPTION,
    media_url: null,
    post_type: "text",
    approval_status: "draft",
    scheduled_at: null,
    source_video_id: null,
    created_by: adminId,
  })
  return post.id
}

async function createFacebookPageDraft(): Promise<string> {
  const conn = await getPlatformConnection("facebook")
  if (!conn || conn.status !== "connected") {
    throw new Error("Facebook is not connected (run smoke-social-connections first)")
  }
  const creds = conn.credentials as { access_token?: string; page_id?: string }
  if (!creds.access_token || !creds.page_id) {
    throw new Error("Facebook credentials missing access_token or page_id")
  }

  const url = `https://graph.facebook.com/v22.0/${creds.page_id}/feed`
  const params = new URLSearchParams({
    message: TEST_CAPTION,
    published: "false",
    access_token: creds.access_token,
  })

  const resp = await fetch(url, { method: "POST", body: params })
  const json = (await resp.json().catch(() => ({}))) as {
    id?: string
    error?: { message?: string; code?: number }
  }
  if (!resp.ok || !json.id) {
    throw new Error(
      `Facebook draft failed (${resp.status}): ${json.error?.message ?? JSON.stringify(json)}`,
    )
  }
  return json.id
}

async function main() {
  console.log("Step 1 — find an admin user for created_by ...")
  const adminId = await findAdminUserId()
  console.log("  admin id:", adminId, "\n")

  console.log("Step 2 — (a) create in-app Content Studio drafts ...")
  const fbDraftId = await createInAppDraft("facebook", adminId)
  console.log("  Facebook in-app draft (social_posts.id):", fbDraftId)
  const igDraftId = await createInAppDraft("instagram", adminId)
  console.log("  Instagram in-app draft (social_posts.id):", igDraftId, "\n")

  console.log("Step 3 — (b) create native Facebook Page draft via Graph API ...")
  const fbPagePostId = await createFacebookPageDraft()
  console.log("  Facebook Page unpublished post id:", fbPagePostId)
  console.log(
    "  → View it in Meta Business Suite → Content → Drafts (or Page Composer).\n",
  )

  console.log("Step 4 — Instagram native draft ...")
  console.log("  SKIPPED — IG Graph API has no native-draft endpoint.")
  console.log("  In-app draft from step 2 is the only option for IG.\n")

  console.log("DONE.")
  console.log("  In-app drafts: visit /admin/content-studio (filter: Drafts)")
  console.log(
    "  FB Page draft: open Meta Business Suite for DJP Athlete → Content → Drafts",
  )
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
