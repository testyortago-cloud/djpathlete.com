// Screenshots of the subscriber import check (the dialog's dry run against the
// existing list), on the real /admin/newsletter/subscribers page against the
// development clone. Seeds four example.com subscribers (two of them opted
// out), picks a CSV, and lets ONLY the dryRun POST through: the real import is
// never clicked and every other write is aborted. Removes the seed rows after.
// Run with the worktree's dev server on :3050: node scripts/capture-newsletter-import-check.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${DEV_REF}.supabase.co`) throw Error("Development clone only")

const DSF = 2
const W = 1440
const H = 900
const out = "screenshots/newsletter-import-check"
mkdirSync(`${out}/raw`, { recursive: true })
const checks = { pageErrors: [], blockedWrites: [], dryRuns: 0, screenshots: [], darkMode: "Admin is light-only" }
const SUBTITLE = "Real /admin/newsletter/subscribers page · development clone · nothing imported"

const SEED = [
  ["maria.alvarez@example.com", null],
  ["james.chen@example.com", null],
  ["old.list.reader@example.com", "2026-10-23T03:54:37.847Z"],
  ["moved.on@example.com", "2026-10-02T15:10:00.000Z"],
]

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
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  const markers = []
  // side "right" puts the marker after the text, for lines stacked too close to mark both on the left.
  for (const [locator, caption, side] of targets) {
    const box = await locator.boundingBox()
    if (!box || box.y < 0 || box.y + box.height > H) throw Error(`Missing or offscreen marker: ${caption}`)
    const x = side === "right" ? box.x + box.width + 22 : Math.max(20, box.x - 22)
    markers.push({ x: x * DSF, y: (box.y + box.height / 2) * DSF, caption })
  }
  await page.screenshot({ path: `${out}/raw/${name}.png` })
  await annotate(`${out}/raw/${name}.png`, `${out}/${name}.png`, { title, subtitle: SUBTITLE, markers })
  checks.screenshots.push(name)
}

async function pickCsv(page, name, lines) {
  const path = `${out}/raw/${name}.csv`
  writeFileSync(path, ["email", ...lines].join("\n"))
  await page.locator('input[type="file"]').setInputFiles(path)
  await page.getByRole("dialog").getByText(/already subscribed/).waitFor({ timeout: 20000 })
}

// The cleanup deletes the seed addresses, so refuse if any already existed.
const before = await sql(`select email from newsletter_subscribers where email in (${SEED.map(([e]) => `'${e}'`).join(",")})`)
if (before.length > 0) throw Error(`Seed address already on the dev list: ${before.map((r) => r.email)}`)

let browser
try {
  const values = SEED.map(([e, at]) => `('${e}', 'csv_import', ${at ? `'${at}'` : "null"})`).join(",")
  await sql(`insert into newsletter_subscribers (email, source, unsubscribed_at) values ${values}
             on conflict (email) do update set unsubscribed_at = excluded.unsubscribed_at`)

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, reducedMotion: "reduce" })
  const page = await context.newPage()
  page.on("pageerror", (e) => checks.pageErrors.push(e.message))
  await page.goto("http://localhost:3050/api/dev/login?callbackUrl=/admin/dashboard", { waitUntil: "networkidle" })
  await context.addCookies([
    { name: "djp_business", value: "00000000-0000-0000-0000-000000000001", url: "http://localhost:3050" },
  ])
  await context.route("**/*", (route) => {
    const req = route.request()
    if (["GET", "HEAD", "OPTIONS"].includes(req.method())) return route.continue()
    if (req.url().endsWith("/api/admin/newsletter/subscribers") && req.postDataJSON()?.dryRun === true) {
      checks.dryRuns++
      return route.continue()
    }
    const u = new URL(req.url())
    checks.blockedWrites.push(`${req.method()} ${u.origin}${u.pathname}`)
    return route.abort()
  })
  await page.goto("http://localhost:3050/admin/newsletter/subscribers", { waitUntil: "networkidle" })
  if (!page.url().endsWith("/admin/newsletter/subscribers")) throw Error(`Wrong route ${page.url()}`)
  // The dev clone's list is real people's addresses; show only the example.com seed rows.
  await page.getByPlaceholder("Search subscribers...").fill("example.com")

  const dialog = page.getByRole("dialog")
  await pickCsv(page, "01-mixed-list", [
    "maria.alvarez@example.com",
    "james.chen@example.com",
    "old.list.reader@example.com",
    "moved.on@example.com",
    "sam.okafor@example.com",
    "lena.fischer@example.com",
    "temp4471@mailinator.com",
    "call me back next week",
  ])
  await shot(page, "01-mixed-list", "Import check: the CSV is compared with your list before anything is added", [
    [dialog.getByText(/valid email\(s\) ready to import/), "Rows that look like real addresses"],
    [dialog.getByText(/^2 new, 2 already subscribed$/), "2 new people, 2 already on the list", "right"],
    [dialog.getByText(/unsubscribed or bounced before/), "2 opted out or bounced before: they stay off the list"],
    [dialog.getByRole("button", { name: /Import 2 New Email/ }), "Imports only the 2 new people"],
  ])

  await dialog.getByRole("button", { name: "Cancel" }).click()
  await pickCsv(page, "02-nothing-new", ["old.list.reader@example.com", "moved.on@example.com", "maria.alvarez@example.com"])
  await shot(page, "02-nothing-new", "Nothing new: an old list cannot bring opted-out people back", [
    [dialog.getByText(/^0 new, 1 already subscribed$/), "Nobody new in this file", "right"],
    [dialog.getByText(/unsubscribed or bounced before/), "Both opted-out people are held back"],
    [dialog.getByRole("button", { name: /Import 0 New Email/ }), "Import is switched off"],
  ])
  if (!(await dialog.getByRole("button", { name: /Import 0 New Email/ }).isDisabled())) throw Error("button not disabled")
} finally {
  await browser?.close()
  await sql(`delete from newsletter_subscribers where email in (${SEED.map(([e]) => `'${e}'`).join(",")})`)
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2))
  console.log(JSON.stringify(checks, null, 2))
}
