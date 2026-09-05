// Tenancy phase 4: the SAME page, two Hosts, two businesses named in the
// consent wording. Chromium refuses a Host override, so x-forwarded-host is
// set instead — the header lib/tenancy/public.ts reads FIRST.
//   node scripts/capture-tenancy-phase4-screenshots.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const OUT = "screenshots/tenancy-phase4"
const DSF = 2
const BASE = "http://localhost:3050"
const SHOTS = [
  { n: "01", host: "phase4-coach.test", scheme: "light", title: "Coach host — the consent line names the coach" },
  { n: "02", host: "www.darrenjpaul.com", scheme: "light", title: "Platform host — the same page names DJP Athlete" },
  { n: "03", host: "phase4-coach.test", scheme: "dark", title: "Coach host, dark" },
  { n: "04", host: "www.darrenjpaul.com", scheme: "dark", title: "Platform host, dark" },
]
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: DSF,
    colorScheme: s.scheme,
    extraHTTPHeaders: { "x-forwarded-host": s.host },
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/camps`, { waitUntil: "networkidle" })
  const consent = page.getByText(/agree to receive text messages from/i).first()
  if ((await consent.count()) === 0)
    throw new Error(
      `no consent line rendered for host ${s.host} — is display_name set for that business on the dev clone?`,
    )
  await consent.scrollIntoViewIfNeeded()
  // The inquiry section is wrapped in components/shared/FadeIn.tsx, which
  // animates opacity 0 -> 1 (framer-motion whileInView) once it scrolls into
  // view. scrollIntoViewIfNeeded() jumps there instantly, so without a wait
  // the element is in the DOM (boundingBox/text already correct) but the
  // screenshot lands mid-fade, near invisible. Wait out the animation
  // (duration 0.6s + up to 0.15s delay elsewhere on the page) before reading
  // the settled box or taking the shot.
  await page.waitForTimeout(1200)
  const box = await consent.boundingBox()
  if (!box) throw new Error(`consent line has no box for host ${s.host}`)
  const raw = `${OUT}/${s.n}-raw.png`
  await page.screenshot({ path: raw, fullPage: false })
  const label = s.host === "phase4-coach.test" ? "coach" : "platform"
  await annotate(raw, `${OUT}/${s.n}-camps-${label}-host-${s.scheme}.png`, {
    title: s.title,
    subtitle: `x-forwarded-host: ${s.host} → resolved by business_domains, rendered by app/(marketing)/camps/page.tsx → components/public/InquiryForm.tsx`,
    markers: [
      {
        x: (box.x + 8) * DSF,
        y: (box.y + box.height / 2) * DSF,
        caption: `The consent wording names the business the Host resolved to: "${(await consent.textContent())?.trim().slice(0, 90)}"`,
      },
    ],
  })
  await ctx.close()
}
await browser.close()
