// Drives the REAL app and proves both admin screens now render one board
// component, while still behaving as the two different things they are.
//
//   npm run build && npm run dev          # in another terminal (port 3050)
//   APP=http://localhost:3050 npx tsx scripts/capture-one-board.ts .env.local
//
// WHAT IT PROVES
//
//   1. ONE CARD, BOTH SCREENS. `[data-testid="funnel-card"]` — the funnels
//      board's card — is what `/admin/pages` draws now. That is the change.
//
//   2. AND THEY STILL DIFFER WHERE THEY MUST. Every difference is asserted in
//      BOTH directions across the two shots, because "no goal badge on the
//      funnels board" passes just as well when nothing rendered:
//        · the goal badge is page-only;
//        · the ⚙ settings link is funnel-only, because /admin/pages/<id>
//          redirects to the list and a control whose only outcome is a bounce
//          back to this screen is the dead end that redirect removed;
//        · the create dialog and the search placeholder follow the screen.
//
//   3. THE SIDEBAR TAB STAYS RIGHT. A page card's Open link must be
//      `/admin/pages/...`, never `/admin/funnels/...`. Both routes serve a page
//      — the funnels one redirects — so a wrong link WORKS and merely lights
//      the wrong sidebar tab, which is the defect `adminFunnelBase` exists to
//      prevent and the one this merge nearly reintroduced.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE — see CLONE_REF. The dev
// copy's own landing page carries `goal: null`, so it cannot show the badge;
// rather than assert against data that cannot answer, the run creates one
// landing page through the real New landing page dialog and deletes it again.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/one-board"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1120
const DSF = 2

const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const PAGE_NAME = `Board Check ${STAMP}`

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
  let madePageId: string | null = null

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // ------------------------------------------------------------------
    // A landing page WITH a goal, made through the real dialog. The dev
    // copy's own page has `goal: null` and so cannot show the badge.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/pages`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    await page.getByRole("button", { name: "New landing page" }).first().click()
    await page.getByLabel(/^name/i).fill(PAGE_NAME)
    await page.waitForTimeout(300)
    await page.getByRole("button", { name: /create landing page|create page|create/i }).last().click()
    await page.waitForURL(/\/admin\/pages\/[0-9a-f-]+\/edit\//, { timeout: 60_000 })
    const { data: madeRow } = await supabase.from("funnels").select("id").eq("name", PAGE_NAME).maybeSingle()
    must(!!madeRow, "the landing page the dialog created was not found")
    madePageId = String((madeRow as { id: string }).id)
    console.log(`  created landing page ${madePageId}`)

    // ------------------------------------------------------------------
    // 1. The landing pages board, drawn by the shared card.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/pages`, { waitUntil: "networkidle" })
    await page.waitForTimeout(4000)

    const cards = page.locator('[data-testid="funnel-card"]')
    must(
      (await cards.count()) >= 2,
      `expected at least 2 cards on /admin/pages, found ${await cards.count()} — is this rendering the shared card at all?`,
    )
    const made = cardFor(page, PAGE_NAME)
    must((await made.count()) > 0, `no card for "${PAGE_NAME}"`)

    // THE GOAL BADGE IS A PAGE-ONLY FACT.
    const goalBadge = made.getByText("Capture leads").first()
    must((await goalBadge.count()) > 0, "the landing page card shows no goal badge")

    // NO SETTINGS LINK. /admin/pages/<id> redirects to this list.
    must(
      (await page.locator(`a[href="/admin/pages/${madePageId}"]`).count()) === 0 &&
        (await page.locator(`a[href="/admin/funnels/${madePageId}"]`).count()) === 0,
      "a landing page card offers a settings screen that only redirects back here",
    )

    // AND THE SIDEBAR TAB STAYS RIGHT.
    const openLink = made.getByRole("link", { name: "Open" }).first()
    const openHref = (await openLink.getAttribute("href")) ?? ""
    must(
      openHref.startsWith(`/admin/pages/${madePageId}/edit/`),
      `a page card's Open points at ${openHref} — a /admin/funnels link works and lights the wrong sidebar tab`,
    )
    must((await page.getByPlaceholder("Search pages…").count()) > 0, "the pages board does not search pages")
    console.log(`  /admin/pages: shared card, goal badge, no settings link, Open -> ${openHref}`)

    await shoot(
      page,
      "01-landing-pages-on-the-shared-card",
      "Landing pages, drawn by the funnels board's own card",
      "/admin/pages · light",
      [
        await markerAt(page, goalBadge, "What this page is for. Only a landing page shows this — a funnel's steps each have their own job.", { x: -22, y: 4 }),
        await markerAt(page, openLink, "Open goes to /admin/pages/…, so the Landing Pages tab stays lit while you edit.", { x: 18, y: -22 }),
        await markerAt(page, page.getByPlaceholder("Search pages…"), "The screen still speaks its own language, even though both screens now share one card.", { x: 210, y: 18 }),
      ],
    )

    // ------------------------------------------------------------------
    // 2. The funnels board — the same card, behaving as a funnel.
    // ------------------------------------------------------------------
    await page.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await page.waitForTimeout(4000)

    const funnelCards = page.locator('[data-testid="funnel-card"]')
    must((await funnelCards.count()) > 0, "no cards on /admin/funnels")
    const firstFunnel = funnelCards.first()

    // A FUNNEL HAS NO SINGLE GOAL. Presence control: the badge rendered above.
    must(
      (await page.getByText("Capture leads").count()) === 0,
      "the funnels board shows a goal badge, which belongs to a page",
    )
    // AND IT DOES HAVE A SETTINGS SCREEN.
    const gear = firstFunnel.locator('a[href^="/admin/funnels/"]').filter({ hasNotText: /.+/ }).first()
    must((await gear.count()) > 0, "a funnel card offers no way to its settings screen")
    must((await page.getByPlaceholder("Search funnels and pages…").count()) > 0, "the funnels board lost its placeholder")
    must((await page.getByRole("button", { name: "New funnel" }).count()) > 0, "no New funnel button")
    console.log("  /admin/funnels: same card, no goal badge, settings link present")

    await shoot(
      page,
      "02-funnels-on-the-same-card",
      "Funnels, drawn by the same card — behaving as funnels",
      "/admin/funnels · light",
      [
        await markerAt(page, firstFunnel.locator('[data-testid="card-title"]'), "The same card as the previous picture. What changes is the row it is drawing, not the screen it is on.", { x: -20, y: 4 }),
        await markerAt(page, gear, "A funnel has a settings screen; a landing page does not, so this button is only ever here.", { x: 58, y: 18 }),
        await markerAt(page, page.getByRole("button", { name: "New funnel" }), "Each screen keeps its own button, its own words and its own web address.", { x: -24, y: 18 }),
      ],
    )

    console.log("\nAll assertions passed.")
  } finally {
    if (madePageId) await supabase.from("funnels").delete().eq("id", madePageId)
    console.log("  cleaned up")
    await ctx.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})
