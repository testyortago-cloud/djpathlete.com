import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { buildNewsletterHtml } from "@/lib/email"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const newsletter = await getNewsletterById(id)

    if (newsletter.status === "sent") {
      return NextResponse.json({ error: "Newsletter has already been sent" }, { status: 400 })
    }

    if (!newsletter.content || newsletter.content.length < 10) {
      return NextResponse.json({ error: "Newsletter content is too short" }, { status: 400 })
    }

    // Mark as sent immediately to prevent double-sends
    await updateNewsletter(id, {
      status: "sent",
      sent_at: new Date().toISOString(),
    })

    // Build the full HTML once (not per-subscriber)
    const html = buildNewsletterHtml(newsletter.content)

    // Create a Firebase job — the Cloud Function handles the actual sending
    // This supports 10k+ subscribers with a 9-minute timeout
    const db = getAdminFirestore()
    await db
      .collection("ai_jobs")
      .doc()
      .set({
        type: "newsletter_send",
        status: "pending",
        input: {
          newsletterId: id,
          subject: newsletter.subject,
          html,
        },
        result: null,
        error: null,
        userId: session.user.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Newsletter send error:", error)
    return NextResponse.json({ error: "Failed to send newsletter" }, { status: 500 })
  }
}
