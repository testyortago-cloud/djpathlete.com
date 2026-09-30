// Photographs the "New manual post" box with Post type = Video in the REAL
// admin calendar: the upload box it now has, Create waiting for the video, and
// the box after a video has been uploaded.
//
//   npx next dev --webpack -p 3061
//   APP=http://localhost:3061 VIDEO=/path/to/clip.mp4 node scripts/capture-manual-video-post.mjs
//
// DEV CLONE ONLY, and it refuses any other project ref outright.
//
// The upload's first step (POST /api/admin/videos) is the real route against the
// dev clone; the row it creates is deleted at the end. The file bytes and the
// thumbnail are answered BY THIS SCRIPT (page.route), because the signed URL
// points at the Firebase bucket, which is not a dev-only store. Create is never
// clicked: nothing is scheduled.

import { readFileSync } from "node:fs"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const VIDEO = process.env.VIDEO
const OUT = "screenshots/manual-video-post"
const RAW = `${OUT}/raw`
const WIDTH = 1440
const HEIGHT = 1000
const DSF = 2

if (!VIDEO) throw new Error("set VIDEO to a small .mp4 to choose in the file picker")

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

mkdirSync(RAW, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
const createdVideoIds = []

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
  await page.mouse.move(2, 2) // park the pointer so no hover state leaks in
  const raw = `${RAW}/${name}`
  await page.screenshot({ path: raw })
  await annotate(raw, `${OUT}/${name}`, { title, subtitle, markers: markers.filter(Boolean) })
  console.log(`wrote ${OUT}/${name}`)
}

try {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/content`)
  const session = await (await ctx.request.get(`${APP}/api/auth/session`)).json()
  if (session?.user?.role !== "admin") throw new Error(`no admin session: ${JSON.stringify(session)}`)
  // Without this cookie the dev clone selects a seeded test business.
  await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])

  // Bytes and thumbnail never leave the browser (see header).
  await page.route(/storage\.googleapis\.com|firebasestorage\.googleapis\.com/, (r) =>
    r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "" }) : r.continue(),
  )
  await page.route("**/api/admin/videos/*/thumbnail**", (r) => r.abort())
  page.on("response", async (res) => {
    if (res.request().method() === "POST" && new URL(res.url()).pathname === "/api/admin/videos") {
      const body = await res.json().catch(() => null)
      if (body?.videoUploadId) createdVideoIds.push(body.videoUploadId)
    }
  })

  await page.goto(`${APP}/admin/content?tab=calendar&view=month`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
  await page.waitForTimeout(1500) // hydration: a click before it is swallowed
  // Tomorrow, not today: a post for today would default to a time already past.
  const today = page.locator("[role=gridcell][data-today]").first()
  await today.waitFor()
  const cells = page.locator("[role=gridcell]")
  const todayIndex = await today.evaluate((el) => Array.from(el.parentElement.parentElement.querySelectorAll("[role=gridcell]")).indexOf(el))
  await cells.nth(todayIndex >= 0 ? todayIndex + 1 : 0).click()

  const typeSelect = page.getByRole("combobox", { name: "Post type" })
  await typeSelect.waitFor()
  if ((await typeSelect.inputValue()) !== "video") console.warn("WARN: post type did not open on Video")
  const platforms = page.locator("fieldset").filter({ hasText: "Platforms" })
  await platforms.getByText("facebook", { exact: true }).click() // Instagram is pre-ticked
  await page.getByRole("textbox", { name: "Caption" }).fill(
    "3 cues that fixed my athletes' first step. Save this for your next speed session.",
  )
  const dropZone = page.getByText("Drop a video here or click to choose")
  await dropZone.waitFor()
  const create = page.getByRole("button", { name: /^Create/ })
  if (!(await create.isDisabled())) console.warn("WARN: Create is enabled before any video — the fix is not running")

  await shot(page, "01-video-needs-upload.png", "Video post: there is now a place to upload the video", "Create stays greyed out until the video is uploaded, so a post can never go out empty.", [
    await markerFor(typeSelect, "Post type: Video"),
    await markerFor(dropZone, "Upload the video here"),
    await markerFor(create, "Greyed out: no video yet", "after"),
  ])

  await page.locator("#video-uploader-input").setInputFiles(VIDEO)
  const done = page.getByText(/uploaded$/).first()
  await done.waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)
  if (await create.isDisabled()) console.warn("WARN: Create is still disabled after the upload")
  await shot(page, "02-video-uploaded.png", "After the upload, Create unlocks", "One video, sent to every platform ticked. Each post is scheduled on the calendar.", [
    await markerFor(done, "The uploaded video"),
    await markerFor(create, "Create 2 posts", "after"),
  ])
} finally {
  await browser.close()
  for (const id of createdVideoIds) {
    const { error } = await db.from("video_uploads").delete().eq("id", id)
    console.log(error ? `WARN: could not delete video_uploads ${id}: ${error.message}` : `deleted dev-clone video_uploads ${id}`)
  }
}
