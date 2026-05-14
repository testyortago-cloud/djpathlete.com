import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const auth = (await headers()).get("authorization") ?? ""
  if (auth.replace(/^Bearer\s+/i, "") !== process.env.INTERNAL_CRON_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = createServiceRoleClient()
  const [pausedRes, enabledRes] = await Promise.all([
    sb.from("system_settings").select("value").eq("key", "automation_paused").maybeSingle(),
    sb.from("system_settings").select("value").eq("key", "cron_performance_critic_enabled").maybeSingle(),
  ])
  if (pausedRes.data?.value === true) return NextResponse.json({ skipped: "automation_paused" })
  if (enabledRes.data?.value !== true) return NextResponse.json({ skipped: "cron_performance_critic_enabled=false" })
  const { jobId } = await createAiJob({ type: "performance_critic_run", userId: "system", input: {} })
  return NextResponse.json({ jobId, status: "pending" })
}
