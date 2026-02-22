/**
 * Seed script — Clears and re-seeds exercises, programs, program_exercises,
 * program_assignments, and client_profiles with full AI metadata.
 *
 * Run: npx tsx scripts/seed.ts
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
const CLIENT_MARCUS = "00000000-0000-0000-0000-000000000002"
const CLIENT_SARAH = "00000000-0000-0000-0000-000000000003"
const CLIENT_JAMES = "00000000-0000-0000-0000-000000000004"

const PROGRAM_FOUNDATION = "00000000-0000-0000-0000-000000000101"
const PROGRAM_ELITE = "00000000-0000-0000-0000-000000000102"
const PROGRAM_SPORT = "00000000-0000-0000-0000-000000000103"

// Exercise IDs (fixed so program_exercises can reference them)
const EX = {
  back_squat:       "10000000-0000-0000-0000-000000000001",
  bench_press:      "10000000-0000-0000-0000-000000000002",
  deadlift:         "10000000-0000-0000-0000-000000000003",
  pull_up:          "10000000-0000-0000-0000-000000000004",
  overhead_press:   "10000000-0000-0000-0000-000000000005",
  rdl:              "10000000-0000-0000-0000-000000000006",
  bulgarian_split:  "10000000-0000-0000-0000-000000000007",
  barbell_row:      "10000000-0000-0000-0000-000000000008",
  box_jump:         "10000000-0000-0000-0000-000000000009",
  med_ball_slam:    "10000000-0000-0000-0000-000000000010",
  sprint_intervals: "10000000-0000-0000-0000-000000000011",
  battle_ropes:     "10000000-0000-0000-0000-000000000012",
  kb_swing:         "10000000-0000-0000-0000-000000000013",
  plank:            "10000000-0000-0000-0000-000000000014",
  hip_flexor:       "10000000-0000-0000-0000-000000000015",
  foam_roll_it:     "10000000-0000-0000-0000-000000000016",
  agility_ladder:   "10000000-0000-0000-0000-000000000017",
  cone_drill:       "10000000-0000-0000-0000-000000000018",
  sled_push:        "10000000-0000-0000-0000-000000000019",
  yoga_flow:        "10000000-0000-0000-0000-000000000020",
  lat_pulldown:     "10000000-0000-0000-0000-000000000021",
  db_curl:          "10000000-0000-0000-0000-000000000022",
  tricep_pushdown:  "10000000-0000-0000-0000-000000000023",
  leg_press:        "10000000-0000-0000-0000-000000000024",
  leg_curl:         "10000000-0000-0000-0000-000000000025",
  face_pull:        "10000000-0000-0000-0000-000000000026",
  db_lateral_raise: "10000000-0000-0000-0000-000000000027",
  push_up:          "10000000-0000-0000-0000-000000000028",
  hip_thrust:       "10000000-0000-0000-0000-000000000029",
  farmers_carry:    "10000000-0000-0000-0000-000000000030",

  // Dumbbell compounds
  db_bench_press:   "10000000-0000-0000-0000-000000000031",
  db_ohp:           "10000000-0000-0000-0000-000000000032",
  db_row:           "10000000-0000-0000-0000-000000000033",
  db_lunge:         "10000000-0000-0000-0000-000000000034",
  db_rdl:           "10000000-0000-0000-0000-000000000035",
  goblet_squat:     "10000000-0000-0000-0000-000000000036",

  // Machine isolation
  leg_extension:    "10000000-0000-0000-0000-000000000037",
  pec_fly_machine:  "10000000-0000-0000-0000-000000000038",
  seated_calf_raise:"10000000-0000-0000-0000-000000000039",
  cable_lat_raise:  "10000000-0000-0000-0000-000000000040",
  cable_row:        "10000000-0000-0000-0000-000000000041",
  cable_crunch:     "10000000-0000-0000-0000-000000000042",
  cable_crossover:  "10000000-0000-0000-0000-000000000043",
  lat_pulldown_cg:  "10000000-0000-0000-0000-000000000044",
  seated_leg_curl:  "10000000-0000-0000-0000-000000000045",

  // Bodyweight
  dips:             "10000000-0000-0000-0000-000000000046",
  inverted_row:     "10000000-0000-0000-0000-000000000047",
  glute_bridge:     "10000000-0000-0000-0000-000000000048",
  mountain_climbers:"10000000-0000-0000-0000-000000000049",
  burpees:          "10000000-0000-0000-0000-000000000050",
  pike_push_up:     "10000000-0000-0000-0000-000000000051",
  bw_squat:         "10000000-0000-0000-0000-000000000052",
  jumping_lunges:   "10000000-0000-0000-0000-000000000053",

  // Metabolic / Short-session friendly
  db_thruster:      "10000000-0000-0000-0000-000000000054",
  kb_clean_press:   "10000000-0000-0000-0000-000000000055",
  devil_press:      "10000000-0000-0000-0000-000000000056",
  man_maker:        "10000000-0000-0000-0000-000000000057",

  // More barbell / strength variety
  incline_bench:    "10000000-0000-0000-0000-000000000058",
  front_squat:      "10000000-0000-0000-0000-000000000059",
  sumo_deadlift:    "10000000-0000-0000-0000-000000000060",
  bb_hip_thrust:    "10000000-0000-0000-0000-000000000061",
  pendlay_row:      "10000000-0000-0000-0000-000000000062",
  cg_bench_press:   "10000000-0000-0000-0000-000000000063",
  barbell_curl:     "10000000-0000-0000-0000-000000000064",

  // Flexibility / Recovery
  cat_cow:          "10000000-0000-0000-0000-000000000065",
  worlds_greatest:  "10000000-0000-0000-0000-000000000066",
  ninety_ninety:    "10000000-0000-0000-0000-000000000067",
}

// ─── Exercises (with full AI metadata) ──────────────────────────────────────

const exercises = [
  {
    id: EX.back_squat, name: "Barbell Back Squat",
    description: "Compound lower body exercise targeting quads, glutes, and hamstrings",
    category: ["strength"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "barbell, squat rack",
    instructions: "Place barbell on upper traps. Feet shoulder-width apart. Brace core, sit hips back and down. Drive through full foot to stand.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["hamstrings", "core", "erector_spinae"],
    equipment_required: ["barbell", "squat_rack"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.bench_press, name: "Bench Press",
    description: "Upper body push exercise for chest, shoulders, and triceps",
    category: ["strength"], muscle_group: "chest", difficulty: "intermediate",
    equipment: "barbell, bench",
    instructions: "Lie on bench, grip barbell slightly wider than shoulders. Lower to mid-chest, press up to lockout.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest", "anterior_deltoid"], secondary_muscles: ["triceps"],
    equipment_required: ["barbell", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.deadlift, name: "Deadlift",
    description: "Full body posterior chain exercise",
    category: ["strength"], muscle_group: "back", difficulty: "advanced",
    equipment: "barbell",
    instructions: "Stand with feet hip-width, barbell over mid-foot. Hinge at hips, grip bar. Brace, drive through floor, lock hips at top.",
    movement_pattern: "hinge", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["hamstrings", "glutes", "erector_spinae"], secondary_muscles: ["quadriceps", "forearms", "core"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.pull_up, name: "Pull-Up",
    description: "Bodyweight pulling exercise for back and biceps",
    category: ["strength"], muscle_group: "back", difficulty: "intermediate",
    equipment: "pull-up bar",
    instructions: "Hang from bar with overhand grip. Pull chest to bar by driving elbows down. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi", "biceps"], secondary_muscles: ["rear_deltoid", "forearms", "core"],
    equipment_required: ["pull_up_bar"], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.overhead_press, name: "Overhead Press",
    description: "Standing shoulder press for deltoids and triceps",
    category: ["strength"], muscle_group: "shoulders", difficulty: "intermediate",
    equipment: "barbell",
    instructions: "Stand with barbell at shoulders. Brace core, press overhead to lockout. Lower under control.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["anterior_deltoid", "lateral_deltoid"], secondary_muscles: ["triceps", "core", "upper_chest"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.rdl, name: "Romanian Deadlift",
    description: "Hamstring-focused hip hinge movement",
    category: ["strength"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "barbell",
    instructions: "Hold barbell at hips. Push hips back with soft knees, lower bar along legs until hamstring stretch. Drive hips forward to stand.",
    movement_pattern: "hinge", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["hamstrings", "glutes"], secondary_muscles: ["erector_spinae", "forearms"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.bulgarian_split, name: "Bulgarian Split Squat",
    description: "Unilateral leg exercise for balance and strength",
    category: ["strength"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "dumbbells, bench",
    instructions: "Rear foot elevated on bench. Lower until rear knee nearly touches floor. Drive through front foot to stand.",
    movement_pattern: "lunge", force_type: "push", laterality: "unilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["hamstrings", "core"],
    equipment_required: ["dumbbells", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.barbell_row, name: "Barbell Row",
    description: "Horizontal pulling exercise for back thickness",
    category: ["strength"], muscle_group: "back", difficulty: "intermediate",
    equipment: "barbell",
    instructions: "Hinge forward 45 degrees. Pull barbell to lower ribcage, squeeze shoulder blades. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi", "rhomboids"], secondary_muscles: ["biceps", "rear_deltoid", "erector_spinae"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.box_jump, name: "Box Jump",
    description: "Explosive lower body plyometric",
    category: ["plyometric", "strength"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "plyo box",
    instructions: "Stand facing box. Swing arms and jump explosively onto box. Land softly with knees bent. Step down.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes", "calves"], secondary_muscles: ["hamstrings", "core"],
    equipment_required: ["plyo_box"], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.med_ball_slam, name: "Medicine Ball Slam",
    description: "Full body power exercise",
    category: ["plyometric", "cardio"], muscle_group: "full body", difficulty: "beginner",
    equipment: "medicine ball",
    instructions: "Lift ball overhead, slam it into the ground with full force. Pick up and repeat.",
    movement_pattern: "hinge", force_type: "push", laterality: "bilateral",
    primary_muscles: ["core", "latissimus_dorsi"], secondary_muscles: ["shoulders", "triceps", "quadriceps"],
    equipment_required: ["medicine_ball"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.sprint_intervals, name: "Sprint Intervals",
    description: "High intensity running intervals for conditioning",
    category: ["cardio", "sport_specific"], muscle_group: "full body", difficulty: "advanced",
    equipment: "none",
    instructions: "Sprint at max effort for 20-30 seconds. Walk/jog recovery for 60-90 seconds. Repeat.",
    movement_pattern: "locomotion", force_type: "dynamic", laterality: "alternating",
    primary_muscles: ["quadriceps", "hamstrings", "glutes", "calves"], secondary_muscles: ["core", "hip_flexors"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.battle_ropes, name: "Battle Ropes",
    description: "Upper body and core conditioning",
    category: ["cardio", "strength"], muscle_group: "arms", difficulty: "intermediate",
    equipment: "battle ropes",
    instructions: "Hold rope ends. Create alternating waves with arms while maintaining athletic stance.",
    movement_pattern: "push", force_type: "dynamic", laterality: "alternating",
    primary_muscles: ["shoulders", "forearms"], secondary_muscles: ["core", "biceps", "triceps"],
    equipment_required: ["battle_ropes"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.kb_swing, name: "Kettlebell Swing",
    description: "Hip hinge power exercise",
    category: ["strength", "cardio"], muscle_group: "full body", difficulty: "intermediate",
    equipment: "kettlebell",
    instructions: "Hinge at hips, swing kettlebell back between legs. Drive hips forward explosively to swing to chest height.",
    movement_pattern: "hinge", force_type: "dynamic", laterality: "bilateral",
    primary_muscles: ["glutes", "hamstrings"], secondary_muscles: ["core", "shoulders", "erector_spinae"],
    equipment_required: ["kettlebell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.plank, name: "Plank Hold",
    description: "Isometric core stability exercise",
    category: ["strength"], muscle_group: "core", difficulty: "beginner",
    equipment: "none",
    instructions: "Forearms and toes on ground. Body in straight line from head to heels. Hold position, brace core.",
    movement_pattern: "isometric", force_type: "static", laterality: "bilateral",
    primary_muscles: ["core", "rectus_abdominis"], secondary_muscles: ["shoulders", "glutes"],
    equipment_required: [], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.hip_flexor, name: "Hip Flexor Stretch",
    description: "Static stretch for hip flexors",
    category: ["flexibility"], muscle_group: "hips", difficulty: "beginner",
    equipment: "none",
    instructions: "Half-kneeling position. Push hips forward gently until stretch is felt in front of rear hip. Hold 30 seconds.",
    movement_pattern: "lunge", force_type: "static", laterality: "unilateral",
    primary_muscles: ["hip_flexors"], secondary_muscles: ["quadriceps"],
    equipment_required: [], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.foam_roll_it, name: "Foam Rolling - IT Band",
    description: "Self-myofascial release for IT band",
    category: ["recovery"], muscle_group: "legs", difficulty: "beginner",
    equipment: "foam roller",
    instructions: "Side-lying on foam roller at outer thigh. Roll slowly from hip to just above knee. Pause on tender spots.",
    movement_pattern: null, force_type: null, laterality: "unilateral",
    primary_muscles: ["it_band", "quadriceps"], secondary_muscles: [],
    equipment_required: ["foam_roller"], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.agility_ladder, name: "Agility Ladder Drill",
    description: "Footwork and coordination drill",
    category: ["sport_specific"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "agility ladder",
    instructions: "Place ladder on ground. Perform various footwork patterns through the ladder at increasing speed.",
    movement_pattern: "locomotion", force_type: "dynamic", laterality: "alternating",
    primary_muscles: ["calves", "quadriceps"], secondary_muscles: ["hip_flexors", "core"],
    equipment_required: ["agility_ladder"], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.cone_drill, name: "Cone Drill - 5-10-5",
    description: "Change of direction speed drill",
    category: ["sport_specific"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "cones",
    instructions: "Start in 3-point stance. Sprint 5 yards right, 10 yards left, 5 yards right back to start.",
    movement_pattern: "locomotion", force_type: "dynamic", laterality: "alternating",
    primary_muscles: ["quadriceps", "glutes", "calves"], secondary_muscles: ["hamstrings", "core"],
    equipment_required: ["cones"], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.sled_push, name: "Sled Push",
    description: "Lower body power and conditioning",
    category: ["strength", "cardio"], muscle_group: "legs", difficulty: "advanced",
    equipment: "sled",
    instructions: "Grip sled handles at waist height. Drive through legs, pushing sled forward with powerful steps.",
    movement_pattern: "locomotion", force_type: "push", laterality: "alternating",
    primary_muscles: ["quadriceps", "glutes", "calves"], secondary_muscles: ["core", "shoulders"],
    equipment_required: ["sled"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.yoga_flow, name: "Yoga Flow - Recovery",
    description: "Full body recovery yoga sequence",
    category: ["recovery"], muscle_group: "full body", difficulty: "beginner",
    equipment: "yoga mat",
    instructions: "Flow through downward dog, warrior poses, pigeon, child's pose. Hold each 30-60 seconds.",
    movement_pattern: null, force_type: "static", laterality: "bilateral",
    primary_muscles: ["hamstrings", "hip_flexors", "shoulders"], secondary_muscles: ["core", "calves"],
    equipment_required: ["yoga_mat"], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.lat_pulldown, name: "Lat Pulldown",
    description: "Machine-based vertical pulling for lats",
    category: ["strength"], muscle_group: "back", difficulty: "beginner",
    equipment: "cable machine",
    instructions: "Grip wide bar overhand. Pull bar to upper chest, squeeze lats. Return with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi"], secondary_muscles: ["biceps", "rear_deltoid"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.db_curl, name: "Dumbbell Bicep Curl",
    description: "Isolation exercise for biceps",
    category: ["strength"], muscle_group: "arms", difficulty: "beginner",
    equipment: "dumbbells",
    instructions: "Stand holding dumbbells at sides. Curl weights to shoulders, squeeze biceps. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["biceps"], secondary_muscles: ["forearms"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.tricep_pushdown, name: "Tricep Pushdown",
    description: "Cable isolation for triceps",
    category: ["strength"], muscle_group: "arms", difficulty: "beginner",
    equipment: "cable machine",
    instructions: "Stand at cable machine, grip rope/bar. Push down until arms straight, squeeze triceps. Return with control.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["triceps"], secondary_muscles: [],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.leg_press, name: "Leg Press",
    description: "Machine-based compound leg exercise",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "leg press machine",
    instructions: "Sit in leg press, feet shoulder-width on platform. Lower sled until 90-degree knee bend. Press to near-lockout.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["hamstrings"],
    equipment_required: ["leg_press"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.leg_curl, name: "Lying Leg Curl",
    description: "Machine isolation for hamstrings",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "leg curl machine",
    instructions: "Lie face down on leg curl machine. Curl heels toward glutes. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["hamstrings"], secondary_muscles: ["calves"],
    equipment_required: ["leg_curl_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.face_pull, name: "Face Pull",
    description: "Rear deltoid and upper back corrective exercise",
    category: ["strength"], muscle_group: "shoulders", difficulty: "beginner",
    equipment: "cable machine",
    instructions: "Set cable at face height with rope. Pull toward face, externally rotate hands at end. Squeeze rear delts.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["rear_deltoid", "rhomboids"], secondary_muscles: ["rotator_cuff", "biceps"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.db_lateral_raise, name: "Dumbbell Lateral Raise",
    description: "Isolation exercise for lateral deltoids",
    category: ["strength"], muscle_group: "shoulders", difficulty: "beginner",
    equipment: "dumbbells",
    instructions: "Stand holding dumbbells at sides. Raise arms to sides until parallel to floor. Lower slowly.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["lateral_deltoid"], secondary_muscles: ["anterior_deltoid", "traps"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.push_up, name: "Push-Up",
    description: "Classic bodyweight pushing exercise",
    category: ["strength"], muscle_group: "chest", difficulty: "beginner",
    equipment: "none",
    instructions: "Hands shoulder-width apart. Lower chest to ground, push back up. Keep body in straight line.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest", "triceps"], secondary_muscles: ["anterior_deltoid", "core"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.hip_thrust, name: "Barbell Hip Thrust",
    description: "Glute-focused hip extension",
    category: ["strength"], muscle_group: "glutes", difficulty: "intermediate",
    equipment: "barbell, bench",
    instructions: "Upper back on bench, barbell across hips. Drive hips up until body is straight. Squeeze glutes at top.",
    movement_pattern: "hinge", force_type: "push", laterality: "bilateral",
    primary_muscles: ["glutes"], secondary_muscles: ["hamstrings", "core"],
    equipment_required: ["barbell", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.farmers_carry, name: "Farmer's Carry",
    description: "Loaded carry for grip, core, and full body stability",
    category: ["strength"], muscle_group: "full body", difficulty: "intermediate",
    equipment: "dumbbells or kettlebells",
    instructions: "Hold heavy weights at sides. Walk with tall posture, braced core, for prescribed distance or time.",
    movement_pattern: "carry", force_type: "static", laterality: "bilateral",
    primary_muscles: ["forearms", "traps", "core"], secondary_muscles: ["glutes", "calves", "shoulders"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },

  // ── Dumbbell Compounds ────────────────────────────────────────────────────
  {
    id: EX.db_bench_press, name: "Dumbbell Bench Press",
    description: "Dumbbell pressing for chest with greater range of motion than barbell",
    category: ["strength"], muscle_group: "chest", difficulty: "intermediate",
    equipment: "dumbbells, bench",
    instructions: "Lie on bench holding dumbbells at chest level. Press both dumbbells up until arms are extended. Lower with control to chest depth.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest", "anterior_deltoid"], secondary_muscles: ["triceps", "core"],
    equipment_required: ["dumbbells", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.db_ohp, name: "Dumbbell Overhead Press",
    description: "Seated or standing dumbbell shoulder press for deltoid development",
    category: ["strength"], muscle_group: "shoulders", difficulty: "intermediate",
    equipment: "dumbbells",
    instructions: "Hold dumbbells at shoulder height with palms forward. Press overhead to full lockout. Lower under control to shoulder level.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["anterior_deltoid", "lateral_deltoid"], secondary_muscles: ["triceps", "core", "upper_chest"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.db_row, name: "Dumbbell Row",
    description: "Single-arm horizontal pull for back thickness and lat development",
    category: ["strength"], muscle_group: "back", difficulty: "beginner",
    equipment: "dumbbell, bench",
    instructions: "One hand and knee on bench, opposite foot on floor. Row dumbbell to hip, squeezing shoulder blade back. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "unilateral",
    primary_muscles: ["latissimus_dorsi", "rhomboids"], secondary_muscles: ["biceps", "rear_deltoid", "core"],
    equipment_required: ["dumbbells", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.db_lunge, name: "Dumbbell Lunge",
    description: "Unilateral lower body exercise for legs and balance",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "dumbbells",
    instructions: "Hold dumbbells at sides. Step forward into a lunge until both knees are at 90 degrees. Push through front foot to return to standing.",
    movement_pattern: "lunge", force_type: "push", laterality: "unilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["hamstrings", "core", "calves"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.db_rdl, name: "Dumbbell Romanian Deadlift",
    description: "Dumbbell hip hinge for hamstring and glute development",
    category: ["strength"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "dumbbells",
    instructions: "Hold dumbbells in front of thighs. Push hips back with soft knees, lowering dumbbells along legs until hamstring stretch. Drive hips forward to stand.",
    movement_pattern: "hinge", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["hamstrings", "glutes"], secondary_muscles: ["erector_spinae", "forearms", "core"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.goblet_squat, name: "Goblet Squat",
    description: "Front-loaded squat ideal for learning squat mechanics",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "dumbbell or kettlebell",
    instructions: "Hold dumbbell or kettlebell at chest with both hands. Squat down keeping chest up and elbows inside knees. Drive through feet to stand.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["core", "upper_back"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },

  // ── Machine Isolation ─────────────────────────────────────────────────────
  {
    id: EX.leg_extension, name: "Leg Extension",
    description: "Machine isolation for quadriceps",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "leg extension machine",
    instructions: "Sit in machine with pad on shins. Extend legs fully, squeezing quads at top. Lower with control.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps"], secondary_muscles: [],
    equipment_required: ["leg_press"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.pec_fly_machine, name: "Pec Fly Machine",
    description: "Machine chest isolation focusing on pectoral contraction",
    category: ["strength"], muscle_group: "chest", difficulty: "beginner",
    equipment: "pec deck machine",
    instructions: "Sit in machine, grip handles at chest height. Bring handles together in front of chest, squeezing pecs. Return with control.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest"], secondary_muscles: ["anterior_deltoid"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.seated_calf_raise, name: "Seated Calf Raise",
    description: "Isolation exercise targeting the soleus muscle of the calves",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "bench, dumbbell",
    instructions: "Sit on bench with dumbbell on knees and balls of feet on a raised surface. Raise heels as high as possible, squeezing calves. Lower slowly.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["calves"], secondary_muscles: [],
    equipment_required: ["bench", "dumbbells"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.cable_lat_raise, name: "Cable Lateral Raise",
    description: "Constant tension lateral deltoid isolation using cable",
    category: ["strength"], muscle_group: "shoulders", difficulty: "beginner",
    equipment: "cable machine",
    instructions: "Stand sideways to cable, low pulley. Raise arm out to side until parallel to floor. Lower slowly against cable tension.",
    movement_pattern: "push", force_type: "push", laterality: "unilateral",
    primary_muscles: ["lateral_deltoid"], secondary_muscles: ["anterior_deltoid", "traps"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.cable_row, name: "Cable Row",
    description: "Seated cable rowing for mid-back thickness",
    category: ["strength"], muscle_group: "back", difficulty: "beginner",
    equipment: "cable machine",
    instructions: "Sit at cable row station, feet on platform. Pull handle to lower ribcage, squeezing shoulder blades together. Return with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi", "rhomboids"], secondary_muscles: ["biceps", "rear_deltoid", "erector_spinae"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.cable_crunch, name: "Cable Crunch",
    description: "Weighted abdominal exercise using cable resistance",
    category: ["strength"], muscle_group: "core", difficulty: "intermediate",
    equipment: "cable machine",
    instructions: "Kneel facing cable with rope behind head. Crunch down by contracting abs, bringing elbows toward knees. Return with control.",
    movement_pattern: "isometric", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["rectus_abdominis", "core"], secondary_muscles: ["obliques"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.cable_crossover, name: "Cable Crossover",
    description: "Cable fly movement for chest isolation with constant tension",
    category: ["strength"], muscle_group: "chest", difficulty: "intermediate",
    equipment: "cable machine",
    instructions: "Stand between cable stacks, pulleys set high. Step forward, bring handles together in arc in front of chest. Return with control.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest"], secondary_muscles: ["anterior_deltoid", "biceps"],
    equipment_required: ["cable_machine"], is_bodyweight: false, is_compound: false,
  },
  {
    id: EX.lat_pulldown_cg, name: "Lat Pulldown Close Grip",
    description: "Close grip vertical pull emphasizing lower lats and biceps",
    category: ["strength"], muscle_group: "back", difficulty: "beginner",
    equipment: "lat pulldown machine",
    instructions: "Grip V-bar or close grip handle. Pull down to upper chest, squeezing lats. Return with control overhead.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi", "biceps"], secondary_muscles: ["rear_deltoid", "forearms"],
    equipment_required: ["lat_pulldown_machine"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.seated_leg_curl, name: "Seated Leg Curl",
    description: "Machine hamstring isolation in seated position",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "seated leg curl machine",
    instructions: "Sit in machine with pad behind ankles. Curl heels under the seat by contracting hamstrings. Return with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["hamstrings"], secondary_muscles: ["calves"],
    equipment_required: ["leg_curl_machine"], is_bodyweight: false, is_compound: false,
  },

  // ── Bodyweight ─────────────────────────────────────────────────────────────
  {
    id: EX.dips, name: "Dips",
    description: "Bodyweight compound push for chest and triceps",
    category: ["strength"], muscle_group: "chest", difficulty: "intermediate",
    equipment: "parallel bars or dip station",
    instructions: "Support yourself on parallel bars with straight arms. Lower body by bending elbows until upper arms are parallel to floor. Press back up to lockout.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest", "triceps"], secondary_muscles: ["anterior_deltoid", "core"],
    equipment_required: ["pull_up_bar"], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.inverted_row, name: "Inverted Row",
    description: "Bodyweight horizontal pulling exercise for back",
    category: ["strength"], muscle_group: "back", difficulty: "beginner",
    equipment: "smith machine or low bar",
    instructions: "Hang under a bar with body straight. Pull chest to bar by squeezing shoulder blades together. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi", "rhomboids"], secondary_muscles: ["biceps", "rear_deltoid", "core"],
    equipment_required: ["barbell", "squat_rack"], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.glute_bridge, name: "Glute Bridge",
    description: "Bodyweight glute activation and hip extension exercise",
    category: ["strength"], muscle_group: "glutes", difficulty: "beginner",
    equipment: "none",
    instructions: "Lie on back with knees bent, feet flat on floor. Drive hips up by squeezing glutes until body forms straight line from knees to shoulders. Lower slowly.",
    movement_pattern: "hinge", force_type: "push", laterality: "bilateral",
    primary_muscles: ["glutes"], secondary_muscles: ["hamstrings", "core"],
    equipment_required: [], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.mountain_climbers, name: "Mountain Climbers",
    description: "Dynamic bodyweight core and cardio exercise",
    category: ["cardio", "strength"], muscle_group: "core", difficulty: "beginner",
    equipment: "none",
    instructions: "Start in push-up position. Drive one knee toward chest, then quickly switch legs in a running motion. Keep hips level and core tight.",
    movement_pattern: "locomotion", force_type: "dynamic", laterality: "alternating",
    primary_muscles: ["core", "hip_flexors"], secondary_muscles: ["shoulders", "quadriceps", "calves"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.burpees, name: "Burpees",
    description: "Full body metabolic conditioning exercise",
    category: ["cardio", "plyometric"], muscle_group: "full body", difficulty: "intermediate",
    equipment: "none",
    instructions: "From standing, squat down and place hands on floor. Jump feet back to push-up position. Perform a push-up. Jump feet forward and explosively jump up with arms overhead.",
    movement_pattern: "locomotion", force_type: "dynamic", laterality: "bilateral",
    primary_muscles: ["quadriceps", "chest", "core"], secondary_muscles: ["shoulders", "triceps", "hamstrings", "glutes"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.pike_push_up, name: "Pike Push-up",
    description: "Bodyweight shoulder pressing variation with elevated hips",
    category: ["strength"], muscle_group: "shoulders", difficulty: "intermediate",
    equipment: "none",
    instructions: "Start in push-up position, walk feet toward hands so hips are high in an inverted V. Bend elbows to lower head toward floor. Press back up.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["anterior_deltoid", "lateral_deltoid"], secondary_muscles: ["triceps", "upper_chest", "core"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.bw_squat, name: "Bodyweight Squat",
    description: "Fundamental bodyweight lower body movement",
    category: ["strength"], muscle_group: "legs", difficulty: "beginner",
    equipment: "none",
    instructions: "Stand with feet shoulder-width apart. Sit hips back and down, keeping chest up and knees tracking over toes. Stand back up through full foot.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["hamstrings", "core", "calves"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },
  {
    id: EX.jumping_lunges, name: "Jumping Lunges",
    description: "Explosive plyometric lunge for power and leg endurance",
    category: ["plyometric"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "none",
    instructions: "Start in lunge position. Jump explosively, switching legs mid-air. Land softly in opposite lunge position. Repeat alternating.",
    movement_pattern: "lunge", force_type: "push", laterality: "alternating",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["hamstrings", "calves", "core"],
    equipment_required: [], is_bodyweight: true, is_compound: true,
  },

  // ── Metabolic / Short-session Friendly ─────────────────────────────────────
  {
    id: EX.db_thruster, name: "Dumbbell Thruster",
    description: "Combined front squat and press for full body metabolic conditioning",
    category: ["strength", "cardio"], muscle_group: "full body", difficulty: "intermediate",
    equipment: "dumbbells",
    instructions: "Hold dumbbells at shoulders. Squat down to full depth. Drive up explosively and press dumbbells overhead in one fluid motion. Lower to shoulders and repeat.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes", "anterior_deltoid"], secondary_muscles: ["triceps", "core", "upper_chest"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.kb_clean_press, name: "Kettlebell Clean & Press",
    description: "Full body kettlebell movement combining hip drive and overhead pressing",
    category: ["strength", "plyometric"], muscle_group: "full body", difficulty: "advanced",
    equipment: "kettlebell",
    instructions: "Start with kettlebell between feet. Clean to rack position with a powerful hip hinge. Press overhead to lockout. Lower to rack, then back to floor. Repeat.",
    movement_pattern: "hinge", force_type: "push", laterality: "unilateral",
    primary_muscles: ["glutes", "hamstrings", "anterior_deltoid"], secondary_muscles: ["core", "triceps", "forearms", "upper_back"],
    equipment_required: ["kettlebell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.devil_press, name: "Devil Press",
    description: "Intense full body dumbbell movement combining burpee and snatch",
    category: ["cardio", "strength"], muscle_group: "full body", difficulty: "advanced",
    equipment: "dumbbells",
    instructions: "Hold dumbbells, perform a burpee with hands on dumbbells. From the bottom, swing dumbbells between legs and overhead in one powerful motion. Lower and repeat.",
    movement_pattern: "hinge", force_type: "push", laterality: "bilateral",
    primary_muscles: ["glutes", "hamstrings", "shoulders"], secondary_muscles: ["core", "chest", "triceps", "quadriceps"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.man_maker, name: "Man Maker",
    description: "Complex full body dumbbell exercise combining push-up, row, squat, and press",
    category: ["strength", "cardio"], muscle_group: "full body", difficulty: "advanced",
    equipment: "dumbbells",
    instructions: "Start in push-up position on dumbbells. Perform push-up, row each side, jump feet to hands, clean dumbbells to shoulders, squat and press overhead. Return to start.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["chest", "latissimus_dorsi", "quadriceps", "anterior_deltoid"], secondary_muscles: ["triceps", "biceps", "core", "glutes"],
    equipment_required: ["dumbbells"], is_bodyweight: false, is_compound: true,
  },

  // ── More Barbell / Strength Variety ────────────────────────────────────────
  {
    id: EX.incline_bench, name: "Incline Bench Press",
    description: "Incline barbell press for upper chest emphasis",
    category: ["strength"], muscle_group: "chest", difficulty: "intermediate",
    equipment: "barbell, incline bench",
    instructions: "Set bench to 30-45 degree incline. Grip barbell slightly wider than shoulders. Lower to upper chest, press to lockout.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["upper_chest", "anterior_deltoid"], secondary_muscles: ["triceps", "lateral_deltoid"],
    equipment_required: ["barbell", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.front_squat, name: "Front Squat",
    description: "Barbell squat with front rack position emphasizing quads and upright torso",
    category: ["strength"], muscle_group: "legs", difficulty: "advanced",
    equipment: "barbell, squat rack",
    instructions: "Rest barbell on front deltoids with clean grip or cross-arm grip. Squat to full depth keeping elbows high and torso upright. Drive up through feet.",
    movement_pattern: "squat", force_type: "push", laterality: "bilateral",
    primary_muscles: ["quadriceps", "glutes"], secondary_muscles: ["core", "upper_back", "erector_spinae"],
    equipment_required: ["barbell", "squat_rack"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.sumo_deadlift, name: "Sumo Deadlift",
    description: "Wide-stance deadlift variation targeting glutes and inner thighs",
    category: ["strength"], muscle_group: "legs", difficulty: "intermediate",
    equipment: "barbell",
    instructions: "Wide stance with toes pointed out. Grip barbell inside knees. Brace core, drive through floor spreading the floor with feet. Lock hips at top.",
    movement_pattern: "hinge", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["glutes", "hamstrings", "quadriceps"], secondary_muscles: ["erector_spinae", "adductors", "forearms"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.bb_hip_thrust, name: "Barbell Hip Thrust",
    description: "Barbell-loaded glute bridge for maximal glute development",
    category: ["strength"], muscle_group: "glutes", difficulty: "intermediate",
    equipment: "barbell, bench",
    instructions: "Upper back against bench, barbell across hips with pad. Drive hips up until body is straight from knees to shoulders. Squeeze glutes hard at top. Lower with control.",
    movement_pattern: "hinge", force_type: "push", laterality: "bilateral",
    primary_muscles: ["glutes"], secondary_muscles: ["hamstrings", "core"],
    equipment_required: ["barbell", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.pendlay_row, name: "Pendlay Row",
    description: "Strict barbell row from the floor for explosive back strength",
    category: ["strength"], muscle_group: "back", difficulty: "intermediate",
    equipment: "barbell",
    instructions: "Hinge forward until torso is parallel to floor. Pull barbell explosively from floor to lower chest. Lower bar back to floor between each rep.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["latissimus_dorsi", "rhomboids"], secondary_muscles: ["biceps", "rear_deltoid", "erector_spinae"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.cg_bench_press, name: "Close Grip Bench Press",
    description: "Narrow grip bench press for triceps emphasis",
    category: ["strength"], muscle_group: "arms", difficulty: "intermediate",
    equipment: "barbell, bench",
    instructions: "Lie on bench, grip barbell at shoulder width or slightly narrower. Lower to lower chest keeping elbows tucked. Press to lockout emphasizing triceps.",
    movement_pattern: "push", force_type: "push", laterality: "bilateral",
    primary_muscles: ["triceps", "chest"], secondary_muscles: ["anterior_deltoid"],
    equipment_required: ["barbell", "bench"], is_bodyweight: false, is_compound: true,
  },
  {
    id: EX.barbell_curl, name: "Barbell Curl",
    description: "Classic barbell exercise for bicep mass and strength",
    category: ["strength"], muscle_group: "arms", difficulty: "beginner",
    equipment: "barbell",
    instructions: "Stand holding barbell with underhand grip at hip width. Curl bar to shoulders keeping elbows pinned to sides. Lower with control.",
    movement_pattern: "pull", force_type: "pull", laterality: "bilateral",
    primary_muscles: ["biceps"], secondary_muscles: ["forearms", "anterior_deltoid"],
    equipment_required: ["barbell"], is_bodyweight: false, is_compound: false,
  },

  // ── Flexibility / Recovery ─────────────────────────────────────────────────
  {
    id: EX.cat_cow, name: "Cat-Cow Stretch",
    description: "Spinal mobility exercise alternating between flexion and extension",
    category: ["flexibility"], muscle_group: "back", difficulty: "beginner",
    equipment: "yoga mat",
    instructions: "Start on hands and knees. Inhale and arch back dropping belly toward floor (cow). Exhale and round spine pushing mid-back toward ceiling (cat). Alternate slowly.",
    movement_pattern: "isometric", force_type: "static", laterality: "bilateral",
    primary_muscles: ["erector_spinae", "core"], secondary_muscles: ["shoulders", "hip_flexors"],
    equipment_required: ["yoga_mat"], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.worlds_greatest, name: "World's Greatest Stretch",
    description: "Multi-planar dynamic stretch targeting hips, thoracic spine, and hamstrings",
    category: ["flexibility"], muscle_group: "full body", difficulty: "beginner",
    equipment: "yoga mat",
    instructions: "Lunge forward, place opposite hand on floor inside front foot. Rotate torso and reach top arm to ceiling. Hold briefly, switch sides.",
    movement_pattern: "lunge", force_type: "static", laterality: "alternating",
    primary_muscles: ["hip_flexors", "hamstrings", "thoracic_spine"], secondary_muscles: ["glutes", "shoulders", "core"],
    equipment_required: ["yoga_mat"], is_bodyweight: true, is_compound: false,
  },
  {
    id: EX.ninety_ninety, name: "90/90 Hip Stretch",
    description: "Seated hip mobility exercise targeting internal and external rotation",
    category: ["flexibility"], muscle_group: "hips", difficulty: "beginner",
    equipment: "yoga mat",
    instructions: "Sit on floor with front leg bent 90 degrees in front, rear leg bent 90 degrees behind. Keep torso tall and lean gently over front shin. Hold, then switch sides.",
    movement_pattern: "isometric", force_type: "static", laterality: "unilateral",
    primary_muscles: ["glutes", "hip_flexors"], secondary_muscles: ["adductors", "piriformis"],
    equipment_required: ["yoga_mat"], is_bodyweight: true, is_compound: false,
  },
]

// ─── Programs ───────────────────────────────────────────────────────────────

const programs = [
  {
    id: PROGRAM_FOUNDATION,
    name: "Foundation Strength Program",
    description: "Build a solid strength base with compound movements and progressive overload. Perfect for athletes looking to establish fundamental movement patterns.",
    category: ["strength"], difficulty: "beginner", duration_weeks: 8, sessions_per_week: 3,
    price_cents: 9900, is_active: true, created_by: ADMIN_ID,
    split_type: "full_body", periodization: "linear", is_ai_generated: false,
  },
  {
    id: PROGRAM_ELITE,
    name: "Elite Performance Package",
    description: "Advanced training combining strength, power, and sport-specific conditioning for competitive athletes seeking peak performance.",
    category: "hybrid", difficulty: "advanced", duration_weeks: 12, sessions_per_week: 5,
    price_cents: 34900, is_active: true, created_by: ADMIN_ID,
    split_type: "upper_lower", periodization: "undulating", is_ai_generated: false,
  },
  {
    id: PROGRAM_SPORT,
    name: "Athletic Speed & Power",
    description: "Sport-specific training focused on explosive power, agility, and speed development. Ideal for team sport athletes.",
    category: ["sport_specific"], difficulty: "intermediate", duration_weeks: 6, sessions_per_week: 4,
    price_cents: 14900, is_active: true, created_by: ADMIN_ID,
    split_type: "push_pull", periodization: "block", is_ai_generated: false,
  },
]

// ─── Program Exercises ──────────────────────────────────────────────────────

const programExercises = [
  // ── Foundation Strength (Full Body, 3x/wk: Mon/Wed/Fri) ──────────────────
  // Monday — Full Body A
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.back_squat, day_of_week: 1, week_number: 1, order_index: 0, sets: 4, reps: "5", rest_seconds: 180, rpe_target: 7, intensity_pct: null, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.bench_press, day_of_week: 1, week_number: 1, order_index: 1, sets: 4, reps: "5", rest_seconds: 180, rpe_target: 7, intensity_pct: null, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.barbell_row, day_of_week: 1, week_number: 1, order_index: 2, sets: 3, reps: "8-10", rest_seconds: 120, rpe_target: 7, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.face_pull, day_of_week: 1, week_number: 1, order_index: 3, sets: 3, reps: "15", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.plank, day_of_week: 1, week_number: 1, order_index: 4, sets: 3, reps: "30s", rest_seconds: 60, rpe_target: null, intensity_pct: null, tempo: null, group_tag: null },

  // Wednesday — Full Body B
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.deadlift, day_of_week: 3, week_number: 1, order_index: 0, sets: 3, reps: "5", rest_seconds: 180, rpe_target: 7, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.overhead_press, day_of_week: 3, week_number: 1, order_index: 1, sets: 4, reps: "6-8", rest_seconds: 150, rpe_target: 7, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.lat_pulldown, day_of_week: 3, week_number: 1, order_index: 2, sets: 3, reps: "10-12", rest_seconds: 90, rpe_target: 7, intensity_pct: null, tempo: "2011", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.leg_curl, day_of_week: 3, week_number: 1, order_index: 3, sets: 3, reps: "12", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.db_curl, day_of_week: 3, week_number: 1, order_index: 4, sets: 2, reps: "12-15", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: "A" },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.tricep_pushdown, day_of_week: 3, week_number: 1, order_index: 5, sets: 2, reps: "12-15", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: "A" },

  // Friday — Full Body C
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.leg_press, day_of_week: 5, week_number: 1, order_index: 0, sets: 4, reps: "8-10", rest_seconds: 120, rpe_target: 7, intensity_pct: null, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.push_up, day_of_week: 5, week_number: 1, order_index: 1, sets: 3, reps: "AMRAP", rest_seconds: 90, rpe_target: 8, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.rdl, day_of_week: 5, week_number: 1, order_index: 2, sets: 3, reps: "10", rest_seconds: 120, rpe_target: 7, intensity_pct: null, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.db_lateral_raise, day_of_week: 5, week_number: 1, order_index: 3, sets: 3, reps: "15", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_FOUNDATION, exercise_id: EX.farmers_carry, day_of_week: 5, week_number: 1, order_index: 4, sets: 3, reps: "40m", rest_seconds: 90, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },

  // ── Elite Performance (Upper/Lower, 5x/wk) ──────────────────────────────
  // Monday — Upper Strength
  { program_id: PROGRAM_ELITE, exercise_id: EX.bench_press, day_of_week: 1, week_number: 1, order_index: 0, sets: 5, reps: "3", rest_seconds: 240, rpe_target: 8, intensity_pct: 85, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.barbell_row, day_of_week: 1, week_number: 1, order_index: 1, sets: 4, reps: "5", rest_seconds: 180, rpe_target: 8, intensity_pct: 80, tempo: "2011", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.overhead_press, day_of_week: 1, week_number: 1, order_index: 2, sets: 3, reps: "6-8", rest_seconds: 150, rpe_target: 8, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.pull_up, day_of_week: 1, week_number: 1, order_index: 3, sets: 3, reps: "6-10", rest_seconds: 120, rpe_target: 8, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.face_pull, day_of_week: 1, week_number: 1, order_index: 4, sets: 3, reps: "15-20", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: null },

  // Tuesday — Lower Strength
  { program_id: PROGRAM_ELITE, exercise_id: EX.back_squat, day_of_week: 2, week_number: 1, order_index: 0, sets: 5, reps: "3", rest_seconds: 240, rpe_target: 8, intensity_pct: 85, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.rdl, day_of_week: 2, week_number: 1, order_index: 1, sets: 4, reps: "6", rest_seconds: 180, rpe_target: 8, intensity_pct: 75, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.hip_thrust, day_of_week: 2, week_number: 1, order_index: 2, sets: 3, reps: "8-10", rest_seconds: 120, rpe_target: 8, intensity_pct: null, tempo: "2011", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.leg_curl, day_of_week: 2, week_number: 1, order_index: 3, sets: 3, reps: "10-12", rest_seconds: 90, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.farmers_carry, day_of_week: 2, week_number: 1, order_index: 4, sets: 3, reps: "40m", rest_seconds: 90, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },

  // Thursday — Upper Hypertrophy
  { program_id: PROGRAM_ELITE, exercise_id: EX.overhead_press, day_of_week: 4, week_number: 1, order_index: 0, sets: 4, reps: "8-10", rest_seconds: 120, rpe_target: 8, intensity_pct: null, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.lat_pulldown, day_of_week: 4, week_number: 1, order_index: 1, sets: 4, reps: "10-12", rest_seconds: 90, rpe_target: 8, intensity_pct: null, tempo: "2011", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.bench_press, day_of_week: 4, week_number: 1, order_index: 2, sets: 3, reps: "10-12", rest_seconds: 90, rpe_target: 8, intensity_pct: 70, tempo: "3010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.db_curl, day_of_week: 4, week_number: 1, order_index: 3, sets: 3, reps: "12-15", rest_seconds: 60, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: "A" },
  { program_id: PROGRAM_ELITE, exercise_id: EX.tricep_pushdown, day_of_week: 4, week_number: 1, order_index: 4, sets: 3, reps: "12-15", rest_seconds: 60, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: "A" },
  { program_id: PROGRAM_ELITE, exercise_id: EX.db_lateral_raise, day_of_week: 4, week_number: 1, order_index: 5, sets: 3, reps: "15-20", rest_seconds: 60, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },

  // Friday — Lower Power
  { program_id: PROGRAM_ELITE, exercise_id: EX.deadlift, day_of_week: 5, week_number: 1, order_index: 0, sets: 5, reps: "2", rest_seconds: 300, rpe_target: 9, intensity_pct: 90, tempo: "1010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.box_jump, day_of_week: 5, week_number: 1, order_index: 1, sets: 4, reps: "5", rest_seconds: 120, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.bulgarian_split, day_of_week: 5, week_number: 1, order_index: 2, sets: 3, reps: "8/leg", rest_seconds: 120, rpe_target: 8, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.kb_swing, day_of_week: 5, week_number: 1, order_index: 3, sets: 4, reps: "15", rest_seconds: 60, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.plank, day_of_week: 5, week_number: 1, order_index: 4, sets: 3, reps: "45s", rest_seconds: 45, rpe_target: null, intensity_pct: null, tempo: null, group_tag: null },

  // Saturday — Conditioning
  { program_id: PROGRAM_ELITE, exercise_id: EX.sled_push, day_of_week: 6, week_number: 1, order_index: 0, sets: 6, reps: "20m", rest_seconds: 90, rpe_target: 8, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.battle_ropes, day_of_week: 6, week_number: 1, order_index: 1, sets: 4, reps: "30s", rest_seconds: 60, rpe_target: 8, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.med_ball_slam, day_of_week: 6, week_number: 1, order_index: 2, sets: 4, reps: "10", rest_seconds: 60, rpe_target: 8, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_ELITE, exercise_id: EX.yoga_flow, day_of_week: 6, week_number: 1, order_index: 3, sets: 1, reps: "10min", rest_seconds: 0, rpe_target: null, intensity_pct: null, tempo: null, group_tag: null },

  // ── Athletic Speed & Power (4x/wk: Mon/Tue/Thu/Fri) ──────────────────────
  // Monday — Power
  { program_id: PROGRAM_SPORT, exercise_id: EX.box_jump, day_of_week: 1, week_number: 1, order_index: 0, sets: 5, reps: "3", rest_seconds: 120, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.back_squat, day_of_week: 1, week_number: 1, order_index: 1, sets: 4, reps: "4", rest_seconds: 180, rpe_target: 8, intensity_pct: 80, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.hip_thrust, day_of_week: 1, week_number: 1, order_index: 2, sets: 3, reps: "8", rest_seconds: 120, rpe_target: 7, intensity_pct: null, tempo: "2011", group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.kb_swing, day_of_week: 1, week_number: 1, order_index: 3, sets: 4, reps: "12", rest_seconds: 60, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },

  // Tuesday — Speed & Agility
  { program_id: PROGRAM_SPORT, exercise_id: EX.sprint_intervals, day_of_week: 2, week_number: 1, order_index: 0, sets: 6, reps: "20s sprint / 60s rest", rest_seconds: 60, rpe_target: 9, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.agility_ladder, day_of_week: 2, week_number: 1, order_index: 1, sets: 4, reps: "2 patterns", rest_seconds: 45, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.cone_drill, day_of_week: 2, week_number: 1, order_index: 2, sets: 5, reps: "1", rest_seconds: 90, rpe_target: 9, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.hip_flexor, day_of_week: 2, week_number: 1, order_index: 3, sets: 2, reps: "30s/side", rest_seconds: 0, rpe_target: null, intensity_pct: null, tempo: null, group_tag: null },

  // Thursday — Upper Strength
  { program_id: PROGRAM_SPORT, exercise_id: EX.bench_press, day_of_week: 4, week_number: 1, order_index: 0, sets: 4, reps: "5", rest_seconds: 180, rpe_target: 8, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.pull_up, day_of_week: 4, week_number: 1, order_index: 1, sets: 4, reps: "5-8", rest_seconds: 120, rpe_target: 8, intensity_pct: null, tempo: "2010", group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.med_ball_slam, day_of_week: 4, week_number: 1, order_index: 2, sets: 4, reps: "8", rest_seconds: 60, rpe_target: 8, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.face_pull, day_of_week: 4, week_number: 1, order_index: 3, sets: 3, reps: "15", rest_seconds: 60, rpe_target: 6, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.plank, day_of_week: 4, week_number: 1, order_index: 4, sets: 3, reps: "30s", rest_seconds: 45, rpe_target: null, intensity_pct: null, tempo: null, group_tag: null },

  // Friday — Conditioning
  { program_id: PROGRAM_SPORT, exercise_id: EX.sled_push, day_of_week: 5, week_number: 1, order_index: 0, sets: 5, reps: "20m", rest_seconds: 90, rpe_target: 8, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.battle_ropes, day_of_week: 5, week_number: 1, order_index: 1, sets: 4, reps: "30s", rest_seconds: 60, rpe_target: 8, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.farmers_carry, day_of_week: 5, week_number: 1, order_index: 2, sets: 4, reps: "30m", rest_seconds: 90, rpe_target: 7, intensity_pct: null, tempo: null, group_tag: null },
  { program_id: PROGRAM_SPORT, exercise_id: EX.foam_roll_it, day_of_week: 5, week_number: 1, order_index: 3, sets: 1, reps: "5min", rest_seconds: 0, rpe_target: null, intensity_pct: null, tempo: null, group_tag: null },
]

// ─── Program Assignments ────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10)

const assignments = [
  // Marcus gets Foundation + Sport
  { program_id: PROGRAM_FOUNDATION, user_id: CLIENT_MARCUS, assigned_by: ADMIN_ID, start_date: today, status: "active" },
  { program_id: PROGRAM_SPORT, user_id: CLIENT_MARCUS, assigned_by: ADMIN_ID, start_date: today, status: "active" },
  // Sarah gets Elite
  { program_id: PROGRAM_ELITE, user_id: CLIENT_SARAH, assigned_by: ADMIN_ID, start_date: today, status: "active" },
  // James gets Foundation
  { program_id: PROGRAM_FOUNDATION, user_id: CLIENT_JAMES, assigned_by: ADMIN_ID, start_date: today, status: "active" },
]

// ─── Client Profiles ────────────────────────────────────────────────────────

const clientProfiles = [
  {
    user_id: CLIENT_MARCUS,
    date_of_birth: "1998-06-15",
    gender: "male",
    sport: "Rugby",
    position: "Flanker",
    experience_level: "intermediate",
    goals: "Goals: muscle_gain, sport_specific | Training background: 3 years of gym training, 5 years rugby | Likes: compound lifts, sprints | Dislikes: long cardio",
    injuries: null,
    height_cm: 183,
    weight_kg: 92,
    emergency_contact_name: "Lisa Thompson",
    emergency_contact_phone: "+61 400 111 222",
    available_equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "cable_machine", "kettlebell", "plyo_box", "sled"],
    preferred_session_minutes: 60,
    preferred_training_days: 4,
    injury_details: [],
    training_years: 3,
  },
  {
    user_id: CLIENT_SARAH,
    date_of_birth: "1995-11-03",
    gender: "female",
    sport: "CrossFit",
    position: null,
    experience_level: "advanced",
    goals: "Goals: muscle_gain, endurance | Training background: 6 years CrossFit, competitive regionals | Likes: Olympic lifts, gymnastics | Dislikes: machines",
    injuries: "Previous left shoulder impingement (resolved)",
    height_cm: 165,
    weight_kg: 63,
    emergency_contact_name: "David Kim",
    emergency_contact_phone: "+61 400 333 444",
    available_equipment: ["barbell", "dumbbells", "squat_rack", "bench", "pull_up_bar", "kettlebell", "plyo_box", "battle_ropes", "medicine_ball", "sled"],
    preferred_session_minutes: 75,
    preferred_training_days: 5,
    injury_details: [{ area: "shoulder", side: "left", severity: "mild", notes: "Previous impingement — resolved, avoid heavy overhead volume" }],
    training_years: 6,
  },
  {
    user_id: CLIENT_JAMES,
    date_of_birth: "2001-03-22",
    gender: "male",
    sport: "Soccer",
    position: "Midfielder",
    experience_level: "beginner",
    goals: "Goals: general_health, sport_specific | Training background: 1 year casual gym | Likes: anything | Dislikes: none",
    injuries: null,
    height_cm: 178,
    weight_kg: 73,
    emergency_contact_name: "Maria Rodriguez",
    emergency_contact_phone: "+61 400 555 666",
    available_equipment: ["dumbbells", "bench", "cable_machine", "foam_roller", "yoga_mat"],
    preferred_session_minutes: 45,
    preferred_training_days: 3,
    injury_details: [],
    training_years: 1,
  },
]

// ─── Execute ────────────────────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Starting seed...\n")

  // 1. Clear existing data (order matters due to FK constraints)
  console.log("  Clearing old data...")
  await supabase.from("achievements").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("exercise_progress").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("tracked_exercises").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("program_assignments").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("program_exercises").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("programs").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("exercises").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("client_profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await supabase.from("payments").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  // Don't delete users — keep existing auth accounts
  console.log("  ✓ Cleared\n")

  // 2. Ensure users exist
  console.log("  Upserting users...")
  const { error: usersErr } = await supabase.from("users").upsert([
    { id: ADMIN_ID, email: "admin@djpathlete.com", password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO", first_name: "Darren", last_name: "Paul", role: "admin", email_verified: true, status: "active" },
    { id: CLIENT_MARCUS, email: "marcus@test.com", password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO", first_name: "Marcus", last_name: "Thompson", role: "client", email_verified: true, status: "active" },
    { id: CLIENT_SARAH, email: "sarah@test.com", password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO", first_name: "Sarah", last_name: "Kim", role: "client", email_verified: true, status: "active" },
    { id: CLIENT_JAMES, email: "james@test.com", password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO", first_name: "James", last_name: "Rodriguez", role: "client", email_verified: true, status: "active" },
  ], { onConflict: "id" })
  if (usersErr) throw new Error(`Users: ${usersErr.message}`)
  console.log("  ✓ 4 users (1 admin + 3 clients)\n")

  // 3. Client profiles
  console.log("  Inserting client profiles...")
  const { error: profilesErr } = await supabase.from("client_profiles").insert(clientProfiles)
  if (profilesErr) throw new Error(`Profiles: ${profilesErr.message}`)
  console.log("  ✓ 3 client profiles with questionnaire data\n")

  // 4. Exercises
  console.log("  Inserting exercises...")
  const { error: exErr } = await supabase.from("exercises").insert(
    exercises.map((e) => ({ ...e, is_active: true, created_by: ADMIN_ID }))
  )
  if (exErr) throw new Error(`Exercises: ${exErr.message}`)
  console.log(`  ✓ ${exercises.length} exercises with full AI metadata\n`)

  // 5. Programs
  console.log("  Inserting programs...")
  const { error: progErr } = await supabase.from("programs").insert(programs)
  if (progErr) throw new Error(`Programs: ${progErr.message}`)
  console.log(`  ✓ ${programs.length} programs\n`)

  // 6. Program exercises
  console.log("  Inserting program exercises...")
  const { error: peErr } = await supabase.from("program_exercises").insert(programExercises)
  if (peErr) throw new Error(`Program exercises: ${peErr.message}`)
  console.log(`  ✓ ${programExercises.length} program exercises\n`)

  // 7. Assignments
  console.log("  Inserting program assignments...")
  const { error: assignErr } = await supabase.from("program_assignments").insert(assignments)
  if (assignErr) throw new Error(`Assignments: ${assignErr.message}`)
  console.log(`  ✓ ${assignments.length} assignments\n`)

  // Summary
  console.log("═══════════════════════════════════════════")
  console.log("  Seed complete! Test accounts:")
  console.log("  ─────────────────────────────────────────")
  console.log("  Admin:  admin@djpathlete.com / Admin123!")
  console.log("  Client: marcus@test.com     / Admin123!")
  console.log("  Client: sarah@test.com      / Admin123!")
  console.log("  Client: james@test.com      / Admin123!")
  console.log("═══════════════════════════════════════════")
  console.log("")
  console.log("  Marcus → Foundation Strength + Athletic Speed & Power")
  console.log("  Sarah  → Elite Performance Package")
  console.log("  James  → Foundation Strength Program")
  console.log("")
  console.log("  Clean slate — no exercise history (first week)")
  console.log("  All exercises have full AI metadata")
  console.log("  All client profiles have questionnaire data")
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err.message)
  process.exit(1)
})
