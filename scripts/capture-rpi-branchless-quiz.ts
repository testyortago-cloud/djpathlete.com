// The RPI funnel after the 2026-10-06 cleanup, walked in the REAL app against
// the dev clone, with callouts burned into each PNG:
//   landing form (sport asked here, once) -> the quiz opens on its first test
//   -> the four questions come after the tests -> name and email already filled
//   -> result -> "Go live" on the funnels board no longer refuses.
//
//   npx next dev --webpack --port 3061           # in another terminal
//   APP=http://localhost:3061 npx tsx scripts/capture-rpi-branchless-quiz.ts .env.local
//
// The /preview walk is a test run and writes nothing. The board shot DOES write
// to the clone: it presses "Go live" and then "Take offline", leaving the clone
// funnel a draft again. The env file must point at the dev clone.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { chromium, type Page, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/rpi-branchless-quiz"
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
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off)
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
async function throughLandingForm(page: Page, shot?: () => Promise<void>): Promise<void> {
  await page.goto(`${APP}/preview/${SLUG}`, { waitUntil: "networkidle", timeout: 180_000 })
  await clean(page)
  await page.waitForTimeout(1500) // hydration, and the form's too-fast bot check
  await page.locator("#rotational-index-athlete_name").fill("Maya Torres")
  await page.locator("#rotational-index-parent_email").fill("maya.torres@example.com")
  await page.locator("#rotational-index-sport").selectOption("Tennis")
  await page.locator("#rotational-index-athlete_age").fill("16")
  if (shot) await shot()
  await Promise.all([
    page.waitForURL(`**/preview/${SLUG}/quiz`, { timeout: 60_000 }),
    page.getByRole("button", { name: "Start my free assessment" }).first().click(),
  ])
  await page.waitForLoadState("networkidle")
  await clean(page)
  await page.locator(".djp-quiz-prompt").first().waitFor()
}

/** Answer until the prompt matches `stop`, or until the gate shows. */
async function answerUntil(page: Page, stop: RegExp | null): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if ((await page.locator(".djp-quiz-gate").count()) > 0) return
    const prompt = (await page.locator(".djp-quiz-prompt").first().textContent()) ?? ""
    if (stop && stop.test(prompt)) return
    // Alternate first/second so the score lands mid-range rather than at an edge.
    await page.locator(".djp-quiz-option").nth(i % 2).click()
    await page.waitForTimeout(250)
  }
  throw new Error(`never reached ${stop ?? "the gate"}`)
}

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

    await throughLandingForm(d, async () => {
      await scrollTo(d, "#capture", 0)
      await shoot(d, 1, "01-landing-form-asks-sport.png", "The landing page asks for the sport, once",
        "The visitor fills in the landing page form. The sport is asked here and nowhere else.", async () => [
          await M(d, 1, "#rotational-index-sport", "Sport is asked on the landing page. The quiz no longer asks it."),
          await M(d, 1, "#rotational-index-parent_email", "The name and email typed here are carried into the quiz."),
          await M(d, 1, "#capture .djp-btn-primary", "“Start my free assessment” goes straight to the quiz."),
        ])
    })

    await videoFrame(d)
    await d.evaluate(() => window.scrollTo(0, 0))
    await shoot(d, 1, "02-quiz-opens-on-the-first-test.png", "The quiz page opens on the first test",
      "Pressing the button lands on the first movement test. There is no second sales page and no Start screen.", async () => [
        await M(d, 1, ".djp-quiz-head h2","One line of instructions, then the test itself."),
        await M(d, 1, ".djp-quiz-step", "“Question 1 of 13” — the total is known from the start."),
        await M(d, 1, "video.djp-quiz-media", "The demo clip for the first test."),
      ])

    await answerUntil(d, /unstable/i)
    await scrollTo(d, ".djp-quiz-step", 120)
    await shoot(d, 1, "03-four-questions-after-the-tests.png", "Four short questions come after the five tests",
      "After the nine test screens (five tests, four of them done on each side), four short questions follow.", async () => [
        await M(d, 1, ".djp-quiz-step", "Question 10 of 13: the first of the four questions."),
        await M(d, 1, ".djp-quiz-prompt", "The question the sport menu used to hide. Everyone is asked it now."),
      ])

    await answerUntil(d, null)
    await d.locator(".djp-quiz-gate").waitFor()
    await d.waitForFunction(() => (document.querySelector("#djp-quiz-email") as HTMLInputElement | null)?.value !== "")
    await scrollTo(d, ".djp-quiz-gate", 120)
    await shoot(d, 1, "04-name-and-email-already-filled.png", "The name and email are already filled in",
      "At the end, the visitor does not type their name and email again. They press the button.", async () => [
        await M(d, 1, "#djp-quiz-name", "Filled from the landing page form."),
        await M(d, 1, "#djp-quiz-email", "Filled from the landing page form. The visitor can still change it."),
        await M(d, 1, ".djp-quiz-gate .djp-btn-primary", "“See my result”."),
      ])

    await d.locator(".djp-quiz-gate .djp-btn-primary").click()
    await d.locator(".djp-quiz-result").waitFor({ timeout: 60_000 })
    await scrollTo(d, ".djp-quiz-result", 120)
    await shoot(d, 1, "05-result.png", "The result",
      "The score and the movement map show straight away. This was a test run, so nothing was saved.", async () => [
        await M(d, 1, ".djp-quiz-score", "The score out of 100."),
        await M(d, 1, ".djp-quiz-tier", "The band the score falls in."),
      ])

    // ---- the board: Go live no longer refuses ------------------------------
    const b = await desk.newPage()
    await b.goto(`${APP}/admin/funnels`, { waitUntil: "networkidle", timeout: 180_000 })
    await clean(b)
    await b.waitForTimeout(1500)
    const card = b.locator(`text="/go/${SLUG}"`).first().locator("xpath=ancestor::*[.//button[normalize-space()='Go live' or normalize-space()='Take offline']][1]")
    await card.scrollIntoViewIfNeeded()
    await card.getByRole("button", { name: "Go live" }).click()
    await card.getByRole("button", { name: "Take offline" }).waitFor({ timeout: 60_000 })
    await b.waitForTimeout(600)
    const toast = b.locator("[data-sonner-toast]").first()
    await shoot(b, 1, "06-go-live-works.png", "“Go live” works again",
      "On the funnels board, “Go live” now puts the funnel live instead of refusing because the quiz was offline.", async () => [
        await M(b, 1, `text="/go/${SLUG}"`, "Rotational Performance Index: landing page, then the quiz."),
        await M(b, 1, "[data-sonner-toast]", "Before: “quiz … is draft, not active”. Now: it is live."),
      ])
    void toast
    // Leave the clone as it was found: a draft.
    await card.getByRole("button", { name: "Take offline" }).click()
    await card.getByRole("button", { name: "Go live" }).waitFor({ timeout: 60_000 })

    // ---- phone: the quiz opening -----------------------------------------
    const mob = await browser.newContext(MOBILE)
    await signIn(mob)
    const m = await mob.newPage()
    await throughLandingForm(m)
    await videoFrame(m)
    await m.evaluate(() => window.scrollTo(0, 0))
    await shoot(m, 2, "07-phone-quiz-opens-on-the-first-test.png", "On a phone",
      "On a phone, the page opens on the first test. Its clip is a short scroll down.", async () => [
        await M(m, 2, ".djp-quiz-step", "Question 1 of 13: the first test, straight away."),
        await M(m, 2, "video.djp-quiz-media", "The first test's clip starts here."),
      ])

    const rows = shots
      .map((s, i) => `<figure><figcaption><b>${i + 1}.</b> ${s.text}</figcaption><img src="${s.file}" alt=""></figure>`)
      .join("\n")
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RPI funnel after the cleanup</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1320px;margin:0 auto;padding:24px;background:#f6f6f4;color:#13323c}
figure{margin:0 0 40px}figcaption{margin:0 0 10px}img{max-width:100%;border:1px solid #ddd;border-radius:8px}</style>
<h1>Rotational Performance Index funnel, after the 2026-10-06 cleanup</h1>
<p>Real app on the dev clone, which holds the same pages and quiz as production now does. Shots 1-5 and 7 are a <code>/preview/${SLUG}</code> test run (nothing saved). Desktop 1280 wide; phone 390 wide at 2x. Funnel pages and the admin have no dark mode.</p>
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
