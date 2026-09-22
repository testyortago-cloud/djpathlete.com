// Drives the REAL app and puts four people on three REAL pipeline boards BY
// HAND, through the dialog a coach uses — then photographs the board they
// landed on.
//
//   npx next dev --port 3073                                       # NOT 3050
//   node scripts/capture-g29-hand-made-cards.mjs
//
// THIS ONE REALLY WRITES, and that is the point of it. Its two siblings
// (capture-pipeline-settings-screenshots.mjs, capture-new-card-dialog-screenshots.mjs)
// are careful to change nothing; this script exists because a fixture proves
// RENDER, not ORIGINATION. Every card below is created by clicking "Add
// someone", typing into the real search box and pressing the real submit
// button against POST /api/admin/pipeline/opportunities. Nothing is INSERTed.
//
// WHAT IT CREATES (dev clone only — see DEV_REF):
//
//   coaching       Consult Booked      Maya Sorensen    (existing contact)
//   assessment     Assessment Booked   Noor Haddad      (existing contact)
//   camps_clinics  Interested          Marcus Ferreira  (existing contact)
//   camps_clinics  Interested          Talia Moreau     (a brand-new person)
//
// The three named contacts already exist on Primary and hold no open card on
// any board; Talia Moreau exists nowhere and is created through the dialog's
// own "Add someone new" branch, which is the half of the feature an existing
// contact cannot exercise.
//
// EVERY STEP IS ASSERTED, AND SAYS WHICH ONE FAILED. Each creation is
// confirmed by the card appearing on the board afterwards. A helper that
// degrades politely turns a broken effect into a silent no-op, and in a script
// that writes to a shared database a silent no-op is one change away from a
// write nobody notices — so every step below throws and names itself.
//
// RE-RUNNABLE, AND HONEST ABOUT IT. A second run finds the cards its first run
// made. It does NOT refuse — shot 11 has to stay re-capturable without going
// and finding four more people — but it prints `ALREADY ON THIS BOARD (this
// run did not create it)` for each one it skipped, so a run that originated
// nothing can never be read as a run that originated four.
//
// NOTHING IS DELETED AFTERWARDS. Shot 11 has to show a board with real
// hand-made cards on it, and a board emptied again cannot be re-photographed.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.
//
// PORT IS 3073, DELIBERATELY. Peer sessions work this same repo and may hold
// 3050, 3071 or 3072.

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

/**
 * One entry per card to file. `term` is typed into the real search box; the
 * script refuses to continue unless it matches exactly one person, because
 * clicking a row at random on a shared clone files the wrong human.
 */
const SUBJECTS = [
  { board: "coaching", boardName: "Coaching", stage: "Consult Booked", term: "sorensen", name: "Maya Sorensen" },
  { board: "assessment", boardName: "Assessment", stage: "Assessment Booked", term: "haddad", name: "Noor Haddad" },
  {
    board: "camps_clinics",
    boardName: "Camps & Clinics",
    stage: "Interested",
    term: "ferreira",
    name: "Marcus Ferreira",
  },
  {
    board: "camps_clinics",
    boardName: "Camps & Clinics",
    stage: "Interested",
    newPerson: { name: "Talia Moreau", phone: "+61 412 887 304" },
    name: "Talia Moreau",
  },
]

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

function must(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

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

async function shoot(page, name, title, subtitle, markers, { fullPage = true } = {}) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await page.mouse.move(4, 4) // park the pointer, or its hover state lands in the shot
  await page.waitForTimeout(150)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
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

const addSomeone = (page) => page.getByRole("button", { name: "Add someone", exact: true })
const addToBoard = (page) => page.getByRole("button", { name: /^Add to / })
const searchBox = (page) => page.getByLabel("Search your contacts")
const refusal = (page) => page.getByTestId("new-card-refusal")

/** Puts one person on one board, through the dialog, asserting every step. */
async function fileOneCard(page, subject) {
  const where = `${subject.name} -> ${subject.board}`
  await page.goto(`${APP}/admin/pipeline?board=${subject.board}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900) // hydration — a control clicked too early has no handler attached yet

  // BEFORE-STATE, READ AND REPORTED. Filing somebody who is already here is
  // exactly what the duplicate refusal is for, so there is nothing to protect
  // against — but a run that CREATED nothing must never read like a run that
  // created four.
  if ((await page.getByTitle(subject.name).count()) > 0) {
    console.log(`  ALREADY ON THIS BOARD (this run did not create it): ${subject.name} -> ${subject.boardName}`)
    return false
  }

  await addSomeone(page).click()
  await page.getByTestId("new-card-form").waitFor({ state: "visible", timeout: 5000 })

  if (subject.newPerson) {
    await page.getByRole("button", { name: "Add someone new" }).click()
    await page.getByTestId("new-person-fields").waitFor({ state: "visible", timeout: 5000 })
    await page.getByLabel("Their name").fill(subject.newPerson.name)
    await page.getByLabel("Phone number").fill(subject.newPerson.phone)
  } else {
    await searchBox(page).fill(subject.term)
    await page.waitForTimeout(1200)
    const rows = page.locator('[data-testid^="contact-result-"]')
    const n = await rows.count()
    must(n === 1, `${where}: "${subject.term}" matched ${n} contacts; refusing to click a person at random`)
    await rows.first().click()
    const chosen = page.getByTestId("chosen-contact")
    await chosen.waitFor({ state: "visible", timeout: 5000 })
    const chosenName = (await chosen.innerText()).split("\n")[0].trim()
    must(chosenName === subject.name, `${where}: the dialog says it chose "${chosenName}", not "${subject.name}"`)
  }

  const submit = addToBoard(page)
  must(!(await submit.isDisabled()), `${where}: the submit button is disabled with a person chosen`)
  await submit.click()

  // The dialog closes only on success. Race the close against the refusal so a
  // server refusal is REPORTED rather than timing out somewhere unrelated.
  await Promise.race([
    page.getByTestId("new-card-form").waitFor({ state: "detached", timeout: 15000 }),
    refusal(page).waitFor({ state: "visible", timeout: 15000 }),
  ]).catch(() => {})
  const said = (await refusal(page).count()) > 0 ? (await refusal(page).first().innerText()).trim() : ""
  must(said === "", `${where}: the server refused — "${said}"`)
  must((await page.getByTestId("new-card-form").count()) === 0, `${where}: the dialog never closed`)

  // AFTER-STATE, ASSERTED ON THE BOARD ITSELF, not on the absence of an error.
  await page.waitForTimeout(1200) // router.refresh()
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(700)
  must(
    (await page.getByTitle(subject.name).count()) === 1,
    `${where}: no card for this person is on the board after the submit`,
  )
  console.log(`  FILED BY THIS RUN: ${subject.name} -> ${subject.boardName} / ${subject.stage}`)
  return true
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)

  // CRITICAL — the business cookie before anything that reads the tenant.
  // resolveAdminTenant() falls back to choices[0] without it, and on this dev
  // clone that is a seeded test business with no contacts to search.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()
  let created = 0
  for (const subject of SUBJECTS) if (await fileOneCard(page, subject)) created += 1

  // ------------------------------------------- 11 the board they landed on
  await page.goto(`${APP}/admin/pipeline?board=camps_clinics`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.waitForTimeout(200)

  const marcus = page.getByTitle("Marcus Ferreira")
  const talia = page.getByTitle("Talia Moreau")
  must(
    (await marcus.count()) === 1 && (await talia.count()) === 1,
    "shot 11: the two hand-made cards are not both on the board",
  )

  await shoot(
    page,
    "11-hand-made-cards",
    "Two people put on this board by hand",
    "/admin/pipeline?board=camps_clinics — Marcus was already in the contacts; Talia was typed in from scratch. Neither was emailed",
    [
      await markerOn(page, addSomeone(page), "The button both of the new cards came through.", { place: "left" }),
      await markerOn(
        page,
        // `exact: true` — the board's own blurb says the word "Interested"
        // nowhere, but a substring match would also take "Interested" inside a
        // longer future heading and put the marker on the wrong thing.
        page.getByText("Interested", { exact: true }),
        "Both land in the first step on this board — “Interested” — and the number beside it counts them. Nobody was emailed and no follow-up was started.",
        { place: "left" },
      ),
      await markerOn(
        page,
        marcus,
        "Marcus was picked out of the contacts already on file, so there is one record of him and not two.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        talia,
        "Talia was typed straight in: a name and a phone number. She was not in the contacts before this, and she is now. Both say “Entered today”.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  console.log(`\n  done — ${created} card(s) created THROUGH THE DIALOG by this run; none were deleted afterwards`)
} finally {
  await ctx.close()
  await browser.close()
}
