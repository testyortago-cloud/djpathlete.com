// app/api/admin/leads/[id]/regenerate-analysis/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { generateLeadAnalysis } from "@/lib/ai/lead-analysis"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { getLeadInquiryById, updateLeadInquiryAiFields } from "@/lib/db/lead-inquiries"
import { recordAudit } from "@/lib/audit/record"
import { MODEL_SONNET } from "@/lib/ai/anthropic"
import { SERVICE_LABELS, type ServiceType } from "@/lib/validators/inquiry"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const { id } = await params
  const startTime = Date.now()

  let inquiry: Awaited<ReturnType<typeof getLeadInquiryById>>
  try {
    inquiry = await getLeadInquiryById(id)
  } catch {
    return NextResponse.json({ error: "Lead inquiry not found" }, { status: 404 })
  }

  let logId: string | null = null
  try {
    const log = await createGenerationLog({
      program_id: null,
      client_id: inquiry.lead_user_id,
      requested_by: session.user.id,
      status: "pending",
      input_params: { feature: "lead_inquiry_analysis", regenerate: true, name: inquiry.name },
      output_summary: null,
      error_message: null,
      model_used: MODEL_SONNET,
      tokens_used: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: 1,
      generation_trigger: "lead_inquiry_regenerate",
    })
    logId = log.id

    const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await generateLeadAnalysis({
      name: inquiry.name,
      serviceLabel: SERVICE_LABELS[inquiry.service as ServiceType] ?? inquiry.service,
      sport: inquiry.sport,
      experience: inquiry.experience,
      goals: inquiry.goals,
      injuries: inquiry.injuries,
      howHeard: inquiry.how_heard,
    })

    await updateGenerationLog(logId, {
      status: "completed",
      output_summary: { priority: content.priority, summary: content.summary },
      tokens_used,
      cache_creation_tokens: cache_creation_tokens ?? null,
      cache_read_tokens: cache_read_tokens ?? null,
      duration_ms: Date.now() - startTime,
      completed_at: new Date().toISOString(),
    })

    const updated = await updateLeadInquiryAiFields(id, {
      ai_priority: content.priority,
      ai_priority_reason: content.priority_reason,
      ai_summary: content.summary,
      ai_draft_reply: content.draft_reply,
      ai_generation_log_id: logId,
      ai_generated_at: new Date().toISOString(),
    })

    await recordAudit({
      action: "lead.ai_analysis_generated",
      category: "automation",
      target: { type: "lead_inquiry", id, label: inquiry.name },
      metadata: { priority: content.priority, regenerate: true },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error("Failed to regenerate lead analysis:", err)
    if (logId) {
      await updateGenerationLog(logId, {
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      }).catch(() => {})
    }
    return NextResponse.json({ error: "Failed to regenerate analysis" }, { status: 500 })
  }
}
