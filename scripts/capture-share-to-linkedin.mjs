// Photographs "Share to LinkedIn" in the REAL admin: the blog list, the blog
// edit header, the newsletter list, the button's states, the draft it lands in
// Content Studio (where drafts are reviewed), and its new Text option.
//
//   npx next dev --webpack -p 3050
//   node scripts/capture-share-to-linkedin.mjs
//
// DEV CLONE ONLY, and it refuses any other project ref outright.
//
// The share request is answered BY THIS SCRIPT for the "Writing…" and "Draft
// already in Content Studio" states (page.route). A real 202 would create an ai_jobs
// document that the DEPLOYED Firebase function picks up, and that function
// reads and writes PRODUCTION Supabase. The "Connect LinkedIn first" failure is
// the real route's real answer: LinkedIn is not connected on the dev clone.
// "Draft ready" is NOT captured: it needs a finished agent job, i.e. the
// deployed function against production. The draft it would link to is shown
// in Content Studio instead (a dev-clone row seeded by hand).

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/share-to-linkedin"
const RAW = `${OUT}/raw`
const WIDTH = 1440
const HEIGHT = 1000
const DSF = 2

const BLOG_ID = "b4c7bbe9-fb29-4e66-ab60-37255495cbe3" // "Change of Direction Biomechanics" (published)
const NEWSLETTER_ID = "3377a71f-7c7c-4b9b-932a-fa35958bf8f5" // scheduled issue
const DRAFT_ID = "31562776-6a62-480e-9872-f269af9e3b38" // dev-clone LinkedIn draft for BLOG_ID
const REVIEW = { label: "Content Studio", listHref: "/admin/content?tab=posts", postHrefPrefix: "/admin/content/post/" }

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

mkdirSync(RAW, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

async function markerFor(locator, caption, place = "before") {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) {
    console.warn(`WARN: no box for marker "${caption}" — it will be missing`)
    return null
  }
  const x = place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round(x * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

async function open(page, path) {
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  if (!page.url().includes(path.split("?")[0])) throw new Error(`did not reach ${path} (at ${page.url()})`)
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
  await page.waitForTimeout(1500) // hydration: a click before it is swallowed
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
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/blog`)
  const session = await (await ctx.request.get(`${APP}/api/auth/session`)).json()
  if (session?.user?.role !== "admin") throw new Error(`no admin session: ${JSON.stringify(session)}`)
  // Without this cookie the dev clone selects a seeded test business
  // ("Northcrest Barbell 10E"); the real seeded data lives on "Primary".
  await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])

  // 01 — blog list: the icon on a published row, none on drafts.
  await open(page, "/admin/blog")
  const shareIcon = page.getByRole("button", { name: "Share to LinkedIn" }).first()
  await shareIcon.waitFor()
  const draftActions = page.getByTitle("Publish").first() // a draft row: Publish, Schedule, Edit, Delete — no LinkedIn
  await shot(page, "01-blog-list.png", "Blog: Share to LinkedIn on every published post", "Drafts have no button: there is nothing live to link to yet.", [
    await markerFor(shareIcon, "LinkedIn button on a published post"),
    await markerFor(draftActions, "Drafts: no LinkedIn button"),
  ])

  // 02 — blog edit header.
  await open(page, `/admin/blog/${BLOG_ID}/edit`)
  const fullButton = page.getByRole("button", { name: "Share to LinkedIn" })
  await fullButton.waitFor()
  await shot(page, "02-blog-edit-header.png", "The same button at the top of a published post", "One click writes a LinkedIn post about this article and puts it in Content Studio for review.", [
    await markerFor(fullButton, "Share to LinkedIn"),
  ])

  // 03 — REAL failure: LinkedIn is not connected on the dev clone.
  await fullButton.click()
  const toast = page.getByText("Connect LinkedIn first (Platform connections)")
  await toast.waitFor({ timeout: 10000 })
  await page.waitForTimeout(900) // let the toast finish sliding in
  await shot(page, "03-not-connected.png", "If LinkedIn is not connected, it says so and creates nothing", "This is the real answer from the server: LinkedIn is not connected on the test database.", [
    await markerFor(toast, "Plain-words reason", "before"),
  ])
  await page.waitForTimeout(4500) // let the toast leave before the next state

  // 04 — "Writing…": the share request is answered by this script (see header).
  await page.route("**/api/admin/social/share", (r) =>
    r.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: "capture-no-such-job", review: REVIEW }) }),
  )
  await open(page, `/admin/blog/${BLOG_ID}/edit`)
  await page.getByRole("button", { name: "Share to LinkedIn" }).click()
  const writing = page.getByRole("button", { name: "Writing LinkedIn post…" })
  await writing.waitFor()
  await shot(page, "04-writing.png", "While the post is being written", "The button locks, so a second click cannot write a second post. It takes about a minute.", [
    await markerFor(writing, "Writing LinkedIn post…"),
  ])
  await page.unroute("**/api/admin/social/share")

  // 05 — "Draft already in Content Studio". The body is what the real route
  // answers with Content Studio on (as in production), for the dev-clone draft
  // seeded for this capture.
  await page.route("**/api/admin/social/share", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ existingPostId: DRAFT_ID, review: REVIEW }),
    }),
  )
  await open(page, `/admin/blog/${BLOG_ID}/edit`)
  await page.getByRole("button", { name: "Share to LinkedIn" }).click()
  const already = page.getByRole("link", { name: /Draft already in Content Studio/ })
  await already.waitFor()
  const href = await already.getAttribute("href")
  if (href !== `/admin/content/post/${DRAFT_ID}`) throw new Error(`deep link is ${href}`)
  await shot(page, "05-already-in-content-studio.png", "Shared before? It takes you to that draft instead", "No second post is written while the first one has not been posted.", [
    await markerFor(already, "Opens that draft in Content Studio"),
  ])
  await page.unroute("**/api/admin/social/share")

  // 05b — follow the link: the real post page for that draft.
  await already.click()
  await page.waitForURL(`**/admin/content/post/${DRAFT_ID}`)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(1500)
  const draftBody = page.getByText("Most athletes don't lose games", { exact: false }).first()
  await draftBody.waitFor({ timeout: 10000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const captionBox = page.locator("textarea").first()
  await shot(page, "05b-the-draft.png", "The LinkedIn draft, ready to edit and approve", "Change the words if you like, then approve, post now or schedule it.", [
    await markerFor(captionBox, "The post, written in Darren's voice"),
  ])

  // 06 — newsletter list: scheduled issue has the button.
  await open(page, "/admin/newsletter")
  const nlIcon = page.getByRole("button", { name: "Share to LinkedIn" }).first()
  await nlIcon.waitFor()
  await shot(page, "06-newsletter-list.png", "Newsletter: the same button on sent and scheduled issues", "The post teases the issue and invites people to subscribe. Its link opens the sign-up form.", [
    await markerFor(nlIcon, "LinkedIn button on a scheduled issue"),
  ])

  // 07 — the draft, where drafts are reviewed. With Content Studio on (it is in
  // production and on the dev clone) /admin/social redirects to its Posts tab.
  await open(page, "/admin/content?tab=posts")
  const draftText = page.getByText("Most athletes don't lose games", { exact: false }).first()
  await draftText.waitFor({ timeout: 10000 })
  await shot(page, "07-drafts-in-content-studio.png", "Drafts wait in Content Studio, under Posts", "Nothing goes to LinkedIn until you post or schedule it here.", [
    await markerFor(draftText, "The LinkedIn draft"),
  ])

  // 08 — Content Studio: Text option in the manual post box.
  await open(page, "/admin/content?tab=calendar&view=month")
  await page.locator("[role=gridcell][data-today]").first().click()
  const typeSelect = page.getByRole("combobox", { name: "Post type" })
  await typeSelect.waitFor()
  await typeSelect.selectOption("text")
  // Scoped to the post box: the calendar's own filter sidebar also lists
  // "Instagram"/"LinkedIn". The DOM text is lower-case ("linkedin"); CSS capitalises it.
  const platforms = page.locator("fieldset").filter({ hasText: "Platforms" })
  await platforms.getByText("linkedin", { exact: true }).click()
  await platforms.getByText("instagram", { exact: true }).click()
  if (!(await platforms.getByText("(1 selected)").isVisible())) console.warn("WARN: platform selection is not exactly LinkedIn")
  await page.getByRole("textbox", { name: "Caption" }).fill(
    "New on the blog: why change of direction is a braking skill first. Three things we train for it this season.",
  )
  await shot(page, "08-manual-text-post.png", "Content Studio: a Text post, no photo or video needed", "Pick Text, choose LinkedIn, write the post. It appears on the calendar like any other post.", [
    await markerFor(typeSelect, "Post type: Text"),
    await markerFor(page.getByRole("textbox", { name: "Caption" }), "The post itself"),
  ])
} finally {
  await browser.close()
}
