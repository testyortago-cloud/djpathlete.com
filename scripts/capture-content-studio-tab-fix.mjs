// Annotated proof for the Content Studio tab-navigation fix (2026-09-21).
//
// Drives the REAL admin app on localhost:3050 -- no harness, no mock page.
// Markers are derived from live boundingBox() values multiplied by the
// capture's deviceScaleFactor, never hand-typed pixels.
//
//   node scripts/capture-content-studio-tab-fix.mjs
//
// The "before" frame cannot be produced by this script (it needs the bug back
// in the tree), so it is captured once by hand and annotated here if present.
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

dotenv.config({ path: ".env.local" })

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3050"
const OUT = "screenshots/content-studio-tab-fix"
const DSF = 2
// Raw frames are intermediates, not deliverables -- the annotated PNGs are what
// ships, and no other screenshots/ folder tracks a raw/ subdirectory. Keep them
// out of the repo so a re-run leaves no untracked noise behind.
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), "cs-tab-fix-"))

const email = process.env.ADMIN_TEST_EMAIL
const password = process.env.ADMIN_TEST_PASSWORD
if (!email || !password) throw new Error("ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD missing from .env.local")

// boundingBox() is in CSS px; the capture is DSF times that.
async function marker(locator, caption, { dx = 0, dy = 0 } = {}) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`no bounding box for marker: ${caption}`)
  return { x: (box.x + box.width / 2 + dx) * DSF, y: (box.y + box.height / 2 + dy) * DSF, caption }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DSF })
const page = await ctx.newPage()

async function raw(name) {
  const p = path.join(RAW, name)
  await page.mouse.move(1430, 890) // park the pointer so it never sits on the subject
  await page.screenshot({ path: p })
  return p
}

console.log("login")
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
await page.fill("input[name='email']", email)
await page.fill("input[name='password']", password)
await page.click("button[type='submit']")
await page.waitForURL(/\/admin/, { timeout: 60000 })

console.log("find a video")
await page.goto(`${BASE}/admin/content?tab=videos`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle")
const href = await page.locator('a[href^="/admin/content/"]').first().getAttribute("href")

console.log("detail page:", href)
await page.goto(BASE + href, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle")
await page.waitForTimeout(1800) // hydrate before clicking a Link

const tabs = page.getByRole("main").getByRole("navigation")
const insights = tabs.getByRole("link", { name: "Insights", exact: true })
// The page's own <h1> is the video's name; the first <h1> is "Content Studio".
const videoTitle = page.getByRole("main").getByRole("heading", { level: 1 }).nth(1)

// Measured ONCE here and reused for the before frame, which was captured on
// this same route at this same viewport. Never hand-type these: a first pass
// typed coordinates read off a scaled preview and put both discs on the wrong
// elements.
// Offset each disc clear of the words it points at -- centred, it sat on top of
// "Insights" and "Kipton", hiding the very labels the caption names.
const insightsMarker = await marker(insights, "“Insights” looks selected.", { dx: 78 })
const videoMarker = await marker(videoTitle, "...but the video is still the whole page. The tab went nowhere.", {
  dx: 74,
})

const shot1 = await raw("01-detail-page.png")
await annotate(shot1, path.join(OUT, "01-detail-page.png"), {
  title: "1. A video, opened from Content Studio",
  subtitle: "The studio's six tabs sit above the video. This is the screen the tabs are clicked from.",
  markers: [
    { ...insightsMarker, caption: "The tab strip stays on screen while you look at a video." },
    { ...videoMarker, caption: "The video you are looking at." },
  ],
})

console.log("click Insights")
await insights.click()
await page.waitForURL(/\/admin\/content\?tab=insights$/, { timeout: 15000 })
await page.waitForLoadState("networkidle")

const shot2 = await raw("02-insights.png")
await annotate(shot2, path.join(OUT, "02-after-insights.png"), {
  title: "2. FIXED — clicking a tab now opens that tab",
  subtitle:
    "Clicking “Insights” leaves the video and shows the Insights numbers. Before the fix the video stayed on screen.",
  markers: [
    await marker(insights, "“Insights” is underlined, and the address ends in /admin/content?tab=insights."),
    await marker(
      page.getByRole("heading", { name: /What your team has been making/ }),
      "The Insights numbers — the video is gone.",
    ),
  ],
})

// The posting message. Only ever clicked on a video that is STILL GATED, so
// the route answers 409 before it writes anything -- "Mark as ready" is on
// screen exactly when the video is gated, which is the check below.
console.log("capture the gated publish message")
await page.goto(BASE + href, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle")
const gated = await page.getByRole("button", { name: /Mark as ready/ }).count()
const publish = page.getByRole("button", { name: /^Publish now$/ })
// Each post row is collapsed until its platform header is clicked, so
// "Publish now" does not exist in the DOM until the row is opened.
if (gated && (await publish.count()) === 0) {
  const row = page.locator("main button").filter({ hasText: /Facebook|Instagram|TikTok|YouTube/ })
  if (await row.count()) {
    await row.first().click()
    await page.waitForTimeout(900)
  }
}
if (gated && (await publish.count())) {
  await page.waitForTimeout(1800)
  await publish.first().scrollIntoViewIfNeeded()
  await publish.first().click()
  const toastEl = page.locator("[data-sonner-toast]").first()
  await toastEl.waitFor({ timeout: 15000 })
  const shot3 = await raw("04-toast.png")
  await annotate(shot3, path.join(OUT, "04-gated-publish-toast.png"), {
    title: "3. FIXED — the message reads as a sentence",
    subtitle:
      "Sending a post for a video that has not been marked ready used to show the raw computer reply, braces and all. Now it shows the sentence.",
    // Sit the disc just OUTSIDE the toast's left edge, derived from its own
    // width, so it never covers the sentence it is pointing at.
    markers: [
      await marker(toastEl, 'Was: {"error":"Source video still needs editing — mark it ready to post."}', {
        dx: -((await toastEl.boundingBox()).width / 2 + 34),
      }),
    ],
  })
} else {
  console.log("  skipped: no gated video with a post in this environment")
}

// The before frame, captured by hand with the old code in the tree.
const beforeRaw = path.join(OUT, "00-before-tab-goes-nowhere.png")
if (fs.existsSync(beforeRaw)) {
  await annotate(beforeRaw, path.join(OUT, "00-before.png"), {
    title: "BEFORE — the tab lit up but nothing opened",
    subtitle:
      "“Insights” is underlined and the address changed, yet the video is still on screen. Every tab did this from a video.",
    markers: [insightsMarker, videoMarker],
  })
  console.log("annotated the before frame")
}

fs.writeFileSync(
  path.join(OUT, "review.html"),
  `<!doctype html><meta charset="utf-8"><title>Content Studio tab fix</title>
<style>body{font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#223b44}
img{width:100%;border:1px solid #dde5e8;border-radius:10px;margin:12px 0 34px}h1{color:#0E3F50}code{background:#f2f6f7;padding:2px 6px;border-radius:4px}</style>
<h1>Content Studio — tabs did nothing when opened from a video</h1>
<p>Reported by video on 2026-09-21. Captured against the real admin app at <code>${BASE}</code>.</p>
<h2>Before</h2><img src="00-before.png" alt="Before: Insights underlined but the video is still on screen">
<h2>After</h2><img src="01-detail-page.png" alt="A video open in Content Studio">
<img src="02-after-insights.png" alt="After: clicking Insights opens the Insights tab">
<h2>The error message</h2><img src="04-gated-publish-toast.png" alt="The publish message, now shown as a sentence">
`,
)

await browser.close()
console.log("done ->", OUT)
