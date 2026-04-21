// functions/src/voice-drift-monitor.ts
// Weekly scheduled Firebase Function (Mon 04:00 America/Chicago). Audits the
// last 7 days of AI-generated content (social_posts, blog_posts, newsletters
// that have their `source_*` fields set) against the brand voice_profile and
// writes flagged items to voice_drift_flags.
//
// The onSchedule wrapper lives in functions/src/index.ts so this file is
// unit-testable as a pure function via `runVoiceDriftMonitor()`.

import type { SupabaseClient } from "@supabase/supabase-js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { voiceDriftAssessmentSchema, type VoiceDriftAssessment } from "./ai/schemas.js"
import { getSupabase } from "./lib/supabase.js"
import { isAutomationPaused } from "./lib/system-settings.js"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const GLOBAL_LIMIT = 20
const PREVIEW_MAX_CHARS = 500

type EntityType = "social_post" | "blog_post" | "newsletter"

interface ScanItem {
  entityType: EntityType
  entityId: string
  content: string
  createdAt: string
}

export interface RunVoiceDriftMonitorOptions {
  supabaseImpl?: SupabaseClient
  claudeImpl?: (systemPrompt: string, userMessage: string) => Promise<VoiceDriftAssessment>
  now?: Date
  limit?: number
}

export interface VoiceDriftMonitorResult {
  scanned: number
  flagged: number
  skippedNoVoiceProfile: boolean
  errors: number
  paused?: true
}

/**
 * Runs one weekly voice-drift scan. Never throws on a per-item failure — each
 * transient Claude error increments `errors` but the rest of the batch keeps
 * going. Returns counters for Cloud Scheduler logs.
 */
export async function runVoiceDriftMonitor(
  options: RunVoiceDriftMonitorOptions = {},
): Promise<VoiceDriftMonitorResult> {
  const supabase = options.supabaseImpl ?? getSupabase()
  const now = options.now ?? new Date()
  const limit = options.limit ?? GLOBAL_LIMIT
  const since = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString()

  const counters: VoiceDriftMonitorResult = {
    scanned: 0,
    flagged: 0,
    skippedNoVoiceProfile: false,
    errors: 0,
  }

  if (await isAutomationPaused(supabase)) {
    return { ...counters, paused: true }
  }

  // 1. Fetch the active voice profile. Without it there's nothing to compare against.
  const { data: vpRow, error: vpErr } = await supabase
    .from("prompt_templates")
    .select("prompt")
    .eq("category", "voice_profile")
    .limit(1)
    .maybeSingle()
  if (vpErr) throw new Error(`Voice profile lookup failed: ${vpErr.message}`)
  const voiceProfile = vpRow && typeof vpRow.prompt === "string" ? vpRow.prompt : ""
  if (!voiceProfile) {
    counters.skippedNoVoiceProfile = true
    return counters
  }

  // 2. Pull last-week AI-generated samples from each entity table.
  const items = await collectScanItems(supabase, since, limit)
  if (items.length === 0) return counters

  const claude =
    options.claudeImpl ??
    (async (systemPrompt: string, userMessage: string): Promise<VoiceDriftAssessment> => {
      const result = await callAgent(systemPrompt, userMessage, voiceDriftAssessmentSchema, {
        model: MODEL_SONNET,
        maxTokens: 600,
        cacheSystemPrompt: true,
      })
      return result.content
    })

  const systemPrompt = [
    "You are the DJP Athlete brand voice auditor.",
    "Compare the user-supplied sample against the following voice profile.",
    "Return structured JSON per the provided schema. Use editorial judgment: not every departure is drift.",
    "",
    "--- VOICE PROFILE ---",
    voiceProfile,
  ].join("\n")

  for (const item of items) {
    counters.scanned += 1
    const userMessage = `Assess this ${item.entityType} for voice drift:\n\n${item.content.slice(0, PREVIEW_MAX_CHARS * 4)}`

    let assessment: VoiceDriftAssessment
    try {
      assessment = await claude(systemPrompt, userMessage)
    } catch (err) {
      console.error(`[voice-drift-monitor] claude failed for ${item.entityType}:${item.entityId}`, err)
      counters.errors += 1
      continue
    }

    if (assessment.severity === "low") continue

    const { error: insErr } = await supabase.from("voice_drift_flags").insert({
      entity_type: item.entityType,
      entity_id: item.entityId,
      drift_score: assessment.drift_score,
      severity: assessment.severity,
      issues: assessment.issues,
      content_preview: item.content.slice(0, PREVIEW_MAX_CHARS),
      scanned_at: now.toISOString(),
    })
    if (insErr) {
      console.error("[voice-drift-monitor] insert failed:", insErr)
      counters.errors += 1
      continue
    }
    counters.flagged += 1
  }

  return counters
}

async function collectScanItems(supabase: SupabaseClient, sinceIso: string, globalLimit: number): Promise<ScanItem[]> {
  const { data: socials } = await supabase
    .from("social_posts")
    .select("id, content, created_at")
    .not("source_video_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(20)

  const { data: blogs } = await supabase
    .from("blog_posts")
    .select("id, content, created_at")
    .not("source_video_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(10)

  const { data: newsletters } = await supabase
    .from("newsletters")
    .select("id, content, created_at")
    .not("source_blog_post_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(5)

  const items: ScanItem[] = [
    ...((socials ?? []) as Array<{ id: string; content: string; created_at: string }>).map((r) => ({
      entityType: "social_post" as const,
      entityId: r.id,
      content: r.content,
      createdAt: r.created_at,
    })),
    ...((blogs ?? []) as Array<{ id: string; content: string; created_at: string }>).map((r) => ({
      entityType: "blog_post" as const,
      entityId: r.id,
      content: r.content,
      createdAt: r.created_at,
    })),
    ...((newsletters ?? []) as Array<{ id: string; content: string; created_at: string }>).map((r) => ({
      entityType: "newsletter" as const,
      entityId: r.id,
      content: r.content,
      createdAt: r.created_at,
    })),
  ]

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return items.slice(0, globalLimit)
}
