/**
 * Seeds 10 test clients, each with:
 *  - User account (testN@client.com / password123)
 *  - Client profile (complete data)
 *  - 1 program built from REAL exercises in the DB
 *  - Program assignment (active)
 *  - Completed initial assessment
 *
 * Non-destructive — only cleans up data for these specific test clients.
 *
 * Run: npx tsx scripts/seed-test-client.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Fixed IDs ──────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-000000000001"

// bcrypt hash of "password123" (generated with bcryptjs, 12 rounds)
const PASSWORD_HASH = "$2b$12$iPa7C.O5i1QC7Z/.jufFWO6unJYCfBOCfdERL4ogheRgRdbHuKosa"

const today = new Date().toISOString().slice(0, 10)

// ─── Helper to generate deterministic UUIDs per client index ────────────────

function clientId(n: number)     { return `20000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}` }
function programId(n: number)    { return `20000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}` }
function assignmentId(n: number) { return `20000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}` }
function assessmentId(n: number) { return `20000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}` }

// ─── Client definitions ────────────────────────────────────────────────────

interface ClientDef {
  first_name: string
  last_name: string
  email: string
  dob: string
  gender: string
  sport: string
  position: string | null
  experience_level: string
  goals: string
  injuries: string | null
  height_cm: number
  weight_kg: number
  weight_unit: string
  emergency_name: string
  emergency_phone: string
  equipment: string[]
  session_minutes: number
  training_days: number
  injury_details: { area: string; side: string; severity: string; notes: string }[]
  training_years: number
  sleep_hours: string
  stress_level: string
  occupation_activity: string
  movement_confidence: string
  exercise_likes: string
  exercise_dislikes: string
  training_background: string
  additional_notes: string
  // Program
  program_name: string
  program_desc: string
  program_category: string[]
  program_difficulty: string
  program_weeks: number
  program_sessions: number
  program_split: string
  program_periodization: string
  // Assessment
  assessment_levels: Record<string, string>
  max_difficulty: number
  // Which movement screen order_index values answer "yes"
  movement_yes: number[]
  // Exercise selection preferences (movement patterns to prioritize)
  preferred_patterns: string[]
}

const clients: ClientDef[] = [
  {
    first_name: "Alex", last_name: "Turner", email: "test1@client.com",
    dob: "1996-08-12", gender: "male", sport: "Basketball", position: "Point Guard",
    experience_level: "intermediate",
    goals: "Goals: muscle_gain, sport_specific | Likes: compound lifts, explosive movements | Dislikes: long-distance cardio",
    injuries: "Minor right ankle sprain history", height_cm: 185, weight_kg: 82, weight_unit: "kg",
    emergency_name: "Jordan Turner", emergency_phone: "+61 400 999 001",
    equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "cable_machine", "kettlebell", "leg_press"],
    session_minutes: 60, training_days: 4,
    injury_details: [{ area: "ankle", side: "right", severity: "mild", notes: "Old sprain — healed" }],
    training_years: 4, sleep_hours: "7", stress_level: "moderate", occupation_activity: "moderate",
    movement_confidence: "comfortable", exercise_likes: "Squats, bench, jumps", exercise_dislikes: "Long runs",
    training_background: "4 years gym, 8 years basketball", additional_notes: "Improve vertical jump",
    program_name: "Upper / Lower Power & Hypertrophy", program_desc: "4-day upper/lower split blending strength and hypertrophy.",
    program_category: ["strength", "sport_specific"], program_difficulty: "intermediate", program_weeks: 4, program_sessions: 4,
    program_split: "upper_lower", program_periodization: "undulating",
    assessment_levels: { overall: "intermediate", squat: "intermediate", push: "beginner", pull: "beginner", hinge: "beginner" },
    max_difficulty: 6, movement_yes: [1, 2, 4],
    preferred_patterns: ["push", "pull", "squat", "hinge"],
  },
  {
    first_name: "Mia", last_name: "Chen", email: "test2@client.com",
    dob: "1999-03-25", gender: "female", sport: "Volleyball", position: "Outside Hitter",
    experience_level: "beginner",
    goals: "Goals: general_health, sport_specific | Likes: bodyweight work | Dislikes: heavy barbell lifts",
    injuries: null, height_cm: 175, weight_kg: 66, weight_unit: "kg",
    emergency_name: "Wei Chen", emergency_phone: "+61 400 999 002",
    equipment: ["dumbbells", "bench", "pull_up_bar", "cable_machine", "yoga_mat", "foam_roller"],
    session_minutes: 45, training_days: 3,
    injury_details: [], training_years: 1, sleep_hours: "8_plus", stress_level: "low", occupation_activity: "light",
    movement_confidence: "learning", exercise_likes: "Lunges, planks, jumps", exercise_dislikes: "Heavy deadlifts",
    training_background: "1 year casual gym, plays volleyball recreationally", additional_notes: "Wants to jump higher and prevent knee injuries",
    program_name: "Bodyweight Foundations", program_desc: "3-day beginner program focused on movement quality and bodyweight strength.",
    program_category: ["strength", "recovery"], program_difficulty: "beginner", program_weeks: 6, program_sessions: 3,
    program_split: "full_body", program_periodization: "linear",
    assessment_levels: { overall: "beginner", squat: "beginner", push: "beginner", pull: "beginner", hinge: "beginner" },
    max_difficulty: 3, movement_yes: [1, 4],
    preferred_patterns: ["squat", "lunge", "isometric", "push"],
  },
  {
    first_name: "Liam", last_name: "O'Brien", email: "test3@client.com",
    dob: "1993-11-08", gender: "male", sport: "Powerlifting", position: null,
    experience_level: "advanced",
    goals: "Goals: muscle_gain, strength | Likes: big 3, accessories | Dislikes: cardio",
    injuries: "Mild lower back tightness", height_cm: 180, weight_kg: 95, weight_unit: "kg",
    emergency_name: "Fiona O'Brien", emergency_phone: "+61 400 999 003",
    equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "cable_machine", "belt", "bands"],
    session_minutes: 90, training_days: 5,
    injury_details: [{ area: "lower_back", side: "bilateral", severity: "mild", notes: "Tightness after heavy pulls — manages with mobility" }],
    training_years: 8, sleep_hours: "7", stress_level: "moderate", occupation_activity: "sedentary",
    movement_confidence: "proficient", exercise_likes: "Squat, bench, deadlift", exercise_dislikes: "Running, machines",
    training_background: "8 years powerlifting, competed at state level", additional_notes: "Prepping for next comp in 12 weeks",
    program_name: "Powerlifting Peaking Block", program_desc: "5-day competition prep focusing on SBD specificity with accessory work.",
    program_category: ["strength"], program_difficulty: "advanced", program_weeks: 8, program_sessions: 5,
    program_split: "push_pull_legs", program_periodization: "block",
    assessment_levels: { overall: "advanced", squat: "advanced", push: "advanced", pull: "advanced", hinge: "advanced" },
    max_difficulty: 9, movement_yes: [1, 2, 3, 4],
    preferred_patterns: ["push", "pull", "squat", "hinge", "lunge"],
  },
  {
    first_name: "Priya", last_name: "Patel", email: "test4@client.com",
    dob: "2001-07-14", gender: "female", sport: "Swimming", position: "Freestyle Sprinter",
    experience_level: "intermediate",
    goals: "Goals: endurance, sport_specific | Likes: pull exercises, core work | Dislikes: heavy squats",
    injuries: "Mild right shoulder impingement", height_cm: 170, weight_kg: 62, weight_unit: "kg",
    emergency_name: "Raj Patel", emergency_phone: "+61 400 999 004",
    equipment: ["dumbbells", "cable_machine", "pull_up_bar", "bands", "medicine_ball", "bench"],
    session_minutes: 50, training_days: 4,
    injury_details: [{ area: "shoulder", side: "right", severity: "moderate", notes: "Impingement — avoid heavy overhead pressing" }],
    training_years: 3, sleep_hours: "7", stress_level: "moderate", occupation_activity: "light",
    movement_confidence: "comfortable", exercise_likes: "Rows, lat pulldowns, core", exercise_dislikes: "Heavy overhead press",
    training_background: "3 years gym, competitive swimmer since age 10", additional_notes: "Focus on shoulder health and pull power",
    program_name: "Swim-Specific Strength", program_desc: "4-day program emphasizing pull strength, core stability, and shoulder prehab.",
    program_category: ["strength", "sport_specific"], program_difficulty: "intermediate", program_weeks: 6, program_sessions: 4,
    program_split: "upper_lower", program_periodization: "undulating",
    assessment_levels: { overall: "intermediate", squat: "beginner", push: "beginner", pull: "intermediate", hinge: "intermediate" },
    max_difficulty: 5, movement_yes: [1, 4],
    preferred_patterns: ["pull", "rotation", "isometric", "hinge"],
  },
  {
    first_name: "Noah", last_name: "Williams", email: "test5@client.com",
    dob: "1990-01-30", gender: "male", sport: "Rugby League", position: "Lock Forward",
    experience_level: "advanced",
    goals: "Goals: muscle_gain, sport_specific, endurance | Likes: everything | Dislikes: nothing",
    injuries: null, height_cm: 190, weight_kg: 105, weight_unit: "kg",
    emergency_name: "Sarah Williams", emergency_phone: "+61 400 999 005",
    equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "cable_machine", "kettlebell", "sled", "battle_ropes", "plyo_box"],
    session_minutes: 75, training_days: 5,
    injury_details: [], training_years: 10, sleep_hours: "8_plus", stress_level: "low", occupation_activity: "heavy",
    movement_confidence: "expert", exercise_likes: "All compound and explosive lifts", exercise_dislikes: "None",
    training_background: "10 years serious training, semi-pro rugby league", additional_notes: "In-season — manage fatigue alongside games",
    program_name: "In-Season Rugby Power", program_desc: "5-day in-season program balancing match recovery with power and speed maintenance.",
    program_category: ["strength", "sport_specific", "conditioning"], program_difficulty: "advanced", program_weeks: 4, program_sessions: 5,
    program_split: "upper_lower", program_periodization: "undulating",
    assessment_levels: { overall: "advanced", squat: "advanced", push: "advanced", pull: "advanced", hinge: "advanced" },
    max_difficulty: 9, movement_yes: [1, 2, 3, 4],
    preferred_patterns: ["push", "pull", "squat", "hinge", "locomotion", "carry"],
  },
  {
    first_name: "Chloe", last_name: "Kim", email: "test6@client.com",
    dob: "2003-09-18", gender: "female", sport: "Netball", position: "Goal Shooter",
    experience_level: "beginner",
    goals: "Goals: general_health, sport_specific | Likes: leg work, jumping | Dislikes: upper body heavy lifting",
    injuries: null, height_cm: 180, weight_kg: 72, weight_unit: "kg",
    emergency_name: "David Kim", emergency_phone: "+61 400 999 006",
    equipment: ["dumbbells", "bench", "yoga_mat", "foam_roller", "bands"],
    session_minutes: 40, training_days: 3,
    injury_details: [], training_years: 0, sleep_hours: "7", stress_level: "low", occupation_activity: "moderate",
    movement_confidence: "learning", exercise_likes: "Lunges, glute bridges, box jumps", exercise_dislikes: "Bench press, pull-ups",
    training_background: "No gym experience, plays club netball", additional_notes: "First time training — needs confidence building",
    program_name: "First Steps: Movement Mastery", program_desc: "3-day beginner program teaching fundamental movement patterns with light loads.",
    program_category: ["strength", "recovery"], program_difficulty: "beginner", program_weeks: 8, program_sessions: 3,
    program_split: "full_body", program_periodization: "linear",
    assessment_levels: { overall: "beginner", squat: "beginner", push: "beginner", pull: "beginner", hinge: "beginner" },
    max_difficulty: 2, movement_yes: [1],
    preferred_patterns: ["squat", "lunge", "hinge", "isometric"],
  },
  {
    first_name: "Ethan", last_name: "Brooks", email: "test7@client.com",
    dob: "1988-04-05", gender: "male", sport: "Triathlon", position: null,
    experience_level: "intermediate",
    goals: "Goals: endurance, general_health | Likes: conditioning, core | Dislikes: very heavy lifting",
    injuries: "Left IT band tightness", height_cm: 178, weight_kg: 74, weight_unit: "kg",
    emergency_name: "Amy Brooks", emergency_phone: "+61 400 999 007",
    equipment: ["dumbbells", "bench", "cable_machine", "kettlebell", "bands", "foam_roller", "yoga_mat"],
    session_minutes: 45, training_days: 3,
    injury_details: [{ area: "knee", side: "left", severity: "mild", notes: "IT band — foam roll before sessions" }],
    training_years: 5, sleep_hours: "6", stress_level: "high", occupation_activity: "sedentary",
    movement_confidence: "comfortable", exercise_likes: "Kettlebells, circuits, planks", exercise_dislikes: "Max effort barbell",
    training_background: "5 years endurance sports, minimal strength work", additional_notes: "Wants to add strength without gaining mass",
    program_name: "Endurance Athlete Strength", program_desc: "3-day supplemental strength program for endurance athletes — low volume, high impact.",
    program_category: ["strength", "conditioning"], program_difficulty: "intermediate", program_weeks: 6, program_sessions: 3,
    program_split: "full_body", program_periodization: "linear",
    assessment_levels: { overall: "intermediate", squat: "beginner", push: "intermediate", pull: "beginner", hinge: "intermediate" },
    max_difficulty: 5, movement_yes: [1, 2, 4],
    preferred_patterns: ["hinge", "isometric", "rotation", "push"],
  },
  {
    first_name: "Sophie", last_name: "Martinez", email: "test8@client.com",
    dob: "1997-12-01", gender: "female", sport: "CrossFit", position: null,
    experience_level: "advanced",
    goals: "Goals: muscle_gain, endurance | Likes: Olympic lifts, gymnastics | Dislikes: isolation machines",
    injuries: "Previous left wrist sprain", height_cm: 163, weight_kg: 60, weight_unit: "kg",
    emergency_name: "Carlos Martinez", emergency_phone: "+61 400 999 008",
    equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "kettlebell", "plyo_box", "battle_ropes", "medicine_ball", "sled"],
    session_minutes: 75, training_days: 5,
    injury_details: [{ area: "wrist", side: "left", severity: "mild", notes: "Old sprain — wrap for heavy front rack" }],
    training_years: 6, sleep_hours: "8_plus", stress_level: "low", occupation_activity: "moderate",
    movement_confidence: "proficient", exercise_likes: "Squats, pull-ups, KB swings", exercise_dislikes: "Machine-only work",
    training_background: "6 years CrossFit, competed at regional level", additional_notes: "Training for CrossFit Open",
    program_name: "CrossFit Competition Prep", program_desc: "5-day hybrid strength & metabolic conditioning for competitive CrossFit.",
    program_category: ["strength", "conditioning", "sport_specific"], program_difficulty: "advanced", program_weeks: 6, program_sessions: 5,
    program_split: "push_pull_legs", program_periodization: "undulating",
    assessment_levels: { overall: "advanced", squat: "advanced", push: "intermediate", pull: "advanced", hinge: "intermediate" },
    max_difficulty: 8, movement_yes: [1, 2, 3, 4],
    preferred_patterns: ["squat", "pull", "hinge", "push", "locomotion"],
  },
  {
    first_name: "Daniel", last_name: "Foster", email: "test9@client.com",
    dob: "1985-06-20", gender: "male", sport: "Golf", position: null,
    experience_level: "beginner",
    goals: "Goals: general_health, flexibility | Likes: core, mobility | Dislikes: heavy compounds",
    injuries: "Chronic lower back pain", height_cm: 182, weight_kg: 88, weight_unit: "kg",
    emergency_name: "Claire Foster", emergency_phone: "+61 400 999 009",
    equipment: ["dumbbells", "cable_machine", "bands", "yoga_mat", "foam_roller"],
    session_minutes: 40, training_days: 3,
    injury_details: [{ area: "lower_back", side: "bilateral", severity: "moderate", notes: "Chronic — avoid loaded spinal flexion" }],
    training_years: 1, sleep_hours: "6", stress_level: "high", occupation_activity: "sedentary",
    movement_confidence: "learning", exercise_likes: "Rotational work, stretching", exercise_dislikes: "Deadlifts, heavy squats",
    training_background: "1 year casual gym, plays golf 3x/week", additional_notes: "Focus on rotational power and back pain management",
    program_name: "Golf Performance & Mobility", program_desc: "3-day program for rotational power, core stability, and mobility for golfers.",
    program_category: ["strength", "recovery", "sport_specific"], program_difficulty: "beginner", program_weeks: 8, program_sessions: 3,
    program_split: "full_body", program_periodization: "linear",
    assessment_levels: { overall: "beginner", squat: "beginner", push: "beginner", pull: "beginner", hinge: "beginner" },
    max_difficulty: 3, movement_yes: [1],
    preferred_patterns: ["rotation", "isometric", "push", "pull"],
  },
  {
    first_name: "Zara", last_name: "Hassan", email: "test10@client.com",
    dob: "2000-02-14", gender: "female", sport: "Track & Field", position: "400m Sprinter",
    experience_level: "intermediate",
    goals: "Goals: sport_specific, muscle_gain | Likes: explosive lifts, sprints | Dislikes: long steady cardio",
    injuries: "Right hamstring strain (recovered)", height_cm: 168, weight_kg: 58, weight_unit: "kg",
    emergency_name: "Omar Hassan", emergency_phone: "+61 400 999 010",
    equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "plyo_box", "sled", "bands"],
    session_minutes: 60, training_days: 4,
    injury_details: [{ area: "hamstring", side: "right", severity: "mild", notes: "Grade 1 strain 6 months ago — cleared to train, extra warm-up" }],
    training_years: 5, sleep_hours: "8_plus", stress_level: "moderate", occupation_activity: "light",
    movement_confidence: "comfortable", exercise_likes: "Hip thrusts, box jumps, RDLs", exercise_dislikes: "Long slow runs",
    training_background: "5 years track, 3 years gym", additional_notes: "Preparing for nationals — focus on speed and power",
    program_name: "Sprint Power Development", program_desc: "4-day program for 400m sprinters — explosive strength, hip power, and speed work.",
    program_category: ["strength", "sport_specific"], program_difficulty: "intermediate", program_weeks: 6, program_sessions: 4,
    program_split: "upper_lower", program_periodization: "block",
    assessment_levels: { overall: "intermediate", squat: "intermediate", push: "beginner", pull: "beginner", hinge: "intermediate" },
    max_difficulty: 6, movement_yes: [1, 2, 4],
    preferred_patterns: ["hinge", "squat", "locomotion", "push", "pull"],
  },
]

// ─── Exercise pool type ─────────────────────────────────────────────────────

interface DBExercise {
  id: string
  name: string
  movement_pattern: string
  difficulty: string
}

// ─── Build program exercises dynamically from DB exercises ──────────────────

interface ProgramExerciseRow {
  program_id: string
  exercise_id: string
  day_of_week: number
  week_number: number
  order_index: number
  sets: number
  reps: string | null
  rest_seconds: number
  notes: string
  rpe_target: number | null
  tempo?: string
  technique: string
  group_tag?: string
  duration_seconds?: number
}

/** Pick a random exercise from pool matching the pattern + difficulty preference */
function pickExercise(
  pool: Map<string, DBExercise[]>,
  pattern: string,
  difficulty: string,
  used: Set<string>
): DBExercise | null {
  const candidates = pool.get(pattern)?.filter(e => !used.has(e.id)) ?? []

  // Prefer matching difficulty, fall back to any
  const preferred = candidates.filter(e => e.difficulty === difficulty)
  const list = preferred.length > 0 ? preferred : candidates
  if (list.length === 0) return null

  const pick = list[Math.floor(Math.random() * list.length)]
  used.add(pick.id)
  return pick
}

/** RPE and rest defaults by difficulty */
function defaults(difficulty: string) {
  if (difficulty === "beginner") return { sets: 3, rpe: 6, rest: 60, tempo: "3010" }
  if (difficulty === "advanced") return { sets: 4, rpe: 8, rest: 120, tempo: "2010" }
  return { sets: 3, rpe: 7, rest: 90, tempo: "2010" }
}

/** Build exercises for a full_body split (3 days) */
function buildFullBody(pid: string, diff: string, patterns: string[], pool: Map<string, DBExercise[]>): ProgramExerciseRow[] {
  const d = defaults(diff)
  const rows: ProgramExerciseRow[] = []
  const used = new Set<string>()
  const days = [1, 3, 5]

  for (const dayOfWeek of days) {
    // 4-5 exercises per day from preferred patterns
    const dayPatterns = [...patterns, "isometric"].slice(0, 5)
    dayPatterns.forEach((pat, idx) => {
      const ex = pickExercise(pool, pat, diff, used)
      if (!ex) return
      const isIso = pat === "isometric"
      rows.push({
        program_id: pid, exercise_id: ex.id,
        day_of_week: dayOfWeek, week_number: 1, order_index: idx,
        sets: isIso ? 3 : d.sets,
        reps: isIso ? null : (diff === "beginner" ? "10-12" : "6-8"),
        rest_seconds: isIso ? 45 : d.rest,
        notes: ex.name,
        rpe_target: isIso ? null : d.rpe,
        tempo: isIso ? undefined : d.tempo,
        technique: "straight_set",
        duration_seconds: isIso ? 30 : undefined,
      })
    })
  }
  return rows
}

/** Build exercises for an upper_lower split (4 days) */
function buildUpperLower(pid: string, diff: string, patterns: string[], pool: Map<string, DBExercise[]>): ProgramExerciseRow[] {
  const d = defaults(diff)
  const rows: ProgramExerciseRow[] = []
  const used = new Set<string>()

  // Day 1: Upper — push + pull focused
  const upper1 = ["push", "pull", "push", "pull", "isometric"]
  // Day 2: Lower — squat + hinge focused
  const lower1 = ["squat", "hinge", "lunge", "squat", "isometric"]
  // Day 4: Upper 2
  const upper2 = ["pull", "push", "rotation", "pull"]
  // Day 5: Lower 2
  const lower2 = ["hinge", "squat", "lunge", "locomotion"]

  const dayTemplates: [number, string[]][] = [[1, upper1], [2, lower1], [4, upper2], [5, lower2]]

  for (const [dayOfWeek, dayPatterns] of dayTemplates) {
    dayPatterns.forEach((pat, idx) => {
      const ex = pickExercise(pool, pat, diff, used)
      if (!ex) return
      const isIso = pat === "isometric"
      rows.push({
        program_id: pid, exercise_id: ex.id,
        day_of_week: dayOfWeek, week_number: 1, order_index: idx,
        sets: isIso ? 3 : d.sets,
        reps: isIso ? null : (diff === "advanced" ? "3-5" : diff === "beginner" ? "10-12" : "6-8"),
        rest_seconds: isIso ? 45 : d.rest,
        notes: ex.name,
        rpe_target: isIso ? null : d.rpe,
        tempo: isIso ? undefined : d.tempo,
        technique: "straight_set",
        duration_seconds: isIso ? 30 : undefined,
      })
    })
  }
  return rows
}

/** Build exercises for a push_pull_legs split (5 days) */
function buildPPL(pid: string, diff: string, patterns: string[], pool: Map<string, DBExercise[]>): ProgramExerciseRow[] {
  const d = defaults(diff)
  const rows: ProgramExerciseRow[] = []
  const used = new Set<string>()

  const dayTemplates: [number, string[]][] = [
    [1, ["push", "push", "push", "push", "isometric"]],       // Push
    [2, ["pull", "pull", "pull", "pull", "rotation"]],         // Pull
    [3, ["squat", "hinge", "lunge", "squat", "isometric"]],    // Legs
    [4, ["push", "pull", "push", "pull"]],                     // Upper
    [5, ["hinge", "squat", "lunge", "locomotion", "carry"]],   // Lower
  ]

  for (const [dayOfWeek, dayPatterns] of dayTemplates) {
    dayPatterns.forEach((pat, idx) => {
      const ex = pickExercise(pool, pat, diff, used)
      if (!ex) return
      const isIso = pat === "isometric"
      rows.push({
        program_id: pid, exercise_id: ex.id,
        day_of_week: dayOfWeek, week_number: 1, order_index: idx,
        sets: isIso ? 3 : d.sets,
        reps: isIso ? null : (diff === "advanced" ? "3-5" : "6-8"),
        rest_seconds: isIso ? 45 : (diff === "advanced" ? 150 : d.rest),
        notes: ex.name,
        rpe_target: isIso ? null : d.rpe,
        tempo: isIso ? undefined : d.tempo,
        technique: "straight_set",
        duration_seconds: isIso ? 30 : undefined,
      })
    })
  }
  return rows
}

function buildExercises(pid: string, split: string, difficulty: string, patterns: string[], pool: Map<string, DBExercise[]>): ProgramExerciseRow[] {
  if (split === "full_body") return buildFullBody(pid, difficulty, patterns, pool)
  if (split === "push_pull_legs") return buildPPL(pid, difficulty, patterns, pool)
  return buildUpperLower(pid, difficulty, patterns, pool)
}

// ─── Execute ────────────────────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Seeding 10 test clients...\n")

  // ── Load exercises from DB ──────────────────────────────────────────────
  console.log("  Loading exercises from database...")
  const { data: allExercises, error: exErr } = await supabase
    .from("exercises")
    .select("id, name, movement_pattern, difficulty")
    .eq("is_active", true)
  if (exErr) throw new Error(`Fetching exercises: ${exErr.message}`)

  // Group by movement_pattern
  const exercisePool = new Map<string, DBExercise[]>()
  for (const e of allExercises ?? []) {
    const mp = e.movement_pattern || "unknown"
    if (!exercisePool.has(mp)) exercisePool.set(mp, [])
    exercisePool.get(mp)!.push(e as DBExercise)
  }

  const patternCounts = Array.from(exercisePool.entries())
    .map(([k, v]) => `${k}(${v.length})`)
    .join(", ")
  console.log(`  ✓ ${allExercises!.length} exercises loaded: ${patternCounts}\n`)

  // ── Load assessment questions ───────────────────────────────────────────
  const { data: questions, error: qErr } = await supabase
    .from("assessment_questions")
    .select("id, section, movement_pattern, question_text, order_index")
    .eq("is_active", true)
    .order("order_index", { ascending: true })
  if (qErr) throw new Error(`Fetching questions: ${qErr.message}`)

  for (let i = 0; i < clients.length; i++) {
    const c = clients[i]
    const n = i + 1
    const cid = clientId(n)
    const pid = programId(n)
    const aid = assignmentId(n)
    const asid = assessmentId(n)

    console.log(`  ── Client ${n}/10: ${c.first_name} ${c.last_name} ──`)

    // Clean previous data for this client
    await supabase.from("assessment_results").delete().eq("user_id", cid)
    await supabase.from("exercise_progress").delete().eq("user_id", cid)
    await supabase.from("program_assignments").delete().eq("user_id", cid)
    await supabase.from("program_exercises").delete().eq("program_id", pid)
    await supabase.from("programs").delete().eq("id", pid)
    await supabase.from("client_profiles").delete().eq("user_id", cid)
    await supabase.from("users").delete().eq("id", cid)

    // User
    const { error: userErr } = await supabase.from("users").insert({
      id: cid,
      email: c.email,
      password_hash: PASSWORD_HASH,
      first_name: c.first_name,
      last_name: c.last_name,
      role: "client",
      status: "active",
    })
    if (userErr) throw new Error(`User ${n}: ${userErr.message}`)

    // Profile
    const { error: profileErr } = await supabase.from("client_profiles").insert({
      user_id: cid,
      date_of_birth: c.dob,
      gender: c.gender,
      sport: c.sport,
      position: c.position,
      experience_level: c.experience_level,
      goals: c.goals,
      injuries: c.injuries,
      height_cm: c.height_cm,
      weight_kg: c.weight_kg,
      weight_unit: c.weight_unit,
      emergency_contact_name: c.emergency_name,
      emergency_contact_phone: c.emergency_phone,
      available_equipment: c.equipment,
      preferred_session_minutes: c.session_minutes,
      preferred_training_days: c.training_days,
      injury_details: c.injury_details,
      training_years: c.training_years,
      sleep_hours: c.sleep_hours,
      stress_level: c.stress_level,
      occupation_activity_level: c.occupation_activity,
      movement_confidence: c.movement_confidence,
      exercise_likes: c.exercise_likes,
      exercise_dislikes: c.exercise_dislikes,
      training_background: c.training_background,
      additional_notes: c.additional_notes,
    })
    if (profileErr) throw new Error(`Profile ${n}: ${profileErr.message}`)

    // Program
    const { error: progErr } = await supabase.from("programs").insert({
      id: pid,
      name: c.program_name,
      description: c.program_desc,
      category: c.program_category,
      difficulty: c.program_difficulty,
      duration_weeks: c.program_weeks,
      sessions_per_week: c.program_sessions,
      is_active: true,
      created_by: ADMIN_ID,
      split_type: c.program_split,
      periodization: c.program_periodization,
    })
    if (progErr) throw new Error(`Program ${n}: ${progErr.message}`)

    // Program exercises — built dynamically from real DB exercises
    const exercises = buildExercises(pid, c.program_split, c.program_difficulty, c.preferred_patterns, exercisePool)
    if (exercises.length === 0) throw new Error(`No exercises generated for client ${n} — check exercise pool`)
    const { error: peErr } = await supabase.from("program_exercises").insert(exercises)
    if (peErr) throw new Error(`Program exercises ${n}: ${peErr.message}`)

    // Assignment
    const { error: assignErr } = await supabase.from("program_assignments").insert({
      id: aid,
      program_id: pid,
      user_id: cid,
      assigned_by: ADMIN_ID,
      start_date: today,
      status: "active",
      current_week: 1,
      total_weeks: c.program_weeks,
    })
    if (assignErr) throw new Error(`Assignment ${n}: ${assignErr.message}`)

    // Assessment
    const answers: Record<string, string> = {}
    for (const q of questions ?? []) {
      if (q.section === "movement_screen") {
        answers[q.id] = c.movement_yes.includes(q.order_index) ? "yes" : "no"
      }
    }

    const { error: assessErr } = await supabase.from("assessment_results").insert({
      id: asid,
      user_id: cid,
      assessment_type: "initial",
      answers,
      computed_levels: c.assessment_levels,
      max_difficulty_score: c.max_difficulty,
      triggered_program_id: pid,
      completed_at: new Date().toISOString(),
    })
    if (assessErr) throw new Error(`Assessment ${n}: ${assessErr.message}`)

    console.log(`     ✓ ${c.email} | ${c.sport} | ${c.experience_level} | ${exercises.length} exercises\n`)
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("  All 10 test clients seeded!  (password: password123)\n")
  console.log("  #   Email                Sport            Level")
  console.log("  ─── ──────────────────── ──────────────── ────────────")
  clients.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${c.email.padEnd(20)} ${c.sport.padEnd(16)} ${c.experience_level}`)
  })
  console.log("═══════════════════════════════════════════════════════════════")
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err.message)
  process.exit(1)
})
