import type { ProfileAnalysis, SessionContext } from "@/lib/ai/types"
import type { AiGenerationRequest } from "@/lib/validators/ai-generation"
import type { SplitType, Periodization } from "@/types/database"

// ─── Day templates by split type ────────────────────────────────────────────

interface DayTemplate {
  label: string
  focus: string
}

function getFullBodyTemplates(n: number): DayTemplate[] {
  const emphases = [
    { label: "Full Body A", focus: "push emphasis (chest, shoulders, triceps) with lower body compounds" },
    { label: "Full Body B", focus: "pull emphasis (back, biceps) with lower body compounds" },
    { label: "Full Body C", focus: "lower body emphasis (quads, hamstrings, glutes) with upper accessories" },
    { label: "Full Body D", focus: "balanced full body with core and stability work" },
  ]
  return emphases.slice(0, n)
}

function getUpperLowerTemplates(n: number): DayTemplate[] {
  if (n <= 2) return [
    { label: "Upper Body", focus: "chest, back, shoulders, arms" },
    { label: "Lower Body", focus: "quads, hamstrings, glutes, calves" },
  ]
  if (n === 3) return [
    { label: "Upper Body A", focus: "chest, shoulders, triceps emphasis" },
    { label: "Lower Body", focus: "quads, hamstrings, glutes, calves" },
    { label: "Upper Body B", focus: "back, biceps, rear delts emphasis" },
  ]
  const templates = [
    { label: "Upper Body A", focus: "chest, shoulders, triceps emphasis" },
    { label: "Lower Body A", focus: "quad-dominant (squats, leg press, lunges)" },
    { label: "Upper Body B", focus: "back, biceps, rear delts emphasis" },
    { label: "Lower Body B", focus: "hip-dominant (deadlifts, hip thrusts, hamstrings)" },
    { label: "Upper Body C", focus: "balanced push/pull with arm isolation" },
    { label: "Lower Body C", focus: "unilateral focus and posterior chain" },
  ]
  return templates.slice(0, n)
}

function getPPLTemplates(n: number): DayTemplate[] {
  if (n <= 3) return [
    { label: "Push", focus: "chest, shoulders, triceps" },
    { label: "Pull", focus: "back, biceps, rear delts" },
    { label: "Legs", focus: "quads, hamstrings, glutes, calves" },
  ]
  if (n === 4) return [
    { label: "Push", focus: "chest, shoulders, triceps" },
    { label: "Pull", focus: "back, biceps, rear delts" },
    { label: "Legs", focus: "quads, hamstrings, glutes, calves" },
    { label: "Upper Power", focus: "heavy compound push and pull" },
  ]
  if (n === 5) return [
    { label: "Push A", focus: "chest emphasis, shoulders, triceps" },
    { label: "Pull A", focus: "back width (lats), biceps" },
    { label: "Legs A", focus: "quad-dominant, calves" },
    { label: "Push B", focus: "shoulder emphasis, chest, triceps" },
    { label: "Pull B", focus: "back thickness (traps, rhomboids), biceps" },
  ]
  return [
    { label: "Push A", focus: "chest emphasis, shoulders, triceps" },
    { label: "Pull A", focus: "back width (lats), biceps" },
    { label: "Legs A", focus: "quad-dominant, calves" },
    { label: "Push B", focus: "shoulder emphasis, chest, triceps" },
    { label: "Pull B", focus: "back thickness (traps, rhomboids), biceps" },
    { label: "Legs B", focus: "hip-dominant, hamstrings, glutes" },
  ].slice(0, n)
}

function getPushPullTemplates(n: number): DayTemplate[] {
  if (n <= 2) return [
    { label: "Push + Quads", focus: "chest, shoulders, triceps, quads" },
    { label: "Pull + Hams", focus: "back, biceps, hamstrings, glutes" },
  ]
  const templates = [
    { label: "Push A + Quads", focus: "chest emphasis, shoulders, triceps, quads" },
    { label: "Pull A + Hams", focus: "back emphasis, biceps, hamstrings, glutes" },
    { label: "Push B + Shoulders", focus: "shoulder emphasis, chest, triceps, quads" },
    { label: "Pull B + Posterior", focus: "back thickness, biceps, glutes, hamstrings" },
  ]
  return templates.slice(0, n)
}

function getBodyPartTemplates(n: number): DayTemplate[] {
  if (n <= 3) return [
    { label: "Chest & Triceps", focus: "chest, triceps" },
    { label: "Back & Biceps", focus: "back, biceps, rear delts" },
    { label: "Legs & Shoulders", focus: "quads, hamstrings, glutes, shoulders" },
  ]
  if (n === 4) return [
    { label: "Chest", focus: "chest, front delts" },
    { label: "Back", focus: "back, rear delts" },
    { label: "Shoulders & Arms", focus: "shoulders, biceps, triceps" },
    { label: "Legs", focus: "quads, hamstrings, glutes, calves" },
  ]
  if (n === 5) return [
    { label: "Chest", focus: "chest, front delts" },
    { label: "Back", focus: "lats, traps, rhomboids" },
    { label: "Shoulders", focus: "all delt heads, traps" },
    { label: "Arms", focus: "biceps, triceps, forearms" },
    { label: "Legs", focus: "quads, hamstrings, glutes, calves" },
  ]
  return [
    { label: "Chest", focus: "chest, front delts" },
    { label: "Back", focus: "lats, traps, rhomboids" },
    { label: "Shoulders", focus: "all delt heads, traps" },
    { label: "Arms", focus: "biceps, triceps, forearms" },
    { label: "Quads & Calves", focus: "quadriceps, calves" },
    { label: "Hamstrings & Glutes", focus: "hamstrings, glutes, posterior chain" },
  ].slice(0, n)
}

function getMovementPatternTemplates(n: number): DayTemplate[] {
  const templates = [
    { label: "Push Day", focus: "horizontal and vertical push patterns" },
    { label: "Pull Day", focus: "horizontal and vertical pull patterns" },
    { label: "Squat & Lunge", focus: "knee-dominant patterns (squats, lunges)" },
    { label: "Hinge & Carry", focus: "hip-dominant patterns (deadlifts, carries)" },
    { label: "Power & Rotation", focus: "explosive and rotational patterns" },
    { label: "Mixed Patterns", focus: "balanced combination of all patterns" },
  ]
  return templates.slice(0, n)
}

function getDayTemplates(splitType: SplitType, sessionsPerWeek: number): DayTemplate[] {
  switch (splitType) {
    case "full_body": return getFullBodyTemplates(sessionsPerWeek)
    case "upper_lower": return getUpperLowerTemplates(sessionsPerWeek)
    case "push_pull_legs": return getPPLTemplates(sessionsPerWeek)
    case "push_pull": return getPushPullTemplates(sessionsPerWeek)
    case "body_part": return getBodyPartTemplates(sessionsPerWeek)
    case "movement_pattern": return getMovementPatternTemplates(sessionsPerWeek)
    case "custom": return getFullBodyTemplates(sessionsPerWeek)
    default: return getFullBodyTemplates(sessionsPerWeek)
  }
}

// ─── Week phases by periodization ───────────────────────────────────────────

interface WeekPhase {
  week_number: number
  phase: string
  intensity_modifier: string
}

function getWeekPhases(periodization: Periodization, durationWeeks: number): WeekPhase[] {
  const weeks: WeekPhase[] = []

  switch (periodization) {
    case "linear": {
      for (let w = 1; w <= durationWeeks; w++) {
        const progress = w / durationWeeks
        if (durationWeeks >= 6 && w === durationWeeks) {
          weeks.push({ week_number: w, phase: "Deload", intensity_modifier: "low" })
        } else if (progress <= 0.4) {
          weeks.push({ week_number: w, phase: "Accumulation", intensity_modifier: "moderate" })
        } else if (progress <= 0.75) {
          weeks.push({ week_number: w, phase: "Intensification", intensity_modifier: "high" })
        } else {
          weeks.push({ week_number: w, phase: "Peak", intensity_modifier: "very high" })
        }
      }
      break
    }
    case "undulating": {
      const modifiers = ["moderate", "high", "moderate-high"]
      for (let w = 1; w <= durationWeeks; w++) {
        if (durationWeeks >= 6 && w === durationWeeks) {
          weeks.push({ week_number: w, phase: "Deload", intensity_modifier: "low" })
        } else {
          weeks.push({
            week_number: w,
            phase: "Undulating",
            intensity_modifier: modifiers[(w - 1) % modifiers.length],
          })
        }
      }
      break
    }
    case "block": {
      const blockSize = Math.max(2, Math.floor(durationWeeks / 3))
      for (let w = 1; w <= durationWeeks; w++) {
        if (durationWeeks >= 6 && w === durationWeeks) {
          weeks.push({ week_number: w, phase: "Deload", intensity_modifier: "low" })
        } else if (w <= blockSize) {
          weeks.push({ week_number: w, phase: "Hypertrophy", intensity_modifier: "moderate" })
        } else if (w <= blockSize * 2) {
          weeks.push({ week_number: w, phase: "Strength", intensity_modifier: "high" })
        } else {
          weeks.push({ week_number: w, phase: "Power / Peaking", intensity_modifier: "very high" })
        }
      }
      break
    }
    case "reverse_linear": {
      for (let w = 1; w <= durationWeeks; w++) {
        const progress = w / durationWeeks
        if (durationWeeks >= 6 && w === durationWeeks) {
          weeks.push({ week_number: w, phase: "Deload", intensity_modifier: "low" })
        } else if (progress <= 0.4) {
          weeks.push({ week_number: w, phase: "Strength", intensity_modifier: "high" })
        } else if (progress <= 0.75) {
          weeks.push({ week_number: w, phase: "Hypertrophy", intensity_modifier: "moderate" })
        } else {
          weeks.push({ week_number: w, phase: "Endurance", intensity_modifier: "moderate-low" })
        }
      }
      break
    }
    case "none":
    default: {
      for (let w = 1; w <= durationWeeks; w++) {
        if (durationWeeks >= 6 && w === durationWeeks) {
          weeks.push({ week_number: w, phase: "Deload", intensity_modifier: "low" })
        } else {
          weeks.push({ week_number: w, phase: "General Training", intensity_modifier: "moderate" })
        }
      }
      break
    }
  }

  return weeks
}

// ─── Day-of-week assignment ─────────────────────────────────────────────────

const DEFAULT_DAY_SPREADS: Record<number, number[]> = {
  1: [1],                      // Mon
  2: [1, 4],                   // Mon, Thu
  3: [1, 3, 5],                // Mon, Wed, Fri
  4: [1, 2, 4, 5],             // Mon, Tue, Thu, Fri
  5: [1, 2, 3, 5, 6],          // Mon, Tue, Wed, Fri, Sat
  6: [1, 2, 3, 4, 5, 6],       // Mon-Sat
  7: [1, 2, 3, 4, 5, 6, 7],    // Every day
}

function getDayNumbers(sessionsPerWeek: number, preferredDays?: number[] | null): number[] {
  if (preferredDays?.length === sessionsPerWeek) {
    return preferredDays
  }
  return DEFAULT_DAY_SPREADS[sessionsPerWeek] ?? DEFAULT_DAY_SPREADS[3]
}

// ─── Main builder ───────────────────────────────────────────────────────────

export function buildProgramPlan(
  analysis: ProfileAnalysis,
  request: AiGenerationRequest,
  preferredDays?: number[] | null,
): SessionContext[] {
  const sessions: SessionContext[] = []

  const dayTemplates = getDayTemplates(
    analysis.recommended_split,
    request.sessions_per_week
  )
  const weekPhases = getWeekPhases(
    analysis.recommended_periodization,
    request.duration_weeks
  )
  const dayNumbers = getDayNumbers(request.sessions_per_week, preferredDays)

  for (const wp of weekPhases) {
    for (let i = 0; i < dayTemplates.length; i++) {
      sessions.push({
        week_number: wp.week_number,
        day_of_week: dayNumbers[i],
        phase: wp.phase,
        intensity_modifier: wp.intensity_modifier,
        label: dayTemplates[i].label,
        focus: dayTemplates[i].focus,
        slot_prefix: `w${wp.week_number}d${dayNumbers[i]}`,
      })
    }
  }

  return sessions
}
