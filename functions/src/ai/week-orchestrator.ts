import type {
  CompressedExercise,
  ExerciseSlot,
  ProgramWeek,
  ExerciseAssignment,
  ValidationResult,
} from "./types.js"
import { callAgent, MODEL_OPUS, MODEL_SONNET } from "./anthropic.js"
import { scoreAndFilterExercises, semanticFilterExercises } from "./exercise-filter.js"
import { programSkeletonSchema, exerciseAssignmentSchema } from "./schemas.js"
import { EXERCISE_SELECTOR_PROMPT } from "./prompts.js"
import { validateProgram } from "./validate.js"
import { formatExerciseLibrary } from "./exercise-context.js"
import { getExercisesForAI } from "./program-chat-tools.js"
import { buildPriorContextFromExistingExercises, verifyWeekAgainstExisting } from "./dedup-verify.js"
import { getSupabase } from "../lib/supabase.js"
import { z } from "zod"

const MAX_RETRIES = 2

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WeekGenerationRequest {
  program_id: string
  assignment_id?: string
  client_id?: string
  admin_instructions?: string
  /** When set, generate into this specific (blank) week instead of appending a new one */
  target_week_number?: number
  /** When set, generate exercises for this single day only (1=Monday … 7=Sunday) */
  target_day_of_week?: number
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

async function bulkAddExercisesToProgram(rows: Record<string, unknown>[], retries = 3) {
  const BATCH_SIZE = 25
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (let attempt = 1; attempt <= retries; attempt++) {
      const supabase = getSupabase()
      const { error } = await supabase.from("program_exercises").insert(batch)
      if (!error) break
      if (attempt === retries) throw new Error(`Failed to add exercises (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`)
      console.warn(`[week-orchestrator] bulkAddExercises batch ${Math.floor(i / BATCH_SIZE) + 1} attempt ${attempt} failed: ${error.message}, retrying...`)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
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
3. ROTATE ALL WORKING EXERCISES every week — compounds, accessories, and isolations MUST all use DIFFERENT exercises than prior weeks. For compound slots, pick a different exercise that trains the SAME movement pattern and muscles (e.g., Week 1 Back Squat → Week 2 Front Squat). Target < 3% repetition score.
4. ACCESSORY and ISOLATION slots — additionally vary the movement patterns or target muscles every 2-3 weeks for even more variety.
5. COACH INSTRUCTIONS ARE HIGHEST PRIORITY — they override ALL default rules including technique selection, exercise structure, and progression logic. The coach may specify:
   - A THEME or FOCUS AREA (e.g., "lower leg focus", "glute emphasis", "no equipment this week")
   - A SHIFT in emphasis while maintaining a theme (e.g., "keep lower leg theme but add glutes")
   - Equipment constraints for this specific week (e.g., "bodyweight only", "bands only")
   - TECHNIQUE PREFERENCES (e.g., "no supersets", "use straight sets only", "use tri-sets", "avoid circuits"). If the coach specifies technique preferences, follow them EXACTLY — even if they conflict with what would normally be recommended for this client's level or time constraints. For example, if the coach says "avoid supersets", ALL techniques must be straight_set, dropset, rest_pause, or other non-superset methods.
   When a theme is specified, bias slot target_muscles and movement_patterns toward that theme while still maintaining a balanced program.
6. Session time budget: keep the same number of exercises per day as previous weeks unless the coach says otherwise.
7. Use the same slot_id format: "w{week_number}d{day_of_week}s{slot_index}".
8. Review the FULL PROGRAM PROGRESSION summary — understand the arc of the entire program (what muscles were emphasized each week, how themes evolved) before designing this week.
9. Output ONLY the JSON object, no additional text.`

// ─── Day Architect Prompt (single-day variant) ──────────────────────────────

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

const DAY_ARCHITECT_PROMPT = `You are a performance system architect designing a SINGLE TRAINING DAY within a week of an ongoing training program. You have access to the full program history (week-by-week progression summary + detailed recent weeks) and the client's actual training logs.

Your job is to design ONE day that:
1. Follows the program's established split, periodization, and structure
2. Progresses appropriately based on the client's actual performance data
3. Maintains exercise continuity for compound lifts while rotating accessories
4. Respects the admin coach's specific instructions (if provided)
5. Fits logically within the existing week — consider what other days already have

Given the program context, client progress data, and coach instructions, output a JSON object with this structure — it MUST contain exactly ONE week with exactly ONE day in the "days" array:

{
  "weeks": [
    {
      "week_number": number,
      "phase": string (e.g., "Hypertrophy", "Strength", "Deload"),
      "intensity_modifier": string (e.g., "moderate", "high", "low/deload"),
      "days": [
        {
          "day_of_week": number (the specific day requested),
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
  "total_sessions": 1,
  "notes": string (rationale for this day's design)
}

Rules:
1. Output EXACTLY ONE day in the "days" array — the specific day_of_week requested.
2. MATCH the program's existing structure for this day: look at what this day_of_week typically contains in prior weeks (muscle groups, exercise count, session focus).
3. COMPLEMENT other days already programmed in this week — avoid duplicating the same muscle groups or movement patterns.
4. PROGRESS appropriately based on the client's logged performance.
5. ROTATE ALL WORKING EXERCISES — use DIFFERENT exercises than prior weeks for the same slot roles.
6. COACH INSTRUCTIONS ARE HIGHEST PRIORITY — they override ALL default rules including technique selection, exercise structure, and progression logic. If the coach specifies technique preferences (e.g., "no supersets", "use straight sets only"), follow them EXACTLY regardless of the client's level or time constraints.
7. Use the slot_id format: "w{week_number}d{day_of_week}s{slot_index}".
8. Output ONLY the JSON object, no additional text.`

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

  const [program, existingExercises, allExercises] = await Promise.all([
    getProgramById(request.program_id),
    getProgramExercises(request.program_id),
    getExercisesForAI(),
  ])

  // Client data is optional — programs without assignments can still use AI generation
  const profile = request.client_id ? await getClientProfile(request.client_id) : null
  const clientName = request.client_id ? await getClientName(request.client_id) : "Unassigned"

  // Determine whether we're filling a blank existing week or appending a new one
  const isSingleDay = !!request.target_day_of_week
  const isFillingBlank = !!request.target_week_number && request.target_week_number <= (program.duration_weeks ?? 1)
  const newWeekNumber = request.target_week_number ?? (program.duration_weeks ?? 1) + 1

  // If filling a blank week, verify it has no exercises already (skip check for single-day mode)
  if (isFillingBlank && !isSingleDay) {
    const existingInTarget = existingExercises.filter(
      (pe: { week_number: number }) => pe.week_number === newWeekNumber
    )
    if (existingInTarget.length > 0) {
      throw new Error(`Week ${newWeekNumber} already has ${existingInTarget.length} exercises. Clear them first or generate into a blank week.`)
    }
  }

  // If single-day mode, verify the target day is empty within the target week
  if (isSingleDay) {
    const existingInDay = existingExercises.filter(
      (pe: { week_number: number; day_of_week: number }) =>
        pe.week_number === newWeekNumber && pe.day_of_week === request.target_day_of_week
    )
    if (existingInDay.length > 0) {
      throw new Error(`${DAY_NAMES[(request.target_day_of_week!) - 1]} in Week ${newWeekNumber} already has ${existingInDay.length} exercises. Clear them first.`)
    }
  }

  // Get unique exercise IDs from the program for progress lookup
  const programExerciseIds = [...new Set(existingExercises.map((pe: { exercise_id: string }) => pe.exercise_id))]
  const recentProgress = request.client_id
    ? await getRecentProgress(request.client_id, programExerciseIds)
    : []

  // Build compact summary of ALL weeks (focus/theme only) for full progression context
  const weekFocusSummary = buildWeekFocusSummary(existingExercises)

  // Detailed exercises from the 3 weeks before the target week for structure matching
  const recentWeeksDetailed = existingExercises.filter(
    (pe: { week_number: number }) => pe.week_number >= Math.max(1, newWeekNumber - 3) && pe.week_number < newWeekNumber
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

  // ── Step 2: Agent 1 — Week/Day Architect ─────────────────────────────

  const targetDayName = isSingleDay ? DAY_NAMES[request.target_day_of_week! - 1] : null
  await updateJobProgress("designing_week", 3, isSingleDay
    ? `Designing ${targetDayName} for Week ${newWeekNumber}`
    : `Designing Week ${newWeekNumber}`)

  // Build context about other days already in this week (for single-day mode)
  const sameWeekOtherDays = isSingleDay
    ? existingExercises
        .filter((pe: { week_number: number; day_of_week: number }) =>
          pe.week_number === newWeekNumber && pe.day_of_week !== request.target_day_of_week
        )
        .map((pe: Record<string, unknown>) => ({
          day: pe.day_of_week,
          day_name: DAY_NAMES[(pe.day_of_week as number) - 1],
          exercise: (pe.exercises as { name?: string })?.name ?? "Unknown",
          movement_pattern: (pe.exercises as { movement_pattern?: string })?.movement_pattern,
          primary_muscles: (pe.exercises as { primary_muscles?: string[] })?.primary_muscles,
        }))
    : []

  const architectMessage = `## Program Overview
${JSON.stringify(programSummary)}

## Full Program Progression (week-by-week summary)
${weekFocusSummary.length > 0 ? JSON.stringify(weekFocusSummary) : "No previous weeks — this is Week 1."}

## Detailed Recent Weeks (last ${Math.min(3, program.duration_weeks ?? 1)} weeks — exercises, sets, reps)
${JSON.stringify(weekStructure)}
${isSingleDay && sameWeekOtherDays.length > 0 ? `
## Other Days Already Programmed in Week ${newWeekNumber}
${JSON.stringify(sameWeekOtherDays)}
IMPORTANT: The day you are designing must COMPLEMENT these existing days. Do NOT duplicate the same primary muscle groups or movement patterns.` : ""}

## Client Profile
${profileContext}

## Client's Recent Performance Logs
${progressSummary.length > 0 ? JSON.stringify(progressSummary) : "No logs yet — client has not started training."}

## ${isSingleDay ? "Target Day" : "New Week Number"}
${isSingleDay ? `${targetDayName} (day_of_week=${request.target_day_of_week}) in Week ${newWeekNumber}` : newWeekNumber}

## Coach Instructions (HIGHEST PRIORITY — these override ALL default rules)
${request.admin_instructions || "No specific instructions — use standard progression logic based on the client's performance data."}
${request.admin_instructions ? "\nYou MUST follow these instructions. If they conflict with default technique, structure, or progression rules, the coach's instructions WIN." : ""}

${isSingleDay
    ? `Design ${targetDayName} for Week ${newWeekNumber}. The output MUST have week_number=${newWeekNumber} and exactly ONE day with day_of_week=${request.target_day_of_week}. Match the existing program's split (${program.split_type}) and periodization (${program.periodization}). Look at what ${targetDayName} typically contains in prior weeks to determine the appropriate focus, exercise count, and session structure.`
    : `Design Week ${newWeekNumber} for this program. The week MUST have week_number=${newWeekNumber}. Match the existing program's split (${program.split_type}), periodization (${program.periodization}), and training days.`}

IMPORTANT: Review the full program progression summary above. If the coach's instructions reference themes, focus areas, or progressions from previous weeks, ensure this ${isSingleDay ? "day" : "week"} builds on that trajectory logically. The coach may ask to maintain a theme while shifting emphasis (e.g., "keep lower leg focus but add glute work") — honor this by blending continuity with the new direction.`

  const architectResult = await callAgent<z.infer<typeof weekSkeletonSchema>>(
    isSingleDay ? DAY_ARCHITECT_PROMPT : WEEK_ARCHITECT_PROMPT,
    architectMessage,
    weekSkeletonSchema,
    { model: MODEL_OPUS, cacheSystemPrompt: true }
  )
  tokenUsage.architect = architectResult.tokens_used
  const skeleton = architectResult.content

  // Ensure the week number is correct
  if (skeleton.weeks.length > 0) {
    skeleton.weeks[0].week_number = newWeekNumber

    // In single-day mode, filter to only the target day
    if (isSingleDay) {
      skeleton.weeks[0].days = skeleton.weeks[0].days.filter(
        (d) => d.day_of_week === request.target_day_of_week
      )
      // If AI didn't produce the right day, force it
      if (skeleton.weeks[0].days.length === 0) {
        throw new Error(`AI did not produce exercises for ${targetDayName}. Try again.`)
      }
    }

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

  // ── Step 3: Agent 2 — Exercise Selector with Dedup Verification ────────

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

  // Build dedup context from ALL existing program exercises (not just last 2 weeks)
  const priorExercisesForDedup = existingExercises.map((pe: Record<string, unknown>) => {
    const ex = pe.exercises as { name?: string; movement_pattern?: string; primary_muscles?: string[] } | undefined
    // Infer role from order_index: 0 = warm_up, 1-2 = compounds, rest = accessory/isolation
    const orderIdx = pe.order_index as number
    let inferredRole = "accessory"
    if (orderIdx === 0) inferredRole = "warm_up"
    else if (orderIdx <= 2) inferredRole = "primary_compound"
    // Build slot group for dedup matching
    const slotGroup = `${inferredRole}|${ex?.movement_pattern ?? "unknown"}|${(ex?.primary_muscles ?? []).sort().join(",")}`
    return {
      exercise_id: pe.exercise_id as string,
      exercise_name: ex?.name ?? "Unknown",
      week_number: pe.week_number as number,
      role: inferredRole,
      slot_group: slotGroup,
    }
  })

  const priorContext = buildPriorContextFromExistingExercises(priorExercisesForDedup)
  console.log(`[week-orchestrator] Dedup context: ${priorContext.anchor_exercises.size} anchors, ${priorContext.used_accessory_exercises.size} accessory groups, ${priorContext.exercise_week_map.size} total unique exercises`)

  const constraintsContext = JSON.stringify({
    available_equipment: availableEquipment,
    client_difficulty: profile?.experience_level ?? "intermediate",
  })

  // Exercise Selector with dedup retry loop
  let assignment: ExerciseAssignment | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let feedbackSection = ""
    if (attempt > 0 && assignment) {
      // Verify the previous attempt's dedup compliance
      const dedupResult = verifyWeekAgainstExisting(
        assignment.assignments,
        skeleton.weeks[0],
        priorContext
      )
      if (!dedupResult.pass) {
        const repetitionIssues = dedupResult.issues
          .filter((i) => i.severity === "error")
          .map((i) => `- ${i.message}`)
          .join("\n")
        feedbackSection = `\n\nEXERCISE REPETITION DETECTED — you MUST choose DIFFERENT exercises:\n${repetitionIssues}\n\nSelect alternative exercises from the library that STILL MATCH the slot's movement_pattern, target_muscles, and role — but use a different exercise_id. Do NOT pick random exercises just to avoid repetition. Vary by equipment (dumbbell→cable→machine), angle, or stance while keeping the same training purpose.`
      }
    }

    // Build coach instructions section for the exercise selector
    const coachInstructionsSection = request.admin_instructions
      ? `\n\n## COACH INSTRUCTIONS (HIGHEST PRIORITY — these override ALL default rules)\n${request.admin_instructions}\n\nYou MUST follow these instructions exactly. They override default exercise selection, technique, and structure rules. Examples:\n- If the coach says "no supersets" or "avoid supersets" → select exercises compatible with straight sets, dropsets, rest-pause, or other non-superset methods only\n- If the coach says "glute focus" → pick glute-dominant exercises for accessory/isolation slots\n- If the coach says "bodyweight only" → only select exercises where is_bodyweight=true or equipment_required is empty\n- If the coach says "deload" → pick lighter/simpler variations of the usual exercises\n- If the coach references a specific technique, exercise, or muscle group → prioritize it in your selections`
      : ""

    const selectorMessage = `Program Skeleton (Week ${newWeekNumber}):\n${JSON.stringify(skeleton)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${filtered.length} exercises):\n${exerciseLibrary}\n\n${priorContext.prompt_text}${coachInstructionsSection}\n\nIMPORTANT: EVERY working exercise (compounds, accessories, isolations) MUST be DIFFERENT from prior weeks. Use the AVOID list above — do NOT reuse any exercise_id from that list. For compound slots, pick a DIFFERENT exercise that trains the SAME movement pattern and muscles. WARM-UP and COOL-DOWN slots may stay consistent.${feedbackSection}`

    try {
      console.log(`[week-orchestrator] Exercise selector attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
      const selectorResult = await callAgent<ExerciseAssignment>(
        EXERCISE_SELECTOR_PROMPT,
        selectorMessage,
        exerciseAssignmentSchema,
        { cacheSystemPrompt: true }
      )
      tokenUsage.selector += selectorResult.tokens_used
      assignment = selectorResult.content

      // Strip hallucinated exercise IDs
      const validCount = assignment.assignments.length
      assignment.assignments = assignment.assignments.filter((a) => exerciseIdSet.has(a.exercise_id))
      const strippedCount = validCount - assignment.assignments.length
      if (strippedCount > 0) {
        console.warn(`[week-orchestrator] Stripped ${strippedCount} hallucinated exercise IDs`)
      }

      // Verify dedup compliance
      const dedupResult = verifyWeekAgainstExisting(
        assignment.assignments,
        skeleton.weeks[0],
        priorContext
      )
      console.log(`[week-orchestrator] Dedup verification: ${dedupResult.summary}`)

      if (dedupResult.pass) break

      // If dedup fails but no retries left, accept the result with a warning
      if (attempt === MAX_RETRIES) {
        console.warn(`[week-orchestrator] Dedup still failing after ${MAX_RETRIES + 1} attempts — accepting with repetition warnings`)
        break
      }

      console.log(`[week-orchestrator] Dedup failed, retrying...`)
    } catch (agentError) {
      console.error(`[week-orchestrator] Selector attempt ${attempt + 1} error:`, agentError instanceof Error ? agentError.message : agentError)
      if (attempt === MAX_RETRIES) {
        throw new Error(`Exercise selection failed after ${MAX_RETRIES + 1} attempts: ${agentError instanceof Error ? agentError.message : "Unknown error"}`)
      }
    }
  }

  if (!assignment) {
    throw new Error("Failed to generate exercise assignments")
  }

  // ── Step 4: Save to database ───────────────────────────────────────────

  await updateJobProgress("saving_week", 5, isSingleDay
    ? `Saving ${assignment.assignments.length} exercises for ${targetDayName}`
    : `Saving ${assignment.assignments.length} exercises for Week ${newWeekNumber}`)

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

  const exerciseRows = assignment.assignments
    .map((assigned) => {
      const location = slotLookup.get(assigned.slot_id)
      const details = slotDetailsLookup.get(assigned.slot_id)
      if (!location || !details) return null
      return {
        program_id: request.program_id, exercise_id: assigned.exercise_id,
        day_of_week: location.day_of_week, week_number: location.week_number,
        order_index: location.order_index, sets: details.sets, reps: details.reps,
        duration_seconds: null, rest_seconds: details.rest_seconds, notes: assigned.notes,
        rpe_target: details.rpe_target, intensity_pct: null, tempo: details.tempo,
        group_tag: details.group_tag, technique: details.technique ?? "straight_set",
      }
    })
    .filter((r) => r !== null) as Record<string, unknown>[]

  await bulkAddExercisesToProgram(exerciseRows)

  // Only bump duration_weeks and total_weeks when appending a new week (not filling a blank or single day)
  if (!isFillingBlank && !isSingleDay) {
    await updateProgramDuration(request.program_id, newWeekNumber)
    if (request.assignment_id) {
      await updateAssignmentTotalWeeks(request.assignment_id, newWeekNumber)
    }
  }

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
