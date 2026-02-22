import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getRelationships, createRelationship } from "@/lib/db/exercise-relationships"
import type { ExerciseRelationshipType } from "@/types/database"

const createRelationshipSchema = z.object({
  exercise_id: z.string().min(1, "Exercise ID is required"),
  related_exercise_id: z.string().min(1, "Related exercise ID is required"),
  relationship_type: z.enum(["progression", "regression", "alternative", "variation"] as const),
  notes: z
    .string()
    .max(500, "Notes must be under 500 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
})

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const exerciseId = searchParams.get("exerciseId")

    if (!exerciseId) {
      return NextResponse.json(
        { error: "exerciseId query parameter is required" },
        { status: 400 }
      )
    }

    const relationships = await getRelationships(exerciseId)
    return NextResponse.json(relationships)
  } catch (error) {
    console.error("Exercise relationships GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch relationships" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createRelationshipSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    if (parsed.data.exercise_id === parsed.data.related_exercise_id) {
      return NextResponse.json(
        { error: "An exercise cannot be related to itself" },
        { status: 400 }
      )
    }

    const relationship = await createRelationship({
      exercise_id: parsed.data.exercise_id,
      related_exercise_id: parsed.data.related_exercise_id,
      relationship_type: parsed.data.relationship_type as ExerciseRelationshipType,
      notes: parsed.data.notes ?? null,
    })

    return NextResponse.json(relationship, { status: 201 })
  } catch (error: unknown) {
    const pgError = error as { code?: string }
    if (pgError?.code === "23505") {
      return NextResponse.json(
        { error: "This alternative already exists" },
        { status: 409 }
      )
    }
    console.error("Exercise relationships POST error:", error)
    return NextResponse.json(
      { error: "Failed to create relationship" },
      { status: 500 }
    )
  }
}
