// Drives the REAL app and captures /admin/sequences and /admin/sequences/[key]
// for gap #11 (docs/full-engine-scope-vs-built.md §4) — the on/off switch and
// the step editor task 9/10 shipped — with callouts burned into each PNG by
// scripts/_annotate-lib.mjs.
//
//   npx next dev --port 3070                                       # NOT 3050
//   node scripts/capture-sequence-management-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page. Structure and helpers copied from
// the working reference, scripts/capture-sequence-content-screenshots.mjs —
// see that file's own header for why each helper exists.
//
// PORT IS 3070, DELIBERATELY. Several peer sessions work this same repo and
// any of them may bring up a dev server on the default 3050 at any time.
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to
// choices[0] with no cookie, and on this dev clone that is a seeded test
// business with no sequences at all. Every shot here runs against "Primary"
// (00000000-0000-0000-0000-000000000001).
//
// NO STATE IS LEFT CHANGED. The only network-mutating controls in this
// subsystem are the status switch's PATCH (fired only by the AlertDialog's
// "Switch on" button, which this script never clicks — it always clicks
// Cancel) and the step editor's "Save changes" PUT (which this script also
// never clicks — every editor shot is deliberately unsaved local state, which
// is real React state on the real page, just never written back). A fresh
// page load discards it for free.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3070"
const OUT = "screenshots/sequence-management"
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

/** The rendered extent of an element's TEXT, not the element's own box — see the reference script's own header for the bug this avoids. */
async function textBox(locator) {
  const handle = await locator.first().elementHandle()
  if (!handle) return null
  return handle.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = Array.from(range.getClientRects())
    if (rects.length === 0) return null
    const x0 = Math.min(...rects.map((r) => r.x))
    const y0 = Math.min(...rects.map((r) => r.y))
    const x1 = Math.max(...rects.map((r) => r.x + r.width))
    const y1 = Math.max(...rects.map((r) => r.y + r.height))
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  })
}

/** Marker positioned on a real element. Warns loudly rather than degrading politely. */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", tight = false } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) {
    console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  }
  const box = tight ? await textBox(locator) : await locator.first().boundingBox()
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

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await page.mouse.move(4, 4) // park the pointer — see this file's header
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

/** select[aria-label=…] — every select in StepEditor.tsx carries one. */
function selectByLabel(page, label) {
  return page.locator(`select[aria-label="${label}"]`)
}

/**
 * The real "fix this before you can save" banner, excluding Next.js's own
 * route announcer (`#__next-route-announcer__`) — an invisible `role="alert"`
 * live region present on every page for screen readers. `page.getByRole("alert")`
 * matches BOTH; `.first()` inside markerOn() silently picked the announcer in
 * an early draft of this script, landing the marker near the top of the
 * sidebar instead of on the actual red box.
 */
function problemBanner(page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)')
}

/**
 * Reset scroll to the very top before measuring ANY marker position.
 *
 * Every `.fill()` / `.selectOption()` / `.click()` above scrolls its own
 * target into view as part of Playwright's actionability checks. On an
 * 8-step editor that leaves the document scrolled to wherever the LAST
 * interaction happened, and `locator.boundingBox()` returns VIEWPORT-relative
 * coordinates — for an element now scrolled above that viewport, that is a
 * small or negative number, which annotate() then clamps to the top of the
 * image. `page.screenshot({fullPage:true})` itself scrolls to the top before
 * capturing, so every marker must be measured from that same scrollTop:0
 * frame or its position and the screenshot disagree about where (0,0) is.
 * Caught by opening 03/04's first draft: three of four markers landed
 * stacked at the very top of a 6000px-tall image instead of on their real
 * targets.
 */
async function resetScroll(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.waitForTimeout(200)
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)

  // CRITICAL — set the business cookie BEFORE navigating anywhere that reads
  // the tenant. See this file's header.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()

  // ---------------------------------------------------------------- 01 list
  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900) // hydration — a switch clicked too early has no handler attached yet

  const rowCount = await page.locator("tbody tr").count()
  console.log(`  list: rows=${rowCount}`)
  if (rowCount !== 12) {
    throw new Error(
      `expected 12 sequence rows on Primary (migrations 00255/00256 applied), got rows=${rowCount} — the tenant cookie did not take, or the migration is not on this env`,
    )
  }

  const coldRow = page.locator("tbody tr", { hasText: "Cold Lead Re-engagement" })
  const abandonedRow = page.locator("tbody tr", { hasText: "Abandoned checkout" })
  const aspiringRow = page.locator("tbody tr", { hasText: "Quiz — Aspiring Pro" })
  console.log(
    `  rows found: cold=${await coldRow.count()} abandoned=${await abandonedRow.count()} aspiring=${await aspiringRow.count()}`,
  )

  const coldSwitch = coldRow.getByRole("switch")
  const abandonedSwitch = abandonedRow.getByRole("switch")
  const aspiringWhyEmpty = aspiringRow.getByText("Switched off, so nobody is being added and nobody is moving through it.")

  await resetScroll(page)
  await shoot(
    page,
    "01-list-on-off-switch-column",
    "Every sequence now has an on/off switch — no more scripts to flip one on",
    "/admin/sequences",
    [
      await markerOn(page, coldSwitch, "Already ON. This one has 2 people entered, 1 still moving through it, 1 booked a call.", {
        place: "center",
        dy: -20,
      }),
      await markerOn(page, abandonedSwitch, "OFF. Since migration 00256, off stops EVERYONE inside a sequence, not just new arrivals.", {
        place: "center",
        dy: -20,
      }),
      await markerOn(
        page,
        aspiringWhyEmpty,
        "The words back up the switch: paused genuinely means nobody is moving, not just nobody new.",
        { place: "left", tight: true },
      ),
    ],
  )

  // --------------------------------------------------- 02 confirm dialog
  // Turning ON asks first (SequenceSwitch.tsx's own header explains why). We
  // click the switch to raise the dialog, screenshot it, then Cancel — no
  // PATCH is ever sent, so "service_application_received" stays exactly as it
  // was (draft) the whole time.
  const serviceRow = page.locator("tbody tr", { hasText: "Service application received" })
  const serviceSwitch = serviceRow.getByRole("switch")
  await serviceSwitch.waitFor({ state: "visible" })
  await serviceSwitch.click()

  const dialog = page.getByRole("alertdialog")
  await dialog.waitFor({ state: "visible" })
  await page.waitForTimeout(300)

  // Curly quotes, not straight ones — the JSX literal is `&ldquo;…&rdquo;` —
  // so these target the stable `data-slot` Radix attaches instead of matching
  // on text. An earlier draft matched on the straight-quote string and found
  // nothing, landing that marker at the (100,100) fallback in the sidebar.
  const dialogTitle = dialog.locator('[data-slot="alert-dialog-title"]')
  const dialogDescription = dialog.locator('[data-slot="alert-dialog-description"]')

  // The switch that raised this dialog is near the bottom of a 12-row table,
  // so clicking it scrolled the page. The dialog itself is `position: fixed`
  // (viewport-relative, unaffected by scroll) but the SIDEBAR is fixed too —
  // a fullPage capture taken at a nonzero scrollTop paints a fixed sidebar at
  // that scrolled offset instead of at the top of the image. Reset before
  // measuring or shooting.
  await resetScroll(page)
  await shoot(
    page,
    "02-confirm-dialog-turning-on",
    "Turning a sequence ON asks first — turning one off never does",
    "/admin/sequences",
    [
      await markerOn(page, dialogTitle, "Real emails and texts start the moment somebody fills in a form — worth a confirmation.", {
        place: "left",
        tight: true,
      }),
      await markerOn(
        page,
        dialogDescription,
        "It also explains why: anyone partway through when it was switched off picks back up here too — possibly within minutes.",
        { place: "center" },
      ),
    ],
  )

  await dialog.getByRole("button", { name: "Cancel" }).click()
  await dialog.waitFor({ state: "hidden" })

  // ------------------------------------------- 03 eight step kinds, one editor
  // new_lead_nurture: draft, 0 runs, so nothing here can be sent to a real
  // person and nothing is saved — every edit below is local React state,
  // discarded the moment the page is next loaded.
  await page.goto(`${APP}/admin/sequences/new_lead_nurture`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  const addStepButton = page.getByRole("button", { name: "Add a step", exact: true })
  await addStepButton.waitFor({ state: "visible" })

  // Add step 7 (sms) and step 8 (alert) so all eight kinds are represented.
  await selectByLabel(page, "Kind of step to add").selectOption({ label: "Send a text" })
  await addStepButton.click()
  await page.waitForTimeout(200)
  const step6 = page.locator('[data-testid="step-6"]')
  await step6.getByLabel("What the text says").fill("Following up — got a minute to talk today?")

  await selectByLabel(page, "Kind of step to add").selectOption({ label: "Tell the coach" })
  await addStepButton.click()
  await page.waitForTimeout(200)
  const step7 = page.locator('[data-testid="step-7"]')
  await step7.getByLabel(/Subject line/).fill("Cold lead reached the end of New Lead Nurture")
  await step7
    .getByLabel(/What to tell the coach/)
    .fill("This person has been through the whole sequence without booking — worth a personal follow-up.")

  // Turn step 3 into a branch, step 4 into a tag, step 5 into a stage.
  await selectByLabel(page, "Step 3 kind").selectOption({ label: "Split the path" })
  await page.waitForTimeout(200)
  await selectByLabel(page, "Step 3 split rule").selectOption({ label: "Has a phone number" })
  await selectByLabel(page, "Step 3 if yes go to").selectOption({ label: "Step 7: Send a text" })

  await selectByLabel(page, "Step 4 kind").selectOption({ label: "Add a label" })
  await page.waitForTimeout(200)
  const step3 = page.locator('[data-testid="step-3"]')
  await step3.getByLabel("The label to add").fill("Warmed up")

  await selectByLabel(page, "Step 5 kind").selectOption({ label: "Move their card" })
  await page.waitForTimeout(200)
  const step4 = page.locator('[data-testid="step-4"]')
  await step4.getByLabel("Move their card to").fill("consult_booked")

  await page.waitForTimeout(300)
  const errorCount = await problemBanner(page).count()
  console.log(`  eight-kinds editor: validation banners=${errorCount} (expect 0 — every field above was filled in)`)

  await resetScroll(page)
  await shoot(
    page,
    "03-eight-step-kinds-one-editor",
    "All eight step kinds, each editable on this one screen",
    "/admin/sequences/new_lead_nurture",
    [
      await markerOn(page, selectByLabel(page, "Step 3 kind"), "Split the path — the existing branch machinery, still here.", {
        place: "right",
      }),
      await markerOn(
        page,
        step3.getByLabel("The label to add"),
        "Add a label — a `tag` step. Nothing in the product could write one without a script before this editor.",
        { place: "left", dx: -10 },
      ),
      await markerOn(
        page,
        step4.getByLabel("Move their card to"),
        "Move their card — a `stage` step, the same story: no writer existed until now.",
        { place: "left", dx: -10 },
      ),
      await markerOn(page, selectByLabel(page, "Step 8 kind"), "Tell the coach — the eighth and last kind.", {
        place: "right",
      }),
    ],
  )

  // ------------------------------------------- 04 adding a tag step, live
  // service_application_received: draft, 0 runs — a fresh page load below
  // discards this too.
  await page.goto(`${APP}/admin/sequences/service_application_received`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  const addStepButton2 = page.getByRole("button", { name: "Add a step", exact: true })
  await addStepButton2.waitFor({ state: "visible" })
  await selectByLabel(page, "Kind of step to add").selectOption({ label: "Add a label" })
  await addStepButton2.click()
  await page.waitForTimeout(300)

  const newTagStep = page.locator('[data-testid="step-6"]')
  await newTagStep.getByLabel("The label to add").fill("Application reviewed")
  await page.waitForTimeout(200)

  await resetScroll(page)
  await shoot(
    page,
    "04-adding-a-label-step",
    'Adding "Add a label" — a step kind nothing in the product could create before',
    "/admin/sequences/service_application_received",
    [
      await markerOn(page, selectByLabel(page, "Kind of step to add"), "Pick it from the same list as any other step kind…", {
        place: "left",
        dx: -10,
      }),
      await markerOn(page, selectByLabel(page, "Step 7 kind"), "…click Add a step, and there it is: a real tag step, Step 7.", {
        place: "right",
      }),
      await markerOn(
        page,
        newTagStep.getByLabel("The label to add"),
        "The label itself — plain text. No config file, no migration, no script.",
        { place: "left", dx: -10 },
      ),
    ],
  )

  // --------------------------------------------- 05 a validation problem
  // abandoned_checkout's branch step already ships with two DIFFERENT
  // endings (the sms side ends at its own "stop", the email side at another).
  // Redirecting "if no" onto a step the "if yes" side already flows into
  // recreates, on purpose, the exact class of mistake this file's sibling
  // (lib/lead-engine/step-list.ts) was written to catch — see that file's own
  // header for the migration-00255 spec bug it describes.
  await page.goto(`${APP}/admin/sequences/abandoned_checkout`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  const ifNoSelect = selectByLabel(page, "Step 4 if no go to")
  await ifNoSelect.waitFor({ state: "visible" })
  await ifNoSelect.selectOption({ label: "Step 6: End here" })
  await page.waitForTimeout(300)

  const problemCount = await problemBanner(page).count()
  console.log(`  validation demo: banners=${problemCount} (expect 1)`)
  if (problemCount !== 1) {
    console.warn("  !! expected exactly one validation banner — check the screenshot")
  }

  const saveButton = page.getByRole("button", { name: /Saving…|Save changes/ })

  await resetScroll(page)
  await shoot(
    page,
    "05-validation-problem-shown",
    "A split whose sides run into each other is caught before it can be saved",
    "/admin/sequences/abandoned_checkout",
    [
      await markerOn(page, ifNoSelect, 'Changed "if no" to Step 6 — which the "if yes" side already flows into, two steps later.', {
        place: "right",
      }),
      await markerOn(
        page,
        problemBanner(page),
        "“One side of this split runs on into the other, so the same person would get both endings.” Nothing has been written yet.",
        { place: "left", dx: -10 },
      ),
      await markerOn(page, saveButton, "Save stays disabled while any problem is listed above.", { place: "left", dx: -10 }),
    ],
  )

  // --------------------------------------------- 06 partway-through summary
  // cold_lead_re_engagement is genuinely active with one real in-progress
  // run — no edits made here, nothing to undo. The box appears purely from
  // having an active run; it is not conditioned on making a change first.
  await page.goto(`${APP}/admin/sequences/cold_lead_re_engagement`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  const partwayBox = page.getByText(/partway through/)
  const partwayCount = await partwayBox.count()
  console.log(`  partway-through: banners=${partwayCount} (expect 1)`)
  if (partwayCount !== 1) {
    throw new Error(
      `expected the partway-through summary on cold_lead_re_engagement (it has one active run on Primary), got count=${partwayCount} — either the active run is gone or the summary only renders after an edit`,
    )
  }

  const stillGoingTile = page.locator("div.rounded-xl.border.border-border.bg-white.p-4.shadow-sm", { hasText: "Still going" })

  await shoot(
    page,
    "06-partway-through-summary",
    "Before you can save, it says what happens to the person already partway through",
    "/admin/sequences/cold_lead_re_engagement",
    [
      await markerOn(page, partwayBox, "This appears just from having one real person mid-sequence — no edit needed to see it.", {
        place: "left",
        tight: true,
        dx: -10,
      }),
      await markerOn(page, stillGoingTile, "The same person: this sequence's only “still going” entry.", {
        place: "center",
        dy: -14,
      }),
    ],
  )

  console.log("\ndone.")
} finally {
  await ctx.close()
  await browser.close()
}
