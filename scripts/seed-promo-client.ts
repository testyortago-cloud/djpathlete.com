/**
 * Seeds the fictional athlete the client-app promo films.
 *
 * The promo is REAL captured UI, so every beat needs real rows behind it:
 * a 6-week program sitting at week 3, a hero lift with a demo video and a
 * `requires_video` flag, enough history that 42.5kg registers as a genuine PR,
 * a reviewed form submission, and an achievements grid.
 *
 * Two rules this script exists to enforce:
 *  - CLONE the source program. Setting `requires_video` on the live Rotational
 *    Reboot would reach real clients on their next workout.
 *  - RESET BY user_id, not by the `dded0000-` id prefix. Recording drives the
 *    real app, which writes its own rows with real UUIDs that no prefix filter
 *    would ever catch. Take 2 would then film take 1's leftovers.
 *
 * Run: npx tsx scripts/seed-promo-client.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, "../.env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// The dev clone is `anjvz…`; production is `epzuvz…`. This script mutates a
// program and writes a user — never let it point at prod by accident.
const PROD_REF = "epzuvz"
if (SUPABASE_URL.includes(PROD_REF)) {
  console.error(`REFUSING TO RUN: ${SUPABASE_URL} is the PRODUCTION project.`)
  process.exit(1)
}

// ─── Fixed IDs ──────────────────────────────────────────────────────────────

const USER_ID = "dded0000-0000-0000-0000-000000000001"
const PROFILE_ID = "dded0000-0000-0000-0000-000000000002"
const PROGRAM_ID = "dded0000-0000-0000-0000-000000000003"
const ASSIGNMENT_ID = "dded0000-0000-0000-0000-000000000004"

const SOURCE_PROGRAM = "Rotational Reboot"
// The hero must be a LOADED lift: the client card hides the weight box entirely
// when `exercises.is_bodyweight` is true, which kills the "42.5 kilos" beat.
// (Straddle squat looks right — barbell equipment — but is flagged bodyweight
// in the library, and that row is shared with real clients' programs.)
const HERO_EXERCISE = "Rotation Chest press"
const HERO_WEEK = 3
const TOTAL_WEEKS = 6
/** The prescription the promo shows, and the number it beats. */
const HERO_SETS = 4
const HERO_REPS = "6"
const HERO_SUGGESTED_KG = 40

// bcrypt hash of "password123" (12 rounds) — same as scripts/seed-test-client.ts
const PASSWORD_HASH = "$2b$12$iPa7C.O5i1QC7Z/.jufFWO6unJYCfBOCfdERL4ogheRgRdbHuKosa"

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10)

async function main() {
  console.log(`project: ${SUPABASE_URL}`)

  // ─── Resolve source rows ──────────────────────────────────────────────────

  const { data: srcProgram, error: srcErr } = await supabase
    .from("programs")
    .select("*")
    .ilike("name", SOURCE_PROGRAM)
    .limit(1)
    .single()
  if (srcErr || !srcProgram) throw new Error(`source program "${SOURCE_PROGRAM}" not found: ${srcErr?.message}`)

  const { data: hero, error: heroErr } = await supabase
    .from("exercises")
    .select("id, name, video_url, is_bodyweight")
    .ilike("name", HERO_EXERCISE)
    .limit(1)
    .single()
  if (heroErr || !hero) throw new Error(`hero exercise "${HERO_EXERCISE}" not found: ${heroErr?.message}`)
  if (!hero.video_url) throw new Error(`hero exercise "${HERO_EXERCISE}" has no video_url — the demo beat needs one`)
  if (hero.is_bodyweight) {
    throw new Error(`hero exercise "${HERO_EXERCISE}" is flagged is_bodyweight — the client card hides the weight box, so the 42.5kg beat cannot be filmed`)
  }

  const { data: coach } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .single()
  const COACH_ID = coach?.id ?? null

  // ─── Reset by user_id (see header) ────────────────────────────────────────

  console.log("resetting previous take…")
  await supabase.from("achievements").delete().eq("user_id", USER_ID)
  await supabase.from("exercise_progress").delete().eq("user_id", USER_ID)
  await supabase.from("form_reviews").delete().eq("client_user_id", USER_ID)
  await supabase.from("workout_sessions").delete().eq("user_id", USER_ID)
  await supabase.from("daily_readiness").delete().eq("client_user_id", USER_ID)
  await supabase.from("user_consents").delete().eq("user_id", USER_ID)

  const { data: oldAssigns } = await supabase.from("program_assignments").select("id").eq("user_id", USER_ID)
  for (const a of oldAssigns ?? []) {
    await supabase.from("program_week_access").delete().eq("assignment_id", a.id)
    await supabase.from("tracked_exercises").delete().eq("assignment_id", a.id)
  }
  await supabase.from("program_assignments").delete().eq("user_id", USER_ID)
  await supabase.from("program_exercises").delete().eq("program_id", PROGRAM_ID)
  await supabase.from("programs").delete().eq("id", PROGRAM_ID)
  await supabase.from("client_profiles").delete().eq("user_id", USER_ID)
  await supabase.from("users").delete().eq("id", USER_ID)

  // ─── Athlete ──────────────────────────────────────────────────────────────

  const { error: userErr } = await supabase.from("users").insert({
    id: USER_ID,
    email: "jordan@promo.demo",
    password_hash: PASSWORD_HASH,
    first_name: "Jordan",
    last_name: "Ellis",
    role: "client",
    status: "active",
    email_verified: true,
    created_at: iso(120),
  })
  if (userErr) throw userErr

  const { error: profErr } = await supabase.from("client_profiles").insert({
    id: PROFILE_ID,
    user_id: USER_ID,
    date_of_birth: "1998-04-19",
    gender: "male",
    sport: "Golf",
    position: null,
    experience_level: "intermediate",
    goals: "Rotational power and a stronger, more resilient lower body",
    height_cm: 180,
    weight_kg: 78,
    weight_unit: "kg",
    emergency_contact_name: "Sam Ellis",
    emergency_contact_phone: "+61 400 000 000",
    available_equipment: ["barbell", "dumbbells", "squat_rack", "bench", "cable_machine", "band"],
    preferred_session_minutes: 60,
    preferred_training_days: 4,
    training_years: 5,
    sleep_hours: "7",
    stress_level: "moderate",
    occupation_activity_level: "moderate",
    movement_confidence: "comfortable",
    training_background: "5 years of gym training alongside competitive golf",
    created_at: iso(120),
  })
  if (profErr) throw profErr

  // ─── Cloned program ───────────────────────────────────────────────────────

  const { error: progErr } = await supabase.from("programs").insert({
    ...srcProgram,
    id: PROGRAM_ID,
    // Same on-screen name (it's Darren's real product, and it's in frame),
    // but hidden from every listing so the clone can't be assigned by hand.
    name: srcProgram.name,
    is_active: false,
    is_public: false,
    duration_weeks: TOTAL_WEEKS,
    created_at: iso(120),
    updated_at: iso(120),
  })
  if (progErr) throw progErr

  const { data: srcExercises, error: peReadErr } = await supabase
    .from("program_exercises")
    .select("*")
    .eq("program_id", srcProgram.id)
  if (peReadErr) throw peReadErr
  if (!srcExercises?.length) throw new Error("source program has no exercises")

  // Clone every slot, then promote one to hero: the demo video beat and the
  // "film your set" beat both hang off this single row.
  let heroSlotFound = false
  const cloned = srcExercises.map((pe) => {
    const { id: _drop, ...rest } = pe
    const isHeroSlot = pe.week_number === HERO_WEEK && pe.day_of_week === 1 && pe.order_index === 0
    if (!isHeroSlot) return { ...rest, program_id: PROGRAM_ID }
    heroSlotFound = true
    return {
      ...rest,
      program_id: PROGRAM_ID,
      exercise_id: hero.id,
      sets: HERO_SETS,
      reps: HERO_REPS,
      rest_seconds: 120,
      suggested_weight_kg: HERO_SUGGESTED_KG,
      requires_video: true,
      notes: "Brace hard, sit between the hips. Film one working set from the side.",
    }
  })
  if (!heroSlotFound) throw new Error(`no slot at week ${HERO_WEEK} / day 1 / index 0 to make the hero`)

  for (let i = 0; i < cloned.length; i += 200) {
    const { error } = await supabase.from("program_exercises").insert(cloned.slice(i, i + 200))
    if (error) throw error
  }

  // ─── Assignment, parked at week 3 of 6 ────────────────────────────────────

  const { error: assignErr } = await supabase.from("program_assignments").insert({
    id: ASSIGNMENT_ID,
    program_id: PROGRAM_ID,
    user_id: USER_ID,
    assigned_by: COACH_ID,
    start_date: day(16),
    status: "active",
    current_week: HERO_WEEK,
    total_weeks: TOTAL_WEEKS,
    payment_status: "not_required",
    created_at: iso(16),
  })
  if (assignErr) throw assignErr

  const { error: waErr } = await supabase.from("program_week_access").insert(
    Array.from({ length: TOTAL_WEEKS }, (_, i) => ({
      assignment_id: ASSIGNMENT_ID,
      week_number: i + 1,
      access_type: "included",
      payment_status: "not_required",
    })),
  )
  if (waErr) throw waErr

  // The liability waiver is a hard gate in front of /client/workouts — without
  // this row the recorder films a wall of legal text instead of the workout.
  const { data: waiverDoc } = await supabase
    .from("legal_documents")
    .select("id")
    .eq("document_type", "liability_waiver")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  const { error: consentErr } = await supabase.from("user_consents").insert({
    user_id: USER_ID,
    consent_type: "liability_waiver",
    legal_document_id: waiverDoc?.id ?? null,
    program_id: PROGRAM_ID,
    consented_at: iso(16),
  })
  if (consentErr) throw consentErr

  // The progress page's "Key Lifts" chart only draws for TRACKED exercises.
  const { error: trackErr } = await supabase.from("tracked_exercises").insert({
    assignment_id: ASSIGNMENT_ID,
    exercise_id: hero.id,
    target_metric: "weight",
    created_by: USER_ID,
    created_at: iso(15),
  })
  if (trackErr) throw trackErr

  // ─── History: the ramp that makes 42.5kg a real PR ────────────────────────

  const setsOf = (weight: number, reps: number, count: number, rpe: number) =>
    Array.from({ length: count }, (_, i) => ({ set_number: i + 1, reps, weight_kg: weight, rpe }))

  const heroHistory = [
    { daysAgo: 15, weight: 35, reps: 6, rpe: 7 },
    { daysAgo: 12, weight: 37.5, reps: 6, rpe: 7 },
    { daysAgo: 8, weight: 37.5, reps: 6, rpe: 8 },
    { daysAgo: 4, weight: 40, reps: 6, rpe: 8 },
  ]
  const { error: histErr } = await supabase.from("exercise_progress").insert(
    heroHistory.map((h) => ({
      user_id: USER_ID,
      exercise_id: hero.id,
      assignment_id: ASSIGNMENT_ID,
      completed_at: iso(h.daysAgo),
      sets_completed: HERO_SETS,
      reps_completed: String(h.reps),
      weight_kg: h.weight,
      rpe: h.rpe,
      set_details: setsOf(h.weight, h.reps, HERO_SETS, h.rpe),
      is_pr: false,
      created_at: iso(h.daysAgo),
    })),
  )
  if (histErr) throw histErr

  // A handful of completed sessions so streak/■counts and the progress page
  // don't read as a brand-new account.
  const { error: sessErr } = await supabase.from("workout_sessions").insert(
    [15, 12, 8, 4].map((daysAgo, i) => ({
      user_id: USER_ID,
      assignment_id: ASSIGNMENT_ID,
      week_number: Math.min(HERO_WEEK, Math.floor(i / 2) + 1),
      day_of_week: i % 2 === 0 ? 1 : 3,
      session_date: day(daysAgo),
      status: "completed",
      started_at: iso(daysAgo),
      completed_at: iso(daysAgo),
      created_at: iso(daysAgo),
    })),
  )
  if (sessErr) throw sessErr

  // ─── Achievements grid ────────────────────────────────────────────────────

  const { error: achErr } = await supabase.from("achievements").insert([
    {
      user_id: USER_ID,
      achievement_type: "milestone",
      title: "10 Workouts!",
      description: "You've completed 10 total workouts. Keep pushing!",
      metric_value: 10,
      icon: "activity",
      celebrated: true,
      earned_at: iso(9),
    },
    {
      user_id: USER_ID,
      achievement_type: "milestone",
      title: "First Week Done",
      description: "You finished every session in week 1.",
      metric_value: 1,
      icon: "activity",
      celebrated: true,
      earned_at: iso(14),
    },
    {
      user_id: USER_ID,
      achievement_type: "milestone",
      title: `${hero.name} — Weight PR!`,
      description: "New heaviest weight: 40kg (previous: 37.5kg)",
      exercise_id: hero.id,
      metric_value: 40,
      icon: "activity",
      celebrated: true,
      earned_at: iso(4),
    },
  ])
  if (achErr) throw achErr

  // ─── A form review Darren has already watched ─────────────────────────────

  const { error: frErr } = await supabase.from("form_reviews").insert({
    client_user_id: USER_ID,
    title: `${hero.name} — week 2 working set`,
    video_path: `form-reviews/${USER_ID}/week2-hero.mp4`,
    status: "reviewed",
    notes: "Depth is good and the brace is holding. Drive the floor apart on the way up.",
    program_id: PROGRAM_ID,
    assignment_id: ASSIGNMENT_ID,
    exercise_id: hero.id,
    week_number: 2,
    program_name: srcProgram.name,
    exercise_name: hero.name,
    created_at: iso(6),
    updated_at: iso(5),
  })
  if (frErr) throw frErr

  // daily_readiness is deliberately left EMPTY for today — the promo films the
  // "how recovered are you?" prompt, which only renders when today is unanswered.

  console.log(`
seeded:
  athlete     Jordan Ellis <jordan@promo.demo>  (${USER_ID})
  program     ${srcProgram.name} clone, week ${HERO_WEEK} of ${TOTAL_WEEKS}  (${PROGRAM_ID})
  hero lift   ${hero.name}  ${HERO_SETS}x${HERO_REPS} @ ${HERO_SUGGESTED_KG}kg, requires_video
  demo video  ${hero.video_url}
  history     ${heroHistory.length} entries, best 40kg  -> logging 42.5kg is a real PR
  extras      ${3} achievements, 1 reviewed form review, 4 completed sessions
  readiness   none today (the prompt renders)
`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
