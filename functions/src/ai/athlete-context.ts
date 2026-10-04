/**
 * What the generation agents are told about the athlete — one builder for the
 * full-program and week/day paths. Before 2026-10-04 week/day sent a thinner
 * profile (no sport, age, movement_confidence, dislikes) and the selector got
 * none of it, while its prompt had rules about every one of those fields: the
 * model either skipped the rule or guessed. Live data showed the guess — "golf"
 * cues for a tennis player, "tennis" cues in programs with no client.
 */

/** A `client_profiles` row as `select("*")` returns it. */
export type ClientProfileRow = Record<string, unknown>

/** Spellings found in live profiles (2026-10-04): "Tennis ", "Tenis", "Pickle". */
const SPORT_ALIASES: Record<string, string> = { tenis: "tennis", pickle: "pickleball" }

export function normalizeSport(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ")
  if (!s) return null
  return SPORT_ALIASES[s] ?? s
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

export interface AthleteContext {
  sport: string | null
  experience_level: string | null
  movement_confidence: string | null
  injury_details: unknown[]
  exercise_dislikes: string | null
}

/** The selector's `Constraints.athlete`. null / [] mean "not known" — the prompt says never to assume. */
export function buildAthleteContext(profile: ClientProfileRow | null | undefined): AthleteContext {
  return {
    sport: normalizeSport(profile?.sport),
    experience_level: str(profile?.experience_level),
    movement_confidence: str(profile?.movement_confidence),
    injury_details: Array.isArray(profile?.injury_details) ? (profile!.injury_details as unknown[]) : [],
    exercise_dislikes: str(profile?.exercise_dislikes),
  }
}

/**
 * One default for every filter and prompt. Before 2026-10-04 the week path said
 * "advanced"/"intermediate" and the full path "elite"/"beginner", so the same
 * client got a different library depending on the button pressed.
 */
export function resolveClientDifficulty(
  profile: ClientProfileRow | null | undefined,
  ignoreProfile: boolean | undefined,
): string {
  return str(profile?.experience_level) ?? (ignoreProfile ? "advanced" : "intermediate")
}

function ageFrom(dob: unknown, now: Date): number | null {
  if (typeof dob !== "string") return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  return now.getFullYear() - d.getFullYear()
}

/** The planning agents' "Client Profile" JSON, or null when there is no profile (callers word that case). */
export function buildProfileContext(profile: ClientProfileRow | null | undefined, now = new Date()): string | null {
  if (!profile) return null
  return JSON.stringify({
    goals: profile.goals,
    sport: normalizeSport(profile.sport),
    gender: profile.gender,
    age: ageFrom(profile.date_of_birth, now),
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
}
