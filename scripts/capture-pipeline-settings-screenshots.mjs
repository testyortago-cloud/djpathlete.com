// Drives the REAL app and captures /admin/pipeline/settings — G29's board
// editor — with callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npx next dev --port 3073                                       # NOT 3050
//   node scripts/capture-pipeline-settings-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page. Structure and helpers copied from
// the working reference, scripts/capture-sequence-management-screenshots.mjs —
// see that file's header for why each helper exists.
//
// IT WRITES THE SHOTS NUMBERED 00-05 (including 04a and 04b) of
// screenshots/g29-pipeline-editor, which
// is the ONE home for this feature's deliverables. 06-10 come from
// scripts/capture-new-card-dialog-screenshots.mjs and 11 from
// scripts/capture-g29-hand-made-cards.mjs; all three share this port.
//
// PORT IS 3073, DELIBERATELY. Several peer sessions work this same repo and
// any of them may bring up a dev server on the default 3050.
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to
// choices[0] with no cookie, and on this dev clone that is a seeded test
// business whose boards have no cards at all. Every shot here runs against
// "Primary" (00000000-0000-0000-0000-000000000001), whose Coaching board has
// real cards on it.
//
// NO BOARD AND NO STAGE IS CHANGED. "Save stages" (PUT), "Save board name"
// (PATCH) and "Create board" (POST) are never clicked. Shots 02, 03, 04, 04a
// and 04b are deliberately UNSAVED local React state on the real page — a page reload
// discards them for free, and the dev clone is shared with peer sessions.
//
// SHOT 05 IS THE ONE EXCEPTION, and it is safe by construction: it archives
// the DEFAULT board, which `updatePipelineBoard` refuses before it writes
// anything. The script proves the board is the default one BEFORE it clicks —
// from the screen's own sentence — and re-reads the board's status from the
// page afterwards. Aimed at any other board, that click would really archive
// it; that is precisely why the pre-check is not optional.
//
// COUNTS ARE READ OFF THE SCREEN, NEVER HARD-CODED. This board gains cards
// (scripts/capture-g29-hand-made-cards.mjs files four by hand), and a caption
// that says "7 cards" because it did in September is a caption that lies.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3073"
const OUT = "screenshots/g29-pipeline-editor"
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

async function shoot(page, name, title, subtitle, markers, { park = true } = {}) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  // Park the pointer, or its hover state lands in the shot. `park: false` is
  // for the mid-reorder shot ONLY, where the pointer is holding a drag open
  // and moving it away is what ends the thing being photographed.
  if (park) await page.mouse.move(4, 4)
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

/** The "N cards" cell on one stage row, whatever N happens to be today. */
const cardsCell = (page, n) => row(page, n).getByText(/^(No cards|1 card|\d+ cards)$/)

function must(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

/**
 * Every stage row's card count, read off the screen. The captions quote these
 * rather than restating a number that was true in September — this board gains
 * cards, and a caption nobody re-checks is the one that goes wrong quietly.
 */
async function readCardCounts(page) {
  const rows = await page.locator('[data-testid^="stage-row-"]').count()
  const counts = []
  for (let i = 0; i < rows; i += 1) {
    const text = ((await cardsCell(page, i).first().textContent()) ?? "").trim()
    const n = text === "No cards" ? 0 : Number(text.split(" ")[0])
    must(Number.isInteger(n), `stage row ${i}: could not read a card count out of "${text}"`)
    counts.push(n)
  }
  return counts
}

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
    "00-the-way-in",
    "The way in",
    "/admin/pipeline — the board, with the new entrance to its settings",
    [
      // BELOW the link, not to its left. Task 8 put an "Add someone" button in
      // exactly the gap this marker used to sit in, and the disc landed on top
      // of that button's own label — a callout that covers something else is
      // worse than no callout.
      await markerOn(
        page,
        page.getByRole("link", { name: "Edit stages" }),
        "New. “Edit stages” opens the settings for the board you are looking at — not for whichever board happens to be first.",
        { place: "center", dy: 38 },
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
  const counts = await readCardCounts(page)
  const total = counts.reduce((a, b) => a + b, 0)
  console.log(`  coaching: cards per stage=${counts.join("/")} total=${total}`)
  must(total > 0, "Primary's Coaching board has no cards at all — the tenant cookie did not take")

  await resetScroll(page)
  await shoot(
    page,
    "01-editor",
    "The board editor, as it loads",
    `/admin/pipeline/settings?board=coaching — Primary's real Coaching board, ${total} real cards across its ${rows} stages`,
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
        // Matched on the SHAPE of the phrase, not on a number. The board gains
        // cards; a locator pinned to "7 cards" points at nothing the day it
        // becomes eight, and markerOn would then place the disc at (100, 100).
        cardsCell(page, 0),
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

  // ------------------------------------------------------- 02 mid-reorder
  // A REAL @dnd-kit DRAG, HELD OPEN — not a picture of a finished one. The
  // whole page is made to fit the viewport first, because mouse coordinates
  // are viewport coordinates: with the table below the fold the press lands
  // somewhere else entirely and the drag never starts.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: WIDTH, height: Math.max(1000, pageHeight + 40) })
  await page.waitForTimeout(400)
  await resetScroll(page)

  const handleBox = await page.getByLabel("Drag to reorder stage 2").boundingBox()
  must(handleBox !== null, "the drag handle on stage 2 has no box — the stage table did not render")
  const thirdRowBox = await row(page, 2).boundingBox()
  must(thirdRowBox !== null, "stage row 3 has no box — the stage table did not render")

  const grabX = handleBox.x + handleBox.width / 2
  const grabY = handleBox.y + handleBox.height / 2
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  // In steps, never one jump. @dnd-kit's PointerSensor only starts a drag once
  // the pointer has travelled 4px, and it counts that across real move events.
  await page.mouse.move(grabX, grabY + 14, { steps: 8 })
  await page.mouse.move(grabX, thirdRowBox.y + thirdRowBox.height * 0.55, { steps: 24 })
  await page.waitForTimeout(400)

  // THE EFFECT IS ASSERTED, NOT ASSUMED. @dnd-kit fades the row it is carrying
  // to `opacity-50`. Without this check a drag that never started would be
  // photographed as an ordinary table and captioned as a reorder — which is
  // exactly the silent no-op these scripts are written against.
  const carrying = await row(page, 1).evaluate((el) => el.className.includes("opacity-50"))
  must(carrying, "the drag never started — stage 2's row is not marked as being carried")
  const shifted = await row(page, 2).evaluate((el) => (el.getAttribute("style") ?? "").includes("translate"))
  must(shifted, "the row below did not move out of the way — nothing about this shot would show a reorder")

  await shoot(
    page,
    "02-mid-reorder",
    "Moving a stage, mid-drag",
    "“Consulted” is being carried down past “Won”. Nothing is saved until Save stages is pressed — and this drag was never let go of",
    [
      // Aimed at the row a coach is NOT dragging, so the disc cannot sit on
      // top of the thing the next two captions are about.
      await markerOn(
        page,
        page.getByLabel("Drag to reorder stage 1"),
        "Grab the dots to drag a stage. The arrows beside them do the same thing one step at a time, without a mouse.",
        { place: "left" },
      ),
      // ROW INDEX, NOT SCREEN POSITION. The rows keep their order in the page
      // while a drag is open and are moved by a transform, so row 2 is "Won"
      // — which the drag has pushed UP to second place — and row 1 is
      // "Consulted", which is being carried DOWN to third. boundingBox()
      // follows the transform, so each marker lands where its row now LOOKS.
      // The markers sit out in the right-hand margin: every column in this
      // table already has something in it.
      await markerOn(
        page,
        row(page, 2).getByLabel("Remove stage 3"),
        "The stages below shuffle out of the way as you go, showing where the one you are carrying would land.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        row(page, 1).getByLabel("Remove stage 2"),
        "The stage you have picked up goes faint while you carry it, so you can see which one is moving.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        saveStages(page),
        "The order only becomes real when you press this. Close the page instead and nothing has changed.",
        { place: "after", dx: 10 },
      ),
    ],
    { park: false },
  )

  // Let the drag go, and put the viewport back the way the other shots want it.
  await page.mouse.up()
  await page.setViewportSize({ width: WIDTH, height: 1000 })
  await page.waitForTimeout(300)

  // ------------------------------------------------- 03 the two kinds of refusal
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
    "03-stage-problems",
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

  // ------------------------------------------------- 04 the destination picker
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  await page.getByRole("button", { name: "Remove stage 2" }).click() // Consulted, 2 cards
  await page.waitForTimeout(300)

  // The label names the count, which is not this script's to predict — cards
  // move on and off "Consulted" like any other stage.
  // `cardsPhrase(n).toLowerCase()` builds the middle of this label, so the
  // alternatives are lower-case. A capital "No cards" here matches nothing.
  const picker = page.getByLabel(/^Where should the (no cards|1 card|\d+ cards) on "Consulted" go\?$/)
  if ((await picker.count()) === 0) throw new Error("the destination picker did not appear for a stage holding cards")
  // The sentence the screen itself asks, quoted into the caption band rather
  // than restated. `Where should the 2 cards on "Consulted" go?` is written by
  // the app from live counts; a hand-typed "two" goes stale the first time a
  // card moves.
  const pickerLabel = ((await page.locator('label[for^="destination-"]').first().textContent()) ?? "").trim()
  must(pickerLabel.length > 0, "the destination picker has no label to quote")

  await resetScroll(page)
  await shoot(
    page,
    "04-cards-need-a-home",
    "Taking a stage off a board that still has cards on it",
    `${pickerLabel} — they are moved in the same step that removes the stage, never dropped`,
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

  // ---------------------- 04a a destination that is being removed as well
  // WHOLE-BRANCH REVIEW, IMPORTANT 1. Three clicks used to reach a save the
  // screen let you press and the database then refused with a raw Postgres
  // string: remove a stage that holds cards, send them to another stage, then
  // remove that stage too.
  //
  // CAPTURED ON THE ASSESSMENT BOARD, not Coaching, and that is not
  // arbitrary. The sequence needs a second removable stage that holds NO
  // cards of its own — on Coaching every stage has cards, so removing the
  // destination raises a SECOND, different complaint about ITS cards and the
  // shot stops being about one thing. Assessment's "Assessment Completed" is
  // empty, so the only problem on screen is the one this shot is for.
  await page.goto(`${APP}/admin/pipeline/settings?board=assessment`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  const assessmentCounts = await readCardCounts(page)
  console.log(`  assessment: cards per stage=${assessmentCounts.join("/")}`)
  must(assessmentCounts[0] > 0, "Assessment Booked has no cards — this shot needs a stage whose cards must go somewhere")
  must(assessmentCounts[1] === 0, "Assessment Completed has cards — pick another empty stage or this shot shows two problems")

  await page.getByRole("button", { name: "Remove stage 1" }).click() // Assessment Booked, holds cards
  await page.waitForTimeout(300)
  const doomedPicker = page.getByLabel(/^Where should the (1 card|\d+ cards) on "Assessment Booked" go\?$/)
  must((await doomedPicker.count()) === 1, "the destination picker did not appear for Assessment Booked")
  // Chosen by its visible option text, not by a stage id this script would
  // have to hard-code and keep in step with the clone.
  await doomedPicker.selectOption({ label: "Assessment Completed" })
  await page.waitForTimeout(300)
  must(await saveStages(page).isEnabled(), "Save should be available once a destination is chosen — the control for the click below")

  // Now take the destination away too. Rows have renumbered: what was stage 2
  // is stage 1 now.
  await page.getByRole("button", { name: "Remove stage 1" }).click()
  await page.waitForTimeout(400)

  const doomedText = ((await problemStrip(page).textContent()) ?? "").replace(/\s+/g, " ")
  console.log(`  problem strip: ${doomedText.slice(0, 160)}`)
  must(doomedText.includes("is being removed too"), `expected the doomed-destination refusal, got: ${doomedText.slice(0, 200)}`)
  must(!(await saveStages(page).isEnabled()), "Save should be off while the chosen destination is itself being removed")

  await resetScroll(page)
  await shoot(
    page,
    "04a-the-destination-is-going-too",
    "When the stage you sent the cards to is being removed as well",
    "The screen catches it before you press Save — the cards stay exactly where they are",
    [
      await markerOn(
        page,
        problemStrip(page),
        "It names the stage whose cards you moved, and the stage you moved them to, and asks you to pick one that is staying.",
        { place: "left" },
      ),
      await markerOn(
        page,
        saveStages(page),
        "Save is off. Before this, the save went through to the database and came back as an error nobody could read.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  // ---------------- 04b a kind change that would take finished deals away
  // WHOLE-BRANCH REVIEW, IMPORTANT 2 (controller ruling R19). The board shows
  // a "still open" column only the cards nobody has finished with, so turning
  // Won into a still-open stage takes every settled deal on it off the board
  // — still in the database, still counted in the money, on no screen.
  //
  // REAL CLOSED CARDS, read off the screen first. A Won stage holding nothing
  // would produce this shot with no refusal at all.
  await page.goto(`${APP}/admin/pipeline/settings?board=coaching`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  const wonRowCards = ((await cardsCell(page, 2).first().textContent()) ?? "").trim()
  console.log(`  coaching Won stage: ${wonRowCards}`)
  must(wonRowCards !== "No cards", "the Won stage holds nothing — this shot needs finished deals on it")

  await kindBox(page, 3).selectOption("open")
  await page.waitForTimeout(400)

  const hidden = row(page, 2).getByText(/already won or lost/)
  await hidden.waitFor({ state: "visible", timeout: 5000 })
  console.log(`  row said: ${((await hidden.innerText()) ?? "").replace(/\s+/g, " ").slice(0, 160)}`)
  must(!(await saveStages(page).isEnabled()), "Save should be off while a kind change would hide cards")

  await resetScroll(page)
  await shoot(
    page,
    "04b-that-change-would-hide-finished-deals",
    "Changing what a stage means, under cards that are already finished",
    "Won and Lost columns show every card on them. A still-open column shows only the ones nobody has finished with",
    [
      await markerOn(
        page,
        hidden,
        "It says how many finished deals are on that stage and what would happen to them — they would be on no screen at all.",
        { place: "after", dx: 10 },
      ),
      // AFTER, not left. `place: "left"` put the disc on the grey short-name
      // box two columns over, so the caption "this is the box that caused it"
      // pointed at a box that cannot even be typed in.
      await markerOn(
        page,
        kindBox(page, 3),
        "This is the box that caused it, so the sentence sits on the same line.",
        { place: "after", dx: 8 },
      ),
      await markerOn(
        page,
        saveStages(page),
        "Refused here AND on the server. The screen saying so is a courtesy; the server is the thing that stops it.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  // ------------------------------- 05 the board that will not let itself go
  // THE ONE CLICK IN THIS FILE THAT REALLY SENDS SOMETHING. It is safe because
  // of WHICH board it is aimed at, and nothing else — so which board it is
  // aimed at is proved first, from the screen's own words, before the click.
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  await resetScroll(page)

  // KEYED ON WORDS ONLY THE NOTE SAYS. The server's refusal ends "…so it
  // cannot be archived." too, so a locator built on that phrase matches three
  // elements the moment the refusal appears and the marker goes to whichever
  // is first in the page.
  const defaultNote = page.getByText("This is the board every enquiry lands on", { exact: false })
  must(
    (await defaultNote.count()) === 1,
    "this screen does not say it is the default board — REFUSING to click Archive, because on any other board those two clicks really do archive it",
  )

  await page.getByRole("button", { name: "Archive this board" }).click()
  const confirm = page.getByRole("button", { name: "Yes, archive it" })
  await confirm.waitFor({ state: "visible", timeout: 5000 })
  await confirm.click()

  // Waits for the REFUSAL, not for the clock. A fixed sleep here is what turns
  // "the server said no" and "the server said nothing and archived the board"
  // into the same-looking run.
  const boardCard = page.getByTestId("board-card")
  const archiveRefusal = boardCard.getByRole("alert")
  await archiveRefusal.waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
  const said = (await archiveRefusal.count()) > 0 ? (await archiveRefusal.first().innerText()).trim() : ""
  console.log(`  server said: ${said || "(nothing — NO REFUSAL, THE BOARD MAY HAVE BEEN ARCHIVED)"}`)
  must(
    said.includes("cannot be archived"),
    `expected the default board's refusal and did not get it — said: "${said}"`,
  )

  await resetScroll(page)
  await shoot(
    page,
    "05-cannot-archive-the-default-board",
    "The one board that will not let itself be put away",
    "The Coaching board is where every new enquiry lands when nothing else claims it, so archiving it would send people nowhere",
    [
      await markerOn(
        page,
        defaultNote,
        "You are told before you press anything: this board cannot be archived, and why.",
        { place: "left" },
      ),
      // On the LEFT. The refusal is a full-width paragraph, so "after" puts
      // the disc past the card's own right edge, where annotate() clamps it
      // into the corner of the image.
      await markerOn(
        page,
        archiveRefusal,
        "The server's own answer, word for word. It names the board and says what to do instead — point the default at another board first.",
        { place: "left" },
      ),
      await markerOn(
        page,
        page.getByRole("button", { name: "Archive this board" }),
        "The button is not greyed out on purpose. A button that quietly does nothing tells you nothing; this one answers you.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  // AND THE BOARD IS STILL THERE. The refusal is the server's word for it; the
  // board pill still being on this screen after a reload is the board's own.
  // `listPipelines` is active-only, so an archived Coaching would be gone.
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  const stillThere = await page.getByRole("navigation", { name: "Pipeline boards" }).getByText("Coaching").count()
  must(stillThere === 1, "the Coaching board is no longer on the board switcher — IT MAY HAVE BEEN ARCHIVED")
  console.log("  verified after the fact: the Coaching board is still active")

  console.log(
    "\n  done — no board and no stage was changed. Shots 01-04b are unsaved local state on the real page;" +
      " shot 05's PATCH was refused by the server before it wrote anything.",
  )
} finally {
  await ctx.close()
  await browser.close()
}
