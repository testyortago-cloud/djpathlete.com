// G47: a coach's clone of the built-in quiz, in the real quiz editor on the
// real route of the real running app.
//
//   npx next dev --port 3087 > <scratchpad>/g47-dev.log 2>&1 &
//   APP=http://localhost:3087 node scripts/capture-g47-quiz-button-screenshots.mjs
//
// THE SUBJECT IS A REAL CLONE. As "Trailhead Strength & Conditioning"
// (82d5b238-1653-4a04-9d2d-2f65e5a8c225), a coach's business on the dev clone,
// the script creates a quiz funnel copied from "Athlete Quiz — the original"
// through the same POST /api/admin/funnels the "New funnel" dialog calls, then
// opens the quiz that clone made at /admin/funnels/quizzes/<id>.
//   01  the editor's "Worth a look:" list: four bands with no button.
//   02  the Tiers tab: the new button text and link fields, empty.
//   03  the same tab after typing a button for the red band (NOT saved): the
//       list is down to three.
//
// WRITES, THEN REMOVES. The funnel is deleted through DELETE
// /api/admin/funnels/<id> and the quiz by id with the service role, in a
// finally block, so the shared dev clone is left as it was. Nothing is saved
// from the editor.
//
// LIGHT ONLY. The admin surface has no working dark mode.
//
// DEV CLONE ONLY. It refuses any other project ref outright.

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3087"
const OUT = "screenshots/g47-neutral-builtin-quiz"
const DSF = 2
const TRAILHEAD = "82d5b238-1653-4a04-9d2d-2f65e5a8c225"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_REF)) {
  console.error(`REFUSING TO RUN: .env.local does not point at the dev clone (${DEV_REF}).`)
  process.exit(1)
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

mkdirSync(OUT, { recursive: true })

function must(condition, message) {
  if (!condition) throw new Error(message)
}

/** A marker beside a real element. Warns loudly on every failure path. */
async function markerOn(locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx = box.x - 22
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

async function hideDevChrome(page) {
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important } nextjs-portal { display: none !important }",
  })
}

async function shot(page, slug, title, subtitle, markersFn) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: 1440, height: Math.min(height, 2400) })
  await page.waitForTimeout(500)
  await page.mouse.move(4, 4)
  await page.waitForTimeout(400)
  const markers = await markersFn()
  const raw = `${OUT}/.raw-${slug}.png`
  await page.screenshot({ path: raw })
  const { width, height: h } = await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers })
  console.log(`   wrote ${OUT}/${slug}.png (${width}x${h})`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DSF, colorScheme: "light" })
const page = await ctx.newPage()
let funnelId = null
let quizId = null

try {
  console.log("signing in")
  await page.goto(`${APP}/api/dev/login?callbackUrl=/api/auth/session`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  const session = await (await page.request.get(`${APP}/api/auth/session`)).json()
  must(session?.user?.role === "admin", `no admin session: ${JSON.stringify(session)}`)
  await ctx.addCookies([{ name: "djp_business", value: TRAILHEAD, domain: "localhost", path: "/", sameSite: "Lax" }])

  console.log("cloning the built-in quiz as Trailhead")
  const slug = `readiness-quiz-${Date.now().toString(36)}`
  const created = await page.request.post(`${APP}/api/admin/funnels`, {
    data: {
      name: "Readiness Quiz",
      slug,
      kind: "funnel",
      template: "quiz",
      steps: [{ name: "Quiz", slug: "index" }],
      quiz: { copyFrom: "builtin:rpi" },
    },
  })
  const createdBody = await created.json()
  must(created.status() === 201 || created.status() === 200, `create failed: ${created.status()} ${JSON.stringify(createdBody)}`)
  funnelId = createdBody.funnel?.id
  quizId = createdBody.quizId
  must(funnelId && quizId, `create returned no funnel or quiz id: ${JSON.stringify(createdBody)}`)

  // Whose quiz it is, read from the database rather than assumed: the tenant
  // cookie being ignored would file it under the platform's own business.
  const { data: quizRow, error } = await admin.from("quizzes").select("business_id, name").eq("id", quizId).single()
  must(!error, `reading the clone: ${error?.message}`)
  must(quizRow.business_id === TRAILHEAD, `the clone was filed under ${quizRow.business_id}, not Trailhead`)
  console.log(`   clone ${quizId} "${quizRow.name}" under Trailhead`)

  // ---- 01 ---------------------------------------------------------------------
  console.log("\n01 the warnings")
  await page.goto(`${APP}/admin/funnels/quizzes/${quizId}`, { waitUntil: "networkidle", timeout: 120_000 })
  await hideDevChrome(page)
  await page.waitForTimeout(2500)
  const noButton = page.locator("li", { hasText: "has no button" })
  must((await noButton.count()) === 4, `expected four "has no button" warnings, found ${await noButton.count()}`)
  must((await page.getByText("Book a call with", { exact: false }).count()) === 0, "the operator's button text is on screen")
  const worth = page.getByText("Worth a look:", { exact: true })
  await shot(
    page,
    "01-a-copied-quiz-says-its-bands-have-no-button",
    "A copied quiz now starts with no result buttons, and says so",
    "This is a coach's own copy of \"Athlete Quiz — the original\". The copy used to carry another coach's name, and its button sent people to that coach's own contact page. Now each result band starts with no button, and the quiz lists every band that needs one.",
    async () => [
      await markerOn(worth, '"Worth a look" lists things to check. It does not stop the quiz from going live.'),
      await markerOn(noButton.first(), 'One line for each result band. "red" is the band for scores from 0 to 39. Nobody who scores there has a next step until the coach adds a button.', { place: "right", dx: -70 }),
    ],
  )

  // ---- 02 ---------------------------------------------------------------------
  console.log("\n02 the Tiers tab")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: "Tiers" }).click()
  await page.waitForTimeout(600)
  const redText = page.getByLabel("red button text")
  const redLink = page.getByLabel("red button link")
  must((await redText.inputValue()) === "" && (await redLink.inputValue()) === "", "the red band's button fields are not empty")
  const hint = page.getByText("A band shows its button only when it has both text and a link", { exact: false })
  await shot(
    page,
    "02-each-band-has-button-text-and-a-link",
    "Each band has a place for its button",
    "Open \"Tiers\". Under each band's score range and headline there are two new boxes: the words on the button, and where it goes.",
    async () => [
      await markerOn(redText, '"red button text": the words on the button, for example "Book a call".'),
      await markerOn(redLink, '"red button link": where the button goes. One of your own pages, starting with /, or a full web address.', { place: "right" }),
      // Left of the line, in the same gutter as marker 1: to its right sits the floating Messages button.
      await markerOn(hint, "A band needs both boxes filled, or no button shows."),
    ],
  )

  // ---- 03 ---------------------------------------------------------------------
  console.log("\n03 one band filled in")
  await page.setViewportSize({ width: 1440, height: 900 })
  await redText.fill("Book a call")
  await redLink.fill("/go/book-a-call")
  await page.waitForTimeout(400)
  must((await noButton.count()) === 3, `expected three warnings after filling red, found ${await noButton.count()}`)
  must((await page.locator("li", { hasText: 'Band "red"' }).count()) === 0, "the red band's warning is still listed")
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(
    page,
    "03-filling-a-band-in-clears-its-line",
    "Fill a band in, and its line goes away",
    "Here the red band has been given a button. Its line has left the list straight away, and three bands are left. Nothing is saved until the coach clicks Save.",
    async () => [
      await markerOn(page.locator("li", { hasText: "has no button" }).first(), 'The list now starts at "orange". The red band is no longer in it.', { place: "right", dx: -70 }),
      await markerOn(redText, "The red band's button, typed in but not saved yet."),
    ],
  )

  console.log("\nall assertions passed")
} finally {
  if (funnelId) {
    const res = await page.request.delete(`${APP}/api/admin/funnels/${funnelId}`)
    console.log(`cleanup: DELETE funnel ${funnelId} -> ${res.status()}`)
  }
  if (quizId) {
    const { error } = await admin.from("quizzes").delete().eq("id", quizId).eq("business_id", TRAILHEAD)
    console.log(`cleanup: delete quiz ${quizId} -> ${error ? `FAILED ${error.message}` : "ok"}`)
  }
  await browser.close()
}
