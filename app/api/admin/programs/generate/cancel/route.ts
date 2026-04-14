import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const { jobId } = await request.json()
    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 })
    }

    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc(jobId)
    const jobSnap = await jobRef.get()

    if (!jobSnap.exists) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    const job = jobSnap.data()!
    // Only cancel if still pending or processing
    if (job.status !== "pending" && job.status !== "processing") {
      return NextResponse.json({ error: `Job already ${job.status}` }, { status: 409 })
    }

    // Mark as cancelled in Firestore
    await jobRef.update({
      status: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Update RTDB so the client UI picks it up immediately
    try {
      const rtdb = getAdminRtdb()
      await rtdb.ref(`ai_jobs/${jobId}`).update({
        status: "cancelled",
        updatedAt: Date.now(),
      })
    } catch {
      // Non-critical
    }

    return NextResponse.json({ status: "cancelled" })
  } catch (error) {
    console.error("[cancel] Failed to cancel job:", error)
    return NextResponse.json({ error: "Failed to cancel generation" }, { status: 500 })
  }
}
