import { getSupabase } from "../lib/supabase.js"
import type { CompressedExercise } from "./types.js"

// ─── Tool definitions for program chat ──────────────────────────────────────
// These are structured as simple functions instead of Vercel AI SDK tools.
// The program-chat Firebase Function handles tool dispatch.

export async function listClients() {
  const supabase = getSupabase()
  const { data: clients, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, email")
    .eq("role", "client")
    .limit(500)

  if (error) {
    return { clients: [], summary: `Failed to load clients: ${error.message}` }
  }

  return {
    clients: (clients ?? []).map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`.trim(),
      email: c.email,
    })),
    summary: `Found ${(clients ?? []).length} client${(clients ?? []).length !== 1 ? "s" : ""}.`,
  }
}

export async function lookupClientProfile(clientId: string, clientName: string) {
  const supabase = getSupabase()
  const { data: profile, error } = await supabase.from("client_profiles").select("*").eq("user_id", clientId).single()

  if (error || !profile) {
    return {
      found: false,
      client_id: clientId,
      client_name: clientName,
      summary: `No questionnaire data found for ${clientName}.`,
    }
  }

  return {
    found: true,
    client_id: clientId,
    client_name: clientName,
    summary: `Loaded profile for ${clientName}.`,
    profile: {
      goals: profile.goals,
      experience_level: profile.experience_level,
      training_years: profile.training_years,
      movement_confidence: profile.movement_confidence,
      sessions_per_week: profile.preferred_training_days,
      session_minutes: profile.preferred_session_minutes,
      preferred_day_names: profile.preferred_day_names,
      time_efficiency: profile.time_efficiency_preference,
      preferred_techniques: profile.preferred_techniques,
      available_equipment: profile.available_equipment,
      injuries: profile.injuries,
      injury_details: profile.injury_details,
      sport: profile.sport,
      gender: profile.gender,
      date_of_birth: profile.date_of_birth,
      sleep_hours: profile.sleep_hours,
      stress_level: profile.stress_level,
      occupation_activity_level: profile.occupation_activity_level,
      exercise_likes: profile.exercise_likes,
      exercise_dislikes: profile.exercise_dislikes,
      training_background: profile.training_background,
      additional_notes: profile.additional_notes,
    },
  }
}

// ─── Helper: compress exercises from DB ─────────────────────────────────────

const EXERCISE_AI_COLUMNS =
  "id, name, category, difficulty, difficulty_score, muscle_group, movement_pattern, primary_muscles, secondary_muscles, force_type, laterality, equipment_required, is_bodyweight, training_intent, sport_tags, plane_of_motion, joints_loaded"

/** PostgREST caps a single response; page past it with a keyset cursor. */
const EXERCISE_PAGE_SIZE = 1000

/**
 * Read the full active exercise library for AI generation.
 *
 * Ordered by id so the candidate ranker's seeded jitter is the ONLY source of
 * run-to-run variation — an unordered read makes ordering (and therefore the
 * model's position bias) arbitrary. Paginated because a bare .limit(1000)
 * silently truncates: the library is already at 92% of that cap, and exercises
 * past it would just vanish from generation with no error.
 */
async function fetchExercisePage(cursor: string | null) {
  const supabase = getSupabase()
  let query = supabase
    .from("exercises")
    .select(EXERCISE_AI_COLUMNS)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(EXERCISE_PAGE_SIZE)
  if (cursor) query = query.gt("id", cursor)

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch exercises: ${error.message}`)
  return data ?? []
}

export async function getExercisesForAI(): Promise<CompressedExercise[]> {
  const exercises: Awaited<ReturnType<typeof fetchExercisePage>> = []
  let cursor: string | null = null

  for (;;) {
    const page = await fetchExercisePage(cursor)
    if (page.length === 0) break
    exercises.push(...page)
    if (page.length < EXERCISE_PAGE_SIZE) break
    cursor = page[page.length - 1].id as string
  }

  return exercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    category: ex.category ?? [],
    difficulty: ex.difficulty ?? "intermediate",
    difficulty_score: ex.difficulty_score ?? null,
    muscle_group: ex.muscle_group ?? null,
    movement_pattern: ex.movement_pattern ?? null,
    primary_muscles: ex.primary_muscles ?? [],
    secondary_muscles: ex.secondary_muscles ?? [],
    force_type: ex.force_type ?? null,
    laterality: ex.laterality ?? null,
    equipment_required: ex.equipment_required ?? [],
    is_bodyweight: ex.is_bodyweight ?? false,
    training_intent: ex.training_intent ?? ["build"],
    sport_tags: ex.sport_tags ?? [],
    plane_of_motion: ex.plane_of_motion ?? [],
    joints_loaded: ex.joints_loaded ?? [],
  }))
}
