// Real-app check: at the bottom of the Programs list, the page arrows are clickable,
// not covered by the floating Messages button. Read-only (signs in, scrolls, looks).
//
// Run (dev server on 3051): node scripts/capture-dock-clearance.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/dock-clearance"
const W = 1440
const H = 900
mkdirSync(`${OUT}/raw`, { recursive: true })

const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })).newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/programs`, { waitUntil: "load", timeout: 90000 })
  await page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  const next = page.getByRole("button", { name: /next page/i }).first()
  await next.waitFor({ timeout: 60000 })
  // Scroll every scroll container (and the window) to the very bottom.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight
    }
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  await page.mouse.move(3, 3)
  await page.waitForTimeout(600)
  const box = await next.boundingBox()
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return el?.closest("button")?.getAttribute("aria-label") ?? el?.closest("button")?.textContent?.trim() ?? el?.tagName
  }, [box.x + box.width / 2, box.y + box.height / 2])
  const ok = /next page/i.test(hit ?? "")
  console.log(`${ok ? "PASS" : "FAIL"} element at the next-page arrow's centre: ${hit}`)
  const dock = await page.getByRole("button", { name: /^Messages/ }).last().boundingBox()
  const prev = await page.getByRole("button", { name: /previous page/i }).first().boundingBox()
  await page.screenshot({ path: `${OUT}/raw/01-programs-list-bottom.png` })
  await annotate(`${OUT}/raw/01-programs-list-bottom.png`, `${OUT}/01-programs-list-bottom.png`, {
    title: "The page arrows are no longer under the Messages button",
    subtitle: "Programs list, scrolled to the very bottom",
    markers: [
      { x: Math.round(prev.x - 22), y: Math.round(prev.y + prev.height / 2), caption: "The arrows to the next page can be clicked again." },
      { x: Math.round(dock.x - 22), y: Math.round(dock.y + dock.height / 2), caption: "Messages stays in its corner, below the list. The same space is kept on every admin and client page." },
    ],
  })
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, hit, ok, next: box, dock }, null, 2))
  if (!ok) process.exitCode = 1
} finally {
  await browser.close()
}
