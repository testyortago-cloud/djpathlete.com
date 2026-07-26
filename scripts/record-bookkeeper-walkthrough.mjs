/**
 * Record the AI Bookkeeper walkthrough against local dev.
 *
 * Timing is driven by scripts/walkthrough-script.mjs: each beat holds for
 * exactly as long as its caption takes to read. The first cut of this recorder
 * used invented dwell times and came out at 2.7 minutes for a 12-minute script,
 * which is why the narration now owns the clock.
 *
 * Each chapter records to its OWN context -> its own .webm, so a failed chapter
 * is re-recorded alone rather than wasting the whole take. The Remotion EDL
 * stitches them.
 *
 * Geometry: recordVideo.size only scales content DOWN and ignores
 * deviceScaleFactor, so `size` MUST equal `viewport`, and the viewport width IS
 * the layout width (JOURNAL 2026-07-17).
 *
 * Auth: the dev-login bypass — local `npm run dev` only (the route 404s when
 * VERCEL is set), so no password is ever typed on camera.
 *
 * Emits timeline.json: measured beat boundaries + caption text, which the
 * Remotion edit reads directly. Boundaries are measured, never eyeballed.
 *
 * Run: node scripts/record-bookkeeper-walkthrough.mjs [chapterId ...]
 */
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { CHAPTERS, captionMs } from "./walkthrough-script.mjs"

const BASE = process.env.BASE_URL ?? "http://localhost:3050"
const OUT = path.join(process.cwd(), ".playwright-out", "walkthrough")
const VIEWPORT = { width: 1600, height: 1000 }
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"))

const wait = (page, ms) => page.waitForTimeout(ms)

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await wait(page, 600)
}

/** Visible pointer travel before a click so the action reads on camera. */
async function moveTo(page, locator) {
  const box = await locator.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
  await wait(page, 320)
}

async function clickNamed(page, pattern, { required = true } = {}) {
  const el = page.getByRole("button", { name: pattern }).first()
  if (!(await el.isVisible().catch(() => false))) {
    if (required) throw new Error(`control not found: ${pattern}`)
    return false
  }
  await moveTo(page, el)
  await el.click()
  await wait(page, 900)
  return true
}

async function smoothScrollTo(page, fraction) {
  await page.evaluate((f) => {
    const max = document.body.scrollHeight - window.innerHeight
    window.scrollTo({ top: Math.max(0, max * f), behavior: "smooth" })
  }, fraction)
  await wait(page, 700)
}

/** Execute one beat's actions, then hold for the caption's reading time. */
async function runBeat(page, beat) {
  if (beat.url) {
    await page.goto(`${BASE}${beat.url}`, { waitUntil: "domcontentloaded" })
    await settle(page)
  }
  if (beat.tab) {
    const tab = page.getByRole("tab", { name: beat.tab }).first()
    if (!(await tab.isVisible().catch(() => false))) throw new Error(`book tab not found: ${beat.tab}`)
    await moveTo(page, tab)
    await tab.click()
    await wait(page, 800)
  }
  if (beat.esc) {
    await page.keyboard.press("Escape")
    await wait(page, 600)
  }
  if (beat.then) await clickNamed(page, beat.then)
  if (beat.click) await clickNamed(page, beat.click)
  if (typeof beat.scroll === "number") await smoothScrollTo(page, beat.scroll)
  if (beat.toggle) {
    const t = page.getByLabel(beat.toggle).first()
    if (await t.isVisible().catch(() => false)) {
      await moveTo(page, t)
      await t.click()
      await wait(page, 800)
    }
  }
  // Hold for the caption.
  await wait(page, captionMs(beat.text))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const list = only.length ? CHAPTERS.filter((c) => only.includes(c.id)) : CHAPTERS
  if (!list.length) throw new Error(`no chapters matched: ${only.join(", ")}`)

  const timelinePath = path.join(OUT, "timeline.json")
  const timeline = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, "utf8")) : {}

  const browser = await chromium.launch({ headless: true })
  try {
    for (const ch of list) {
      process.stdout.write(`recording ${ch.id} (${ch.title}) … `)
      const dir = path.join(OUT, ch.id)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })

      // Playwright starts recording at context creation, which is BEFORE login.
      // Measure that lead-in so the edit can skip it; otherwise every caption
      // sits ahead of its footage by however long signing in took.
      const contextStart = Date.now()
      const context = await browser.newContext({
        viewport: VIEWPORT,
        recordVideo: { dir, size: VIEWPORT }, // MUST equal viewport
        reducedMotion: "reduce",
        colorScheme: "light",
      })
      const page = await context.newPage()

      await page.goto(`${BASE}/api/dev/login?callbackUrl=${encodeURIComponent(ch.url)}`, { waitUntil: "domcontentloaded" })
      await page.waitForURL(/\/admin/, { timeout: 30_000 })
      await settle(page)
      // Settle a beat before the first caption so the chapter does not open mid-paint.
      await wait(page, 900)

      const t0 = Date.now()
      const leadInMs = t0 - contextStart
      const beats = []
      for (const b of ch.beats) {
        const startMs = Date.now() - t0
        await runBeat(page, b)
        beats.push({ text: b.text, startMs, endMs: Date.now() - t0 })
      }
      const durationMs = Date.now() - t0

      const video = page.video()
      await context.close() // path() resolves only after close
      const raw = video ? await video.path() : null
      const dest = path.join(OUT, `${ch.id}.webm`)
      if (raw && fs.existsSync(raw)) {
        fs.rmSync(dest, { force: true })
        fs.renameSync(raw, dest)
      }
      fs.rmSync(dir, { recursive: true, force: true })

      timeline[ch.id] = { id: ch.id, title: ch.title, durationMs, leadInMs, file: `${ch.id}.webm`, beats }
      fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2))
      console.log(`${(durationMs / 1000).toFixed(1)}s  (${beats.length} beats, lead-in ${(leadInMs / 1000).toFixed(1)}s)`)
    }
  } finally {
    await browser.close()
  }

  const ordered = CHAPTERS.map((c) => timeline[c.id]).filter(Boolean)
  const total = ordered.reduce((a, c) => a + c.durationMs, 0)
  console.log(`\n${ordered.length}/${CHAPTERS.length} chapters — ${(total / 1000 / 60).toFixed(1)} min`)
  console.log(`timeline: ${timelinePath}`)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
