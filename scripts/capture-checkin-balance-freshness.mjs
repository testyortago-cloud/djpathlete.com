/**
 * Annotated captures of the personal check-in screen's session balance.
 *
 * The bug: `public/sw.js` cached every /api/ GET stale-while-revalidate, so the
 * check-in link rendered the answer from the PREVIOUS visit. A real client
 * opened his bookmark, read "5 sessions left", tapped Check in, and the
 * confirmation said 2 — the POST was never cached, so only it told the truth.
 *
 * MODE=before captures the old worker's behaviour (run it with the pre-fix
 * public/sw.js checked out); MODE=after captures the fix. Both drive the real
 * app on the real route, in a real phone-sized browser, with the service worker
 * actually installed by logging into the client portal first.
 *
 * DEV CLONE ONLY — it moves a pack's balance to force the states it needs.
 */
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createHmac } from "node:crypto"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/checkin-balance"
const MODE = process.env.MODE ?? "after"
const DEV_REF = "anjvztjiokcgiyhobknq"

// A phone, because this screen is only ever opened on one.
const WIDTH = 430
const HEIGHT = 932
const DSF = 3

const CLIENT_ID = "e5f91d82-2c47-43cf-a701-37b97faf7083"
const EMAIL = "orla.byrne@djpathlete.demo"
const PASSWORD = "password123"
const PACK_ID = "719557bf-0e69-46e7-a5ec-26bfa7e7b03a"
const CREDITS_TOTAL = 10

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const b64 = Buffer.from(`pc.${CLIENT_ID}`).toString("base64url")
const TOKEN = `${b64}.${createHmac("sha256", env.NEXTAUTH_SECRET).update(b64).digest("base64url")}`
const LINK = `${APP}/checkin/me?token=${encodeURIComponent(TOKEN)}`

/** Put the pack at a known balance, and clear the idempotency window so a
 *  capture run can always take a real credit. */
async function setRemaining(remaining) {
  const { error } = await db
    .from("client_packages")
    .update({ credits_used: CREDITS_TOTAL - remaining, status: "active" })
    .eq("id", PACK_ID)
  if (error) throw error
  await db
    .from("session_checkins")
    .delete()
    .eq("client_package_id", PACK_ID)
    .gte("checked_in_at", new Date(Date.now() - 86_400_000).toISOString())
  console.log(`  [db] pack now holds ${remaining} sessions`)
}

async function launchChromium() {
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
      if (existsSync(exe)) return await chromium.launch({ executablePath: exe })
    }
    throw new Error("no chromium available")
  }
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({ content: `nextjs-portal { display: none !important; }` })
}

/**
 * Marker on a real element, converted from CSS px into the raw pixel space
 * annotate() draws in. Warns LOUDLY instead of degrading politely — a marker
 * that quietly lands at a default draws a caption pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "center" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 60, y: 60, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first`)
  // Measure the TEXT RUN, not the element box. These are block-level <p>s and
  // full-width buttons, so their boxes span the whole card: "right of the box"
  // lands off the card edge and "centre of the box" lands on top of the words.
  // A Range over the contents gives the inline text's real extent, which is
  // what leaves the disc in genuine whitespace beside the number.
  const box = await locator.first().evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    const rect = r.getBoundingClientRect()
    if (!rect.width || !rect.height) return el.getBoundingClientRect().toJSON()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 60, y: 60, caption }
  }
  const cx = place === "left" ? box.x - 24 : place === "right" ? box.x + box.width + 24 : box.x + box.width / 2
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  // The pointer stays wherever it last clicked and would sit in the frame.
  await page.mouse.move(WIDTH - 4, HEIGHT - 4)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers, scale: DSF })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

const balanceText = (page) => page.getByText(/sessions? left on your pack/)

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  await setRemaining(8)

  // Log in for real: this is what registers /sw.js at scope "/", which is why
  // the worker then intercepts the check-in link even though that page has no
  // login of its own.
  const portal = await ctx.newPage()
  await portal.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await portal.getByLabel(/email/i).fill(EMAIL)
  await portal.getByLabel(/password/i).fill(PASSWORD)
  await portal.getByRole("button", { name: /sign in|log in/i }).click()
  await portal.waitForURL(/\/client\//, { timeout: 30000 })
  // Assert the worker BEFORE capturing: an uninstalled worker reports as "the
  // bug is fixed" and would quietly turn the before-shot into a false pass.
  const controlling = await portal.evaluate(async () => {
    await navigator.serviceWorker.ready
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 250))
    return Boolean(navigator.serviceWorker.controller)
  })
  if (!controlling) throw new Error("service worker never took control — the capture would prove nothing")
  console.log("  service worker installed and controlling")

  const page = await ctx.newPage()

  // Visit once to fill the worker's cache, exactly as a client's last session did.
  await page.goto(LINK, { waitUntil: "networkidle" })
  console.log(`  first visit shows: ${(await balanceText(page).textContent()).trim()}`)

  // Two coach check-ins happen between visits — the case that bit the real client.
  await setRemaining(6)

  await page.goto(LINK, { waitUntil: "networkidle" })
  const onScreen = (await balanceText(page).textContent()).trim()
  console.log(`  second visit shows: ${onScreen}`)

  if (MODE === "before") {
    if (!/\b8\b/.test(onScreen)) throw new Error(`expected the stale 8 on the pre-fix worker, got "${onScreen}"`)
    await shoot(
      page,
      "01-before-stale-balance",
      "BEFORE — one visit out of date",
      "The pack holds 6 sessions. The screen says 8, because the service worker answered from the copy it cached on the last visit and refreshed it silently in the background.",
      [
        await markerOn(
          page,
          balanceText(page),
          "Says 8. The pack actually holds 6 — the coach checked him in twice since he last opened this link.",
          { place: "right" },
        ),
        await markerOn(
          page,
          page.getByRole("button", { name: /check in/i }),
          "Tapping this posts to the server, which is never cached — so the confirmation would jump straight to 5 and look like it lost two sessions.",
          { place: "right" },
        ),
      ],
    )
  } else {
    if (!/\b6\b/.test(onScreen)) throw new Error(`expected the live 6 after the fix, got "${onScreen}"`)
    await shoot(
      page,
      "02-after-live-balance",
      "AFTER — read live, every time",
      "Same link, same two coach check-ins in between. A session balance is never answered from a cache now, so the screen shows what the pack actually holds.",
      [
        await markerOn(
          page,
          balanceText(page),
          "Says 6, which is what the pack holds. This is now read from the server on every open.",
          { place: "right" },
        ),
      ],
    )

    // The check-in itself: the number must move by exactly one from what was shown.
    await page.getByRole("button", { name: /check in/i }).click()
    await page.getByText(/you're in/i).waitFor({ timeout: 15000 })
    await shoot(
      page,
      "03-after-checkin-confirmation",
      "AFTER — the drop is exactly one",
      "6 before the tap, 5 after it. The confirmation now counts every pack the client can still use, the same way the screen before it did.",
      [
        await markerOn(
          page,
          page.getByText(/sessions? left on your pack/),
          "5 — one fewer than the 6 on the previous screen. No unexplained drop.",
          { place: "right" },
        ),
      ],
    )

    // A page left open on a phone while the coach checks them in at the desk.
    const fresh = await ctx.newPage()
    await fresh.goto(LINK, { waitUntil: "networkidle" })
    console.log(`  parked tab shows: ${(await balanceText(fresh).textContent()).trim()}`)
    await setRemaining(2)
    // NOT REACHABLE HEADLESSLY: Chromium reports every Playwright page as
    // visible — `bringToFront()` and CDP's page-lifecycle states were both
    // measured here and neither moves `document.visibilityState` or fires the
    // event. So the script fires the same event the browser fires when a phone
    // is unlocked or the app is switched back to. Everything downstream of it
    // is real: the component's own handler, a real request to the real route,
    // and the real render.
    await fresh.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await fresh.getByText(/2 sessions left on your pack/).waitFor({ timeout: 15000 })
    await shoot(
      fresh,
      "04-after-refresh-on-return",
      "AFTER — a parked tab re-reads itself",
      "This tab was open, showing 5, while the coach checked the client in from the admin side. Returning to the page re-reads the balance instead of trusting the number it loaded with. (Headless Chromium never reports a page as hidden, so the return-to-page event was fired by the capture script; the refresh it triggers is the real one.)",
      [
        await markerOn(
          fresh,
          balanceText(fresh),
          "Updated to 2 the moment the client came back to the page — no reload, no stale number to tap against.",
          { place: "right" },
        ),
      ],
    )
  }
} finally {
  await setRemaining(8)
  await browser.close()
}
