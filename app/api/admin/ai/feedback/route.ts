import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminFeedbackSchema } from "@/lib/validators/ai-feedback"
import { submitFeedback } from "@/lib/db/ai-feedback"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const body = await request.json()
    const parsed = adminFeedbackSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body.", details: parsed.error.issues }, { status: 400 })
    }

    const feedback = await submitFeedback({
      conversation_message_id: parsed.data.conversation_message_id,
      user_id: session.user.id,
      accuracy_rating: parsed.data.accuracy_rating ?? null,
      relevance_rating: parsed.data.relevance_rating ?? null,
      helpfulness_rating: parsed.data.helpfulness_rating ?? null,
      notes: parsed.data.notes ?? null,
      thumbs_up: null,
      feature: parsed.data.feature,
    })

    return NextResponse.json({ success: true, feedback })
  } catch (error) {
    console.error("[AI Feedback] Error:", error)
    return NextResponse.json({ error: "Failed to submit feedback." }, { status: 500 })
  }
}
