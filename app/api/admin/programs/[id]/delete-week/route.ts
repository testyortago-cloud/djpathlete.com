import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProgramById, updateProgram } from "@/lib/db/programs"
import { getActiveAssignmentsForProgram, updateAssignment } from "@/lib/db/assignments"
import { deleteWeekExercises } from "@/lib/db/program-exercises"
import { deleteWeekAccessForWeek, shiftWeekAccessDown } from "@/lib/db/week-access"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id } = await params
    const { weekNumber } = (await request.json()) as { weekNumber: number }

    const program = await getProgramById(id)
    const currentWeeks = program.duration_weeks ?? 1

    if (currentWeeks <= 1) {
      return NextResponse.json({ error: "Cannot delete the only week in a program." }, { status: 400 })
    }

    if (weekNumber < 1 || weekNumber > currentWeeks) {
      return NextResponse.json({ error: "Invalid week number." }, { status: 400 })
    }

    // Delete exercises and renumber subsequent weeks
    await deleteWeekExercises(id, weekNumber)

    // Decrement duration_weeks
    const newDuration = currentWeeks - 1
    await updateProgram(id, { duration_weeks: newDuration })

    // Update all active assignments + clean up week access records
    const activeAssignments = await getActiveAssignmentsForProgram(id)
    await Promise.all(
      activeAssignments.map(async (a) => {
        await updateAssignment(a.id, { total_weeks: newDuration })
        await deleteWeekAccessForWeek(a.id, weekNumber)
        await shiftWeekAccessDown(a.id, weekNumber)
      }),
    )

    return NextResponse.json({ new_total_weeks: newDuration }, { status: 200 })
  } catch {
    return NextResponse.json({ error: "Failed to delete week. Please try again." }, { status: 500 })
  }
}
