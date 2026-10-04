// Walks the RPI quiz the way a VISITOR does, in the REAL app (/preview/<slug>,
// the test-run mirror of /go), against the dev clone, and burns callouts into
// each PNG.
//
//   npm run dev -- --webpack     # port 3050, in another terminal
//   npx tsx scripts/capture-rpi-quiz-visitor-walkthrough.ts .env.local
//
// WRITES (dev clone only, ref asserted): one funnel + one quiz clone made
// through the real create dialog, both deleted in `finally`. The clone keeps
// the RPI quiz's real clip URLs. NO uploads, no clip picker, nothing to Firebase.
// The /preview test run itself writes nothing.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { chromium, type Page, type Locator, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }
type Pick = number | RegExp // number: index into the options, -1 = last

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/rpi-video-quiz-gaps/visitor-walkthrough"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const FUNNEL_NAME = `RPI visitor ${String(Date.now()).slice(-6)}`
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }
const steps: { file: string; text: string }[] = []

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

async function signIn(ctx: BrowserContext): Promise<void> {
  const p = await ctx.newPage()
  await p.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded" })
  if (!p.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p.url()})`)
  await p.close()
  await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])
}

/** Wait until a clip shows a real decoded frame that is moving. */
async function videoPlaying(page: Page): Promise<void> {
  const v = page.locator("video.djp-quiz-media").first()
  await v.scrollIntoViewIfNeeded()
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

/** Marker on a real element, in image pixels, page scrolled to the top. */
async function markerAt(page: Page, dsf: number, target: string | Locator, caption: string, nudge = { x: -8, y: 4 }): Promise<Marker> {
  const el = typeof target === "string" ? page.locator(target).first() : target.first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${target} (${caption})`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE: ${target}`)
  return { x: Math.round((box.x + nudge.x) * dsf), y: Math.round((box.y + nudge.y) * dsf), caption }
}

/** Full-page capture with the pointer parked; `build` runs at scroll 0 so boxes are page coordinates. */
async function shoot(
  page: Page,
  dsf: number,
  file: string,
  title: string,
  subtitle: string,
  sentence: string,
  build: () => Promise<Marker[]>,
): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await page.addStyleTag({ content: `nextjs-portal, [role="status"].fixed, div[class*="--warning"], [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }` })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
  const markers = await build()
  const raw = `${OUT}/.raw-${file}`
  await page.screenshot({ path: raw, fullPage: true })
  const r = await annotate(raw, `${OUT}/${file}`, { title, subtitle, markers, scale: dsf === 2 ? 1 : 0.9 })
  rmSync(raw, { force: true })
  steps.push({ file, text: sentence })
  console.log(`  ${file}  ${r.width}x${r.height}`)
}

async function answer(page: Page, pick: Pick): Promise<void> {
  const options = page.locator(".djp-quiz-option")
  const opt = typeof pick === "number" ? (pick < 0 ? options.last() : options.nth(pick)) : options.filter({ hasText: pick }).first()
  await opt.click()
  await page.waitForTimeout(450)
}

async function currentPrompt(page: Page): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const t = (await page.locator(".djp-quiz-prompt").first().innerText().catch(() => "")).trim()
    if (t) return t
    await page.waitForTimeout(250)
  }
  return ""
}

/** Answer until the prompt matches `stop` (not answered) or the gate shows. */
async function walkTo(page: Page, pick: (p: string) => Pick, stop?: RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if ((await page.locator(".djp-quiz-gate, .djp-quiz-result").count()) > 0) return
    const p = await currentPrompt(page)
    if (stop && stop.test(p)) return
    await answer(page, pick(p))
  }
  throw new Error("walk did not finish in 40 steps")
}

const lopsided = (p: string): Pick => (/left side/.test(p) ? /^All three/ : /right side/.test(p) ? -1 : 0)
const strong = (p: string): Pick => (/side|Rocking hollow/.test(p) ? /^All three/ : 0)

async function fillGate(page: Page): Promise<void> {
  await page.locator("#djp-quiz-name").fill("Sam Rivera")
  await page.locator("#djp-quiz-email").fill("sam.rivera@example.com")
  const ticks = page.locator(".djp-quiz-gate input[type=checkbox]")
  for (let i = 0; i < (await ticks.count()); i += 1) if (!(await ticks.nth(i).isChecked())) await ticks.nth(i).check()
}

async function submitGate(page: Page): Promise<void> {
  await page.locator(".djp-quiz-gate button[type=submit]").click()
  await page.locator(".djp-quiz-result").waitFor({ timeout: 30_000 })
  await page.waitForTimeout(700)
}

async function open(ctx: BrowserContext, slug: string): Promise<Page> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/preview/${slug}`, { waitUntil: "networkidle" })
  return page
}

async function main() {
  const env = loadEnv(process.argv[2] ?? ".env.local")
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("env is missing Supabase credentials")
  if (new URL(url).host.split(".")[0] !== CLONE_REF) {
    console.error("REFUSING: not the dev clone.")
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const browser = await chromium.launch({ channel: "chrome" })
  let funnelId = ""
  let cloneQuizId = ""
  try {
    const desk = await browser.newContext(DESKTOP)
    await signIn(desk)
    const mob = await browser.newContext(MOBILE)
    await signIn(mob)

    // The funnel + clone, through the real create dialog.
    const dlg = await desk.newPage()
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
    await dlg.close()
    // The clone must carry the real clips and labels.
    const { data: qs } = await supabase.from("quiz_questions").select("media_url, mistakes_media_url, report_label").eq("quiz_id", cloneQuizId)
    const rows = (qs ?? []) as { media_url: string | null; mistakes_media_url: string | null; report_label: string | null }[]
    const withBoth = rows.filter((r) => r.media_url && r.mistakes_media_url && r.report_label).length
    console.log(`  funnel ${funnelId} /preview/${slug}; clone ${cloneQuizId}: ${withBoth} movement questions with demo + mistakes + label`)
    if (withBoth < 9) throw new Error("clone is missing clips or labels")

    const sub = `/preview/${slug} · test run · phone 390 wide · light`
    const M = async (page: Page, t: string | Locator, c: string, n?: { x: number; y: number }) => markerAt(page, 2, t, c, n)

    // ---- Mobile walk A: lopsided.
    const a = await open(mob, slug)
    await shoot(a, 2, "01-quiz-intro.png", "The visitor opens the quiz and sees one clear promise", sub,
      "The visitor lands on the quiz page, reads what the quiz is about and taps Start.", async () => [
        await M(a, ".djp-test-run", "Test run: nothing is saved and no one is emailed."),
        await M(a, ".djp-quiz-prompt", "The headline says what the quiz is and what they get."),
        await M(a, ".djp-quiz-help", "A short line says how long it takes and what to expect."),
        await M(a, "button.djp-btn-primary", "“Start” begins the quiz. No sign-up yet."),
      ])
    await a.getByRole("button", { name: /^start$/i }).first().click()
    await currentPrompt(a)
    await shoot(a, 2, "02-sport-router-question.png", "The first question asks which sport they play", sub,
      "The visitor picks their sport. This decides which sport-specific questions come next.", async () => [
        await M(a, ".djp-quiz-progress", "The bar shows how far through the quiz they are."),
        await M(a, ".djp-quiz-step", "“Question 1 of …” tells them where they are."),
        await M(a, ".djp-quiz-prompt", "One plain question, one tap to answer."),
        await M(a, ".djp-quiz-option", "Tapping an answer moves straight to the next question."),
      ])
    await answer(a, 0)
    await currentPrompt(a)
    await shoot(a, 2, "06-self-report-question.png", "A scored question the visitor answers about themselves", sub,
      "The visitor answers a question about how their body feels. Their answer counts toward the score.", async () => [
        await M(a, ".djp-quiz-step", "These questions are not videos. The visitor just answers honestly."),
        await M(a, ".djp-quiz-prompt", "Written in the athlete's own words, for their sport."),
        await M(a, ".djp-quiz-option", "Each answer is worth points toward the 0 to 100 score."),
      ])
    await answer(a, 0)
    await walkTo(a, lopsided, /Short lever Copenhagen — left/)
    await videoPlaying(a)
    await shoot(a, 2, "03-movement-question-demo-clip.png", "A movement question: watch the clip, then say how many points you held", sub,
      "The visitor watches the demo clip, reads the three things to hold, then taps how many they managed.", async () => [
        await M(a, ".djp-quiz-help", "The text names the three things to hold, so the visitor knows what “good” looks like."),
        await M(a, ".djp-quiz-toggle button[aria-pressed=\"true\"]", "“How to do it” is selected, so this clip shows the movement done correctly."),
        await M(a, "video.djp-quiz-media", "The clip plays by itself and repeats. The visitor can pause or replay it."),
        await M(a, ".djp-quiz-option", "Four answers: all three, two, one, or none of the three."),
      ])
    await a.locator(".djp-quiz-toggle button", { hasText: "Common mistakes" }).click()
    await videoPlaying(a)
    await shoot(a, 2, "04-common-mistakes-clip.png", "Tapping “Common mistakes” swaps the clip", sub,
      "The visitor taps “Common mistakes” and the clip changes to show what to avoid.", async () => [
        await M(a, ".djp-quiz-toggle button[aria-pressed=\"true\"]", "“Common mistakes” is now selected."),
        await M(a, "video.djp-quiz-media", "The clip now shows the usual mistakes, with sound so the coach names each one."),
        await M(a, ".djp-quiz-option", "The same four answers stay below, so the visitor can answer straight after watching."),
      ])
    await a.locator(".djp-quiz-toggle button", { hasText: "How to do it" }).click()
    await answer(a, /^All three/)
    await currentPrompt(a)
    await videoPlaying(a)
    await shoot(a, 2, "05-second-side-of-the-test.png", "The same test is asked again for the other side", sub,
      "The visitor does the same test on the other side and answers again. Left and right are scored separately.", async () => [
        await M(a, ".djp-quiz-step", "The question counter has moved on by one."),
        await M(a, ".djp-quiz-prompt", "Same movement, now “right side”. Each side gets its own answer."),
        await M(a, "video.djp-quiz-media", "The same demo clip is here again, ready to watch."),
      ])
    await answer(a, -1)
    await walkTo(a, lopsided)
    await a.locator(".djp-quiz-gate").waitFor()
    await shoot(a, 2, "07-email-gate.png", "Before the result, the visitor leaves their details", sub,
      "The visitor enters their name and email and agrees to be contacted, then taps the button to see the result.", async () => [
        await M(a, ".djp-quiz-prompt", "The headline tells them the result is ready."),
        await M(a, "#djp-quiz-name", "Name and email are needed to send them their result."),
        await M(a, ".djp-quiz-consent input", "They choose whether they agree to be contacted."),
        await M(a, ".djp-quiz-gate button[type=submit]", "This button shows the result."),
      ])
    await fillGate(a)
    await submitGate(a)
    const reframe = a.locator(".djp-quiz-profile-body").nth(1)
    const gap = a.locator('.djp-quiz-status[data-status="gap"]').first()
    if ((await gap.count()) === 0) throw new Error("lopsided walk produced no gap row")
    const structure = a.getByText(/This isn.t an effort problem/).first()
    await shoot(a, 2, "08-result-lopsided.png", "A lopsided result: strong on one side, weak on the other", sub,
      "The visitor sees their score, what they told us, a movement map with the gap flagged, and a plain explanation.", async () => [
        await M(a, ".djp-quiz-tier", "Their tier, named in plain words."),
        await M(a, ".djp-quiz-score", "Their score out of 100."),
        await M(a, gap, "Left/right gap: the left side was clean but the right side was weak, so this row is flagged."),
        await M(a, reframe, "A second short paragraph, with clear space above it, so the explanation reads easily on a phone."),
        ...((await structure.count()) > 0 ? [await M(a, structure, "The key line: this is a structure problem, not an effort problem.")] : []),
        await M(a, ".djp-quiz-result a.djp-btn", "The next step for the visitor."),
      ])
    await a.close()

    // ---- Mobile walk B: strong.
    const b = await open(mob, slug)
    await b.getByRole("button", { name: /^start$/i }).first().click()
    await walkTo(b, strong)
    await b.locator(".djp-quiz-gate").waitFor()
    await fillGate(b)
    await submitGate(b)
    if ((await b.locator('.djp-quiz-status[data-status="gap"]').count()) > 0) console.warn("  NOTE: strong walk still shows a gap row")
    await shoot(b, 2, "09-result-strong.png", "A strong result: every movement held on both sides", sub,
      "A visitor who held every movement on both sides sees a high score and a clean map.", async () => [
        await M(b, ".djp-quiz-tier", "A higher tier, with its own wording."),
        await M(b, ".djp-quiz-score", "A high score."),
        await M(b, ".djp-quiz-map", "Every movement row reads as solid, with no gap flagged."),
        await M(b, ".djp-quiz-result a.djp-btn", "The next step matches the tier."),
      ])
    await b.close()

    // ---- Desktop: movement question + lopsided result.
    const d = await open(desk, slug)
    const dsub = `/preview/${slug} · test run · desktop 1280 wide · light`
    await d.getByRole("button", { name: /^start$/i }).first().click()
    await currentPrompt(d)
    await answer(d, 0)
    await walkTo(d, lopsided, /Short lever Copenhagen — left/)
    await videoPlaying(d)
    await shoot(d, 1, "11-desktop-movement-question.png", "The same movement question on a computer", dsub,
      "On a computer the visitor sees the same question, clip, toggle and answers in a wider layout.", async () => [
        await markerAt(d, 1, ".djp-quiz-prompt", "The question and its three points."),
        await markerAt(d, 1, ".djp-quiz-toggle", "Switch between the demo and the common mistakes."),
        await markerAt(d, 1, "video.djp-quiz-media", "The clip plays and repeats."),
        await markerAt(d, 1, ".djp-quiz-option", "Four answers."),
      ])
    await answer(d, /^All three/)
    await walkTo(d, lopsided)
    await d.locator(".djp-quiz-gate").waitFor()
    await fillGate(d)
    await submitGate(d)
    await shoot(d, 1, "10-desktop-result-lopsided.png", "The lopsided result on a computer", dsub,
      "The same lopsided result in the wider computer layout.", async () => [
        await markerAt(d, 1, ".djp-quiz-tier", "Tier and score."),
        await markerAt(d, 1, d.locator('.djp-quiz-status[data-status="gap"]').first(), "The left/right gap row."),
        await markerAt(d, 1, d.locator(".djp-quiz-profile-body").nth(1), "The explanation, in spaced paragraphs."),
        await markerAt(d, 1, ".djp-quiz-result a.djp-btn", "The next step."),
      ])
    await d.close()

    // index.html with sibling images
    steps.sort((x, y) => x.file.localeCompare(y.file))
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RPI quiz, what a visitor sees</title>
<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:0;background:#f4f6f7;color:#223b44}main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{color:#0E3F50}
section{background:#fff;border:1px solid #dde3e6;border-radius:12px;padding:16px;margin:0 0 20px}h2{margin:0 0 6px;font-size:18px}p{margin:0 0 12px}img{max-width:100%;height:auto;border:1px solid #dde3e6;border-radius:8px}img.phone{max-width:390px}</style></head><body><main>
<h1>The Rotational Performance Index quiz, start to result</h1>
<p>Phone shots are 390 wide, captured at 2x. Desktop shots are 1280 wide. The visitor page has no dark mode: the quiz section is always light.</p>
${steps.map((s) => `<section><h2>${s.file.replace(/\.png$/, "")}</h2><p>${s.text}</p><img class="${/desktop/.test(s.file) ? "" : "phone"}" src="${s.file}" alt="${s.text.replace(/"/g, "&quot;")}"></section>`).join("\n")}
</main></body></html>`
    writeFileSync(`${OUT}/index.html`, html)
  } finally {
    await browser.close()
    if (cloneQuizId) await supabase.from("quizzes").delete().eq("id", cloneQuizId)
    if (funnelId) await supabase.from("funnels").delete().eq("id", funnelId)
    console.log("  removed the funnel and quiz clone this run created")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
