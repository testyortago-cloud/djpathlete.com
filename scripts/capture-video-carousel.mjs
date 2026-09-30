// Photographs, in the REAL admin calendar's "New manual post" box:
//   01 — a Video post playing back the uploaded clip before it is created
//   02 — a Carousel with a photo and a video slide, Facebook skipped with the reason
//
//   npx next dev --webpack -p 3061
//   APP=http://localhost:3061 VIDEO=/path/to/clip.mp4 node scripts/capture-video-carousel.mjs
//
// DEV CLONE ONLY, and it refuses any other project ref outright. Runs in Google
// Chrome (channel "chrome"): Playwright's bundled Chromium cannot decode H.264,
// so an MP4 would show a black player.
//
// The uploads' first steps are the real routes against the dev clone
// (POST /api/admin/videos, POST /api/admin/media-assets/upload-url); the rows they
// create are deleted at the end. File bytes and thumbnails are answered BY THIS
// SCRIPT (page.route) because signed URLs point at the shared Firebase bucket.
// The photo slide comes from the Library, so no photo upload queues the
// alt-text AI job. Create is never clicked: nothing is scheduled.

import { readFileSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const VIDEO = process.env.VIDEO
const OUT = "screenshots/video-carousel"
const RAW = `${OUT}/raw`
const WIDTH = 1440
const HEIGHT = 1100
const DSF = 2

if (!VIDEO) throw new Error("set VIDEO to a small H.264 .mp4")

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

mkdirSync(RAW, { recursive: true })
const browser = await chromium.launch({ channel: "chrome" })
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
const created = { video_uploads: [], media_assets: [] }

async function markerFor(locator, caption, place = "before") {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) {
    console.warn(`WARN: no box for marker "${caption}" — it will be missing`)
    return null
  }
  const x = place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round(x * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

async function shot(page, name, title, subtitle, markers) {
  await page.mouse.move(2, 2)
  const raw = `${RAW}/${name}`
  await page.screenshot({ path: raw })
  await annotate(raw, `${OUT}/${name}`, { title, subtitle, markers: markers.filter(Boolean) })
  console.log(`wrote ${OUT}/${name}`)
}

// Seek the player so the frame shows the clip, not a black first frame.
async function showFrame(video) {
  await video.evaluate(
    (el) =>
      new Promise((resolve) => {
        const done = () => resolve(undefined)
        const seek = () => {
          el.addEventListener("seeked", done, { once: true })
          el.currentTime = Math.min(0.8, (el.duration || 1) / 2)
        }
        if (el.readyState >= 1) seek()
        else el.addEventListener("loadedmetadata", seek, { once: true })
        setTimeout(done, 5000)
      }),
  )
  const ok = await video.evaluate((el) => el.readyState >= 2 && el.videoWidth > 0)
  if (!ok) console.warn("WARN: the player did not decode a frame — the capture will show a black box")
}

async function openBox(page) {
  await page.goto(`${APP}/admin/content?tab=calendar&view=month`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
  await page.waitForTimeout(1500)
  const today = page.locator("[role=gridcell][data-today]").first()
  await today.waitFor()
  const todayIndex = await today.evaluate((el) =>
    Array.from(el.parentElement.parentElement.querySelectorAll("[role=gridcell]")).indexOf(el),
  )
  await page.locator("[role=gridcell]").nth(todayIndex >= 0 ? todayIndex + 1 : 0).click()
  await page.getByRole("combobox", { name: "Post type" }).waitFor()
}

try {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/content`)
  const session = await (await ctx.request.get(`${APP}/api/auth/session`)).json()
  if (session?.user?.role !== "admin") throw new Error(`no admin session: ${JSON.stringify(session)}`)
  await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])

  await page.route(/storage\.googleapis\.com|firebasestorage\.googleapis\.com/, (r) =>
    r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "" }) : r.continue(),
  )
  await page.route("**/api/admin/videos/*/thumbnail**", (r) => r.abort())
  page.on("response", async (res) => {
    if (res.request().method() !== "POST") return
    const path = new URL(res.url()).pathname
    const body = await res.json().catch(() => null)
    if (path === "/api/admin/videos" && body?.videoUploadId) created.video_uploads.push(body.videoUploadId)
    if (path === "/api/admin/media-assets/upload-url" && body?.mediaAssetId) created.media_assets.push(body.mediaAssetId)
  })

  // 01 — Video post: the uploaded clip plays in the box.
  await openBox(page)
  const platforms = page.locator("fieldset").filter({ hasText: "Platforms" })
  await platforms.getByText("facebook", { exact: true }).click()
  await page.getByRole("textbox", { name: "Caption" }).fill(
    "3 cues that fixed my athletes' first step. Save this for your next speed session.",
  )
  await page.locator("#video-uploader-input").setInputFiles(VIDEO)
  const player = page.getByLabel(/^Preview of /)
  await player.waitFor({ timeout: 20000 })
  await showFrame(player)
  await shot(page, "01-video-post-preview.png", "Video post: watch the clip before you create the post", "It plays straight from your computer, so you can check it is the right video.", [
    await markerFor(page.getByText(/uploaded$/).first(), "Uploaded"),
    await markerFor(player, "Play it here"),
    await markerFor(page.getByRole("button", { name: /^Create/ }), "Create 2 posts", "after"),
  ])
  await page.getByRole("button", { name: "Cancel" }).click()

  // 02 — Carousel: a photo from the Library + a video slide; Facebook skipped.
  await openBox(page)
  await page.getByRole("combobox", { name: "Post type" }).selectOption("carousel")
  const platforms2 = page.locator("fieldset").filter({ hasText: "Platforms" })
  await platforms2.getByText("facebook", { exact: true }).click()
  await page.getByRole("button", { name: /Library/ }).first().click()
  const firstAsset = page.locator("ul.grid li button").first()
  await firstAsset.waitFor({ timeout: 15000 })
  await firstAsset.dblclick()
  await page.getByRole("button", { name: /Add slide/ }).click()
  await page.locator("input[type=file][accept*='video/mp4']").last().setInputFiles(VIDEO)
  const slidePlayer = page.getByLabel(/^Preview of /)
  await slidePlayer.waitFor({ timeout: 20000 })
  await showFrame(slidePlayer)
  await page.getByRole("textbox", { name: "Caption" }).fill("Swipe: the drill, then the cue that fixes it.")
  const skipNote = page.getByText(/support videos in a carousel and will be skipped/)
  await skipNote.waitFor()
  await shot(page, "02-carousel-with-video.png", "Carousel: photos and videos, for Instagram", "Facebook and LinkedIn only take photos in a carousel, so the box skips them and says why.", [
    await markerFor(slidePlayer, "Video slide, playable"),
    await markerFor(platforms2.getByText("facebook", { exact: true }), "Facebook: skipped"),
    await markerFor(skipNote, "Why it is skipped"),
    await markerFor(page.getByRole("button", { name: /^Create/ }), "One post: Instagram", "after"),
  ])
} finally {
  await browser.close()
  for (const id of created.video_uploads) {
    const { error } = await db.from("video_uploads").delete().eq("id", id)
    console.log(error ? `WARN: could not delete video_uploads ${id}: ${error.message}` : `deleted dev-clone video_uploads ${id}`)
  }
  for (const id of created.media_assets) {
    const { error } = await db.from("media_assets").delete().eq("id", id)
    console.log(error ? `WARN: could not delete media_assets ${id}: ${error.message}` : `deleted dev-clone media_assets ${id}`)
  }
}
