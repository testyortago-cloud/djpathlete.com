import type { AiGenerationRequest } from "@/lib/validators/ai-generation"
import type {
  AgentCallResult,
  ExerciseSlot,
  ProfileAnalysis,
  ProgramSkeleton,
  ExerciseAssignment,
  ValidationResult,
  OrchestrationResult,
} from "@/lib/ai/types"
import type { AiGenerationLog, ProgramCategory, ProgramDifficulty } from "@/types/database"
import { callAgent, MODEL_HAIKU, MODEL_SONNET } from "@/lib/ai/anthropic"
import { scoreAndFilterExercises, semanticFilterExercises, getDifficultyTargetForWeek } from "@/lib/ai/exercise-filter"
import { analyzePushPullBalance, applyBalanceCorrections, formatBalanceReport } from "@/lib/ai/balance"
import { buildVariationConstraints, formatVariationRulesForPrompt, validateVariationCompliance } from "@/lib/ai/variation"
import { buildExerciseGraph, formatGraphContextForPrompt } from "@/lib/ai/exercise-graph"
import { estimateTokens } from "@/lib/ai/token-utils"
import {
  profileAnalysisSchema,
  programSkeletonSchema,
  exerciseAssignmentSchema,
} from "@/lib/ai/schemas"
import {
  PROFILE_ANALYZER_PROMPT,
  PROGRAM_ARCHITECT_PROMPT,
  EXERCISE_SELECTOR_PROMPT,
} from "@/lib/ai/prompts"
import { validateProgram } from "@/lib/ai/validate"
import { compressExercises, filterByDifficultyScore, formatExerciseLibrary } from "@/lib/ai/exercise-context"
import type { CompressedExercise } from "@/lib/ai/exercise-context"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getExercisesForAI } from "@/lib/db/exercises"
import { createProgram, getProgramById } from "@/lib/db/programs"
import { addExerciseToProgram } from "@/lib/db/program-exercises"
import {
  createGenerationLog,
  updateGenerationLog,
  getGenerationLogById,
} from "@/lib/db/ai-generation-log"
import { getUserById } from "@/lib/db/users"
import { createAssignment } from "@/lib/db/assignments"
import { saveConversationBatch } from "@/lib/db/ai-conversations"
import { retrieveSimilarContext, formatRagContext, buildRagAugmentedPrompt, embedConversationMessage } from "@/lib/ai/rag"

const MAX_RETRIES = 2

// ─── Assessment Result Context ──────────────────────────────────────────────

export interface AssessmentContext {
  assessmentResultId: string
  computedLevels: {
    overall: string
    squat: string
    push: string
    pull: string
    hinge: string
  }
  maxDifficultyScore: number
  generationTrigger: "initial_assessment" | "reassessment"
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function deriveProgramCategory(goals: string[]): ProgramCategory {
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
    case "beginner":
      return "beginner"
    case "intermediate":
      return "intermediate"
    case "advanced":
      return "advanced"
    case "elite":
      return "elite"
    default:
      return "beginner"
  }
}

// ─── Step 1: Profile Analysis + Exercise Fetch ──────────────────────────────

export async function runStep1(logId: string): Promise<void> {
  console.log(`[orchestrator:step1] Starting for logId=${logId}`)
  const stepStart = Date.now()

  await updateGenerationLog(logId, { status: "step_1", current_step: 1 })

  const log = await getGenerationLogById(logId)
  const request = log.input_params as unknown as AiGenerationRequest
  const requestedBy = log.requested_by

  // Reconstruct assessment context from log if this was assessment-triggered
  const logAssessmentContext = (log.input_params as Record<string, unknown>)?._assessmentContext as AssessmentContext | undefined

  // Fetch client profile (skip if no client selected)
  let profile: Awaited<ReturnType<typeof getProfileByUserId>> = null
  let clientName = "General Client"
  if (request.client_id) {
    profile = await getProfileByUserId(request.client_id)
    try {
      const user = await getUserById(request.client_id)
      clientName = `${user.first_name} ${user.last_name}`.trim()
    } catch {
      clientName = "Client"
    }
  }

  let age: number | null = null
  if (profile?.date_of_birth) {
    const birthDate = new Date(profile.date_of_birth)
    if (!isNaN(birthDate.getTime())) {
      age = new Date().getFullYear() - birthDate.getFullYear()
    }
  }

  const profileContext = profile
    ? JSON.stringify({
        goals: profile.goals,
        sport: profile.sport,
        gender: profile.gender,
        age,
        date_of_birth: profile.date_of_birth,
        experience_level: profile.experience_level,
        movement_confidence: profile.movement_confidence,
        sleep_hours: profile.sleep_hours,
        stress_level: profile.stress_level,
        occupation_activity_level: profile.occupation_activity_level,
        training_years: profile.training_years,
        injuries: profile.injuries,
        injury_details: profile.injury_details,
        available_equipment: profile.available_equipment,
        preferred_session_minutes: profile.preferred_session_minutes,
        preferred_training_days: profile.preferred_training_days,
        preferred_day_names: profile.preferred_day_names,
        preferred_techniques: profile.preferred_techniques,
        time_efficiency_preference: profile.time_efficiency_preference,
        height_cm: profile.height_cm,
        weight_kg: profile.weight_kg,
        exercise_likes: profile.exercise_likes,
        exercise_dislikes: profile.exercise_dislikes,
        training_background: profile.training_background,
        additional_notes: profile.additional_notes,
      })
    : JSON.stringify({ note: "No profile found — use defaults for a general fitness client." })

  // Build assessment context section for the prompt (only when assessment-triggered)
  const stepAssessmentCtx = logAssessmentContext
  const assessmentPromptSection = stepAssessmentCtx
    ? `\n\n## Client Assessment Results
Overall Level: ${stepAssessmentCtx.computedLevels.overall}
Squat Pattern: ${stepAssessmentCtx.computedLevels.squat}
Push Pattern: ${stepAssessmentCtx.computedLevels.push}
Pull Pattern: ${stepAssessmentCtx.computedLevels.pull}
Hinge Pattern: ${stepAssessmentCtx.computedLevels.hinge}
Maximum Exercise Difficulty: ${stepAssessmentCtx.maxDifficultyScore}/10

IMPORTANT: Only select exercises with difficulty_score <= ${stepAssessmentCtx.maxDifficultyScore}.
For patterns where the client is at beginner level, use foundational/beginner exercises (difficulty 1-4).
For intermediate patterns, use intermediate exercises (difficulty 4-7).
For advanced patterns, use advanced exercises (difficulty 7-9).`
    : ""

  const agent1UserMessage = `Client Profile:
${profileContext}

Training Request:
- Goals: ${request.goals.join(", ")}
- Duration: ${request.duration_weeks} weeks
- Sessions per week: ${request.sessions_per_week}
- Session length: ${request.session_minutes ?? 60} minutes
${request.split_type ? `- Requested split type: ${request.split_type}` : ""}
${request.periodization ? `- Requested periodization: ${request.periodization}` : ""}
${request.equipment_override ? `- Equipment override: ${request.equipment_override.join(", ")}` : ""}
${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ""}
${profile?.preferred_day_names?.length ? `- Preferred training days: ${profile.preferred_day_names.map((d: number) => ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ')}` : ''}
${profile?.time_efficiency_preference ? `- Time efficiency preference: ${profile.time_efficiency_preference}` : ''}
${profile?.preferred_techniques?.length ? `- Preferred techniques: ${profile.preferred_techniques.join(', ')}` : ''}
${age ? `- Client age: ${age}` : ''}
${profile?.sleep_hours ? `- Sleep: ${profile.sleep_hours}` : ''}
${profile?.stress_level ? `- Stress level: ${profile.stress_level}` : ''}
${profile?.occupation_activity_level ? `- Occupation activity: ${profile.occupation_activity_level}` : ''}
${profile?.movement_confidence ? `- Movement confidence: ${profile.movement_confidence}` : ''}
${profile?.exercise_likes ? `- Exercise likes: ${profile.exercise_likes}` : ''}
${profile?.exercise_dislikes ? `- Exercise dislikes: ${profile.exercise_dislikes}` : ''}
${profile?.training_background ? `- Training background: ${profile.training_background}` : ''}
${profile?.additional_notes ? `- Additional notes: ${profile.additional_notes}` : ''}${assessmentPromptSection}`

  // Run Agent 1 and exercise library fetch concurrently (no rate limit issue)
  const [agent1Result, allExercises] = await Promise.all([
    callAgent<ProfileAnalysis>(
      PROFILE_ANALYZER_PROMPT,
      agent1UserMessage,
      profileAnalysisSchema,
      { model: MODEL_HAIKU, cacheSystemPrompt: true }
    ),
    getExercisesForAI(),
  ])

  const analysis = agent1Result.content
  // Apply difficulty score filter when assessment context is available
  const allCompressed = compressExercises(allExercises)
  const compressed = stepAssessmentCtx
    ? filterByDifficultyScore(allCompressed, stepAssessmentCtx.maxDifficultyScore)
    : allCompressed
  console.log(`[orchestrator:step1] Agent 1 done in ${Date.now() - stepStart}ms (${agent1Result.tokens_used} tokens), ${compressed.length} exercises (${allCompressed.length} total, filtered by difficulty)`)

  // Apply overrides
  if (request.split_type) {
    analysis.recommended_split = request.split_type
  }
  if (request.periodization) {
    analysis.recommended_periodization = request.periodization
  }

  // Save intermediate data to log
  await updateGenerationLog(logId, {
    output_summary: {
      step1: {
        analysis,
        compressed,
        client_name: clientName,
        experience_level: profile?.experience_level ?? "beginner",
        available_equipment: request.equipment_override ?? profile?.available_equipment ?? [],
        agent1_tokens: agent1Result.tokens_used,
      },
    },
    tokens_used: agent1Result.tokens_used,
  })

  console.log(`[orchestrator:step1] Complete in ${Date.now() - stepStart}ms`)
}

// ─── Step 2: Program Architect (Sonnet) ─────────────────────────────────────

export async function runStep2(logId: string): Promise<void> {
  console.log(`[orchestrator:step2] Starting for logId=${logId}`)
  const stepStart = Date.now()

  await updateGenerationLog(logId, { status: "step_2", current_step: 2 })

  const log = await getGenerationLogById(logId)
  const request = log.input_params as unknown as AiGenerationRequest
  const step1Data = (log.output_summary as Record<string, unknown>)?.step1 as {
    analysis: ProfileAnalysis
    compressed: CompressedExercise[]
    client_name: string
    experience_level: string
    available_equipment: string[]
    agent1_tokens: number
  }

  if (!step1Data) {
    throw new Error("Step 1 data not found in generation log")
  }

  const { analysis } = step1Data

  // Agent 2 — Program Architect (Sonnet — this is the slow one)
  const agent2UserMessage = `Profile Analysis:
${JSON.stringify(analysis)}

Training Parameters:
- Duration: ${request.duration_weeks} weeks
- Sessions per week: ${request.sessions_per_week}
- Session length: ${request.session_minutes ?? 60} minutes
- Split type: ${analysis.recommended_split}
- Periodization: ${analysis.recommended_periodization}
- Goals: ${request.goals.join(", ")}
${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ""}`

  const agent2Result = await callAgent<ProgramSkeleton>(
    PROGRAM_ARCHITECT_PROMPT,
    agent2UserMessage,
    programSkeletonSchema,
    { maxTokens: 16384, cacheSystemPrompt: true }
  )

  let skeleton = agent2Result.content
  console.log(`[orchestrator:step2] Agent 2 done in ${Date.now() - stepStart}ms (${agent2Result.tokens_used} tokens)`)

  // Apply push/pull balance corrections to skeleton
  const balanceReport = analyzePushPullBalance(skeleton, skeleton.split_type)
  if (!balanceReport.isBalanced && balanceReport.corrections.length > 0) {
    console.log(`[orchestrator:step2] Balance corrections: ${balanceReport.corrections.length}`)
    console.log(`[orchestrator:step2] ${formatBalanceReport(balanceReport)}`)
    skeleton = applyBalanceCorrections(skeleton, balanceReport.corrections)
  }

  // Build variation constraints for Agent 3
  const variationConstraints = buildVariationConstraints(skeleton)
  console.log(`[orchestrator:step2] Variation: ${variationConstraints.groups.length} groups, ${variationConstraints.rules.length} rules`)

  // Save skeleton to log
  const prevTokens = log.tokens_used ?? 0
  await updateGenerationLog(logId, {
    output_summary: {
      ...log.output_summary,
      step2: {
        skeleton,
        agent2_tokens: agent2Result.tokens_used,
        balance_report: balanceReport.summary,
        variation_constraints: variationConstraints,
      },
    },
    tokens_used: prevTokens + agent2Result.tokens_used,
  })

  console.log(`[orchestrator:step2] Complete in ${Date.now() - stepStart}ms`)
}

// ─── Step 3: Exercise Selection + Validation + DB + Email ───────────────────

export async function runStep3(logId: string): Promise<void> {
  console.log(`[orchestrator:step3] Starting for logId=${logId}`)
  const stepStart = Date.now()

  await updateGenerationLog(logId, { status: "step_3", current_step: 3 })

  const log = await getGenerationLogById(logId)
  const request = log.input_params as unknown as AiGenerationRequest
  const requestedBy = log.requested_by

  // Read assessment context from input_params if available
  const step3AssessmentCtx = (log.input_params as Record<string, unknown>)?._assessmentContext as AssessmentContext | undefined

  const outputSummary = log.output_summary as Record<string, unknown>
  const step1Data = outputSummary?.step1 as {
    analysis: ProfileAnalysis
    compressed: CompressedExercise[]
    client_name: string
    experience_level: string
    available_equipment: string[]
    agent1_tokens: number
  }
  const step2Data = outputSummary?.step2 as {
    skeleton: ProgramSkeleton
    agent2_tokens: number
    balance_report?: string
    variation_constraints?: ReturnType<typeof buildVariationConstraints>
  }

  if (!step1Data || !step2Data) {
    throw new Error("Step 1 or Step 2 data not found in generation log")
  }

  const { analysis, compressed, client_name: clientName, experience_level: clientDifficulty, available_equipment: availableEquipment } = step1Data
  const { skeleton } = step2Data

  // Build variation constraints (may have been saved in step2, rebuild if missing)
  const variationConstraints = step2Data.variation_constraints ?? buildVariationConstraints(skeleton)
  const variationRulesText = formatVariationRulesForPrompt(variationConstraints)

  const constraintsContext = JSON.stringify({
    exercise_constraints: analysis.exercise_constraints,
    available_equipment: availableEquipment,
    client_difficulty: clientDifficulty,
  })

  // Pre-filter exercises
  let filtered: CompressedExercise[]
  try {
    filtered = await semanticFilterExercises(compressed, skeleton, availableEquipment, analysis)
    console.log(`[orchestrator:step3] ${compressed.length} → ${filtered.length} exercises (semantic)`)
  } catch {
    filtered = scoreAndFilterExercises(compressed, skeleton, availableEquipment, analysis)
    console.log(`[orchestrator:step3] ${compressed.length} → ${filtered.length} exercises (heuristic)`)
  }
  const exerciseLibrary = formatExerciseLibrary(filtered)

  // Build exercise relationship graph for intelligent selection
  const exerciseGraph = buildExerciseGraph(filtered)
  const graphContext = formatGraphContextForPrompt(exerciseGraph, filtered.map((e) => e.id), filtered)
  console.log(`[orchestrator:step3] Exercise graph: ${exerciseGraph.progressionChains.length} chains, ${exerciseGraph.antagonistPairs.size} antagonist pairs`)

  const agent3SystemTokens = estimateTokens(EXERCISE_SELECTOR_PROMPT)
  const agent3UserTokens = estimateTokens(exerciseLibrary) + estimateTokens(constraintsContext) + estimateTokens(JSON.stringify(skeleton))
  console.log(`[orchestrator:step3] Agent 3 token budget: ~${agent3SystemTokens + agent3UserTokens} input tokens`)

  // Agent 3 — Exercise Selector with validation retry loop
  let assignment: ExerciseAssignment | null = null
  let validation: ValidationResult | null = null
  let retries = 0
  let agent3TotalTokens = 0

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[orchestrator:step3] Agent 3 attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
    const agent3Start = Date.now()

    let feedbackSection = ""
    if (attempt > 0 && validation !== null) {
      const errorIssues = validation.issues.filter((i) => i.type === "error")
      feedbackSection = `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Issues to fix:\n${JSON.stringify(errorIssues)}\n\nPlease fix ALL errors and try again.`
    }

    const agent3UserMessage = `Program Skeleton:
${JSON.stringify(skeleton)}

Constraints:
${constraintsContext}

Exercise Library (${filtered.length} exercises, pre-filtered for relevance):
${exerciseLibrary}

${variationRulesText}

${graphContext}${feedbackSection}`

    try {
      const agent3Result: AgentCallResult<ExerciseAssignment> = await callAgent<ExerciseAssignment>(
        EXERCISE_SELECTOR_PROMPT,
        agent3UserMessage,
        exerciseAssignmentSchema,
        { maxTokens: 16384, cacheSystemPrompt: true }
      )
      agent3TotalTokens += agent3Result.tokens_used
      assignment = agent3Result.content
      console.log(`[orchestrator:step3] Agent 3 done in ${Date.now() - agent3Start}ms (${agent3Result.tokens_used} tokens, ${assignment.assignments.length} exercises)`)

      // Code-based validation
      validation = validateProgram(
        skeleton,
        assignment,
        analysis,
        compressed,
        availableEquipment,
        clientDifficulty,
        step3AssessmentCtx?.maxDifficultyScore
      )

      // Variation compliance validation
      const variationIssues = validateVariationCompliance(variationConstraints, assignment.assignments)
      if (variationIssues.length > 0) {
        validation.issues.push(...variationIssues)
        const variationErrors = variationIssues.filter((i) => i.type === "error")
        if (variationErrors.length > 0) {
          validation.pass = false
        }
        console.log(`[orchestrator:step3] Variation issues: ${variationErrors.length} errors, ${variationIssues.length - variationErrors.length} warnings`)
      }

      console.log(`[orchestrator:step3] Validation: pass=${validation.pass}, issues=${validation.issues.length}`)

      if (validation.pass) break

      const hasErrors = validation.issues.some((i) => i.type === "error")
      if (!hasErrors) break

      console.log(`[orchestrator:step3] Validation errors, retrying...`)
      retries++
    } catch (agentError) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Exercise selection failed after ${MAX_RETRIES + 1} attempts: ${agentError instanceof Error ? agentError.message : "Unknown error"}`
        )
      }
      retries++
    }
  }

  if (!assignment || !validation) {
    throw new Error("Failed to generate exercise assignments")
  }

  // Create program in database
  const programCategory = deriveProgramCategory(request.goals)
  const programDifficulty = mapDifficulty(clientDifficulty)

  const goalsLabel = request.goals
    .map((g) => g.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(" & ")
  const splitLabel = skeleton.split_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  const tokenUsage = {
    agent1: step1Data.agent1_tokens,
    agent2: step2Data.agent2_tokens,
    agent3: agent3TotalTokens,
    agent4: 0,
    total: step1Data.agent1_tokens + step2Data.agent2_tokens + agent3TotalTokens,
  }

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
    ai_generation_params: {
      request,
      analysis_summary: {
        split: analysis.recommended_split,
        periodization: analysis.recommended_periodization,
        training_age: analysis.training_age_category,
        constraints_count: analysis.exercise_constraints.length,
      },
      validation: {
        pass: validation.pass,
        warnings: validation.issues.filter((i) => i.type === "warning").length,
        errors: validation.issues.filter((i) => i.type === "error").length,
      },
      token_usage: tokenUsage,
    },
    is_active: true,
    created_by: requestedBy,
    price_cents: request.price_cents ?? null,
    target_user_id: request.target_user_id ?? null,
  })

  console.log(`[orchestrator:step3] Program created: ${program.id}`)

  // Insert exercises
  const slotLookup = new Map<string, { week_number: number; day_of_week: number; order_index: number }>()
  const slotDetailsLookup = new Map<string, {
    sets: number; reps: string; rest_seconds: number; rpe_target: number | null
    tempo: string | null; group_tag: string | null; technique: ExerciseSlot["technique"]
  }>()

  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      day.slots.forEach((slot, idx) => {
        slotLookup.set(slot.slot_id, {
          week_number: week.week_number,
          day_of_week: day.day_of_week,
          order_index: idx,
        })
        slotDetailsLookup.set(slot.slot_id, {
          sets: slot.sets,
          reps: slot.reps,
          rest_seconds: slot.rest_seconds,
          rpe_target: slot.rpe_target,
          tempo: slot.tempo,
          group_tag: slot.group_tag,
          technique: slot.technique ?? "straight_set",
        })
      })
    }
  }

  const insertPromises = assignment.assignments.map((assigned) => {
    const location = slotLookup.get(assigned.slot_id)
    const details = slotDetailsLookup.get(assigned.slot_id)
    if (!location || !details) {
      console.warn(`Slot ${assigned.slot_id} not found — skipping`)
      return Promise.resolve(null)
    }
    return addExerciseToProgram({
      program_id: program.id,
      exercise_id: assigned.exercise_id,
      day_of_week: location.day_of_week,
      week_number: location.week_number,
      order_index: location.order_index,
      sets: details.sets,
      reps: details.reps,
      duration_seconds: null,
      rest_seconds: details.rest_seconds,
      notes: assigned.notes,
      rpe_target: details.rpe_target,
      intensity_pct: null,
      tempo: details.tempo,
      group_tag: details.group_tag,
      technique: details.technique ?? "straight_set",
    })
  })

  await Promise.all(insertPromises)
  console.log(`[orchestrator:step3] ${assignment.assignments.length} exercises inserted`)

  // Auto-assign program to client (only when a client was selected)
  if (request.client_id) {
    try {
      await createAssignment({
        program_id: program.id,
        user_id: request.client_id,
        assigned_by: requestedBy,
        start_date: new Date().toISOString().split("T")[0],
        end_date: null,
        status: "active",
        notes: "Auto-assigned from AI program generation",
        current_week: 1,
        total_weeks: program.duration_weeks ?? null,
      })
      console.log(`[orchestrator:step3] Program auto-assigned to client ${request.client_id}`)
    } catch (assignError) {
      console.error("[orchestrator:step3] Failed to auto-assign:", assignError)
    }
  }

  // Update generation log to completed
  const totalDurationMs = Date.now() - new Date(log.created_at).getTime()

  await updateGenerationLog(logId, {
    program_id: program.id,
    status: "completed",
    current_step: 3,
    tokens_used: tokenUsage.total,
    duration_ms: totalDurationMs,
    completed_at: new Date().toISOString(),
    output_summary: {
      program_id: program.id,
      program_name: program.name,
      exercises_assigned: assignment.assignments.length,
      validation_pass: validation.pass,
      validation,
      token_usage: tokenUsage,
      warnings: validation.issues.filter((i) => i.type === "warning").length,
      retries,
    },
  })

  console.log(`[orchestrator:step3] Complete in ${Date.now() - stepStart}ms (total pipeline: ${totalDurationMs}ms)`)
}

// ─── Full Synchronous Pipeline (for dev mode) ──────────────────────────────

export async function generateProgramSync(
  request: AiGenerationRequest,
  requestedBy: string,
  assessmentContext?: AssessmentContext
): Promise<OrchestrationResult> {
  console.log("[orchestrator:sync] Starting generateProgramSync", {
    client_id: request.client_id ?? "none",
    goals: request.goals,
    duration_weeks: request.duration_weeks,
    sessions_per_week: request.sessions_per_week,
    tier: request.tier,
  })
  const startTime = Date.now()
  const tokenUsage = { agent1: 0, agent2: 0, agent3: 0, agent4: 0, total: 0 }
  let retries = 0

  const log = await createGenerationLog({
    program_id: null,
    client_id: request.client_id ?? null,
    requested_by: requestedBy,
    status: "generating",
    input_params: request as unknown as Record<string, unknown>,
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
  } as Omit<AiGenerationLog, "id" | "created_at">)
  console.log("[orchestrator:sync] Generation log created:", log.id)

  try {
    // Fetch client profile (skip if no client selected)
    let profile: Awaited<ReturnType<typeof getProfileByUserId>> = null
    let clientName = "General Client"
    if (request.client_id) {
      console.log("[orchestrator:sync] Fetching profile for client:", request.client_id)
      profile = await getProfileByUserId(request.client_id)
      console.log("[orchestrator:sync] Profile found:", !!profile)
      try {
        const user = await getUserById(request.client_id)
        clientName = `${user.first_name} ${user.last_name}`.trim()
      } catch {
        clientName = "Client"
      }
    }

    let age: number | null = null
    if (profile?.date_of_birth) {
      const birthYear = parseInt(profile.date_of_birth, 10)
      if (!isNaN(birthYear)) {
        age = new Date().getFullYear() - birthYear
      }
    }

    const profileContext = profile
      ? JSON.stringify({
          goals: profile.goals,
          sport: profile.sport,
          gender: profile.gender,
          age,
          date_of_birth: profile.date_of_birth,
          experience_level: profile.experience_level,
          movement_confidence: profile.movement_confidence,
          sleep_hours: profile.sleep_hours,
          stress_level: profile.stress_level,
          occupation_activity_level: profile.occupation_activity_level,
          training_years: profile.training_years,
          injuries: profile.injuries,
          injury_details: profile.injury_details,
          available_equipment: profile.available_equipment,
          preferred_session_minutes: profile.preferred_session_minutes,
          preferred_training_days: profile.preferred_training_days,
          preferred_day_names: profile.preferred_day_names,
          preferred_techniques: profile.preferred_techniques,
          time_efficiency_preference: profile.time_efficiency_preference,
          height_cm: profile.height_cm,
          weight_kg: profile.weight_kg,
          exercise_likes: profile.exercise_likes,
          exercise_dislikes: profile.exercise_dislikes,
          training_background: profile.training_background,
          additional_notes: profile.additional_notes,
        })
      : JSON.stringify({ note: "No profile found — use defaults for a general fitness client." })

    // Build assessment context section for the prompt (only when assessment-triggered)
    const assessmentSection = assessmentContext
      ? `\n\n## Client Assessment Results
Overall Level: ${assessmentContext.computedLevels.overall}
Squat Pattern: ${assessmentContext.computedLevels.squat}
Push Pattern: ${assessmentContext.computedLevels.push}
Pull Pattern: ${assessmentContext.computedLevels.pull}
Hinge Pattern: ${assessmentContext.computedLevels.hinge}
Maximum Exercise Difficulty: ${assessmentContext.maxDifficultyScore}/10

IMPORTANT: Only select exercises with difficulty_score <= ${assessmentContext.maxDifficultyScore}.
For patterns where the client is at beginner level, use foundational/beginner exercises (difficulty 1-4).
For intermediate patterns, use intermediate exercises (difficulty 4-7).
For advanced patterns, use advanced exercises (difficulty 7-9).`
      : ""

    const agent1UserMessage = `Client Profile:
${profileContext}

Training Request:
- Goals: ${request.goals.join(", ")}
- Duration: ${request.duration_weeks} weeks
- Sessions per week: ${request.sessions_per_week}
- Session length: ${request.session_minutes ?? 60} minutes
${request.split_type ? `- Requested split type: ${request.split_type}` : ""}
${request.periodization ? `- Requested periodization: ${request.periodization}` : ""}
${request.equipment_override ? `- Equipment override: ${request.equipment_override.join(", ")}` : ""}
${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ""}
${profile?.preferred_day_names?.length ? `- Preferred training days: ${profile.preferred_day_names.map((d: number) => ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ')}` : ''}
${profile?.time_efficiency_preference ? `- Time efficiency preference: ${profile.time_efficiency_preference}` : ''}
${profile?.preferred_techniques?.length ? `- Preferred techniques: ${profile.preferred_techniques.join(', ')}` : ''}
${age ? `- Client age: ${age}` : ''}
${profile?.sleep_hours ? `- Sleep: ${profile.sleep_hours}` : ''}
${profile?.stress_level ? `- Stress level: ${profile.stress_level}` : ''}
${profile?.occupation_activity_level ? `- Occupation activity: ${profile.occupation_activity_level}` : ''}
${profile?.movement_confidence ? `- Movement confidence: ${profile.movement_confidence}` : ''}
${profile?.exercise_likes ? `- Exercise likes: ${profile.exercise_likes}` : ''}
${profile?.exercise_dislikes ? `- Exercise dislikes: ${profile.exercise_dislikes}` : ''}
${profile?.training_background ? `- Training background: ${profile.training_background}` : ''}
${profile?.additional_notes ? `- Additional notes: ${profile.additional_notes}` : ''}${assessmentSection}`

    // RAG: retrieve similar past program generations for context
    const ragQuery = `${request.goals.join(", ")} ${request.duration_weeks}wk ${request.sessions_per_week}x/wk ${profile?.experience_level ?? "beginner"}`
    const ragResults = await retrieveSimilarContext(ragQuery, "program_generation", {
      threshold: 0.5,
      limit: 2,
    }).catch(() => [] as Awaited<ReturnType<typeof retrieveSimilarContext>>)
    const ragContext = formatRagContext(ragResults)
    const augmentedAgent1Prompt = ragContext
      ? buildRagAugmentedPrompt(PROFILE_ANALYZER_PROMPT, ragContext)
      : PROFILE_ANALYZER_PROMPT

    // Agent 1 + exercise fetch in parallel
    console.log("[orchestrator:sync] Running Agent 1 (profile analysis) + exercise fetch...")
    const [agent1Result, allExercises] = await Promise.all([
      callAgent<ProfileAnalysis>(
        augmentedAgent1Prompt,
        agent1UserMessage,
        profileAnalysisSchema,
        { model: MODEL_HAIKU, cacheSystemPrompt: true }
      ),
      getExercisesForAI(),
    ])
    tokenUsage.agent1 = agent1Result.tokens_used
    console.log("[orchestrator:sync] Agent 1 complete. Tokens:", agent1Result.tokens_used, "Exercises fetched:", allExercises.length)

    // Save agent 1 conversation (fire-and-forget)
    const genSessionId = `gen-${log.id}`
    saveConversationBatch([
      {
        user_id: requestedBy,
        feature: "program_generation" as const,
        session_id: genSessionId,
        role: "user" as const,
        content: agent1UserMessage,
        metadata: { step: 1, log_id: log.id, client_id: request.client_id },
        tokens_input: null,
        tokens_output: null,
        model_used: null,
      },
      {
        user_id: requestedBy,
        feature: "program_generation" as const,
        session_id: genSessionId,
        role: "assistant" as const,
        content: JSON.stringify(agent1Result.content),
        metadata: { step: 1, log_id: log.id, model: MODEL_HAIKU },
        tokens_input: null,
        tokens_output: agent1Result.tokens_used,
        model_used: MODEL_HAIKU,
      },
    ]).then((saved) => {
      const assistantMsg = saved.find((m) => m.role === "assistant")
      if (assistantMsg) embedConversationMessage(assistantMsg.id).catch(() => {})
    }).catch(() => {})

    const analysis = agent1Result.content
    // Apply difficulty score filter when assessment context is provided
    const allCompressed = compressExercises(allExercises)
    const compressed = assessmentContext
      ? filterByDifficultyScore(allCompressed, assessmentContext.maxDifficultyScore)
      : allCompressed
    console.log(`[orchestrator:sync] Exercises: ${allCompressed.length} total, ${compressed.length} after difficulty filter`)

    if (request.split_type) analysis.recommended_split = request.split_type
    if (request.periodization) analysis.recommended_periodization = request.periodization

    // Agent 2
    const agent2UserMessage = `Profile Analysis:
${JSON.stringify(analysis)}

Training Parameters:
- Duration: ${request.duration_weeks} weeks
- Sessions per week: ${request.sessions_per_week}
- Session length: ${request.session_minutes ?? 60} minutes
- Split type: ${analysis.recommended_split}
- Periodization: ${analysis.recommended_periodization}
- Goals: ${request.goals.join(", ")}
${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ""}`

    console.log("[orchestrator:sync] Running Agent 2 (program architect)...")
    const agent2Result = await callAgent<ProgramSkeleton>(
      PROGRAM_ARCHITECT_PROMPT,
      agent2UserMessage,
      programSkeletonSchema,
      { maxTokens: 16384, cacheSystemPrompt: true }
    )
    tokenUsage.agent2 = agent2Result.tokens_used
    let skeleton = agent2Result.content
    console.log("[orchestrator:sync] Agent 2 complete. Tokens:", agent2Result.tokens_used, "Weeks:", skeleton.weeks.length)

    // Apply push/pull balance corrections to skeleton
    const balanceReport = analyzePushPullBalance(skeleton, skeleton.split_type)
    if (!balanceReport.isBalanced && balanceReport.corrections.length > 0) {
      console.log(`[orchestrator:sync] Balance corrections: ${balanceReport.corrections.length}`)
      console.log(`[orchestrator:sync] ${formatBalanceReport(balanceReport)}`)
      skeleton = applyBalanceCorrections(skeleton, balanceReport.corrections)
    }

    // Build variation constraints for Agent 3
    const variationConstraints = buildVariationConstraints(skeleton)
    const variationRulesText = formatVariationRulesForPrompt(variationConstraints)
    console.log(`[orchestrator:sync] Variation: ${variationConstraints.groups.length} groups, ${variationConstraints.rules.length} rules`)

    // Save agent 2 conversation (fire-and-forget)
    saveConversationBatch([
      {
        user_id: requestedBy,
        feature: "program_generation" as const,
        session_id: genSessionId,
        role: "user" as const,
        content: agent2UserMessage,
        metadata: { step: 2, log_id: log.id },
        tokens_input: null,
        tokens_output: null,
        model_used: null,
      },
      {
        user_id: requestedBy,
        feature: "program_generation" as const,
        session_id: genSessionId,
        role: "assistant" as const,
        content: JSON.stringify(agent2Result.content),
        metadata: { step: 2, log_id: log.id },
        tokens_input: null,
        tokens_output: agent2Result.tokens_used,
        model_used: MODEL_SONNET,
      },
    ]).then((saved) => {
      const assistantMsg = saved.find((m) => m.role === "assistant")
      if (assistantMsg) embedConversationMessage(assistantMsg.id).catch(() => {})
    }).catch(() => {})

    // Pre-filter exercises
    const availableEquipment = request.equipment_override ?? profile?.available_equipment ?? []
    const constraintsContext = JSON.stringify({
      exercise_constraints: analysis.exercise_constraints,
      available_equipment: availableEquipment,
      client_difficulty: profile?.experience_level ?? "beginner",
    })

    let filtered: typeof compressed
    try {
      filtered = await semanticFilterExercises(compressed, skeleton, availableEquipment, analysis)
    } catch {
      filtered = scoreAndFilterExercises(compressed, skeleton, availableEquipment, analysis)
    }
    const exerciseLibrary = formatExerciseLibrary(filtered)

    // Build exercise relationship graph for intelligent selection
    const exerciseGraph = buildExerciseGraph(filtered)
    const graphContext = formatGraphContextForPrompt(exerciseGraph, filtered.map((e) => e.id), filtered)
    console.log(`[orchestrator:sync] Exercise graph: ${exerciseGraph.progressionChains.length} chains, ${exerciseGraph.antagonistPairs.size} antagonist pairs`)

    // Agent 3 with validation retry loop
    console.log("[orchestrator:sync] Running Agent 3 (exercise selection) with", filtered.length, "filtered exercises...")
    let assignment: ExerciseAssignment | null = null
    let validation: ValidationResult | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let feedbackSection = ""
      if (attempt > 0 && validation !== null) {
        const errorIssues = validation.issues.filter((i) => i.type === "error")
        feedbackSection = `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Issues to fix:\n${JSON.stringify(errorIssues)}\n\nPlease fix ALL errors and try again.`
      }

      const agent3UserMessage = `Program Skeleton:
${JSON.stringify(skeleton)}

Constraints:
${constraintsContext}

Exercise Library (${filtered.length} exercises, pre-filtered for relevance):
${exerciseLibrary}

${variationRulesText}

${graphContext}${feedbackSection}`

      try {
        console.log(`[orchestrator:sync] Agent 3 attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
        const agent3Result: AgentCallResult<ExerciseAssignment> = await callAgent<ExerciseAssignment>(
          EXERCISE_SELECTOR_PROMPT,
          agent3UserMessage,
          exerciseAssignmentSchema,
          { maxTokens: 16384, cacheSystemPrompt: true }
        )
        tokenUsage.agent3 += agent3Result.tokens_used
        assignment = agent3Result.content
        console.log("[orchestrator:sync] Agent 3 returned", assignment.assignments.length, "assignments. Validating...")

        validation = validateProgram(skeleton, assignment, analysis, compressed, availableEquipment, profile?.experience_level ?? "beginner", assessmentContext?.maxDifficultyScore)

        // Variation compliance validation
        const variationIssues = validateVariationCompliance(variationConstraints, assignment.assignments)
        if (variationIssues.length > 0) {
          validation.issues.push(...variationIssues)
          const variationErrors = variationIssues.filter((i) => i.type === "error")
          if (variationErrors.length > 0) {
            validation.pass = false
          }
          console.log(`[orchestrator:sync] Variation issues: ${variationErrors.length} errors, ${variationIssues.length - variationErrors.length} warnings`)
        }

        const errors = validation.issues.filter(i => i.type === "error")
        const warnings = validation.issues.filter(i => i.type === "warning")
        console.log("[orchestrator:sync] Validation result:", { pass: validation.pass, errors: errors.length, warnings: warnings.length })
        if (errors.length > 0) {
          console.log("[orchestrator:sync] Validation ERRORS:")
          errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.message}`))
        }
        if (warnings.length > 0) {
          console.log("[orchestrator:sync] Validation WARNINGS:")
          warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w.message}`))
        }

        if (validation.pass || !validation.issues.some((i) => i.type === "error")) break
        console.log("[orchestrator:sync] Retrying...")
        retries++
      } catch (agentError) {
        console.error(`[orchestrator:sync] Agent 3 attempt ${attempt + 1} error:`, agentError instanceof Error ? agentError.message : agentError)
        if (attempt === MAX_RETRIES) {
          throw new Error(`Exercise selection failed after ${MAX_RETRIES + 1} attempts: ${agentError instanceof Error ? agentError.message : "Unknown error"}`)
        }
        retries++
      }
    }

    if (!assignment || !validation) throw new Error("Failed to generate exercise assignments")

    // Create program
    console.log("[orchestrator:sync] Creating program in database...")
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
      target_user_id: request.target_user_id ?? null,
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

    const insertPromises = assignment.assignments.map((assigned) => {
      const location = slotLookup.get(assigned.slot_id)
      const details = slotDetailsLookup.get(assigned.slot_id)
      if (!location || !details) return Promise.resolve(null)
      return addExerciseToProgram({ program_id: program.id, exercise_id: assigned.exercise_id, day_of_week: location.day_of_week, week_number: location.week_number, order_index: location.order_index, sets: details.sets, reps: details.reps, duration_seconds: null, rest_seconds: details.rest_seconds, notes: assigned.notes, rpe_target: details.rpe_target, intensity_pct: null, tempo: details.tempo, group_tag: details.group_tag, technique: details.technique ?? "straight_set" })
    })

    await Promise.all(insertPromises)

    // Auto-assign (only when a client was selected)
    if (request.client_id) {
      try {
        await createAssignment({ program_id: program.id, user_id: request.client_id, assigned_by: requestedBy, start_date: new Date().toISOString().split("T")[0], end_date: null, status: "active", notes: "Auto-assigned from AI program generation", current_week: 1, total_weeks: program.duration_weeks ?? null })
      } catch (assignError) {
        console.error("[generate] Failed to auto-assign:", assignError)
      }
    }

    // Update log
    const durationMs = Date.now() - startTime
    tokenUsage.total = tokenUsage.agent1 + tokenUsage.agent2 + tokenUsage.agent3 + tokenUsage.agent4

    await updateGenerationLog(log.id, {
      program_id: program.id,
      status: "completed",
      tokens_used: tokenUsage.total,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      output_summary: { program_id: program.id, program_name: program.name, exercises_assigned: assignment.assignments.length, validation_pass: validation.pass, warnings: validation.issues.filter((i) => i.type === "warning").length, retries },
    })

    return { program_id: program.id, validation, token_usage: tokenUsage, duration_ms: durationMs, retries }
  } catch (error) {
    const durationMs = Date.now() - startTime
    tokenUsage.total = tokenUsage.agent1 + tokenUsage.agent2 + tokenUsage.agent3 + tokenUsage.agent4
    const errorMessage = error instanceof Error ? error.message : "Unknown error during program generation"

    console.error("[orchestrator:sync] PIPELINE FAILED after", Math.round(durationMs / 1000), "s")
    console.error("[orchestrator:sync] Error:", errorMessage)
    console.error("[orchestrator:sync] Token usage at failure:", tokenUsage)
    if (error instanceof Error && error.stack) {
      console.error("[orchestrator:sync] Stack:", error.stack)
    }

    await updateGenerationLog(log.id, {
      status: "failed",
      error_message: errorMessage,
      tokens_used: tokenUsage.total,
      duration_ms: durationMs,
    }).catch((logError) => {
      console.error("Failed to update generation log:", logError)
    })

    throw error
  }
}
