/**
 * Captures the client-app promo footage.
 *
 * TRUE 1080x1920, which is the whole point of this rewrite. The previous take
 * was 540x960 upscaled 2x in the edit, and it looked it.
 *
 * Why frames and not Playwright's video recorder: `recordVideo` captures the
 * LAYOUT VIEWPORT IN CSS PIXELS. Asking for `size: 1080x1920` from a 540-wide
 * viewport upscales — it does not add detail. Verified against every escape
 * hatch: `deviceScaleFactor`, `--force-device-scale-factor`, raw CDP
 * `Page.startScreencast`, and a device-metrics override with `scale: 2`. All
 * four still capture 540. And the viewport cannot simply be widened: the phone
 * layout only renders below Tailwind's `sm` breakpoint (640px), and breakpoints
 * cannot be scaled either — `rem` inside a media query always resolves against
 * the INITIAL root font size, so a bigger `html { font-size }` does nothing.
 *
 * `page.screenshot()` is the one API that honours deviceScaleFactor, so the
 * recorder pulls ~18 true-1080p frames a second and the staging step resamples
 * them to CFR 30. Because capture is slower than playback, every DELIBERATE
 * motion (scroll, slider, typing) is driven one small step at a time rather
 * than animated by the browser — stepped motion survives a slow capture, a CSS
 * transition does not.
 *
 * Emits frames/ + frames.json + timeline.json. Beat boundaries come from the
 * measured timeline, never from eyeballing frames: identical runs drift.
 *
 * Run: npx tsx scripts/seed-promo-client.ts && node scripts/record-client-promo.mjs
 */

import { chromium } from "playwright"
import { encode } from "next-auth/jwt"
import * as dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local") })

const BASE = process.env.PROMO_BASE_URL ?? "http://localhost:3050"
const USER_ID = "dded0000-0000-0000-0000-000000000001"
const OUT = path.resolve(__dirname, "../.promo-take")
const FRAMES = path.join(OUT, "frames")

// Phone layout is breakpoint-locked below 640; 540 is the widest that still
// renders it. deviceScaleFactor 2 is what makes each frame 1080x1920.
const VIEWPORT = { width: 540, height: 960 }
const SCALE = 2

// ─── Frame capture ──────────────────────────────────────────────────────────

let capturing = false
let frames = []
let t0 = 0

async function captureLoop(page) {
  while (capturing) {
    try {
      // quality: 100 is load-bearing, not a nicety. The app draws its card
      // borders in amber-200/emerald-200 — 1px pale lines whose contrast is
      // almost entirely CHROMA, which is exactly what 4:2:0 subsampling throws
      // away. Chrome encodes JPEG at 4:4:4 only at quality 100; at q92 a crisp
      // 2px border smeared to ~2.7px and its saturation collapsed from 80 to 8.
      // Measured against a lossless PNG of the same screen: q100 is identical
      // (2.0px, sat 79) and runs at 16fps vs PNG's 9.7fps.
      const buf = await page.screenshot({ type: "jpeg", quality: 100 })
      const t = Date.now() - t0
      const file = `f${String(frames.length).padStart(5, "0")}.jpg`
      fs.writeFileSync(path.join(FRAMES, file), buf)
      frames.push({ file, t })
    } catch {
      // A screenshot can fail mid-navigation; dropping that frame is correct.
    }
  }
}

/** Beat boundaries, measured. The edit is derived from these. */
const timeline = []
const now = () => Date.now() - t0

async function beat(id, note, fn) {
  const start = now()
  await fn()
  const end = now()
  timeline.push({ id, note, start, end })
  console.log(`  ${String(start / 1000).padStart(6)}s → ${String(end / 1000).padStart(6)}s  ${id}`)
}

// ─── Stepped motion helpers ─────────────────────────────────────────────────
// Capture runs at ~18fps, so anything the BROWSER animates gets sampled coarsely.
// Driving the motion ourselves in small steps keeps it smooth at any capture rate.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function steppedScroll(page, toY, steps = 26, stepMs = 34) {
  const fromY = await page.evaluate(() => window.scrollY)
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await sleep(stepMs)
  }
}

async function steppedScrollToElement(page, locator, offset = 120) {
  const box = await locator.boundingBox()
  if (!box) return
  const y = await page.evaluate(() => window.scrollY)
  await steppedScroll(page, Math.max(0, y + box.y - offset))
}

/** Range inputs move one notch per arrow key — naturally stepped. */
async function steppedSlider(page, locator, presses, key = "ArrowRight") {
  await locator.focus()
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key)
    await sleep(180)
  }
}

async function steppedType(locator, text, perChar = 95) {
  await locator.click()
  await locator.fill("")
  for (const ch of text) {
    await locator.pressSequentially(ch, { delay: 0 })
    await sleep(perChar)
  }
}

// ─── Choreography ───────────────────────────────────────────────────────────

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(FRAMES, { recursive: true })

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET missing from .env.local")
  const cookie = await encode({
    secret,
    salt: "authjs.session-token",
    token: { id: USER_ID, sub: USER_ID, email: "jordan@promo.demo", role: "client", name: "Jordan" },
  })

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE })
  await ctx.addCookies([{ name: "authjs.session-token", value: cookie, domain: "localhost", path: "/" }])
  // Next's dev badge sits in the corner of every frame otherwise.
  await ctx.addInitScript(() => {
    const s = document.createElement("style")
    s.textContent = "nextjs-portal{display:none!important}"
    document.documentElement.appendChild(s)
  })

  const page = await ctx.newPage()

  // Pre-warm every route. The dev server compiles on demand, and a compile
  // skeleton in the middle of a beat is unusable footage.
  console.log("pre-warming routes…")
  for (const url of ["/client/dashboard", "/client/workouts", "/client/form-reviews", "/client/progress", "/client/achievements"]) {
    await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 120_000 })
    await sleep(400)
  }

  await page.goto(BASE + "/client/dashboard", { waitUntil: "networkidle", timeout: 120_000 })
  await sleep(1500)

  console.log("\nrecording…")
  t0 = Date.now()
  capturing = true
  const loop = captureLoop(page)

  // Dwells are sized so each cut window in prepare-client-take.mjs fits with
  // slack. Too short and that script fails rather than shortening a segment,
  // because a short segment shifts every caption after it.
  await beat("dashboard", "Welcome back Jordan, Week 3 of 6", async () => {
    await sleep(5000)
  })

  await beat("install", "install banner — add it to your phone", async () => {
    // Headless Chrome never fires beforeinstallprompt, so dispatch the real
    // event the app's InstallPrompt listens for. Same component, same markup.
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt")
      e.prompt = async () => {}
      e.userChoice = Promise.resolve({ outcome: "dismissed" })
      window.dispatchEvent(e)
    })
    await sleep(4400)
  })

  await beat("workouts", "Week 3 of 6, day tabs", async () => {
    await page.goto(BASE + "/client/workouts", { waitUntil: "networkidle", timeout: 120_000 })
    await sleep(2600)
    await steppedScroll(page, 220)
    await sleep(2400)
  })

  await beat("recovery", "recovery slider dragged", async () => {
    const slider = page.locator('input[type="range"]').first()
    if (await slider.count()) {
      await steppedSlider(page, slider, 2)
      await sleep(1400)
    }
  })

  await beat("start", "start session", async () => {
    const start = page.getByRole("button", { name: /start session/i }).first()
    if (await start.count()) await start.click()
    await sleep(2600)
  })

  const heroCard = page.getByRole("button", { name: /rotation chest press/i }).first()

  await beat("prescription", "sets / reps / weight already set", async () => {
    await steppedScrollToElement(page, heroCard, 150)
    await sleep(600)
    await heroCard.click()
    await sleep(2600)
  })

  await beat("demo-load", "YouTube iframe loading — BLACK, do not use", async () => {
    await page.getByRole("button", { name: /^watch$/i }).first().click()
    await sleep(6500)
  })

  await beat("demo-play", "Darren's demo actually playing", async () => {
    await sleep(7000)
  })

  await beat("demo-close", "close the demo", async () => {
    // Escape will NOT close this dialog: focus is inside the YouTube iframe.
    // Click the close control and wait for the dialog to detach, or every
    // later click lands on the overlay instead.
    const dialog = page.locator('[role="dialog"]').first()
    const x = dialog.locator("button").last()
    await x.click().catch(() => {})
    await dialog.waitFor({ state: "detached", timeout: 8000 }).catch(() => {})
    await sleep(900)
  })

  await beat("upload", "film your set — upload dialog", async () => {
    await page.getByRole("button", { name: /upload recording/i }).first().click()
    await sleep(4200)
    await page.keyboard.press("Escape").catch(() => {})
    await page.locator('[role="dialog"]').first().waitFor({ state: "detached", timeout: 6000 }).catch(() => {})
    await sleep(800)
  })

  await beat("type-weight", "42.5 over the recommended 40", async () => {
    const weights = page.locator('input[type="number"][step="any"]')
    const n = await weights.count()
    await steppedScrollToElement(page, weights.first(), 260)
    await sleep(500)
    for (let i = 0; i < n; i++) {
      await steppedType(weights.nth(i), "42.5", i === 0 ? 160 : 70)
      await sleep(i === 0 ? 700 : 220)
    }
    await sleep(900)
  })

  await beat("save-pr", "Save Workout → NEW PERSONAL RECORD", async () => {
    await page.getByRole("button", { name: /save workout/i }).first().click()
    await sleep(11800)
  })

  await beat("logged", "logged green row", async () => {
    // 42.5kg sets off THREE PRs (weight, volume, estimated 1RM) and the overlay
    // pages through one card per tap. Escape does not dismiss it — tap through
    // until it's gone, or this beat is just more confetti.
    for (let i = 0; i < 6; i++) {
      const still = await page.evaluate(() => /NEW PERSONAL RECORD/i.test(document.body.innerText))
      if (!still) break
      await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2)
      await sleep(1100)
    }
    await sleep(900)
    await steppedScroll(page, 300)
    await sleep(2800)
  })

  await beat("review", "Reviewed — view feedback", async () => {
    await page.goto(BASE + "/client/form-reviews", { waitUntil: "networkidle", timeout: 120_000 })
    await sleep(4200)
  })

  await beat("progress", "Key Lifts chart at 42.5kg", async () => {
    await page.goto(BASE + "/client/progress", { waitUntil: "networkidle", timeout: 120_000 })
    await sleep(2600)
    await steppedScroll(page, 420)
    await sleep(3200)
  })

  await beat("achievements", "achievements grid", async () => {
    await page.goto(BASE + "/client/achievements", { waitUntil: "networkidle", timeout: 120_000 })
    await sleep(4600)
  })

  capturing = false
  await loop
  await browser.close()

  const durationMs = frames.length ? frames[frames.length - 1].t : 0
  fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify(frames))
  fs.writeFileSync(
    path.join(OUT, "timeline.json"),
    JSON.stringify({ viewport: VIEWPORT, scale: SCALE, durationMs, frameCount: frames.length, beats: timeline }, null, 2),
  )

  console.log(`
captured ${frames.length} frames over ${(durationMs / 1000).toFixed(1)}s  (${(frames.length / (durationMs / 1000)).toFixed(1)} fps)
frames   ${FRAMES}
timeline ${path.join(OUT, "timeline.json")}
`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
