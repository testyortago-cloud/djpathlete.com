/**
 * Screenshot a show's capture geometry before spending a take on it.
 *
 * The HD rule is "measure the capture, never trust a comment": recordVideo
 * ignores deviceScaleFactor and only ever scales DOWN, so the viewport width IS
 * the captured width, and zooming the root element is the only way to keep the
 * UI readable at a larger frame. Zoom can also disturb sticky positioning and
 * vh-sized dialogs, which is invisible until you watch the take back.
 *
 * Writes <chapter>.png per chapter URL and prints the real pixel size of each.
 *
 * Run: node scripts/check-capture-geometry.mjs [--show <id>]
 */
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { resolveShow, showArg } from "./walkthroughs/registry.mjs"

const BASE = process.env.BASE_URL ?? "http://localhost:3050"
const show = await resolveShow(showArg(process.argv.slice(2)))
const OUT = path.join(process.cwd(), ".playwright-out", `${show.dir}-geometry`)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

console.log(`show: ${show.id} — viewport ${show.viewport.width}x${show.viewport.height} @ zoom ${show.zoom}`)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: show.viewport,
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
await page.goto(`${BASE}/api/dev/login?callbackUrl=${encodeURIComponent(show.CHAPTERS[0].url)}`, {
  waitUntil: "domcontentloaded",
})
await page.waitForURL(/\/admin/, { timeout: 30_000 })

for (const ch of show.CHAPTERS) {
  await page.goto(`${BASE}${ch.url}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(800)

  // Run the chapter's setup so a chapter that films a dialog is checked with
  // that dialog open — the layout most likely to be disturbed by zoom.
  for (const step of ch.setup ?? []) {
    if (step.click) await page.getByRole("button", { name: step.click }).first().click().catch(() => {})
    if (step.type) {
      const f = step.type.selector ? page.locator(step.type.selector) : page.getByLabel(step.type.label).first()
      await f.fill(step.type.value).catch(() => {})
    }
    if (step.select) await page.locator(step.select.selector).selectOption(step.select.value).catch(() => {})
    await page.waitForTimeout(500)
  }

  const file = path.join(OUT, `${ch.id}.png`)
  await page.screenshot({ path: file })
  // clientWidth is NOT the probe to use: with `zoom` on the root element it
  // still reports the unzoomed viewport, which reads as "zoom did not apply"
  // when it did. getBoundingClientRect is in layout px and does reflect it.
  const probe = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    return {
      layoutW: Math.round(document.documentElement.getBoundingClientRect().width),
      // Any dialog taller than the frame loses its footer off the bottom edge.
      dialogH: dialog ? Math.round(dialog.getBoundingClientRect().height) : null,
      frameH: window.innerHeight,
    }
  })
  const overflow = probe.dialogH && probe.dialogH > probe.frameH ? `  !! DIALOG ${probe.dialogH} > frame ${probe.frameH}` : ""
  console.log(
    `  ${ch.id.padEnd(16)} layout ${probe.layoutW}px` +
      (probe.dialogH ? `  dialog ${probe.dialogH}px` : "") +
      `  -> ${path.basename(file)}${overflow}`,
  )
}

await browser.close()
console.log(`\nscreenshots: ${OUT}`)
