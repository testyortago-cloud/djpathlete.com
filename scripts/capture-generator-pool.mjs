// Real-app capture: the AI Program Generator's Exercise Pool and Blocked panels.
//
// Writes NOTHING: the pool lives in the dialog, the Blocked panel is only opened, and the
// "Generate Program" request is caught by page.route and aborted before it leaves the
// browser, so no ai_generation_log row, no Firestore job and no AI spend. The caught body
// is checked for the pool fields.
//
// Run (dev server on 3051): node scripts/capture-generator-pool.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/generator-pool"
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

const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })).newPage()
  let sent = null
  await page.route("**/api/admin/programs/generate", async (route) => {
    sent = route.request().postDataJSON()
    await route.abort()
  })
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/programs`, { waitUntil: "load", timeout: 90000 })
  await page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  const open = page.getByRole("button", { name: /AI Generate/ })
  await open.waitFor({ timeout: 60000 })
  await page.waitForTimeout(800) // hydration
  await open.click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("AI Program Generator").waitFor()
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByRole("checkbox").first().click() // one goal
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByRole("button", { name: /^Exercise Pool/ }).click()

  const search = dialog.getByPlaceholder("Search exercises...")
  await search.waitFor({ timeout: 30000 })
  await search.fill("squat")
  await page.waitForTimeout(400)
  const addable = dialog.locator("button:not([disabled]):has(p.truncate)")
  for (let i = 0; i < 3; i++) {
    await addable.first().click()
    await page.waitForTimeout(150)
  }
  await dialog.getByRole("switch", { name: "Only use the pool" }).click()
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-pool.png` })
  await annotate(`${OUT}/raw/01-pool.png`, `${OUT}/01-pool.png`, {
    title: "Choose the exercises the AI should use",
    subtitle: "Programs > AI Generate > Settings (step 3) > Exercise Pool",
    markers: [
      await marker(dialog.getByRole("button", { name: /^Exercise Pool/ }), "Exercise Pool opens the list beside the form. The number shows how many you picked.", "before"),
      await marker(dialog.getByRole("heading", { name: "Exercise Pool" }), "Search the library and click an exercise to add it.", "above"),
      await marker(dialog.getByRole("switch", { name: "Only use the pool" }), "On: the AI uses only your picks. Off: it picks yours first and fills gaps from the library.", "after"),
    ],
  })

  await dialog.getByRole("button", { name: /^Blocked/ }).click()
  await dialog.getByRole("heading", { name: "Blocked" }).waitFor()
  await dialog.getByText(/Loading blocks/).waitFor({ state: "hidden", timeout: 30000 })
  await page.waitForTimeout(400)
  await page.mouse.move(3, 3)
  await page.screenshot({ path: `${OUT}/raw/02-blocked.png` })
  await annotate(`${OUT}/raw/02-blocked.png`, `${OUT}/02-blocked.png`, {
    title: "Exercises the AI must never use",
    subtitle: "Programs > AI Generate > Settings (step 3) > Blocked",
    markers: [
      await marker(dialog.getByRole("button", { name: /^Blocked/ }), "Blocked opens the same list as on a program page.", "after"),
      await marker(dialog.getByRole("heading", { name: "Blocked" }), "Exercises here are never used. With no client chosen, this is the list for every client.", "above"),
    ],
  })

  await dialog.getByRole("button", { name: "Generate Program" }).click()
  for (let i = 0; i < 20 && !sent; i++) await page.waitForTimeout(250)
  check("Generate Program sent a request (caught and aborted)", !!sent)
  check("it carries the 3 pool exercise ids", Array.isArray(sent.pool_exercise_ids) && sent.pool_exercise_ids.length === 3, JSON.stringify(sent.pool_exercise_ids))
  check('pool_mode is "strict" (Only use the pool on)', sent.pool_mode === "strict", sent.pool_mode)
  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI generator: pool and blocked</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}figure{margin:32px 0}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>AI Program Generator: exercise pool and blocked list</h1>
<p>Real app, development clone, light mode only. The Generate request was caught and stopped, so no program was made.</p>
<figure><img src="01-pool.png" alt="Exercise pool"><figcaption><strong>01.</strong> Pick the exercises the AI should use.</figcaption></figure>
<figure><img src="02-blocked.png" alt="Blocked"><figcaption><strong>02.</strong> Exercises the AI must never use.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, results }, null, 2))
  await browser.close()
}
