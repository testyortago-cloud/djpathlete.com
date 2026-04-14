import { NextResponse } from "next/server"
import { z } from "zod"
import { exerciseFormSchema } from "@/lib/validators/exercise"
import { createExercisesBulk } from "@/lib/db/exercises"

const importRowSchema = exerciseFormSchema

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = importSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const validExercises: z.infer<typeof importRowSchema>[] = []
    const errors: { row: number; errors: Record<string, string[]> }[] = []

    for (let i = 0; i < parsed.data.rows.length; i++) {
      const result = importRowSchema.safeParse(parsed.data.rows[i])
      if (result.success) {
        validExercises.push(result.data)
      } else {
        errors.push({
          row: i,
          errors: result.error.flatten().fieldErrors as Record<string, string[]>,
        })
      }
    }

    let imported = 0
    if (validExercises.length > 0) {
      const toInsert = validExercises.map((ex) => ({
        ...ex,
        is_active: true,
        created_by: null,
        thumbnail_url: null,
      }))
      const result = await createExercisesBulk(toInsert)
      imported = result.length
    }

    return NextResponse.json({ imported, errors })
  } catch {
    return NextResponse.json({ error: "Failed to import exercises" }, { status: 500 })
  }
}
