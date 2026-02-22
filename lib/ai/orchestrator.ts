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
import type { ProgramCategory, ProgramDifficulty } from "@/types/database"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import { scoreAndFilterExercises, semanticFilterExercises } from "@/lib/ai/exercise-filter"
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
import { compressExercises, formatExerciseLibrary } from "@/lib/ai/exercise-context"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getExercisesForAI } from "@/lib/db/exercises"
import { createProgram } from "@/lib/db/programs"
import { addExerciseToProgram } from "@/lib/db/program-exercises"
import {
  createGenerationLog,
  updateGenerationLog,
} from "@/lib/db/ai-generation-log"
import { getUserById } from "@/lib/db/users"

const MAX_RETRIES = 2

/**
 * Derive a program category from the client's goals.
 */
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

/**
 * Map experience level to program difficulty.
 */
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

/**
 * Main orchestration function: runs 4 AI agents in sequence to generate
 * a complete training program.
 */
export async function generateProgram(
  request: AiGenerationRequest,
  requestedBy: string
): Promise<OrchestrationResult> {
  const startTime = Date.now()
  const tokenUsage = { agent1: 0, agent2: 0, agent3: 0, agent4: 0, total: 0 }
  let retries = 0

  // Step 1: Create generation log entry
  const log = await createGenerationLog({
    program_id: null,
    client_id: request.client_id,
    requested_by: requestedBy,
    status: "generating",
    input_params: request as unknown as Record<string, unknown>,
    output_summary: null,
    error_message: null,
    model_used: "haiku+sonnet-mixed",
    tokens_used: null,
    duration_ms: null,
    completed_at: null,
  })

  try {
    // Step 2: Fetch client profile
    console.log("[orchestrator] Step 2: Fetching client profile...")
    const profile = await getProfileByUserId(request.client_id)
    let clientName = "Client"
    try {
      const user = await getUserById(request.client_id)
      clientName = `${user.first_name} ${user.last_name}`.trim()
    } catch {
      // Fall back to "Client" if user lookup fails
    }

    // Calculate age from date_of_birth if available
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

    // Step 3: Agent 1 — Profile Analyzer
    console.log("[orchestrator] Step 3: Agent 1 — Profile Analyzer starting...")
    const agent1Start = Date.now()
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
${profile?.additional_notes ? `- Additional notes: ${profile.additional_notes}` : ''}`

    const agent1Result = await callAgent<ProfileAnalysis>(
      PROFILE_ANALYZER_PROMPT,
      agent1UserMessage,
      profileAnalysisSchema,
      { model: MODEL_HAIKU, cacheSystemPrompt: true }
    )
    tokenUsage.agent1 = agent1Result.tokens_used

    const analysis = agent1Result.content
    console.log(`[orchestrator] Agent 1 done in ${Date.now() - agent1Start}ms (${agent1Result.tokens_used} tokens)`)

    // Apply overrides from request
    if (request.split_type) {
      analysis.recommended_split = request.split_type
    }
    if (request.periodization) {
      analysis.recommended_periodization = request.periodization
    }

    // Step 4: Agent 2 — Program Architect
    console.log("[orchestrator] Step 4: Agent 2 — Program Architect starting...")
    const agent2Start = Date.now()
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
    tokenUsage.agent2 = agent2Result.tokens_used

    const skeleton = agent2Result.content
    console.log(`[orchestrator] Agent 2 done in ${Date.now() - agent2Start}ms (${agent2Result.tokens_used} tokens)`)

    // Step 5: Fetch, compress, and pre-filter exercise library
    console.log("[orchestrator] Step 5: Fetching exercise library...")
    const allExercises = await getExercisesForAI()
    const compressed = compressExercises(allExercises)

    // Build equipment context
    const availableEquipment =
      request.equipment_override ??
      profile?.available_equipment ??
      []
    const constraintsContext = JSON.stringify({
      exercise_constraints: analysis.exercise_constraints,
      available_equipment: availableEquipment,
      client_difficulty: profile?.experience_level ?? "beginner",
    })

    // Pre-filter exercises to reduce Agent 3 context
    // Try semantic search first (pgvector), fall back to heuristic scoring
    let filtered: typeof compressed
    try {
      filtered = await semanticFilterExercises(compressed, skeleton, availableEquipment, analysis)
      console.log(`[orchestrator] Exercise library: ${compressed.length} total → ${filtered.length} after semantic filtering`)
    } catch {
      filtered = scoreAndFilterExercises(compressed, skeleton, availableEquipment, analysis)
      console.log(`[orchestrator] Exercise library: ${compressed.length} total → ${filtered.length} after heuristic filtering (semantic unavailable)`)
    }
    const exerciseLibrary = formatExerciseLibrary(filtered)

    // Token budget check before Agent 3
    const agent3SystemTokens = estimateTokens(EXERCISE_SELECTOR_PROMPT)
    const agent3UserTokens = estimateTokens(exerciseLibrary) + estimateTokens(constraintsContext) + estimateTokens(JSON.stringify(skeleton))
    console.log(`[orchestrator] Agent 3 token budget: ~${agent3SystemTokens + agent3UserTokens} estimated input tokens (system: ~${agent3SystemTokens}, user: ~${agent3UserTokens})`)

    // Step 6: Agent 3 — Exercise Selector (with code-based validation retry loop)
    let assignment: ExerciseAssignment | null = null
    let validation: ValidationResult | null = null
    let lastAgent3Error: string | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[orchestrator] Step 6: Agent 3 — Exercise Selector attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
      const agent3Start = Date.now()

      // Build feedback from previous validation if retrying
      let feedbackSection = ""
      if (attempt > 0 && validation !== null) {
        const errorIssues = validation.issues.filter((i) => i.type === "error")
        feedbackSection = `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Issues to fix:\n${JSON.stringify(errorIssues)}\n\nPlease fix ALL errors and try again.`
      }

      const agent3UserMessage: string = `Program Skeleton:
${JSON.stringify(skeleton)}

Constraints:
${constraintsContext}

Exercise Library (${filtered.length} exercises, pre-filtered for relevance):
${exerciseLibrary}${feedbackSection}`

      try {
        const agent3Result: AgentCallResult<ExerciseAssignment> = await callAgent<ExerciseAssignment>(
          EXERCISE_SELECTOR_PROMPT,
          agent3UserMessage,
          exerciseAssignmentSchema,
          { maxTokens: 16384, cacheSystemPrompt: true }
        )
        tokenUsage.agent3 += agent3Result.tokens_used
        assignment = agent3Result.content
        console.log(`[orchestrator] Agent 3 done in ${Date.now() - agent3Start}ms (${agent3Result.tokens_used} tokens, ${assignment.assignments.length} exercises assigned)`)

        // Step 7: Code-based validation (replaces AI Agent 4 — zero tokens)
        console.log("[orchestrator] Step 7: Code validation starting...")
        const validationStart = Date.now()
        validation = validateProgram(
          skeleton,
          assignment,
          analysis,
          compressed,
          availableEquipment,
          profile?.experience_level ?? "beginner"
        )
        console.log(`[orchestrator] Code validation done in ${Date.now() - validationStart}ms — pass: ${validation.pass}, issues: ${validation.issues.length}`)

        if (validation.pass) {
          console.log("[orchestrator] Validation passed!")
          break
        }

        // If validation failed with errors, retry Agent 3
        const hasErrors = validation.issues.some((i) => i.type === "error")
        if (!hasErrors) {
          console.log("[orchestrator] Validation has warnings only — acceptable")
          break
        }

        console.log(`[orchestrator] Validation failed with errors, will retry. Errors: ${validation.issues.filter((i) => i.type === "error").map((i) => i.message).join("; ")}`)
        retries++
        lastAgent3Error = validation.issues
          .filter((i) => i.type === "error")
          .map((i) => i.message)
          .join("; ")
      } catch (agentError) {
        lastAgent3Error =
          agentError instanceof Error ? agentError.message : "Unknown agent error"
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `Exercise selection/validation failed after ${MAX_RETRIES + 1} attempts: ${lastAgent3Error}`
          )
        }
        retries++
      }
    }

    if (!assignment || !validation) {
      throw new Error("Failed to generate exercise assignments")
    }

    // Step 8: Create the program in the database
    console.log("[orchestrator] Step 8: Saving program to database...")
    const programCategory = deriveProgramCategory(request.goals)
    const programDifficulty = mapDifficulty(profile?.experience_level ?? null)

    const goalsLabel = request.goals
      .map((g) => g.replace(/_/g, " "))
      .join(", ")

    const program = await createProgram({
      name: `AI: ${goalsLabel} for ${clientName}`,
      description: `AI-generated ${request.duration_weeks}-week ${programCategory} program targeting ${goalsLabel}. ${skeleton.notes}`,
      category: programCategory,
      difficulty: programDifficulty,
      duration_weeks: request.duration_weeks,
      sessions_per_week: request.sessions_per_week,
      split_type: skeleton.split_type,
      periodization: skeleton.periodization,
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
      price_cents: null,
    })

    console.log(`[orchestrator] Program created: ${program.id} — "${program.name}"`)

    // Step 9: Add exercises to the program
    // Build a lookup: slot_id -> (week_number, day_of_week, order_index)
    const slotLookup = new Map<
      string,
      { week_number: number; day_of_week: number; order_index: number }
    >()

    for (const week of skeleton.weeks) {
      for (const day of week.days) {
        day.slots.forEach((slot, idx) => {
          slotLookup.set(slot.slot_id, {
            week_number: week.week_number,
            day_of_week: day.day_of_week,
            order_index: idx,
          })
        })
      }
    }

    // Also build a slot details lookup for sets/reps/rest/rpe/tempo/group_tag/technique
    const slotDetailsLookup = new Map<
      string,
      {
        sets: number
        reps: string
        rest_seconds: number
        rpe_target: number | null
        tempo: string | null
        group_tag: string | null
        technique: ExerciseSlot["technique"]
      }
    >()

    for (const week of skeleton.weeks) {
      for (const day of week.days) {
        for (const slot of day.slots) {
          slotDetailsLookup.set(slot.slot_id, {
            sets: slot.sets,
            reps: slot.reps,
            rest_seconds: slot.rest_seconds,
            rpe_target: slot.rpe_target,
            tempo: slot.tempo,
            group_tag: slot.group_tag,
            technique: slot.technique ?? "straight_set",
          })
        }
      }
    }

    // Insert all exercises
    const insertPromises = assignment.assignments.map((assigned) => {
      const location = slotLookup.get(assigned.slot_id)
      const details = slotDetailsLookup.get(assigned.slot_id)

      if (!location || !details) {
        console.warn(`Slot ${assigned.slot_id} not found in skeleton — skipping`)
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
    console.log(`[orchestrator] ${assignment.assignments.length} exercises inserted into program`)

    // Step 10: Update generation log
    const durationMs = Date.now() - startTime
    tokenUsage.total =
      tokenUsage.agent1 + tokenUsage.agent2 + tokenUsage.agent3 + tokenUsage.agent4

    await updateGenerationLog(log.id, {
      program_id: program.id,
      status: "completed",
      tokens_used: tokenUsage.total,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      output_summary: {
        program_id: program.id,
        program_name: program.name,
        exercises_assigned: assignment.assignments.length,
        validation_pass: validation.pass,
        warnings: validation.issues.filter((i) => i.type === "warning").length,
        retries,
      },
    })

    return {
      program_id: program.id,
      validation,
      token_usage: tokenUsage,
      duration_ms: durationMs,
      retries,
    }
  } catch (error) {
    // Update log with failure
    const durationMs = Date.now() - startTime
    tokenUsage.total =
      tokenUsage.agent1 + tokenUsage.agent2 + tokenUsage.agent3 + tokenUsage.agent4

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during program generation"

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
