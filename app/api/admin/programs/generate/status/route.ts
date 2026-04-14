import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getGenerationLogById } from "@/lib/db/ai-generation-log"

export async function GET(request: Request) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const logId = searchParams.get("logId")

    if (!logId) {
      return NextResponse.json({ error: "logId query parameter is required" }, { status: 400 })
    }

    const log = await getGenerationLogById(logId)

    // Extract result data from completed logs
    const outputSummary = log.output_summary as Record<string, unknown> | null

    return NextResponse.json({
      status: log.status,
      current_step: log.current_step,
      total_steps: log.total_steps,
      program_id: log.program_id,
      error_message: log.error_message,
      validation: outputSummary?.validation ?? null,
      token_usage: outputSummary?.token_usage ?? null,
      duration_ms: log.duration_ms,
    })
  } catch (error) {
    console.error("[status] Failed to fetch generation status:", error)

    return NextResponse.json({ error: "Failed to fetch generation status" }, { status: 500 })
  }
}
