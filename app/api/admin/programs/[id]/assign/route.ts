import { NextResponse } from "next/server"
import { assignmentSchema } from "@/lib/validators/assignment"
import { createAssignment, getAssignmentByUserAndProgram } from "@/lib/db/assignments"
import { getProgramById } from "@/lib/db/programs"
import { getUserById } from "@/lib/db/users"
import { sendProgramReadyEmail } from "@/lib/email"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = assignmentSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const programData = await getProgramById(id)
    const { user_ids, start_date, notes, complimentary } = result.data
    const isPaid = (programData.price_cents ?? 0) > 0

    let assigned = 0
    let skipped = 0
    const errors: string[] = []

    for (const userId of user_ids) {
      try {
        const existing = await getAssignmentByUserAndProgram(userId, id)
        if (existing && existing.status === "active") {
          skipped++
          continue
        }

        await createAssignment({
          program_id: id,
          user_id: userId,
          start_date,
          notes: notes ?? null,
          assigned_by: null,
          end_date: null,
          status: "active",
          current_week: 1,
          total_weeks: programData.duration_weeks ?? null,
          payment_status: isPaid && !complimentary ? "pending" : "not_required",
          expires_at: null,
        })

        assigned++

        // Send email notification (non-blocking per client)
        try {
          const client = await getUserById(userId)
          await sendProgramReadyEmail(client.email, client.first_name, programData.name, userId)
        } catch (emailError) {
          console.error(`[assign] Failed to send email to ${userId}:`, emailError)
        }
      } catch (err) {
        errors.push(`Failed to assign to user ${userId}`)
        console.error(`[assign] Error for user ${userId}:`, err)
      }
    }

    return NextResponse.json({ assigned, skipped, errors }, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Failed to assign program. Please try again." },
      { status: 500 }
    )
  }
}
