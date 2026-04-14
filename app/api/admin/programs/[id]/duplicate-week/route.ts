import { NextResponse } from "next/server"
import { z } from "zod"
import { duplicateWeekExercises } from "@/lib/db/program-exercises"

const duplicateWeekSchema = z.object({
  sourceWeek: z.coerce.number().int().min(1),
  targetWeek: z.coerce.number().int().min(1),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = duplicateWeekSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid data", details: result.error.flatten().fieldErrors }, { status: 400 })
    }

    const exercises = await duplicateWeekExercises(id, result.data.sourceWeek, result.data.targetWeek)

    return NextResponse.json(exercises, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to duplicate week. Please try again." }, { status: 500 })
  }
}
