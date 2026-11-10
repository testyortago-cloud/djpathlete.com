// Real-app capture: Instagram Stories in Content Studio (video page section, Pipeline lane,
// "Spread over a day", Delete video).
//
// DEV CLONE ONLY. It WRITES to the clone, through the real buttons: one video story on Knee injuries
// and Ava, three quote-card stories on Knee injuries (one OpenRouter call + three JPEGs in Firebase
// Storage), two photo stories, and schedules them for tomorrow. The clone has no publish cron,
// so nothing is posted anywhere. Setup by SQL first: removes earlier story rows and sets two
// true video lengths, read from the player (the clone's uploads have none; prod's are filled by the AssemblyAI webhook from now on).
// It opens "Delete video" and presses "Keep it" — it never deletes.
//
// Run (dev server on 3051): node scripts/capture-ig-stories.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { encode } from "next-auth/jwt"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/ig-stories"
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const KNEE = "37378b65-bedc-40c5-b12b-619413494fb8"
const AVA = "b7d56e40-7dff-42e3-bc3e-554bc8bc416c"
const PHOTOS = ["public/images/gym-training-01.jpg", "public/images/gym-training-02.jpg"]
const W = 1440
const H = 900
mkdirSync(`${OUT}/raw`, { recursive: true })

const check = (name, ok, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}
const hideDevChrome = (page) =>
  page
    .addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
    .catch((e) => console.warn(`WARN hideDevChrome failed, dev overlay may show: ${e.message.split("\n")[0]}`))
const park = (page) => page.mouse.move(W - 5, H - 5)
/** Every <img> in `selector` decoded, so no thumbnail is blank in the shot. */
const imagesLoaded = (page, selector) =>
  page
    .waitForFunction(
      (sel) =>
        [...document.querySelectorAll(`${sel} img`)]
          .filter((i) => i.getBoundingClientRect().top < window.innerHeight) // lazy ones below the fold never load
          .every((i) => i.complete && i.naturalWidth > 0),
      selector,
      { timeout: 30000 },
    )
    .catch(() => console.warn(`WARN some images in ${selector} never loaded`))

// ── Setup on the clone ───────────────────────────────────────────────────────
{
  const { error: dErr } = await db.from("social_posts").delete().eq("post_type", "story")
  if (dErr) throw Error(`clear stories: ${dErr.message}`)
  for (const [id, secs] of [
    [KNEE, 37],
    [AVA, 32],
  ]) {
    const { error } = await db.from("video_uploads").update({ duration_seconds: secs, needs_edit: true }).eq("id", id)
    if (error) throw Error(`set duration: ${error.message}`)
  }
}

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const { data: admin } = await db
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", env.DEV_AUTH_BYPASS_EMAIL)
    .single()
  if (admin?.role !== "admin") throw Error(`DEV_AUTH_BYPASS_EMAIL is not an admin on the clone`)
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: {
      id: admin.id,
      sub: admin.id,
      email: admin.email,
      name: `${admin.first_name} ${admin.last_name}`,
      role: admin.role,
    },
    maxAge: 60 * 60,
  })
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" },
    { name: "djp_business", value: PRIMARY, url: APP },
  ])

  // ── 1. Knee injuries: add the video to the story, then make quote stories ─────────
  await page.goto(`${APP}/admin/content/${KNEE}`, { waitUntil: "load", timeout: 180000 })
  check("signed in as admin", !page.url().includes("/login"), page.url())
  await hideDevChrome(page)
  const stories = page.locator('section[aria-labelledby="stories-heading"]')
  await stories.getByRole("heading", { name: "Instagram Stories (0)" }).waitFor({ timeout: 60000 })
  check("Knee injuries starts with no stories", true)
  await page.getByRole("button", { name: "Add this video to the story" }).click()
  await stories.getByRole("heading", { name: "Instagram Stories (1)" }).waitFor({ timeout: 60000 })
  check("video story added through the button", true)
  await page.getByRole("button", { name: "Make 3 quote stories" }).click()
  await stories.getByRole("heading", { name: "Instagram Stories (4)" }).waitFor({ timeout: 180000 })
  check("three quote stories made from the transcript", true)
  await stories.locator("img").nth(2).waitFor({ timeout: 30000 })
  const imgs = await stories.locator("img").count()
  check("quote stories show their card thumbnails", imgs >= 3, `${imgs} images`)
  await page.getByRole("heading", { name: "Posts (6)" }).waitFor()
  check("feed posts stay at 6 (stories are counted separately)", true)

  await stories.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -88))
  await park(page)
  await page.waitForTimeout(400)
  await imagesLoaded(page, `section[aria-labelledby="stories-heading"]`)
  await page.screenshot({ path: `${OUT}/raw/01-video-stories.png` })
  await annotate(`${OUT}/raw/01-video-stories.png`, `${OUT}/01-video-page-stories.png`, {
    title: "Each video now has an Instagram Stories section",
    subtitle: "Content Studio > a video (Knee injuries, dev copy). Stories sit under the 6 feed posts, not in them.",
    markers: [
      await marker(
        stories.getByRole("heading", { name: "Instagram Stories (4)" }),
        "Stories are listed apart from the 6 feed posts, so “Publish all” never sends them by surprise.",
        "after",
      ),
      await marker(
        stories.getByRole("button", { name: "Make 3 quote stories" }),
        "Turns 3 lines from what was said into tall story cards, in brand colours.",
        "after",
      ),
      await marker(
        stories.getByText("Video story").first(),
        "The video's own story. It posts the same video as the Instagram reel.",
        "after",
      ),
      await marker(
        stories.getByText("Photo story").first(),
        "A quote card. Open a row to post it now or pick a time.",
        "after",
      ),
    ],
  })

  // ── 1b. A story row opened ───────────────────────────────────────────────
  await stories.getByText("Photo story").first().click()
  await stories
    .getByRole("button", { name: /^Schedule$/ })
    .first()
    .waitFor()
  await park(page)
  await imagesLoaded(page, `section[aria-labelledby="stories-heading"]`)
  await page.screenshot({ path: `${OUT}/raw/02-story-row-open.png` })
  await annotate(`${OUT}/raw/02-story-row-open.png`, `${OUT}/02-story-row-open.png`, {
    title: "A story has no caption, and can now be scheduled",
    subtitle: "Same page, one quote story opened.",
    markers: [
      await marker(
        stories.getByText(/Instagram does not show captions on stories/),
        "No caption box: Instagram does not show captions on stories.",
        "after",
      ),
      await marker(
        stories.getByRole("button", { name: /^Schedule$/ }).first(),
        "New: stories can be given a time, like any other post.",
        "above",
      ),
      await marker(stories.getByRole("button", { name: /Publish now/ }).first(), "Or send it at once.", "above"),
    ],
  })

  // ── 2. Ava: add her video to the story too ────────────────────────────────
  // No over-60-second shot: every video on the dev copy is under 60 s (longest 54.7 s, read from
  // the player), and faking a length would contradict the player on the same page. The warning
  // is covered by VideoDetailPage.test.tsx and story-media.test.ts.
  await page.goto(`${APP}/admin/content/${AVA}`, { waitUntil: "load", timeout: 180000 })
  await hideDevChrome(page)
  const avaStories = page.locator('section[aria-labelledby="stories-heading"]')
  await page.getByRole("button", { name: "Add this video to the story" }).click()
  await avaStories.getByRole("heading", { name: "Instagram Stories (1)" }).waitFor({ timeout: 60000 })
  check("a 32-second video gets no length warning", (await avaStories.getByText(/60 seconds at most/).count()) === 0)

  // ── 3. Pipeline: the Stories lane, add photos ─────────────────────────────
  await page.goto(`${APP}/admin/content`, { waitUntil: "load", timeout: 180000 })
  await hideDevChrome(page)
  const lane = page.getByRole("region", { name: "Instagram Stories" })
  await lane.waitFor({ timeout: 60000 })
  const chooser = page.waitForEvent("filechooser")
  await lane.getByRole("button", { name: "Add photos" }).click()
  await (await chooser).setFiles(PHOTOS)
  await lane.getByRole("button", { name: "Add photos" }).waitFor({ timeout: 120000 })
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('section[aria-label="Instagram Stories"] a[href^="/admin/content/post/"]').length >=
        7,
      null,
      { timeout: 60000 },
    )
    .catch(() => console.warn("WARN lane did not reach 7 cards in 60 s"))
  await page.waitForTimeout(1500) // let the photo thumbnails load
  const cards = await lane.locator('a[href^="/admin/content/post/"]').count()
  check("Stories lane holds 2 video + 3 quote + 2 photo stories", cards === 7, `${cards} cards`)
  await lane.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -88))
  await park(page)
  await page.waitForTimeout(500)
  await imagesLoaded(page, `section[aria-label="Instagram Stories"]`)
  await page.screenshot({ path: `${OUT}/raw/04-pipeline-lane.png` })
  await annotate(`${OUT}/raw/04-pipeline-lane.png`, `${OUT}/04-pipeline-stories-lane.png`, {
    title: "The Pipeline has an Instagram Stories lane",
    subtitle:
      "Content Studio > Pipeline (dev copy), under the Posts lane. Two gym photos were just added with “Add photos”.",
    markers: [
      await marker(
        lane.getByRole("button", { name: "Add photos" }),
        "Pick one or many photos from the computer or phone. Each becomes a story waiting for review.",
        "above",
      ),
      await marker(
        lane.getByRole("button", { name: /Spread over a day/ }),
        "Gives every waiting story a time, evenly spaced across one day.",
        "above",
      ),
      await marker(
        lane.getByText("Photo story").first(),
        "A photo story. Drag it to “Approved”, like any post.",
        "after",
      ),
      await marker(
        lane.getByText("Video story").first(),
        "A video's own story. New videos get one automatically.",
        "after",
      ),
    ],
  })

  // ── 4. Spread over a day ──────────────────────────────────────────────────
  await lane.getByRole("button", { name: /Spread over a day/ }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText(/^Times:/).waitFor()
  await page.waitForTimeout(600) // let the open animation finish
  await park(page)
  await page.screenshot({ path: `${OUT}/raw/05-spread.png` })
  await annotate(`${OUT}/raw/05-spread.png`, `${OUT}/05-spread-over-a-day.png`, {
    title: "“Spread over a day” spaces the stories out",
    subtitle: "Stories in “Needs review” and “Approved” get one time each, oldest first.",
    markers: [
      await marker(dialog.getByLabel("Day"), "Pick the day (tomorrow by default).", "before"),
      await marker(dialog.getByLabel("First at"), "First and last story times.", "before"),
      await marker(dialog.getByText(/^Times:/), "Every time it will use, before anything is saved.", "before"),
    ],
  })
  // The dev copy has no Instagram connection, so the schedule route refuses every story
  // ("Connect instagram first…"). Show that refusal as the failure state rather than fake a
  // connection. On the live site Instagram is connected and the stories get their times.
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:block!important}" })
  await dialog.getByRole("button", { name: /^Schedule \d+$/ }).click()
  await dialog.waitFor({ state: "hidden", timeout: 60000 })
  const refusal = page.getByText(/7 not scheduled: Connect instagram first/)
  await refusal.waitFor({ timeout: 60000 })
  check("without an Instagram connection, the refusal is shown in plain words", true)
  await park(page)
  await page.screenshot({ path: `${OUT}/raw/06-not-connected.png` })
  await annotate(`${OUT}/raw/06-not-connected.png`, `${OUT}/06-spread-refused-not-connected.png`, {
    title: "If Instagram is not connected, nothing is scheduled, and it says why",
    subtitle:
      "Dev copy (no Instagram connection). On the live site Instagram is connected and each story gets its time.",
    markers: [await marker(refusal, "The reason, and how many stories were not scheduled.", "above")],
  })

  // ── 5. Delete video (opened, then kept) ───────────────────────────────────
  await page.goto(`${APP}/admin/content/${AVA}`, { waitUntil: "load", timeout: 180000 })
  await hideDevChrome(page)
  await page.getByRole("button", { name: "Delete video" }).click()
  const confirm = page.getByRole("alertdialog")
  await confirm.waitFor()
  await page.waitForTimeout(600) // let the open animation finish
  await park(page)
  await page.screenshot({ path: `${OUT}/raw/07-delete.png` })
  await annotate(`${OUT}/raw/07-delete.png`, `${OUT}/07-delete-video.png`, {
    title: "“Delete video” removes the video and everything not yet posted",
    subtitle: "Content Studio > a video > Delete video. Opened for this picture, then “Keep it” was pressed.",
    markers: [
      await marker(
        confirm.getByText(/This removes the video/),
        "Its posts and stories that have not gone out are deleted with it, so nothing posts later.",
        "above",
      ),
      await marker(
        confirm.getByRole("button", { name: "Delete video" }),
        "Facebook posts waiting in Facebook's own schedule must be unscheduled first; the app says so.",
        "above",
      ),
    ],
  })
  await confirm.getByRole("button", { name: "Keep it" }).click()

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "))
} finally {
  await browser.close()
}
