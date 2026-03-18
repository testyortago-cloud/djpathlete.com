import type {
  AgentCallResult,
  ExerciseSlot,
  ProfileAnalysis,
  ProgramSkeleton,
  ExerciseAssignment,
  ValidationResult,
  OrchestrationResult,
  CompressedExercise,
  ProgramCategory,
  ProgramDifficulty,
} from "./types.js"
import { callAgent, MODEL_HAIKU, MODEL_SONNET } from "./anthropic.js"
import { scoreAndFilterExercises, semanticFilterExercises } from "./exercise-filter.js"
import { estimateTokens } from "./token-utils.js"
import { profileAnalysisSchema, programSkeletonSchema, exerciseAssignmentSchema } from "./schemas.js"
import { PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT } from "./prompts.js"
import { validateProgram } from "./validate.js"
import { filterByDifficultyScore, formatExerciseLibrary } from "./exercise-context.js"
import { getExercisesForAI } from "./program-chat-tools.js"
import {
  buildPriorWeekContext,
  verifyWeekDiversity,
  analyzeFullProgramRepetition,
  extractWeekSkeleton,
  type WeekAssignment,
} from "./dedup-verify.js"
import { retrieveSimilarContext, formatRagContext, buildRagAugmentedPrompt, embedConversationMessage } from "./rag.js"
import { getSupabase } from "../lib/supabase.js"

const MAX_RETRIES = 2

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssessmentContext {
  assessmentResultId: string
  computedLevels: { overall: string; squat: string; push: string; pull: string; hinge: string }
  maxDifficultyScore: number
  generationTrigger: "initial_assessment" | "reassessment"
}

export interface AiGenerationRequest {
  client_id?: string | null
  goals: string[]
  duration_weeks: number
  sessions_per_week: number
  session_minutes?: number
  split_type?: string
  periodization?: string
  tier?: string
  additional_instructions?: string
  equipment_override?: string[]
  is_public?: boolean
  price_cents?: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deriveProgramCategory(goals: string[]): ProgramCategory {
  const goalSet = new Set(goals.map((g) => g.toLowerCase()))
  if (goalSet.has("muscle_gain") && goalSet.has("endurance")) return "hybrid"
  if (goalSet.has("muscle_gain") || goalSet.has("weight_loss")) return "strength"
  if (goalSet.has("endurance")) return "conditioning"
  if (goalSet.has("sport_specific")) return "sport_specific"
  if (goalSet.has("flexibility")) return "recovery"
  if (goalSet.has("general_health")) return "hybrid"
  return "strength"
}

function mapDifficulty(experienceLevel: string | null): ProgramDifficulty {
  switch (experienceLevel) {
    case "beginner": return "beginner"
    case "intermediate": return "intermediate"
    case "advanced": return "advanced"
    case "elite": return "elite"
    default: return "beginner"
  }
}

// ─── Supabase helpers ───────────────────────────────────────────────────────

async function getProfileByUserId(userId: string) {
  const supabase = getSupabase()
  const { data } = await supabase.from("client_profiles").select("*").eq("user_id", userId).single()
  return data
}

async function getUserById(userId: string) {
  const supabase = getSupabase()
  const { data } = await supabase.from("users").select("*").eq("id", userId).single()
  if (!data) throw new Error("User not found")
  return data
}

async function createProgram(params: Record<string, unknown>) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from("programs").insert(params).select().single()
  if (error) throw new Error(`Failed to create program: ${error.message}`)
  return data
}

async function addExerciseToProgram(params: Record<string, unknown>, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const supabase = getSupabase()
    const { error } = await supabase.from("program_exercises").insert(params)
    if (!error) return
    if (attempt === retries) throw new Error(`Failed to add exercise: ${error.message}`)
    console.warn(`[orchestrator:sync] addExerciseToProgram attempt ${attempt} failed: ${error.message}, retrying...`)
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

async function createAssignment(params: Record<string, unknown>) {
  const supabase = getSupabase()
  const { error } = await supabase.from("program_assignments").insert(params)
  if (error) throw new Error(`Failed to create assignment: ${error.message}`)
}

async function createGenerationLog(params: Record<string, unknown>) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from("ai_generation_log").insert(params).select().single()
  if (error) throw new Error(`Failed to create generation log: ${error.message}`)
  return data
}

async function updateGenerationLog(id: string, updates: Record<string, unknown>) {
  const supabase = getSupabase()
  await supabase.from("ai_generation_log").update(updates).eq("id", id)
}

async function saveConversationBatch(messages: Array<Record<string, unknown>>) {
  const supabase = getSupabase()
  const cleaned = messages.map((m) => {
    const { embedding: _e, ...rest } = m as Record<string, unknown>
    return rest
  })
  const { data, error } = await supabase.from("ai_conversation_history").insert(cleaned).select()
  if (error) throw new Error(`Failed to save conversation: ${error.message}`)
  return data ?? []
}

// ─── Full Synchronous Pipeline ──────────────────────────────────────────────

export async function generateProgramSync(
  request: AiGenerationRequest,
  requestedBy: string,
  assessmentContext?: AssessmentContext,
  existingLogId?: string,
  firebaseJobId?: string
): Promise<OrchestrationResult> {
  console.log("[orchestrator:sync] Starting generateProgramSync", {
    client_id: request.client_id ?? "none",
    goals: request.goals,
    duration_weeks: request.duration_weeks,
    sessions_per_week: request.sessions_per_week,
    existingLogId: existingLogId ?? "none",
    firebaseJobId: firebaseJobId ?? "none",
  })

  // Helper to push step progress to RTDB for real-time client updates
  const TOTAL_STEPS = 7
  async function updateJobProgress(step: string, currentStep: number, detail?: string) {
    if (!firebaseJobId) return
    try {
      const { getDatabase } = await import("firebase-admin/database")
      const rtdb = getDatabase()
      await rtdb.ref(`ai_jobs/${firebaseJobId}`).update({
        progress: { status: step, current_step: currentStep, total_steps: TOTAL_STEPS, detail: detail ?? null },
        updatedAt: Date.now(),
      })
    } catch (e) {
      console.warn("[orchestrator:sync] Failed to update RTDB progress:", e)
    }
  }

  // Check if the job has been cancelled by the user
  async function checkCancelled(): Promise<boolean> {
    if (!firebaseJobId) return false
    try {
      const { getFirestore } = await import("firebase-admin/firestore")
      const db = getFirestore()
      const snap = await db.collection("ai_jobs").doc(firebaseJobId).get()
      return snap.exists && snap.data()?.status === "cancelled"
    } catch {
      return false
    }
  }

  const startTime = Date.now()
  const tokenUsage = { agent1: 0, agent2: 0, agent3: 0, agent4: 0, total: 0 }
  let retries = 0

  // Use existing log created by the API route, or create a new one (e.g. assessment trigger)
  let log: { id: string }
  if (existingLogId) {
    await updateGenerationLog(existingLogId, {
      status: "generating",
      current_step: 0,
      ...(assessmentContext ? {
        generation_trigger: assessmentContext.generationTrigger,
        assessment_result_id: assessmentContext.assessmentResultId,
      } : {}),
    })
    log = { id: existingLogId }
    console.log("[orchestrator:sync] Using existing generation log:", log.id)
  } else {
    // Try with client_id first; if FK fails, retry with null
    const logParams = {
      program_id: null,
      client_id: request.client_id ?? null,
      requested_by: requestedBy,
      status: "generating",
      input_params: request,
      output_summary: null,
      error_message: null,
      model_used: "haiku+sonnet-mixed",
      tokens_used: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: 3,
      ...(assessmentContext ? {
        generation_trigger: assessmentContext.generationTrigger,
        assessment_result_id: assessmentContext.assessmentResultId,
      } : {}),
    }
    try {
      log = await createGenerationLog(logParams)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      if (msg.includes("foreign key") || msg.includes("invalid input syntax")) {
        console.warn("[orchestrator:sync] client_id FK failed, retrying with null:", msg)
        log = await createGenerationLog({ ...logParams, client_id: null })
      } else {
        throw e
      }
    }
    console.log("[orchestrator:sync] Generation log created:", log.id)
  }

  try {
    // Fetch client profile
    let profile: Awaited<ReturnType<typeof getProfileByUserId>> = null
    let clientName = "General Client"
    if (request.client_id) {
      profile = await getProfileByUserId(request.client_id)
      try {
        const user = await getUserById(request.client_id)
        clientName = `${user.first_name} ${user.last_name}`.trim()
      } catch { clientName = "Client" }
    }

    let age: number | null = null
    if (profile?.date_of_birth) {
      const birthDate = new Date(profile.date_of_birth)
      if (!isNaN(birthDate.getTime())) age = new Date().getFullYear() - birthDate.getFullYear()
    }

    const profileContext = profile
      ? JSON.stringify({
          goals: profile.goals, sport: profile.sport, gender: profile.gender, age,
          date_of_birth: profile.date_of_birth, experience_level: profile.experience_level,
          movement_confidence: profile.movement_confidence, sleep_hours: profile.sleep_hours,
          stress_level: profile.stress_level, occupation_activity_level: profile.occupation_activity_level,
          training_years: profile.training_years, injuries: profile.injuries,
          injury_details: profile.injury_details, available_equipment: profile.available_equipment,
          preferred_session_minutes: profile.preferred_session_minutes,
          preferred_training_days: profile.preferred_training_days,
          preferred_day_names: profile.preferred_day_names,
          preferred_techniques: profile.preferred_techniques,
          time_efficiency_preference: profile.time_efficiency_preference,
          height_cm: profile.height_cm, weight_kg: profile.weight_kg,
          exercise_likes: profile.exercise_likes, exercise_dislikes: profile.exercise_dislikes,
          training_background: profile.training_background, additional_notes: profile.additional_notes,
        })
      : JSON.stringify({ note: "No profile found — use defaults for a general fitness client." })

    const assessmentSection = assessmentContext
      ? `\n\n## Client Assessment Results
Overall Level: ${assessmentContext.computedLevels.overall}
Squat Pattern: ${assessmentContext.computedLevels.squat}
Push Pattern: ${assessmentContext.computedLevels.push}
Pull Pattern: ${assessmentContext.computedLevels.pull}
Hinge Pattern: ${assessmentContext.computedLevels.hinge}
Maximum Exercise Difficulty: ${assessmentContext.maxDifficultyScore}/10

IMPORTANT: Only select exercises with difficulty_score <= ${assessmentContext.maxDifficultyScore}.`
      : ""

    const agent1UserMessage = `Client Profile:\n${profileContext}\n\nTraining Request:\n- Goals: ${request.goals.join(", ")}\n- Duration: ${request.duration_weeks} weeks\n- Sessions per week: ${request.sessions_per_week}\n- Session length: ${request.session_minutes ?? 60} minutes\n${request.split_type ? `- Requested split type: ${request.split_type}` : ""}\n${request.periodization ? `- Requested periodization: ${request.periodization}` : ""}\n${request.equipment_override ? `- Equipment override: ${request.equipment_override.join(", ")}` : ""}\n${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ""}${assessmentSection}`

    // RAG
    const ragQuery = `${request.goals.join(", ")} ${request.duration_weeks}wk ${request.sessions_per_week}x/wk ${profile?.experience_level ?? "beginner"}`
    const ragResults = await retrieveSimilarContext(ragQuery, "program_generation", { threshold: 0.5, limit: 2 }).catch(() => [])
    const ragContext = formatRagContext(ragResults)
    const augmentedAgent1Prompt = ragContext ? buildRagAugmentedPrompt(PROFILE_ANALYZER_PROMPT, ragContext) : PROFILE_ANALYZER_PROMPT

    // Agent 1 + exercise fetch in parallel
    await updateJobProgress("analyzing_profile", 1, "Analyzing client profile & fetching exercises")
    console.log("[orchestrator:sync] Running Agent 1 + exercise fetch...")
    const [agent1Result, allExercises] = await Promise.all([
      callAgent<ProfileAnalysis>(augmentedAgent1Prompt, agent1UserMessage, profileAnalysisSchema, { model: MODEL_HAIKU, cacheSystemPrompt: true }),
      getExercisesForAI(),
    ])
    tokenUsage.agent1 = agent1Result.tokens_used
    console.log("[orchestrator:sync] Agent 1 complete. Tokens:", agent1Result.tokens_used, "Exercises:", allExercises.length)

    // Save conversation (fire-and-forget)
    const genSessionId = `gen-${log.id}`
    saveConversationBatch([
      { user_id: requestedBy, feature: "program_generation", session_id: genSessionId, role: "user", content: agent1UserMessage, metadata: { step: 1, log_id: log.id, client_id: request.client_id }, tokens_input: null, tokens_output: null, model_used: null },
      { user_id: requestedBy, feature: "program_generation", session_id: genSessionId, role: "assistant", content: JSON.stringify(agent1Result.content), metadata: { step: 1, log_id: log.id, model: MODEL_HAIKU }, tokens_input: null, tokens_output: agent1Result.tokens_used, model_used: MODEL_HAIKU },
    ]).then((saved) => {
      const assistantMsg = saved.find((m: Record<string, unknown>) => m.role === "assistant")
      if (assistantMsg) embedConversationMessage(assistantMsg.id).catch(() => {})
    }).catch(() => {})

    const analysis = agent1Result.content
    const allCompressed = allExercises // already compressed from getExercisesForAI
    const compressed = assessmentContext ? filterByDifficultyScore(allCompressed, assessmentContext.maxDifficultyScore) : allCompressed

    if (request.split_type) analysis.recommended_split = request.split_type as typeof analysis.recommended_split
    if (request.periodization) analysis.recommended_periodization = request.periodization as typeof analysis.recommended_periodization

    await updateJobProgress("profile_complete", 2, `Profile analyzed — ${compressed.length} exercises available`)

    // Check cancellation before Agent 2
    if (await checkCancelled()) {
      console.log("[orchestrator:sync] Job cancelled by user before Agent 2")
      await updateGenerationLog(log.id, { status: "cancelled", duration_ms: Date.now() - startTime })
      return { program_id: "", validation: { pass: false, issues: [], summary: "Cancelled" }, token_usage: tokenUsage, duration_ms: Date.now() - startTime, retries: 0 }
    }

    // Agent 2
    await updateJobProgress("designing_structure", 3, "Designing program structure & weekly layout")
    const agent2UserMessage = `Profile Analysis:\n${JSON.stringify(analysis)}\n\nTraining Parameters:\n- Duration: ${request.duration_weeks} weeks\n- Sessions per week: ${request.sessions_per_week}\n- Session length: ${request.session_minutes ?? 60} minutes\n- Split type: ${analysis.recommended_split}\n- Periodization: ${analysis.recommended_periodization}\n- Goals: ${request.goals.join(", ")}\n${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ""}`

    console.log("[orchestrator:sync] Running Agent 2 (program architect)...")
    const agent2Result = await callAgent<ProgramSkeleton>(PROGRAM_ARCHITECT_PROMPT, agent2UserMessage, programSkeletonSchema, { maxTokens: 16384, cacheSystemPrompt: true })
    tokenUsage.agent2 = agent2Result.tokens_used
    const skeleton = agent2Result.content
    // Backfill total_sessions if the AI omitted it or returned 0
    if (!skeleton.total_sessions) {
      skeleton.total_sessions = skeleton.weeks.reduce((sum, w) => sum + w.days.length, 0)
    }
    console.log("[orchestrator:sync] Agent 2 complete. Tokens:", agent2Result.tokens_used)

    saveConversationBatch([
      { user_id: requestedBy, feature: "program_generation", session_id: genSessionId, role: "user", content: agent2UserMessage, metadata: { step: 2, log_id: log.id }, tokens_input: null, tokens_output: null, model_used: null },
      { user_id: requestedBy, feature: "program_generation", session_id: genSessionId, role: "assistant", content: JSON.stringify(agent2Result.content), metadata: { step: 2, log_id: log.id }, tokens_input: null, tokens_output: agent2Result.tokens_used, model_used: MODEL_SONNET },
    ]).then((saved) => {
      const assistantMsg = saved.find((m: Record<string, unknown>) => m.role === "assistant")
      if (assistantMsg) embedConversationMessage(assistantMsg.id).catch(() => {})
    }).catch(() => {})

    const totalSlots = skeleton.weeks.reduce((sum, w) => sum + w.days.reduce((ds, d) => ds + d.slots.length, 0), 0)
    await updateJobProgress("structure_complete", 4, `${skeleton.weeks.length} weeks × ${skeleton.weeks[0]?.days.length ?? 0} days — ${totalSlots} exercise slots`)

    // Pre-filter exercises
    const availableEquipment = request.equipment_override ?? profile?.available_equipment ?? []
    const constraintsContext = JSON.stringify({
      exercise_constraints: analysis.exercise_constraints,
      available_equipment: availableEquipment,
      client_difficulty: profile?.experience_level ?? "beginner",
    })

    let filtered: CompressedExercise[]
    try { filtered = await semanticFilterExercises(compressed, skeleton, availableEquipment, analysis) }
    catch { filtered = scoreAndFilterExercises(compressed, skeleton, availableEquipment, analysis) }
    const exerciseLibrary = formatExerciseLibrary(filtered)

    // Check cancellation before Agent 3
    if (await checkCancelled()) {
      console.log("[orchestrator:sync] Job cancelled by user before Agent 3")
      await updateGenerationLog(log.id, { status: "cancelled", duration_ms: Date.now() - startTime })
      return { program_id: "", validation: { pass: false, issues: [], summary: "Cancelled" }, token_usage: tokenUsage, duration_ms: Date.now() - startTime, retries: 0 }
    }

    // ─── Week-by-Week Agent 3 with Dedup Verification ──────────────────────
    await updateJobProgress("selecting_exercises", 5, `Selecting exercises week-by-week for ${totalSlots} slots across ${skeleton.weeks.length} weeks`)
    console.log("[orchestrator:sync] Running Agent 3 (exercise selection) week-by-week with", filtered.length, "filtered exercises...")
    const completedWeeksSync: WeekAssignment[] = []
    const clientDifficultySync = profile?.experience_level ?? "beginner"

    // Build an exercise ID set for quick lookup to strip hallucinated IDs
    const exerciseIdSet = new Set(compressed.map((e) => e.id))

    for (const week of skeleton.weeks) {
      const weekNum = week.week_number
      const weekSkeleton = extractWeekSkeleton(skeleton.weeks, weekNum)
      if (!weekSkeleton) continue

      const priorContext = buildPriorWeekContext(completedWeeksSync, skeleton.weeks)
      const weekSkeletonPayload = {
        weeks: [weekSkeleton],
        split_type: skeleton.split_type,
        periodization: skeleton.periodization,
        total_sessions: weekSkeleton.days.length,
        notes: skeleton.notes,
      }

      const weekTotalSlots = weekSkeleton.days.reduce((sum, d) => sum + d.slots.length, 0)
      console.log(`[orchestrator:sync] Week ${weekNum}/${skeleton.weeks.length} (${weekTotalSlots} slots, ${completedWeeksSync.length} prior weeks)`)

      // Check cancellation between weeks
      if (await checkCancelled()) {
        console.log("[orchestrator:sync] Job cancelled by user during week-by-week generation")
        await updateGenerationLog(log.id, { status: "cancelled", duration_ms: Date.now() - startTime })
        return { program_id: "", validation: { pass: false, issues: [], summary: "Cancelled" }, token_usage: tokenUsage, duration_ms: Date.now() - startTime, retries: 0 }
      }

      let weekAssignment: ExerciseAssignment | null = null
      let weekValidation: ValidationResult | null = null

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let feedbackSection = ""
        if (attempt > 0 && weekValidation !== null) {
          const errorIssues = weekValidation.issues.filter((i) => i.type === "error")
          feedbackSection = `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Issues to fix:\n${JSON.stringify(errorIssues)}\n\nPlease fix ALL errors and try again.`
        }

        let dedupFeedback = ""
        if (attempt > 0 && weekAssignment) {
          const dedupResult = verifyWeekDiversity(
            { week_number: weekNum, assignments: weekAssignment.assignments },
            completedWeeksSync,
            skeleton.weeks
          )
          if (!dedupResult.pass) {
            const repetitionIssues = dedupResult.issues
              .filter((i) => i.severity === "error")
              .map((i) => `- ${i.message}`)
              .join("\n")
            dedupFeedback = `\n\nEXERCISE REPETITION DETECTED — you MUST choose DIFFERENT exercises:\n${repetitionIssues}\n\nSelect alternative exercises from the library that STILL MATCH the slot's movement_pattern, target_muscles, and role — but use a different exercise_id. Do NOT pick random exercises just to avoid repetition. Vary by equipment (dumbbell→cable→machine), angle, or stance while keeping the same training purpose.`
          }
        }

        const agent3UserMessage = `Program Skeleton (Week ${weekNum} of ${skeleton.weeks.length}):\n${JSON.stringify(weekSkeletonPayload)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${filtered.length} exercises, pre-filtered for relevance):\n${exerciseLibrary}\n\n${priorContext.prompt_text}${feedbackSection}${dedupFeedback}`

        try {
          console.log(`[orchestrator:sync] Week ${weekNum} attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
          const agent3Result: AgentCallResult<ExerciseAssignment> = await callAgent<ExerciseAssignment>(
            EXERCISE_SELECTOR_PROMPT,
            agent3UserMessage,
            exerciseAssignmentSchema,
            { maxTokens: 8192, cacheSystemPrompt: true }
          )
          tokenUsage.agent3 += agent3Result.tokens_used
          weekAssignment = agent3Result.content

          // Strip hallucinated exercise IDs
          const validCount = weekAssignment.assignments.length
          weekAssignment.assignments = weekAssignment.assignments.filter((a) => exerciseIdSet.has(a.exercise_id))
          const strippedCount = validCount - weekAssignment.assignments.length
          if (strippedCount > 0) {
            console.warn(`[orchestrator:sync] Week ${weekNum}: Stripped ${strippedCount} hallucinated exercise IDs`)
          }

          console.log(`[orchestrator:sync] Week ${weekNum} Agent 3: ${weekAssignment.assignments.length} assignments`)

          // Code-based validation (single-week)
          weekValidation = validateProgram(
            weekSkeletonPayload as ProgramSkeleton,
            weekAssignment,
            analysis,
            compressed,
            availableEquipment,
            clientDifficultySync,
            assessmentContext?.maxDifficultyScore
          )

          // Dedup verification against prior weeks
          const dedupResult = verifyWeekDiversity(
            { week_number: weekNum, assignments: weekAssignment.assignments },
            completedWeeksSync,
            skeleton.weeks
          )
          console.log(`[orchestrator:sync] Week ${weekNum} dedup: ${dedupResult.summary}`)

          if (!dedupResult.pass) {
            for (const issue of dedupResult.issues.filter((i) => i.severity === "error")) {
              weekValidation.issues.push({
                type: "error",
                category: "exercise_repetition",
                message: issue.message,
                slot_ref: issue.slot_id,
              })
            }
            weekValidation.pass = false
          }

          const errors = weekValidation.issues.filter(i => i.type === "error")
          if (errors.length > 0) {
            console.log(`[orchestrator:sync] Week ${weekNum} errors:`, errors.map(e => e.message))
          }

          if (weekValidation.pass || !weekValidation.issues.some((i) => i.type === "error")) break
          console.log(`[orchestrator:sync] Week ${weekNum} retrying...`)
          retries++
        } catch (agentError) {
          console.error(`[orchestrator:sync] Week ${weekNum} attempt ${attempt + 1} error:`, agentError instanceof Error ? agentError.message : agentError)
          if (attempt === MAX_RETRIES) {
            throw new Error(`Exercise selection failed for week ${weekNum} after ${MAX_RETRIES + 1} attempts: ${agentError instanceof Error ? agentError.message : "Unknown error"}`)
          }
          retries++
        }
      }

      if (!weekAssignment) throw new Error(`Failed to generate exercises for week ${weekNum}`)

      completedWeeksSync.push({ week_number: weekNum, assignments: weekAssignment.assignments })
      console.log(`[orchestrator:sync] Week ${weekNum} complete`)

      await updateJobProgress("selecting_exercises", 5, `Week ${weekNum}/${skeleton.weeks.length} done — ${completedWeeksSync.reduce((s, w) => s + w.assignments.length, 0)} exercises so far`)
    }

    // Merge all week assignments
    const allAssignmentsSync = completedWeeksSync.flatMap((w) => w.assignments)
    const assignment: ExerciseAssignment = { assignments: allAssignmentsSync, substitution_notes: [] }

    // Full-program dedup report
    const syncRepetitionReport = analyzeFullProgramRepetition(completedWeeksSync, skeleton.weeks)
    console.log(`[orchestrator:sync] Full program repetition: ${syncRepetitionReport.summary}`)

    // Full-program validation
    const validation = validateProgram(skeleton, assignment, analysis, compressed, availableEquipment, clientDifficultySync, assessmentContext?.maxDifficultyScore)

    if (!syncRepetitionReport.pass) {
      validation.issues.push({ type: "warning", category: "exercise_repetition", message: syncRepetitionReport.summary })
    }

    const finalErrors = validation.issues.filter(i => i.type === "error")
    const finalWarnings = validation.issues.filter(i => i.type === "warning")
    console.log("[orchestrator:sync] Final validation:", { pass: validation.pass, errors: finalErrors.length, warnings: finalWarnings.length })
    if (finalErrors.length > 0) {
      console.log("[orchestrator:sync] Validation ERRORS:")
      finalErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.message}`))
    }

    await updateJobProgress("validated", 6, `${assignment.assignments.length} exercises assigned — ${validation.pass ? "all checks passed" : `${finalWarnings.length} warnings`}`)

    // Create program
    const programCategory = deriveProgramCategory(request.goals)
    const programDifficulty = mapDifficulty(profile?.experience_level ?? null)
    const goalsLabel = request.goals.map((g) => g.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(" & ")
    const splitLabel = skeleton.split_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

    const program = await createProgram({
      name: request.client_id ? `${clientName}'s ${request.duration_weeks}-Week ${goalsLabel} Program` : `${request.duration_weeks}-Week ${goalsLabel} Program`,
      description: `A ${request.duration_weeks}-week ${splitLabel.toLowerCase()} program designed for ${goalsLabel.toLowerCase()}, training ${request.sessions_per_week}x per week. ${skeleton.notes}`,
      category: [programCategory],
      difficulty: programDifficulty,
      tier: request.tier ?? "premium",
      duration_weeks: request.duration_weeks,
      sessions_per_week: request.sessions_per_week,
      split_type: skeleton.split_type,
      periodization: skeleton.periodization,
      is_public: request.is_public ?? false,
      is_ai_generated: true,
      ai_generation_params: { request, analysis_summary: { split: analysis.recommended_split, periodization: analysis.recommended_periodization, training_age: analysis.training_age_category, constraints_count: analysis.exercise_constraints.length }, validation: { pass: validation.pass, warnings: validation.issues.filter((i) => i.type === "warning").length, errors: validation.issues.filter((i) => i.type === "error").length }, token_usage: tokenUsage },
      is_active: true,
      created_by: requestedBy,
      price_cents: request.price_cents ?? null,
    })

    // Insert exercises
    const slotLookup = new Map<string, { week_number: number; day_of_week: number; order_index: number }>()
    const slotDetailsLookup = new Map<string, { sets: number; reps: string; rest_seconds: number; rpe_target: number | null; tempo: string | null; group_tag: string | null; technique: ExerciseSlot["technique"] }>()

    for (const week of skeleton.weeks) {
      for (const day of week.days) {
        day.slots.forEach((slot, idx) => {
          slotLookup.set(slot.slot_id, { week_number: week.week_number, day_of_week: day.day_of_week, order_index: idx })
          slotDetailsLookup.set(slot.slot_id, { sets: slot.sets, reps: slot.reps, rest_seconds: slot.rest_seconds, rpe_target: slot.rpe_target, tempo: slot.tempo, group_tag: slot.group_tag, technique: slot.technique ?? "straight_set" })
        })
      }
    }

    await updateJobProgress("saving_program", 7, `Saving program with ${assignment.assignments.length} exercises`)

    await Promise.all(assignment.assignments.map((assigned) => {
      const location = slotLookup.get(assigned.slot_id)
      const details = slotDetailsLookup.get(assigned.slot_id)
      if (!location || !details) return Promise.resolve(null)
      return addExerciseToProgram({
        program_id: program.id, exercise_id: assigned.exercise_id,
        day_of_week: location.day_of_week, week_number: location.week_number,
        order_index: location.order_index, sets: details.sets, reps: details.reps,
        duration_seconds: null, rest_seconds: details.rest_seconds, notes: assigned.notes,
        rpe_target: details.rpe_target, intensity_pct: null, tempo: details.tempo,
        group_tag: details.group_tag, technique: details.technique ?? "straight_set",
      })
    }))

    // Auto-assign
    if (request.client_id) {
      try {
        await createAssignment({
          program_id: program.id, user_id: request.client_id,
          assigned_by: requestedBy, start_date: new Date().toISOString().split("T")[0],
          end_date: null, status: "active", notes: "Auto-assigned from AI program generation",
          current_week: 1, total_weeks: program.duration_weeks ?? null,
        })
      } catch (e) { console.error("[orchestrator:sync] Failed to auto-assign:", e) }
    }

    // Update log
    const durationMs = Date.now() - startTime
    tokenUsage.total = tokenUsage.agent1 + tokenUsage.agent2 + tokenUsage.agent3

    await updateGenerationLog(log.id, {
      program_id: program.id, status: "completed",
      tokens_used: tokenUsage.total, duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      output_summary: { program_id: program.id, program_name: program.name, exercises_assigned: assignment.assignments.length, validation_pass: validation.pass, warnings: validation.issues.filter((i) => i.type === "warning").length, retries },
    })

    return { program_id: program.id, validation, token_usage: tokenUsage, duration_ms: durationMs, retries }
  } catch (error) {
    const durationMs = Date.now() - startTime
    tokenUsage.total = tokenUsage.agent1 + tokenUsage.agent2 + tokenUsage.agent3
    const errorMessage = error instanceof Error ? error.message : "Unknown error during program generation"
    console.error("[orchestrator:sync] PIPELINE FAILED:", errorMessage)

    await updateGenerationLog(log.id, {
      status: "failed", error_message: errorMessage,
      tokens_used: tokenUsage.total, duration_ms: durationMs,
    }).catch((e) => console.error("Failed to update generation log:", e))

    throw error
  }
}
