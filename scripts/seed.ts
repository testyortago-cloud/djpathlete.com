/**
 * Seed script — Seeds users, client_profiles, programs, and program_assignments.
 * Exercises are imported separately via the Excel import script.
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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ─── Fixed IDs ──────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const CLIENT_MARCUS = "00000000-0000-0000-0000-000000000002"
const CLIENT_SARAH = "00000000-0000-0000-0000-000000000003"
const CLIENT_JAMES = "00000000-0000-0000-0000-000000000004"

const PROGRAM_FOUNDATION = "00000000-0000-0000-0000-000000000101"
const PROGRAM_ELITE = "00000000-0000-0000-0000-000000000102"
const PROGRAM_SPORT = "00000000-0000-0000-0000-000000000103"

// ─── Programs ───────────────────────────────────────────────────────────────

const programs = [
  {
    id: PROGRAM_FOUNDATION,
    name: "Foundation Strength Program",
    description:
      "Build a solid strength base with compound movements and progressive overload. Perfect for athletes looking to establish fundamental movement patterns.",
    category: ["strength"],
    difficulty: "beginner",
    duration_weeks: 8,
    sessions_per_week: 3,
    price_cents: 9900,
    is_active: true,
    created_by: ADMIN_ID,
    split_type: "full_body",
    periodization: "linear",
    is_ai_generated: false,
  },
  {
    id: PROGRAM_ELITE,
    name: "Elite Performance Package",
    description:
      "Advanced training combining strength, power, and sport-specific conditioning for competitive athletes seeking peak performance.",
    category: ["strength"],
    difficulty: "advanced",
    duration_weeks: 12,
    sessions_per_week: 5,
    price_cents: 34900,
    is_active: true,
    created_by: ADMIN_ID,
    split_type: "upper_lower",
    periodization: "undulating",
    is_ai_generated: false,
  },
  {
    id: PROGRAM_SPORT,
    name: "Athletic Speed & Power",
    description:
      "Sport-specific training focused on explosive power, agility, and speed development. Ideal for team sport athletes.",
    category: ["power"],
    difficulty: "intermediate",
    duration_weeks: 6,
    sessions_per_week: 4,
    price_cents: 14900,
    is_active: true,
    created_by: ADMIN_ID,
    split_type: "push_pull",
    periodization: "block",
    is_ai_generated: false,
  },
]

// TODO: Re-link program exercises after Excel exercise import
// The programExercises array previously referenced exercise IDs from the hardcoded
// EX constant which has been removed. Once exercises are imported via the Excel
// import script, this data needs to be rebuilt with the correct exercise IDs.
//
// const programExercises = [
//   ... (removed — exercise IDs no longer available in this script)
// ]

// ─── Program Assignments ────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10)

const assignments = [
  // Marcus gets Foundation + Sport
  {
    program_id: PROGRAM_FOUNDATION,
    user_id: CLIENT_MARCUS,
    assigned_by: ADMIN_ID,
    start_date: today,
    status: "active",
  },
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
    goals:
      "Goals: muscle_gain, sport_specific | Training background: 3 years of gym training, 5 years rugby | Likes: compound lifts, sprints | Dislikes: long cardio",
    injuries: null,
    height_cm: 183,
    weight_kg: 92,
    emergency_contact_name: "Lisa Thompson",
    emergency_contact_phone: "+61 400 111 222",
    available_equipment: [
      "barbell",
      "dumbbells",
      "squat_rack",
      "bench",
      "pull_up_bar",
      "cable_machine",
      "kettlebell",
      "plyo_box",
      "sled",
    ],
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
    goals:
      "Goals: muscle_gain, endurance | Training background: 6 years CrossFit, competitive regionals | Likes: Olympic lifts, gymnastics | Dislikes: machines",
    injuries: "Previous left shoulder impingement (resolved)",
    height_cm: 165,
    weight_kg: 63,
    emergency_contact_name: "David Kim",
    emergency_contact_phone: "+61 400 333 444",
    available_equipment: [
      "barbell",
      "dumbbells",
      "squat_rack",
      "bench",
      "pull_up_bar",
      "kettlebell",
      "plyo_box",
      "battle_ropes",
      "medicine_ball",
      "sled",
    ],
    preferred_session_minutes: 75,
    preferred_training_days: 5,
    injury_details: [
      {
        area: "shoulder",
        side: "left",
        severity: "mild",
        notes: "Previous impingement — resolved, avoid heavy overhead volume",
      },
    ],
    training_years: 6,
  },
  {
    user_id: CLIENT_JAMES,
    date_of_birth: "2001-03-22",
    gender: "male",
    sport: "Soccer",
    position: "Midfielder",
    experience_level: "beginner",
    goals:
      "Goals: general_health, sport_specific | Training background: 1 year casual gym | Likes: anything | Dislikes: none",
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
  await supabase.from("exercise_relationships").delete().neq("id", "00000000-0000-0000-0000-000000000000")
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
  const { error: usersErr } = await supabase.from("users").upsert(
    [
      {
        id: ADMIN_ID,
        email: "admin@darrenjpaul.com",
        password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO",
        first_name: "Darren",
        last_name: "Paul",
        role: "admin",
        email_verified: true,
        status: "active",
      },
      {
        id: CLIENT_MARCUS,
        email: "marcus@test.com",
        password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO",
        first_name: "Marcus",
        last_name: "Thompson",
        role: "client",
        email_verified: true,
        status: "active",
      },
      {
        id: CLIENT_SARAH,
        email: "sarah@test.com",
        password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO",
        first_name: "Sarah",
        last_name: "Kim",
        role: "client",
        email_verified: true,
        status: "active",
      },
      {
        id: CLIENT_JAMES,
        email: "james@test.com",
        password_hash: "$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO",
        first_name: "James",
        last_name: "Rodriguez",
        role: "client",
        email_verified: true,
        status: "active",
      },
    ],
    { onConflict: "id" },
  )
  if (usersErr) throw new Error(`Users: ${usersErr.message}`)
  console.log("  ✓ 4 users (1 admin + 3 clients)\n")

  // 3. Client profiles
  console.log("  Inserting client profiles...")
  const { error: profilesErr } = await supabase.from("client_profiles").insert(clientProfiles)
  if (profilesErr) throw new Error(`Profiles: ${profilesErr.message}`)
  console.log("  ✓ 3 client profiles with questionnaire data\n")

  // 4. Programs
  console.log("  Inserting programs...")
  const { error: progErr } = await supabase.from("programs").insert(programs)
  if (progErr) throw new Error(`Programs: ${progErr.message}`)
  console.log(`  ✓ ${programs.length} programs\n`)

  // TODO: Re-link program exercises after Excel exercise import
  // (program_exercises insert skipped — exercise IDs not available in this script)

  // 5. Assignments
  console.log("  Inserting program assignments...")
  const { error: assignErr } = await supabase.from("program_assignments").insert(assignments)
  if (assignErr) throw new Error(`Assignments: ${assignErr.message}`)
  console.log(`  ✓ ${assignments.length} assignments\n`)

  // Summary
  console.log("═══════════════════════════════════════════")
  console.log("  Seed complete! Test accounts:")
  console.log("  ─────────────────────────────────────────")
  console.log("  Admin:  admin@darrenjpaul.com")
  console.log("  Client: marcus@test.com")
  console.log("  Client: sarah@test.com")
  console.log("  Client: james@test.com")
  console.log("═══════════════════════════════════════════")
  console.log("")
  console.log("  Marcus → Foundation Strength + Athletic Speed & Power")
  console.log("  Sarah  → Elite Performance Package")
  console.log("  James  → Foundation Strength Program")
  console.log("")
  console.log("  Clean slate — no exercise history (first week)")
  console.log("  Exercises imported separately via Excel import script")
  console.log("  All client profiles have questionnaire data")
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err.message)
  process.exit(1)
})
