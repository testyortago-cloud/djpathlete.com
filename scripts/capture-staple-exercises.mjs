// Real-app capture: staple exercises in the AI Program Generator.
//
// Writes NOTHING: the pool and staples live in the dialog, and the "Generate Program"
// request is caught by page.route and aborted before it leaves the browser, so no
// ai_generation_log row, no Firestore job and no AI spend. The caught body is checked for
// the staples.
//
// Run (dev server on 3051): node scripts/capture-staple-exercises.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/staple-exercises"
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

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const page = await (
    await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  ).newPage()
  let sent = null
  await page.route("**/api/admin/programs/generate", async (route) => {
    sent = route.request().postDataJSON()
    await route.abort()
  })
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/programs`, { waitUntil: "load", timeout: 120000 })
  await page.addStyleTag({
    content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}",
  })
  const open = page.getByRole("button", { name: /AI Generate/ })
  await open.waitFor({ timeout: 90000 })
  await page.waitForTimeout(800) // hydration
  await open.click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("AI Program Generator").waitFor()
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByRole("checkbox").first().click() // one goal
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByRole("button", { name: /^Exercise Pool/ }).click()

  // Three pool exercises: a pull-up, a squat and a row, as the coach described.
  const search = dialog.getByPlaceholder("Search exercises...")
  await search.waitFor({ timeout: 30000 })
  const picked = []
  for (const term of ["pull", "squat", "row"]) {
    await search.fill(term)
    await page.waitForTimeout(400)
    const btn = dialog.locator("button:not([disabled]):has(p.truncate)").first()
    picked.push((await btn.locator("p.truncate").first().innerText()).trim())
    await btn.click()
    await page.waitForTimeout(150)
  }
  await dialog.getByRole("button", { name: /^Exercise Pool/ }).click() // close the panel
  const box = dialog.getByText("Staple exercises")
  await box.waitFor()
  await dialog.getByRole("combobox", { name: `How often ${picked[0]} comes back` }).selectOption("3")
  await dialog.getByRole("combobox", { name: `How often ${picked[1]} comes back` }).selectOption("1")
  // The dialog scrolls on its own: centre the whole staples box, list included.
  await dialog
    .locator("div.rounded-lg.border", { hasText: "Staple exercises" })
    .evaluate((el) => el.scrollIntoView({ block: "center" }))
  const lastRow = dialog.getByRole("combobox", { name: `How often ${picked[2]} comes back` })
  const rowBox = await lastRow.boundingBox()
  check("the whole staples list is on screen", !!rowBox && rowBox.y + rowBox.height <= H, JSON.stringify(rowBox))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-staples.png` })
  await annotate(`${OUT}/raw/01-staples.png`, `${OUT}/01-staples.png`, {
    title: "Exercises that come back on a schedule",
    subtitle: "Programs > AI Generate > Settings (step 3) > Staple exercises",
    markers: [
      await marker(box, "Each exercise in the pool can be a staple.", "before"),
      await marker(
        dialog.getByRole("combobox", { name: `How often ${picked[0]} comes back` }),
        `${picked[0]}: every 3 weeks, so weeks 1, 4, 7 and 10.`,
        "after",
      ),
      await marker(
        dialog.getByRole("combobox", { name: `How often ${picked[1]} comes back` }),
        `${picked[1]}: every week.`,
        "after",
      ),
    ],
  })

  await dialog.getByRole("button", { name: "Generate Program" }).click()
  for (let i = 0; i < 20 && !sent; i++) await page.waitForTimeout(250)
  check("Generate Program sent a request (caught and aborted)", !!sent)
  const staples = sent.staple_exercises ?? []
  check("it carries 2 staples", staples.length === 2, JSON.stringify(staples))
  check(
    "one every 3 weeks, one every week",
    staples
      .map((s) => s.every_weeks)
      .sort()
      .join(",") === "1,3",
    JSON.stringify(staples),
  )
  check(
    "each staple is in the pool",
    staples.every((s) => sent.pool_exercise_ids.includes(s.exercise_id)),
  )
  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Staple exercises</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>Staple exercises in the AI Program Generator</h1>
<p>Real app, development clone, light mode only. The Generate request was caught and stopped, so no program was made.</p>
<figure><img src="01-staples.png" alt="Staple exercises"><figcaption>Pick how often each pool exercise comes back.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, results }, null, 2))
  await browser.close()
}
