// Drives the REAL admin app on PRODUCTION (https://www.darrenjpaul.com) and
// captures /admin/sequences and /admin/sequences/<key> for gap #11, with the
// callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   node --env-file=.env.prod scripts/capture-sequence-management-prod.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE, on production. Nothing is
// rendered in a harness, a storybook or a scratch page.
//
// ────────────────────────────────────────────────────────────────────────────
// STRICTLY READ-ONLY. THIS SCRIPT CLICKS NO SWITCH, EVER.
//
// The dev-clone sibling of this script clicks a switch and then Cancel, which
// is safe THERE for one reason only: on a sequence that is OFF, the switch
// opens an AlertDialog first. That is not symmetric. Read
// SequenceSwitch.tsx's `requestToggle` — turning a sequence ON confirms, but
// turning one OFF fires `applyToggle(false)` STRAIGHT AWAY with no dialog
// (unless the step editor happens to be dirty). So on production a stray
// click on either of the two ACTIVE sequences would switch it off for real,
// with nothing to cancel.
//
// Activating a sequence sends real email to real members of the public and is
// the owner's decision alone. Deactivating one is equally not mine to make.
// Therefore: no switch is clicked, no dialog is opened, no form is saved.
// The only interactions below are navigation and scrolling.
// ────────────────────────────────────────────────────────────────────────────
//
// SESSION IS ASSERTED FIRST, BEFORE ANY SCREEN IS JUDGED. A minted admin JWT
// is short-lived, and when it expires the admin routes redirect to /login — a
// harness without this check happily photographs the login page and reports a
// feature failure. First navigation is /api/auth/session and it fails loudly.
//
// PRODUCTION ONLY, and it refuses any other Supabase project ref outright, so
// it cannot be pointed at the dev clone by accident.
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`.

import { mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { encode } from "next-auth/jwt"
import { annotate } from "./_annotate-lib.mjs"

const PROD_REF = "epzuvzkokzqtzomeyoha"
const APP = process.env.APP ?? "https://www.darrenjpaul.com"
const OUT = "screenshots/sequence-management-prod"
const WIDTH = 1440
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const ADMIN_EMAIL = "admin@darrenjpaul.com"

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== PROD_REF) throw new Error(`PRODUCTION ONLY; refusing — env points at ${ref}`)

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

/** The rendered extent of an element's TEXT, not its box — a `py-12` cell is far taller than its line. */
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

/** Marker on a real element. Warns LOUDLY rather than degrading politely. */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", tight = false } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
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

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

/**
 * Reset scroll to the very top and let it settle BEFORE any fullPage capture.
 * A `position: fixed` sidebar is painted at the SCROLLED offset in a fullPage
 * screenshot, so a capture taken after scrolling paints the sidebar halfway
 * down the image, on top of the content.
 */
async function toTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await toTop(page)
  await page.mouse.move(4, 4) // park the pointer; it stays where it last moved
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage: true })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function main() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET missing from .env.prod")

  const token = await encode({
    secret,
    salt: "__Secure-authjs.session-token",
    token: { id: ADMIN_ID, sub: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", name: "Darren Paul" },
  })

  const browser = await launchChromium()
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: 1000 },
    deviceScaleFactor: DSF,
    colorScheme: "light",
  })
  // Production is HTTPS, so Auth.js prefixes the cookie __Secure- and marks it secure.
  await ctx.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: token,
      domain: ".darrenjpaul.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ])

  const page = await ctx.newPage()

  // ── Session assertion FIRST. Fail loudly, before judging any screen. ──
  await page.goto(`${APP}/api/auth/session`, { waitUntil: "domcontentloaded" })
  const sessionText = await page.locator("body").innerText()
  let session
  try {
    session = JSON.parse(sessionText)
  } catch {
    throw new Error(`/api/auth/session did not return JSON. Got: ${sessionText.slice(0, 200)}`)
  }
  if (session?.user?.role !== "admin") {
    throw new Error(`SESSION NOT ADMIN — refusing to photograph anything. Body: ${sessionText.slice(0, 300)}`)
  }
  console.log(`  session OK: ${session.user.email} / role=${session.user.role}`)

  // ── Shot 1: the list ──
  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
  if (!page.url().includes("/admin/sequences")) {
    throw new Error(`redirected away from /admin/sequences — now at ${page.url()}`)
  }
  await page.waitForTimeout(1200)

  const offSentence = page.getByText("Switched off, so nobody is being added and nobody is moving through it.")
  const offCount = await offSentence.count()
  console.log(`  "Switched off, so nobody…" sentences on the list: ${offCount}`)

  const switches = page.locator('[role="switch"]')
  const switchCount = await switches.count()
  const switchStates = await switches.evaluateAll((els) =>
    els.map((e) => ({ label: e.getAttribute("aria-label"), checked: e.getAttribute("aria-checked") }))
  )
  console.log(`  switches on the list: ${switchCount}`)
  for (const s of switchStates) console.log(`    ${s.checked === "true" ? "ON " : "OFF"}  ${s.label}`)

  // Measured, not eyeballed — the caption below asserts these numbers.
  const turnedOff = await page.getByText("Turned off", { exact: true }).count()
  const neverOn = await page.getByText("Never turned on", { exact: true }).count()
  const onBadges = await page.getByText("On", { exact: true }).count()
  const offSwitches = switchStates.filter((s) => s.checked !== "true").length
  console.log(`  badges: "Turned off"=${turnedOff}  "Never turned on"=${neverOn}  "On"=${onBadges}`)
  console.log(`  switches OFF=${offSwitches}  ON=${switchCount - offSwitches}`)
  // Post-activation (2026-09-09): the owner switched all ten on, so the screen
  // is now 12 on / 0 off. This guard caught the stale 6/4/10 captions the
  // moment the state changed — leave it asserting the CURRENT expected state.
  if (turnedOff !== 0 || neverOn !== 0 || offSwitches !== 0) {
    console.warn(`  !! CAPTION CLAIM DOES NOT MATCH THE SCREEN — fix the caption before shipping this PNG`)
  }

  await shoot(
    page,
    "01-sequences-list-prod",
    "Sequences — all twelve switched on",
    "Production, after the owner turned all ten remaining sequences on through this screen on 9 September.",
    // Each marker targets a DIFFERENT row on purpose. Pointing two of them at
    // `.first()` put both discs on the Lead Magnet Follow-Up row, overlapping
    // each other and covering the very sentence caption 2 describes — and
    // markerOn could not warn, because `.first()` legitimately matches exactly
    // one element. Placement is "after" the text so a disc never sits on it.
    [
      await markerOn(page, switches.first(), "Every row has its own on/off switch. This is the whole of gap #11 — one click here replaces running a script.", {
        place: "left",
        dx: -6,
      }),
      await markerOn(page, page.getByText("On", { exact: true }).nth(3), 'All twelve now read "On". Each one was switched on from this screen — the job gap #11 replaced.', {
        place: "after",
        tight: true,
      }),
      await markerOn(page, page.getByText("Nobody yet — waiting on a quiz result.").first(), "Switched on does not mean sending. Each one waits for its own trigger — a quiz result, a sign-up, an abandoned checkout — so nobody is emailed until they do something.", {
        place: "after",
        tight: true,
      }),
      await markerOn(page, page.getByText("Nothing was sent to 73 of these people.").first(), "The 73 from the August domain fault are untouched. They failed for good and the engine does not retry them.", {
        place: "after",
        tight: true,
      }),
    ]
  )

  // ── Shot 2: the detail screen for a paused sequence ──
  await page.goto(`${APP}/admin/sequences/quiz_rebuilder`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)

  const detailSwitch = page.locator('[role="switch"]')
  const detailStates = await detailSwitch.evaluateAll((els) =>
    els.map((e) => ({ label: e.getAttribute("aria-label"), checked: e.getAttribute("aria-checked") }))
  )
  console.log(`  detail switches: ${JSON.stringify(detailStates)}`)
  const stepRows = await page.locator('select[aria-label^="Step"], [data-step-row]').count()
  console.log(`  step editor controls found: ${stepRows}`)

  await shoot(
    page,
    "02-sequence-detail-prod",
    "Quiz — Rebuilder, on production",
    "The detail screen carries the same switch plus the step editor. Switch reads OFF; nothing here was clicked.",
    // "left" put the disc on top of the "Turned off" badge, clipping it to
    // "Turne" — the badge sits immediately left of the switch. Go right.
    [
      await markerOn(page, detailSwitch.first(), "The same on/off switch, on the sequence's own screen. It reads OFF — this one is switched off.", {
        place: "after",
      }),
      await markerOn(page, page.getByText("Each side needs its own ending, or the same person gets both."), "Step 4 splits the path. Everyone who has an account goes to Step 7; everyone else goes to Step 5.", {
        place: "after",
        tight: true,
      }),
      await markerOn(page, page.getByText("Step 6", { exact: true }), 'Each side ends on its own "End here" — Step 6 for one side, Step 8 for the other. Without that, one group would receive both endings.', {
        place: "after",
        tight: true,
      }),
      await markerOn(page, page.getByRole("button", { name: "Save changes" }), "The step editor writes back from here. Nothing on this screen was changed or saved.", {
        place: "left",
        dx: -6,
      }),
    ]
  )

  await browser.close()
  console.log("\n  done — no switch was clicked, no form was saved.")
}

main().catch((e) => {
  console.error("\nFAILED:", e.message)
  process.exit(1)
})
