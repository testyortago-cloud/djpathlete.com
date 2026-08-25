// Drives the REAL app and proves the quizzes screen now renders the same
// preview card the funnels board renders, with the callouts burned into each
// PNG by scripts/_annotate-lib.mjs.
//
//   npm run build && PORT=3051 npm run dev     # in another terminal
//   APP=http://localhost:3051 npx tsx scripts/capture-quizzes-as-cards.ts .env.local
//
// WHAT IT PROVES
//
//   1. THE SCREEN IS CARDS, NOT A TABLE. Asserted in the DOM (`<table>` count
//      is zero, a card is present) before anything is photographed, because a
//      table with rounded corners photographs like a card at thumbnail size.
//
//   2. THE PREVIEW IS THE PAGE THAT RUNS THE QUIZ. A quiz has no page of its
//      own, so the card frames the funnel page its block sits on. The iframe's
//      `src` is read out of the DOM and checked against the rule the funnels
//      board follows — live route once published, draft route until then.
//
//   3. BOTH STATES ARE REAL. The dev copy carries one ACTIVE quiz on a
//      PUBLISHED page; the second card is a DRAFT quiz on an unpublished page,
//      created through the real New funnel dialog rather than written into the
//      database, because a hand-made row proves nothing about the screen an
//      owner gets.
//
//   4. THE BUTTONS GO SOMEWHERE. Each is asserted by href and then FOLLOWED --
//      a link pointing at a 404 photographs beautifully.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE -- see CLONE_REF. What it
// creates (one quiz funnel and its quiz) it removes again at the end, whether
// or not the run succeeded.
//
// LIGHT ONLY, AND THAT IS NOT AN OMISSION: `.dark` is a class variant the admin
// components were never built against, and forcing it breaks existing pages.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3051"
const OUT = "screenshots/quizzes-as-cards"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1180
const DSF = 2

const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const FUNNEL_NAME = `Quiz Card Check ${STAMP}`

/** The seeded quiz this repo's dev copy carries: active, on a published page. */
const SEEDED_QUIZ = "Athlete Quiz (RPI)"

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
    // Playwright's own build goes missing on this machine often enough to be
    // worth the fallback; a headless shell renders these pages identically.
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
  // presents downstream as "the feature is broken", which is the scariest
  // possible false alarm on a screen whose whole job is to render.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  if ((await page.locator("text=/Unauthorized|Forbidden/i").count()) > 0) {
    throw new Error("landed on /admin but the page reports no session")
  }
  await page.close()
  console.log("  signed in as admin, session asserted")
}

/** The card whose title is `name`. */
function cardFor(page: Page, name: string): Locator {
  return page.locator('[data-testid="quiz-card"]').filter({ hasText: name }).first()
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
    // A second quiz, in the OTHER state: draft, on a page nobody published.
    // Made through the real dialog for the reason above.
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
    // 1. The screen.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels/quizzes`, { waitUntil: "networkidle" })
    // Give the two same-origin preview iframes time to paint. A thumbnail that
    // is still white is the single most misleading thing this shot could show.
    await page.waitForTimeout(4000)

    must((await page.locator("table").count()) === 0, "the quizzes screen still renders a <table>")
    const cards = page.locator('[data-testid="quiz-card"]')
    must((await cards.count()) >= 2, `expected at least 2 quiz cards, found ${await cards.count()}`)
    console.log(`  ${await cards.count()} cards, no table`)

    const seeded = cardFor(page, SEEDED_QUIZ)
    const made = cardFor(page, FUNNEL_NAME)
    must((await seeded.count()) > 0, `no card for the seeded quiz "${SEEDED_QUIZ}"`)
    must((await made.count()) > 0, `no card for the quiz just created`)

    // THE URL RULE, READ OUT OF THE DOM. The seeded quiz sits on a published
    // page and must frame the live route; the new one sits on an unpublished
    // page and must frame the draft route.
    const seededSrc = await seeded.locator("iframe").first().getAttribute("src")
    const madeSrc = await made.locator("iframe").first().getAttribute("src")
    must(seededSrc === "/go/athlete-quiz?preview=1", `seeded card frames ${seededSrc}, expected the live route`)
    must(!!madeSrc && madeSrc.startsWith("/preview/"), `new card frames ${madeSrc}, expected the draft route`)
    console.log(`  previews: seeded=${seededSrc}  new=${madeSrc}`)

    // The badges say what each QUIZ is, not what its funnel is.
    must((await seeded.getByText("active", { exact: true }).count()) > 0, "the seeded card does not read active")
    must((await made.getByText("draft", { exact: true }).count()) > 0, "the new card does not read draft")

    await shoot(
      page,
      "01-quizzes-as-cards",
      "Every quiz gets the same card a funnel gets",
      "/admin/funnels/quizzes · light",
      [
        await markerAt(
          page,
          seeded.locator("iframe").first(),
          "The picture is the real page this quiz runs on, drawn live. A quiz has no page of its own, so the card shows the one it sits on.",
          { x: 24, y: 40 },
        ),
        await markerAt(
          page,
          seeded.locator('[data-testid="card-badge"]'),
          '"active" means this quiz can take answers. That is the quiz\'s own state, not the page\'s.',
          { x: -30, y: 4 },
        ),
        await markerAt(
          page,
          seeded.getByText(/completed/).first(),
          "How many people finished it, and how many started. The gap between the two is where people are giving up.",
          { x: -20, y: 4 },
        ),
        await markerAt(
          page,
          made.locator('[data-testid="card-badge"]'),
          '"draft" means nobody can answer this one yet. Open it, finish the questions, then switch it on.',
          { x: -30, y: 4 },
        ),
        await markerAt(
          page,
          made.getByRole("link", { name: /Preview/ }).first(),
          "Preview opens the page in a new tab so you can take the quiz yourself. Nothing you type there is saved.",
          { x: 74, y: 18 },
        ),
      ],
    )

    // ------------------------------------------------------------------
    // 2. Open goes to the questions.
    // ------------------------------------------------------------------
    const open = seeded.getByRole("link", { name: "Open" }).first()
    const openHref = await open.getAttribute("href")
    must(openHref === `/admin/funnels/quizzes/f15ef258-3f0a-494b-a8c9-deb2de7b2aa9`, `Open points at ${openHref}`)
    await open.click()
    await page.waitForURL(/\/admin\/funnels\/quizzes\/[0-9a-f-]+$/, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    must((await page.locator("text=/404|not found/i").count()) === 0, "Open landed on a 404")
    await shoot(
      page,
      "02-open-goes-to-the-questions",
      "Open takes you straight to the questions",
      "/admin/funnels/quizzes/<id> · light",
      [
        await markerAt(
          page,
          page.locator("h1").first(),
          "This is the quiz itself — the questions people answer, and what each answer is worth.",
          { x: -10, y: 40 },
        ),
      ],
    )

    // ------------------------------------------------------------------
    // 3. The button beside it opens the page that runs it.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels/quizzes`, { waitUntil: "networkidle" })
    await page.waitForTimeout(2500)
    // BY HREF, NOT BY NAME. The quiz template names the quiz after its funnel,
    // so the card TITLE (which opens the questions) and the button beside it
    // (which opens the page) carry the same accessible name -- and Playwright's
    // `name` is a substring match, so it took the first one and reported the
    // wrong href as a failure of the button.
    const toFunnel = cardFor(page, FUNNEL_NAME).locator('a[href*="/edit/"]').first()
    const funnelHref = await toFunnel.getAttribute("href")
    must(
      funnelHref === `/admin/funnels/${madeFunnelId}/edit/${await entryStepId(supabase, madeFunnelId)}`,
      `the funnel button points at ${funnelHref}`,
    )
    await toFunnel.click()
    await page.waitForURL(/\/admin\/funnels\/[0-9a-f-]+\/edit\//, { timeout: 30_000 })
    await page.waitForTimeout(3000)
    must((await page.locator("text=/404|not found/i").count()) === 0, "the funnel button landed on a 404")
    await shoot(
      page,
      "03-and-the-page-that-runs-it",
      "The button beside it opens the page the quiz sits on",
      "/admin/funnels/<id>/edit/<step> · light",
      [
        await markerAt(
          page,
          page.locator("iframe").first(),
          "The same page you saw in the small picture, now open for editing. The quiz is one block on it.",
          { x: 40, y: 60 },
        ),
      ],
    )

    console.log("\nAll assertions passed.")
  } finally {
    // Clean up whatever this run made, success or failure. An orphan draft quiz
    // on the dev copy would show up on this very screen tomorrow and read as a
    // real one.
    if (madeFunnelId) await supabase.from("funnels").delete().eq("id", madeFunnelId)
    if (madeQuizId) await supabase.from("quizzes").delete().eq("id", madeQuizId)
    console.log("  cleaned up")
    await ctx.close()
    await browser.close()
  }
}

async function entryStepId(supabase: SupabaseClient, funnelId: string): Promise<string> {
  const { data } = await supabase
    .from("funnel_steps")
    .select("id")
    .eq("funnel_id", funnelId)
    .eq("is_entry", true)
    .maybeSingle()
  return String((data as { id: string } | null)?.id ?? "")
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})
