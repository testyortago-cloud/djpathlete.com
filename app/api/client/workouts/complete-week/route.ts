import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { advanceWeek, getAssignmentById } from "@/lib/db/assignments"
import { getProgramById } from "@/lib/db/programs"
import { getUserById } from "@/lib/db/users"
import { sendCoachProgramCompletedNotification, sendReassessmentReminderEmail } from "@/lib/email"
import { createNotification } from "@/lib/db/notifications"
import { z } from "zod"

const completeWeekSchema = z.object({
  assignmentId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = completeWeekSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const { assignmentId } = parsed.data

    // Verify ownership — the assignment must belong to the current user
    const assignment = await getAssignmentById(assignmentId)
    if (assignment.user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (assignment.status !== "active") {
      return NextResponse.json({ error: "Assignment is not active" }, { status: 400 })
    }

    const result = await advanceWeek(assignmentId)

    // Notify coach and client when the program is fully completed
    if (result.program_completed) {
      const [client, program] = await Promise.all([getUserById(session.user.id), getProgramById(assignment.program_id)])

      const programName = program?.name ?? "Unknown Program"
      const clientName = `${client.first_name} ${client.last_name}`.trim()

      // Notify coach
      try {
        const coachEmail = process.env.COACH_EMAIL ?? "admin@darrenjpaul.com"
        const coachFirstName = process.env.COACH_FIRST_NAME ?? "Coach"

        await sendCoachProgramCompletedNotification({
          coachEmail,
          coachFirstName,
          clientName,
          clientId: session.user.id,
          programName,
        })
      } catch {
        // Non-blocking
      }

      // Notify client — reassessment reminder email
      try {
        await sendReassessmentReminderEmail({
          to: client.email,
          firstName: client.first_name,
          programName,
          clientUserId: session.user.id,
        })
      } catch {
        // Non-blocking
      }

      // In-app notification for client
      try {
        await createNotification({
          user_id: session.user.id,
          title: "Program Complete!",
          message: `You've finished ${programName}. Take a reassessment to get your next program.`,
          type: "success",
          is_read: false,
          link: "/client/reassessment",
        })
      } catch {
        // Non-blocking
      }
    }

    return NextResponse.json({
      assignment: result,
      programCompleted: result.program_completed,
    })
  } catch (error) {
    console.error("Complete week POST error:", error)
    return NextResponse.json({ error: "Failed to advance week" }, { status: 500 })
  }
}
