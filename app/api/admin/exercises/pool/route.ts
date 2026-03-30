import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getExercisesForAI, getExercises, type ExerciseAIFilters } from "@/lib/db/exercises"
import type { MovementPattern, ExerciseDifficulty } from "@/types/database"

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

    // If IDs are provided, fetch specific exercises (used by AI pool generation)
    const ids = searchParams.getAll("ids")
    if (ids.length > 0) {
      const allExercises = await getExercises()
      const idSet = new Set(ids)
      const matched = allExercises.filter((e) => idSet.has(e.id))
      return NextResponse.json(matched)
    }

    // Otherwise, filter-based lookup
    const movementPattern = searchParams.get("movement_pattern") as MovementPattern | null
    const primaryMuscles = searchParams.getAll("primary_muscles")
    const equipment = searchParams.getAll("equipment")
    const difficulty = searchParams.get("difficulty") as ExerciseDifficulty | null
    const isBodyweight = searchParams.get("is_bodyweight")
    const trainingIntent = searchParams.getAll("training_intent")
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 50)

    const filters: ExerciseAIFilters = {}
    if (movementPattern) filters.movement_pattern = movementPattern
    if (primaryMuscles.length > 0) filters.primary_muscles = primaryMuscles
    if (equipment.length > 0) filters.equipment = equipment
    if (difficulty) filters.difficulty = difficulty
    if (isBodyweight === "true" || isBodyweight === "false") {
      filters.is_bodyweight = isBodyweight === "true"
    }
    if (trainingIntent.length > 0) filters.training_intent = trainingIntent

    const exercises = await getExercisesForAI(
      Object.keys(filters).length > 0 ? filters : undefined
    )

    // Shuffle and limit to give variety across multiple generates
    const shuffled = exercises.sort(() => Math.random() - 0.5).slice(0, limit)

    return NextResponse.json(shuffled)
  } catch (err) {
    console.error("[exercises/pool] Error:", err)
    return NextResponse.json(
      { error: "Failed to fetch exercise pool" },
      { status: 500 }
    )
  }
}
