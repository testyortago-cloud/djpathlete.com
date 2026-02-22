import type { AiGenerationRequest } from "@/lib/validators/ai-generation"
import type {
  ProfileAnalysis,
  ProgramSkeleton,
  ExerciseAssignment,
  SessionPlan,
  SessionContext,
  ValidationResult,
  OrchestrationResult,
} from "@/lib/ai/types"
import type { ProgramCategory, ProgramDifficulty } from "@/types/database"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import {
  profileAnalysisSchema,
  sessionPlanSchema,
} from "@/lib/ai/schemas"
import {
  PROFILE_ANALYZER_PROMPT,
  SESSION_PLANNER_PROMPT,
} from "@/lib/ai/prompts"
import { buildProgramPlan } from "@/lib/ai/program-plan"
import { validateProgram } from "@/lib/ai/validate"
import { compressExercises, formatExerciseLibrary } from "@/lib/ai/exercise-context"
import type { CompressedExercise } from "@/lib/ai/exercise-context"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getExercisesForAI } from "@/lib/db/exercises"
import { createProgram } from "@/lib/db/programs"
import { addExerciseToProgram } from "@/lib/db/program-exercises"
import {
  createGenerationLog,
  updateGenerationLog,
} from "@/lib/db/ai-generation-log"
import { getUserById } from "@/lib/db/users"

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
 * Pre-filter exercises for a specific session based on its focus muscles.
 * Returns a smaller, more relevant subset for the per-session agent.
 */
function filterExercisesForSession(
  exercises: CompressedExercise[],
  ctx: SessionContext,
  equipment: string[],
  difficulty: string
): CompressedExercise[] {
  // Extract focus muscles from the session context
  const focusLower = ctx.focus.toLowerCase()

  // Score exercises by relevance to this session's focus
  const scored = exercises.map((ex) => {
    let score = 0

    // Check if exercise muscles overlap with session focus text
    for (const m of ex.primary_muscles) {
      if (focusLower.includes(m.toLowerCase())) score += 30
    }
    for (const m of ex.secondary_muscles) {
      if (focusLower.includes(m.toLowerCase())) score += 10
    }

    // Equipment availability
    const equipmentSet = new Set(equipment.map((e) => e.toLowerCase()))
    if (ex.is_bodyweight) {
      score += 15
    } else if (
      ex.equipment_required.length === 0 ||
      ex.equipment_required.every((eq) => equipmentSet.has(eq.toLowerCase()))
    ) {
      score += 15
    }

    // Difficulty match
    const difficultyOrder = ["beginner", "intermediate", "advanced"]
    const clientIdx = difficultyOrder.indexOf(difficulty)
    const exerciseIdx = difficultyOrder.indexOf(ex.difficulty)
    if (clientIdx >= 0 && exerciseIdx >= 0) {
      if (exerciseIdx === clientIdx) score += 10
      else if (Math.abs(exerciseIdx - clientIdx) === 1) score += 5
    }

    // Warm-up/cool-down sessions need bodyweight and simple exercises
    if (ex.is_bodyweight) score += 5

    return { exercise: ex, score }
  })

  // Sort by score, take top 30 (enough variety without bloating context)
  scored.sort((a, b) => b.score - a.score)
  const filtered = scored.slice(0, 30).map((s) => s.exercise)

  // Safety: if too few relevant exercises, return all
  if (filtered.length < 10) return exercises

  return filtered
}

/**
 * Reconstruct ProgramSkeleton + ExerciseAssignment from per-session results
 * for compatibility with existing validation and DB insertion logic.
 */
function reconstructFromSessionPlans(
  sessions: Array<{ ctx: SessionContext; plan: SessionPlan }>,
  analysis: ProfileAnalysis,
): { skeleton: ProgramSkeleton; assignment: ExerciseAssignment } {
  // Group sessions by week
  const weekMap = new Map<number, {
    phase: string
    intensity_modifier: string
    days: Array<{ ctx: SessionContext; plan: SessionPlan }>
  }>()

  for (const s of sessions) {
    if (!weekMap.has(s.ctx.week_number)) {
      weekMap.set(s.ctx.week_number, {
        phase: s.ctx.phase,
        intensity_modifier: s.ctx.intensity_modifier,
        days: [],
      })
    }
    weekMap.get(s.ctx.week_number)!.days.push(s)
  }

  const weeks = [...weekMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekNum, data]) => ({
      week_number: weekNum,
      phase: data.phase,
      intensity_modifier: data.intensity_modifier,
      days: data.days
        .sort((a, b) => a.ctx.day_of_week - b.ctx.day_of_week)
        .map((d) => ({
          day_of_week: d.ctx.day_of_week,
          label: d.plan.label,
          focus: d.plan.focus,
          slots: d.plan.slots.map((slot) => ({
            slot_id: slot.slot_id,
            role: slot.role,
            movement_pattern: slot.movement_pattern,
            target_muscles: slot.target_muscles,
            sets: slot.sets,
            reps: slot.reps,
            rest_seconds: slot.rest_seconds,
            rpe_target: slot.rpe_target,
            tempo: slot.tempo,
            group_tag: slot.group_tag,
            technique: slot.technique ?? "straight_set" as const,
          })),
        })),
    }))

  const skeleton: ProgramSkeleton = {
    weeks,
    split_type: analysis.recommended_split,
    periodization: analysis.recommended_periodization,
    total_sessions: sessions.length,
    notes: "Generated via per-session parallel pipeline.",
  }

  const assignments = sessions.flatMap((s) =>
    s.plan.slots.map((slot) => ({
      slot_id: slot.slot_id,
      exercise_id: slot.exercise_id,
      exercise_name: slot.exercise_name,
      notes: slot.notes,
    }))
  )

  const assignment: ExerciseAssignment = {
    assignments,
    substitution_notes: [],
  }

  return { skeleton, assignment }
}

/**
 * Main orchestration function: runs per-session AI agents in parallel
 * to generate a complete training program.
 *
 * Pipeline:
 *   Agent 1 (Haiku) ∥ exercise fetch
 *     → build program plan (code, ~0ms)
 *       → per-session agents (Sonnet, all parallel)
 *         → code validation → DB writes
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
    model_used: "haiku+sonnet-per-session",
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

    // Step 3: Agent 1 — Profile Analyzer (run in parallel with exercise library fetch)
    console.log("[orchestrator] Step 3: Agent 1 + exercise fetch starting in parallel...")
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

    // Run Agent 1 and exercise library fetch concurrently — they are independent
    const [agent1Result, allExercises] = await Promise.all([
      callAgent<ProfileAnalysis>(
        PROFILE_ANALYZER_PROMPT,
        agent1UserMessage,
        profileAnalysisSchema,
        { model: MODEL_HAIKU, cacheSystemPrompt: true }
      ),
      getExercisesForAI(),
    ])
    tokenUsage.agent1 = agent1Result.tokens_used

    const analysis = agent1Result.content
    const compressed = compressExercises(allExercises)
    console.log(`[orchestrator] Agent 1 done in ${Date.now() - agent1Start}ms (${agent1Result.tokens_used} tokens)`)
    console.log(`[orchestrator] Exercise library fetched: ${allExercises.length} exercises, ${compressed.length} compressed`)

    // Apply overrides from request
    if (request.split_type) {
      analysis.recommended_split = request.split_type
    }
    if (request.periodization) {
      analysis.recommended_periodization = request.periodization
    }

    // Step 4: Build program plan (code-based, ~0ms)
    console.log("[orchestrator] Step 4: Building program plan...")
    const availableEquipment =
      request.equipment_override ??
      profile?.available_equipment ??
      []
    const clientDifficulty = profile?.experience_level ?? "beginner"

    const sessionContexts = buildProgramPlan(
      analysis,
      request,
      profile?.preferred_day_names,
    )
    console.log(`[orchestrator] Program plan: ${sessionContexts.length} sessions across ${request.duration_weeks} weeks`)

    // Step 5: Per-session agents (Sonnet, all parallel)
    console.log(`[orchestrator] Step 5: Launching ${sessionContexts.length} per-session agents in parallel...`)
    const sessionStart = Date.now()

    // Shared context for all session agents
    const sharedContext = `Profile Analysis:
${JSON.stringify(analysis)}

Client Context:
- Experience level: ${clientDifficulty}
- Movement confidence: ${profile?.movement_confidence ?? "comfortable"}
- Goals: ${request.goals.join(", ")}
- Session length: ${request.session_minutes ?? 60} minutes
${profile?.preferred_techniques?.length ? `- Preferred techniques: ${profile.preferred_techniques.join(', ')}` : ''}
${profile?.time_efficiency_preference ? `- Time efficiency preference: ${profile.time_efficiency_preference}` : ''}
${request.additional_instructions ? `- Additional instructions: ${request.additional_instructions}` : ''}

Constraints:
${JSON.stringify({
  exercise_constraints: analysis.exercise_constraints,
  available_equipment: availableEquipment,
})}`

    const sessionPromises = sessionContexts.map((ctx) => {
      // Pre-filter exercises for this session's focus
      const sessionExercises = filterExercisesForSession(
        compressed,
        ctx,
        availableEquipment,
        clientDifficulty
      )

      const userMessage = `${sharedContext}

Session Context:
- Week ${ctx.week_number} of ${request.duration_weeks}
- Day of week: ${ctx.day_of_week} (${['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][ctx.day_of_week]})
- Phase: ${ctx.phase}
- Intensity: ${ctx.intensity_modifier}
- Label: ${ctx.label}
- Focus: ${ctx.focus}
- slot_prefix: ${ctx.slot_prefix} (use this for slot_id format: ${ctx.slot_prefix}s1, ${ctx.slot_prefix}s2, etc.)

Exercise Library (${sessionExercises.length} exercises, pre-filtered for this session):
${formatExerciseLibrary(sessionExercises)}`

      return callAgent<SessionPlan>(
        SESSION_PLANNER_PROMPT,
        userMessage,
        sessionPlanSchema,
        { maxTokens: 4096, cacheSystemPrompt: true }
      ).then((result) => ({
        ctx,
        plan: result.content,
        tokens: result.tokens_used,
      }))
    })

    const sessionResults = await Promise.all(sessionPromises)

    let sessionTokens = 0
    for (const r of sessionResults) {
      sessionTokens += r.tokens
    }
    // Track combined session agent tokens under agent2 (skeleton) + agent3 (exercises)
    tokenUsage.agent2 = Math.round(sessionTokens / 2)
    tokenUsage.agent3 = sessionTokens - tokenUsage.agent2

    const totalSlots = sessionResults.reduce((sum, r) => sum + r.plan.slots.length, 0)
    console.log(`[orchestrator] All ${sessionResults.length} sessions done in ${Date.now() - sessionStart}ms (${sessionTokens} tokens, ${totalSlots} total slots)`)

    // Step 6: Reconstruct skeleton + assignment for validation
    console.log("[orchestrator] Step 6: Reconstructing program structure...")
    const { skeleton, assignment } = reconstructFromSessionPlans(
      sessionResults.map((r) => ({ ctx: r.ctx, plan: r.plan })),
      analysis,
    )

    // Step 7: Code-based validation
    console.log("[orchestrator] Step 7: Code validation starting...")
    const validationStart = Date.now()
    const validation = validateProgram(
      skeleton,
      assignment,
      analysis,
      compressed,
      availableEquipment,
      clientDifficulty
    )
    console.log(`[orchestrator] Code validation done in ${Date.now() - validationStart}ms — pass: ${validation.pass}, issues: ${validation.issues.length}`)

    if (!validation.pass) {
      const errors = validation.issues.filter((i) => i.type === "error")
      console.log(`[orchestrator] Validation errors: ${errors.map((e) => e.message).join("; ")}`)
    }

    // Step 8: Create the program in the database
    console.log("[orchestrator] Step 8: Saving program to database...")
    const programCategory = deriveProgramCategory(request.goals)
    const programDifficulty = mapDifficulty(clientDifficulty)

    const goalsLabel = request.goals
      .map((g) =>
        g
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      )
      .join(" & ")

    const splitLabel = analysis.recommended_split.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

    const program = await createProgram({
      name: `${clientName}'s ${request.duration_weeks}-Week ${goalsLabel} Program`,
      description: `A ${request.duration_weeks}-week ${splitLabel.toLowerCase()} program designed for ${goalsLabel.toLowerCase()}, training ${request.sessions_per_week}x per week.`,
      category: [programCategory],
      difficulty: programDifficulty,
      duration_weeks: request.duration_weeks,
      sessions_per_week: request.sessions_per_week,
      split_type: analysis.recommended_split,
      periodization: analysis.recommended_periodization,
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
      price_cents: null,
    })

    console.log(`[orchestrator] Program created: ${program.id} — "${program.name}"`)

    // Step 9: Add exercises to the program
    const insertPromises = sessionResults.flatMap((r) =>
      r.plan.slots.map((slot, idx) =>
        addExerciseToProgram({
          program_id: program.id,
          exercise_id: slot.exercise_id,
          day_of_week: r.ctx.day_of_week,
          week_number: r.ctx.week_number,
          order_index: idx,
          sets: slot.sets,
          reps: slot.reps,
          duration_seconds: null,
          rest_seconds: slot.rest_seconds,
          notes: slot.notes,
          rpe_target: slot.rpe_target,
          intensity_pct: null,
          tempo: slot.tempo,
          group_tag: slot.group_tag,
          technique: slot.technique ?? "straight_set",
        })
      )
    )

    await Promise.all(insertPromises)
    console.log(`[orchestrator] ${insertPromises.length} exercises inserted into program`)

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
        exercises_assigned: insertPromises.length,
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
