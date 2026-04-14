import type { ClientProfile } from "@/types/database"

/**
 * Parse the goals list from the goals string.
 * Supports both the old pipe-delimited format ("Goals: weight_loss, muscle_gain | ...")
 * and the new clean comma-separated format ("weight_loss, muscle_gain").
 */
export function parseGoalsFromProfile(goalsString: string): string[] {
  // Old format: "Goals: weight_loss, muscle_gain | Training background: ..."
  const goalsMatch = goalsString.match(/^Goals:\s*(.+?)(?:\s*\||$)/)
  if (goalsMatch) {
    return goalsMatch[1]
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean)
  }
  // New format: "weight_loss, muscle_gain"
  const items = goalsString
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
  if (items.length > 0) {
    return items
  }
  return []
}

/**
 * Parse a named field value from the composite goals string.
 * e.g. parseFieldFromProfile(str, "Training background") → "5 years lifting"
 */
export function parseFieldFromProfile(goalsString: string, prefix: string): string {
  const regex = new RegExp(`${prefix}:\\s*(.+?)(?:\\s*\\||$)`)
  const match = goalsString.match(regex)
  return match ? match[1].trim() : ""
}

export interface ProfileSummary {
  goals: string[]
  experienceLevel: string | null
  trainingYears: number | null
  preferredTrainingDays: number | null
  preferredSessionMinutes: number | null
  preferredDayNames: number[]
  timeEfficiencyPreference: string | null
  preferredTechniques: string[]
  availableEquipment: string[]
  injuries: string | null
  injuryDetails: ClientProfile["injury_details"]
  trainingBackground: string
  likes: string
  dislikes: string
  notes: string
  sport: string | null
  position: string | null
  dateOfBirth: string | null
  gender: string | null
  movementConfidence: string | null
  sleepHours: string | null
  stressLevel: string | null
  occupationActivityLevel: string | null
}

/**
 * Parse a full structured summary from a ClientProfile.
 */
export function parseProfileSummary(profile: ClientProfile): ProfileSummary {
  const goalsString = profile.goals ?? ""
  // New questionnaire stores goals as clean comma-separated list
  const goals = parseGoalsFromProfile(goalsString)
  // Fall back to old pipe-delimited fields if new columns are empty
  const trainingBackground = profile.training_background || parseFieldFromProfile(goalsString, "Training background")
  const likes = profile.exercise_likes || parseFieldFromProfile(goalsString, "Likes")
  const dislikes = profile.exercise_dislikes || parseFieldFromProfile(goalsString, "Dislikes")
  const notes = profile.additional_notes || parseFieldFromProfile(goalsString, "Notes")

  return {
    goals,
    experienceLevel: profile.experience_level,
    trainingYears: profile.training_years,
    preferredTrainingDays: profile.preferred_training_days,
    preferredSessionMinutes: profile.preferred_session_minutes,
    preferredDayNames: profile.preferred_day_names ?? [],
    timeEfficiencyPreference: profile.time_efficiency_preference,
    preferredTechniques: profile.preferred_techniques ?? [],
    availableEquipment: profile.available_equipment,
    injuries: profile.injuries,
    injuryDetails: profile.injury_details,
    trainingBackground,
    likes,
    dislikes,
    notes,
    sport: profile.sport,
    position: profile.position,
    dateOfBirth: profile.date_of_birth,
    gender: profile.gender,
    movementConfidence: profile.movement_confidence,
    sleepHours: profile.sleep_hours,
    stressLevel: profile.stress_level,
    occupationActivityLevel: profile.occupation_activity_level,
  }
}

/**
 * Check whether a profile has meaningful questionnaire data filled in.
 */
export function hasQuestionnaireData(profile: ClientProfile): boolean {
  const goalsList = parseGoalsFromProfile(profile.goals ?? "")
  return (
    goalsList.length > 0 ||
    !!profile.experience_level ||
    profile.training_years !== null ||
    profile.available_equipment.length > 0 ||
    profile.preferred_training_days !== null ||
    profile.preferred_session_minutes !== null ||
    !!profile.sport ||
    !!profile.position ||
    !!profile.date_of_birth ||
    !!profile.gender ||
    !!profile.injuries ||
    profile.injury_details.length > 0 ||
    !!profile.movement_confidence ||
    !!profile.sleep_hours ||
    !!profile.stress_level ||
    !!profile.occupation_activity_level ||
    !!profile.training_background ||
    !!profile.exercise_likes ||
    !!profile.exercise_dislikes ||
    !!profile.additional_notes ||
    !!profile.time_efficiency_preference ||
    profile.preferred_techniques.length > 0 ||
    profile.preferred_day_names.length > 0 ||
    profile.height_cm !== null ||
    profile.weight_kg !== null
  )
}
