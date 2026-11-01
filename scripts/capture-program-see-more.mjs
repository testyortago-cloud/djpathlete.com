// Real-app capture: a long program description is clamped behind "See more" on the admin program page and on
// the client's program page. Writes NOTHING (opens pages, clicks the toggle). DEV CLONE ONLY.
// Run (dev server on 3051): node scripts/capture-program-see-more.mjs
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
const OUT = "screenshots/program-description-see-more"
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const ADMIN_PROGRAM = "e261622a-89f7-412a-9ed7-593271aab95c" // Imogen Clarke's program, 2,314 characters
const CLIENT_PROGRAM = "f9bd9186-6e76-4088-99c2-7a9a582dd620" // assigned to Felix Boateng, 963 characters
const CLIENT_EMAIL = "felix.boateng@djpathlete.demo"
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
const sessionFor = async (email) => {
  const { data: u } = await db
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", email)
    .single()
  if (!u) throw Error(`no user ${email} on the clone`)
  return encode({
    secret: env.NEXTAUTH_SECRET,
    salt: "authjs.session-token",
    token: { id: u.id, sub: u.id, email: u.email, name: `${u.first_name} ${u.last_name}`, role: u.role },
    maxAge: 60 * 60,
  })
}
const open = async (browser, email, path) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
  await ctx.addCookies([
    { name: "authjs.session-token", value: await sessionFor(email), url: APP, httpOnly: true, sameSite: "Lax" },
    { name: "djp_business", value: PRIMARY, url: APP },
  ])
  const page = await ctx.newPage()
  await page.goto(`${APP}${path}`, { waitUntil: "load", timeout: 180000 })
  await page
    .addStyleTag({ content: "nextjs-portal{display:none!important}" })
    .catch((e) => console.warn(`WARN dev overlay may show: ${e.message}`))
  return page
}
const clampedHeight = (loc) => loc.evaluate((el) => el.getBoundingClientRect().height)

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  // 1) Admin program page, collapsed then expanded.
  const { data: ap } = await db.from("programs").select("description").eq("id", ADMIN_PROGRAM).single()
  const page = await open(browser, env.DEV_AUTH_BYPASS_EMAIL, `/admin/programs/${ADMIN_PROGRAM}`)
  const seeMore = page.getByRole("button", { name: "See more" })
  await seeMore.waitFor({ timeout: 120000 })
  await page.waitForTimeout(1500) // hydration: a click before it does nothing
  const text = page.getByText(ap.description.slice(0, 60))
  const collapsed = await clampedHeight(text)
  check("admin description is clamped to about three lines", collapsed < 80, `${Math.round(collapsed)}px`)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${OUT}/raw/01-admin-collapsed.png` })
  await annotate(`${OUT}/raw/01-admin-collapsed.png`, `${OUT}/01-admin-collapsed.png`, {
    title: 'A long program description now shows three lines and "See more"',
    subtitle: `Admin > Programs > Imogen Clarke's program (dev clone; ${ap.description.length}-character AI description)`,
    markers: [
      await marker(text, "First three lines of the description.", "before"),
      await marker(seeMore, "Click to read the rest.", "after"),
    ],
  })
  await seeMore.click()
  const seeLess = page.getByRole("button", { name: "See less" })
  await seeLess.waitFor()
  const expanded = await clampedHeight(text)
  check("See more shows the whole description", expanded > collapsed * 3, `${Math.round(expanded)}px`)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${OUT}/raw/02-admin-expanded.png` })
  await annotate(`${OUT}/raw/02-admin-expanded.png`, `${OUT}/02-admin-expanded.png`, {
    title: '"See more" opens the whole description in place',
    subtitle: 'Same page after clicking "See more"',
    markers: [await marker(seeLess, '"See less" folds it back.', "after")],
  })
  await page.context().close()

  // 2) The client's own program page.
  const { data: cp } = await db.from("programs").select("description").eq("id", CLIENT_PROGRAM).single()
  const cpage = await open(browser, CLIENT_EMAIL, `/client/programs/${CLIENT_PROGRAM}`)
  const cMore = cpage.getByRole("button", { name: "See more" })
  await cMore.waitFor({ timeout: 120000 })
  const ctext = cpage.getByText(cp.description.slice(0, 60))
  check(
    "client description is clamped",
    (await clampedHeight(ctext)) < 140,
    `${Math.round(await clampedHeight(ctext))}px`,
  )
  await cpage.mouse.move(5, 5)
  await cpage.screenshot({ path: `${OUT}/raw/03-client-collapsed.png` })
  await annotate(`${OUT}/raw/03-client-collapsed.png`, `${OUT}/03-client-collapsed.png`, {
    title: 'Clients see the same: four lines and "See more"',
    subtitle: `Client > Programs > program page, signed in as Felix Boateng (dev clone; ${cp.description.length} characters)`,
    markers: [await marker(cMore, "Click to read the rest.", "after")],
  })
} finally {
  await browser.close()
}
