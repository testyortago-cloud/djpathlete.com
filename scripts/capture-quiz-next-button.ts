// The quiz's new "Next" button, walked in the REAL app against the dev clone,
// with callouts burned into each PNG. The owner's report (2026-10-06): a click
// on an answer jumped straight to the next test, and the page stayed scrolled
// down, so tapping the same spot flicked through every test unread.
//
//   RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3062   # another terminal
//   APP=http://localhost:3062 npx tsx scripts/capture-quiz-next-button.ts .env.local
//
// The /preview walk is a test run and writes nothing. The env file must point
// at the dev clone.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { chromium, type Page, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/quiz-next-button"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const SLUG = "rotational-performance-index"
const DESKTOP = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const shots: { file: string; text: string }[] = []

function envRef(path: string): string {
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="))
  if (!line) throw new Error(`${path} has no NEXT_PUBLIC_SUPABASE_URL`)
  return new URL(line.split("=")[1].trim().replace(/^["']|["']$/g, "")).host.split(".")[0]
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

async function shoot(page: Page, dsf: number, file: string, title: string, sentence: string, build: () => Promise<Marker[]>) {
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
  await page.locator(selector).first().evaluate((el, off) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: "instant" })
  }, offset)
  await page.waitForTimeout(500)
}

async function videoFrame(page: Page): Promise<void> {
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
  await v.evaluate((el) => (el as HTMLVideoElement).pause())
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
    await videoFrame(d)

    // Where the owner was in the recording: scrolled down to the answers.
    await scrollTo(d, ".djp-quiz-options", 330)
    if (!(await next(d).isDisabled())) throw new Error("Next should be disabled before an answer is picked")
    await shoot(d, 1, "01-answers-wait-for-next.png", "Picking an answer no longer skips ahead",
      "The first test, scrolled down to the answers. Nothing is picked yet, so “Next” is faded and does nothing.", async () => [
        await M(d, 1, ".djp-quiz-option", "The four answers, now shaded, with a clear edge and a circle to tick. Clicking one only picks it."),
        await M(d, 1, ".djp-quiz-nav .djp-btn-primary", "“Next” stays faded until an answer is picked."),
      ])

    const firstPrompt = (await d.locator(".djp-quiz-prompt").first().textContent()) ?? ""
    await d.locator(".djp-quiz-option").first().click()
    await d.waitForTimeout(300)
    if ((await d.locator(".djp-quiz-prompt").first().textContent()) !== firstPrompt)
      throw new Error("picking an answer moved to the next question")
    await shoot(d, 1, "02-picked-answer-waits.png", "The picked answer is highlighted, and the test stays",
      "After a click on the top answer, the same test is still on screen. The answer is highlighted and “Next” is ready.", async () => [
        await M(d, 1, '.djp-quiz-option[aria-pressed="true"]', "The picked answer: filled circle, brand-coloured edge, bold text. Click another to change it."),
        await M(d, 1, ".djp-quiz-nav .djp-btn-primary", "“Next” is ready. The visitor decides when to move on."),
      ])

    await next(d).click()
    await d.waitForTimeout(1200) // the smooth scroll back up
    const secondPrompt = (await d.locator(".djp-quiz-prompt").first().textContent()) ?? ""
    if (secondPrompt === firstPrompt) throw new Error("Next did not move on")
    if ((await d.evaluate(() => document.querySelector(".djp-quiz")!.getBoundingClientRect().top)) < -2)
      throw new Error("the next question did not scroll back into view")
    await videoFrame(d)
    await shoot(d, 1, "03-next-opens-the-next-test-at-its-top.png", "“Next” opens the next test from its top",
      "After “Next”, the page scrolls back up by itself. The visitor sees the new test’s name and clip, not just its answers.", async () => [
        await M(d, 1, ".djp-quiz-step", "Question 2 of 13."),
        await M(d, 1, ".djp-quiz-prompt", "The next test’s name is in view again."),
        await M(d, 1, "video.djp-quiz-media", "Its clip, ready to watch before answering."),
      ])

    await scrollTo(d, ".djp-quiz-options", 330)
    if ((await d.getByRole("button", { name: "Back", exact: true }).count()) === 0) throw new Error("no Back on question 2")
    await shoot(d, 1, "04-back-from-question-two.png", "“Back” sits beside “Next” from question 2",
      "From the second question on, “Back” returns to the previous one with its answer still picked. Question 1 has no Back, since nothing comes before it.", async () => [
        await M(d, 1, ".djp-quiz-nav .djp-quiz-back", "“Back”, now a button the same size as “Next”, returns to the previous test."),
        await M(d, 1, ".djp-quiz-nav .djp-btn-primary", "“Next”, faded until this question is answered."),
      ])

    // ---- phone --------------------------------------------------------------
    const mob = await browser.newContext(MOBILE)
    await signIn(mob)
    const m = await mob.newPage()
    await throughLandingForm(m)
    await videoFrame(m)
    await m.locator(".djp-quiz-option").first().click()
    await scrollTo(m, ".djp-quiz-options", 120)
    await shoot(m, 2, "05-phone-next-under-the-answers.png", "On a phone",
      "On a phone, “Next” sits right under the answers, beside “Back” from the second question on.", async () => [
        await M(m, 2, '.djp-quiz-option[aria-pressed="true"]', "Picked."),
        await M(m, 2, ".djp-quiz-nav .djp-btn-primary", "“Next”."),
      ])

    const rows = shots
      .map((s, i) => `<figure><figcaption><b>${i + 1}.</b> ${s.text}</figcaption><img src="${s.file}" alt=""></figure>`)
      .join("\n")
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quiz Next button</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1320px;margin:0 auto;padding:24px;background:#f6f6f4;color:#13323c}
figure{margin:0 0 40px}figcaption{margin:0 0 10px}img{max-width:100%;border:1px solid #ddd;border-radius:8px}</style>
<h1>The quiz waits for “Next”</h1>
<p>Real app on the dev clone, a <code>/preview/${SLUG}</code> test run (nothing saved). Desktop 1280 wide; phone 390 wide at 2x. Funnel pages have no dark mode.</p>
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
