// Drives the REAL app and proves the quiz lives in the funnel that runs it —
// with no quizzes screen anywhere — and that a funnel without one shows nothing.
//
//   npm run build && npm run dev          # in another terminal (port 3050)
//   APP=http://localhost:3050 npx tsx scripts/capture-quiz-on-the-funnel-card.ts .env.local
//
// WHAT IT PROVES
//
//   1. THE QUIZ IS ON ITS FUNNEL'S CARD. A funnel running a quiz carries a
//      Quiz control that opens the questions. Asserted by href and then
//      FOLLOWED — a link pointing at a 404 photographs beautifully.
//
//   2. A FUNNEL WITHOUT ONE SAYS NOTHING. The same board, same shot, carries a
//      second funnel that runs no quiz, and its card is scanned for the WORD.
//      This is the white-label requirement as an assertion: a customer whose
//      work has no quizzes must never meet the term. An absence assertion needs
//      a presence control, and card 1 in the same frame is it.
//
//   3. THERE IS NO QUIZZES SCREEN. The board carries no link to a list, and the
//      retired URL redirects to the board rather than 404ing a bookmark.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE — see CLONE_REF. The one
// quiz funnel it creates (through the real New funnel dialog, because a
// hand-written row proves nothing about the screen an owner gets) is removed
// again whether or not the run succeeded.
//
// LIGHT ONLY, AND THAT IS NOT AN OMISSION: `.dark` is a class variant the admin
// components were never built against, and forcing it breaks existing pages.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/quiz-on-the-funnel-card"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1180
const DSF = 2

const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const FUNNEL_NAME = `Gap Map ${STAMP}`

/** The dev copy's existing multi-step funnel. It runs no quiz — the control. */
const PLAIN_FUNNEL = "Test"

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
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
 * the artefact still ships looking finished.
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
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
  // ASSERT THE SESSION BEFORE ANYTHING ELSE. A minted JWT the app refuses
  // presents downstream as "the feature is broken".
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  if ((await page.locator("text=/Unauthorized|Forbidden/i").count()) > 0) {
    throw new Error("landed on /admin but the page reports no session")
  }
  await page.close()
  console.log("  signed in as admin, session asserted")
}

function cardFor(page: Page, name: string): Locator {
  return page.locator('[data-testid="funnel-card"]').filter({ hasText: name }).first()
}

async function main(): Promise<void> {
  const envPath = process.argv[2] ?? ".env.local"
  const env = loadEnv(envPath)
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(url.includes(CLONE_REF), `REFUSING TO RUN: ${envPath} is not the dev clone (${url}).`)
  const supabase: SupabaseClient = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  })

  const browser = await launchChromium()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
  let madeFunnelId: string | null = null
  let madeQuizId: string | null = null

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // ------------------------------------------------------------------
    // A funnel that runs a quiz, made through the real dialog.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
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

    // ------------------------------------------------------------------
    // 1. The board: the quiz on its funnel, and silence on the other.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await page.waitForTimeout(4000)

    // NO LIST, AND NO LINK TO ONE.
    must(
      (await page.locator('a[href="/admin/funnels/quizzes"]').count()) === 0,
      "the funnels board still links to a quizzes list",
    )

    const withQuiz = cardFor(page, FUNNEL_NAME)
    const withoutQuiz = cardFor(page, PLAIN_FUNNEL)
    must((await withQuiz.count()) > 0, `no card for "${FUNNEL_NAME}"`)
    must(
      (await withoutQuiz.count()) > 0,
      `no card for "${PLAIN_FUNNEL}" — the control this shot needs. An absence assertion with no presence control proves nothing.`,
    )

    // BY HREF, NEVER BY NAME. The quiz template names the quiz after its funnel,
    // so several controls on this card share an accessible name and Playwright's
    // `name` is a substring match.
    const quizButton = withQuiz.locator(`a[href="/admin/funnels/quizzes/${madeQuizId}"]`).first()
    must((await quizButton.count()) > 0, "the funnel running a quiz offers no way to reach it")

    // THE WHITE-LABEL ASSERTION. Not "no button" — no WORD, anywhere on the
    // card of a funnel that runs no quiz.
    const plainText = (await withoutQuiz.textContent()) ?? ""
    must(!/quiz/i.test(plainText), `a funnel with no quiz shows the word anyway: ${plainText.slice(0, 200)}`)
    console.log("  quiz on its own funnel's card; the other card never says the word")

    await shoot(
      page,
      "01-the-quiz-lives-in-its-funnel",
      "The quiz lives in the funnel that runs it",
      "/admin/funnels · light",
      [
        await markerAt(
          page,
          quizButton,
          "The quiz sits on the funnel that runs it. Click it to change the questions.",
          { x: 84, y: 16 },
        ),
        await markerAt(
          page,
          withoutQuiz.locator('[data-testid="card-title"]'),
          "This funnel runs no quiz, so its card never mentions one. Nothing to switch off, nothing to explain.",
          { x: -18, y: 4 },
        ),
        await markerAt(
          page,
          page.getByRole("heading", { name: "Funnels" }).first(),
          "There is no separate Quizzes page any more, and no link to one.",
          { x: -18, y: 6 },
        ),
      ],
    )

    // ------------------------------------------------------------------
    // 2. The button was followed, not just read.
    // ------------------------------------------------------------------
    await quizButton.click()
    await page.waitForURL(/\/admin\/funnels\/quizzes\/[0-9a-f-]+$/, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    must((await page.locator("text=/404|not found/i").count()) === 0, "the Quiz button landed on a 404")
    await shoot(
      page,
      "02-and-opens-the-questions",
      "And it opens the questions",
      "/admin/funnels/quizzes/<id> · light",
      [
        await markerAt(
          page,
          page.locator("h1").first(),
          "The questions people answer, and what each answer is worth. This is the only screen a quiz has of its own.",
          { x: -10, y: 42 },
        ),
      ],
    )

    // ------------------------------------------------------------------
    // 3. The retired URL forwards rather than 404s.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels/quizzes`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1500)
    must(
      page.url().endsWith("/admin/funnels"),
      `the retired quizzes URL landed on ${page.url()} instead of the funnels board`,
    )
    console.log("  /admin/funnels/quizzes forwards to the board")

    console.log("\nAll assertions passed.")
  } finally {
    if (madeFunnelId) await supabase.from("funnels").delete().eq("id", madeFunnelId)
    if (madeQuizId) await supabase.from("quizzes").delete().eq("id", madeQuizId)
    console.log("  cleaned up")
    await ctx.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})
