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
import { getUserById, getUsers } from "@/lib/db/users"
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
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id, exerciseId } = await params

    // Verify ownership
    const assessment = await getPerformanceAssessmentById(id)
    if (assessment.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const messages = await getAssessmentMessages(exerciseId)
    return NextResponse.json(messages)
  } catch (error) {
    console.error("Client assessment messages GET error:", error)
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
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id, exerciseId } = await params

    // Verify ownership
    const assessment = await getPerformanceAssessmentById(id)
    if (assessment.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

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

    // Notify all admins
    try {
      const client = await getUserById(session.user.id)
      const clientName = `${client.first_name} ${client.last_name}`
      const exercises = await getAssessmentExercises(id)
      const exercise = exercises.find((e) => e.id === exerciseId)
      const exerciseName = exercise?.exercises?.name ?? exercise?.custom_name ?? "an exercise"

      const allUsers = await getUsers()
      const admins = allUsers.filter((u) => u.role === "admin")

      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          title: "Assessment Reply",
          message: `${clientName} replied on "${exerciseName}"`,
          type: "info",
          is_read: false,
          link: `/admin/performance-assessments/${id}`,
        })

        sendPerformanceAssessmentReplyEmail({
          recipientEmail: admin.email,
          recipientFirstName: admin.first_name,
          recipientUserId: admin.id,
          senderName: clientName,
          exerciseName,
          assessmentTitle: assessment.title,
          assessmentId: id,
          isRecipientAdmin: true,
        }).catch((err) =>
          console.error("Failed to send assessment reply email:", err)
        )
      }
    } catch (err) {
      console.error("Failed to notify admin of assessment message:", err)
    }

    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    console.error("Client assessment message POST error:", error)
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    )
  }
}
