// Annotated screenshots of the newsletter retry status line on the REAL
// /admin/newsletter page, against `next dev` on :3050 and the development clone.
//
// State is dev-clone data only. Clicking Send in dev would queue a job the
// PRODUCTION Firebase function picks up (Firestore is shared), so the Oct 9
// newsletter row is mirrored from production by SQL and its queue was written
// by `scripts/enqueue-newsletter-retry.ts --apply` on the clone. The later
// states (part-way, paused) are set by SQL, because reaching them for real
// means sending email. Every non-GET request from the page is aborted.
//
//   node scripts/capture-newsletter-retry.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${DEV_REF}.supabase.co`) throw Error("Development clone only")

const NL = "d8fc510b-dd44-4e3f-9bef-6b1e99002ef2"
const DSF = 2
const W = 1440
const H = 900
const out = "screenshots/newsletter-retry"
mkdirSync(`${out}/raw`, { recursive: true })
const checks = { pageErrors: [], screenshots: [], darkMode: "Admin is light-only" }
const SUBTITLE = "Real /admin/newsletter page · development clone · nothing sent"

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw Error(`sql ${res.status}: ${await res.text()}`)
  return res.json()
}

async function shot(page, name, title, targets) {
  await page.reload({ waitUntil: "networkidle" })
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(600)
  const markers = []
  for (const [locator, caption] of targets) {
    const box = await locator.boundingBox()
    if (!box || box.y < 0 || box.y + box.height > H) throw Error(`Missing or offscreen marker: ${caption}`)
    // Beside the target's LEFT edge: every target here has a neighbour column on its right.
    markers.push({ x: Math.max(20, box.x - 22) * DSF, y: (box.y + box.height / 2) * DSF, caption })
  }
  await page.screenshot({ path: `${out}/raw/${name}.png` })
  await annotate(`${out}/raw/${name}.png`, `${out}/${name}.png`, { title, subtitle: SUBTITLE, markers })
  checks.screenshots.push(name)
}

let browser
try {
  // Start state: everything waiting, counts as the send function left them.
  await sql(`update newsletter_deliveries set status='pending', sent_at=null, provider_message_id=null, bounced_at=null, attempts=0, last_error=null where newsletter_id='${NL}';
             update newsletters set sent_count=1100, failed_count=(select count(*) from newsletter_deliveries where newsletter_id='${NL}') where id='${NL}';`)

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, reducedMotion: "reduce" })
  const page = await context.newPage()
  page.on("pageerror", (e) => checks.pageErrors.push(e.message))
  await page.goto("http://localhost:3050/api/dev/login?callbackUrl=/admin/dashboard", { waitUntil: "networkidle" })
  // The queue is the platform business's. With no cookie the dev clone selects a
  // seeded "Northcrest Barbell" business, and the status line (rightly) shows nothing.
  await context.addCookies([
    { name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: "http://localhost:3050" },
  ])
  await context.route("**/*", (route) =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort(),
  )
  await page.goto("http://localhost:3050/admin/newsletter", { waitUntil: "networkidle" })
  if (!page.url().endsWith("/admin/newsletter")) throw Error(`Wrong route ${page.url()}`)

  const row = () => page.locator("tr").filter({ hasText: "Awareness before Action" }).first()
  const line = (re) => row().getByText(re)

  await shot(page, "01-waiting", "The people a send missed are queued, and the page says so", [
    [line(/^Resending to people who missed it/), "Under the newsletter: how many are still to get it, and when it sends."],
    [row().getByText(/delivered/), "The counts from the original send. They move as the resend goes out."],
  ])

  // Part-way: 1,200 resent two hours ago, counts moved the way the resend moves them.
  await sql(`update newsletter_deliveries set status='sent', sent_at=now() - interval '2 hours', attempts=1
             where id in (select id from newsletter_deliveries where newsletter_id='${NL}' order by created_at, id limit 1200);
             update newsletters set sent_count=1100+1200, failed_count=failed_count-1200 where id='${NL}';`)
  await shot(page, "02-part-way", "Part-way through: 100 an hour, weekdays 9am to 5pm", [
    [line(/1,200 done/), "Progress so far, and what is left."],
    [row().getByText(/2300 delivered/), "Each resent batch adds to delivered and takes off failed."],
  ])

  // The bounce brake: 70 of the 1,200 bounced (5.8%, over the 4% limit), so the rest pause.
  await sql(`update newsletter_deliveries set bounced_at=now() - interval '90 minutes'
             where id in (select id from newsletter_deliveries where newsletter_id='${NL}' and status='sent' order by id limit 70);
             update newsletter_deliveries set status='paused', last_error='paused: 70 of 1200 retried emails bounced (5.8%, limit 4%)'
             where newsletter_id='${NL}' and status='pending';`)
  await shot(page, "03-paused-by-bounces", "Too many bounced, so the resend stopped itself", [
    [line(/^Resending paused/), "Shown in red: how many bounced, and how many people are still waiting."],
  ])

  checks.ok = checks.pageErrors.length === 0
} finally {
  await browser?.close()
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2))
  console.log(JSON.stringify(checks))
}
