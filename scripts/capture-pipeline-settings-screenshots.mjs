// Drives the REAL app and captures /admin/pipeline/settings — G29 Task 7's
// board editor — with callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npx next dev --port 3071                                       # NOT 3050
//   node scripts/capture-pipeline-settings-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page. Structure and helpers copied from
// the working reference, scripts/capture-sequence-management-screenshots.mjs —
// see that file's header for why each helper exists.
//
// PORT IS 3071, DELIBERATELY. Several peer sessions work this same repo and
// any of them may bring up a dev server on the default 3050 at any time.
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to
// choices[0] with no cookie, and on this dev clone that is a seeded test
// business whose boards have no cards at all. Every shot here runs against
// "Primary" (00000000-0000-0000-0000-000000000001), whose Coaching board has
// 7 + 2 + 2 + 2 real cards on it.
//
// NO STATE IS LEFT CHANGED. This screen's only network-mutating controls are
// "Save stages" (PUT), "Save board name" / "Yes, archive it" (PATCH) and
// "Create board" (POST). None of them is ever clicked. Shots 02 and 03 are
// deliberately UNSAVED local React state on the real page — a page reload
// discards them for free, and the dev clone is shared with peer sessions.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3071"
const OUT = "screenshots/pipeline-settings"
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

/** Marker positioned on a real element. Warns loudly rather than degrading politely. */
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
  const cx =
    place === "center"
      ? box.x + box.width / 2
      : place === "right"
        ? box.x + box.width - 22
        : place === "after"
          ? box.x + box.width + 22
          : place === "inset"
            ? box.x + 24
            : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

/**
 * Reset scroll to the very top before measuring ANY marker position — every
 * fill()/click() above scrolls its own target into view, and boundingBox()
 * is viewport-relative while fullPage screenshots capture from scrollTop 0.
 */
async function resetScroll(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.waitForTimeout(200)
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await page.mouse.move(4, 4) // park the pointer, or its hover state lands in the shot
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage: true })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

const row = (page, n) => page.getByTestId(`stage-row-${n}`)
const nameBox = (page, n) => page.getByLabel(`Stage ${n} name`)
const kindBox = (page, n) => page.getByLabel(`Stage ${n} kind`)
const saveStages = (page) => page.getByRole("button", { name: "Save stages" })

/** The real problem strip, excluding Next's invisible route announcer (`#__next-route-announcer__`). */
const problemStrip = (page) => page.locator('[data-testid="board-problems"]')

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)

  // CRITICAL — set the business cookie BEFORE navigating anywhere that reads
  // the tenant. See this file's header.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()

  // ------------------------------------------------------------ 00 the link
  await page.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)
  await resetScroll(page)
  await shoot(
    page,
    "00-board-link",
    "The way in",
    "/admin/pipeline — the board, with the new entrance to its settings",
    [
      await markerOn(
        page,
        page.getByRole("link", { name: "Edit stages" }),
        "New. “Edit stages” opens the settings for the board you are looking at — not for whichever board happens to be first.",
        {
          place: "left",
        },
      ),
    ],
  )

  // ------------------------------------------------------------ 01 as loaded
  await page.goto(`${APP}/admin/pipeline/settings?board=coaching`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900) // hydration — a control clicked too early has no handler attached yet

  const rows = await page.locator('[data-testid^="stage-row-"]').count()
  console.log(`  coaching: stage rows=${rows}`)
  if (rows !== 4) {
    throw new Error(`expected 4 stage rows on Primary's Coaching board, got ${rows} — the tenant cookie did not take`)
  }

  await resetScroll(page)
  await shoot(
    page,
    "01-editor",
    "The board editor, as it loads",
    "/admin/pipeline/settings?board=coaching — Primary's real Coaching board, 13 real cards across its four stages",
    [
      // `exact: true` — Playwright's getByLabel is a SUBSTRING match, so a
      // bare "Board name" also matches "New board name" at the bottom of the
      // screen and the marker lands on the wrong card.
      await markerOn(
        page,
        page.getByLabel("Board name", { exact: true }),
        "Rename the board here. The short name under it never changes — every card already filed points at it.",
        { place: "left" },
      ),
      await markerOn(
        page,
        page.getByRole("navigation", { name: "Pipeline boards" }),
        "One pill per board this business has. They stay on this screen instead of jumping back to the cards.",
        { place: "after", dx: 6 },
      ),
      // Aimed at the GAP between the name box and the short-name box, so the
      // disc does not sit on top of either control.
      await markerOn(
        page,
        page.getByLabel("Stage 1 key"),
        "Each stage's own name, short name, kind and two warning limits — all on one line. The grey box is fixed and cannot be typed in.",
        { place: "left" },
      ),
      await markerOn(
        page,
        page.getByLabel("Stage 1: days in this step before it looks slow"),
        "“Slow after” counts days in this step. “No reply after” counts days since the person last said anything.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        row(page, 0).getByText("7 cards"),
        "How many cards sit on this stage right now. You need this before you remove one.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        page.getByLabel("Drag to reorder stage 2"),
        "Drag to reorder, or use the arrows. The order you leave them in is the order cards move through.",
        { place: "left" },
      ),
      await markerOn(
        page,
        saveStages(page),
        "Nothing is saved until you press this. One press saves the whole list at once.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  // ---------------------------------------------------------- 02 the refusal
  // Two problems at once, of the two DIFFERENT kinds: a blank name belongs to
  // one stage, "two Won stages" belongs to the board.
  await nameBox(page, 2).fill("")
  await kindBox(page, 1).selectOption("won")
  await page.waitForTimeout(300)

  const stripText = (await problemStrip(page).textContent()) ?? ""
  console.log(`  problem strip: ${stripText.replace(/\s+/g, " ").slice(0, 120)}`)
  if (!stripText.includes("exactly one Won stage")) {
    throw new Error(`expected the board-level problem in the strip, got: ${stripText.slice(0, 200)}`)
  }
  if (await saveStages(page).isEnabled()) throw new Error("Save should be disabled while a problem is showing")

  await resetScroll(page)
  await shoot(
    page,
    "02-problems",
    "What it says when the list would not work",
    "Nothing was sent — these appear as you type, and the same rules run again on the server",
    [
      await markerOn(
        page,
        problemStrip(page),
        "A problem with the WHOLE board is stated at the top. A board needs exactly one Won stage and one Lost stage, or a card can never be closed.",
        { place: "left" },
      ),
      await markerOn(
        page,
        row(page, 1).getByText("Every stage needs a name."),
        "A problem with ONE stage sits against that stage, so you can see which line to fix.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        saveStages(page),
        "Save is off while anything is wrong — and the save refuses by itself even if the button is bypassed.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  // ------------------------------------------------- 03 the destination picker
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  await page.getByRole("button", { name: "Remove stage 2" }).click() // Consulted, 2 cards
  await page.waitForTimeout(300)

  const picker = page.getByLabel('Where should the 2 cards on "Consulted" go?')
  if ((await picker.count()) === 0) throw new Error("the destination picker did not appear for a stage holding cards")

  await resetScroll(page)
  await shoot(
    page,
    "03-cards-need-a-home",
    "Taking a stage off a board that still has cards on it",
    "The two cards on “Consulted” have to be told where to go — they are moved in the same step that removes the stage",
    [
      await markerOn(
        page,
        picker,
        "Pick where the cards go. Until you do, the save is refused — nobody's card is quietly deleted.",
        { place: "after", dx: 10 },
      ),
      await markerOn(page, problemStrip(page), "Said in plain words, with the number of cards at stake.", {
        place: "left",
      }),
      await markerOn(
        page,
        page.getByRole("button", { name: "Add a stage" }),
        "New stages go on the end, and only a brand-new stage lets you type its short name.",
        { place: "left" },
      ),
    ],
  )

  console.log("\n  done — nothing was saved; every shot above is unsaved local state on the real page")
} finally {
  await ctx.close()
  await browser.close()
}
