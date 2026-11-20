// Photographs achievement text as whole numbers in the athlete's own unit, on
// the REAL /client/achievements page and the REAL admin client page.
//
//   npm run dev                                          # port 3050
//   node scripts/capture-achievement-whole-numbers.mjs
//
// THE DATA. Achievement text is written when a set is logged, with raw kg in it
// ("New heaviest weight: 9.071858kg"). No demo athlete on the dev clone had a
// PR logged in lbs, so this script logs three sessions of Bulgarian split squats
// for Hugo Ferrand (an lbs athlete) through POST /api/client/workouts/log, the
// same route the workout screen calls, at 20 lbs then 45 lbs, converted to kg
// exactly as the screen converts them. That route has no outward side effects
// (no email, no GHL). It skips the logging when Hugo already has those PRs, so a
// rerun does not stack more.
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
const OUT = "screenshots/achievement-whole-numbers"
const WIDTH = 1440
const HEIGHT = 900
const DSF = 2

const ATHLETE = "hugo.ferrand@djpathlete.demo"
const EXERCISE = "Bulgarian split leg squat - superslow_Quadricep"
const KG_TO_LBS = 2.20462
const lbsToKg = (lbs) => Math.round((lbs / KG_TO_LBS) * 1e6) / 1e6 // = toKg() in lib/weight-utils.ts

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

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
      if (existsSync(exe)) return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function userByEmail(email, role) {
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", email)
    .single()
  if (error || !user) throw new Error(`user not found on the dev clone: ${email}`)
  if (user.role !== role) throw new Error(`${email} is not ${role} (role=${user.role})`)
  return user
}

async function cookieFor(user) {
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

// place "left": just left of the element (on a card, that is under the icon).
// place "textEnd": just right of the last character, measured with a Range,
// because a block <p> spans the whole row and its own box ends far from the text.
async function markerOn(page, locator, caption, { dx = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 120, y: 120, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box =
    place === "textEnd"
      ? await locator.first().evaluate((el) => {
          // Union of the text of every <p> inside (title + description), so the
          // disc clears whichever line is longer.
          const lines = el.querySelectorAll("p").length ? Array.from(el.querySelectorAll("p")) : [el]
          const boxes = lines.map((n) => {
            const r = document.createRange()
            r.selectNodeContents(n)
            return r.getBoundingClientRect()
          })
          const x = Math.min(...boxes.map((b) => b.x))
          const y = Math.min(...boxes.map((b) => b.y))
          const right = Math.max(...boxes.map((b) => b.right))
          const bottom = Math.max(...boxes.map((b) => b.bottom))
          return { x, y, width: right - x, height: bottom - y }
        })
      : await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 120, y: 120, caption }
  }
  const cx = place === "textEnd" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

const HIDE_CHROME = `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
  [class*="intercom"], [id*="intercom"] { display: none !important; }`

const athlete = await userByEmail(ATHLETE, "client")
const admin = await userByEmail(env.DEV_AUTH_BYPASS_EMAIL, "admin")
const { data: exercise } = await supabase.from("exercises").select("id").eq("name", EXERCISE).single()
if (!exercise) throw new Error(`exercise not found: ${EXERCISE}`)

const browser = await launchChromium()
mkdirSync(OUT, { recursive: true })

try {
  // ── 1. Log the sessions as the athlete (skipped on a rerun) ────────────────
  const actx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
  await actx.addCookies([await cookieFor(athlete)])
  const { count: already } = await supabase
    .from("achievements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", athlete.id)
    .like("title", "Bulgarian split leg squat%")
  if ((already ?? 0) === 0) {
    const sessions = [
      [20, 8, 8, 8],
      [45, 8, 10, 12],
      [45, 15],
    ]
    for (const [lbs, ...reps] of sessions) {
      const kg = lbsToKg(lbs)
      const res = await actx.request.post(`${APP}/api/client/workouts/log`, {
        data: {
          exercise_id: exercise.id,
          sets_completed: reps.length,
          reps_completed: String(Math.max(...reps)),
          weight_kg: kg,
          set_details: reps.map((r, i) => ({ set_number: i + 1, weight_kg: kg, reps: r })),
        },
      })
      const body = await res.json()
      if (!res.ok()) throw new Error(`log failed ${res.status()}: ${JSON.stringify(body)}`)
      console.log(`  logged ${lbs} lbs x ${reps.join("/")}: ${(body.achievements ?? []).length} achievement(s)`)
    }
  } else {
    console.log(`  Hugo already has ${already} Bulgarian split squat achievement(s); not logging again`)
  }
  const { data: stored } = await supabase
    .from("achievements")
    .select("description")
    .eq("user_id", athlete.id)
    .like("title", "Bulgarian split leg squat%")
  if (!stored?.some((a) => /\d\.\d+kg/.test(a.description ?? ""))) {
    throw new Error("no stored description has a decimal kg in it — the fix is not under test")
  }
  console.log("  stored text (raw kg):", stored.map((a) => a.description))

  // ── 2. Athlete's achievements page ─────────────────────────────────────────
  const page = await actx.newPage()
  await page.goto(`${APP}/client/achievements`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(2500)
  if (!page.url().includes("/client/achievements")) throw new Error(`athlete session did not land (at ${page.url()})`)
  await page.addStyleTag({ content: HIDE_CHROME })
  await page.mouse.move(4, 4)
  await page.waitForTimeout(800) // card entrance animation

  const cardText = (await page.locator("p.line-clamp-2").allTextContents()).join(" | ")
  console.log("  athlete page shows:", cardText)
  if (/\d\.\d+(kg|lbs)/.test(cardText)) throw new Error("a decimal weight is still on the athlete page")
  if (!/\d+lbs/.test(cardText)) throw new Error("no lbs weight on the athlete page — presence control failed")

  await page.screenshot({ path: `${OUT}/.raw-01-athlete.png` })
  const r1 = await annotate(`${OUT}/.raw-01-athlete.png`, `${OUT}/01-athlete-achievements.png`, {
    title: "Athlete's Achievements page: whole numbers, in pounds",
    subtitle:
      "The real /client/achievements page, signed in as a demo athlete who logs in lbs. " +
      "He lifted 20 lb, then 45 lb dumbbells. Before this change the same PRs read 9.071858kg and 20.411681kg.",
    markers: [
      await markerOn(page, page.getByText("New heaviest weight: 45lbs", { exact: false }), "45 lb dumbbell, shown as 45lbs (was 20.411681kg).", {
        dx: -25,
      }),
      await markerOn(page, page.getByText("New session volume record", { exact: false }).first(), "Volume rounded to the nearest pound.", {
        dx: -25,
      }),
    ],
  })
  console.log(`  01-athlete-achievements.png  ${r1.width}x${r1.height}`)
  await actx.close()

  // ── 3. Coach's view of the same athlete ────────────────────────────────────
  const cctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
  await cctx.addCookies([await cookieFor(admin)])
  const cpage = await cctx.newPage()
  await cpage.goto(`${APP}/admin/clients/${athlete.id}`, { waitUntil: "domcontentloaded" })
  await cpage.waitForLoadState("networkidle").catch(() => {})
  await cpage.waitForTimeout(2500)
  if (!cpage.url().includes(`/admin/clients/${athlete.id}`)) throw new Error(`admin session did not land (at ${cpage.url()})`)
  await cpage.addStyleTag({ content: HIDE_CHROME })
  const heading = cpage.getByRole("heading", { name: "Achievements", exact: true })
  await heading.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }))
  await cpage.mouse.wheel(0, -80)
  await cpage.mouse.move(4, 4)
  await cpage.waitForTimeout(600)
  const adminText = (await cpage.getByText(/New (heaviest|session|most|estimated)/).allTextContents()).join(" | ")
  console.log("  admin page shows:", adminText)
  if (/\d\.\d+(kg|lbs)/.test(adminText)) throw new Error("a decimal weight is still on the admin page")
  if (!/\d+(kg|lbs)/.test(adminText)) throw new Error("no weight on the admin page — presence control failed")
  // 100 workouts read as 100 kg = 220.46 lbs (or "100 kg") in the old right-hand column.
  const section = await heading.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]").innerText()
  if (/220\.46|100 kg/.test(section)) throw new Error("the milestone row still shows its count as a weight")

  await cpage.screenshot({ path: `${OUT}/.raw-02-coach.png` })
  const r2 = await annotate(`${OUT}/.raw-02-coach.png`, `${OUT}/02-coach-client-page.png`, {
    title: "Coach's view of the same athlete: whole numbers, no stray column",
    subtitle: "The real /admin/clients page for the same athlete. The coach sees the weights in the unit set in the coach's own settings.",
    markers: [
      await markerOn(cpage, cpage.getByText("New heaviest weight", { exact: false }).first().locator(".."), "Whole numbers, no decimals.", {
        place: "textEnd",
        dx: 20,
      }),
      await markerOn(cpage, cpage.getByText("100 Workouts!", { exact: true }).locator(".."), "The column on the right is gone. It showed a weight on every row, so “100 Workouts!” read “220.46 lbs”.", {
        place: "textEnd",
        dx: 20,
      }),
    ],
  })
  console.log(`  02-coach-client-page.png  ${r2.width}x${r2.height}`)
  await cctx.close()
} finally {
  await browser.close()
}
