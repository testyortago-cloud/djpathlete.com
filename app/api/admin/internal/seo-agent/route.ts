// POST /api/admin/internal/seo-agent
// Hit weekly (Sun 14:00 UTC) by the seoAgentCron Firebase function.
// Enqueues a seo_agent_run ai_job. Guarded by INTERNAL_CRON_TOKEN +
// isCronSkipped({ cron_seo_agent_enabled, defaultEnabled: false }).

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_seo_agent_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()
  await jobRef.set({
    type: "seo_agent_run",
    status: "pending",
    input: { userId: SYSTEM_USER_ID, runDate: new Date().toISOString().slice(0, 10) },
    result: null,
    error: null,
    userId: SYSTEM_USER_ID,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    triggeredBy: "seo_agent_cron",
  })

  return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
}
