// READ-ONLY captures of the REAL admin on PRODUCTION for the 2026-09-13 Lead
// Engine audit. Navigation and scrolling only — NO switch is clicked, NO form
// is saved, NO dialog is opened. See capture-sequence-management-prod.mjs for
// why: turning a sequence OFF on production fires immediately with no dialog.
//
//   node --env-file=.env.prod scripts/capture-lead-engine-audit-prod.mjs
//
// Production only; refuses any other Supabase project ref. Mints a short-lived
// admin session from NEXTAUTH_SECRET and asserts it before judging any screen.
//
// NOT RUN during the audit itself: the session's permission policy blocked it
// (it mints an admin session against production). The owner runs it.

import { mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { encode } from "next-auth/jwt"
import { annotate } from "./_annotate-lib.mjs"

const PROD_REF = "epzuvzkokzqtzomeyoha"
const APP = "https://www.darrenjpaul.com"
const OUT = "screenshots/lead-engine-audit"
const WIDTH = 1440
const DSF = 2
const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const ADMIN_EMAIL = "admin@darrenjpaul.com"

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== PROD_REF) throw new Error(`PRODUCTION ONLY; refusing — env points at ${ref}`)
mkdirSync(OUT, { recursive: true })

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
      if (existsSync(exe)) return chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

const seen = new Map()
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using first: "${caption.slice(0, 70)}"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 70)}"`)
    return { x: 100, y: 100, caption }
  }
  const id = `${Math.round(box.x)},${Math.round(box.y)}`
  if (seen.has(id)) console.warn(`  !! TWO MARKERS RESOLVED TO THE SAME ELEMENT as "${seen.get(id).slice(0, 50)}"`)
  seen.set(id, caption)
  const cx =
    place === "center"
      ? box.x + box.width / 2
      : place === "right"
        ? box.x + box.width - 22
        : place === "after"
          ? box.x + box.width + 22
          : place === "inset"
            ? box.x + 24
            : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers, { fullPage = true } = {}) {
  await page
    .addStyleTag({ content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }` })
    .catch(() => {})
  await page
    .evaluate(() => {
      for (const b of Array.from(document.querySelectorAll("button"))) {
        const s = getComputedStyle(b)
        if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
      }
    })
    .catch(() => {})
  await page.mouse.move(4, 4) // park the pointer
  await page.waitForTimeout(200)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
  seen.clear()
}

async function open(page, path) {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.scrollTo(0, 0))
}

const secret = process.env.NEXTAUTH_SECRET
if (!secret) throw new Error("NEXTAUTH_SECRET missing from .env.prod")
const token = await encode({
  secret,
  salt: "authjs.session-token",
  token: { id: ADMIN_ID, sub: ADMIN_ID, email: ADMIN_EMAIL, name: "Admin", role: "admin" },
  maxAge: 60 * 30,
})

const browser = await launchChromium()
try {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
  await ctx.addCookies([{ name: "__Secure-authjs.session-token", value: token, url: APP, secure: true, httpOnly: true, sameSite: "Lax" }])
  const page = await ctx.newPage()

  // ASSERT THE SESSION FIRST. An expired or rejected token photographs the
  // login page and reports a feature failure that mimics the scariest real bug.
  const s = await page.goto(`${APP}/api/auth/session`)
  const body = await s.text()
  if (!body.includes("admin")) throw new Error(`session did not take: ${body.slice(0, 120)}`)
  console.log("  session asserted as admin")

  await open(page, "/admin/sequences")
  await shoot(
    page,
    "P1-prod-sequences",
    "PRODUCTION /admin/sequences — all twelve switched on, one has ever run",
    "Read-only capture. Every switch is ON since 2026-09-09. Eleven sequences have never had a person enter them; the twelfth has 73, all in 'Something went wrong'.",
    [
      await markerOn(
        page,
        page.locator("tr", { hasText: "SMS Re-permission Ask" }).locator("td").nth(8),
        "73 people entered SMS Re-permission Ask on 2026-08-22 and every one failed on 2026-08-31 — the sender domain was not verified at the time.",
        { place: "center" },
      ),
      await markerOn(
        page,
        page.locator("tr", { hasText: "New Lead Nurture" }).locator("td").nth(2),
        "New Lead Nurture: 0 entered. No published funnel exists to feed it.",
        { place: "center" },
      ),
    ],
  )

  await open(page, "/admin/sequences/sms_repermission")
  await shoot(
    page,
    "P2-prod-sms-repermission",
    "PRODUCTION /admin/sequences/sms_repermission — the 73 stranded runs",
    "The people table at the bottom names each person and why they left. All 73 read 'Something went wrong'. Nothing here was clicked.",
    [
      await markerOn(
        page,
        page.getByText("Something went wrong").first(),
        "'Something went wrong' = terminal failed. The tick never picks these up again; only the repair script can.",
        { place: "left", dx: -8 },
      ),
    ],
  )

  await open(page, "/admin/funnels")
  await shoot(
    page,
    "P3-prod-funnels",
    "PRODUCTION /admin/funnels — three funnels, none live",
    "Every card is 'draft'. /go/<slug> answers 404 for all of them, so nothing on the public site feeds the engine.",
    [
      await markerOn(
        page,
        page.locator("text=draft").first(),
        "Athlete Quiz was live on 2026-09-06 and taken offline on 2026-09-11 19:50 UTC (audit log: funnel.updated). Its published version still exists.",
        { place: "left", dx: -8 },
      ),
    ],
  )

  await open(page, "/admin/pages")
  await shoot(
    page,
    "P4-prod-pages",
    "PRODUCTION /admin/pages — three landing pages, none live",
    "Same story on the landing-page board. A landing page has no detail screen; everything happens on its card and in the builder.",
    [],
  )

  await open(page, "/admin/pipeline")
  await shoot(
    page,
    "P5-prod-pipeline",
    "PRODUCTION /admin/pipeline — one board, three cards",
    "Production has THREE pipelines (coaching, camps_clinics, assessment) but the screen can only show Coaching. A camp payment routed to camps_clinics would be invisible here.",
    [],
  )

  await open(page, "/admin/sms")
  await shoot(
    page,
    "P6-prod-texts",
    "PRODUCTION /admin/sms — shipped 2026-09-13, empty",
    "The sms_messages table exists on production with zero rows. Outbound cannot be tested from here (Twilio 21612, no route to PH); inbound was verified on the dev clone with a signed webhook.",
    [],
  )
} finally {
  await browser.close()
}
