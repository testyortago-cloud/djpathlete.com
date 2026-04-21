// app/api/admin/automation/trigger/route.ts
// Admin-session "Run now" dispatcher. Receives { jobName } from the
// /admin/automation page and forwards to the Firebase runJob HTTPS function
// with the shared Bearer INTERNAL_CRON_TOKEN. Returns the runner's result.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"

const JOB_NAMES = [
  "sync-platform-analytics",
  "send-weekly-content-report",
  "send-daily-pulse",
  "voice-drift-monitor",
  "performance-learning-loop",
] as const

const BodySchema = z.object({
  jobName: z.enum(JOB_NAMES),
})

function getRunJobUrl(): string | null {
  const explicit = process.env.FIREBASE_RUN_JOB_URL
  if (explicit) return explicit.replace(/\/$/, "")

  const region = process.env.FIREBASE_FUNCTIONS_REGION ?? "us-central1"
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null
  if (!projectId) return null
  return `https://${region}-${projectId}.cloudfunctions.net/runJob`
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid jobName" }, { status: 400 })
  }

  const token = process.env.INTERNAL_CRON_TOKEN
  if (!token) {
    return NextResponse.json({ error: "INTERNAL_CRON_TOKEN is not configured on this deployment." }, { status: 500 })
  }

  const url = getRunJobUrl()
  if (!url) {
    return NextResponse.json({ error: "Firebase project id not configured (FIREBASE_PROJECT_ID)." }, { status: 500 })
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jobName: parsed.data.jobName }),
    })

    const body = await upstream.json().catch(() => ({ error: "Invalid upstream response" }))
    return NextResponse.json(body, { status: upstream.status })
  } catch (err) {
    console.error("[automation/trigger] upstream call failed:", err)
    return NextResponse.json(
      { error: `Failed to reach runJob: ${(err as Error).message ?? "unknown"}` },
      { status: 502 },
    )
  }
}
