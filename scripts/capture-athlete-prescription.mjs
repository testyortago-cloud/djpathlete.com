// Drives the REAL athlete-facing /client/workouts screen and photographs the
// prescription an athlete is actually shown for a `flexibility` exercise the
// coach prescribed REPS for.
//
//   npm run dev                                                   # port 3050
//   node scripts/capture-athlete-prescription.mjs --phase before|after
//
// SIGNING IN AS AN ATHLETE. /api/dev/login is admin-only and hardcoded to
// DEV_AUTH_BYPASS_EMAIL, so it cannot reach this screen. This script mints the
// same NextAuth JWT the route mints, for a demo CLIENT on the dev clone, using
// the local NEXTAUTH_SECRET. It asserts the session landed on /client before
// photographing anything — an expired or refused token otherwise reports as a
// feature failure that mimics the bug.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { encode } from "next-auth/jwt"
import { createClient } from "@supabase/supabase-js"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/hidden-exercise-params"
const WIDTH = 1280
const HEIGHT = 900
const DSF = 2

// Jasper Vance, "Hian Operation Athlete Build" week 2 — Wednesday carries
// "Back stretch thoracic_Back": flexibility, 2 sets / 6 each position / 30s rest.
const ATHLETE = "jasper.vance@djpathlete.demo"
const EXERCISE = "Back stretch thoracic_Back"
const DAY_LABEL = "Wednesday"

const phase = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : null
if (phase !== "before" && phase !== "after") throw new Error("pass --phase before|after")

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 120, y: 120, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 120, y: 120, caption }
  }
  const cx =
    place === "center" ? box.x + box.width / 2 : place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function mintAthleteCookie() {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", ATHLETE)
    .single()
  if (error || !user) throw new Error(`athlete not found on the dev clone: ${ATHLETE}`)
  if (user.role !== "client") throw new Error(`${ATHLETE} is not a client (role=${user.role})`)
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      role: user.role,
    },
    maxAge: 24 * 60 * 60,
  })
  return { name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" }
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  await ctx.addCookies([await mintAthleteCookie()])
  const page = await ctx.newPage()
  await page.goto(`${APP}/client/workouts`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(2500)
  // Assert the session FIRST.
  if (!page.url().includes("/client")) {
    throw new Error(`athlete session did not reach /client (at ${page.url()})`)
  }
  // Hide the framework overlay and the floating help dock — neither is part of
  // what the athlete is being shown here.
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })

  // Walk the real week / day tabs the way an athlete would, until the exercise
  // is on screen. The tabs are labelled "Day N" in program order, not by
  // weekday, so they cannot be addressed by name.
  async function onScreen() {
    return (await page.getByText(EXERCISE, { exact: false }).count()) > 0
  }
  let found = await onScreen()
  const nextWeek = page.getByRole("button", { name: "Next week" })
  for (let w = 0; w < 8 && !found; w++) {
    const dayTabs = page.locator('button:has(span:text-is("Day"))')
    const n = await dayTabs.count()
    for (let i = 0; i < n && !found; i++) {
      await dayTabs.nth(i).click()
      await page.waitForTimeout(600)
      found = await onScreen()
    }
    if (found) break
    if ((await nextWeek.count()) === 0 || (await nextWeek.isDisabled())) break
    await nextWeek.click()
    await page.waitForTimeout(900)
  }
  if (!found) throw new Error(`walked every week/day tab and never found "${EXERCISE}"`)

  // Centre the card in the viewport. scrollIntoViewIfNeeded() is satisfied by a
  // sliver at the bottom edge, which is exactly where the prescription row gets
  // cropped off — the one thing this shot exists to show.
  const card = page.getByText(EXERCISE, { exact: false }).first()
  await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }))
  await page.waitForTimeout(400)
  await page.mouse.move(4, 4)
  await page.waitForTimeout(400)

  // Scope the check to THIS card. Counting Reps cells page-wide would pass in
  // both phases — the other exercises on the day are strength moves that have
  // always shown reps, so a page-wide count proves nothing about the fix.
  const probe = await page.evaluate((name) => {
    const named = Array.from(document.querySelectorAll("p")).filter((n) => n.textContent?.includes(name))
    if (named.length === 0) return { foundCard: false }
    let el = named[0]
    while (el && !el.querySelector?.("div.leading-tight")) el = el.parentElement
    if (!el) return { foundCard: true, cells: [] }
    const all = Array.from(document.querySelectorAll("div.leading-tight"))
    const mine = Array.from(el.querySelectorAll("div.leading-tight"))
    const repsNode = mine.find((d) => (d.textContent ?? "").startsWith("Reps"))
    return {
      foundCard: true,
      cells: mine.map((d) => d.textContent),
      repsIndex: repsNode ? all.indexOf(repsNode) : -1,
    }
  }, EXERCISE)
  if (!probe.foundCard) throw new Error(`card for "${EXERCISE}" not on screen`)
  console.log(`  [${phase}] this card's cells: ${JSON.stringify(probe.cells)}`)
  const shown = probe.repsIndex >= 0
  if (phase === "before" && shown) throw new Error("BEFORE pass sees the fix — revert and let dev recompile")
  if (phase === "after" && !shown) throw new Error("AFTER pass does not see the fix — stale build?")
  // Presence control: an absent Reps cell only means something if the card DID
  // render its other prescription values.
  if (!probe.cells.some((t) => (t ?? "").startsWith("Sets"))) {
    throw new Error("this card rendered no Sets cell either — the card did not render, the fix is not under test")
  }
  const repsCell = page.locator("div.leading-tight").nth(probe.repsIndex)

  mkdirSync(OUT, { recursive: true })
  const name = phase === "before" ? "03-athlete-before" : "04-athlete-after"
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const markers =
    phase === "before"
      ? [
          await markerOn(
            page,
            page.getByText(EXERCISE, { exact: false }).first(),
            "Sets, Rest, Tempo and Intensity are shown for this stretch. Reps is not — and the coach set it to “6 each position”.",
            { place: "left", dx: -26 },
          ),
        ]
      : [
          // Park the disc in the empty space to the RIGHT of the prescription row.
          // Anywhere left of it lands on the order badge or the Sets value.
          await markerOn(page, repsCell.first(), "Reps — “6 each position”, exactly what the coach wrote.", {
            place: "after",
            dx: 280,
          }),
        ]
  const r = await annotate(raw, `${OUT}/${name}.png`, {
    title:
      phase === "before"
        ? "BEFORE — the athlete is never told how many reps to do"
        : "AFTER — the athlete sees the reps the coach prescribed",
    subtitle: `The real /client/workouts screen, signed in as a demo athlete. ${EXERCISE} is a flexibility exercise ` +
      `prescribed “6 each position”; the category hid that from the athlete as well as from the coach.`,
    markers,
  })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
} finally {
  await browser.close()
}
