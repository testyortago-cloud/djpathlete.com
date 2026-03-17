import type {
  CompressedExercise,
  ExerciseSlot,
  ProgramWeek,
  ExerciseAssignment,
  ValidationResult,
} from "./types.js"
import { callAgent, MODEL_SONNET } from "./anthropic.js"
import { scoreAndFilterExercises, semanticFilterExercises } from "./exercise-filter.js"
import { programSkeletonSchema, exerciseAssignmentSchema } from "./schemas.js"
import { EXERCISE_SELECTOR_PROMPT } from "./prompts.js"
import { validateProgram } from "./validate.js"
import { formatExerciseLibrary } from "./exercise-context.js"
import { getExercisesForAI } from "./program-chat-tools.js"
import { getSupabase } from "../lib/supabase.js"
import { z } from "zod"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WeekGenerationRequest {
  program_id: string
  assignment_id: string
  client_id: string
  admin_instructions?: string
}

export interface WeekGenerationResult {
  new_week_number: number
  exercises_added: number
  token_usage: { architect: number; selector: number; total: number }
  duration_ms: number
}

// ─── Supabase helpers ───────────────────────────────────────────────────────

async function getProgramById(id: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from("programs").select("*").eq("id", id).single()
  if (error) throw new Error(`Program not found: ${error.message}`)
  return data
}

async function getProgramExercises(programId: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("program_exercises")
    .select("*, exercises(name, movement_pattern, primary_muscles, equipment_required)")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_of_week", { ascending: true })
    .order("order_index", { ascending: true })
  if (error) throw new Error(`Failed to fetch program exercises: ${error.message}`)
  return data ?? []
}

async function getClientProfile(userId: string) {
  const supabase = getSupabase()
  const { data } = await supabase.from("client_profiles").select("*").eq("user_id", userId).single()
  return data
}

async function getClientName(userId: string): Promise<string> {
  const supabase = getSupabase()
  const { data } = await supabase.from("users").select("first_name, last_name").eq("id", userId).single()
  return data ? `${data.first_name} ${data.last_name}`.trim() : "Client"
}

async function getRecentProgress(userId: string, exerciseIds: string[], limit = 50) {
  if (exerciseIds.length === 0) return []
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("exercise_progress")
    .select("*, exercises(name)")
    .eq("user_id", userId)
    .in("exercise_id", exerciseIds)
    .order("completed_at", { ascending: false })
    .limit(limit)
  if (error) return []
  return data ?? []
}

async function addExerciseToProgram(params: Record<string, unknown>, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const supabase = getSupabase()
    const { error } = await supabase.from("program_exercises").insert(params)
    if (!error) return
    if (attempt === retries) throw new Error(`Failed to add exercise: ${error.message}`)
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

async function updateProgramDuration(programId: string, newDuration: number) {
  const supabase = getSupabase()
  const { error } = await supabase
    .from("programs")
    .update({ duration_weeks: newDuration })
    .eq("id", programId)
  if (error) throw new Error(`Failed to update program duration: ${error.message}`)
}

async function updateAssignmentTotalWeeks(assignmentId: string, newTotal: number) {
  const supabase = getSupabase()
  const { error } = await supabase
    .from("program_assignments")
    .update({ total_weeks: newTotal })
    .eq("id", assignmentId)
  if (error) console.warn(`[week-orchestrator] Failed to update assignment total_weeks: ${error.message}`)
}

// ─── Week Architect Prompt ──────────────────────────────────────────────────

const WEEK_ARCHITECT_PROMPT = `You are a performance system architect designing the NEXT WEEK of an ongoing training program. You have access to the full program history (week-by-week progression summary + detailed recent weeks) and the client's actual training logs.

Your job is to design ONE week that:
1. Follows the program's established split, periodization, and structure
2. Progresses appropriately based on the client's actual performance data
3. Maintains exercise continuity for compound lifts while rotating accessories
4. Respects the admin coach's specific instructions (if provided)
5. Builds on the program's progression arc — review the full week-by-week summary to understand themes, muscle emphasis shifts, and training phases across the entire program history

Given the program context, client progress data, and coach instructions, output a JSON object with this structure — it MUST contain exactly ONE week in the "weeks" array:

{
  "weeks": [
    {
      "week_number": number (the next week number),
      "phase": string (e.g., "Hypertrophy", "Strength", "Deload"),
      "intensity_modifier": string (e.g., "moderate", "high", "low/deload"),
      "days": [
        {
          "day_of_week": number (1=Monday, 7=Sunday),
          "label": string,
          "focus": string,
          "slots": [
            {
              "slot_id": string (unique, format "w{week}d{day}s{slot}"),
              "role": "warm_up" | "primary_compound" | "secondary_compound" | "accessory" | "isolation" | "cool_down",
              "movement_pattern": "push" | "pull" | "squat" | "hinge" | "lunge" | "carry" | "rotation" | "isometric" | "locomotion",
              "target_muscles": [string],
              "sets": number,
              "reps": string,
              "rest_seconds": number,
              "rpe_target": number | null,
              "tempo": string | null,
              "group_tag": string | null,
              "technique": "straight_set" | "superset" | "dropset" | "giant_set" | "circuit" | "rest_pause" | "amrap"
            }
          ]
        }
      ]
    }
  ],
  "split_type": string (must match the program's existing split),
  "periodization": string (must match the program's existing periodization),
  "total_sessions": number (number of days in THIS week only),
  "notes": string (rationale for this week's design)
}

Rules:
1. MATCH the existing program structure: same split type, same number of training days per week, same day_of_week values.
2. PROGRESS appropriately based on the client's logged performance:
   - If the client hit their targets comfortably (RPE < prescribed), increase load or volume slightly.
   - If the client struggled (RPE higher than prescribed, missed reps), maintain or slightly reduce.
   - If it's time for a deload (typically every 3-4 weeks of hard training), reduce volume by 40-50%.
3. Keep PRIMARY and SECONDARY COMPOUND slots consistent with previous weeks (same movement pattern and target muscles) for progressive overload tracking.
4. ROTATE ACCESSORY and ISOLATION slots — use different movement patterns or target muscles than the immediately preceding 2 weeks.
5. Respect the coach's instructions — they override default progression logic. The coach may specify:
   - A THEME or FOCUS AREA (e.g., "lower leg focus", "glute emphasis", "no equipment this week")
   - A SHIFT in emphasis while maintaining a theme (e.g., "keep lower leg theme but add glutes")
   - Equipment constraints for this specific week (e.g., "bodyweight only", "bands only")
   When a theme is specified, bias slot target_muscles and movement_patterns toward that theme while still maintaining a balanced program.
6. Session time budget: keep the same number of exercises per day as previous weeks unless the coach says otherwise.
7. Use the same slot_id format: "w{week_number}d{day_of_week}s{slot_index}".
8. Review the FULL PROGRAM PROGRESSION summary — understand the arc of the entire program (what muscles were emphasized each week, how themes evolved) before designing this week.
9. Output ONLY the JSON object, no additional text.`

// ─── Single-week skeleton schema (reuses programSkeletonSchema) ─────────────

const weekSkeletonSchema = programSkeletonSchema

// ─── Week Focus Summary Builder ─────────────────────────────────────────────

/**
 * Builds a compact summary of each week's focus: primary muscles hit,
 * movement patterns used, and exercise count. This gives the AI full
 * progression context without sending every exercise detail for every week.
 */
function buildWeekFocusSummary(
  exercises: Record<string, unknown>[]
): { week: number; days: number; exercises: number; primary_muscles: string[]; movement_patterns: string[]; exercise_names: string[] }[] {
  const weekMap = new Map<number, {
    days: Set<number>
    muscles: Map<string, number>
    patterns: Map<string, number>
    names: string[]
  }>()

  for (const pe of exercises) {
    const week = pe.week_number as number
    if (!weekMap.has(week)) {
      weekMap.set(week, { days: new Set(), muscles: new Map(), patterns: new Map(), names: [] })
    }
    const w = weekMap.get(week)!
    w.days.add(pe.day_of_week as number)

    const ex = pe.exercises as { name?: string; movement_pattern?: string; primary_muscles?: string[] } | undefined
    if (ex?.name) w.names.push(ex.name)
    if (ex?.movement_pattern) {
      w.patterns.set(ex.movement_pattern, (w.patterns.get(ex.movement_pattern) ?? 0) + 1)
    }
    if (ex?.primary_muscles) {
      for (const m of ex.primary_muscles) {
        w.muscles.set(m, (w.muscles.get(m) ?? 0) + 1)
      }
    }
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([week, data]) => ({
      week,
      days: data.days.size,
      exercises: data.names.length,
      primary_muscles: Array.from(data.muscles.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([m]) => m),
      movement_patterns: Array.from(data.patterns.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([p]) => p),
      exercise_names: data.names,
    }))
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export async function generateWeekSync(
  request: WeekGenerationRequest,
  requestedBy: string,
  firebaseJobId?: string
): Promise<WeekGenerationResult> {
  console.log("[week-orchestrator] Starting generateWeekSync", {
    program_id: request.program_id,
    client_id: request.client_id,
    assignment_id: request.assignment_id,
  })

  const startTime = Date.now()
  const tokenUsage = { architect: 0, selector: 0, total: 0 }

  // Helper for RTDB progress
  async function updateJobProgress(step: string, currentStep: number, detail?: string) {
    if (!firebaseJobId) return
    try {
      const { getDatabase } = await import("firebase-admin/database")
      const rtdb = getDatabase()
      await rtdb.ref(`ai_jobs/${firebaseJobId}`).update({
        progress: { status: step, current_step: currentStep, total_steps: 5, detail: detail ?? null },
        updatedAt: Date.now(),
      })
    } catch (e) {
      console.warn("[week-orchestrator] Failed to update RTDB progress:", e)
    }
  }

  // Check cancellation
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

  // ── Step 1: Fetch program context ──────────────────────────────────────

  await updateJobProgress("fetching_context", 1, "Loading program data & client logs")

  const [program, existingExercises, profile, clientName, allExercises] = await Promise.all([
    getProgramById(request.program_id),
    getProgramExercises(request.program_id),
    getClientProfile(request.client_id),
    getClientName(request.client_id),
    getExercisesForAI(),
  ])

  const newWeekNumber = (program.duration_weeks ?? 1) + 1

  // Get unique exercise IDs from the program for progress lookup
  const programExerciseIds = [...new Set(existingExercises.map((pe: { exercise_id: string }) => pe.exercise_id))]
  const recentProgress = await getRecentProgress(request.client_id, programExerciseIds)

  // Build compact summary of ALL weeks (focus/theme only) for full progression context
  const weekFocusSummary = buildWeekFocusSummary(existingExercises)

  // Detailed exercises from last 3 weeks for structure matching
  const recentWeeksDetailed = existingExercises.filter(
    (pe: { week_number: number }) => pe.week_number >= Math.max(1, (program.duration_weeks ?? 1) - 2)
  )

  // Keep lastTwoWeeks alias for exercise rotation logic below
  const lastTwoWeeks = recentWeeksDetailed

  const programSummary = {
    name: program.name,
    split_type: program.split_type,
    periodization: program.periodization,
    duration_weeks: program.duration_weeks,
    sessions_per_week: program.sessions_per_week,
    difficulty: program.difficulty,
    category: program.category,
  }

  // Format recent weeks as detailed structure
  const weekStructure = recentWeeksDetailed.map((pe: Record<string, unknown>) => ({
    week: pe.week_number,
    day: pe.day_of_week,
    order: pe.order_index,
    exercise: (pe.exercises as { name?: string })?.name ?? "Unknown",
    exercise_id: pe.exercise_id,
    sets: pe.sets,
    reps: pe.reps,
    rpe: pe.rpe_target,
    tempo: pe.tempo,
    technique: pe.technique,
    group_tag: pe.group_tag,
    rest: pe.rest_seconds,
  }))

  // Format progress data
  const progressSummary = recentProgress.slice(0, 30).map((p: Record<string, unknown>) => ({
    exercise: (p.exercises as { name?: string })?.name ?? "Unknown",
    exercise_id: p.exercise_id,
    sets_completed: p.sets_completed,
    reps_completed: p.reps_completed,
    weight_kg: p.weight_kg,
    rpe: p.rpe,
    date: p.completed_at,
  }))

  const profileContext = profile
    ? JSON.stringify({
        goals: profile.goals, experience_level: profile.experience_level,
        injuries: profile.injuries, injury_details: profile.injury_details,
        available_equipment: profile.available_equipment,
        preferred_session_minutes: profile.preferred_session_minutes,
        preferred_training_days: profile.preferred_training_days,
        preferred_techniques: profile.preferred_techniques,
        sleep_hours: profile.sleep_hours, stress_level: profile.stress_level,
      })
    : "No profile available"

  await updateJobProgress("context_loaded", 2, `${existingExercises.length} exercises, ${recentProgress.length} logs loaded`)

  if (await checkCancelled()) {
    return { new_week_number: newWeekNumber, exercises_added: 0, token_usage: tokenUsage, duration_ms: Date.now() - startTime }
  }

  // ── Step 2: Agent 1 — Week Architect ───────────────────────────────────

  await updateJobProgress("designing_week", 3, `Designing Week ${newWeekNumber}`)

  const architectMessage = `## Program Overview
${JSON.stringify(programSummary)}

## Full Program Progression (week-by-week summary)
${weekFocusSummary.length > 0 ? JSON.stringify(weekFocusSummary) : "No previous weeks — this is Week 1."}

## Detailed Recent Weeks (last ${Math.min(3, program.duration_weeks ?? 1)} weeks — exercises, sets, reps)
${JSON.stringify(weekStructure)}

## Client Profile
${profileContext}

## Client's Recent Performance Logs
${progressSummary.length > 0 ? JSON.stringify(progressSummary) : "No logs yet — client has not started training."}

## New Week Number
${newWeekNumber}

## Coach Instructions
${request.admin_instructions || "No specific instructions — use standard progression logic based on the client's performance data."}

Design Week ${newWeekNumber} for this program. The week MUST have week_number=${newWeekNumber}. Match the existing program's split (${program.split_type}), periodization (${program.periodization}), and training days.

IMPORTANT: Review the full program progression summary above. If the coach's instructions reference themes, focus areas, or progressions from previous weeks, ensure this week builds on that trajectory logically. The coach may ask to maintain a theme while shifting emphasis (e.g., "keep lower leg focus but add glute work") — honor this by blending continuity with the new direction.`

  const architectResult = await callAgent<z.infer<typeof weekSkeletonSchema>>(
    WEEK_ARCHITECT_PROMPT,
    architectMessage,
    weekSkeletonSchema,
    { maxTokens: 8192, cacheSystemPrompt: true }
  )
  tokenUsage.architect = architectResult.tokens_used
  const skeleton = architectResult.content

  // Ensure the week number is correct
  if (skeleton.weeks.length > 0) {
    skeleton.weeks[0].week_number = newWeekNumber
    // Fix slot IDs to match the correct week number
    for (const day of skeleton.weeks[0].days) {
      day.slots = day.slots.map((slot, idx) => ({
        ...slot,
        slot_id: `w${newWeekNumber}d${day.day_of_week}s${idx + 1}`,
      }))
    }
  }

  if (!skeleton.total_sessions) {
    skeleton.total_sessions = skeleton.weeks.reduce((sum, w) => sum + w.days.length, 0)
  }

  const totalSlots = skeleton.weeks.reduce((sum, w) => sum + w.days.reduce((ds, d) => ds + d.slots.length, 0), 0)
  console.log(`[week-orchestrator] Week ${newWeekNumber} skeleton: ${totalSlots} slots across ${skeleton.weeks[0]?.days.length ?? 0} days`)

  if (await checkCancelled()) {
    return { new_week_number: newWeekNumber, exercises_added: 0, token_usage: tokenUsage, duration_ms: Date.now() - startTime }
  }

  // ── Step 3: Agent 2 — Exercise Selector ────────────────────────────────

  await updateJobProgress("selecting_exercises", 4, `Selecting exercises for ${totalSlots} slots`)

  const availableEquipment = profile?.available_equipment ?? []
  const exerciseIdSet = new Set(allExercises.map((e) => e.id))

  // Build a mock ProfileAnalysis for filtering
  const mockAnalysis = {
    recommended_split: program.split_type,
    recommended_periodization: program.periodization,
    volume_targets: [],
    exercise_constraints: [],
    session_structure: { warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5, total_exercises: 6, compound_count: 3, isolation_count: 3 },
    training_age_category: (profile?.experience_level ?? "intermediate") as "novice" | "intermediate" | "advanced" | "elite",
    notes: "",
  }

  let filtered: CompressedExercise[]
  try {
    filtered = await semanticFilterExercises(allExercises, skeleton, availableEquipment, mockAnalysis)
  } catch {
    filtered = scoreAndFilterExercises(allExercises, skeleton, availableEquipment, mockAnalysis)
  }
  const exerciseLibrary = formatExerciseLibrary(filtered)

  // Include context about which exercises were used in recent weeks to help with rotation
  const recentExerciseIds = [...new Set(lastTwoWeeks.map((pe: { exercise_id: string }) => pe.exercise_id))]
  const recentExerciseNames = lastTwoWeeks
    .reduce((acc: { id: string; name: string }[], pe: Record<string, unknown>) => {
      const id = pe.exercise_id as string
      if (!acc.find((e) => e.id === id)) {
        acc.push({ id, name: ((pe.exercises as { name?: string })?.name ?? "Unknown") })
      }
      return acc
    }, [])

  const constraintsContext = JSON.stringify({
    available_equipment: availableEquipment,
    client_difficulty: profile?.experience_level ?? "intermediate",
    recent_exercises_to_rotate: recentExerciseNames,
  })

  const selectorMessage = `Program Skeleton:\n${JSON.stringify(skeleton)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${filtered.length} exercises):\n${exerciseLibrary}\n\nIMPORTANT: For PRIMARY_COMPOUND and SECONDARY_COMPOUND slots, try to reuse exercises from recent weeks for progressive overload continuity. For ACCESSORY and ISOLATION slots, select DIFFERENT exercises than those listed in recent_exercises_to_rotate.`

  const selectorResult = await callAgent<ExerciseAssignment>(
    EXERCISE_SELECTOR_PROMPT,
    selectorMessage,
    exerciseAssignmentSchema,
    { maxTokens: 8192, cacheSystemPrompt: true }
  )
  tokenUsage.selector = selectorResult.tokens_used
  const assignment = selectorResult.content

  // Strip hallucinated exercise IDs
  const validCount = assignment.assignments.length
  assignment.assignments = assignment.assignments.filter((a) => exerciseIdSet.has(a.exercise_id))
  const strippedCount = validCount - assignment.assignments.length
  if (strippedCount > 0) {
    console.warn(`[week-orchestrator] Stripped ${strippedCount} hallucinated exercise IDs`)
  }

  // ── Step 4: Save to database ───────────────────────────────────────────

  await updateJobProgress("saving_week", 5, `Saving ${assignment.assignments.length} exercises for Week ${newWeekNumber}`)

  // Build slot lookup
  const slotLookup = new Map<string, { week_number: number; day_of_week: number; order_index: number }>()
  const slotDetailsLookup = new Map<string, { sets: number; reps: string; rest_seconds: number; rpe_target: number | null; tempo: string | null; group_tag: string | null; technique: ExerciseSlot["technique"] }>()

  for (const week of skeleton.weeks) {
    for (const day of week.days) {
      day.slots.forEach((slot, idx) => {
        slotLookup.set(slot.slot_id, { week_number: week.week_number, day_of_week: day.day_of_week, order_index: idx })
        slotDetailsLookup.set(slot.slot_id, {
          sets: slot.sets, reps: slot.reps, rest_seconds: slot.rest_seconds,
          rpe_target: slot.rpe_target, tempo: slot.tempo,
          group_tag: slot.group_tag, technique: slot.technique ?? "straight_set",
        })
      })
    }
  }

  await Promise.all(assignment.assignments.map((assigned) => {
    const location = slotLookup.get(assigned.slot_id)
    const details = slotDetailsLookup.get(assigned.slot_id)
    if (!location || !details) return Promise.resolve(null)
    return addExerciseToProgram({
      program_id: request.program_id, exercise_id: assigned.exercise_id,
      day_of_week: location.day_of_week, week_number: location.week_number,
      order_index: location.order_index, sets: details.sets, reps: details.reps,
      duration_seconds: null, rest_seconds: details.rest_seconds, notes: assigned.notes,
      rpe_target: details.rpe_target, intensity_pct: null, tempo: details.tempo,
      group_tag: details.group_tag, technique: details.technique ?? "straight_set",
    })
  }))

  // Update program duration and assignment total_weeks
  await updateProgramDuration(request.program_id, newWeekNumber)
  await updateAssignmentTotalWeeks(request.assignment_id, newWeekNumber)

  tokenUsage.total = tokenUsage.architect + tokenUsage.selector
  const durationMs = Date.now() - startTime

  console.log(`[week-orchestrator] Week ${newWeekNumber} generated: ${assignment.assignments.length} exercises in ${durationMs}ms`)

  return {
    new_week_number: newWeekNumber,
    exercises_added: assignment.assignments.length,
    token_usage: tokenUsage,
    duration_ms: durationMs,
  }
}
