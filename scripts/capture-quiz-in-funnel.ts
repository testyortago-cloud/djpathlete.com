// Drives the REAL app and proves the two halves of "the quiz inside its
// funnel", with the callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run build && PORT=3051 npm run dev     # in another terminal
//   APP=http://localhost:3051 npx tsx scripts/capture-quiz-in-funnel.ts .env.local
//
// WHAT IT PROVES, AND HOW IT PROVES IT
//
//   1. THE QUIZ IS REACHED FROM THE THING IT BELONGS TO. The sidebar no longer
//      carries a Quizzes item; the page that runs the quiz offers it, and the
//      funnel that runs one lists it. Every link is asserted by its href in
//      the DOM, then FOLLOWED -- a link that points at a 404 photographs
//      beautifully.
//
//   2. A COMPLETED QUIZ IS A LEAD ON THAT FUNNEL. The quiz is walked for real
//      at its real /go/<slug> address, to the end, and the row it leaves is
//      read back OUT OF THE DATABASE and checked field by field. Asserting a
//      row "came back" would pass for a row with the wrong funnel on it.
//
//   3. AND THE PREVIEW STILL WRITES NOTHING. The same quiz is completed on
//      /preview/<slug> and the table is counted before and after. This is the
//      promise no unit test can make, because the thing being promised is the
//      absence of a write.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE -- see CLONE_REF. What it
// writes, it writes by using the product: one quiz funnel (created through the
// real dialog), and one completed quiz. `--clean` removes both again.
//
// LIGHT ONLY FOR THE ADMIN SHOTS, AND THAT IS NOT AN OMISSION: `.dark` is a
// class variant the admin components were never built against. The public quiz
// page is captured exactly as a visitor gets it.
//
// TWO THINGS THAT COST TAKES BEFORE, WORTH REPEATING:
//  * assert the session before anything else -- a minted JWT the app refuses
//    presents downstream as "the feature is broken";
//  * `getByText` matches the DOM's own casing, never CSS `text-transform`.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3051"
const OUT = "screenshots/quiz-in-funnel"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1080
const DSF = 2

/** The seeded funnel this repo's dev copy carries. Published, real, running. */
const LIVE_SLUG = "athlete-quiz"

const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const FUNNEL_NAME = `Quiz In Funnel Check ${STAMP}`
const LEAD_EMAIL = `quiz-lead-check+${STAMP}@example.com`
const LEAD_NAME = `Quiz Lead ${STAMP}`

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

async function shoot(page: Page, name: string, title: string, subtitle: string, markers: Marker[]): Promise<void> {
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
  return { x: Math.round((box.x + (nudge.x ?? 0)) * DSF), y: Math.round((box.y + (nudge.y ?? 0)) * DSF), caption }
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
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/pages`, { waitUntil: "domcontentloaded" })
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

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/**
 * Walks a quiz from its intro to its result, answering every question.
 *
 * IT COUNTS THE QUESTIONS IT ANSWERED and refuses to submit if it answered
 * none: a walker that silently reached the gate without answering anything
 * would produce a submission whose transcript is empty, and the row would
 * still look like a pass.
 */
async function completeQuiz(page: Page, who: { name: string; email: string }): Promise<number> {
  await page.getByRole("button", { name: "Start" }).first().click()
  await page.waitForTimeout(800)

  let answered = 0
  for (let i = 0; i < 60; i += 1) {
    const option = page.locator("button.djp-quiz-option").first()
    if ((await option.count()) === 0) break
    await option.click()
    answered += 1
    // The next question replaces this one in the DOM; progress posts as it goes.
    await page.waitForTimeout(450)
  }
  must(answered > 0, "the quiz answered no questions -- the walk never started")

  const nameField = page.locator("#djp-quiz-name")
  await nameField.waitFor({ timeout: 15_000 })
  await nameField.fill(who.name)
  await page.locator("#djp-quiz-email").fill(who.email)
  console.log(`  answered ${answered} questions as ${who.email}`)
  return answered
}

async function submitQuiz(page: Page): Promise<void> {
  // THE ROUTE REFUSES A SUBMISSION UNDER 1500ms as a bot. The walk above takes
  // far longer than that, but a future shortcut here would fail as a silent
  // 200 with no row -- which reads exactly like the feature being broken.
  await page.getByRole("button", { name: /see my result/i }).first().click()
  await page.waitForTimeout(4000)
}

async function countRows(supabase: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true })
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return count ?? 0
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
    console.error(`REFUSING: ${ref} is not the dev clone. This run creates a funnel and completes a quiz.`)
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  console.log(`project : ${ref} (dev clone)`)
  console.log(`app     : ${APP}`)

  const { data: liveFunnel } = await supabase
    .from("funnels")
    .select("id, slug, name, status, kind")
    .eq("slug", LIVE_SLUG)
    .maybeSingle()
  must(!!liveFunnel, `there is no /go/${LIVE_SLUG} funnel on this database`)
  const live = liveFunnel as { id: string; name: string; status: string; kind: string }
  must(live.status === "published", `/go/${LIVE_SLUG} is ${live.status}, not published`)
  console.log(`live    : ${live.name} (${live.kind}) ${live.id}`)

  const { data: liveStep } = await supabase
    .from("funnel_steps")
    .select("id")
    .eq("funnel_id", live.id)
    .eq("is_entry", true)
    .maybeSingle()
  const liveStepId = String((liveStep as { id: string } | null)?.id ?? "")
  must(!!liveStepId, "the live funnel has no entry step")

  const browser = await launchChromium()
  let madeFunnelId = ""
  let madeQuizId = ""
  try {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // -----------------------------------------------------------------------
    // 1. The page that runs the quiz offers the quiz. And the sidebar does not.
    // -----------------------------------------------------------------------
    await page.goto(`${APP}/admin/pages`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200)

    // EXACT. Playwright's `name` is a case-insensitive SUBSTRING match, and
    // this page's own card is called "Athlete Quiz" -- the first run of this
    // script found the card title and reported the Quiz button as broken.
    const quizButton = page.getByRole("link", { name: "Quiz", exact: true }).first()
    must((await quizButton.count()) > 0, "no Quiz button on the landing pages board")
    const quizHref = String(await quizButton.getAttribute("href"))
    must(
      /^\/admin\/funnels\/quizzes\/[0-9a-f-]{36}$/.test(quizHref),
      `the Quiz button points at ${quizHref}, which is not a quiz editor`,
    )
    console.log(`  Quiz button -> ${quizHref}`)

    // THE SIDEBAR NO LONGER OFFERS IT. Asserted on the rendered nav, not on the
    // module: the claim is about what the owner can see.
    // A POSITIVE CONTROL FIRST. "No Quizzes item in the sidebar" is satisfied
    // just as well by a sidebar that rendered nothing at all, or by a
    // Marketing group that is collapsed -- and either would make this
    // assertion pass while proving nothing. Funnels sits directly beside where
    // Quizzes used to be, so if THAT is present the group is really rendered.
    const sidebarFunnels = page.locator('nav a[href="/admin/funnels"]')
    must((await sidebarFunnels.count()) > 0, "the sidebar has no Funnels item -- the nav did not render, so the check below is vacuous")
    const sidebarQuiz = page.locator('nav a[href="/admin/funnels/quizzes"]')
    must((await sidebarQuiz.count()) === 0, "the sidebar still carries a Quizzes item")
    console.log("  sidebar carries Funnels and NO Quizzes item")

    await shoot(
      page,
      "01-page-offers-its-quiz",
      "The quiz is reached from the page that runs it",
      "/admin/pages · light",
      [
        await markerAt(page, quizButton, 'The "Quiz" button opens the quiz this page runs. Before this, the only way in was a separate item in the left menu — the quiz looked like a thing of its own rather than part of this page.', { x: -20, y: 4 }),
        await markerAt(page, '[data-testid="card-title"]', "This is the page the quiz runs on. Its questions, scoring and results are edited behind that button.", { x: -20, y: 4 }),
      ],
    )

    // FOLLOW IT. A link that 404s photographs perfectly.
    await quizButton.click()
    await page.waitForURL(/\/admin\/funnels\/quizzes\/[0-9a-f-]{36}/, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    const editorHeading = page.locator("h1, h2").first()
    must((await editorHeading.count()) > 0, "the quiz editor rendered nothing")
    await shoot(
      page,
      "02-quiz-editor",
      "And the button lands on the real editor for that quiz",
      `${quizHref} · light`,
      [await markerAt(page, editorHeading, "The quiz itself: every question, answer and score. Changing one takes effect on the live page straight away — there is nothing to publish again.", { x: -20, y: 4 })],
    )

    // -----------------------------------------------------------------------
    // 2. A funnel that uses a quiz lists it on the funnel's own screen.
    //    Made through the real create dialog, because a hand-written row would
    //    prove nothing about the screen an owner actually gets.
    // -----------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)

    const allQuizzes = page.locator('a[href="/admin/funnels/quizzes"]').first()
    must((await allQuizzes.count()) > 0, "the funnels board has no way to the full list of quizzes")
    console.log("  funnels board links to All quizzes")

    await page.getByRole("button", { name: /new funnel/i }).first().click()
    await page.getByRole("radio", { name: /run a quiz/i }).click()
    await page.getByLabel(/^name/i).fill(FUNNEL_NAME)
    await page.getByLabel(/copy questions from/i).waitFor()
    await page.waitForTimeout(400)
    await page.getByRole("button", { name: /create funnel/i }).click()
    await page.waitForURL(/\/admin\/funnels\/quizzes\//, { timeout: 60_000 })
    madeQuizId = page.url().split("/quizzes/")[1].split(/[?#]/)[0]

    const { data: madeRow } = await supabase.from("funnels").select("id").eq("name", FUNNEL_NAME).maybeSingle()
    must(!!madeRow, "the funnel the dialog created was not found")
    madeFunnelId = String((madeRow as { id: string }).id)
    console.log(`  created funnel ${madeFunnelId} with quiz ${madeQuizId}`)

    await page.goto(`${APP}/admin/funnels/${madeFunnelId}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1000)
    const panelLink = page.locator(`a[href="/admin/funnels/quizzes/${madeQuizId}"]`).first()
    must((await panelLink.count()) > 0, "the funnel's own screen does not list the quiz it uses")
    await shoot(
      page,
      "03-funnel-lists-its-quiz",
      "A funnel that uses a quiz lists it on the funnel's own screen",
      `/admin/funnels/<id> · light`,
      [
        await markerAt(page, panelLink, "The quiz this funnel runs, named on the funnel's own screen. Click it to edit the questions.", { x: -20, y: 4 }),
        await markerAt(page, page.getByText(/Started|Completed/).first(), "How many people started it and how many finished. The gap between the two is where they are giving up.", { x: -20, y: 4 }),
      ],
    )

    // -----------------------------------------------------------------------
    // 3. Somebody completes the quiz, at its real address. It becomes a lead.
    // -----------------------------------------------------------------------
    const before = await countRows(supabase, "funnel_submissions")
    console.log(`  funnel_submissions before: ${before}`)

    const visitorCtx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
    const visitor = await visitorCtx.newPage()
    await visitor.goto(`${APP}/go/${LIVE_SLUG}`, { waitUntil: "networkidle" })
    await visitor.waitForTimeout(1000)
    await shoot(visitor, "04-the-real-quiz-page", "The quiz, at its real public address", `/go/${LIVE_SLUG} · public`, [
      await markerAt(visitor, "button.djp-btn-primary", "A visitor starts here. Everything after this is the real page — nothing below was set up by hand.", { x: -20, y: 4 }),
    ])

    await completeQuiz(visitor, { name: LEAD_NAME, email: LEAD_EMAIL })
    await shoot(visitor, "05-the-details-gate", "At the end it asks who they are", `/go/${LIVE_SLUG} · public`, [
      await markerAt(visitor, "#djp-quiz-name", "The name and email they give here are what turn a finished quiz into somebody you can call.", { x: -20, y: 4 }),
    ])
    await submitQuiz(visitor)

    const resultShown = await visitor.locator(".djp-quiz-result").count()
    must(resultShown > 0, "the quiz did not show a result -- the submission failed")
    await shoot(visitor, "06-their-result", "They get their result", `/go/${LIVE_SLUG} · public`, [
      await markerAt(visitor, ".djp-quiz-score", "Their score. This is worked out on the server from their answers — the browser is never told the weights, so a result cannot be faked.", { x: -20, y: 4 }),
    ])

    // THE ROW, FIELD BY FIELD. "A row came back" would pass for a lead filed
    // against the wrong funnel, with no answers on it.
    const { data: subRow } = await supabase
      .from("funnel_submissions")
      .select("id, funnel_id, step_id, form_key, kind, quiz_attempt_id, name, email, payload, lead_user_id")
      .eq("email", LEAD_EMAIL)
      .maybeSingle()
    must(!!subRow, "the completed quiz left NO funnel_submissions row")
    const sub = subRow as Record<string, unknown>
    must(sub.kind === "quiz", `the lead's kind is ${String(sub.kind)}, not quiz`)
    must(sub.funnel_id === live.id, `the lead is filed against ${String(sub.funnel_id)}, not ${live.id}`)
    must(sub.step_id === liveStepId, `the lead names step ${String(sub.step_id)}, not ${liveStepId}`)
    must(typeof sub.quiz_attempt_id === "string", "the lead does not point at the attempt it came from")
    must(sub.name === LEAD_NAME, `the lead's name is ${String(sub.name)}`)
    must(sub.lead_user_id === null, "the quiz minted a users row; it is supposed to feed the contact spine")
    const answers = sub.payload as Record<string, string>
    must(Object.keys(answers).length > 0, "the lead carries no answers at all")
    must(
      !Object.keys(answers).some((k) => /^score$/i.test(k)),
      "the lead's payload carries the score; payload is the visitor's answers",
    )
    console.log(`  lead ${String(sub.id)}: kind=quiz, ${Object.keys(answers).length} answers, attempt ${String(sub.quiz_attempt_id)}`)

    const { data: attemptRow } = await supabase
      .from("quiz_attempts")
      .select("id, score, tier_key, profile_key, status")
      .eq("id", String(sub.quiz_attempt_id))
      .maybeSingle()
    must(!!attemptRow, "the attempt the lead points at does not exist")
    const attempt = attemptRow as Record<string, unknown>
    must(attempt.status === "completed", `the attempt is ${String(attempt.status)}`)
    console.log(`  attempt: score=${String(attempt.score)} tier=${String(attempt.tier_key)}`)

    // -----------------------------------------------------------------------
    // 4. And it is in the inbox, marked as a quiz.
    // -----------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels/leads?funnelId=${live.id}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200)
    // Same trap as above: the funnel on these rows is called "Athlete Quiz".
    const badge = page.getByText("Quiz", { exact: true }).first()
    must((await badge.count()) > 0, "the leads inbox does not mark the completion as a quiz")
    await shoot(page, "07-leads-inbox", "It arrives in Leads, marked as a quiz", "/admin/funnels/leads · light", [
      await markerAt(page, badge, 'The "Quiz" tag. Form fills and quiz takers land in the same list, and this is how you tell them apart at a glance.', { x: -20, y: 4 }),
      await markerAt(page, page.getByText(LEAD_EMAIL).first(), "The person who just finished the quiz on the live page. Before this change they never appeared here at all.", { x: -20, y: 4 }),
    ])

    await page.getByRole("button", { name: new RegExp(`Show ${LEAD_NAME}`, "i") }).first().click()
    await page.waitForTimeout(900)
    const scored = page.getByText(/Scored/i).first()
    must((await scored.count()) > 0, "the expanded lead does not show the result")
    await shoot(page, "08-what-they-answered", "Open it and you see what they answered", "/admin/funnels/leads · light", [
      await markerAt(page, scored, "Their score and the group the quiz put them in. It is read from the quiz itself, so it can never disagree with what they were shown.", { x: -20, y: 4 }),
      // NOT the heading: it sits ~30px above the score line and the two discs
      // landed on top of each other. The first question is what the caption is
      // actually about anyway.
      await markerAt(page, page.locator("dt").first(), "Every question they were asked and the answer they picked — what you read before you ring them.", { x: -20, y: 4 }),
    ])

    // -----------------------------------------------------------------------
    // 5. THE PREVIEW STILL WRITES NOTHING. The promise no unit test can make.
    // -----------------------------------------------------------------------
    const subsBefore = await countRows(supabase, "funnel_submissions")
    const attemptsBefore = await countRows(supabase, "quiz_attempts")
    const previewPage = await ctx.newPage()
    await previewPage.goto(`${APP}/preview/${LIVE_SLUG}`, { waitUntil: "networkidle" })
    await previewPage.waitForTimeout(1000)
    await completeQuiz(previewPage, { name: "Preview Should Not Write", email: `preview-${STAMP}@example.com` })
    await submitQuiz(previewPage)
    const previewResult = await previewPage.locator(".djp-quiz-result").count()
    must(previewResult > 0, "the preview did not score at all -- so 'it wrote nothing' proves nothing")
    await shoot(previewPage, "09-preview-writes-nothing", "The same quiz in preview scores, and records nothing", `/preview/${LIVE_SLUG} · admin only`, [
      await markerAt(previewPage, ".djp-quiz-score", "A test run gives a real score, so you can check the questions before it goes live.", { x: -20, y: 4 }),
    ])

    const subsAfter = await countRows(supabase, "funnel_submissions")
    const attemptsAfter = await countRows(supabase, "quiz_attempts")
    must(subsAfter === subsBefore, `the preview wrote ${subsAfter - subsBefore} submission(s)`)
    must(attemptsAfter === attemptsBefore, `the preview wrote ${attemptsAfter - attemptsBefore} attempt(s)`)
    console.log(`  preview wrote nothing: submissions ${subsBefore}->${subsAfter}, attempts ${attemptsBefore}->${attemptsAfter}`)

    writeFileSync(
      `${OUT}/run.json`,
      JSON.stringify(
        {
          app: APP,
          project: ref,
          liveFunnel: { id: live.id, slug: LIVE_SLUG, stepId: liveStepId },
          madeFunnelId,
          madeQuizId,
          lead: { id: sub.id, email: LEAD_EMAIL, kind: sub.kind, answers: Object.keys(answers).length },
          attempt: { id: sub.quiz_attempt_id, score: attempt.score, tier: attempt.tier_key },
          previewWroteNothing: { subsBefore, subsAfter, attemptsBefore, attemptsAfter },
        },
        null,
        2,
      ),
    )
    console.log(`\nEVERY CLAIM ABOVE WAS ASSERTED AGAINST THE RUNNING APP.  ${OUT}/`)
  } finally {
    if (args.includes("--clean")) {
      // The funnel this run made, the quiz it cloned, and the lead it left.
      if (madeFunnelId) await supabase.from("funnels").delete().eq("id", madeFunnelId)
      if (madeQuizId) await supabase.from("quizzes").delete().eq("id", madeQuizId)
      await supabase.from("funnel_submissions").delete().eq("email", LEAD_EMAIL)
      console.log("  cleaned up the funnel, the quiz and the lead this run made")
    }
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
