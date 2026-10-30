// Real-app capture: the Arena card, the test report's share link and the Trained & Elite
// standards on a client's Performance page, and the client page's "Performance" button.
//
// Writes NOTHING: it only opens pages. DEV CLONE ONLY (anjvztjiokcgiyhobknq) for the lookup.
//
// Run (dev server on 3051): node scripts/capture-performance-profile-bar.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/performance-profile-bar"
const W = 1440
const H = 900
mkdirSync(`${OUT}/raw`, { recursive: true })

const results = []
const check = (name, ok, evidence = "") => {
  results.push({ name, ok, evidence })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}

// An active client with logged tests, so the Performance page has real results on it.
const { data: tests } = await db.from("performance_tests").select("client_user_id").limit(200)
let client = null
for (const id of [...new Set((tests ?? []).map((t) => t.client_user_id))]) {
  const { data: u } = await db.from("users").select("id, first_name, last_name, role, status").eq("id", id).single()
  if (u?.role === "client" && u.status === "active") {
    client = u
    break
  }
}
if (!client) throw Error("no active client with tests on the clone")
const name = `${client.first_name} ${client.last_name}`

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const page = await (
    await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })
  ).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const hideChrome = () =>
    page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })

  // 1. Performance page.
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/clients/${client.id}/performance`, {
    waitUntil: "load",
    timeout: 120000,
  })
  const bar = page.getByText("Athlete profile", { exact: true })
  await bar.waitFor({ timeout: 90000 })
  await hideChrome()
  const arena = page.getByRole("link", { name: /Arena card/ })
  const share = page.getByRole("button", { name: /Share test report/ })
  const standards = page.getByRole("link", { name: /Trained & Elite standards/ })
  check(
    "Performance links to the Arena card",
    (await arena.getAttribute("href")) === `/admin/clients/${client.id}/arena`,
  )
  check("Performance has the test report's share link", await share.isVisible())
  check(
    "Performance links to the standards",
    (await standards.getAttribute("href")) === "/admin/settings/performance-standards",
  )
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/01-performance.png` })
  await annotate(`${OUT}/raw/01-performance.png`, `${OUT}/01-performance.png`, {
    title: "Arena card and test report, next to the results",
    subtitle: `Clients > ${name} > Performance`,
    markers: [
      await marker(arena, "Opens this client's Arena card.", "above"),
      await marker(share, "The link and QR code to send the client their test report.", "above"),
      await marker(standards, "The Trained and Elite numbers the results are judged by.", "above"),
    ],
  })

  // 2. The client page now points here.
  await page.goto(`${APP}/admin/clients/${client.id}`, { waitUntil: "load", timeout: 120000 })
  await hideChrome()
  const perf = page.getByRole("link", { name: "Performance", exact: true })
  await perf.waitFor({ timeout: 60000 })
  check(
    "the client page links to Performance",
    (await perf.getAttribute("href")) === `/admin/clients/${client.id}/performance`,
  )
  check(
    "the client page no longer has the Arena card button",
    (await page.getByRole("link", { name: /Arena card/ }).count()) === 0,
  )
  check("nor the share button", (await page.getByRole("button", { name: /Share test report/ }).count()) === 0)
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
  await perf.scrollIntoViewIfNeeded()
  await page.mouse.move(3, 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/raw/02-client-page.png` })
  await annotate(`${OUT}/raw/02-client-page.png`, `${OUT}/02-client-page.png`, {
    title: "The client page sends you to Performance",
    subtitle: `Clients > ${name}`,
    markers: [await marker(perf, "Performance: results, Arena card and the test report.", "above")],
  })

  writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Arena card on Performance</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#223b44}
h1{color:#0E3F50}figure{margin:32px 0}img{width:100%;border:1px solid #ddd;border-radius:8px}</style></head><body>
<h1>Arena card, test report and standards on Performance</h1>
<p>Real app, development clone, light mode. Nothing was changed; the pages were only opened.</p>
<figure><img src="01-performance.png" alt="Performance page"><figcaption><strong>01.</strong> The athlete profile bar on Performance.</figcaption></figure>
<figure><img src="02-client-page.png" alt="Client page"><figcaption><strong>02.</strong> The client page's Performance button.</figcaption></figure>
</body></html>\n`,
  )
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, results }, null, 2))
  await browser.close()
}
