// Proves, in the REAL admin, what `scripts/restore-funnel-kind.mjs` does to a
// row: it moves between the two boards, and nothing else about it changes.
//
//   npm run dev                                    # port 3050, .env.local
//   APP=http://localhost:3050 npx tsx scripts/capture-funnel-back-to-page.ts .env.local
//
// WHY THE SUBJECT IS THE DEV ATHLETE QUIZ AND NOT THE OWNER'S PAGE
//
// "Return to Sport Assessment" exists on PRODUCTION ONLY — the dev clone has
// never had that row. The prod admin needs the owner's own login, which this
// session does not have, so the prod change is verified at the database and the
// BEHAVIOUR is proved here, on the dev clone, against a row of the same shape:
// one funnel, one step, `kind='funnel'`. Say which is which rather than letting
// a dev capture stand in silently for a prod one.
//
// WHAT IT ASSERTS, IN BOTH DIRECTIONS
//
// An absence assertion passes just as well when nothing rendered, so every
// "not on this board" is paired with a control that must be present on the same
// screen. Before: the card is on /admin/funnels and NOT on /admin/pages, with
// the pages board's own "New landing page" button as the control that the page
// really did render. After: exactly the reverse.
//
// IT REVERTS. The dev Athlete Quiz is deliberately a funnel (moved there on
// 2026-08-31); this run puts it back before it exits, on the success path and
// the failure path alike.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/funnel-back-to-page"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const SUBJECT = "Athlete Quiz"
const SUBJECT_SLUG = "athlete-quiz"
const WIDTH = 1440
const HEIGHT = 1120
const DSF = 2

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

/** A marker on a real element. THROWS rather than degrading to a silent no-op. */
async function markerAt(
  page: Page,
  selector: string | Locator,
  caption: string,
  nudge: { x?: number; y?: number } = {},
): Promise<Marker> {
  const el = typeof selector === "string" ? page.locator(selector).first() : selector.first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${String(selector)}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE (zero box): ${String(selector)}`)
  const view = page.viewportSize()
  if (view && (box.y > view.height || box.y + box.height < 0)) {
    throw new Error(`MARKER TARGET OFF SCREEN: ${String(selector)} at y=${Math.round(box.y)}`)
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

async function board(page: Page, path: string): Promise<void> {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
}

async function main(): Promise<void> {
  const envPath = process.argv[2] ?? ".env.local"
  const env = loadEnv(envPath)
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(url.includes(CLONE_REF), `REFUSING TO RUN: ${envPath} is not the dev clone (${url}).`)
  const supabase: SupabaseClient = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  })

  const setKind = async (kind: "page" | "funnel") => {
    const { error } = await supabase.from("funnels").update({ kind }).eq("slug", SUBJECT_SLUG)
    if (error) throw new Error(`could not set kind=${kind}: ${error.message}`)
    console.log(`  dev ${SUBJECT_SLUG} -> kind="${kind}"`)
  }

  const browser = await launchChromium()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // ------------------------------------------------------------------
    // BEFORE — kind="funnel". On the funnels board, not on pages.
    // ------------------------------------------------------------------
    await setKind("funnel")

    await board(page, "/admin/pages")
    must((await cardFor(page, SUBJECT).count()) === 0, `BEFORE: ${SUBJECT} should NOT be on /admin/pages`)
    // The control for that absence: the pages board really did render.
    const newPageBtn = page.getByRole("button", { name: /new landing page/i }).first()
    must((await newPageBtn.count()) > 0, "BEFORE: /admin/pages did not render its own New landing page button")
    await shoot(
      page,
      "01-before-not-on-landing-pages",
      "Before — Landing pages board",
      `${SUBJECT} is kind="funnel", so this board does not list it. The board itself rendered.`,
      [await markerAt(page, newPageBtn, "The Landing pages board — it loaded; the quiz simply is not one.")],
    )

    await board(page, "/admin/funnels")
    const funnelCard = cardFor(page, SUBJECT)
    must((await funnelCard.count()) > 0, `BEFORE: ${SUBJECT} should be on /admin/funnels`)
    await shoot(
      page,
      "02-before-on-funnels",
      "Before — Funnels board",
      `Where the row sits today: one funnel, one page inside it.`,
      [await markerAt(page, funnelCard, `${SUBJECT} listed as a funnel.`)],
    )

    // ------------------------------------------------------------------
    // AFTER — kind="page". Exactly the reverse, both directions asserted.
    // ------------------------------------------------------------------
    await setKind("page")

    await board(page, "/admin/pages")
    const pageCard = cardFor(page, SUBJECT)
    must((await pageCard.count()) > 0, `AFTER: ${SUBJECT} should be on /admin/pages`)
    await shoot(
      page,
      "03-after-on-landing-pages",
      "After — Landing pages board",
      `One column changed. The page, its content and its public address are untouched.`,
      [
        await markerAt(page, pageCard, `${SUBJECT} is now listed as a landing page.`),
        await markerAt(page, newPageBtn, "Same board as shot 1, which listed nothing."),
      ],
    )

    await board(page, "/admin/funnels")
    must((await cardFor(page, SUBJECT).count()) === 0, `AFTER: ${SUBJECT} should NOT be on /admin/funnels`)
    const newFunnelBtn = page.getByRole("button", { name: /new funnel/i }).first()
    must((await newFunnelBtn.count()) > 0, "AFTER: /admin/funnels did not render its own New funnel button")
    await shoot(
      page,
      "04-after-not-on-funnels",
      "After — Funnels board",
      `It has left this board. The board rendered, so this is absence, not a failed load.`,
      [await markerAt(page, newFunnelBtn, "The Funnels board — it loaded; the quiz is no longer on it.")],
    )

    console.log("\n  all assertions passed")
  } finally {
    // The dev Athlete Quiz is deliberately a funnel. Put it back either way.
    await supabase.from("funnels").update({ kind: "funnel" }).eq("slug", SUBJECT_SLUG)
    console.log(`  reverted dev ${SUBJECT_SLUG} to kind="funnel"`)
    await ctx.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})
