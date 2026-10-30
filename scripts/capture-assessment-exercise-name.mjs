// Real-app capture: one "Exercise name" box on New assessment, any name or a library exercise.
//
// Writes NOTHING: the form is filled but never submitted. DEV CLONE ONLY for the lookup.
// The browser's suggestion list (datalist) is drawn outside the page, so it does not
// appear in screenshots; the shot shows the result of each kind of name instead.
//
// Run (dev server on 3051): node scripts/capture-assessment-exercise-name.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/performance/assessment-names"
const W = 1440
const H = 900
mkdirSync(`${OUT}/raw`, { recursive: true })

const results = []
const check = (name, ok, evidence = "") => {
  results.push({ name, ok, evidence })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}

const { data: ex } = await db.from("exercises").select("name").eq("name", "Back Squat").limit(1)
const libraryName = ex?.[0]?.name ?? (await db.from("exercises").select("name").limit(1)).data[0].name

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const page = await (
    await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  ).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/performance-assessments/new`, {
    waitUntil: "load",
    timeout: 120000,
  })
  await page.addStyleTag({
    content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}",
  })
  const first = page.getByLabel("Exercise name").first()
  await first.waitFor({ timeout: 90000 })
  await page.waitForTimeout(1000) // hydration
  await first.fill("Single leg hop for distance")
  check("a custom name is accepted and typed in full", (await first.inputValue()) === "Single leg hop for distance")
  await page.getByRole("button", { name: /Add Exercise/ }).click()
  const second = page.getByLabel("Exercise name").nth(1)
  await second.fill(libraryName)
  const cards = page.locator("div.rounded-xl", { has: page.getByLabel("Exercise name") })
  check("the custom one is marked Custom", await cards.nth(0).getByText("Custom", { exact: true }).isVisible())
  check(`"${libraryName}" links the library exercise`, await cards.nth(1).getByText("From Library").isVisible())
  check("the box stays editable after a library pick", await second.isEnabled())
  check(
    "the suggestion list holds more than 20 exercises",
    (await page.locator("#assessment-exercise-library option").count()) > 20,
  )
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
  // Both exercise cards on screen: start the view at the "Exercises (2)" heading.
  await page.getByText(/^Exercises \(2\)$/).evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -80))
  const box2 = await second.boundingBox()
  check("both exercise cards fit in the shot", !!box2 && box2.y + box2.height < H - 20, JSON.stringify(box2))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-exercise-names.png` })
  await annotate(`${OUT}/raw/01-exercise-names.png`, `${OUT}/01-exercise-names.png`, {
    title: "One box for the exercise name",
    subtitle: "Assessments > New assessment > Exercises",
    markers: [
      await marker(cards.nth(0).getByText("Custom", { exact: true }), "Any name you type is used as it is.", "after"),
      await marker(cards.nth(1).getByText("From Library"), "A name from your library links that exercise.", "after"),
      await marker(second, "Start typing: your library shows as suggestions. You can still change it.", "above"),
    ],
  })
  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Assessment exercise names</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>New assessment: one box for the exercise name</h1>
<p>Real app, development clone, light mode. The form was filled but not submitted.</p>
<figure><img src="01-exercise-names.png" alt="Exercise names"><figcaption>A custom name, and a library exercise picked by typing its name.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, results }, null, 2))
  await browser.close()
}
