import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  getAssessmentMessages,
  createAssessmentMessage,
  getPerformanceAssessmentById,
  getAssessmentExercises,
} from "@/lib/db/performance-assessments"
import { createNotification } from "@/lib/db/notifications"
import { getUserById } from "@/lib/db/users"
import { sendPerformanceAssessmentReplyEmail } from "@/lib/email"

const messageSchema = z.object({
  message: z.string().min(1).max(5000),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { exerciseId } = await params
    const messages = await getAssessmentMessages(exerciseId)
    return NextResponse.json(messages)
  } catch (error) {
    console.error("Admin assessment messages GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id, exerciseId } = await params
    const body = await request.json()
    const parsed = messageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const message = await createAssessmentMessage({
      assessment_exercise_id: exerciseId,
      user_id: session.user.id,
      message: parsed.data.message,
    })

    // Notify the client
    try {
      const assessment = await getPerformanceAssessmentById(id)
      const client = await getUserById(assessment.client_user_id)
      const exercises = await getAssessmentExercises(id)
      const exercise = exercises.find((e) => e.id === exerciseId)
      const exerciseName = exercise?.exercises?.name ?? exercise?.custom_name ?? "an exercise"

      await createNotification({
        user_id: assessment.client_user_id,
        title: "Assessment Feedback",
        message: `Your coach left feedback on "${exerciseName}"`,
        type: "success",
        is_read: false,
        link: `/client/performance-assessments/${id}`,
      })

      sendPerformanceAssessmentReplyEmail({
        recipientEmail: client.email,
        recipientFirstName: client.first_name,
        recipientUserId: client.id,
        senderName: "Your coach",
        exerciseName,
        assessmentTitle: assessment.title,
        assessmentId: id,
        isRecipientAdmin: false,
      }).catch((err) =>
        console.error("Failed to send assessment reply email:", err)
      )
    } catch (err) {
      console.error("Failed to notify client of assessment message:", err)
    }

    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    console.error("Admin assessment message POST error:", error)
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    )
  }
}
