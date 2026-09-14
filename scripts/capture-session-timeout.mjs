/**
 * Annotated captures of the session time-bomb: the warning, the screen it hands
 * you to, and the same warning in the coach's shell.
 *
 * Run with the windows in lib/session-policy.ts temporarily shortened (the real
 * ones are 2h / 7d, which no capture run is going to wait out):
 *   SESSION_IDLE_MAX_AGE_SECONDS = 60, SESSION_WARN_BEFORE_MS = 30_000
 *
 * DEV CLONE ONLY.
 */
import { chromium } from "playwright"
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/session-timeout"
const DEV_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 900
const DSF = 2

const SHORTENED =
  "(Captured with the windows shortened to 60s idle / 30s warning, so the countdown reads seconds rather than the real 2:00 — no capture run waits out two hours.)"

const EMAIL = "orla.byrne@djpathlete.demo"
const PASSWORD = "password123"

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

const hideFloatingChrome = (page) => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })

/**
 * Marker on a real element, in the raw pixel space annotate() draws in. Measures
 * the TEXT RUN via a Range, not the element box — a block-level element spans
 * its container, so "centre of the box" lands on top of the words. Warns LOUDLY
 * rather than degrading politely: a marker that quietly falls back to a default
 * draws a caption pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "center" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 80, y: 80, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first`)
  const box = await locator.first().evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    const rect = r.getBoundingClientRect()
    if (!rect.width || !rect.height) return el.getBoundingClientRect().toJSON()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  const cx = place === "left" ? box.x - 24 : place === "right" ? box.x + box.width + 24 : box.x + box.width / 2
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await page.mouse.move(WIDTH - 4, HEIGHT - 4) // the pointer stays where it last clicked
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers, scale: DSF })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  // ------------------------------------------------------- 01 client warning
  const page = await ctx.newPage()
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/client\//, { timeout: 30000 })

  const dialog = page.getByText(/about to be signed out/i)
  await dialog.waitFor({ timeout: 120_000 })
  await shoot(
    page,
    "01-warning-client",
    "The warning, before anything is lost",
    "Two minutes before an idle session ends, the athlete gets the chance to stay. The countdown is live. Nothing has been signed out yet." +
      SHORTENED,
    [
      await markerOn(page, dialog, "Says plainly what is about to happen and why.", { place: "left" }),
      await markerOn(
        page,
        page.getByRole("button", { name: /stay signed in/i }),
        "One button keeps them in. It extends the idle window — but it cannot push past the 7-day cap.",
        {
          place: "right",
        },
      ),
    ],
  )

  // ------------------------------------------------------ 02 expired landing
  await page.waitForURL(/\/login\?expired=1/, { timeout: 120_000 })
  await page.waitForTimeout(500)
  await shoot(
    page,
    "02-expired-landing",
    "Where an ended session lands",
    "Not a blank login screen. The reason is stated, and the address bar is still carrying the page they were on, so signing in puts them back there.",
    [
      await markerOn(
        page,
        page.getByText(/your session ended/i),
        "Explains the sign-out instead of leaving them to guess.",
        { place: "left" },
      ),
    ],
  )

  // --------------------------------------------------------- 03 coach's side
  const admin = await ctx.newPage()
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await admin.waitForTimeout(2000)
  // Assert the session BEFORE capturing: a refused login reports downstream as
  // a feature failure that mimics the real thing.
  if (!admin.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${admin.url()})`)
  const adminDialog = admin.getByText(/about to be signed out/i)
  await adminDialog.waitFor({ timeout: 120_000 })
  await shoot(
    admin,
    "03-warning-admin",
    "The same rule in the coach's shell",
    "One rule for everyone — the guard is mounted in the admin, client and editor shells alike, so nobody is quietly exempt." +
      SHORTENED,
    [await markerOn(admin, adminDialog, "Identical warning over the coach's own dashboard.", { place: "left" })],
  )
} finally {
  await browser.close()
}
