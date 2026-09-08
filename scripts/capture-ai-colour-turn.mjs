// Drives the REAL AI page-builder chat on the REAL funnel builder route with
// the REAL model, asking for the thing that used to answer "I couldn't build
// that — try describing it differently": a green background with white text.
//
//   npm run dev                                  # port 3050
//   node scripts/capture-ai-colour-turn.mjs
//
// This spends a real model call. It is the only way to photograph the fix: the
// failure was the model refusing, and no fixture can show a model changing its
// mind.
//
// LIGHT ONLY (the admin was never built against `.dark`). DEV CLONE ONLY.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/section-colour-picker"
const WIDTH = 1600
const HEIGHT = 950
const DSF = 2
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const FUNNEL = "a7450381-3042-4f0b-9236-abf3bf8e10ad"
const STEP = "7f5da342-aa37-42aa-bed3-020842893da9"
const ASK = "make the top section background the colour green with the text in white"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const rest = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
}

async function heroTone() {
  const rows = await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_steps?select=project_data&id=eq.${STEP}`, {
      headers: rest,
    })
  ).json()
  return rows[0].project_data.sections.find((s) => s.id === "hero")?.style?.tone ?? "unset"
}

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : place === "after" ? box.x + box.width + 22 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  const before = await heroTone()
  console.log(`  hero tone before the turn: ${before}`)

  const p0 = await ctx.newPage()
  await p0.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await p0.waitForTimeout(2500)
  if (!p0.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${p0.url()})`)
  await p0.close()
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()
  await page.goto(`${APP}/admin/funnels/${FUNNEL}/edit/${STEP}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)

  const box = page.getByPlaceholder(/Make the headline shorter/i)
  await box.waitFor({ state: "visible", timeout: 20000 })
  await box.fill(ASK)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  console.log(`  sent: "${ASK}" — waiting for the turn…`)

  // Wait on the DOCUMENT, not on a spinner: the turn is done when the stored
  // hero tone actually changes. A UI-only wait would pass on a failed turn too.
  const deadline = Date.now() + 240_000
  let after = before
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000)
    after = await heroTone()
    if (after !== before) break
  }
  console.log(`  hero tone after the turn:  ${after}`)
  if (after !== "dark") {
    throw new Error(`the turn did not set the hero to the green tone (got "${after}") — refusing to caption a pass`)
  }

  await page.waitForTimeout(4000)
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
  await page.mouse.move(4, 4)
  await page.waitForTimeout(300)

  mkdirSync(OUT, { recursive: true })
  const raw = `${OUT}/.raw-03.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/03-ai-chat-answers-a-colour-request.png`, {
    title: "The AI chat now answers a colour request",
    subtitle:
      'Same wording that used to return "I couldn\'t build that — try describing it differently". Real model, real route.',
    markers: [
      await markerOn(page, page.getByText(ASK, { exact: false }).first(), `What was typed: “${ASK}”.`, {
        place: "after",
      }),
      await markerOn(
        page,
        page.locator('iframe[src*="funnel-preview"]:visible').first(),
        'The top band is now the brand green with white text — the model chose tone "dark", the tone that paints var(--primary).',
        { place: "center", dy: -300 },
      ),
    ],
  })
  console.log(`  03-ai-chat-answers-a-colour-request.png  ${r.width}x${r.height}`)
} finally {
  await browser.close()
}
