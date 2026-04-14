import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getGenerationLogs } from "@/lib/db/ai-generation-log"

export async function GET() {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    // Fetch all generation logs
    const logs = await getGenerationLogs()

    // Compute summary stats
    const totalGenerations = logs.length
    const successful = logs.filter((l) => l.status === "completed").length
    const failed = logs.filter((l) => l.status === "failed").length
    const generating = logs.filter((l) => l.status === "generating").length

    const completedLogs = logs.filter((l) => l.status === "completed" && l.tokens_used != null)

    const totalTokens = completedLogs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0)
    const avgTokensPerGeneration = completedLogs.length > 0 ? Math.round(totalTokens / completedLogs.length) : 0

    const completedWithDuration = completedLogs.filter((l) => l.duration_ms != null)
    const totalDuration = completedWithDuration.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0)
    const avgDurationMs =
      completedWithDuration.length > 0 ? Math.round(totalDuration / completedWithDuration.length) : 0

    return NextResponse.json({
      stats: {
        total_generations: totalGenerations,
        successful,
        failed,
        generating,
        total_tokens: totalTokens,
        avg_tokens_per_generation: avgTokensPerGeneration,
        avg_duration_ms: avgDurationMs,
      },
      recent_logs: logs.slice(0, 20),
    })
  } catch (error) {
    console.error("Failed to fetch AI usage stats:", error)
    return NextResponse.json({ error: "Failed to fetch AI usage statistics." }, { status: 500 })
  }
}
