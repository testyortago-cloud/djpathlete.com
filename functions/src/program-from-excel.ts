import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { programImportSchema, type ProgramImportPlan } from "./ai/schemas.js"
import { PROGRAM_IMPORT_PROMPT } from "./ai/prompts.js"
import { resolveExerciseNames, type ResolvedExercise } from "./ai/resolve-exercise.js"
import {
  bulkAddExercisesToProgram,
  getClientProfile,
  createJobProgressUpdater,
  createCancellationChecker,
} from "./ai/shared-helpers.js"
import { getSupabase } from "./lib/supabase.js"
import { notifyJobCompleted, notifyJobFailed } from "./lib/notify-job-done.js"

// ─── Pure core ──────────────────────────────────────────────────────────────

export interface BuildOptions {
  client_id: string | null
  is_public: boolean
  name_override: string | null
  notify_email: string | null
  requestedBy: string
  fileName: string
}

export interface ImportReport {
  source: "excel_import"
  file_name: string
  client_id: string | null
  matched: { raw_name: string; exercise_id: string; exercise_name: string; method: string; confidence: number }[]
  created: { raw_name: string; exercise_id: string }[]
  gaps_filled: string[]
  assumptions: string[]
  interpretation_notes?: string | null
  counts: { days: number; exercises: number; weeks: number }
}

const VALID_TECHNIQUES = new Set([
  "straight_set",
  "superset",
  "dropset",
  "giant_set",
  "circuit",
  "rest_pause",
  "amrap",
  "cluster_set",
  "complex",
  "emom",
  "wave_loading",
])

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

export function buildProgramFromPlan(
  plan: ProgramImportPlan,
  resolved: Map<string, ResolvedExercise>,
  options: BuildOptions,
): { programRow: Record<string, unknown>; exerciseRows: Record<string, unknown>[]; report: ImportReport } {
  const exerciseRows: Record<string, unknown>[] = []
  const matched: ImportReport["matched"] = []
  const created: ImportReport["created"] = []
  const seenResolved = new Set<string>()
  const weeks = new Set<number>()

  for (const day of plan.days) {
    weeks.add(day.week_number)
    for (const ex of day.exercises) {
      const r = resolved.get(norm(ex.raw_name))
      if (!r) continue
      exerciseRows.push({
        exercise_id: r.exercise_id,
        day_of_week: day.day_of_week,
        week_number: day.week_number,
        order_index: ex.order_index,
        sets: ex.sets ?? 3,
        reps: ex.reps ?? "8-12",
        duration_seconds: null,
        rest_seconds: ex.rest_seconds ?? null,
        notes: ex.notes ?? null,
        rpe_target: ex.rpe_target ?? null,
        intensity_pct: null,
        tempo: ex.tempo ?? null,
        group_tag: ex.group_tag ?? null,
        technique: ex.technique && VALID_TECHNIQUES.has(ex.technique) ? ex.technique : "straight_set",
      })
      if (!seenResolved.has(r.exercise_id)) {
        seenResolved.add(r.exercise_id)
        if (r.created) created.push({ raw_name: r.raw_name, exercise_id: r.exercise_id })
        else
          matched.push({
            raw_name: r.raw_name,
            exercise_id: r.exercise_id,
            exercise_name: r.exercise_name,
            method: r.method,
            confidence: r.confidence,
          })
      }
    }
  }

  const report: ImportReport = {
    source: "excel_import",
    file_name: options.fileName,
    client_id: options.client_id,
    matched,
    created,
    gaps_filled: plan.gaps_filled ?? [],
    assumptions: plan.assumptions ?? [],
    interpretation_notes: plan.interpretation_notes ?? null,
    counts: { days: plan.days.length, exercises: exerciseRows.length, weeks: weeks.size },
  }

  const programRow: Record<string, unknown> = {
    name: options.name_override ?? plan.program.name,
    description: plan.program.description ?? null,
    category: plan.program.category?.length ? plan.program.category : ["strength"],
    difficulty: plan.program.difficulty ?? "intermediate",
    tier: plan.program.tier ?? "premium",
    duration_weeks: plan.program.duration_weeks,
    sessions_per_week: plan.program.sessions_per_week,
    split_type: plan.program.split_type ?? null,
    periodization: plan.program.periodization ?? null,
    is_public: options.is_public,
    is_ai_generated: true,
    ai_generation_params: { ...report, token_usage: null },
    is_active: true,
    created_by: options.requestedBy,
    price_cents: null,
  }

  return { programRow, exerciseRows, report }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

interface ParsedSheet {
  sheets: { name: string; rows: string[][] }[]
}

interface ProgramFromExcelInput {
  parsedSheet: ParsedSheet
  options: {
    client_id: string | null
    is_public: boolean
    name_override: string | null
    notify_email: string | null
  }
  fileName: string
  requestedBy: string
  logId?: string
  notify_email?: string | null
}

/** Write real-time status to RTDB so the client can listen for instant updates */
async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try {
    const rtdb = getDatabase()
    await rtdb.ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() })
  } catch (e) {
    console.warn(`[program-from-excel] RTDB update failed:`, e)
  }
}

function renderSheetsToText(parsedSheet: ParsedSheet): string {
  return parsedSheet.sheets
    .map((sheet) => `## ${sheet.name}\n${sheet.rows.map((r) => r.join(" | ")).join("\n")}`)
    .join("\n\n")
}

export async function handleProgramFromExcel(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    console.error(`[program-from-excel] Job ${jobId} not found`)
    return
  }

  const job = jobSnap.data()!
  if (job.status !== "pending") {
    console.log(`[program-from-excel] Job ${jobId} already ${job.status}, skipping`)
    return
  }

  // Double-check not cancelled between creation and pickup
  const freshSnap = await jobRef.get()
  if (freshSnap.data()?.status === "cancelled") {
    console.log(`[program-from-excel] Job ${jobId} was cancelled before processing`)
    return
  }

  // Mark as processing in both Firestore and RTDB
  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })
  await updateRtdb(jobId, { status: "processing" })

  const input = job.input as ProgramFromExcelInput

  try {
    const updateProgress = createJobProgressUpdater(jobId, 4)
    const checkCancelled = createCancellationChecker(jobId)

    console.log(`[program-from-excel] Starting for job ${jobId}`)

    await updateProgress("parsing", 1)
    let renderedText = renderSheetsToText(input.parsedSheet)
    if (input.options.client_id) {
      const profile = await getClientProfile(input.options.client_id)
      if (profile) {
        renderedText += `\n\n## Client profile\n${JSON.stringify(profile)}`
      }
    }

    await updateProgress("interpreting", 2)
    if (await checkCancelled()) return
    const agentRes = await callAgent<ProgramImportPlan>(
      PROGRAM_IMPORT_PROMPT,
      renderedText,
      programImportSchema,
      { model: MODEL_SONNET, cacheSystemPrompt: true },
    )
    const plan = agentRes.content

    await updateProgress("matching", 3)
    if (await checkCancelled()) return
    const rawNames = [...new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.raw_name)))]
    const resolved = await resolveExerciseNames(rawNames)

    const buildOptions: BuildOptions = {
      client_id: input.options.client_id ?? null,
      is_public: input.options.is_public ?? false,
      name_override: input.options.name_override ?? null,
      notify_email: input.notify_email ?? null,
      requestedBy: input.requestedBy,
      fileName: input.fileName,
    }
    const { programRow, exerciseRows, report } = buildProgramFromPlan(plan, resolved, buildOptions)
    ;(programRow.ai_generation_params as Record<string, unknown>).token_usage = { total: agentRes.tokens_used }

    await updateProgress("building", 4)
    const supabase = getSupabase()
    const { data: program, error } = await supabase.from("programs").insert(programRow).select().single()
    if (error || !program) throw new Error(`Failed to create program: ${error?.message ?? "unknown error"}`)

    const rows = exerciseRows.map((r) => ({ ...r, program_id: program.id }))
    try {
      await bulkAddExercisesToProgram(rows)
    } catch (e) {
      await supabase.from("programs").update({ is_active: false }).eq("id", program.id)
      throw e
    }

    if (input.logId) {
      await supabase
        .from("ai_generation_log")
        .update({
          status: "completed",
          program_id: program.id,
          output_summary: report,
          tokens_used: agentRes.tokens_used,
          completed_at: new Date().toISOString(),
        })
        .eq("id", input.logId)
    }

    const resultPayload = { program_id: program.id, report }

    // Write result to Firestore (permanent record)
    await jobRef.update({
      status: "completed",
      result: resultPayload,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Write result to RTDB (real-time client updates)
    await updateRtdb(jobId, { status: "completed", result: resultPayload })

    console.log(`[program-from-excel] Job ${jobId} completed — program_id: ${program.id}`)

    await notifyJobCompleted({
      notify_email: input.notify_email,
      programId: program.id,
      jobLabel: "Excel import",
      summary: `Imported ${report.counts.exercises} exercises across ${report.counts.weeks} week(s).`,
      details: [
        { label: "Matched", value: String(report.matched.length) },
        { label: "New exercises", value: String(report.created.length) },
      ],
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[program-from-excel] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Write error to RTDB so client sees it instantly
    await updateRtdb(jobId, { status: "failed", error: errorMessage })

    if (input.logId) {
      try {
        const supabase = getSupabase()
        await supabase
          .from("ai_generation_log")
          .update({ status: "failed", error_message: errorMessage })
          .eq("id", input.logId)
      } catch (e) {
        console.warn(`[program-from-excel] Failed to update log ${input.logId} to failed:`, e)
      }
    }

    await notifyJobFailed({
      notify_email: input.notify_email,
      programId: null,
      jobLabel: "Excel import",
      error: errorMessage,
    })
  }
}
