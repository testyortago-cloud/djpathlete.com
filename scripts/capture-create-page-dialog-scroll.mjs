// Drives the REAL app and captures the REAL "New landing page" dialog on the
// REAL /admin/pages board, at a laptop-height viewport — the condition under
// which "Create & build" fell off the bottom of the screen with nothing to
// scroll (a modal locks body scroll, so the page behind it does not move).
//
//   npm run dev                                         # port 3050
//   node scripts/capture-create-page-dialog-scroll.mjs
//
// Nothing here is a harness, a storybook or a scratch mount: it signs in,
// lands on /admin/pages, clicks the real trigger button and photographs the
// real dialog.
//
// BEFORE/AFTER. The "before" pass restores the pre-fix classes on the real
// dialog node (no max-height, no scrolling row) so the two shots differ by
// exactly the change under test and nothing else.
//
// TENANT COOKIE IS LOAD-BEARING — with no djp_business cookie
// resolveAdminTenant() falls back to choices[0], which on this dev clone is a
// seeded business with no pages, and an empty board reads as a broken screen.
//
// LIGHT ONLY: the admin components were never built against the `.dark` class
// variant, so there is no second rendering to capture.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/create-page-dialog-scroll"
const WIDTH = 1440
const HEIGHT = 720 // a laptop viewport; the bug needs a short one to show
const DSF = 2 // annotate() places markers in RAW pixels
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
}

/**
 * Marker positioned on a real element, converted from CSS px to raw pixels.
 * WARNS LOUDLY rather than degrading politely — a quiet default turns a
 * misplaced callout into a silent no-op and the reviewer reads a caption
 * pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
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
          : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  // Viewport-only, NOT fullPage: the whole point is what fits on the screen.
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  // Assert the session BEFORE anything else: a refused login reports
  // downstream as a feature failure that mimics the real bug.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

/** Open the real dialog from the real board and report what is reachable. */
async function openDialog(page) {
  await page.goto(`${APP}/admin/pages`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const trigger = page.getByRole("button", { name: "New landing page", exact: true })
  await trigger.waitFor({ state: "visible", timeout: 20000 })
  await trigger.click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible", timeout: 10000 })
  await page.waitForTimeout(600) // let the open animation settle
  // Real typed values — placeholders are ghosts, and an empty form is not the
  // state an owner actually meets this dialog in.
  await page.getByLabel("Name").fill("Return-to-Sport Screening")
  await page.getByRole("radio", { name: "Book a consult" }).click()
  await page.getByLabel("Who is this for?").fill("Parents of high-school athletes just discharged from rehab")
  await page
    .getByLabel("Describe it")
    .fill(
      "Being discharged from rehab is a milestone, but it does not answer whether you are ready for the speed and change of direction your sport demands.",
    )
  await page.evaluate(() => {
    const fields = document.querySelector('[data-slot="dialog-content"] .overflow-y-auto')
    if (fields) fields.scrollTop = 0 // filling the last field scrolled the row
  })
  // Park the pointer: Playwright's mouse stays where it last clicked, and a
  // hovered trigger reads as a styling bug that is not there.
  await page.mouse.move(4, 4)
  await page.waitForTimeout(150)
  return dialog
}

/** Is the button's box inside the viewport, and does anything actually scroll? */
async function report(page, label) {
  const btn = page.getByRole("button", { name: "Create & build" })
  const box = await btn.boundingBox()
  const vh = page.viewportSize().height
  const scrollable = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="dialog-content"]')
    if (!el) return null
    const rows = [el, ...Array.from(el.querySelectorAll("div"))]
    const s = rows.filter((n) => n.scrollHeight - n.clientHeight > 4)
    return { anyScrollableRow: s.length > 0, contentH: Math.round(el.getBoundingClientRect().height) }
  })
  const visible = box ? box.y >= 0 && box.y + box.height <= vh : false
  console.log(
    `  [${label}] viewport ${vh}px · dialog ${scrollable?.contentH}px · button y=${box ? Math.round(box.y) : "n/a"}..${box ? Math.round(box.y + box.height) : "n/a"} · on screen: ${visible} · a row scrolls: ${scrollable?.anyScrollableRow}`,
  )
  return { visible, ...scrollable }
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)
  // CRITICAL — set the business cookie BEFORE navigating anywhere that reads
  // the tenant, or the board renders another business's (empty) list.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()

  // ---- BEFORE: put the pre-fix classes back on the real dialog node --------
  await openDialog(page)
  await page.evaluate(() => {
    const el = document.querySelector('[data-slot="dialog-content"]')
    el.classList.remove("max-h-[90vh]", "grid-rows-[auto_auto_minmax(0,1fr)_auto]")
    const fields = el.querySelector(".overflow-y-auto")
    if (!fields) throw new Error("pre-fix restore found no scrolling row — did the fix change shape?")
    fields.classList.remove("overflow-y-auto", "-mx-6", "px-6", "min-h-0")
  })
  await page.waitForTimeout(250)
  const before = await report(page, "before")
  await shoot(
    page,
    "01-before-button-off-screen",
    "BEFORE — “Create & build” is off the bottom and nothing scrolls",
    `The real dialog on /admin/pages at ${WIDTH}x${HEIGHT}. It is taller than the screen, and a modal locks the page behind it.`,
    [
      await markerOn(
        page,
        page.getByRole("dialog"),
        "The dialog is centred and uncapped, so it overflows the screen top AND bottom.",
        { place: "left", dy: -140 },
      ),
      await markerOn(
        page,
        page.getByLabel("Describe it"),
        "The last field visible. Below this: the Cancel and “Create & build” buttons — off screen.",
        { place: "after", dx: 40 },
      ),
    ],
  )

  // ---- AFTER: reload so the real, shipped classes are back ----------------
  await openDialog(page)
  const after = await report(page, "after")
  await shoot(
    page,
    "02-after-footer-pinned",
    "AFTER — the dialog is capped and “Create & build” is always on screen",
    "Same route, same dialog, same viewport. Capped at 90% of the screen height, with the fields as the one scrolling row.",
    [
      await markerOn(
        page,
        page.getByRole("button", { name: "Create & build" }),
        "“Create & build” is on screen the moment the dialog opens — no scrolling needed to reach it.",
        { place: "after", dx: 40 },
      ),
      await markerOn(
        page,
        page.getByLabel("Name"),
        "The fields are the only part that scrolls — everything below them stays put.",
        { place: "left", dx: -20 },
      ),
    ],
  )

  // ---- AFTER, scrolled: prove the fields move and the footer does not -----
  await page.evaluate(() => {
    const el = document.querySelector('[data-slot="dialog-content"]')
    const fields = el.querySelector(".overflow-y-auto")
    fields.scrollTop = fields.scrollHeight
  })
  await page.waitForTimeout(300)
  const scrolled = await report(page, "after-scrolled")
  await shoot(
    page,
    "03-after-scrolled-to-bottom",
    "AFTER — scrolled to the last field, with the buttons still there",
    "The fields have been scrolled to the bottom. “Describe it” is fully readable and the footer has not moved.",
    [
      await markerOn(page, page.getByLabel("Describe it"), "The last field, scrolled into view inside the dialog.", {
        place: "left",
        dx: -20,
      }),
      await markerOn(
        page,
        page.getByRole("button", { name: "Create & build" }),
        "Still exactly where it was — the footer is a fixed row, not part of the scrolling area.",
        { place: "after", dx: 40 },
      ),
    ],
  )

  console.log("\n  VERDICT")
  console.log(`   before: button on screen = ${before.visible}, a row scrolls = ${before.anyScrollableRow}`)
  console.log(`   after:  button on screen = ${after.visible}, a row scrolls = ${after.anyScrollableRow}`)
  console.log(`   after scrolled to bottom: button still on screen = ${scrolled.visible}`)
  if (before.visible || !after.visible || !scrolled.visible) {
    throw new Error("the shots do not demonstrate the fix — read the numbers above")
  }
} finally {
  await ctx.close()
  await browser.close()
}
