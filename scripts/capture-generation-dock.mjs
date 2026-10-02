// Photographs the REAL generation dock on the REAL program page after the
// 2026-10-02 fixes (opaque cards, program name on each card).
//
//   next dev --webpack -p 3061            # in this checkout
//   APP=http://localhost:3061 node scripts/capture-generation-dock.mjs
//
// The dock's cards read `ai_jobs/<id>` from Firestore (project darrenjpaulcom,
// public read). This script puts two REAL finished job ids into the dock's own
// sessionStorage — exactly what GenerationDialog's addJob() stores — so the
// cards show the warnings the coach was shown on 2026-10-02. It READS those
// docs and writes nothing anywhere. The program page behind is the dev clone.
//
// DEV CLONE ONLY for the page; refuses any other Supabase project.

import { mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/generation-dock"
const WIDTH = 1440
const HEIGHT = 900
const DSF = 2

// Dev-clone program for the page behind the dock.
const PROGRAM_ID = "4f37a79b-54eb-4bc4-9d7a-2035577c30d8" // "Pete Summer Build"
// Real production week-generation jobs from 2026-10-02 (Fill Week 8).
const JOBS = [
  { jobId: "cKrLezpw5QJF5HThmTzd", context: "Pete Summer Build" }, // the photo's card: 3 things to check
  { jobId: "RjBmbbkdCiOg1la0XKgC", context: "Abi's Performance Program" },
]

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
      if (existsSync(exe)) return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function markerOn(locator, caption, { place = "left", dx = 0, dy = 0 } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}"`)
    return { x: 120, y: 120, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 60)}"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}"`)
    return { x: 120, y: 120, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

mkdirSync(OUT, { recursive: true })
const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
const page = await ctx.newPage()

// Session first: an expired or refused login otherwise photographs /login.
await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`)
await page.goto(`${APP}/api/auth/session`)
const session = await page.textContent("body")
if (!session?.includes('"role":"admin"')) throw new Error(`no admin session: ${session?.slice(0, 200)}`)

// What addJob() stores, keyed as hooks/use-ai-jobs-dock.tsx keys it.
const now = Date.now()
const docked = JOBS.map((j, i) => ({
  jobId: j.jobId,
  kind: "week",
  label: "Fill Week 8",
  context: j.context,
  programId: PROGRAM_ID,
  startedAt: new Date(now - (9 - i * 2) * 60_000).toISOString(),
  resolvedState: "completed",
}))
await page.goto(`${APP}/admin/programs/${PROGRAM_ID}`)
await page.evaluate((jobs) => sessionStorage.setItem("djpathlete:ai-jobs-dock:v1", JSON.stringify(jobs)), docked)
await page.reload({ waitUntil: "load" })
if (page.url().includes("/login")) throw new Error("redirected to /login")

const dock = page.getByRole("region", { name: "AI generation status" })
await dock.getByText("3 things to check").waitFor({ timeout: 30_000 })
await page.waitForTimeout(800)
await page.mouse.move(5, 5)

// Hide the dev-only Next indicator if present; app code is untouched.
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })

const raw = `${OUT}/01-dock-over-program-page.raw.png`
await page.screenshot({ path: raw })

const doneCard = dock.locator("[data-job-id='cKrLezpw5QJF5HThmTzd']")
const markers = [
  await markerOn(
    doneCard.getByText("Pete Summer Build"),
    "Each card now names its program, so seven “Fill Week 8” runs no longer look identical.",
  ),
  await markerOn(
    doneCard.getByText("3 things to check"),
    "The card is solid. Before, its background was 5% opaque, and the page's “Thursday” and “Add Exercise” showed through the warning text.",
  ),
  await markerOn(
    doneCard.getByText(/slot w8d2s9/),
    "This text is the stored 2 Oct record, written before the wording fix. New runs say “on Tuesday” and print no slot code.",
  ),
]
await annotate(raw, `${OUT}/01-dock-over-program-page.png`, {
  title: "Generation dock — readable over the page, and named per program",
  subtitle: "Real program page (dev clone) · card contents are the real Fill Week 8 records from 2 Oct (production, read-only)",
  markers,
})

// Second shot: the dock's list scrolled to the second program's card.
const second = dock.locator("[data-job-id='RjBmbbkdCiOg1la0XKgC']")
await second.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await page.mouse.move(5, 5)
const raw2 = `${OUT}/02-second-program-card.raw.png`
await page.screenshot({ path: raw2 })
await annotate(raw2, `${OUT}/02-second-program-card.png`, {
  title: "A second program's run, told apart at a glance",
  subtitle: "Same dock, scrolled down · real 2 Oct record",
  markers: [
    await markerOn(second.getByText("Abi's Performance Program"), "The second card names its own program."),
  ],
})

await browser.close()
console.log("wrote", OUT)
