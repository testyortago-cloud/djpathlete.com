/**
 * Record a walkthrough against local dev.
 *
 * Timing comes from the show's beat script: each beat holds for exactly as long
 * as its narration runs, so run synth-walkthrough-narration.mjs FIRST.
 *
 * Each chapter records to its OWN context -> its own .webm, so a failed chapter
 * is re-recorded alone rather than costing the whole take. The Remotion EDL
 * stitches them.
 *
 * Geometry: recordVideo.size only scales content DOWN and ignores
 * deviceScaleFactor, so `size` MUST equal `viewport`, and the viewport width IS
 * the layout width. To film a bigger frame without shrinking the UI, enlarge
 * the viewport and zoom the root element — see registry.mjs.
 *
 * Auth: the dev-login bypass — local `npm run dev` only (the route 404s when
 * VERCEL is set), so no password is ever typed on camera.
 *
 * Emits timeline.json: MEASURED beat boundaries + caption text, which the
 * Remotion edit reads directly. Boundaries are measured, never eyeballed.
 *
 * Run: node scripts/record-walkthrough.mjs [--show <id>] [chapterId ...]
 */
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { resolveShow, showArg } from "./walkthroughs/registry.mjs"
import { loadTiming } from "./walkthroughs/timing.mjs"

const BASE = process.env.BASE_URL ?? "http://localhost:3050"
const argv = process.argv.slice(2)
const SHOW_ID = showArg(argv)
const only = argv.filter((a) => !a.startsWith("-") && a !== SHOW_ID)

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

/**
 * Resolve the scope a beat's controls are looked up in.
 *
 * `row` matters more than it looks: every member row has an "Edit access"
 * button, so an unscoped `getByRole("button", ...).first()` silently films the
 * wrong person — the click succeeds, the dialog opens, and only the name in the
 * title says anything is wrong.
 */
function scopeFor(page, beat) {
  if (beat.row) return page.getByRole("row").filter({ hasText: beat.row })
  return page
}

async function clickNamed(page, beat, pattern, { required = true } = {}) {
  const el = scopeFor(page, beat).getByRole("button", { name: pattern }).first()
  if (!(await el.isVisible().catch(() => false))) {
    if (required) throw new Error(`control not found: ${pattern}${beat.row ? ` in row "${beat.row}"` : ""}`)
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

/**
 * Scroll the open dialog, not the window.
 *
 * The invite dialog is `max-h-[85vh] overflow-y-auto`, so the page behind it
 * does not scroll at all — a window scroll here is a silent no-op and the Money
 * group with the view/manage tiers never comes into shot.
 */
async function scrollDialogTo(page, fraction) {
  await page.evaluate((f) => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return
    // The scroller is whichever element in the dialog actually overflows.
    const candidates = [dialog, ...dialog.querySelectorAll("*")]
    const scroller = candidates.find((el) => el.scrollHeight > el.clientHeight + 8)
    if (!scroller) return
    scroller.scrollTo({ top: (scroller.scrollHeight - scroller.clientHeight) * f, behavior: "smooth" })
  }, fraction)
  await wait(page, 800)
}

/** Type visibly, character by character — `fill` would make the text appear instantly. */
async function typeInto(page, spec) {
  const field = spec.selector ? page.locator(spec.selector) : page.getByLabel(spec.label).first()
  await moveTo(page, field)
  await field.click()
  await field.fill("")
  await field.type(spec.value, { delay: 55 })
  await wait(page, 500)
}

async function selectOption(page, spec) {
  const field = page.locator(spec.selector)
  await moveTo(page, field)
  await field.selectOption(spec.value)
  await wait(page, 800)
}

/**
 * Click one of a tiered permission's none/view/manage buttons.
 *
 * Scoped to the permission's own container: "manage" appears once per tiered
 * permission, so an unscoped lookup sets the tier on whichever happens to be
 * first in the DOM.
 */
async function setTier(page, spec) {
  const row = page.locator('[role="dialog"] div.rounded-lg.border').filter({ hasText: spec.label }).last()
  const button = row.getByRole("button", { name: spec.tier, exact: true }).first()
  if (!(await button.isVisible().catch(() => false))) {
    throw new Error(`tier control not found: ${spec.label} -> ${spec.tier}`)
  }
  await moveTo(page, button)
  await button.click()
  await wait(page, 700)
}

/** Tick the first N unchecked checkboxes inside the open dialog. */
async function checkFirst(page, count) {
  const boxes = page.locator('[role="dialog"] input[type="checkbox"]')
  let ticked = 0
  for (let i = 0; i < (await boxes.count()) && ticked < count; i++) {
    const box = boxes.nth(i)
    if (await box.isChecked()) continue
    await moveTo(page, box)
    await box.check()
    await wait(page, 450)
    ticked++
  }
  if (ticked < count) throw new Error(`only ${ticked} of ${count} checkboxes available`)
}

/** Everything a beat can do, in a fixed order so a beat reads top to bottom. */
async function runActions(page, beat) {
  if (beat.url) {
    await page.goto(`${BASE}${beat.url}`, { waitUntil: "domcontentloaded" })
    await settle(page)
  }
  if (beat.tab) {
    const tab = page.getByRole("tab", { name: beat.tab }).first()
    if (!(await tab.isVisible().catch(() => false))) throw new Error(`tab not found: ${beat.tab}`)
    await moveTo(page, tab)
    await tab.click()
    await wait(page, 800)
  }
  if (beat.esc) {
    await page.keyboard.press("Escape")
    await wait(page, 600)
  }
  if (beat.click) await clickNamed(page, beat, beat.click)
  if (beat.type) await typeInto(page, beat.type)
  if (beat.select) await selectOption(page, beat.select)
  if (beat.tier) await setTier(page, beat.tier)
  if (beat.checkFirst) await checkFirst(page, beat.checkFirst)
  if (beat.then) await clickNamed(page, beat, beat.then)
  if (typeof beat.dialogScroll === "number") await scrollDialogTo(page, beat.dialogScroll)
  if (typeof beat.scroll === "number") await smoothScrollTo(page, beat.scroll)
  if (beat.toggle) {
    const t = page.getByLabel(beat.toggle).first()
    if (await t.isVisible().catch(() => false)) {
      await moveTo(page, t)
      await t.click()
      await wait(page, 800)
    }
  }
}

async function main() {
  const show = await resolveShow(SHOW_ID)
  const timing = loadTiming(show.id)
  const OUT = path.join(process.cwd(), ".playwright-out", show.dir)
  fs.mkdirSync(OUT, { recursive: true })

  const list = only.length ? show.CHAPTERS.filter((c) => only.includes(c.id)) : show.CHAPTERS
  if (!list.length) throw new Error(`no chapters matched: ${only.join(", ")}`)

  const timelinePath = path.join(OUT, "timeline.json")
  const timeline = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, "utf8")) : {}

  console.log(`show: ${show.id} -> ${show.dir}  (${show.viewport.width}x${show.viewport.height} @ zoom ${show.zoom})`)
  console.log(
    timing.hasNarration()
      ? "timing: measured narration (run synth-walkthrough-narration.mjs to refresh)"
      : "timing: reading-pace estimate — no narration synthesized yet",
  )

  const browser = await chromium.launch({ headless: true })
  try {
    for (const ch of list) {
      process.stdout.write(`recording ${ch.id} (${ch.title}) … `)
      const dir = path.join(OUT, ch.id)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })

      // Playwright starts recording at context creation, i.e. BEFORE login.
      // Measure that lead-in so the staging step can cut it; otherwise every
      // caption sits ahead of its footage by however long signing in took.
      const contextStart = Date.now()
      const context = await browser.newContext({
        viewport: show.viewport,
        recordVideo: { dir, size: show.viewport }, // MUST equal viewport
        reducedMotion: "reduce",
        colorScheme: "light",
      })

      if (show.zoom !== 1) {
        await context.addInitScript((z) => {
          const apply = () => {
            const style = document.createElement("style")
            style.textContent = `html { zoom: ${z}; }`
            document.head.appendChild(style)
          }
          if (document.head) apply()
          else document.addEventListener("DOMContentLoaded", apply, { once: true })
        }, show.zoom)
      }

      const page = await context.newPage()

      await page.goto(`${BASE}/api/dev/login?callbackUrl=${encodeURIComponent(ch.url)}`, { waitUntil: "domcontentloaded" })
      await page.waitForURL(/\/admin/, { timeout: 30_000 })
      await settle(page)

      // Untimed setup, so a chapter that needs a dialog already open can stand
      // on its own instead of inheriting the previous chapter's end state.
      for (const step of ch.setup ?? []) await runActions(page, step)

      // Settle a beat before the first caption so the chapter does not open mid-paint.
      await wait(page, 900)

      const t0 = Date.now()
      const leadInMs = t0 - contextStart
      const beats = []
      for (const [i, b] of ch.beats.entries()) {
        const startMs = Date.now() - t0
        await runActions(page, b)
        // The audio file for this beat is <chapter>/<NN>.wav — the edit places
        // it at startMs, so the index must stay in lockstep with the synth.
        await wait(page, timing.beatMs(ch.id, i, b.text))
        beats.push({ text: b.text, startMs, endMs: Date.now() - t0, audio: `${ch.id}/${String(i).padStart(2, "0")}.wav` })
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

  const ordered = show.CHAPTERS.map((c) => timeline[c.id]).filter(Boolean)
  const total = ordered.reduce((a, c) => a + c.durationMs, 0)
  console.log(`\n${ordered.length}/${show.CHAPTERS.length} chapters — ${(total / 1000 / 60).toFixed(1)} min`)
  console.log(`timeline: ${timelinePath}`)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
