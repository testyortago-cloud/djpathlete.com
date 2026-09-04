// Calendly per-coach phase 2: the screen a coach connects their OWN Calendly
// account from, captured on the real route, in the real running app.
//
//   npm run dev > /tmp/phase2-dev.log 2>&1 &
//   node scripts/capture-calendly-phase2-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN AT /admin/bookings/calendar, signed in as the
// real dev-clone operator via /api/dev/login. No harness, no storybook, no
// isolated mount.
//
// WHAT COULD NOT BE CAPTURED, AND WHY -- stated here rather than quietly
// skipped. The two "happy path" states (connected-but-no-meeting-picked, and
// connected-with-a-meeting) both make LIVE Calendly API calls during render:
// GET /users/me for the account name and email, and GET /event_types for the
// meeting list. Reaching them needs a real Calendly OAuth application -- a
// CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET -- and no such application
// exists in any environment yet. Creating one is an owner action, not a
// scripted one. Seeding a fake connection row would render the DEGRADED
// variant of those states (both Calendly reads failing), which would be a
// screenshot of an error dressed up as a success. So those two states are
// reported as not captured.
//
// THE THREE STATES BELOW ARE ALL GENUINELY RENDERED FROM THE DATABASE ROW
// ALONE. After the fix in f7ddf104 the page only calls Calendly when the row
// is `connected` or `error`, so `plan_lapsed` and `needs_reconnect` render
// with no network call at all -- which is exactly why they can be captured
// honestly here.
//
// DEV CLONE ONLY. It refuses any other project ref outright.
//
// WRITES ARE ADDITIVE AND REVERSED. Shot 01 needs no seeding at all -- it is
// the true out-of-the-box state. Shots 02 and 03 insert ONE
// coach_calendar_connections row for the singleton's existing host, mutate its
// status, and DELETE it again at the end. Nothing else in the clone is
// touched, and the row carries no vault secret.

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/calendly-per-coach-phase2"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels
const SINGLETON = "00000000-0000-0000-0000-000000000001"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!url.includes(DEV_REF)) {
  console.error(`REFUSING TO RUN: .env.local does not point at the dev clone (${DEV_REF}).`)
  console.error(`It points at: ${url}`)
  process.exit(1)
}
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

mkdirSync(OUT, { recursive: true })

/**
 * A marker anchored to a real element. WARNS LOUDLY on both failure paths --
 * a helper that degrades politely turns a broken annotation into a silent
 * no-op, and the caption then lands on empty background with nothing to say
 * it moved.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  else if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  } else cx = box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

async function shot(page, slug, title, subtitle, markers) {
  const raw = `${OUT}/${slug}.raw.png`
  await page.screenshot({ path: raw, fullPage: true })
  await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers })
  console.log(`   wrote ${OUT}/${slug}.png`)
}

async function hostId() {
  const { data, error } = await db
    .from("booking_hosts")
    .select("id, display_name")
    .eq("business_id", SINGLETON)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`booking_hosts read failed (${error.code}): ${error.message}`)
  if (!data) throw new Error("the singleton has no booking_hosts row — 00240's backfill did not run on this clone")
  return data.id
}

async function setConnection(host, status) {
  const { error } = await db.from("coach_calendar_connections").upsert(
    {
      business_id: SINGLETON,
      host_id: host,
      provider: "calendly",
      status,
      calendly_user_uri: "https://api.calendly.com/users/SCREENSHOT",
      event_type_uri: "https://api.calendly.com/event_types/SCREENSHOT",
      scheduling_url: "https://calendly.com/darren-paul/consultation",
      webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/SCREENSHOT",
      webhook_state: status === "plan_lapsed" ? null : "active",
    },
    { onConflict: "host_id,provider" },
  )
  if (error) throw new Error(`seed failed (${error.code}): ${error.message}`)
}

async function clearConnection(host) {
  const { error } = await db
    .from("coach_calendar_connections")
    .delete()
    .eq("host_id", host)
    .eq("provider", "calendly")
  if (error) throw new Error(`cleanup failed (${error.code}): ${error.message}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
const page = await ctx.newPage()
const host = await hostId()
console.log(`singleton host: ${host}`)

try {
  console.log("\nsigning in as the real operator")
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/bookings`, { waitUntil: "domcontentloaded" })
  await page.waitForURL(/\/admin\/bookings/, { timeout: 30_000 })

  // The dev clone carries eight businesses -- the real "Primary" one plus test
  // businesses left by earlier phase-1 capture runs -- and resolveAdminTenant
  // picks the alphabetically first when no preference is set, which is one of
  // the test ones. Point the switcher at the REAL business, the same way the
  // switcher itself would. The cookie is only a preference: resolveAdminTenant
  // honours it solely because the operator's allowed set contains it.
  await ctx.addCookies([
    { name: "djp_business", value: SINGLETON, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ])
  await page.goto(`${APP}/admin/bookings/calendar`, { waitUntil: "networkidle" })

  const tenant = await page.locator("header").getByRole("combobox").first().textContent().catch(() => null)
  console.log(`   showing business: ${tenant?.trim() ?? "(could not read the switcher)"}`)

  // ---- 01: not connected — the true out-of-the-box state, zero seeding -----
  console.log("\n01 not connected (no seeding at all)")
  const connectBtn = page.getByRole("link", { name: "Connect Calendly" })
  if ((await connectBtn.count()) === 0) {
    throw new Error('expected a "Connect Calendly" control on the not-connected state and found none')
  }
  await shot(
    page,
    "01-not-connected",
    "A coach connects their own Calendly",
    "The real screen at /admin/bookings/calendar, before anything is connected. No seeding — this is what a coach sees today.",
    [
      await markerOn(page, page.getByText("Not connected").first(), "The state is on the card, not buried in a log. Nothing has been connected yet, and this is what every coach sees on day one.", { place: "right" }),
      await markerOn(page, connectBtn.first(), "One button. The coach keeps their own Calendly account and their own bill; this only asks Calendly to share the times they are free and to say when someone books.", { place: "left", dx: -30 }),
      await markerOn(page, page.getByRole("link", { name: "Bookings" }).first(), "The screen lives under Bookings, so a coach reaches it with the same access that lets them see their bookings. They do not have to be the owner.", { place: "right" }),
    ],
  )

  // ---- 02: plan_lapsed — Calendly's webhooks need a paid plan --------------
  console.log("\n02 plan_lapsed")
  await setConnection(host, "plan_lapsed")
  await page.reload({ waitUntil: "networkidle" })
  const paid = page.getByText(/paid plan \(Standard, Teams or Enterprise\)/i)
  await shot(
    page,
    "02-plan-lapsed",
    "The Free-plan wall, named in plain words",
    "Calendly only delivers bookings to us on a paid plan. Its API answers 403, and the screen says what to do about it instead of showing a generic failure.",
    [
      await markerOn(page, paid.first(), "The three plan names are on screen, so the coach knows exactly what to buy. This state exists because Calendly answers 403 to a Free account — the row is stored as 'plan_lapsed' rather than a generic error.", { place: "right" }),
    ],
  )

  // ---- 03: needs_reconnect — the grant died --------------------------------
  console.log("\n03 needs_reconnect")
  await setConnection(host, "needs_reconnect")
  await page.reload({ waitUntil: "networkidle" })
  const stopped = page.getByText(/Calendly no longer accepts our connection/i)
  await shot(
    page,
    "03-needs-reconnect",
    "When the connection dies, both ways out are offered",
    "Calendly's refresh tokens are single-use, so a revoked one cannot be renewed. The coach is told plainly — and can still disconnect, not only reconnect.",
    [
      await markerOn(page, stopped.first(), "Says what happened and what it costs, without naming a token, a grant or a webhook. It also says the coach's meetings and past bookings are untouched, which is the question they would actually ask.", { place: "right" }),
      await markerOn(page, page.getByRole("button", { name: "Disconnect" }).first(), "Disconnect stays offered on a DEAD connection. A review round found this button used to fail forever here, because disconnecting first asked Calendly for a token it could no longer give.", { place: "above", dy: -6 }),
      await markerOn(page, page.getByText("Not working").first(), "The state is a badge, not a silence. Nothing about a broken calendar is left for the coach to discover from missing bookings.", { place: "left" }),
    ],
  )

  console.log("\ndone")
} finally {
  console.log("\ncleaning up the seeded row")
  await clearConnection(host).catch((e) => console.warn(`  !! cleanup failed: ${e.message}`))
  await browser.close()
}
