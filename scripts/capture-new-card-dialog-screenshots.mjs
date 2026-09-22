// Drives the REAL app and captures G29 Task 8 — the dialog that puts somebody
// on a pipeline board by hand — with callouts burned into each PNG by
// scripts/_annotate-lib.mjs.
//
//   npx next dev --port 3072                                       # NOT 3050
//   node scripts/capture-new-card-dialog-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE, at /admin/pipeline. Nothing
// is rendered in a harness, a storybook or a scratch page. Structure and
// helpers copied from scripts/capture-pipeline-settings-screenshots.mjs (Task
// 7) — see that file's header for why each helper exists.
//
// PORT IS 3072, DELIBERATELY. Several peer sessions work this same repo and
// any of them may bring up a dev server on 3050 or 3071.
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to choices[0]
// with no cookie, and on this dev clone that is a seeded test business with no
// contacts to search. Every shot here runs against "Primary", whose contact
// spine has the real people below in it.
//
// NOTHING IS CREATED. This is the one capture in this feature that clicks a
// button which POSTs, and it is safe by construction: ANA is a contact who
// ALREADY has an open card on Primary's Coaching board, so the route refuses
// with the duplicate message BEFORE it writes anything (the pre-check runs
// ahead of every write — see createOpportunityManually). The other shots are
// unsaved local React state, discarded by a reload.
//
// ANA IS VERIFIED, NOT ASSUMED. The script re-reads the board and refuses to
// run if her card is not on it, because the difference between "refused" and
// "created a card on a shared dev clone" is one missing row.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3072"
const OUT = "screenshots/new-card-dialog"
const WIDTH = 1440
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

/** A real contact on Primary who ALREADY holds an open card on Coaching. */
const ANA = { term: "sousa", name: "Ana Sousa", stage: "Consulted" }
/** A search that really does return three different people on this clone. */
const MANY = "priya"

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
 * The dialog is `position: fixed`, so these are VIEWPORT shots, not fullPage —
 * a fullPage capture of a fixed overlay puts the overlay at scrollTop 0 and the
 * markers, measured from boundingBox(), somewhere else entirely.
 */
async function shoot(page, name, title, subtitle, markers, { fullPage = false } = {}) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await page.mouse.move(4, 4) // park the pointer, or its hover state lands in the shot
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

const searchBox = (page) => page.getByLabel("Search your contacts")
const addSomeone = (page) => page.getByRole("button", { name: "Add someone", exact: true })
const addToBoard = (page) => page.getByRole("button", { name: /^Add to / })
const results = (page) => page.getByTestId("contact-results")

async function openDialog(page) {
  await addSomeone(page).click()
  await page.waitForTimeout(400)
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)

  // CRITICAL — set the business cookie BEFORE navigating anywhere that reads
  // the tenant. See this file's header.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()
  await page.goto(`${APP}/admin/pipeline?board=coaching`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900) // hydration — a control clicked too early has no handler attached yet

  // POSITIVE EVIDENCE BEFORE THE ONE DESTRUCTIVE-LOOKING BRANCH. Shot 04 posts
  // for real and is only safe because Ana already has a card. If she does not,
  // this run would CREATE one on a shared dev clone.
  const anaCard = page.getByTitle(ANA.name)
  if ((await anaCard.count()) === 0) {
    throw new Error(
      `refusing to run: "${ANA.name}" has no card on Primary's Coaching board, so shot 04 would CREATE one`,
    )
  }
  console.log(`  verified: ${ANA.name} already holds an open card on Coaching`)

  // ------------------------------------------------------- 00 the way in
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.waitForTimeout(200)
  await shoot(
    page,
    "00-the-button",
    "The way in",
    "/admin/pipeline — the board, with the new way to put somebody on it by hand",
    [
      await markerOn(
        page,
        addSomeone(page),
        "New. “Add someone” puts a person on the board you are looking at — someone you met at a camp, or spoke to on the phone.",
        { place: "left" },
      ),
    ],
  )

  // ------------------------------------------------------- 01 the search
  await openDialog(page)
  await searchBox(page).fill(MANY)
  await page.waitForTimeout(1200)
  const rows = await page.locator('[data-testid^="contact-result-"]').count()
  console.log(`  "${MANY}" matched ${rows} contacts`)
  if (rows === 0) throw new Error(`the search for "${MANY}" returned nothing — is the tenant cookie set?`)
  await shoot(
    page,
    "01-searching",
    "Looking somebody up",
    "Type two letters or more and the people you already have appear — real contacts from this business",
    [
      await markerOn(page, searchBox(page), "Search by name, email or phone number.", { place: "after", dx: 10 }),
      await markerOn(
        page,
        results(page),
        "The matches get their own scroll box, so a long list never runs off the bottom of the screen.",
        { place: "after", dx: 10 },
      ),
      await markerOn(
        page,
        page.getByText("No email is sent", { exact: false }),
        "Said up front: adding a card here never emails anyone and never starts a follow-up.",
        { place: "left" },
      ),
    ],
  )

  // ------------------------------------------------- 02 somebody new
  await page.getByRole("button", { name: "Add someone new" }).click()
  await page.waitForTimeout(300)
  await page.getByLabel("Their name").fill("Rosa Delgado")
  await page.getByLabel("Phone number").fill("+61 412 555 019")
  await page.waitForTimeout(200)
  await shoot(
    page,
    "02-somebody-new",
    "Somebody who is not in your contacts yet",
    "Name, plus one way to reach them. A phone number on its own is enough — the email box can stay empty",
    [
      await markerOn(
        page,
        page.getByTestId("new-person-fields"),
        "Filling this in un-picks any contact you had chosen, so you can never send both by mistake.",
        { place: "left" },
      ),
      await markerOn(
        page,
        page.getByText("they are matched to the record you already have", { exact: false }),
        "If this person turns out to already be in your contacts, they are matched to that record instead of added twice.",
        { place: "after", dx: 10 },
      ),
      await markerOn(page, addToBoard(page), "Nothing is sent until you press this.", { place: "after", dx: 10 }),
    ],
  )

  // ------------------------- 03 the refusal that never leaves the browser
  await page.getByLabel("Phone number").fill("")
  await addToBoard(page).click()
  await page.waitForTimeout(400)
  await shoot(
    page,
    "03-needs-a-way-to-reach-them",
    "A new person with no way to reach them",
    "Refused before anything is sent — and the sentence sits under the box it is about",
    [
      await markerOn(
        page,
        page.getByTestId("field-email").getByRole("alert"),
        "An email address or a phone number — one of the two. Said here, next to the boxes, rather than as a message that floats away.",
        { place: "after", dx: 10 },
      ),
    ],
  )

  // ------------------------------- 04 the server's own refusal, verbatim
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  await openDialog(page)
  await searchBox(page).fill(ANA.term)
  await page.waitForTimeout(1200)
  const anaRow = page.locator('[data-testid^="contact-result-"]')
  if ((await anaRow.count()) !== 1) {
    throw new Error(`"${ANA.term}" matched ${await anaRow.count()} contacts; refusing to click a person at random`)
  }
  await anaRow.first().click()

  // EACH STEP ASSERTED, not assumed. A click that silently fails to select
  // leaves the submit button disabled, and Playwright's own click would then
  // wait 30s and time out somewhere unrelated — or worse, a future change
  // makes the same no-op end in a card actually being created. The refusal
  // this shot exists to photograph is only reachable with a contact chosen.
  const chosen = page.getByTestId("chosen-contact")
  await chosen.waitFor({ state: "visible", timeout: 5000 })
  console.log(`  chose: ${(await chosen.innerText()).split("\n")[0]}`)

  const submit = addToBoard(page)
  if (await submit.isDisabled()) throw new Error("the submit button is disabled with a contact chosen")
  await submit.click()
  // Waits for the REFUSAL rather than for the clock. A fixed sleep here is
  // what made the previous failure report as "said nothing" instead of saying
  // which step went wrong.
  await page
    .getByTestId("new-card-refusal")
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {})

  const refusal = page.getByTestId("new-card-refusal")
  const said = (await refusal.count()) > 0 ? (await refusal.first().innerText()).trim() : ""
  console.log(`  server said: ${said || "(nothing — NO REFUSAL, a card may have been created)"}`)
  if (!said.includes("already on")) {
    throw new Error(`expected the duplicate refusal and did not get it — said: "${said}"`)
  }

  await shoot(
    page,
    "04-already-on-the-board",
    "Somebody who is already on this board",
    "The server's own words, printed exactly as it said them — who, which board, and which step they are sitting in",
    [
      await markerOn(
        page,
        refusal,
        "Word for word from the server. It names the person, the board and the step they are already in, so you know where to go and look.",
        { place: "left" },
      ),
      await markerOn(page, page.getByTestId("chosen-contact"), "Your choice is kept — a refusal does not clear it.", {
        place: "after",
        dx: 10,
      }),
    ],
  )

  console.log("\n  done — no card was created; the only POST above was refused before it wrote anything")
} finally {
  await ctx.close()
  await browser.close()
}
