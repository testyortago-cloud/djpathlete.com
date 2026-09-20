// Drives the REAL admin and photographs the two features the owner asked for:
// a settable video thumbnail, and "some basic metrics of analysis".
//
//   npx next dev -p 3061                                            # this worktree
//   APP=http://localhost:3061 npx tsx scripts/capture-media-thumbnails-and-insights.ts .env.local
//
// WHAT EACH SHOT PROVES, and why it exists
//
//   1. thumbnail-picker      The picker on the REAL video detail page: the current
//                            thumbnail, where it came from, and the two ways to change it.
//   2. thumbnail-changed     The SAME page after clicking "Use this frame" at a different
//                            point in the video. This is the one assertion no unit test
//                            could make: that router.refresh() actually re-signs and
//                            re-renders the new image. The label flips to "A frame you
//                            chose" and "Revert to auto" appears, both of which are
//                            rendered from the DATABASE, not from client state.
//   3. team-media-previews   /admin/team-media, which was text-only rows before this branch.
//   4. insights-empty        The Insights tab as production will ACTUALLY open it: nothing
//                            published, so it says so in words instead of showing "0 views".
//   5. insights-measured     The same tab with numbers, so the two are comparable.
//   6. video-performance     All FOUR performance states in one frame — measured,
//                            waiting-for-numbers, platform-not-connected, and not-published.
//                            Distinguishing those four is the whole point of the feature,
//                            and a screenshot is the only place you can see them together.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE (see CLONE_REF — it refuses to start
// otherwise). Production is a different project entirely. Every row it creates is deleted
// on the way out, on the failure path too, BY THE IDS IT CREATED rather than by a predicate,
// so it cannot take anything it did not make. It also flips two platform_connections to
// 'connected' — dev has all eight set to 'not_connected', so without that no post can ever
// render as measured — and restores their prior status in the same finally block.
//
// NOTHING IS PUBLISHED ANYWHERE. The seeded rows are INSERTed directly; the publish flow is
// never invoked, so no request reaches Instagram, YouTube or LinkedIn.

import { readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext, type Browser, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3061"
const OUT = "screenshots/media-thumbnails-and-insights"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const WIDTH = 1440
const HEIGHT = 1200
const DSF = 2

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function hideDevChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

async function shoot(
  page: Page,
  name: string,
  title: string,
  subtitle: string,
  markers: Marker[],
): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  // Park the pointer first — Playwright's virtual mouse stays where it last
  // clicked, so whatever sits under that coordinate is photographed hovered.
  await page.mouse.move(4, 4)
  await page.waitForTimeout(200)
  await hideDevChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  rmSync(raw, { force: true })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

/**
 * A marker on a real element. THROWS rather than degrading to a silent no-op.
 *
 * `place` decides where the numbered disc sits relative to the target. It
 * defaults to "left" — just OUTSIDE the element — because centring a disc on a
 * button or a sentence covers the very words the marker exists to point at.
 * The first run of this script centred everything and hid three of four
 * captions, plus the labels on both buttons. Use "center" only for a target
 * big enough to spare the pixels, like an image.
 */
async function markerAt(
  page: Page,
  selector: string | Locator,
  caption: string,
  place: "left" | "right" | "center" = "left",
): Promise<Marker> {
  const el = typeof selector === "string" ? page.locator(selector).first() : selector.first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${String(selector)}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE (zero box): ${String(selector)}`)
  const view = page.viewportSize()
  if (view && (box.y > view.height || box.y + box.height < 0)) {
    throw new Error(`MARKER TARGET OFF SCREEN: ${String(selector)} at y=${Math.round(box.y)}`)
  }
  // Must exceed the disc's own radius, or 'outside the element' still clips its
  // first characters. At this capture width the disc is ~16 CSS px across the
  // radius, and a GAP of 15 shaved the leading letter off four labels.
  const GAP = 30
  const x =
    place === "center" ? box.x + box.width / 2 : place === "right" ? box.x + box.width + GAP : box.x - GAP
  return {
    x: Math.round(Math.max(GAP, x) * DSF),
    y: Math.round((box.y + box.height / 2) * DSF),
    caption,
  }
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error("No usable Chromium. Run: npx playwright install chromium chromium-headless-shell")
  }
}

async function signInAsAdmin(ctx: BrowserContext, callback: string): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=${encodeURIComponent(callback)}`, {
    waitUntil: "domcontentloaded",
  })
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

interface Seeded {
  postIds: string[]
  analyticsIds: string[]
  restoreConnections: Array<{ plugin_name: string; status: string }>
}

/**
 * Give ONE video a mix of published posts so every performance state is on
 * screen at once. Dev has all eight connections set to 'not_connected', so two
 * are flipped to 'connected' and restored afterwards — without that, nothing can
 * ever render as measured and the shot would only prove one of the four states.
 */
async function seed(db: SupabaseClient, videoId: string): Promise<Seeded> {
  const seeded: Seeded = { postIds: [], analyticsIds: [], restoreConnections: [] }

  const { data: conns, error: connErr } = await db
    .from("platform_connections")
    .select("plugin_name, status")
    .in("plugin_name", ["instagram", "youtube"])
  if (connErr) throw connErr
  seeded.restoreConnections = (conns ?? []) as Array<{ plugin_name: string; status: string }>

  for (const plugin of ["instagram", "youtube"]) {
    const { error } = await db
      .from("platform_connections")
      .update({ status: "connected" })
      .eq("plugin_name", plugin)
    if (error) throw error
  }

  // Borrow a real post's post_type rather than guessing at the enum.
  const { data: sample, error: sampleErr } = await db
    .from("social_posts")
    .select("post_type")
    .eq("source_video_id", videoId)
    .limit(1)
    .single()
  if (sampleErr) throw sampleErr
  const postType = (sample as { post_type: string }).post_type

  const publishedAt = new Date(Date.now() - 3 * 86_400_000).toISOString()

  //  instagram -> connected + a snapshot   => measured
  //  youtube   -> connected, no snapshot   => waiting for numbers
  //  linkedin  -> NOT connected            => platform not connected
  //  (the video's own 6 drafts stay draft  => not published yet)
  const rows = [
    { platform: "instagram", platform_post_id: "seed_ig_1", content: "Kipton highlight — full clip on the channel." },
    { platform: "youtube", platform_post_id: "seed_yt_1", content: "Kipton highlight — full clip on the channel." },
    { platform: "linkedin", platform_post_id: "seed_li_1", content: "Kipton highlight — full clip on the channel." },
  ]

  for (const row of rows) {
    const { data, error } = await db
      .from("social_posts")
      .insert({
        platform: row.platform,
        content: row.content,
        media_url: null,
        post_type: postType,
        approval_status: "published",
        scheduled_at: null,
        published_at: publishedAt,
        source_video_id: videoId,
        rejection_notes: null,
        platform_post_id: row.platform_post_id,
        created_by: null,
      })
      .select("id")
      .single()
    if (error) throw error
    seeded.postIds.push((data as { id: string }).id)
  }

  const { data: snap, error: snapErr } = await db
    .from("social_analytics")
    .insert({
      social_post_id: seeded.postIds[0],
      platform: "instagram",
      platform_post_id: "seed_ig_1",
      impressions: 4820,
      engagement: 391,
      likes: 274,
      comments: 38,
      shares: 79,
      views: 4120,
      extra: null,
      recorded_at: new Date(Date.now() - 86_400_000).toISOString(),
    })
    .select("id")
    .single()
  if (snapErr) throw snapErr
  seeded.analyticsIds.push((snap as { id: string }).id)

  return seeded
}

async function cleanup(db: SupabaseClient, seeded: Seeded): Promise<void> {
  // Delete by the ids we created, never by a predicate.
  if (seeded.analyticsIds.length) {
    const { error } = await db.from("social_analytics").delete().in("id", seeded.analyticsIds)
    if (error) console.error("  cleanup: social_analytics", error.message)
  }
  if (seeded.postIds.length) {
    const { error } = await db.from("social_posts").delete().in("id", seeded.postIds)
    if (error) console.error("  cleanup: social_posts", error.message)
  }
  for (const c of seeded.restoreConnections) {
    const { error } = await db
      .from("platform_connections")
      .update({ status: c.status })
      .eq("plugin_name", c.plugin_name)
    if (error) console.error(`  cleanup: platform_connections ${c.plugin_name}`, error.message)
  }
  console.log(
    `  cleaned up: ${seeded.postIds.length} posts, ${seeded.analyticsIds.length} snapshots, ` +
      `${seeded.restoreConnections.length} connections restored`,
  )
}

async function main(): Promise<void> {
  const envPath = process.argv[2] ?? ".env.local"
  const env = loadEnv(envPath)

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(
    url.includes(CLONE_REF),
    `REFUSING TO RUN: ${envPath} points at ${url}, not the dev clone (${CLONE_REF}). ` +
      `This script writes rows and would be writing them to the wrong database.`,
  )
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  })

  // Pick the subject up front so the seed and the screenshots agree.
  const { data: video, error: videoErr } = await db
    .from("video_uploads")
    .select("id, title, original_filename, thumbnail_path, thumbnail_source")
    .eq("title", "Kipton")
    .limit(1)
    .single()
  if (videoErr) throw videoErr
  const videoId = (video as { id: string }).id
  const priorThumb = video as { thumbnail_path: string | null; thumbnail_source: string | null }
  console.log(`  subject: ${(video as { title: string }).title} (${videoId})`)

  const browser = await launchChromium()
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DSF,
  })
  let seeded: Seeded = { postIds: [], analyticsIds: [], restoreConnections: [] }

  try {
    await signInAsAdmin(ctx, "/admin/content")
    const page = await ctx.newPage()

    // ---------------------------------------------------------------- 1 + 2
    await page.goto(`${APP}/admin/content/${videoId}`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=Thumbnail", { timeout: 15_000 })

    await shoot(
      page,
      "01-thumbnail-picker",
      "A video can now be given a thumbnail",
      "Before this change the picture was whatever the app grabbed one second into the video, and there was no way to change it. The video detail page did not show it at all.",
      [
        await markerAt(page, '[alt="Current video thumbnail"]', "The picture as it is now.", "center"),
        await markerAt(page, "text=Picked automatically", "Where it came from. This says the app chose it."),
        await markerAt(page, 'button:has-text("Use this frame")', "Pause the video anywhere, then press this to use that picture."),
        await markerAt(page, 'button:has-text("Upload an image")', "Or upload a cover you made yourself."),
      ],
    )

    // Move the video to a different point, then take that frame.
    //
    // THIS CANNOT SUCCEED FROM LOCALHOST, and that is a storage setting rather
    // than a bug in the page. The bucket's CORS allow-list holds the production
    // origin and not this one — measured, not assumed:
    //
    //   Origin: https://www.darrenjpaul.com -> access-control-allow-origin: https://www.darrenjpaul.com
    //   Origin: http://localhost:3061       -> (no header at all)
    //
    // So we photograph the honest failure instead of faking a success. The
    // message shown here is the one this branch corrected: the original said
    // "try playing the video first", which could never have helped.
    await page.evaluate(() => {
      const v = document.querySelector("video")
      if (v) v.currentTime = Math.max(2, (v.duration || 10) * 0.6)
    })
    await page.waitForTimeout(1200)
    await page.locator('button:has-text("Use this frame")').click()
    // Catch the toast inside its own lifetime. A blocked load fails FAST (the
    // element's error event fires in about two seconds) and sonner dismisses
    // the message a few seconds later — so waiting "long enough to be safe"
    // photographs an empty screen and reads as "the button did nothing".
    // Measured: toast present at t=2s and t=5s, gone by t=10s.
    await page.waitForTimeout(2500)

    const toastCount = await page.locator("[data-sonner-toast]").count()
    const revertVisible = await page.locator('button:has-text("Revert to auto")').count()

    if (revertVisible > 0) {
      // The bucket started allowing this origin — capture the real round trip.
      await shoot(
        page,
        "02-thumbnail-changed",
        "AFTER — the chosen frame is saved and shown",
        "The same page after pressing 'Use this frame'. The picture and both labels are read back from the database, not held in the browser, so this is the full round trip.",
        [
          await markerAt(page, '[alt="Current video thumbnail"]', "The new picture, taken from where the video was paused.", "center"),
          await markerAt(page, "text=A frame you chose", "The label changed. The app knows this one was your choice."),
          await markerAt(page, 'button:has-text("Revert to auto")', "Appears only for a picture you chose, and puts the original back."),
        ],
      )
    } else if (toastCount > 0) {
      await shoot(
        page,
        "02-thumbnail-blocked-on-localhost",
        "What a blocked storage permission looks like",
        "Taken on a developer machine, where the video store does not yet allow this address. The same press works on the live site, whose address IS allowed. This shot is here because the message itself was fixed on this branch — it used to say 'try playing the video first', which could never have helped.",
        [
          await markerAt(page, "[data-sonner-toast]", "Says what is actually wrong and who can fix it, instead of sending you in circles."),
          await markerAt(page, '[alt="Current video thumbnail"]', "The old picture is untouched. Nothing was lost.", "center"),
        ],
      )
    } else {
      throw new Error("Neither a Revert button nor a message appeared — the button did nothing at all.")
    }

    // ------------------------------------------------------------------- 3
    await page.goto(`${APP}/admin/team-media`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=Team Media", { timeout: 15_000 })
    await shoot(
      page,
      "03-team-media-previews",
      "The Team Media board now shows what each clip is",
      "This board was rows of text. You had to open a submission to see which video it was.",
      [
        await markerAt(page, "th:has-text('Preview')", "A new column."),
        await markerAt(page, "table tbody tr:first-child td:first-child", "Each row shows its own clip."),
      ],
    )

    // ------------------------------------------------------------------- 4
    await page.goto(`${APP}/admin/content?tab=insights`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=Insights", { timeout: 15_000 })
    await page.waitForTimeout(600)
    await shoot(
      page,
      "04-insights-nothing-published",
      "Insights — and it is honest when there is nothing to show",
      "This is how the tab opens today, because nothing has ever been published. It says so in words. A dashboard that showed '0 views' here would look exactly the same as one whose numbers had silently broken.",
      [
        await markerAt(page, "text=Nothing has been published yet", "Said plainly, instead of showing a zero."),
        await markerAt(page, "text=What your team has been making", "These counts work today — they do not wait on anything being published."),
      ],
    )

    // -------------------------------------------------------------- 5 + 6
    seeded = await seed(db, videoId)
    console.log(`  seeded ${seeded.postIds.length} published posts + 1 snapshot on the dev clone`)

    await page.goto(`${APP}/admin/content?tab=insights`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    await shoot(
      page,
      "05-insights-with-numbers",
      "The same tab once posts are live",
      "Compare this with the shot before it. The empty state is replaced by real figures — nothing about the page changed except that there is now something to count.",
      [
        await markerAt(page, "text=How your posts are doing", "The same section, now with numbers in it."),
      ],
    )

    await page.goto(`${APP}/admin/content/${videoId}`, { waitUntil: "networkidle" })
    // Scope to the section, not the page. `text=Performance` also matches any
    // post caption containing the word, and Playwright's strict mode rejects
    // the ambiguity rather than silently picking one.
    const perf = page.locator("section", { has: page.locator("#performance-heading") })
    await perf.waitFor({ timeout: 15_000 })
    await perf.scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    await shoot(
      page,
      "06-video-performance-all-four-states",
      "All four answers, told apart",
      "The reason this half of the work exists. Four situations that would every one of them read as '0' on an ordinary dashboard are each given their own sentence, per platform. Seeded on a development copy so all four can be seen at once; today the live site shows only the last of them.",
      [
        // Park each disc at the RIGHT end of its row. Centring it puts the
        // marker on top of the sentence it is pointing at, which hides the one
        // thing the shot exists to show — the first run of this script did
        // exactly that and covered three of the four captions.
        await markerAt(page, perf.locator("text=/^Views$/").first(), "Measured — real figures came back for this one."),
        await markerAt(page, perf.locator("text=/first numbers arrive/i").first(), "Live, but nothing has been collected yet."),
        await markerAt(page, perf.locator("text=/^Not connected/i").first(), "We cannot read this one — that account is not connected."),
        await markerAt(page, perf.locator("text=/^Not published yet\\.$/").first(), "Still a draft, so there is nothing to measure."),
      ],
    )

    console.log("\nAll shots captured.")
  } finally {
    await cleanup(db, seeded)
    // Put the subject's thumbnail back the way it was.
    const { error } = await db
      .from("video_uploads")
      .update({ thumbnail_path: priorThumb.thumbnail_path, thumbnail_source: priorThumb.thumbnail_source })
      .eq("id", videoId)
    if (error) console.error("  cleanup: video_uploads thumbnail", error.message)
    else console.log("  restored the subject's original thumbnail")
    await ctx.close()
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
