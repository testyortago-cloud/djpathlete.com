import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"
import { platformBusinessId } from "@/lib/tenancy/platform"

export async function POST(_req: NextRequest) {
  const auth = (await headers()).get("authorization") ?? ""
  if (auth.replace(/^Bearer\s+/i, "") !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = createServiceRoleClient()
  const [pausedRes, enabledRes] = await Promise.all([
    sb.from("system_settings").select("value").eq("key", "automation_paused").maybeSingle(),
    sb.from("system_settings").select("value").eq("key", "cron_social_agent_enabled").maybeSingle(),
  ])
  if (pausedRes.data?.value === true) return NextResponse.json({ skipped: "automation_paused" })
  if (enabledRes.data?.value !== true) return NextResponse.json({ skipped: "cron_social_agent_enabled=false" })
  const { jobId } = await createAiJob({
    type: "social_agent_run",
    userId: "system",
    // businessId (G35): whose owners get the "no eligible topic" alert. The
    // platform's, by construction: a cron has no session to resolve from, and
    // nothing the social agent reads or writes (blog_posts, strategy_briefs,
    // social_posts, social_agent_memos) has a business_id. lib/tenancy/platform.ts
    // lists this route under CORRECT BY CONSTRUCTION.
    input: { platform: "linkedin", businessId: platformBusinessId() },
  })
  return NextResponse.json({ jobId, status: "pending" })
}
