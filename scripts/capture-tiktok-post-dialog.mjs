// Real-app capture: the "Post to TikTok" entry point in Content Studio.
//
// Writes NOTHING: it opens the video page and clicks the TikTok row's "Publish now", which in this state only
// performs a GET to /api/admin/social/posts/<id>/tiktok and shows the refused dialog (no TikTok account is
// connected on the dev clone). It never touches another row's buttons, the bulk-bar buttons or "Save caption",
// and asserts that no non-GET request reached /api/admin/social/posts/*. DEV CLONE ONLY.
//
// Run (production build on 3051): node scripts/capture-tiktok-post-dialog.mjs
import { mkdirSync, writeFileSync } from "node:fs"
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
const OUT = "screenshots/tiktok-post-dialog"
const PRIMARY = "00000000-0000-0000-0000-000000000001"
const VIDEO = "37378b65-bedc-40c5-b12b-619413494fb8" // "Knee injuries aren't ..."; has a TikTok draft
const W = 1440
const H = 1000
const DSF = 1 // device scale factor of the capture; marker coordinates are boundingBox x DSF
mkdirSync(`${OUT}/raw`, { recursive: true })

const results = []
const check = (name, ok, evidence = "") => {
  results.push({ name, ok, evidence })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name}`)
}
// A marker in RAW output pixels, from the element's box. Throws when the target is missing or off screen.
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  if (b.y < 0 || b.y + b.height > H || b.x < 0 || b.x + b.width > W)
    throw Error(`marker target is outside the viewport: ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x * DSF), y: Math.round(y * DSF), caption }
}
const hideDevChrome = (page) =>
  page
    .addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
    .catch((e) => console.warn(`WARN hideDevChrome failed, dev overlay may show: ${e.message.split("\n")[0]}`))
const settle = async (page) => {
  await page.mouse.move(5, 5)
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => console.warn("WARN network not idle"))
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 30000 })
  await page.waitForTimeout(400)
}

const { data: tiktok, error } = await db
  .from("social_posts")
  .select("id, platform, approval_status")
  .eq("source_video_id", VIDEO)
  .eq("platform", "tiktok")
if (error || tiktok?.length !== 1) throw Error(`expected exactly one TikTok post: ${error?.message ?? tiktok?.length}`)
const POST = tiktok[0].id

const browser = await chromium
  .launch({ channel: "chrome", headless: true })
  .catch(() => chromium.launch({ headless: true }))
try {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: DSF,
    reducedMotion: "reduce",
  })
  const page = await ctx.newPage()
  const pageErrors = []
  const postApi = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/admin/social/posts/")) postApi.push(`${r.method()} ${r.url()}`)
  })
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

  await page.goto(`${APP}/admin/content/${VIDEO}?tab=posts&postId=${POST}`, { waitUntil: "load", timeout: 120000 })
  await hideDevChrome(page)
  check("signed in to the admin", new URL(page.url()).pathname === `/admin/content/${VIDEO}`, page.url())

  const row = page.locator(`[data-post-id="${POST}"]`)
  await row.waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500) // hydration: an early click does nothing
  const note = page.getByText("TikTok posts are sent one at a time from their own row.").first()
  check("the bulk bar carries the TikTok note", await note.isVisible())
  const publish = row.getByRole("button", { name: "Publish now" })
  check("the TikTok row is expanded and shows Publish now", await publish.isVisible())
  check("and Schedule", await row.getByRole("button", { name: /^Schedule/ }).isVisible())

  // Frame: Posts heading at the top, so the bulk bar and the expanded TikTok row share the viewport.
  await page.locator("#posts-heading").evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -24))
  await settle(page)
  await page.screenshot({ path: `${OUT}/raw/01-posts-tab-tiktok-row.png` })
  await annotate(`${OUT}/raw/01-posts-tab-tiktok-row.png`, `${OUT}/01-posts-tab-tiktok-row.png`, {
    title: "TikTok posts now go through their own screen",
    subtitle: "Content Studio > video \"Knee injuries aren't ...\" > Posts (dev clone, light theme)",
    markers: [
      await marker(note, "TikTok posts are left out of bulk send.", "before"),
      await marker(publish, "Opens the Post to TikTok screen.", "after"),
    ],
  })

  // 2. Publish now on the TikTok row only: opens the dialog, which asks the server (GET) for the account.
  await publish.click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ timeout: 30000 })
  const msg = dialog.getByText("Connect TikTok on the Connections page first.")
  await msg.waitFor({ timeout: 30000 })
  check("the dialog is the Post to TikTok screen", await dialog.getByText("Post to TikTok").first().isVisible())
  check("it shows the refused message", await msg.isVisible())
  check("with only a Close button", (await dialog.getByRole("button").allTextContents()).join("|") === "Close")
  await settle(page)
  await page.screenshot({ path: `${OUT}/raw/02-dialog-connect-first.png` })
  await annotate(`${OUT}/raw/02-dialog-connect-first.png`, `${OUT}/02-dialog-connect-first.png`, {
    title: "No TikTok account connected: the screen stops and says so",
    subtitle: "Content Studio > Posts > TikTok row > Publish now (dev clone, light theme)",
    markers: [
      await marker(msg, "No TikTok account connected here, so the dialog stops before the form.", "after"),
    ],
  })

  const writes = postApi.filter((r) => !r.startsWith("GET "))
  check("no write request reached /api/admin/social/posts/*", writes.length === 0, `${postApi.join(" | ")}`)
  check("the only call was the account lookup", postApi.length >= 1 && postApi.every((r) => r.includes("/tiktok")))
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
} finally {
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ app: APP, results }, null, 2))
  await browser.close()
}
