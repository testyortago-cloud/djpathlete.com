import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { clientFeedbackSchema } from "@/lib/validators/ai-feedback"
import { submitFeedback } from "@/lib/db/ai-feedback"

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = clientFeedbackSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body.", details: parsed.error.issues }, { status: 400 })
    }

    const feedback = await submitFeedback({
      conversation_message_id: parsed.data.conversation_message_id,
      user_id: session.user.id,
      accuracy_rating: null,
      relevance_rating: null,
      helpfulness_rating: null,
      notes: null,
      thumbs_up: parsed.data.thumbs_up,
      feature: parsed.data.feature,
    })

    return NextResponse.json({ success: true, feedback })
  } catch (error) {
    console.error("[Client AI Feedback] Error:", error)
    return NextResponse.json({ error: "Failed to submit feedback." }, { status: 500 })
  }
}
