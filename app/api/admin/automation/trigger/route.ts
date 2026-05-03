// app/api/admin/automation/trigger/route.ts
// Admin-session "Run now" dispatcher. Receives { jobName } from the
// /admin/automation page and dispatches to either:
//   (a) the Firebase runJob HTTPS function (for jobs whose runner lives on
//       the Functions side — sync-analytics, daily-pulse, weekly-report,
//       voice-drift, performance-loop)
//   (b) the corresponding Vercel internal route (for jobs whose runner
//       lives in Next.js — auto-blog-generation)
// Both paths use the shared INTERNAL_CRON_TOKEN bearer.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { CRON_CATALOG } from "@/lib/cron-catalog"

const JOB_NAMES = CRON_CATALOG.map((c) => c.name) as [string, ...string[]]

const BodySchema = z.object({
  jobName: z.enum(JOB_NAMES),
})

// Job names whose runner is a Vercel internal route (not a Firebase Function).
// Map: catalog job name → internal route path.
const VERCEL_ROUTE_JOBS: Record<string, string> = {
  "auto-blog-generation": "/api/admin/internal/auto-blog",
}

function getRunJobUrl(): string | null {
  const explicit = process.env.FIREBASE_RUN_JOB_URL
  if (explicit) return explicit.replace(/\/$/, "")

  const region = process.env.FIREBASE_FUNCTIONS_REGION ?? "us-central1"
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null
  if (!projectId) return null
  return `https://${region}-${projectId}.cloudfunctions.net/runJob`
}

function getAppOrigin(request: NextRequest): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null
  if (explicit) return explicit.replace(/\/$/, "")
  // Fallback: derive from the incoming request.
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
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

  const jobName = parsed.data.jobName

  // Vercel-route jobs: POST to the internal route on this same deployment.
  const vercelPath = VERCEL_ROUTE_JOBS[jobName]
  if (vercelPath) {
    const url = `${getAppOrigin(request)}${vercelPath}`
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: "{}",
      })
      const body = await upstream.json().catch(() => ({ error: "Invalid upstream response" }))
      return NextResponse.json({ result: body }, { status: upstream.status })
    } catch (err) {
      console.error(`[automation/trigger] ${jobName} upstream call failed:`, err)
      return NextResponse.json(
        { error: `Failed to reach ${vercelPath}: ${(err as Error).message ?? "unknown"}` },
        { status: 502 },
      )
    }
  }

  // Firebase-runner jobs: forward to runJob HTTPS function.
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
      body: JSON.stringify({ jobName }),
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
