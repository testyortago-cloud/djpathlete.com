// Drives the REAL app and captures /admin/sequences and /admin/sequences/[key],
// with the callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev                                            # port 3050
//   node scripts/capture-sequence-reporting-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page. The counts on screen are real
// sequence_runs rows already on the dev clone: two people in Cold Lead
// Re-engagement (one still going, one who booked a call), one person in
// Quiz — Rebuilder who unsubscribed, and zero people in New Lead Nurture.
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to
// choices[0] with no cookie, and on this dev clone that is the seeded test
// business "Northcrest Barbell 10E", which has no sequences at all. Every
// shot here must run against "Primary" (00000000-0000-0000-0000-000000000001)
// or the report is a wall of zeros that looks like a broken feature.
//
// LIGHT ONLY, DELIBERATELY. The admin components were never built against the
// `.dark` class variant — forcing it breaks existing pages — so there is no
// second rendering to capture. This is not an omission.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/sequence-reporting"
const WIDTH = 1440
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
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
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
  await page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll("button"))) {
      const s = getComputedStyle(b)
      if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
    }
  })
}

/**
 * Marker positioned on a real element, converted from CSS px to the raw pixel
 * space annotate() draws in.
 *
 * WARNS LOUDLY rather than degrading politely — a helper that quietly returns
 * a default turns a misplaced callout into a silent no-op, and the reviewer
 * reads a caption pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) {
    console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  }
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage: true })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  // Assert the session BEFORE anything else: an expired or refused login
  // reports downstream as a feature failure that mimics a real bug.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)

  // CRITICAL — set the business cookie BEFORE navigating anywhere that reads
  // the tenant. Without it resolveAdminTenant() lands on choices[0], which on
  // this dev clone is "Northcrest Barbell 10E" — a seeded test business with
  // no sequences at all.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()

  // ---------------------------------------------------------------- 01 list
  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const rowCount = await page.locator("tbody tr").count()
  const emptyState = await page.getByText("No sequences have been set up yet.").count()
  console.log(`  list: rows=${rowCount} empty-state=${emptyState}`)
  if (rowCount !== 9 || emptyState > 0) {
    throw new Error(
      `expected 9 sequence rows on Primary, got rows=${rowCount} empty-state=${emptyState} — the tenant cookie did not take`,
    )
  }

  const coldRow = page.locator("tbody tr", { hasText: "Cold Lead Re-engagement" })
  const coldLink = page.getByRole("link", { name: "Cold Lead Re-Engagement" })
  const coldEnteredCell = coldRow.locator("td").nth(1)
  const coldBookedCell = coldRow.locator("td").nth(4)
  const quizWaitingText = page.getByText("Nobody yet — waiting on a quiz result.").first()
  const notStartedPill = page.getByText("Not started").first()

  await shoot(
    page,
    "01-every-sequence-and-what-happened",
    "Every follow-up sequence, and what happened to the people in it",
    "/admin/sequences",
    [
      await markerOn(
        page,
        coldLink,
        "Each row is one automatic follow-up. Click the name to see the people in it.",
        { place: "center", dy: -32 },
      ),
      await markerOn(
        page,
        coldEnteredCell,
        "Two people have entered this one. The columns to the right always add up to this number.",
        { place: "center", dy: -26 },
      ),
      await markerOn(
        page,
        coldBookedCell,
        "One of them booked a call. That is what this sequence is for, and the follow-up stops on its own the moment it happens.",
        { place: "center", dy: -26 },
      ),
      await markerOn(
        page,
        quizWaitingText,
        "When nobody has entered a sequence, the page says why instead of showing a bare zero. This one is waiting for somebody to finish the quiz.",
        { place: "left", dx: -6 },
      ),
      await markerOn(
        page,
        notStartedPill,
        "These are switched off. That is the reason their numbers are zero — nothing is broken.",
        { place: "left", dx: -6 },
      ),
    ],
  )

  // ---------------------------------------------------- 02 cold lead detail
  await page.goto(`${APP}/admin/sequences/cold_lead_re_engagement`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const tiles = page.locator("div.grid.grid-cols-2").first()
  const noorRow = page.locator("tbody tr", { hasText: "Noor Haddad" })
  const mayaRow = page.locator("tbody tr", { hasText: "Maya Sorensen" })
  console.log(`  detail(cold): tiles=${await tiles.count()} noor=${await noorRow.count()} maya=${await mayaRow.count()}`)

  await shoot(
    page,
    "02-one-sequence-and-its-people",
    "One sequence, and every person in it",
    "/admin/sequences/cold_lead_re_engagement",
    [
      await markerOn(page, tiles, "The same counts as the list page, for this one sequence.", {
        place: "center",
        dy: -14,
      }),
      await markerOn(
        page,
        noorRow,
        "Noor booked a call, so she left the sequence on the date shown. She gets no further emails.",
        { place: "left", dx: -6 },
      ),
      await markerOn(
        page,
        mayaRow,
        "Maya is still going, part-way through the six steps.",
        { place: "left", dx: -6 },
      ),
    ],
  )

  // -------------------------------------------------- 03 quiz_rebuilder detail
  await page.goto(`${APP}/admin/sequences/quiz_rebuilder`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const optedOutBadge = page.locator("span").filter({ hasText: /^Opted out$/ })
  const unsubLine = page.getByText("Clicked unsubscribe in an email")
  console.log(`  detail(quiz_rebuilder): badge=${await optedOutBadge.count()} line=${await unsubLine.count()}`)

  await shoot(
    page,
    "03-why-somebody-left",
    "Why somebody left is recorded, not just that they left",
    "/admin/sequences/quiz_rebuilder",
    [
      await markerOn(page, optedOutBadge, "This person asked to stop hearing from you.", {
        place: "left",
        dx: -6,
      }),
      await markerOn(
        page,
        unsubLine,
        "And this says how. Clicking unsubscribe in an email, replying STOP to a text, and already being on your do-not-contact list are three different things, and the page keeps them apart.",
        { place: "left", dx: -6 },
      ),
    ],
  )

  // -------------------------------------------------- 04 new_lead_nurture detail
  await page.goto(`${APP}/admin/sequences/new_lead_nurture`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const emptyRow = page.getByText("Nobody has entered this sequence yet.")
  console.log(`  detail(new_lead_nurture): empty-row=${await emptyRow.count()}`)

  await shoot(
    page,
    "04-an-empty-sequence-says-why",
    "An empty sequence says why it is empty",
    "/admin/sequences/new_lead_nurture",
    [
      await markerOn(
        page,
        emptyRow,
        "Not a blank page, and not an error. Nobody has filled in the form that would put them here yet.",
        { place: "center", dy: -20 },
      ),
    ],
  )

  console.log("\ndone.")
} finally {
  await ctx.close()
  await browser.close()
}
