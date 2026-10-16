// Annotated screenshots of newsletter results on the REAL /admin/newsletter
// list and the newsletter's own page, against `next dev` on :3050 and the
// development clone.
//
// The 2026-10-09 results on the clone were written by
// `scripts/backfill-newsletter-results.ts --apply` from Resend's real log, and
// its retry queue by `scripts/enqueue-newsletter-retry.ts --apply`. The
// 2026-09-25 row is mirrored from production by SQL (sent, no results). Never
// click Send in dev: the deployed function would mail the real list. Every
// non-GET request from the page is aborted.
//
//   node scripts/capture-newsletter-results.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co") throw Error("Development clone only")

const OCT_9 = "d8fc510b-dd44-4e3f-9bef-6b1e99002ef2"
const SEP_25 = "7b07c7fb-7e66-4e13-a662-c6008ba72519"
const DSF = 2
const W = 1440
const H = 900
const out = "screenshots/newsletter-results"
mkdirSync(`${out}/raw`, { recursive: true })
const checks = { pageErrors: [], screenshots: [], darkMode: "Admin is light-only" }
const SUBTITLE = "Real admin pages · development clone · Oct 9 results rebuilt from Resend's log · nothing sent"

async function shot(page, name, title, targets) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(600)
  const markers = []
  for (const [locator, caption] of targets) {
    const box = await locator.boundingBox()
    if (!box || box.y < 0 || box.y + box.height > H) throw Error(`Missing or offscreen marker: ${caption}`)
    markers.push({ x: Math.max(20, box.x - 22) * DSF, y: (box.y + box.height / 2) * DSF, caption })
  }
  await page.screenshot({ path: `${out}/raw/${name}.png` })
  await annotate(`${out}/raw/${name}.png`, `${out}/${name}.png`, { title, subtitle: SUBTITLE, markers })
  checks.screenshots.push(name)
}

let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, reducedMotion: "reduce" })
  const page = await context.newPage()
  page.on("pageerror", (e) => checks.pageErrors.push(e.message))
  await page.goto("http://localhost:3050/api/dev/login?callbackUrl=/admin/dashboard", { waitUntil: "networkidle" })
  // Production has one business, Primary. The clone defaults to a seeded one.
  await context.addCookies([
    { name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: "http://localhost:3050" },
  ])
  await context.route("**/*", (route) =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort(),
  )

  await page.goto("http://localhost:3050/admin/newsletter", { waitUntil: "networkidle" })
  if (!page.url().endsWith("/admin/newsletter")) throw Error(`Wrong route ${page.url()}`)
  const row = page.locator("tr").filter({ hasText: "Awareness before Action" }).first()
  await shot(page, "01-list", "Every sent newsletter shows how it did", [
    [
      row.getByText(/sent, .* failed/),
      "Top line: what Resend accepted. Below it: how it did. Opened and clicked are out of the emails that arrived, bounced out of all sent.",
    ],
    [row.getByText(/^Resending to people who missed it/), "The resend of the people it missed keeps its own line."],
  ])

  await page.goto(`http://localhost:3050/admin/newsletter/${OCT_9}/edit`, { waitUntil: "networkidle" })
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Results", exact: true }) })
  await panel.waitFor({ state: "visible" })
  await shot(page, "02-results-panel", "The newsletter's own page: what happened to its emails", [
    [panel.getByText("Delivered", { exact: true }), "Arrived in an inbox. Suppressed and failed emails are not counted."],
    [panel.getByText("Opened", { exact: true }), "Each rate says what it is out of."],
    [panel.getByText("Bounced (the address does not exist)"), "Only addresses that do not exist. Resend's own page also counts soft bounces."],
    [panel.getByText(/more are still being resent/), "The resend's progress, until the queue is empty."],
  ])

  await page.goto(`http://localhost:3050/admin/newsletter/${SEP_25}/edit`, { waitUntil: "networkidle" })
  const empty = page.getByText("No results recorded for this send.")
  await empty.waitFor({ state: "visible" })
  await shot(page, "03-no-results", "A send from before results were kept", [
    [empty, "Sep 25 went out on the other Resend account, so there is nothing to rebuild."],
  ])

  checks.ok = checks.pageErrors.length === 0
} finally {
  await browser?.close()
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2))
  console.log(JSON.stringify(checks))
}
