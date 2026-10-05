// Captures the Performance Gap Map landing page and the pre-visit onboarding
// form in the REAL app, against the dev clone, with callouts burned into each
// PNG; and proves the onboarding waiver end to end.
//
//   npx next dev --webpack --port 3050          # in another terminal
//   npx tsx scripts/seed-funnel-pages.ts gap-map .env.local --execute
//   npx tsx scripts/seed-funnel-pages.ts onboarding .env.local --business=<uuid> --execute
//   npx tsx scripts/capture-funnel-pages.ts .env.local
//
// WRITES (dev clone only, ref asserted): publishes /go/onboarding through the
// real publish route, submits it ONCE as a visitor (test inbox, no SMS or email
// opt-in ticked), reads that submission back, then returns the page to draft so
// the seed script can rewrite it. The submission row is left as evidence.

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { chromium, type Page, type BrowserContext } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/funnel-pages"
const CLONE_REF = "anjvztjiokcgiyhobknq"
const TEST_INBOX = "tayawaschoolworks@gmail.com"
const DESKTOP = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const shots: { file: string; text: string }[] = []

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
  await p.goto(`${APP}/api/dev/login?callbackUrl=/admin/funnels`, { waitUntil: "domcontentloaded", timeout: 180_000 })
  if (!p.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p.url()})`)
  await p.close()
  await ctx.addCookies([{ name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: APP }])
}

async function open(ctx: BrowserContext, path: string): Promise<Page> {
  const page = await ctx.newPage()
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle", timeout: 180_000 })
  await page.addStyleTag({
    content: `nextjs-portal, [role="status"].fixed, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < h; y += 600) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    await page.waitForTimeout(120)
  }
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30_000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  return page
}

async function M(page: Page, dsf: number, selector: string, caption: string): Promise<Marker> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector} (${caption})`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE: ${selector}`)
  return { x: Math.round((box.x - 20) * dsf), y: Math.round((box.y + 2) * dsf), caption }
}

async function scrollTo(page: Page, selector: string, offset = 24): Promise<void> {
  await page.locator(selector).first().evaluate((el, off) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off)
  }, offset)
  await page.waitForTimeout(500)
}

async function shoot(page: Page, dsf: number, file: string, title: string, sentence: string, subtitle: string, build: () => Promise<Marker[]>) {
  mkdirSync(OUT, { recursive: true })
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
  const markers = await build()
  const raw = `${OUT}/.raw-${file}`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${file}`, { title, subtitle, markers, scale: dsf === 2 ? 1 : 0.9 })
  rmSync(raw, { force: true })
  shots.push({ file, text: sentence })
  console.log(`  ${file}  ${r.width}x${r.height}`)
}

async function main() {
  const env = loadEnv(process.argv[2] ?? ".env.local")
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0] !== CLONE_REF) {
    console.error("REFUSING: not the dev clone.")
    process.exit(1)
  }
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: onboarding } = await db.from("funnels").select("id, status").eq("slug", "onboarding").single()
  if (!onboarding) throw new Error("Seed /go/onboarding first.")

  const browser = await chromium.launch({ channel: "chrome" })
  try {
    const desk = await browser.newContext(DESKTOP)
    await signIn(desk)

    // ---- the Gap Map landing page ---------------------------------------
    const g = await open(desk, "/preview/performance-gap-map")
    const preview = (p: Page) => `${new URL(p.url()).pathname} · test run · light`
    await shoot(g, 1, "01-gap-map-hero.png", "The Gap Map page opens on the promise and one button",
      "The visitor lands on the Performance Gap Map page; one button starts the quiz.", preview(g), async () => [
        await M(g, 1, ".djp-s-hero h1", "The headline from the GHL page, on a photo instead of a flat panel."),
        await M(g, 1, ".djp-s-hero .djp-btn >> nth=0", "Opens the quiz step of this funnel: the same questions the GHL survey asks."),
        await M(g, 1, ".djp-s-proof", "What it takes. Name and email come at the end, not before the first question."),
      ])
    await scrollTo(g, "#who")
    await shoot(g, 1, "02-gap-map-who-and-pillars.png", "Four situations, then how the readout is built",
      "Lower down, the visitor finds their situation, then the four ideas behind the readout.", preview(g), async () => [
        await M(g, 1, "#who .djp-bullet-item", "The quiz's own four routes, so a visitor recognises theirs before question one."),
        await M(g, 1, "#pillars .djp-bullet-item", "The GHL page's four pillars, kept."),
      ])

    // ---- the onboarding form: preview, then a real visitor ---------------
    const o = await open(desk, "/preview/onboarding")
    await shoot(o, 1, "03-onboarding-form.png", "The pre-visit form, the same questions as GHL",
      "Before a first session, the client fills in this form.", preview(o), async () => [
        await M(o, 1, ".djp-s-form h2", "The same opening line as the GHL page."),
        await M(o, 1, '[data-djp-field="currently_training"]', "Dropdowns keep GHL's choices: Yes / No, and five training-history bands."),
      ])
    await scrollTo(o, "[data-djp-waiver]", 160)
    await shoot(o, 1, "04-onboarding-waiver.png", "The live waiver, above the tick",
      "At the end, the client reads the liability waiver and ticks to agree.", preview(o), async () => [
        await M(o, 1, "[data-djp-waiver]", "The ACTIVE waiver from Legal documents, not text pasted into the page."),
        await M(o, 1, '[data-djp-field="waiver"]', "The tick is required, and the server refuses a faked one."),
      ])

    const publish = await (await desk.newPage()).request.post(`${APP}/api/admin/funnels/${onboarding.id}/publish`, { data: {} })
    if (!publish.ok()) throw new Error(`publish failed: ${publish.status()} ${await publish.text()}`)

    const visitor = await browser.newContext(DESKTOP)
    const v = await visitor.newPage()
    await v.goto(`${APP}/go/onboarding`, { waitUntil: "networkidle", timeout: 180_000 })
    await v.locator("[data-djp-form] input, [data-djp-form] select").first().waitFor()
    await v.waitForTimeout(1500) // hydration: an enabled button can still do nothing before it
    const fill = (name: string, value: string) => v.locator(`[data-djp-field="${name}"] input, [data-djp-field="${name}"] textarea`).first().fill(value)
    const pick = (name: string, value: string) => v.locator(`[data-djp-field="${name}"] select`).selectOption(value)
    await fill("first_name", "Sam")
    await fill("last_name", "Rivera (test)")
    await fill("phone", "+15005550006")
    await fill("email", TEST_INBOX)
    await fill("age", "17")
    await pick("currently_training", "Yes")
    await fill("current_training", "Club soccer 3x a week, gym twice.")
    await pick("training_history", "1–3 years")
    await pick("injury_or_pain", "No")
    await fill("previous_injuries", "Ankle sprain in 2025, fully recovered.")
    await pick("seeing_professional", "No")
    await fill("goals", "Faster first step and fewer hamstring niggles.")
    await fill("medical_conditions", "None.")
    await v.locator('[data-djp-field="waiver"] input[type=checkbox]').check()
    const startedAt = new Date().toISOString()
    await v.getByRole("button", { name: /submit & confirm/i }).click()
    await v.locator(".djp-form-success").waitFor({ timeout: 30_000 })
    await v.addStyleTag({ content: `nextjs-portal { display: none !important; }` })
    await scrollTo(v, ".djp-s-form", 0)
    await shoot(v, 1, "05-onboarding-submitted.png", "Submitted on the live page",
      "The client presses Submit and sees a thank-you.", `${new URL(v.url()).pathname} · published (dev clone) · light`, async () => [
        await M(v, 1, ".djp-form-success", "The thank-you. The answers are now a lead on the Leads page."),
      ])

    const { data: row } = await db
      .from("funnel_submissions")
      .select("id, created_at, ip_address, user_agent, waiver_accepted_at, waiver_document_id, payload")
      .eq("funnel_id", onboarding.id)
      .gte("created_at", startedAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
    if (!row?.waiver_accepted_at) throw new Error(`WAIVER EVIDENCE MISSING: ${JSON.stringify(row)}`)
    const { data: activeDoc } = await db.from("legal_documents").select("id, version").eq("document_type", "liability_waiver").eq("is_active", true).single()
    console.log(`  row ${row.id}: accepted ${row.waiver_accepted_at}, doc ${row.waiver_document_id} (active ${activeDoc?.id} v${activeDoc?.version}), ip ${row.ip_address}`)
    if (row.waiver_document_id !== (activeDoc?.id ?? null)) throw new Error("the filed document is not the active one")

    const l = await desk.newPage()
    await l.goto(`${APP}/admin/funnels/leads?funnelId=${onboarding.id}`, { waitUntil: "networkidle", timeout: 180_000 })
    await l.addStyleTag({ content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }` })
    await l.getByRole("button", { name: /Show Sam Rivera \(test\)'s answers/i }).first().click()
    await l.getByText(/Accepted the liability waiver/).first().scrollIntoViewIfNeeded()
    await l.evaluate(() => window.scrollBy(0, 200))
    await shoot(l, 1, "06-leads-waiver-accepted.png", "The coach sees the acceptance on the lead",
      "On the Leads page, the coach opens the lead and sees the answers and the waiver acceptance.", "/admin/funnels/leads · light (admin has no dark mode)", async () => [
        await M(l, 1, "text=Accepted the liability waiver", "When the waiver was accepted, and from which IP. The row also files which document."),
      ])

    // ---- phone ------------------------------------------------------------
    const mob = await browser.newContext(MOBILE)
    await signIn(mob)
    const m = await open(mob, "/preview/onboarding")
    await scrollTo(m, "[data-djp-waiver]", 120)
    await shoot(m, 2, "07-phone-onboarding-waiver.png", "On a phone",
      "On a phone the waiver scrolls in its own box, so the button stays close.", preview(m), async () => [
        await M(m, 2, "[data-djp-waiver]", "The waiver scrolls inside its box."),
        await M(m, 2, '[data-djp-field="waiver"]', "The tick, under the document it agrees to."),
      ])

    const rows = shots.map((s, i) => `<figure><figcaption><b>${i + 1}.</b> ${s.text}</figcaption><img src="${s.file}" alt=""></figure>`).join("\n")
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gap Map and onboarding pages</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1320px;margin:0 auto;padding:24px;background:#f6f6f4;color:#13323c}
figure{margin:0 0 40px}figcaption{margin:0 0 10px}img{max-width:100%;border:1px solid #ddd;border-radius:8px}</style>
<h1>Performance Gap Map landing page, and the pre-visit onboarding form</h1>
<p>Real app on the dev clone. Shots 1-4 and 7 are /preview test runs (nothing saved). Shots 5-6 are a real submission on the published dev page, read back from the database: waiver accepted ${row.waiver_accepted_at}, document ${row.waiver_document_id}. Funnel pages and the admin have no dark mode.</p>
${rows}`,
    )
    console.log(`  ${OUT}/index.html`)
  } finally {
    await browser.close()
    // Back to draft, so `seed-funnel-pages.ts onboarding` can rewrite it.
    await db.from("funnels").update({ status: "draft" }).eq("id", onboarding.id)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
