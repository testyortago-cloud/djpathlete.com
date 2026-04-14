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

export async function getExercisesForAI(): Promise<CompressedExercise[]> {
  const supabase = getSupabase()
  const { data: exercises } = await supabase
    .from("exercises")
    .select(
      "id, name, category, difficulty, difficulty_score, muscle_group, movement_pattern, primary_muscles, secondary_muscles, force_type, laterality, equipment_required, is_bodyweight, training_intent, sport_tags, plane_of_motion, joints_loaded",
    )
    .eq("is_active", true)
    .limit(1000)

  return (exercises ?? []).map((ex) => ({
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
