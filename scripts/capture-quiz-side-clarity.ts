// The owner's 2026-10-09 review of the RPI quiz, walked in the REAL app against
// the dev clone, with callouts burned into each PNG:
//   - say LEFT / RIGHT in capitals, and make the switch impossible to miss
//     (both sides share one clip, which used to keep playing across Next)
//   - make the three scoring points, and how they add up to the four answers, clear
//   - the editor change that "didn't work": it was never saved
//
//   node node_modules/next/dist/bin/next dev --webpack --port 3061   # another terminal
//   APP=http://localhost:3061 npx tsx scripts/capture-quiz-side-clarity.ts .env.local
//
// The /preview walk is a test run and writes nothing. The editor shots type an
// edit and never press Save. The env file must point at the dev clone.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { chromium, type Page, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/quiz-side-clarity"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const SLUG = "rotational-performance-index"
const DESKTOP = { viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 1 }
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const shots: { file: string; text: string }[] = []

function envRef(path: string): string {
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="))
  if (!line) throw new Error(`${path} has no NEXT_PUBLIC_SUPABASE_URL`)
  return new URL(
    line
      .split("=")[1]
      .trim()
      .replace(/^["']|["']$/g, ""),
  ).host.split(".")[0]
}

async function signIn(ctx: BrowserContext): Promise<void> {
  const p = await ctx.newPage()
  await p.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded", timeout: 180_000 })
  if (!p.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p.url()})`)
  await p.close()
  await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])
}

async function clean(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `nextjs-portal, [role="status"].fixed, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

async function M(page: Page, dsf: number, selector: string, caption: string): Promise<Marker> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector} (${caption})`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE: ${selector}`)
  return { x: Math.round(Math.max(4, box.x - 20) * dsf), y: Math.round((box.y + 2) * dsf), caption }
}

async function shoot(
  page: Page,
  dsf: number,
  file: string,
  title: string,
  sentence: string,
  build: () => Promise<Marker[]>,
) {
  mkdirSync(OUT, { recursive: true })
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
  const markers = await build()
  const raw = `${OUT}/.raw-${file}`
  await page.screenshot({ path: raw })
  const subtitle = `${new URL(page.url()).pathname} · dev clone · light`
  const r = await annotate(raw, `${OUT}/${file}`, { title, subtitle, markers, scale: dsf === 2 ? 1 : 0.9 })
  rmSync(raw, { force: true })
  shots.push({ file, text: sentence })
  console.log(`  ${file}  ${r.width}x${r.height}`)
}

async function scrollTo(page: Page, selector: string, offset = 24): Promise<void> {
  await page
    .locator(selector)
    .first()
    .evaluate((el, off) => {
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: "instant" })
    }, offset)
  await page.waitForTimeout(500)
}

/** Play the clip past 1.5 s, the moment the owner pressed Next in his recording. */
async function playClip(page: Page): Promise<void> {
  const v = page.locator("video.djp-quiz-media").first()
  await v.evaluate((el) => (el as HTMLVideoElement).play())
  await page.waitForFunction(
    () => {
      const el = document.querySelector("video.djp-quiz-media") as HTMLVideoElement | null
      return !!el && el.readyState >= 3 && el.currentTime > 1.5 && el.videoWidth > 0
    },
    undefined,
    { timeout: 30_000 },
  )
}

/** Fill the landing form and press its button; lands on /preview/<slug>/quiz. */
async function throughLandingForm(page: Page): Promise<void> {
  await page.goto(`${APP}/preview/${SLUG}`, { waitUntil: "networkidle", timeout: 180_000 })
  await clean(page)
  await page.waitForTimeout(1500) // hydration, and the form's too-fast bot check
  await page.locator("#rotational-index-athlete_name").fill("Maya Torres")
  await page.locator("#rotational-index-parent_email").fill("maya.torres@example.com")
  await page.locator("#rotational-index-sport").selectOption("Tennis")
  await page.locator("#rotational-index-athlete_age").fill("16")
  await Promise.all([
    page.waitForURL(`**/preview/${SLUG}/quiz`, { timeout: 60_000 }),
    page.getByRole("button", { name: "Start my free assessment" }).first().click(),
  ])
  await page.waitForLoadState("networkidle")
  await clean(page)
  await page.locator(".djp-quiz-prompt").first().waitFor()
  await page.waitForTimeout(1000) // hydration of the quiz island
}

const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true })

async function main() {
  if (envRef(process.argv[2] ?? ".env.local") !== CLONE_REF) {
    console.error("REFUSING: not the dev clone.")
    process.exit(1)
  }
  const browser = await chromium.launch({ channel: "chrome" })
  try {
    const desk = await browser.newContext(DESKTOP)
    await signIn(desk)
    const d = await desk.newPage()
    await throughLandingForm(d)

    // ---- the left side ---------------------------------------------------
    if ((await d.locator(".djp-quiz-side").textContent()) !== "LEFT SIDE")
      throw new Error("no LEFT SIDE badge on question 1")
    if ((await d.locator(".djp-quiz-help ol li").count()) !== 3)
      throw new Error("the three points are not a numbered list")
    await playClip(d)
    const firstClip = await d.locator("video.djp-quiz-media").elementHandle()
    await d.getByRole("button", { name: /^3 points — / }).click()
    await scrollTo(d, ".djp-quiz", 16)
    await shoot(
      d,
      1,
      "01-left-side-and-the-three-points.png",
      "The left side, and how the score adds up",
      "The first test. The side is in capitals at the top, the three things to check are a numbered list worth a point each, and every answer starts with its points.",
      async () => [
        await M(d, 1, ".djp-quiz-side", "“LEFT SIDE”, in capitals, above the test’s name."),
        await M(d, 1, ".djp-quiz-help ol", "The three things to check, one per line. Each one is worth 1 point."),
        await M(
          d,
          1,
          ".djp-quiz-option",
          "Each answer starts with its points: 3, 2, 1 or 0. So it matches the list above.",
        ),
        await M(d, 1, ".djp-quiz-nav .djp-btn-primary", "“Next” moves to the right side of the same test."),
      ],
    )

    // ---- Next: the right side --------------------------------------------
    await next(d).click()
    await d.waitForTimeout(1200) // the smooth scroll back up
    if ((await d.locator(".djp-quiz-side").textContent()) !== "RIGHT SIDE")
      throw new Error("no RIGHT SIDE badge on question 2")
    const note = (await d.locator(".djp-quiz-switch").textContent()) ?? ""
    if (note !== "Left side saved. Now do the same test on your RIGHT side.")
      throw new Error(`switch note was "${note}"`)
    const clip = d.locator("video.djp-quiz-media").first()
    if (await clip.evaluate((el, old) => el === old, firstClip))
      throw new Error("the clip element was reused across the side switch")
    const t = await clip.evaluate((el) => (el as HTMLVideoElement).currentTime)
    if (t > 0.1) throw new Error(`the right side's clip did not restart (currentTime ${t})`)
    if (await d.locator('.djp-quiz-option[aria-pressed="true"]').count())
      throw new Error("an answer is already picked on the right side")
    await shoot(
      d,
      1,
      "02-switch-to-the-right-side.png",
      "After “Next”: the switch to the right side",
      "The same test, now the right side. A note says the left side was saved, the badge changes to an outline reading RIGHT SIDE, and the clip starts again from the beginning.",
      async () => [
        await M(
          d,
          1,
          ".djp-quiz-switch",
          "“Left side saved. Now do the same test on your RIGHT side.” The visitor knows the click worked.",
        ),
        await M(
          d,
          1,
          ".djp-quiz-side",
          "“RIGHT SIDE”. An outline this time, so it looks different from the left side.",
        ),
        await M(
          d,
          1,
          "video.djp-quiz-media",
          "The clip starts again from the start. It used to carry on from where the left side left off.",
        ),
        await M(d, 1, ".djp-quiz-option", "No answer picked yet, so “Next” is faded until the right side is scored."),
      ],
    )

    // ---- phone -----------------------------------------------------------
    const mob = await browser.newContext(MOBILE)
    await signIn(mob)
    const m = await mob.newPage()
    await throughLandingForm(m)
    await m.getByRole("button", { name: /^3 points — / }).click()
    await next(m).click()
    await m.waitForTimeout(1200)
    if ((await m.locator(".djp-quiz-side").textContent()) !== "RIGHT SIDE")
      throw new Error("phone: no RIGHT SIDE badge")
    await scrollTo(m, ".djp-quiz", 8)
    await shoot(
      m,
      2,
      "03-phone-right-side.png",
      "On a phone",
      "The same moment on a phone. The note and the side are the first things on screen.",
      async () => [
        await M(m, 2, ".djp-quiz-switch", "Left side saved."),
        await M(m, 2, ".djp-quiz-side", "RIGHT SIDE."),
        await M(m, 2, ".djp-quiz-help ol", "The three points."),
      ],
    )

    // ---- the editor --------------------------------------------------------
    const e = await desk.newPage()
    await e.setViewportSize({ width: 1280, height: 900 })
    await e.goto(`${APP}/admin/funnels/quizzes/1b93a8c7-c08f-4716-a6e0-226d61bdf820`, {
      waitUntil: "networkidle",
      timeout: 180_000,
    })
    await clean(e)
    await e.waitForTimeout(1500) // hydration
    // A click before hydration does nothing, so press until the panel opens.
    const fields = e.getByLabel("Instructions under the question")
    for (let i = 0; i < 10 && (await fields.count()) === 0; i++) {
      await e.getByRole("button", { name: "Questions" }).click()
      await e.waitForTimeout(1000)
    }
    if ((await fields.count()) === 0) throw new Error("the Questions panel never showed the instructions field")
    const field = fields.nth(2)
    await field.scrollIntoViewIfNeeded()
    if ((await e.getByText("Unsaved changes").count()) !== 0) throw new Error("editor says unsaved before any edit")
    const before = await field.inputValue()
    const edited = before.replace("Watch the clip, try it", "Watch the clip twice, try it")
    if (edited === before) throw new Error("the edit would change nothing")
    await field.fill(edited)
    await e.evaluate(() => window.scrollBy(0, -140))
    await e.waitForTimeout(300)
    if ((await e.getByText("Unsaved changes").count()) !== 1)
      throw new Error("editor does not say unsaved after an edit")
    await shoot(
      e,
      1,
      "04-editor-instructions-and-unsaved.png",
      "Editing the instructions, and the unsaved warning",
      "The quiz editor, scrolled down to a question. The instructions under the question can now be edited. After any change, the top says “Unsaved changes” and stays in view.",
      async () => [
        await M(
          e,
          1,
          "header.top-16 h1",
          "This bar now stays at the top while you scroll, so Save is always in reach.",
        ),
        await M(
          e,
          1,
          "header.top-16 span.text-warning",
          "After any edit it says “Unsaved changes”, and Save turns dark blue, until you press Save.",
        ),
        await M(
          e,
          1,
          'textarea[maxlength="500"] >> nth=2',
          "New: the instructions under the question. A line starting with “1.” shows as a numbered list.",
        ),
      ],
    )

    const rows = shots
      .map((s, i) => `<figure><figcaption><b>${i + 1}.</b> ${s.text}</figcaption><img src="${s.file}" alt=""></figure>`)
      .join("\n")
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quiz sides and scoring</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1320px;margin:0 auto;padding:24px;background:#f6f6f4;color:#13323c}
figure{margin:0 0 40px}figcaption{margin:0 0 10px}img{max-width:100%;border:1px solid #ddd;border-radius:8px}</style>
<h1>Left, right, and how the points add up</h1>
<p>Real app on the dev clone, a <code>/preview/${SLUG}</code> test run (nothing saved), and the quiz editor (edit typed, never saved). Funnel pages and admin have no dark mode.</p>
${rows}`,
    )
    console.log(`  ${OUT}/index.html`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
