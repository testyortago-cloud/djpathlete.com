// Drives the REAL app (dev server on :3050, dev clone DB) and captures the RPI
// video / results-map screens with callouts burned into each PNG.
//
//   npm run dev -- --webpack     # port 3050, in another terminal
//   npx tsx scripts/capture-rpi-video-quiz-gaps.ts .env.local
//
// WHAT IT WRITES, AND ONLY ON THE DEV CLONE (it refuses any other project ref):
//  * one funnel + one quiz clone, made through the create dialog (the RPI quiz
//    is a draft that no funnel contains, so a preview needs one). Both are
//    deleted again in `finally` with the service role, because there is no
//    admin DELETE route for either.
//  * one REAL clip PUT to the live bucket via the signed url (shot 2). The
//    editor is never saved, so the quiz row never names that object.
// The /preview test run performs zero writes by design.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { chromium, type Page, type Locator } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/rpi-video-quiz-gaps"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const RPI_QUIZ_ID = "1b93a8c7-c08f-4716-a6e0-226d61bdf820"
const CLIP = "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/media/quiz-rotational-reboot-mistakes/3-short-lever-copenhagen-mistakes.mp4"
const WIDTH = 1440
const HEIGHT = 1080
const DSF = 2
const FUNNEL_NAME = `RPI capture ${String(Date.now()).slice(-6)}`

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

async function park(page: Page): Promise<void> {
  await page.mouse.move(2, 2)
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
  await page.waitForTimeout(250)
}

async function shoot(page: Page, name: string, title: string, subtitle: string, markers: Marker[]): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await park(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  rmSync(raw, { force: true })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

/** A marker on a real element, in image pixels. Throws rather than degrading. */
async function markerAt(page: Page, target: string | Locator, caption: string, nudge = { x: -20, y: 4 }): Promise<Marker> {
  const el = typeof target === "string" ? page.locator(target).first() : target.first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${target}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE: ${target}`)
  const view = page.viewportSize()
  if (view && (box.y > view.height || box.y + box.height < 0)) throw new Error(`MARKER TARGET OFF SCREEN: ${target}`)
  return { x: Math.round((box.x + nudge.x) * DSF), y: Math.round((box.y + nudge.y) * DSF), caption }
}

/** Answer the quiz question on screen; `pick` chooses the option text to click. */
async function walk(page: Page, pick: (prompt: string) => RegExp | null, stopAtPrompt?: RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if ((await page.locator(".djp-quiz-gate, .djp-quiz-result").count()) > 0) return
    const prompt = (await page.locator(".djp-quiz-prompt").first().innerText().catch(() => "")).trim()
    if (!prompt) {
      await page.waitForTimeout(300)
      continue
    }
    if (stopAtPrompt && stopAtPrompt.test(prompt)) return
    const want = pick(prompt)
    const options = page.locator(".djp-quiz-option")
    const opt = want ? options.filter({ hasText: want }).first() : options.first()
    await opt.click()
    await page.waitForTimeout(450)
  }
  throw new Error("walk did not reach the gate in 40 steps")
}

async function reachResult(page: Page): Promise<void> {
  await page.locator(".djp-quiz-gate").waitFor({ timeout: 15_000 })
  await page.locator("#djp-quiz-name").fill("Sam Rivera")
  await page.locator("#djp-quiz-email").fill("sam.rivera@example.com")
  const ticks = page.locator(".djp-quiz-gate input[type=checkbox]")
  for (let i = 0; i < (await ticks.count()); i += 1) if (!(await ticks.nth(i).isChecked())) await ticks.nth(i).check()
  await page.locator(".djp-quiz-gate button[type=submit]").click()
  await page.locator(".djp-quiz-result").waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
}

async function main() {
  const env = loadEnv(process.argv[2] ?? ".env.local")
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("env is missing Supabase credentials")
  const ref = new URL(url).host.split(".")[0]
  if (ref !== CLONE_REF) {
    console.error(`REFUSING: ${ref} is not the dev clone.`)
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const browser = await chromium.launch({ channel: "chrome" })
  let funnelId = ""
  let cloneQuizId = ""
  const log: Record<string, unknown> = {}
  try {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
    const auth = await ctx.newPage()
    await auth.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
    if (!auth.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${auth.url()})`)
    await auth.close()
    // Dev clone: without this cookie the admin lands on a seeded empty tenant.
    await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])
    console.log("  signed in as admin, session asserted")

    // ---- 1. The editor, a movement question's "Video and results map" open.
    const page = await ctx.newPage()
    await page.goto(`${APP}/admin/funnels/quizzes/${RPI_QUIZ_ID}`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Questions" }).click()
    await page.waitForTimeout(400)
    const card = page.locator("div.rounded-lg", { has: page.locator('input[value^="Short lever Copenhagen — left"]') }).last()
    await card.scrollIntoViewIfNeeded()
    await card.locator("details > summary").click()
    await page.waitForTimeout(400)
    const details = card.locator("details")
    await details.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 160))
    await page.waitForTimeout(300)
    await shoot(page, "01-editor-video-and-results-map", "Each movement question carries its clips, its results-map label and its side", `/admin/funnels/quizzes/${RPI_QUIZ_ID.slice(0, 8)}… · Questions · light`, [
      await markerAt(page, details.locator("summary"), '"Video and results map" opens on any question. "has video" shows when either clip is set.'),
      await markerAt(page, details.getByText("Demo clip", { exact: true }), "The demo clip: the visitor watches this under the question (the “How to do it” view)."),
      await markerAt(page, details.getByText("Common mistakes clip", { exact: true }), "The new second clip. When it is set, the visitor gets a “Common mistakes” toggle beside the demo."),
      await markerAt(page, details.getByLabel("Results map label"), "Questions sharing this label become ONE row on the results map. Capped at 80 characters, the most the save accepts."),
      await markerAt(page, details.locator("select"), "Left and right questions with the same label are shown side by side on that row."),
    ])

    // ---- 2. Upload a real clip through the real picker. NOT saved.
    // Pick the picker on a question that is not Copenhagen-left so the page
    // keeps both existing clips visible in shot 1 only.
    const mistakesPicker = details.locator('input[type=file][aria-label="Common mistakes clip"]')
    const putStatus: { puts: { status: number; url: string }[]; failed: string[] } = { puts: [], failed: [] }
    page.on("response", (res) => {
      if (res.request().method() === "PUT" && !res.url().startsWith(APP)) {
        putStatus.puts.push({ status: res.status(), url: res.url().split("?")[0] })
      }
    })
    page.on("requestfailed", (req) => {
      if (req.method() === "PUT" && !req.url().startsWith(APP)) putStatus.failed.push(`${req.url().split("?")[0]} ${req.failure()?.errorText}`)
    })
    await mistakesPicker.setInputFiles(CLIP)
    await page.waitForTimeout(500)
    for (let i = 0; i < 90; i += 1) {
      if ((await details.locator("text=/Uploading/").count()) === 0) break
      await page.waitForTimeout(1000)
    }
    await page.waitForTimeout(800)
    log.put = putStatus
    console.log("  PUT result:", JSON.stringify(putStatus))
    const errText = await details.locator("p.text-red-600, [role=alert], p.text-destructive").allInnerTexts().catch(() => [])
    log.pickerErrors = errText
    if (putStatus.puts.length > 0 && putStatus.puts.every((x) => x.status >= 200 && x.status < 300)) {
      await shoot(page, "02-upload-through-the-picker", "A real clip goes up through the picker and previews at once", "/admin/funnels/quizzes/… · light · NOT saved", [
        await markerAt(page, details.getByText("Common mistakes clip", { exact: true }), "The file went straight from the browser to storage on a signed link. The preview below is the uploaded clip."),
        await markerAt(page, details.getByRole("button", { name: /Remove Common mistakes clip/ }), "Remove clears it again. Nothing is attached to the quiz until you press Save, and Save was not pressed here."),
      ])
    } else {
      console.error("  UPLOAD SHOT SKIPPED: PUT was not 2xx. See report.")
    }
    await page.close() // leaves without saving

    // ---- 3-5 need a funnel holding the RPI quiz. None exists on the clone, so
    // make one through the real create dialog (it clones the RPI quiz).
    const dlg = await ctx.newPage()
    await dlg.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle" })
    await dlg.getByRole("button", { name: /new funnel/i }).first().click()
    await dlg.getByRole("radio", { name: /run a quiz/i }).click()
    await dlg.getByLabel(/^name/i).fill(FUNNEL_NAME)
    await dlg.getByLabel(/copy questions from/i).waitFor()
    await dlg.locator("#funnel-quiz").selectOption({ label: await dlg.locator("#funnel-quiz option", { hasText: /Rotational Performance Index/ }).first().innerText() })
    await dlg.getByRole("button", { name: /create funnel/i }).click()
    await dlg.waitForURL(/\/admin\/funnels\/quizzes\//, { timeout: 30_000 })
    cloneQuizId = dlg.url().split("/quizzes/")[1].split(/[?#]/)[0]
    const { data: fr } = await supabase.from("funnels").select("id, slug").eq("name", FUNNEL_NAME).maybeSingle()
    if (!fr) throw new Error("created funnel not found")
    funnelId = String((fr as { id: string }).id)
    const slug = String((fr as { slug: string }).slug)
    log.created = { funnelId, slug, cloneQuizId }
    console.log(`  created funnel ${funnelId} (/preview/${slug}) + clone quiz ${cloneQuizId}`)
    await dlg.close()

    const pv = await ctx.newPage()
    await pv.goto(`${APP}/preview/${slug}`, { waitUntil: "networkidle" })
    await pv.getByRole("button", { name: /^start$/i }).first().click()
    // First question (router) then straight to a movement question.
    const MOVEMENT = /Short lever Copenhagen — left/
    await walk(pv, () => null, MOVEMENT)
    await pv.locator(".djp-quiz-toggle").waitFor({ timeout: 10_000 })
    await pv.locator(".djp-quiz-toggle button", { hasText: "Common mistakes" }).click()
    await pv.waitForTimeout(800)
    await pv.locator("video.djp-quiz-media").scrollIntoViewIfNeeded()
    await pv.waitForTimeout(500)
    const src = await pv.locator("video.djp-quiz-media").getAttribute("src")
    log.mistakesSrc = src
    await shoot(pv, "03-preview-common-mistakes-toggle", "The visitor can switch between the demo and the common mistakes", `/preview/${slug} · test run · light`, [
      await markerAt(pv, ".djp-test-run", "A test run: nothing is saved and no one is emailed."),
      await markerAt(pv, '.djp-quiz-toggle button[aria-pressed="false"]', "“How to do it” is the demo clip."),
      await markerAt(pv, '.djp-quiz-toggle button[aria-pressed="true"]', "“Common mistakes” is selected, and the player below now holds the mistakes clip."),
      await markerAt(pv, "video.djp-quiz-media", "The mistakes clip keeps its sound, so the visitor can unmute and hear each mistake named."),
    ])

    // Answer: Copenhagen left "All three", right "One of the three"; everything else clean.
    await walk(pv, (p) => {
      if (/Short lever Copenhagen — right/.test(p)) return /^One of the three/
      if (/Short lever Copenhagen — left/.test(p)) return /^All three/
      if (/How often do you train/.test(p)) return /^More than 3/
      if (/how many of the three|Rocking hollow/.test(p)) return /^All three/
      return null
    })
    await reachResult(pv)
    await pv.locator(".djp-quiz-mirror").scrollIntoViewIfNeeded()
    await pv.evaluate(() => window.scrollBy(0, -60))
    await pv.waitForTimeout(400)
    const mirror = pv.locator(".djp-quiz-mirror")
    const mapEl = pv.locator(".djp-quiz-map")
    const gapRow = pv.locator('.djp-quiz-status[data-status="gap"]').first()
    const solidRow = pv.locator('.djp-quiz-status[data-status="solid"]').first()
    log.rows = { gap: await gapRow.count(), solid: await solidRow.count() }
    if ((await gapRow.count()) === 0 || (await solidRow.count()) === 0) throw new Error("result lacks a gap row and a solid row")
    // The mirror, map and CTA are tall; shoot the mirror+map in one frame at top, then the CTA.
    const tall = await pv.evaluate(() => document.querySelector(".djp-quiz-result")!.getBoundingClientRect().height)
    log.resultHeight = tall
    await pv.setViewportSize({ width: WIDTH, height: Math.min(2600, Math.ceil(tall + 400)) })
    await pv.waitForTimeout(500)
    await pv.locator(".djp-quiz-result").scrollIntoViewIfNeeded()
    await pv.evaluate(() => window.scrollTo(0, Math.max(0, document.querySelector(".djp-quiz-result")!.getBoundingClientRect().top + window.scrollY - 40)))
    await pv.waitForTimeout(400)
    const cta = pv.locator(".djp-quiz-result a.djp-btn")
    const markers: Marker[] = [
      await markerAt(pv, mirror.locator(".djp-quiz-section-title"), "“What you told us” repeats the visitor's own answers back to them, in their own words."),
      await markerAt(pv, mapEl.locator(".djp-quiz-section-title"), "“Your movement map”: one row per movement. Left and right attempts share a row."),
      await markerAt(pv, gapRow, "A gap: Copenhagen left was clean (3/3) but right was one of three (1/3), so that row is flagged."),
      await markerAt(pv, solidRow, "A solid row: both sides clean."),
    ]
    if ((await cta.count()) > 0) markers.push(await markerAt(pv, cta, "The call to action follows the map."))
    else console.warn("  NOTE: no CTA on this result (tier has no ctaLabel/ctaHref)")
    await shoot(pv, "04-preview-result-mirror-map-cta", "The result: what you told us, the movement map, and the next step", `/preview/${slug} · test run · light`, markers)
    await pv.close()

    // ---- 5. Athlete quiz test run: no map, no mirror.
    const at = await ctx.newPage()
    await at.goto(`${APP}/preview/athlete-quiz`, { waitUntil: "networkidle" })
    await at.getByRole("button", { name: /^start$/i }).first().click()
    await walk(at, () => null)
    await reachResult(at)
    log.athlete = { map: await at.locator(".djp-quiz-map").count(), mirror: await at.locator(".djp-quiz-mirror").count() }
    if ((log.athlete as { map: number; mirror: number }).map + (log.athlete as { map: number; mirror: number }).mirror > 0) {
      throw new Error("athlete quiz result shows a map or mirror: REGRESSION")
    }
    await at.locator(".djp-quiz-result").scrollIntoViewIfNeeded()
    await at.waitForTimeout(400)
    await shoot(at, "05-athlete-quiz-no-regression", "The athlete quiz result is unchanged: no map, no mirror", "/preview/athlete-quiz · test run · light", [
      await markerAt(at, ".djp-test-run", "Same test run, on the existing athlete quiz."),
      await markerAt(at, ".djp-quiz-score", "Score and tier as before. There is no “What you told us” block and no “Your movement map”, because no question here has a results-map label."),
    ])
    writeFileSync(`${OUT}/run.json`, JSON.stringify(log, null, 2))
  } finally {
    await browser.close()
    // dev clone only (ref asserted above): the rows this run created.
    if (cloneQuizId) await supabase.from("quizzes").delete().eq("id", cloneQuizId)
    if (funnelId) await supabase.from("funnels").delete().eq("id", funnelId)
    console.log("  removed the funnel and quiz clone this run created")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
