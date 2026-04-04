import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getAllExercisesForEmbedding,
  getExercisesWithEmbeddingCount,
  updateExerciseEmbedding,
} from "@/lib/db/exercise-embeddings"
import { embedExercise } from "@/lib/ai/embeddings"

/**
 * GET — Returns embedding stats (total exercises vs embedded count)
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const stats = await getExercisesWithEmbeddingCount()
    return NextResponse.json(stats)
  } catch (error) {
    console.error("[embed] Failed to get stats:", error)
    return NextResponse.json(
      { error: "Failed to get embedding stats" },
      { status: 500 }
    )
  }
}

/**
 * POST — Regenerates embeddings for all active exercises (or only missing ones)
 * Body: { mode: "all" | "missing" }
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const mode = body.mode === "missing" ? "missing" : "all"

    const exercises = await getAllExercisesForEmbedding()

    // Filter to only exercises missing embeddings if mode is "missing"
    const toEmbed =
      mode === "missing"
        ? exercises.filter((e) => !e.embedding)
        : exercises

    if (toEmbed.length === 0) {
      return NextResponse.json({
        success: true,
        embedded: 0,
        failed: 0,
        total: exercises.length,
        message: "All exercises already have embeddings.",
      })
    }

    let embedded = 0
    let failed = 0

    // Process in batches to avoid timeouts
    for (const exercise of toEmbed) {
      try {
        const embedding = await embedExercise(exercise)
        await updateExerciseEmbedding(exercise.id, embedding)
        embedded++
      } catch (err) {
        console.error(
          `[embed] Failed to embed "${exercise.name}":`,
          err instanceof Error ? err.message : err
        )
        failed++
      }
    }

    return NextResponse.json({
      success: true,
      embedded,
      failed,
      total: exercises.length,
      message: `Embedded ${embedded} exercise${embedded !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}.`,
    })
  } catch (error) {
    console.error("[embed] Failed to regenerate embeddings:", error)
    return NextResponse.json(
      { error: "Failed to regenerate embeddings" },
      { status: 500 }
    )
  }
}
