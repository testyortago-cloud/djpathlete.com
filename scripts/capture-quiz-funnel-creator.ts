// Drives the REAL app and captures the quiz-funnel-creator screens, with the
// callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev              # in another terminal, port 3050
//   npx tsx scripts/capture-quiz-funnel-creator.ts .env.local
//
// EVERY SCREEN IS REACHED BY DRIVING THE PRODUCT. Nothing here seeds a quiz,
// hand-writes a page, or mounts a component in a harness. The funnel is made
// through the create dialog, the quiz is the clone that creation produced, the
// attempt behind the retirement is a real walk of the published page at its
// real /go/<slug> URL, and the refusal is the server's own.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE. It refuses any other
// project ref outright — see CLONE_REF. What it writes, it writes by using the
// product: one funnel, one quiz, one quiz attempt. `--clean` removes them again.
//
// LIGHT ONLY FOR THE ADMIN SHOTS, AND THAT IS NOT AN OMISSION. `.dark` is a
// class variant the admin components were never built against; there is no
// theme toggle and no second rendering of these screens to photograph. The
// public quiz page is captured as the visitor gets it.
//
// TWO THINGS THAT COST TAKES BEFORE, WORTH REPEATING:
//  * assert the session before anything else — a minted JWT the app refuses
//    presents downstream as "the feature is broken";
//  * `getByText` matches the DOM's own casing, never CSS `text-transform`.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/quiz-funnel-creator"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1080
const DSF = 2

/** Unique per run, so a re-run never collides on the funnel slug. */
const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const FUNNEL_NAME = `Rotational Reboot Check ${STAMP}`

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

async function hideDevChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

async function shoot(
  page: Page,
  name: string,
  title: string,
  subtitle: string,
  markers: Marker[],
): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await hideDevChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  rmSync(raw, { force: true })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

/**
 * A marker on a real element, in image pixels.
 *
 * IT THROWS RATHER THAN DEGRADING. A helper that quietly returns a marker at
 * 0,0 when its selector misses turns a broken callout into a silent no-op, and
 * the artefact still ships.
 */
async function markerAt(
  page: Page,
  selector: string | Locator,
  caption: string,
  nudge: { x?: number; y?: number } = {},
): Promise<Marker> {
  const el = typeof selector === "string" ? page.locator(selector).first() : selector.first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE (zero box): ${selector}`)
  const view = page.viewportSize()
  if (view && (box.y > view.height || box.y + box.height < 0)) {
    throw new Error(`MARKER TARGET OFF SCREEN: ${selector} at y=${Math.round(box.y)}`)
  }
  return {
    x: Math.round((box.x + (nudge.x ?? 0)) * DSF),
    y: Math.round((box.y + (nudge.y ?? 0)) * DSF),
    caption,
  }
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error("No usable Chromium. Run: npx playwright install chromium chromium-headless-shell")
  }
}

async function signInAsAdmin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
  // ASSERT THE SESSION BEFORE ANYTHING ELSE.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  if ((await page.locator("text=/Unauthorized|Forbidden/i").count()) > 0) {
    throw new Error("landed on /admin but the page reports no session")
  }
  await page.close()
  console.log("  signed in as admin, session asserted")
}

async function main() {
  const args = process.argv.slice(2)
  const envPath = args.filter((a) => !a.startsWith("--"))[0] ?? ".env.local"
  const env = loadEnv(envPath)
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error(`${envPath} is missing Supabase credentials`)
  const ref = new URL(url).host.split(".")[0]
  if (ref !== CLONE_REF) {
    console.error(`REFUSING: ${ref} is not the dev clone. This run creates a funnel and publishes a page.`)
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  console.log(`project : ${ref} (dev clone)`)
  console.log(`funnel  : ${FUNNEL_NAME}`)

  const browser = await launchChromium()
  let funnelId = ""
  let quizId = ""
  let slug = ""
  try {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // -----------------------------------------------------------------------
    // 1. The create dialog, on the quiz template.
    // -----------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /new funnel/i }).first().click()
    await page.getByRole("radio", { name: /run a quiz/i }).click()
    await page.getByLabel(/^name/i).fill(FUNNEL_NAME)
    await page.getByLabel(/copy questions from/i).waitFor()
    await page.waitForTimeout(400)
    await shoot(page, "01-create-dialog", "Making a quiz funnel is picking a template", "/admin/funnels · New funnel · light", [
      await markerAt(page, page.getByRole("radio", { name: /run a quiz/i }), '"Run a quiz" sits alongside the other kinds of funnel. Before this, a quiz could only be put on a page by calling an endpoint by hand.', { x: 6, y: 6 }),
      await markerAt(page, "#funnel-quiz", '"Copy questions from" is the only extra thing it asks. Your new quiz starts as a copy of this one, and you can change every question afterwards.', { x: 6, y: 6 }),
      await markerAt(page, '[data-testid="step-row"]', "One step, not three. The questions, the details form and the result are all parts of this single page.", { x: 6, y: 6 }),
    ])

    await page.getByRole("button", { name: /create funnel/i }).click()
    await page.waitForURL(/\/admin\/funnels\/quizzes\//, { timeout: 30_000 })
    quizId = page.url().split("/quizzes/")[1].split(/[?#]/)[0]
    console.log(`  created quiz ${quizId}`)

    const { data: funnelRow } = await supabase
      .from("funnels")
      .select("id, slug")
      .eq("name", FUNNEL_NAME)
      .maybeSingle()
    if (!funnelRow) throw new Error("the funnel the dialog created was not found")
    funnelId = String((funnelRow as { id: string }).id)
    slug = String((funnelRow as { slug: string }).slug)
    console.log(`  created funnel ${funnelId} at /go/${slug}`)

    // -----------------------------------------------------------------------
    // 2. Where it lands: the questions, already there, already yours.
    // -----------------------------------------------------------------------
    await page.getByRole("button", { name: "Questions" }).click()
    await page.waitForTimeout(400)
    await shoot(page, "02-cloned-questions", "It lands on the questions, and they are already there", `/admin/funnels/quizzes/… · light`, [
      await markerAt(page, 'nav[aria-label="Question groups"]', "A tab per group. “Everyone” holds the first question, which decides which set of questions the rest of the quiz comes from.", { x: 6, y: 6 }),
      await markerAt(page, '[data-testid="live-questions"] input', "Every question came across from the copy — the first question, the four groups and all their answers. Rewrite them into your own words.", { x: 6, y: 6 }),
      await markerAt(page, page.getByLabel(/routes to/i).first(), "The answers still point at this quiz's own groups, not at the one it was copied from.", { x: 6, y: 6 }),
    ])

    // -----------------------------------------------------------------------
    // 3. A question added: switched off until you say so.
    // -----------------------------------------------------------------------
    await page.getByRole("button", { name: /add a question/i }).scrollIntoViewIfNeeded()
    await page.getByRole("button", { name: /add a question/i }).click()
    await page.waitForTimeout(400)
    // Put the NEW card and the button that made it in one frame. Marking an
    // element that is off screen is refused above rather than clamped, so the
    // framing has to be deliberate.
    await page.getByRole("button", { name: /add a question/i }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await shoot(page, "03-question-added", "A new question starts switched off", "/admin/funnels/quizzes/… · light", [
      await markerAt(page, 'text=/not live yet/i', "Nobody taking the quiz sees it yet. That way a half-written question can never reach somebody part-way through.", { x: 6, y: 6 }),
      await markerAt(page, page.getByRole("button", { name: /turn this question on/i }).last(), "Write the question and its two answers, then choose “Turn it on” to start showing it to people.", { x: 6, y: 6 }),
      await markerAt(page, page.getByRole("button", { name: /add a question/i }), "Adding and removing questions is new. Until now the editor could only change the wording of the ones that were already there.", { x: 6, y: 6 }),
    ])

    await page.getByRole("button", { name: "Save" }).click()
    // ANY outcome, and then say which. Waiting only for "Saved." turns a
    // refusal into a 20-second timeout that names the wrong thing — the first
    // time this ran, the real message was "Invalid save." and the stack trace
    // pointed at the wait rather than at the payload.
    const outcome = page.locator("text=/Saved|Could not save|Invalid save|cannot be removed|taken offline/i")
    await outcome.first().waitFor({ timeout: 30_000 })
    console.log(`  save says: ${(await outcome.first().innerText()).slice(0, 90)}`)

    // -----------------------------------------------------------------------
    // 4. Publish it, and take the quiz for real, at the real URL.
    // -----------------------------------------------------------------------
    await page.getByRole("button", { name: /activate/i }).first().click()
    await page.waitForTimeout(2000)

    // PUBLISH FROM THE BUILDER. "Publish" means two things in this product:
    // the builder's Publish compiles the page AND takes the whole funnel live,
    // while the board's "Go live" only flips the status. A funnel taken live
    // with no compiled page serves a 404 — which is exactly what the first run
    // of this script photographed.
    const { data: stepRow } = await supabase
      .from("funnel_steps")
      .select("id")
      .eq("funnel_id", funnelId)
      .eq("is_entry", true)
      .maybeSingle()
    const entryStepId = String((stepRow as { id: string } | null)?.id ?? "")
    if (!entryStepId) throw new Error("the funnel has no entry step")

    await page.goto(`${APP}/admin/funnels/${funnelId}/edit/${entryStepId}`, { waitUntil: "networkidle" })
    // WAIT FOR THE BUTTON TO BE ENABLED, not for a number of milliseconds.
    // `canPublish` is computed after hydration; clicking a disabled button is a
    // no-op Playwright reports as a successful click.
    const publishBtn = page.getByRole("button", { name: /publish (funnel|landing page)/i }).first()
    await publishBtn.waitFor({ timeout: 60_000 })
    // AND THEN WAIT FOR HYDRATION. The button renders enabled before React has
    // attached its handler, so an early click is a real click on a real button
    // that does nothing — and Playwright reports it as a success. Three runs of
    // this script ended with "the funnel did not go live" for that reason.
    await page.waitForTimeout(5000)
    for (let i = 0; i < 60 && (await publishBtn.isDisabled()); i += 1) await page.waitForTimeout(1000)
    if (await publishBtn.isDisabled()) throw new Error("Publish stayed disabled — something is blocking this page")

    // On a page with nothing to report it commits in ONE click; the review only
    // opens when there is something worth saying. So the second click is
    // conditional rather than assumed.
    await publishBtn.click()
    await page.waitForTimeout(6000)
    const publishNow = page.getByRole("button", { name: /publish now/i })
    if ((await publishNow.count()) > 0) await publishNow.first().click()

    // POLL THE DATABASE, do not sleep and hope. Publishing compiles every page
    // in the funnel, and how long that takes is not a constant.
    let status = ""
    for (let i = 0; i < 45; i += 1) {
      const { data: liveRow } = await supabase.from("funnels").select("status").eq("id", funnelId).maybeSingle()
      status = String((liveRow as { status: string } | null)?.status ?? "")
      if (status === "live" || status === "published") break
      await page.waitForTimeout(2000)
    }
    if (status !== "live" && status !== "published") {
      // SAY WHY, rather than only that. Three runs ended here and the message
      // named the symptom every time; the reason was always on the screen.
      mkdirSync(OUT, { recursive: true })
      await page.screenshot({ path: `${OUT}/.debug-publish.png` })
      const text = (await page.locator("body").innerText()).replace(/\n+/g, " · ")
      console.error(`  page says: ${text.slice(0, 1200)}`)
      throw new Error(`the funnel did not go live (status=${status}). A 404 shot is worse than no shot.`)
    }
    console.log(`  funnel is ${status}`)

    const visitor = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
    const pub = await visitor.newPage()
    await pub.goto(`${APP}/go/${slug}`, { waitUntil: "networkidle" })
    await pub.waitForTimeout(800)
    await shoot(pub, "04-public-page", "The funnel, at its real address, running the copied quiz", `/go/${slug} · public`, [
      await markerAt(pub, "h1", "The page creation wrote: a heading, the quiz, a footer. Nothing was drafted by hand.", { x: 6, y: 6 }),
      await markerAt(pub, "button, a[href^='#']", "The quiz below is the copy this funnel made. Editing a question changes this page immediately — there is nothing to re-publish.", { x: 6, y: 6 }),
    ])

    // Answer the first question — a REAL attempt, which is what makes the
    // retirement in shot 6 real rather than staged.
    const firstAnswer = pub.locator("button").filter({ hasText: /athlete|coming back|young|parent|coach/i }).first()
    if ((await firstAnswer.count()) > 0) {
      await firstAnswer.click()
      await pub.waitForTimeout(1200)
      await shoot(pub, "05-quiz-walk", "Somebody takes it, and their answers are saved as they go", `/go/${slug} · public`, [
        await markerAt(pub, "button", "Answering the first question decides which set of questions comes next.", { x: 6, y: 6 }),
      ])
    }
    await visitor.close()

    // -----------------------------------------------------------------------
    // 5 & 6. Back in the editor: the refusal, then the retirement.
    // -----------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels/quizzes/${quizId}`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Questions" }).click()
    await page.waitForTimeout(400)

    await page.getByRole("button", { name: /remove this answer/i }).first().click()
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(2500)
    await shoot(page, "06-answered-option-refused", "An answer somebody has already picked cannot just vanish", "/admin/funnels/quizzes/… · light", [
      await markerAt(page, 'text=/already picked/i', "Their result was worked out from this answer. Removing it would leave the report unable to say what they chose.", { x: 6, y: 6 }),
    ])

    await page.reload({ waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Questions" }).click()
    await page.waitForTimeout(400)
    await page.getByRole("button", { name: /remove this question/i }).first().click()
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(2500)
    await shoot(page, "07-retired", "Remove the whole question and it is retired instead", "/admin/funnels/quizzes/… · light", [
      await markerAt(page, 'text=/retired rather than removed|taken offline/i', "Nobody taking the quiz is shown it any more, and the results people already got are kept exactly as they were.", { x: 6, y: 6 }),
    ])

    await page.waitForTimeout(300)
    const retired = page.locator('[data-testid="retired-questions"]')
    if ((await retired.count()) > 0) {
      await retired.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      await shoot(page, "08-retired-group", "Retired questions keep their wording, and can come back", "/admin/funnels/quizzes/… · light", [
        await markerAt(page, '[data-testid="retired-questions"] h2', "Kept out of the way rather than deleted, so your reports can still say what was asked.", { x: 6, y: 6 }),
        await markerAt(page, page.getByRole("button", { name: /bring this question back/i }).first(), "One button puts it back in front of people.", { x: 6, y: 6 }),
      ])
    }

    writeFileSync(
      `${OUT}/run.json`,
      JSON.stringify({ funnelId, quizId, slug, funnelName: FUNNEL_NAME, app: APP }, null, 2),
    )
    console.log("\nwrote", OUT)
  } finally {
    await browser.close()
    if (args.includes("--clean") && funnelId) {
      // Only ever the rows this run created, and only on the clone.
      await supabaseCleanup(supabase, funnelId, quizId)
    }
  }
}

async function supabaseCleanup(
  supabase: ReturnType<typeof createClient>,
  funnelId: string,
  quizId: string,
): Promise<void> {
  if (quizId) await supabase.from("quizzes").delete().eq("id", quizId)
  if (funnelId) await supabase.from("funnels").delete().eq("id", funnelId)
  console.log("  cleaned up the funnel and quiz this run created")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
