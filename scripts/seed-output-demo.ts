// Seeds ONE test client on the DEV clone with 12 weeks of Output Sports results, so the Output
// panel, the test cards, the Arena card and the test report all have something real-looking to show.
//
// Output's API is read-only (it cannot create athletes or results), so the results are built as
// Output measurements and written through the app's own import path (measurementsToTests ->
// upsertImportedTests -> recomputeDownstream), exactly as a sync would write them. Every row's note
// says it is seeded demo data.
//
// The client is linked to Output's existing test athlete "Test Tester", and the dev app is connected
// to Output (Darren's login from .env.local) through the real Settings API, so the panel shows
// "Linked to Test Tester". DEV CLONE ONLY. Re-running replaces the seeded rows; nothing else changes.
//
// Run (dev server on 3050):  npx tsx scripts/seed-output-demo.ts
// Remove:                    npx tsx scripts/seed-output-demo.ts --remove
import dotenv from "dotenv"
dotenv.config({ path: ".env.local", quiet: true })

const DEV_REF = "anjvztjiokcgiyhobknq"
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(DEV_REF)) throw Error("Development clone only")

// Inside a function: the repo's tsconfig does not allow top-level await. The imports stay dynamic so
// .env.local is loaded before lib/ reads it.
async function main() {
  const { createClient } = await import("@supabase/supabase-js")
  const { measurementsToTests } = await import("@/lib/output-sports/map")
  const { signIn, listAthletes } = await import("@/lib/output-sports/api")
  const { upsertImportedTests, markSynced } = await import("@/lib/db/output-sports")
  const { recomputeDownstream } = await import("@/lib/db/performance-tests")

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const APP = process.env.APP_URL ?? "http://localhost:3050"
  const EMAIL = "output-demo@example.com"
  const DAY = 86_400_000

  async function existingClient() {
    const { data } = await db.from("users").select("id").eq("email", EMAIL).maybeSingle()
    return data?.id as string | undefined
  }

  if (process.argv.includes("--remove")) {
    const id = await existingClient()
    if (id) {
      await db.from("performance_tests").delete().eq("client_user_id", id)
      await db.from("output_athlete_links").delete().eq("client_user_id", id)
      await db.from("client_profiles").delete().eq("user_id", id)
      await db.from("users").delete().eq("id", id)
    }
    console.log(id ? "removed the test client and its results" : "nothing to remove")
    console.log("The dev Output connection stays; disconnect it in Settings > Output Sports if you want it gone.")
    return
  }

  // 1. The test client.
  let clientId = await existingClient()
  if (!clientId) {
    const { data, error } = await db
      .from("users")
      .insert({
        email: EMAIL,
        first_name: "Jordan",
        last_name: "Reyes",
        role: "client",
        status: "active",
        email_verified: true,
      })
      .select("id")
      .single()
    if (error) throw error
    clientId = data.id as string
  }
  const { error: profileError } = await db.from("client_profiles").upsert(
    {
      user_id: clientId,
      date_of_birth: "2003-05-14",
      gender: "male",
      sport: "Pickleball",
      height_cm: 180,
      weight_kg: 78,
      weight_unit: "kg",
      additional_notes: "Seeded test client for the Output Sports demo (scripts/seed-output-demo.ts).",
    },
    { onConflict: "user_id" },
  )
  if (profileError) throw profileError

  // 2. Connect the dev app to Output through the real Settings API, as the dev admin, so the business
  //    is the one the admin screens resolve to.
  const login = await fetch(`${APP}/api/dev/login?callbackUrl=/admin`, { redirect: "manual" })
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ")
  if (!cookie) throw Error(`dev login failed (${login.status}); is the dev server running on ${APP}?`)
  const conn = await fetch(`${APP}/api/admin/output-sports/connection`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ email: process.env.OUTPUT_OWNER_EMAIL, password: process.env.OUTPUT_OWNER_PASSWORD }),
  })
  if (!conn.ok) throw Error(`connect failed: ${conn.status} ${(await conn.text()).slice(0, 200)}`)
  const { connection } = (await conn.json()) as { connection: { business_id: string } }
  const businessId = connection.business_id
  const { data: admin } = await db.from("users").select("id").eq("email", process.env.DEV_AUTH_BYPASS_EMAIL!).single()
  const adminId = admin!.id as string

  // 3. Link to Output's "Test Tester" (directly: linking through the API would also pull that athlete's
  //    real results, which would mix with the seeded series).
  const tokens = await signIn(process.env.OUTPUT_OWNER_EMAIL!, process.env.OUTPUT_OWNER_PASSWORD!)
  const tester = (await listAthletes(tokens.accessToken)).find((a) => /test tester/i.test(a.fullName ?? ""))
  if (!tester) throw Error('Output athlete "Test Tester" not found')
  await db.from("output_athlete_links").delete().eq("client_user_id", clientId)
  await db.from("output_athlete_links").insert({
    business_id: businessId,
    client_user_id: clientId,
    output_athlete_id: tester.id,
    output_athlete_name: "Test Tester",
    linked_by: adminId,
  })

  // 4. Twelve weeks of Output results: a test session every 2 weeks, lifts every week. Deterministic
  //    noise, so a re-run writes the same numbers.
  let seed = 7
  const noise = (spread: number) => {
    seed = (seed * 16807) % 2147483647
    return ((seed / 2147483647) * 2 - 1) * spread
  }
  const now = new Date()
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString().slice(0, 10) + "T12:00:00Z"
  type M = Parameters<typeof measurementsToTests>[0][number]
  const measurements: M[] = []
  let n = 0
  const add = (exerciseId: string, category: string, completedDate: string, metrics: Record<string, number>) =>
    measurements.push({
      id: `seed-${++n}`,
      athleteId: tester.id,
      exerciseId,
      exerciseCategory: category,
      completedDate,
      variant: null,
      metrics: Object.entries(metrics).map(([field, value]) => ({ field, value })),
    })
  // start -> end over the block, with session 4 a little flat (a heavy training week).
  const prog = (start: number, end: number, i: number, of: number) =>
    start + ((end - start) * i) / (of - 1) - (i === 3 ? (end - start) * 0.25 : 0)

  const SESSIONS = 7 // days ago: 84, 70, ..., 0
  for (let i = 0; i < SESSIONS; i++) {
    const date = at(84 - i * 14)
    const tries = (start: number, end: number, spread: number, count: number) =>
      Array.from({ length: count }, () => prog(start, end, i, SESSIONS) + noise(spread))
    for (const h of tries(0.405, 0.452, 0.012, 3))
      add("BILATERAL_CMJ", "Jumps", date, { jumpHeight: h, flightTime: Math.sqrt((8 * h) / 9.81) })
    for (const h of tries(0.365, 0.402, 0.01, 3)) add("SQUAT_JUMP", "Jumps", date, { jumpHeight: h })
    for (const h of tries(0.31, 0.36, 0.01, 3))
      add("BILATERAL_DROP_JUMP", "Reactive Strength", date, { jumpHeight: h, rsi: 1.55 + (h - 0.31) * 8 + noise(0.05) })
    for (const d of tries(2.32, 2.49, 0.03, 3)) add("BILATERAL_BROAD_JUMP_INPUT", "Inputs", date, { jumpDistance: d })
    for (const t of tries(1.84, 1.75, 0.02, 3)) add("10_METRE_TIME_INPUT", "Inputs", date, { duration: t })
    for (const t of tries(3.17, 3.05, 0.03, 2)) add("20_METRE_TIME_INPUT", "Inputs", date, { duration: t })
    for (const t of tries(5.58, 5.39, 0.04, 2)) add("40_METRE_TIME_INPUT", "Inputs", date, { duration: t })
    for (const t of tries(4.86, 4.68, 0.04, 2)) add("5_10_5_AGILITY_TEST_INPUT", "Inputs", date, { duration: t })
    for (const t of tries(10.45, 10.02, 0.08, 2)) add("T_TEST_AGILITY", "Speed & Agility", date, { duration: t })
    // Left in Output (no matching test in the app): shows up in the "Kept in Output only" count.
    add("KNEE_TO_WALL", "Mobility", date, { rangeOfMotion: 52 + i + noise(2) })
  }
  const WEEKS = 13
  for (let w = 0; w < WEEKS; w++) {
    const date = at(84 - w * 7 + 1) // the day before each test day, and every week between
    const lift = (id: string, start: number, end: number) => {
      const e1rm = start + ((end - start) * w) / (WEEKS - 1) + noise(1.5)
      for (const f of [0.82, 0.9, 0.96, 1])
        add(id, "Barbell Velocity", date, { estimatedOneRepMax: e1rm * f, meanVelocity: 1.1 - f * 0.4 })
    }
    lift("BARBELL_BACK_SQUAT", 120, 133)
    lift("BARBELL_BENCH_PRESS", 86, 93)
    lift("BARBELL_DEADLIFT", 145, 160)
  }

  // 5. Write them the way a sync would, then fix PRs and mark the link synced.
  const { data: settings } = await db
    .from("business_settings")
    .select("timezone")
    .eq("business_id", businessId)
    .maybeSingle()
  const timeZone = (settings?.timezone as string | undefined) ?? "UTC"
  const { rows, skipped } = measurementsToTests(measurements, timeZone, tester.id)
  const seeded = rows.map((r) => ({ ...r, notes: `${r.notes}. Seeded demo data` }))
  await db.from("performance_tests").delete().eq("client_user_id", clientId).not("output_key", "is", null)
  await upsertImportedTests(clientId, seeded, adminId)
  for (const testType of new Set(seeded.map((r) => r.test_type)))
    await recomputeDownstream(clientId, testType, "1900-01-01")
  await markSynced(businessId, clientId, now)

  const byType = seeded.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.test_type]: (acc[r.test_type] ?? 0) + 1 }),
    {},
  )
  console.log(`client: Jordan Reyes <${EMAIL}>  id ${clientId}`)
  console.log(`linked to Output athlete "Test Tester" in business ${businessId} (time zone ${timeZone})`)
  console.log(`${measurements.length} Output measurements -> ${seeded.length} test results:`, JSON.stringify(byType))
  console.log("left in Output:", JSON.stringify(skipped))
  console.log(`open: ${APP}/admin/clients/${clientId}/performance?tab=tests`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
