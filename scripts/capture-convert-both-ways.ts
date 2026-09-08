// Drives the REAL admin and proves Convert works in both directions, by
// CLICKING IT — not by writing `kind` behind the app's back.
//
//   npx next dev -p 3060                        # this worktree
//   APP=http://localhost:3060 npx tsx scripts/capture-convert-both-ways.ts .env.local
//
// WHAT IT PROVES, and why each shot exists
//
//   1. A landing page card offers "Convert to funnel".
//   2. Pressing it MOVES THE ROW: the run lands on /admin/funnels and the card
//      is there. The database is read back afterwards, because a toast and a
//      redirect are things the client did — only the row says it happened.
//   3. A funnel with TWO pages shows the button DISABLED, with the count in its
//      tooltip. This is the case the owner chose over hiding the control.
//   4. Converting back returns it to /admin/pages, so the pair is symmetric.
//
// EVERY ABSENCE HAS A CONTROL. "Not on this board" passes just as well when the
// board failed to render, so each of those assertions is paired with that
// board's own New button.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE (see CLONE_REF), it creates
// its own subject rather than converting the owner's data, and it deletes that
// subject on the way out — on the failure path too.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3060"
const OUT = "screenshots/convert-both-ways"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1120
const DSF = 2

const STAMP = process.env.STAMP ?? String(Date.now()).slice(-6)
const NAME = `Return To Sport ${STAMP}`
const SLUG = `return-to-sport-${STAMP}`

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
  // PARK THE POINTER FIRST. Playwright's virtual mouse STAYS where it last
  // clicked, and the page navigates under it — so a card that happens to land
  // beneath that coordinate is photographed in its :hover state. The first run
  // of this script shot one Convert button filled accent-orange (`outline` is
  // `hover:bg-accent`) beside two identical buttons drawn as outlines, which
  // reads as a styling bug in the deliverable and is not one.
  await page.mouse.move(4, 4)
  await page.waitForTimeout(150)
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

const cardFor = (page: Page, name: string): Locator =>
  page.locator('[data-testid="funnel-card"]').filter({ hasText: name }).first()

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

  const kindInDb = async (): Promise<string | null> => {
    const { data } = await supabase.from("funnels").select("kind").eq("slug", SLUG).maybeSingle()
    return (data as { kind: string } | null)?.kind ?? null
  }

  // The subject is CREATED HERE, not borrowed. Converting the owner's own rows
  // to take a screenshot would be changing his data to photograph it.
  const { data: made, error: makeError } = await supabase
    .from("funnels")
    .insert({ slug: SLUG, name: NAME, kind: "page", goal: "leads", status: "draft" })
    .select("id")
    .single()
  if (makeError) throw new Error(`could not create the subject: ${makeError.message}`)
  const funnelId = (made as { id: string }).id
  const { error: stepError } = await supabase
    .from("funnel_steps")
    .insert({ funnel_id: funnelId, slug: "index", name: "Landing page", position: 0, is_entry: true })
  if (stepError) throw new Error(`could not create the subject's page: ${stepError.message}`)
  console.log(`  created ${SLUG} as a landing page (${funnelId})`)

  const browser = await launchChromium()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // ------------------------------------------------------------------
    // 1. The button exists on a landing page.
    // ------------------------------------------------------------------
    await board(page, "/admin/pages")
    const pageCard = cardFor(page, NAME)
    must((await pageCard.count()) > 0, `${NAME} is not on /admin/pages`)
    const toFunnel = pageCard.getByRole("button", { name: "Convert to funnel" })
    must((await toFunnel.count()) > 0, "no Convert to funnel button on the landing page card")
    await shoot(
      page,
      "01-landing-page-offers-convert",
      "A landing page can become a funnel",
      "The control the owner asked for, back on the card after being removed in August.",
      [await markerAt(page, toFunnel, "Convert to funnel — on every landing page card.")],
    )

    // ------------------------------------------------------------------
    // 2. Pressing it moves the row. Confirmed IN THE DATABASE.
    // ------------------------------------------------------------------
    await toFunnel.click()
    await page.getByRole("button", { name: "Convert to funnel" }).last().click()
    await page.waitForURL(/\/admin\/funnels(\?|$)/, { timeout: 30_000 })
    await page.waitForTimeout(2500)

    must((await kindInDb()) === "funnel", "the row is still kind=page after converting — the click did nothing")
    const funnelCard = cardFor(page, NAME)
    must((await funnelCard.count()) > 0, `${NAME} did not arrive on /admin/funnels`)
    await shoot(
      page,
      "02-now-a-funnel",
      "One click later — it is a funnel",
      "The page, its content and its web address are unchanged. Only the board changed.",
      [await markerAt(page, funnelCard, `${NAME} now lives on the Funnels board.`)],
    )

    // ------------------------------------------------------------------
    // 3. Grow it to two pages: the button must go DISABLED and say why.
    // ------------------------------------------------------------------
    const { error: secondStep } = await supabase
      .from("funnel_steps")
      .insert({ funnel_id: funnelId, slug: "thanks", name: "Thanks", position: 1, is_entry: false })
    if (secondStep) throw new Error(`could not add a second page: ${secondStep.message}`)

    await board(page, "/admin/funnels")
    const blocked = cardFor(page, NAME).getByRole("button", { name: "Convert to landing page" })
    must((await blocked.count()) > 0, "the disabled Convert button is missing entirely — it must be shown, not hidden")
    must(await blocked.isDisabled(), "a two-page funnel still offers Convert as clickable")
    const tip = await blocked.getAttribute("title")
    must(Boolean(tip?.includes("2 pages")), `the tooltip does not name the page count: ${tip}`)
    await shoot(
      page,
      "03-two-pages-blocked-with-reason",
      "Two pages — the button explains itself",
      "A landing page is one page. It is greyed out and says how many to remove, rather than vanishing.",
      [await markerAt(page, blocked, `Disabled, and the tooltip reads: "${tip}"`)],
    )

    // ------------------------------------------------------------------
    // 4. Remove the extra page and convert back, closing the loop.
    // ------------------------------------------------------------------
    await supabase.from("funnel_steps").delete().eq("funnel_id", funnelId).eq("slug", "thanks")

    await board(page, "/admin/funnels")
    const toPage = cardFor(page, NAME).getByRole("button", { name: "Convert to landing page" })
    must(!(await toPage.isDisabled()), "still disabled after the second page was removed")
    await toPage.click()
    await page.getByRole("button", { name: "Convert to landing page" }).last().click()
    await page.waitForURL(/\/admin\/pages(\?|$)/, { timeout: 30_000 })
    await page.waitForTimeout(2500)

    must((await kindInDb()) === "page", "the row did not go back to kind=page")
    const backCard = cardFor(page, NAME)
    must((await backCard.count()) > 0, `${NAME} did not come back to /admin/pages`)
    // The control for the absence in shot 2's sibling board: this board rendered.
    const newPageBtn = page.getByRole("button", { name: /new landing page/i }).first()
    must((await newPageBtn.count()) > 0, "/admin/pages did not render its own New landing page button")
    await shoot(
      page,
      "04-converted-back",
      "And back again",
      "The round trip the owner actually asked for, driven through the real buttons.",
      [
        await markerAt(page, backCard, `${NAME} is a landing page again.`),
        await markerAt(page, newPageBtn, "The Landing pages board, which really did load."),
      ],
    )

    console.log("\n  all assertions passed")
  } finally {
    // The subject is this run's own. Remove it either way — a failed run must
    // not leave a "Return To Sport 481920" on the owner's board.
    await supabase.from("funnel_steps").delete().eq("funnel_id", funnelId)
    await supabase.from("funnels").delete().eq("id", funnelId)
    console.log(`  removed ${SLUG}`)
    await ctx.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
})
