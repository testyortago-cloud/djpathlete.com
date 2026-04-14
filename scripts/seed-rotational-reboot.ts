/**
 * Seed script — Rotational Reboot Program
 *
 * Upserts ~14 rotational/core exercises, creates the "Rotational Reboot"
 * program ($79, 6 weeks, 4 sessions/week), and inserts all 168 program_exercises
 * with 3-phase linear progression (Foundation → Build → Intensify).
 *
 * Safe to run multiple times (upserts + deletes before re-insert).
 *
 * Run: npx tsx scripts/seed-rotational-reboot.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ─── Fixed IDs ──────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const PROGRAM_ROTATIONAL = "00000000-0000-0000-0000-000000000104"

// Reuse existing exercise IDs from seed.ts
const EX = {
  bulgarian_split: "10000000-0000-0000-0000-000000000007",
  med_ball_slam: "10000000-0000-0000-0000-000000000010",
  kb_swing: "10000000-0000-0000-0000-000000000013",
  plank: "10000000-0000-0000-0000-000000000014",
  hip_flexor: "10000000-0000-0000-0000-000000000015",
  push_up: "10000000-0000-0000-0000-000000000028",
}

// New rotational/core exercise IDs
const RX = {
  cable_woodchop_high_low: "20000000-0000-0000-0000-000000000001",
  cable_woodchop_low_high: "20000000-0000-0000-0000-000000000002",
  pallof_press: "20000000-0000-0000-0000-000000000003",
  russian_twist: "20000000-0000-0000-0000-000000000004",
  rotational_mb_throw: "20000000-0000-0000-0000-000000000005",
  dead_bug: "20000000-0000-0000-0000-000000000006",
  bird_dog: "20000000-0000-0000-0000-000000000007",
  side_plank: "20000000-0000-0000-0000-000000000008",
  hk_cable_chop: "20000000-0000-0000-0000-000000000009",
  hk_cable_lift: "20000000-0000-0000-0000-000000000010",
  copenhagen_plank: "20000000-0000-0000-0000-000000000011",
  goblet_squat: "20000000-0000-0000-0000-000000000012",
  sl_rdl: "20000000-0000-0000-0000-000000000013",
  lateral_lunge: "20000000-0000-0000-0000-000000000014",
}

// ─── New Exercises (with full AI metadata) ──────────────────────────────────

const newExercises = [
  {
    id: RX.cable_woodchop_high_low,
    name: "Cable Woodchop High to Low",
    description: "Rotational cable exercise targeting obliques and core through a downward chopping pattern",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "cable machine",
    instructions:
      "Set cable at highest position. Stand sideways to machine, feet shoulder-width apart. Grip handle with both hands. Pull diagonally across body from high to low, rotating through torso. Control the return.",
    movement_pattern: "rotation",
    force_type: "pull",
    laterality: "unilateral",
    primary_muscles: ["obliques", "core"],
    secondary_muscles: ["shoulders", "hip_flexors"],
    equipment_required: ["cable_machine"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.cable_woodchop_low_high,
    name: "Cable Woodchop Low to High",
    description: "Rotational cable exercise targeting obliques through an upward lifting pattern",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "cable machine",
    instructions:
      "Set cable at lowest position. Stand sideways to machine, feet shoulder-width apart. Grip handle with both hands at hip level. Drive diagonally across body from low to high, rotating through torso. Control the return.",
    movement_pattern: "rotation",
    force_type: "push",
    laterality: "unilateral",
    primary_muscles: ["obliques", "core"],
    secondary_muscles: ["shoulders", "glutes"],
    equipment_required: ["cable_machine"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.pallof_press,
    name: "Pallof Press",
    description: "Anti-rotation core exercise using cable or band resistance to build rotational stability",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "cable machine or resistance band",
    instructions:
      "Stand sideways to cable/band anchor at chest height. Hold handle at chest with both hands. Press arms straight out in front, resisting the pull to rotate. Hold briefly, return to chest. Keep hips and shoulders square throughout.",
    movement_pattern: "isometric",
    force_type: "push",
    laterality: "unilateral",
    primary_muscles: ["core", "obliques"],
    secondary_muscles: ["shoulders", "glutes"],
    equipment_required: ["cable_machine"],
    is_bodyweight: false,
    training_intent: ["build"],
  },
  {
    id: RX.russian_twist,
    name: "Russian Twist",
    description: "Seated rotational core exercise for oblique strength and rotational endurance",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "none (optional medicine ball)",
    instructions:
      "Sit on floor with knees bent, feet slightly elevated. Lean back to 45 degrees. Rotate torso side to side, touching hands (or med ball) to floor beside each hip. Keep core braced throughout.",
    movement_pattern: "rotation",
    force_type: "dynamic",
    laterality: "bilateral",
    primary_muscles: ["obliques", "core"],
    secondary_muscles: ["hip_flexors"],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
  },
  {
    id: RX.rotational_mb_throw,
    name: "Rotational Med Ball Throw",
    description: "Explosive rotational power exercise using a medicine ball throw against a wall",
    category: "plyometric",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "medicine ball, wall",
    instructions:
      "Stand sideways to wall, feet shoulder-width apart. Hold med ball at hip. Rotate explosively through hips and torso, releasing ball into wall. Catch and reset. Perform all reps on one side before switching.",
    movement_pattern: "rotation",
    force_type: "dynamic",
    laterality: "unilateral",
    primary_muscles: ["obliques", "core", "glutes"],
    secondary_muscles: ["shoulders", "hip_flexors"],
    equipment_required: ["medicine_ball"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.dead_bug,
    name: "Dead Bug",
    description: "Anti-extension core exercise that builds stability while training coordinated limb movement",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "none",
    instructions:
      "Lie on back with arms extended toward ceiling, knees bent at 90 degrees. Slowly lower opposite arm and leg toward floor while pressing lower back into ground. Return to start and alternate sides.",
    movement_pattern: "isometric",
    force_type: "static",
    laterality: "bilateral",
    primary_muscles: ["core", "rectus_abdominis"],
    secondary_muscles: ["hip_flexors"],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
  },
  {
    id: RX.bird_dog,
    name: "Bird Dog",
    description: "Anti-rotation stability exercise performed on hands and knees with opposite arm/leg extension",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "none",
    instructions:
      "Start on hands and knees, wrists under shoulders, knees under hips. Extend opposite arm and leg simultaneously until parallel with floor. Hold briefly, return with control. Alternate sides. Keep hips level throughout.",
    movement_pattern: "isometric",
    force_type: "static",
    laterality: "alternating",
    primary_muscles: ["core", "erector_spinae"],
    secondary_muscles: ["glutes", "shoulders"],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
  },
  {
    id: RX.side_plank,
    name: "Side Plank",
    description: "Lateral isometric core hold for oblique strength and lateral stability",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "none",
    instructions:
      "Lie on side with forearm on ground, elbow under shoulder. Stack feet or stagger them. Lift hips off ground, forming a straight line from head to feet. Hold position, brace core. Switch sides.",
    movement_pattern: "isometric",
    force_type: "static",
    laterality: "unilateral",
    primary_muscles: ["obliques", "core"],
    secondary_muscles: ["glutes", "shoulders"],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
  },
  {
    id: RX.hk_cable_chop,
    name: "Half-Kneeling Cable Chop",
    description: "Rotational cable exercise in a half-kneeling position for core power and hip stability",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "cable machine",
    instructions:
      "Kneel with inside knee down, outside foot forward. Set cable high. Grip handle with both hands. Chop diagonally from high to low across body, rotating through torso. Maintain tall kneeling posture throughout.",
    movement_pattern: "rotation",
    force_type: "pull",
    laterality: "unilateral",
    primary_muscles: ["obliques", "core"],
    secondary_muscles: ["shoulders", "glutes"],
    equipment_required: ["cable_machine"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.hk_cable_lift,
    name: "Half-Kneeling Cable Lift",
    description: "Rotational cable exercise in a half-kneeling position emphasizing upward diagonal power",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "cable machine",
    instructions:
      "Kneel with inside knee down, outside foot forward. Set cable low. Grip handle with both hands at hip. Lift diagonally from low to high across body, rotating through torso. Keep hips stable and drive from core.",
    movement_pattern: "rotation",
    force_type: "push",
    laterality: "unilateral",
    primary_muscles: ["obliques", "core"],
    secondary_muscles: ["shoulders", "glutes"],
    equipment_required: ["cable_machine"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.copenhagen_plank,
    name: "Copenhagen Plank",
    description: "Lateral plank variation with adductor engagement for groin and core stability",
    category: "strength",
    muscle_group: "core",
    difficulty: "beginner",
    equipment: "bench",
    instructions:
      "Lie on side with top foot on bench, bottom leg hanging free. Place forearm on ground under shoulder. Lift hips to create straight line from head to top foot. Hold position. For regression, bend top knee on bench.",
    movement_pattern: "isometric",
    force_type: "static",
    laterality: "unilateral",
    primary_muscles: ["obliques", "adductors"],
    secondary_muscles: ["core", "glutes"],
    equipment_required: ["bench"],
    is_bodyweight: true,
    training_intent: ["build"],
  },
  {
    id: RX.goblet_squat,
    name: "Goblet Squat",
    description: "Front-loaded squat variation using a dumbbell or kettlebell held at chest level",
    category: "strength",
    muscle_group: "legs",
    difficulty: "beginner",
    equipment: "dumbbell or kettlebell",
    instructions:
      "Hold dumbbell/kettlebell at chest with both hands, elbows pointing down. Feet shoulder-width apart. Squat down keeping chest tall and weight in midfoot. Drive through feet to stand.",
    movement_pattern: "squat",
    force_type: "push",
    laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes"],
    secondary_muscles: ["core", "hamstrings"],
    equipment_required: ["dumbbells"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.sl_rdl,
    name: "Single-Leg Romanian Deadlift",
    description: "Unilateral hip hinge for hamstring strength, balance, and posterior chain stability",
    category: "strength",
    muscle_group: "legs",
    difficulty: "intermediate",
    equipment: "dumbbell",
    instructions:
      "Stand on one leg holding dumbbell in opposite hand. Hinge at hip, lowering weight toward floor while extending free leg behind. Keep back flat and hips square. Drive through standing leg to return to upright.",
    movement_pattern: "hinge",
    force_type: "pull",
    laterality: "unilateral",
    primary_muscles: ["hamstrings", "glutes"],
    secondary_muscles: ["core", "erector_spinae"],
    equipment_required: ["dumbbells"],
    is_bodyweight: false,
    training_intent: ["build", "shape"],
  },
  {
    id: RX.lateral_lunge,
    name: "Lateral Lunge",
    description: "Frontal-plane lunge variation for adductor strength and lateral movement capacity",
    category: "strength",
    muscle_group: "legs",
    difficulty: "beginner",
    equipment: "none (optional dumbbell)",
    instructions:
      "Stand with feet together. Step wide to one side, pushing hips back and bending stepping knee. Keep trailing leg straight. Push off bent leg to return to start. Alternate sides or complete all reps on one side.",
    movement_pattern: "lunge",
    force_type: "push",
    laterality: "unilateral",
    primary_muscles: ["quadriceps", "glutes", "adductors"],
    secondary_muscles: ["hamstrings", "core"],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build", "shape"],
  },
]

// ─── Program Record ─────────────────────────────────────────────────────────

const program = {
  id: PROGRAM_ROTATIONAL,
  name: "Rotational Reboot",
  description:
    "Designed for athletes who play rotational sports — tennis, golf, lacrosse, soccer. 6 weeks of progressive core and rotational training to build power transfer, anti-rotation stability, and injury resilience.",
  category: "power",
  difficulty: "beginner",
  duration_weeks: 6,
  sessions_per_week: 4,
  price_cents: 7900,
  is_active: true,
  created_by: ADMIN_ID,
  split_type: "movement_pattern",
  periodization: "linear",
  is_ai_generated: false,
}

// ─── Program Exercises (6 weeks × 4 days × 7 exercises = 168 rows) ─────────

type Phase = {
  sets: number
  reps: string
  rpe: number | null
  tempo: string | null
  notes: string | null
}

type ExSlot = {
  exercise_id: string
  rest_seconds: number
  foundation: Phase // weeks 1-2
  build: Phase // weeks 3-4
  intensify: Phase // weeks 5-6
}

// Day 1 (Mon = 1): Anti-Rotation & Lower Body
const day1: ExSlot[] = [
  {
    exercise_id: RX.pallof_press,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "8/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "10/side", rpe: 6, tempo: "2020", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2020", notes: "Increase cable weight" },
  },
  {
    exercise_id: RX.dead_bug,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "10", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12", rpe: 6, tempo: "3010", notes: null },
    intensify: { sets: 4, reps: "15", rpe: 7, tempo: "3010", notes: null },
  },
  {
    exercise_id: RX.bird_dog,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "8/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "10/side", rpe: 6, tempo: "2020", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2020", notes: null },
  },
  {
    exercise_id: RX.side_plank,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "20s/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "30s/side", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "40s/side", rpe: 7, tempo: null, notes: "Add hip dip for extra challenge" },
  },
  {
    exercise_id: EX.plank,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "30s", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "40s", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "45s", rpe: 7, tempo: null, notes: null },
  },
  {
    exercise_id: RX.goblet_squat,
    rest_seconds: 90,
    foundation: { sets: 3, reps: "10", rpe: 6, tempo: null, notes: null },
    build: { sets: 3, reps: "12", rpe: 7, tempo: "3010", notes: null },
    intensify: { sets: 4, reps: "12", rpe: 8, tempo: "3010", notes: "Increase load" },
  },
  {
    exercise_id: EX.bulgarian_split,
    rest_seconds: 90,
    foundation: { sets: 3, reps: "8/leg", rpe: 6, tempo: null, notes: null },
    build: { sets: 3, reps: "10/leg", rpe: 7, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "10/leg", rpe: 8, tempo: "2010", notes: "Add dumbbells or increase load" },
  },
]

// Day 2 (Wed = 3): Rotational Power & Push
const day2: ExSlot[] = [
  {
    exercise_id: RX.cable_woodchop_high_low,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "10/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12/side", rpe: 6, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2010", notes: "Explosive pull, controlled return" },
  },
  {
    exercise_id: RX.cable_woodchop_low_high,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "10/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12/side", rpe: 6, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2010", notes: "Drive from hips, explosive lift" },
  },
  {
    exercise_id: RX.rotational_mb_throw,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "8/side", rpe: 6, tempo: null, notes: null },
    build: { sets: 4, reps: "8/side", rpe: 7, tempo: null, notes: null },
    intensify: { sets: 4, reps: "10/side", rpe: 8, tempo: null, notes: "Maximum rotational velocity" },
  },
  {
    exercise_id: RX.russian_twist,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "12", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "15", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "20", rpe: 7, tempo: null, notes: "Add med ball for load" },
  },
  {
    exercise_id: EX.med_ball_slam,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "8", rpe: 6, tempo: null, notes: null },
    build: { sets: 4, reps: "10", rpe: 7, tempo: null, notes: null },
    intensify: { sets: 4, reps: "12", rpe: 8, tempo: null, notes: "Full body explosive power" },
  },
  {
    exercise_id: EX.push_up,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "10", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12", rpe: 6, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "15", rpe: 7, tempo: "2010", notes: null },
  },
  {
    exercise_id: EX.kb_swing,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "12", rpe: 6, tempo: null, notes: null },
    build: { sets: 3, reps: "15", rpe: 7, tempo: null, notes: null },
    intensify: { sets: 4, reps: "15", rpe: 8, tempo: null, notes: "Snap hips explosively" },
  },
]

// Day 3 (Thu = 4): Core Stability & Posterior Chain
const day3: ExSlot[] = [
  {
    exercise_id: RX.hk_cable_chop,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "10/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12/side", rpe: 6, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2010", notes: "Maintain tall kneeling posture" },
  },
  {
    exercise_id: RX.hk_cable_lift,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "10/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12/side", rpe: 6, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2010", notes: "Drive from core, not arms" },
  },
  {
    exercise_id: RX.copenhagen_plank,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "15s/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "20s/side", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "25s/side", rpe: 7, tempo: null, notes: "Extend top leg for progression" },
  },
  {
    exercise_id: RX.dead_bug,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "10", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12", rpe: 6, tempo: "3010", notes: null },
    intensify: { sets: 4, reps: "15", rpe: 7, tempo: "3010", notes: null },
  },
  {
    exercise_id: RX.pallof_press,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "8/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "10/side", rpe: 6, tempo: "2020", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2020", notes: null },
  },
  {
    exercise_id: RX.sl_rdl,
    rest_seconds: 90,
    foundation: { sets: 3, reps: "8/leg", rpe: 6, tempo: null, notes: null },
    build: { sets: 3, reps: "10/leg", rpe: 7, tempo: "3010", notes: null },
    intensify: { sets: 4, reps: "10/leg", rpe: 8, tempo: "3010", notes: "Increase dumbbell weight" },
  },
  {
    exercise_id: EX.hip_flexor,
    rest_seconds: 0,
    foundation: { sets: 2, reps: "30s/side", rpe: null, tempo: null, notes: null },
    build: { sets: 2, reps: "30s/side", rpe: null, tempo: null, notes: null },
    intensify: { sets: 2, reps: "45s/side", rpe: null, tempo: null, notes: null },
  },
]

// Day 4 (Sat = 6): Rotational Endurance & Full Body
const day4: ExSlot[] = [
  {
    exercise_id: RX.cable_woodchop_high_low,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "12/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "15/side", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "15/side", rpe: 7, tempo: null, notes: "Maintain tempo under fatigue" },
  },
  {
    exercise_id: RX.russian_twist,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "15", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "20", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "20", rpe: 7, tempo: null, notes: "Add med ball for load" },
  },
  {
    exercise_id: RX.bird_dog,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "10/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12/side", rpe: 6, tempo: "2020", notes: null },
    intensify: { sets: 4, reps: "12/side", rpe: 7, tempo: "2020", notes: null },
  },
  {
    exercise_id: RX.side_plank,
    rest_seconds: 45,
    foundation: { sets: 3, reps: "20s/side", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "30s/side", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "35s/side", rpe: 7, tempo: null, notes: null },
  },
  {
    exercise_id: RX.rotational_mb_throw,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "8/side", rpe: 6, tempo: null, notes: null },
    build: { sets: 3, reps: "10/side", rpe: 7, tempo: null, notes: null },
    intensify: { sets: 4, reps: "10/side", rpe: 8, tempo: null, notes: "Maximum power output" },
  },
  {
    exercise_id: RX.lateral_lunge,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "8/side", rpe: 6, tempo: null, notes: null },
    build: { sets: 3, reps: "10/side", rpe: 7, tempo: "2010", notes: null },
    intensify: { sets: 4, reps: "10/side", rpe: 8, tempo: "2010", notes: "Add dumbbell load" },
  },
  {
    exercise_id: EX.push_up,
    rest_seconds: 60,
    foundation: { sets: 3, reps: "10", rpe: 5, tempo: null, notes: null },
    build: { sets: 3, reps: "12", rpe: 6, tempo: null, notes: null },
    intensify: { sets: 4, reps: "15", rpe: 7, tempo: null, notes: "Explosive push off ground" },
  },
]

// ─── Row Generator ──────────────────────────────────────────────────────────

function generateRows(daySlots: ExSlot[], dayOfWeek: number) {
  const rows: Record<string, unknown>[] = []
  for (let week = 1; week <= 6; week++) {
    const phaseKey: keyof Pick<ExSlot, "foundation" | "build" | "intensify"> =
      week <= 2 ? "foundation" : week <= 4 ? "build" : "intensify"
    for (let idx = 0; idx < daySlots.length; idx++) {
      const slot = daySlots[idx]
      const p = slot[phaseKey]
      rows.push({
        program_id: PROGRAM_ROTATIONAL,
        exercise_id: slot.exercise_id,
        day_of_week: dayOfWeek,
        week_number: week,
        order_index: idx,
        sets: p.sets,
        reps: p.reps,
        rest_seconds: slot.rest_seconds,
        rpe_target: p.rpe,
        intensity_pct: null,
        tempo: p.tempo,
        group_tag: null,
        notes: p.notes,
      })
    }
  }
  return rows
}

const allProgramExercises = [
  ...generateRows(day1, 1), // Monday
  ...generateRows(day2, 3), // Wednesday
  ...generateRows(day3, 4), // Thursday
  ...generateRows(day4, 6), // Saturday
]

// ─── Execute ────────────────────────────────────────────────────────────────

async function seed() {
  console.log("🏋️ Seeding Rotational Reboot program...\n")

  // 1. Upsert new exercises
  console.log("  Upserting rotational/core exercises...")
  const { error: exErr } = await supabase.from("exercises").upsert(
    newExercises.map((e) => ({ ...e, is_active: true, created_by: ADMIN_ID })),
    { onConflict: "id" },
  )
  if (exErr) throw new Error(`Exercises: ${exErr.message}`)
  console.log(`  ✓ ${newExercises.length} exercises upserted\n`)

  // 2. Upsert program
  console.log("  Upserting program record...")
  const { error: progErr } = await supabase.from("programs").upsert([program], { onConflict: "id" })
  if (progErr) throw new Error(`Program: ${progErr.message}`)
  console.log(`  ✓ Rotational Reboot — $79 / 6 weeks / 4 sessions per week\n`)

  // 3. Clear existing program_exercises for this program (idempotent)
  console.log("  Clearing existing program exercises for this program...")
  const { error: delErr } = await supabase.from("program_exercises").delete().eq("program_id", PROGRAM_ROTATIONAL)
  if (delErr) throw new Error(`Delete program_exercises: ${delErr.message}`)
  console.log("  ✓ Cleared\n")

  // 4. Insert all program_exercises
  console.log("  Inserting program exercises...")
  // Supabase has a row limit per request, so batch in chunks of 50
  const BATCH_SIZE = 50
  let inserted = 0
  for (let i = 0; i < allProgramExercises.length; i += BATCH_SIZE) {
    const batch = allProgramExercises.slice(i, i + BATCH_SIZE)
    const { error: peErr } = await supabase.from("program_exercises").insert(batch)
    if (peErr) throw new Error(`Program exercises batch ${i}: ${peErr.message}`)
    inserted += batch.length
  }
  console.log(`  ✓ ${inserted} program exercises (6 weeks × 4 days × 7 exercises)\n`)

  // 5. Verify counts
  const { count: exCount } = await supabase
    .from("program_exercises")
    .select("*", { count: "exact", head: true })
    .eq("program_id", PROGRAM_ROTATIONAL)
  const { count: coreCount } = await supabase
    .from("program_exercises")
    .select("*", { count: "exact", head: true })
    .eq("program_id", PROGRAM_ROTATIONAL)
    .in("exercise_id", [
      RX.cable_woodchop_high_low,
      RX.cable_woodchop_low_high,
      RX.pallof_press,
      RX.russian_twist,
      RX.rotational_mb_throw,
      RX.dead_bug,
      RX.bird_dog,
      RX.side_plank,
      RX.hk_cable_chop,
      RX.hk_cable_lift,
      RX.copenhagen_plank,
      EX.plank,
      EX.med_ball_slam,
    ])

  console.log("═══════════════════════════════════════════════════════")
  console.log("  Rotational Reboot seeded successfully!")
  console.log("  ─────────────────────────────────────────────────────")
  console.log(`  Program exercises: ${exCount}`)
  console.log(`  Core exercises:    ${coreCount} (${Math.round(((coreCount ?? 0) / (exCount ?? 1)) * 100)}%)`)
  console.log(
    `  Legs/Arms:         ${(exCount ?? 0) - (coreCount ?? 0)} (${Math.round((((exCount ?? 0) - (coreCount ?? 0)) / (exCount ?? 1)) * 100)}%)`,
  )
  console.log("  ─────────────────────────────────────────────────────")
  console.log("  Weeks 1-2: Foundation — RPE 5-6, 3 sets")
  console.log("  Weeks 3-4: Build     — RPE 6-7, 3-4 sets, tempo added")
  console.log("  Weeks 5-6: Intensify — RPE 7-8, 4 sets, coaching notes")
  console.log("═══════════════════════════════════════════════════════")
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err.message)
  process.exit(1)
})
