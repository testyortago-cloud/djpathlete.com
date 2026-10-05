// Walks the Rotational Performance Index funnel the way a visitor does, in the
// REAL app (/preview/<slug>, the test-run mirror of /go), against the dev
// clone, and burns callouts into each PNG.
//
//   npx next dev --webpack --port 3050          # in another terminal
//   npx tsx scripts/seed-rpi-landing-funnel.ts .env.local --execute
//   npx tsx scripts/capture-rpi-landing-funnel.ts .env.local
//
// WRITES NOTHING to any database: the funnel must already exist (the seed
// script above makes it), and a /preview test run performs zero writes. The
// env file must point at the dev clone; anything else is refused.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { chromium, type Page, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/rpi-landing-funnel"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const SLUG = "rotational-performance-index"
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }
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

/** Lazy images load only near the viewport: walk the page, then wait for every one to decode. */
async function loadImages(page: Page): Promise<void> {
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < h; y += 600) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    await page.waitForTimeout(120)
  }
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, {
    timeout: 30_000,
  })
}

/** Hide the dev overlay and the preview toast, which cover the page they describe. */
async function clean(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `nextjs-portal, [role="status"].fixed, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

/** Marker on a real element, in image pixels, for a VIEWPORT screenshot. */
async function M(page: Page, dsf: number, selector: string, caption: string): Promise<Marker> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector} (${caption})`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE: ${selector}`)
  // Left of the element's corner, so the marker does not sit on its first letter.
  return { x: Math.round((box.x - 20) * dsf), y: Math.round((box.y + 2) * dsf), caption }
}

async function shoot(page: Page, dsf: number, file: string, title: string, sentence: string, build: () => Promise<Marker[]>) {
  mkdirSync(OUT, { recursive: true })
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
  const markers = await build()
  const raw = `${OUT}/.raw-${file}`
  await page.screenshot({ path: raw })
  const subtitle = `${new URL(page.url()).pathname} · test run · light`
  const r = await annotate(raw, `${OUT}/${file}`, { title, subtitle, markers, scale: dsf === 2 ? 1 : 0.9 })
  rmSync(raw, { force: true })
  shots.push({ file, text: sentence })
  console.log(`  ${file}  ${r.width}x${r.height}`)
}

/** Scroll so `selector` sits `offset` CSS px below the top of the viewport. */
async function scrollTo(page: Page, selector: string, offset = 24): Promise<void> {
  await page.locator(selector).first().evaluate((el, off) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off)
  }, offset)
  await page.waitForTimeout(500)
}

/** Wait until the quiz clip shows a real decoded frame that is moving. */
async function videoPlaying(page: Page): Promise<void> {
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

/** Answer the quiz's opening questions until the first movement test shows. */
async function toFirstTest(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^start$/i }).first().click()
  for (let i = 0; i < 6; i += 1) {
    await page.locator(".djp-quiz-prompt").first().waitFor()
    if ((await page.locator("video.djp-quiz-media").count()) > 0) return
    await page.locator(".djp-quiz-option").first().click()
    await page.waitForTimeout(450)
  }
  throw new Error("no movement test within 6 answers")
}

async function main() {
  if (envRef(process.argv[2] ?? ".env.local") !== CLONE_REF) {
    console.error("REFUSING: not the dev clone.")
    process.exit(1)
  }
  const browser = await chromium.launch({ channel: "chrome" })
  try {
    // ---- desktop landing page -------------------------------------------
    const desk = await browser.newContext(DESKTOP)
    await signIn(desk)
    const d = await desk.newPage()
    await d.goto(`${APP}/preview/${SLUG}`, { waitUntil: "networkidle", timeout: 180_000 })
    await clean(d)
    await loadImages(d)
    await d.evaluate(() => window.scrollTo(0, 0))

    await shoot(d, 1, "01-landing-hero.png", "The landing page opens on the problem and one clear button",
      "The visitor lands on the page. One button starts the assessment; the strip below says what it takes.", async () => [
        await M(d, 1, ".djp-s-hero h1", "The headline names the problem the quiz finds: lost power."),
        await M(d, 1, ".djp-s-hero .djp-btn >> nth=0", "“Start my free assessment” opens the quiz step of this same funnel, not a GHL survey."),
        await M(d, 1, ".djp-s-hero .djp-btn >> nth=1", "“See the five tests” jumps down the page to the tests."),
        await M(d, 1, ".djp-s-proof", "What it takes, in the quiz's own numbers: 5 tests, 4 questions, about five minutes."),
      ])

    await scrollTo(d, "#tests")
    await shoot(d, 1, "02-landing-five-tests.png", "The five tests, shown before the visitor starts",
      "Lower down, the visitor sees the five tests with a still from each test's own demo clip.", async () => [
        await M(d, 1, "#tests .djp-step-media", "A still from the test's real demo clip, the one the quiz plays."),
        await M(d, 1, "#tests .djp-step-title", "Each card says what the test shows about the athlete."),
      ])

    await scrollTo(d, "#faq")
    await shoot(d, 1, "03-landing-faq-and-final-button.png", "Questions answered, then the same button again",
      "Near the end, short answers to the usual questions, then one more way in.", async () => [
        await M(d, 1, "#faq .djp-faq-item", "The answers match the quiz: no equipment, about five minutes, free."),
        await M(d, 1, "#cta .djp-btn", "The same button, for the visitor who read to the end."),
      ])

    // ---- the button really opens the quiz step ---------------------------
    await scrollTo(d, "#hero", 0)
    await Promise.all([d.waitForURL(`**/preview/${SLUG}/quiz`), d.locator(".djp-s-hero .djp-btn").first().click()])
    await d.waitForLoadState("networkidle")
    await clean(d)
    await toFirstTest(d)
    await videoPlaying(d)
    await scrollTo(d, ".djp-quiz-prompt", 140)
    await shoot(d, 1, "04-quiz-movement-test-with-clip.png", "The button lands on the quiz, and each test has its clip",
      "The visitor pressed the button, answered two questions, and reached the first movement test.", async () => [
        await M(d, 1, ".djp-quiz-prompt", "The first movement test. Four of the five are asked once per side."),
        await M(d, 1, ".djp-quiz-toggle", "“How to do it” and “Common mistakes” switch the clip."),
        await M(d, 1, "video.djp-quiz-media", "The demo clip, playing. This is what the GHL survey did not show."),
        await M(d, 1, ".djp-quiz-option", "The visitor scores themselves after watching."),
      ])

    await d.locator(".djp-quiz-toggle button", { hasText: "Common mistakes" }).click()
    await videoPlaying(d)
    await scrollTo(d, ".djp-quiz-prompt", 140)
    await shoot(d, 1, "05-quiz-common-mistakes-clip.png", "“Common mistakes” swaps in the second clip",
      "The visitor taps “Common mistakes” and the clip changes to show what to avoid.", async () => [
        await M(d, 1, ".djp-quiz-toggle button[aria-pressed=\"true\"]", "“Common mistakes” is selected."),
        await M(d, 1, "video.djp-quiz-media", "The mistakes clip, playing, with sound so each mistake is named."),
      ])

    // ---- phone -----------------------------------------------------------
    const mob = await browser.newContext(MOBILE)
    await signIn(mob)
    const m = await mob.newPage()
    await m.goto(`${APP}/preview/${SLUG}`, { waitUntil: "networkidle", timeout: 180_000 })
    await clean(m)
    await loadImages(m)
    await m.evaluate(() => window.scrollTo(0, 0))
    await shoot(m, 2, "06-phone-landing-hero.png", "On a phone",
      "On a phone the headline, the short pitch and the button all fit on the first screen.", async () => [
        await M(m, 2, ".djp-s-hero h1", "The headline fits in five lines."),
        await M(m, 2, ".djp-s-hero .djp-btn >> nth=0", "The button is on the first screen, before any scrolling."),
      ])

    await Promise.all([m.waitForURL(`**/preview/${SLUG}/quiz`), m.locator(".djp-s-hero .djp-btn").first().click()])
    await m.waitForLoadState("networkidle")
    await clean(m)
    await toFirstTest(m)
    await videoPlaying(m)
    await scrollTo(m, ".djp-quiz-prompt", 16)
    await shoot(m, 2, "07-phone-quiz-clip.png", "The quiz on a phone",
      "On a phone the test, its clip and the toggle sit in one column.", async () => [
        await M(m, 2, ".djp-quiz-toggle", "The toggle between the demo and the common mistakes."),
        await M(m, 2, "video.djp-quiz-media", "The demo clip, playing."),
      ])

    // ---- review page ------------------------------------------------------
    const rows = shots
      .map((s, i) => `<figure><figcaption><b>${i + 1}.</b> ${s.text}</figcaption><img src="${s.file}" alt=""></figure>`)
      .join("\n")
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rotational Performance Index funnel</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1320px;margin:0 auto;padding:24px;background:#f6f6f4;color:#13323c}
figure{margin:0 0 40px}figcaption{margin:0 0 10px}img{max-width:100%;border:1px solid #ddd;border-radius:8px}</style>
<h1>Rotational Performance Index funnel: landing page, then the video quiz</h1>
<p>Real app, <code>/preview/${SLUG}</code> on the dev clone, as a test run (nothing saved). Desktop shots are 1280 wide; phone shots are 390 wide at 2x. Funnel pages have no dark mode.</p>
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
