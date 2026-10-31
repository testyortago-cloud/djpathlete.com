// Real-app capture: a client's own website quiz result on Performance > Tests, and in AI Generate.
//
// Writes NOTHING: it only opens pages and the AI Generate dialog (never presses Generate). DEV CLONE ONLY.
// Needs the dev demo client's RPI attempt (taken through /api/quiz/progress + /api/quiz/submit on 2026-10-31).
//
// Run (dev server on 3051): node scripts/capture-client-self-assessment.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { encode } from "next-auth/jwt"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/client-self-assessment"
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const JORDAN = "1d2f4990-57ab-4aaa-b1df-4e60f3f69054" // took the RPI quiz
const FELIX = "5e7bdb51-594d-42b9-b821-4ee15dcde501" // never took a quiz
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
const hideDevChrome = (page) =>
  page
    .addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
    .catch((e) => console.warn(`WARN hideDevChrome failed, dev overlay may show: ${e.message.split("\n")[0]}`))

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  // The session /api/dev/login would mint, minted here so this also runs against `next start`, where that
  // route is off. Same admin (DEV_AUTH_BYPASS_EMAIL), same claims, same cookie.
  const { data: admin } = await db
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", env.DEV_AUTH_BYPASS_EMAIL)
    .single()
  if (admin?.role !== "admin")
    throw Error(`DEV_AUTH_BYPASS_EMAIL is not an admin on the clone: ${env.DEV_AUTH_BYPASS_EMAIL}`)
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: {
      id: admin.id,
      sub: admin.id,
      email: admin.email,
      name: `${admin.first_name} ${admin.last_name}`,
      role: admin.role,
    },
    maxAge: 60 * 60,
  })
  // The clone's default business is an empty seed; the real data is on Primary.
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" },
    { name: "djp_business", value: PRIMARY, url: APP },
  ])
  await page.goto(`${APP}/admin/clients`, { waitUntil: "load", timeout: 120000 })
  check("signed in to the admin", new URL(page.url()).pathname === "/admin/clients", page.url())

  // 1. The card on the client who took the quiz.
  await page.goto(`${APP}/admin/clients/${JORDAN}/performance?tab=tests`, { waitUntil: "load", timeout: 120000 })
  await hideDevChrome(page)
  const card = page.locator("[data-slot=data-table-card]", { hasText: "Self-assessment" })
  await card.waitFor({ timeout: 90000 })
  check("the card names the quiz", await card.getByText(/Rotational Performance Index · taken/).isVisible())
  check("score and tier come from the stored attempt", await card.getByText("Score 73/100").isVisible())
  const gapRow = card.locator("tr", { hasText: "Short lever Copenhagen" })
  check("the Copenhagen row shows both sides", await gapRow.getByText("L 3/3 · R 1/3").isVisible())
  check("and flags the side difference", await gapRow.getByText("Big side difference").isVisible())
  await card.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -96))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-card.png` })
  await annotate(`${OUT}/raw/01-card.png`, `${OUT}/01-self-assessment-card.png`, {
    title: "The client's own quiz result, on their Performance page",
    subtitle: "Clients > Jordan Reyes > Performance > Tests (dev clone; quiz taken through the real quiz routes)",
    markers: [
      await marker(card.getByText("Self-assessment", { exact: true }), "Which quiz, and when they took it.", "before"),
      await marker(
        card.getByText("Score 73/100"),
        "Their score, colour band and profile, as the quiz gave them.",
        "above",
      ),
      await marker(
        gapRow.getByText("Big side difference"),
        "Each area: left and right side, and what stands out.",
        "after",
      ),
      await marker(
        card.getByText(/^When you rotate/),
        "Every other answer they gave, including the scored ones.",
        "before",
      ),
      await marker(
        card.getByText(/The client filled this in themselves/),
        "AI Generate uses this for their next program.",
        "before",
      ),
    ],
  })

  // 2. AI Generate names it.
  // This page renders slowly on the dev clone (2 min on a cold start), so it gets a longer wait.
  await page.goto(`${APP}/admin/programs`, { waitUntil: "domcontentloaded", timeout: 300000 })
  await hideDevChrome(page)
  const open = page.getByRole("button", { name: "AI Generate" }).first()
  await open.waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500) // hydration: an early click does nothing
  await open.click()
  const select = page.locator("#ai-client")
  await select.waitFor({ timeout: 30000 })
  await page.waitForFunction((id) => !!document.querySelector(`#ai-client option[value="${id}"]`), JORDAN, {
    timeout: 30000,
  })
  await select.selectOption(JORDAN)
  const note = page.getByText(/Uses their “Rotational Performance Index” self-assessment/)
  await note.waitFor({ timeout: 30000 })
  check("the dialog names the self-assessment it will use", await note.isVisible())
  await note.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/02-ai-generate.png` })
  const follows = page.getByText(/^Follows on from/)
  const markers = [
    await marker(note, "New: the AI uses the client's own quiz result, with the date they took it.", "before"),
  ]
  if (await follows.isVisible().catch(() => false))
    markers.unshift(await marker(follows, "Already there: the program it follows on from.", "before"))
  await annotate(`${OUT}/raw/02-ai-generate.png`, `${OUT}/02-ai-generate-note.png`, {
    title: "AI Generate says it will use the self-assessment",
    subtitle: "Programs > AI Generate > step 1, client Jordan Reyes",
    markers,
  })

  // 3. A client who never took a quiz.
  await page.goto(`${APP}/admin/clients/${FELIX}/performance?tab=tests`, { waitUntil: "load", timeout: 120000 })
  await hideDevChrome(page)
  const empty = page.getByText(/none yet\. When this client fills in/)
  await empty.waitFor({ timeout: 90000 })
  check("a client with no quiz gets the 'none yet' line, not an error", await empty.isVisible())
  await empty.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/03-none-yet.png` })
  await annotate(`${OUT}/raw/03-none-yet.png`, `${OUT}/03-none-yet.png`, {
    title: "No quiz yet: the page says how to get one",
    subtitle: "Clients > Felix Boateng > Performance > Tests",
    markers: [
      await marker(empty, "Shown until the client takes a website quiz with the email on their account.", "above"),
    ],
  })

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, results }, null, 2))
  await browser.close()
}
