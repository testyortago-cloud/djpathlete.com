import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: jobId } = await params
    const db = getAdminFirestore()
    const jobSnap = await db.collection("ai_jobs").doc(jobId).get()

    if (!jobSnap.exists) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    const job = jobSnap.data()!

    // Verify the user owns this job
    if (job.userId !== session.user.id && session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({
      id: jobSnap.id,
      type: job.type,
      status: job.status,
      result: job.result ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: job.updatedAt?.toDate?.()?.toISOString() ?? null,
    })
  } catch (error) {
    console.error("[ai-jobs] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
