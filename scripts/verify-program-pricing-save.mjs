// Real-app check for the 2026-11-01 report: "Failed to save pricing" (Pricing & Access) and
// "Price is required for paid programs" (Edit Program) on an AI program whose description is over 2,000
// characters. Opens Imogen Clarke's dev program (2,314 characters, Free, no Stripe price), saves it from
// BOTH dialogs with the values it already has, and asserts each PATCH answers 200.
//
// Writes the same values back (plus an audit row). DEV CLONE ONLY.
// Run (dev server on 3051): node scripts/verify-program-pricing-save.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { encode } from "next-auth/jwt"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APP = process.env.APP_URL ?? "http://localhost:3051"
const OUT = "screenshots/program-pricing-save-fix"
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const PROGRAM = "e261622a-89f7-412a-9ed7-593271aab95c" // Imogen Clarke's 2-Week Sport Specific Program
mkdirSync(`${OUT}/raw`, { recursive: true })

const check = (name, ok, evidence = "") => {
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

const { data: before } = await db
  .from("programs")
  .select("description, payment_type, price_cents")
  .eq("id", PROGRAM)
  .single()
check(
  "the program reproduces the report's shape",
  before.description.length > 2000 && before.payment_type === "free",
  `${before.description.length} chars, ${before.payment_type}`,
)

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  const { data: admin } = await db
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", env.DEV_AUTH_BYPASS_EMAIL)
    .single()
  if (admin?.role !== "admin")
    throw Error(`DEV_AUTH_BYPASS_EMAIL is not an admin on the clone: ${env.DEV_AUTH_BYPASS_EMAIL}`)
  const token = await encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: {
      id: admin.id,
      sub: admin.id,
      email: admin.email,
      name: `${admin.first_name} ${admin.last_name}`,
      role: admin.role,
    },
    maxAge: 60 * 60,
  })
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, url: APP, httpOnly: true, sameSite: "Lax" },
    { name: "djp_business", value: PRIMARY, url: APP },
  ])
  await page.goto(`${APP}/admin/programs/${PROGRAM}`, { waitUntil: "load", timeout: 180000 })
  await page
    .addStyleTag({ content: "nextjs-portal{display:none!important}" })
    .catch((e) => console.warn(`WARN dev overlay may show: ${e.message}`))
  const isPatch = (r) => r.url().endsWith(`/api/admin/programs/${PROGRAM}`) && r.request().method() === "PATCH"

  // 1) Pricing & Access, Free + Private, exactly as in the video.
  const pricingBtn = page.getByRole("button", { name: "Pricing & access" }).first()
  await pricingBtn.waitFor({ timeout: 120000 })
  await page.waitForTimeout(1500) // hydration: a click before it does nothing
  await pricingBtn.click()
  const sheet = page.getByRole("dialog")
  await sheet.getByRole("button", { name: "Save pricing & access" }).waitFor()
  const [r1] = await Promise.all([
    page.waitForResponse(isPatch, { timeout: 60000 }),
    sheet.getByRole("button", { name: "Save pricing & access" }).click(),
  ])
  check("Pricing & Access save answers 200", r1.status() === 200, `status ${r1.status()}`)
  const toast1 = page.getByText("Pricing & access saved")
  await toast1.waitFor({ timeout: 15000 })
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${OUT}/raw/01-pricing-saved.png` })
  await annotate(`${OUT}/raw/01-pricing-saved.png`, `${OUT}/01-pricing-saved.png`, {
    title: "Pricing & Access now saves on an AI program with a long description",
    subtitle: `Dev clone: Imogen Clarke's program, ${before.description.length}-character description, Free + Private (the video's settings)`,
    markers: [await marker(toast1, 'Saved. Before the fix this was "Failed to save pricing".', "above")],
  })
  await sheet.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})

  // 2) Edit Program: Info > Next > Schedule > Save Changes, as in the photo.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click()
  const dlg = page.getByRole("dialog")
  await dlg.getByRole("button", { name: "Next" }).click()
  await dlg.getByRole("button", { name: "Save Changes" }).waitFor()
  const [r2] = await Promise.all([
    page.waitForResponse(isPatch, { timeout: 60000 }),
    dlg.getByRole("button", { name: "Save Changes" }).click(),
  ])
  check("Edit Program save answers 200", r2.status() === 200, `status ${r2.status()}`)
  const toast2 = page.getByText("Program updated successfully")
  await toast2.waitFor({ timeout: 15000 })
  check("no 'Price is required' banner", (await page.getByText("Price is required for paid programs").count()) === 0)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${OUT}/raw/02-edit-saved.png` })
  await annotate(`${OUT}/raw/02-edit-saved.png`, `${OUT}/02-edit-saved.png`, {
    title: "Edit Program saves the same program",
    subtitle: 'Edit > Next > Save Changes. Before the fix: "Price is required for paid programs"',
    markers: [await marker(toast2, "Saved, no price error.", "above")],
  })

  const { data: after } = await db
    .from("programs")
    .select("description, payment_type, price_cents")
    .eq("id", PROGRAM)
    .single()
  check("description kept whole", after.description === before.description, `${after.description.length} chars`)
  check("still Free with no price", after.payment_type === "free" && after.price_cents === null)
} finally {
  await browser.close()
}
