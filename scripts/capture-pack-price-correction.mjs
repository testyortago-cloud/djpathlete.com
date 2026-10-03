import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const clientId = "f7942da3-5593-40e3-88da-fc5c213d6bae"
const out = "screenshots/pack-price-correction"
mkdirSync(`${out}/raw`, { recursive: true })
const temporary = []
let browser
const checks = {
  pageErrors: [],
  realRoute: `/admin/clients/${clientId}`,
  screenshots: [],
  darkMode: "Admin has no dark-mode provider or switch",
  stripeCalls: 0,
}
try {
  // Create temporary packs only in the clone; never overwrite the client's
  // existing balance or ledger. No Stripe checkout is created in this capture.
  for (const method of ["stripe", "cash"]) {
    const { data, error } = await db
      .from("client_packages")
      .insert({
        client_user_id: clientId,
        session_type: method === "stripe" ? "Performance training" : "Personal training",
        credits_total: 10,
        credits_used: 8,
        price_cents: 150000,
        payment_status: "pending",
        payment_method: method,
        status: "active",
        purchased_at: "2026-09-16T12:00:00Z",
        auto_renew: false,
      })
      .select("id")
      .single()
    if (error) throw error
    temporary.push(data.id)
    const dates = [
      "2026-10-01",
      "2026-09-30",
      "2026-09-29",
      "2026-09-25",
      "2026-09-24",
      "2026-09-22",
      "2026-09-18",
      "2026-09-17",
    ]
    const { error: checkinError } = await db.from("session_checkins").insert(
      dates.map((date) => ({
        client_package_id: data.id,
        client_user_id: clientId,
        session_date: date,
        checked_in_at: `${date}T12:00:00Z`,
        method: "qr_self",
        credit_delta: -1,
      })),
    )
    if (checkinError) throw checkinError
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  page.on("pageerror", (error) => checks.pageErrors.push(error.message))
  await page.goto("http://localhost:3050/api/dev/login?callbackUrl=/admin/dashboard", { waitUntil: "networkidle" })
  await context.route("**/*", (route) => {
    const request = route.request()
    const isAllowedSave =
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === `/api/admin/session-packs/${temporary[1]}/price`
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()) || isAllowedSave) return route.continue()
    return route.abort()
  })
  await page.goto(`http://localhost:3050/admin/clients/${clientId}`, { waitUntil: "networkidle" })
  if (!page.url().endsWith(`/admin/clients/${clientId}`)) throw Error(`Wrong route ${page.url()}`)
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  const pack = page
    .locator("div.rounded-lg.border")
    .filter({ has: page.getByText("Performance training", { exact: false }) })
    .filter({ has: page.getByRole("button", { name: "Change price", exact: true }) })
    .first()
  await page.getByRole("heading", { name: "Session Packs", exact: true }).scrollIntoViewIfNeeded()
  await pack.waitFor({ state: "visible" })
  await pack.evaluate((element) => {
    let parent = element.parentElement
    while (parent && parent !== document.body) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
        parent.scrollTop += element.getBoundingClientRect().top - 140
        return
      }
      parent = parent.parentElement
    }
    window.scrollBy(0, element.getBoundingClientRect().top - 140)
  })
  const screenshot = async (name, title, targets) => {
    await page.waitForTimeout(500)
    const markers = []
    for (const [locator, caption] of targets) {
      const box = await locator.boundingBox()
      if (!box || box.y < 0 || box.y + box.height > 1100) throw Error(`Missing or offscreen marker ${caption}`)
      markers.push({ x: Math.min(1410, box.x + box.width + 20), y: box.y + box.height / 2, caption })
    }
    await page.screenshot({ path: `${out}/raw/${name}.png` })
    await annotate(`${out}/raw/${name}.png`, `${out}/${name}.png`, {
      title,
      subtitle: "Real client page · temporary data in development clone · no Stripe actions",
      markers,
    })
    checks.screenshots.push(name)
  }
  const undoCount = await pack.getByRole("button", { name: "Undo", exact: true }).count()
  if (undoCount !== 8) throw Error(`Only ${undoCount} check-ins shown`)
  checks.visibleCheckins = undoCount
  await screenshot("01-all-eight-checkins", "All eight attended sessions are visible", [
    [pack.getByText("sessions left", { exact: true }), "Two sessions remain from the ten-session pack."],
    [pack.getByText(/Sep 17, 2026/), "The seventh and eighth dates are no longer hidden."],
    [
      pack.getByRole("button", { name: "Change price", exact: true }),
      "Correct an unpaid pack without losing its sessions.",
    ],
  ])
  await pack.getByRole("button", { name: "Change price", exact: true }).click()
  await page.getByLabel("New pack total (USD)").fill("750.00")
  await screenshot("02-correct-unpaid-total", "Correct the whole pack total before payment", [
    [page.getByLabel("New pack total (USD)"), "Enter the corrected total for all ten sessions."],
    [
      page.getByRole("button", { name: "Save price and replace link" }),
      "Saving retires the old link and creates one for the new amount.",
    ],
  ])
  await page.getByLabel("New pack total (USD)").fill("12.345")
  await page.getByRole("button", { name: "Save price and replace link" }).click()
  await page.getByRole("alert").filter({ hasText: "Enter a valid total" }).waitFor()
  await screenshot("03-invalid-price", "Invalid amounts stay visible for correction", [
    [
      page.getByRole("alert").filter({ hasText: "Enter a valid total" }),
      "Use at most two decimal places. Nothing was saved.",
    ],
  ])
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  const cashPack = page
    .locator("div.rounded-lg.border")
    .filter({ has: page.locator(`#auto-renew-${temporary[1]}`) })
    .first()
  await cashPack.getByRole("button", { name: "Change price", exact: true }).click()
  await page.getByLabel("New pack total (USD)").fill("750.25")
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/session-packs/${temporary[1]}/price`) && response.request().method() === "PATCH",
  )
  await page.getByRole("button", { name: "Save price", exact: true }).click()
  const response = await responsePromise
  if (response.status() !== 200) throw Error(`Offline save failed: ${await response.text()}`)
  await page.getByRole("heading", { name: "Pack price updated" }).waitFor()
  await cashPack.getByText("Pack total: $750.25 USD", { exact: true }).waitFor()
  await screenshot("04-price-saved", "The corrected total is saved with the sessions kept", [
    [
      page.getByText("New total: $750.25 USD", { exact: true }),
      "The unpaid offline pack now owes the corrected amount.",
    ],
    [
      page.getByText("The sessions and check-in history have been kept.", { exact: true }),
      "The eight attended sessions and two remaining sessions are kept.",
    ],
  ])
  const { data: after, error: afterError } = await db
    .from("client_packages")
    .select("price_cents,credits_total,credits_used")
    .eq("id", temporary[1])
    .single()
  if (afterError) throw afterError
  if (after.price_cents !== 75025 || after.credits_total !== 10 || after.credits_used !== 8)
    throw Error(`Unexpected saved balance ${JSON.stringify(after)}`)
  checks.savedOffline = after
  if (checks.pageErrors.length) throw Error(`Browser errors: ${checks.pageErrors.join("; ")}`)
} finally {
  if (browser) await browser.close()
  for (const id of temporary) {
    const { error } = await db.from("client_packages").delete().eq("id", id)
    if (error) throw error
  }
  checks.temporaryPacksRemoved = temporary.length
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2))
}
writeFileSync(
  `${out}/index.html`,
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Session pack correction review</title><style>body{margin:30px auto;max-width:1440px;font:16px system-ui;color:#173943;background:#f5f7f8}img{width:100%;height:auto;border:1px solid #ddd;margin-bottom:32px}p{line-height:1.6}</style><h1>Session packs: full history and price correction</h1><p>Actual /admin/clients/${clientId} page, with temporary development-clone data. All temporary packs were removed. Admin supports light presentation only. The offline save was exercised end to end; Stripe replacement safeguards were verified in automated tests, without creating real payment links.</p>${checks.screenshots.map((name) => `<img src="${name}.png" alt="${name}">`).join("")}</html>`,
)
console.log(JSON.stringify(checks))
