// app/api/admin/ads/sync/route.ts
// Admin-triggered manual Google Ads sync. Enqueues an ai_jobs Firestore doc
// with type "google_ads_sync"; the Functions-side onDocumentCreated handler
// `googleAdsManualSync` picks it up and runs the same orchestrator the
// nightly schedule uses. The 202 response includes the job ID so the UI can
// poll later if needed (Plan 1.2 will likely wire this to a status pill).

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()
  await jobRef.set({
    type: "google_ads_sync",
    status: "pending",
    input: { triggered_by: session.user.id, manual: true },
    result: null,
    error: null,
    userId: session.user.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
}
