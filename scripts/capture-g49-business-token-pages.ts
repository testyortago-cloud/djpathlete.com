// G49: the unsubscribe and "can we text you?" pages a coach's contact reaches
// from that coach's email, captured on their real routes in the running app.
//
//   npx next dev --port 3088 > <scratchpad>/g49-dev.log 2>&1 &
//   APP=http://localhost:3088 npx tsx scripts/capture-g49-business-token-pages.ts before   # on the old code
//   APP=http://localhost:3088 npx tsx scripts/capture-g49-business-token-pages.ts after    # on the new code
//
// THE SUBJECT IS A REAL LINK FOR A REAL CONTACT. Each run creates throwaway
// contacts under "Trailhead Strength & Conditioning" (82d5b238-…), a coach's
// business on the dev clone, and signs their links with the same functions the
// sequence emails use (lib/lead-engine/unsubscribe-token.ts, sms-consent-token.ts).
//
// WRITES, THEN REMOVES. Opening an unsubscribe link unsubscribes (that page
// writes on GET, by design), and "after" presses "I agree" once. Every contact
// is deleted in a finally block, with its suppression rows. In "after" mode
// Trailhead's brand colour is set through POST /api/admin/businesses/brand
// (the route the builder's theme panel uses) and put back to NULL afterwards,
// then read back, because that route cannot clear a colour.
//
// LIGHT ONLY: these public pages have no dark mode. DEV CLONE ONLY.

import { mkdirSync, readFileSync } from "node:fs"
import { chromium, type Page } from "playwright"
import { createClient } from "@supabase/supabase-js"
// The signers read NEXTAUTH_SECRET when they are CALLED, so importing them
// before .env.local is loaded below is safe.
import { signUnsubscribeToken } from "@/lib/lead-engine/unsubscribe-token"
import { signSmsConsentToken } from "@/lib/lead-engine/sms-consent-token"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3088"
const MODE = process.argv[2]
const OUT = "screenshots/g49-business-token-pages"
const DSF = 2
const GAP = 30
const TRAILHEAD = "82d5b238-1653-4a04-9d2d-2f65e5a8c225"
const TRAILHEAD_NAME = "Trailhead Strength & Conditioning — Personal Training"
const BRAND = "#2f5d3a"
const PLATFORM_WORDS = [/DJP\s*Athlete/i, /\bDarren\b/i]

if (MODE !== "before" && MODE !== "after") throw new Error("usage: capture-g49-business-token-pages.ts before|after")

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_REF)) {
  throw new Error(`REFUSING TO RUN: .env.local does not point at the dev clone (${DEV_REF}).`)
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Marker = { x: number; y: number; caption: string }

/** Just past where an element's TEXT ends (not its box, which may be full width). */
async function markerAfterText(page: Page, selector: string, caption: string, { dy = 0 } = {}): Promise<Marker> {
  const loc = page.locator(selector)
  if ((await loc.count()) !== 1) {
    console.warn(`  !! MARKER TARGET NOT FOUND EXACTLY ONCE (${selector}): "${caption.slice(0, 50)}…"`)
    return { x: 100, y: 100, caption }
  }
  const end = await loc.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const r = range.getBoundingClientRect()
    return { x: r.right, y: r.top + r.height / 2 }
  })
  return { x: Math.round((end.x + GAP) * DSF), y: Math.round((end.y + dy) * DSF), caption }
}

/** Left of an element's box, in the page's margin. */
async function markerBefore(page: Page, selector: string, caption: string): Promise<Marker> {
  const loc = page.locator(selector).first()
  const box = await loc.boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX (${selector}): "${caption.slice(0, 50)}…"`)
    return { x: 100, y: 100, caption }
  }
  return { x: Math.round((box.x - GAP) * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

/** Below an element's box, in the open space under it, at a given x. */
async function markerBelow(page: Page, selector: string, x: number, caption: string): Promise<Marker> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX (${selector}): "${caption.slice(0, 50)}…"`)
    return { x: 100, y: 100, caption }
  }
  return { x: Math.round(x * DSF), y: Math.round((box.y + box.height + GAP) * DSF), caption }
}

async function shot(page: Page, slug: string, title: string, subtitle: string, markers: () => Promise<Marker[]>) {
  // Next's dev-tools button is dev-only chrome, not part of the page.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" })
  await page.mouse.move(2, 2)
  await page.waitForTimeout(400)
  const measured = await markers()
  const raw = `${OUT}/.raw-${slug}.png`
  await page.screenshot({ path: raw, fullPage: false })
  const { width, height } = await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers: measured })
  console.log(`   wrote ${OUT}/${slug}.png (${width}x${height})`)
}

/**
 * The page's <head> (its title and every meta and link tag) and every word a
 * visitor can see: no platform name may appear in either. Script bodies are
 * left out because in dev they carry React's stack traces, whose file paths
 * include this repository's own folder name; that is dev-only and not served
 * by a production build.
 */
async function assertNoPlatformName(page: Page, label: string) {
  const { head, text } = await page.evaluate(() => {
    const h = document.head.cloneNode(true) as HTMLElement
    h.querySelectorAll("script").forEach((s) => s.remove())
    return { head: h.outerHTML, text: document.body.innerText }
  })
  for (const word of PLATFORM_WORDS) {
    must(!word.test(head), `${label}: the page's <head> contains ${word}`)
    must(!word.test(text), `${label}: the visible page contains ${word}`)
  }
  console.log(`   ${label}: no platform name in the <head> or on screen`)
}

async function makeContact(tag: string): Promise<{ id: string; email: string }> {
  const email = `tayawaschoolworks+g49${tag}${Date.now().toString(36)}@gmail.com`
  const { data, error } = await admin
    .from("contacts")
    .insert({ business_id: TRAILHEAD, email, name: "Jordan Lee" })
    .select("id")
    .single()
  must(!error && data, `creating a contact: ${error?.message}`)
  return { id: data.id as string, email }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const made: { id: string; email: string }[] = []
  const browser = await chromium.launch()
  let brandSet = false

  try {
    const consent = await makeContact("c")
    const unsub = await makeContact("u")
    made.push(consent, unsub)
    const consentUrl = `${APP}/sms-consent/${encodeURIComponent(signSmsConsentToken(consent.id, TRAILHEAD))}`
    const unsubUrl = `${APP}/unsubscribe/${encodeURIComponent(signUnsubscribeToken(unsub.id, TRAILHEAD))}`

    if (MODE === "after") {
      // Set Trailhead's brand colour the way a coach does, through the product's own route.
      const ctx = await browser.newContext()
      const p = await ctx.newPage()
      await p.goto(`${APP}/api/dev/login?callbackUrl=/api/auth/session`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
      await ctx.addCookies([
        { name: "djp_business", value: TRAILHEAD, domain: "localhost", path: "/", sameSite: "Lax" },
      ])
      const res = await p.request.post(`${APP}/api/admin/businesses/brand`, {
        data: { brand_color: BRAND, accent_color: null },
      })
      must(res.ok(), `setting the brand colour: ${res.status()} ${await res.text()}`)
      brandSet = true
      await ctx.close()
    }

    // A visitor, not a signed-in admin: a fresh context with no cookies.
    const visitor = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: DSF,
      colorScheme: "light",
    })
    const page = await visitor.newPage()

    if (MODE === "before") {
      console.log("\nbefore: the consent page")
      await page.goto(consentUrl, { waitUntil: "networkidle", timeout: 120_000 })
      await page.waitForTimeout(1500)
      must((await page.getByText("Can we text you?").count()) === 1, "the consent ask did not render")
      await shot(
        page,
        "00a-before-consent-page",
        "Before: a coach's contact lands on the platform's website",
        `This link was made for a contact of "${TRAILHEAD_NAME}". The page around the question is the platform's own site: its logo, its menu and its "Get Started" button.`,
        async () => [
          await markerBelow(
            page,
            "nav",
            60,
            "The platform's own logo and menu, on a page reached from another coach's email.",
          ),
        ],
      )

      console.log("\nbefore: the unsubscribe page")
      await page.goto(unsubUrl, { waitUntil: "networkidle", timeout: 120_000 })
      await page.waitForTimeout(1500)
      must((await page.getByText("Unsubscribed", { exact: true }).count()) === 1, "the unsubscribe page did not render")
      await shot(
        page,
        "00b-before-unsubscribe-page",
        "Before: unsubscribing from a coach's emails, on the platform's site",
        "The person clicked Unsubscribe in an email from the coach. The page that confirms it carries the platform's menu and name, not the coach's.",
        async () => [
          await markerBelow(
            page,
            "nav",
            60,
            "The platform's logo and menu again. Nothing here says which coach this was about.",
          ),
        ],
      )
    } else {
      console.log("\n01 the consent ask, in Trailhead's colours")
      await page.goto(consentUrl, { waitUntil: "networkidle", timeout: 120_000 })
      await page.waitForTimeout(1500)
      must((await page.getByText("Can we text you?").count()) === 1, "the consent ask did not render")
      must((await page.locator("nav").count()) === 0, "a navigation bar is still on the page")
      must(
        (await page.getByRole("banner").textContent())?.trim() === TRAILHEAD_NAME,
        "the header does not name Trailhead",
      )
      must((await page.title()) === "Can we text you?", `the tab title is "${await page.title()}"`)
      await assertNoPlatformName(page, "consent ask")
      await shot(
        page,
        "01-the-question-comes-from-the-coach",
        "Now the page belongs to the coach who sent the email",
        "Same link, same question. The page is headed with the coach's business in its brand colour, and the platform's menu is gone. For this picture the colour was set to green in the business's settings.",
        async () => [
          await markerAfterText(page, "header p", "The coach's business name, where the platform's menu used to be."),
          await markerBefore(page, "form button", "The button takes the coach's colour too."),
          // Past the end of the footer's FIRST line, which is wider than the "Sent by" line under it.
          await markerAfterText(page, "footer p:first-child", '"Sent by": the business, the same way its emails are signed.', { dy: 8 }),
        ],
      )

      console.log("\n02 after pressing I agree")
      await page.getByRole("button", { name: "I agree" }).click()
      await page.waitForURL(/done=1/, { timeout: 60_000 })
      await page.waitForTimeout(1200)
      must((await page.getByText("You are all set").count()) === 1, "the confirmation did not render")
      await shot(
        page,
        "02-the-answer-is-confirmed-in-the-same-place",
        "The answer is confirmed on the same page",
        'After "I agree", the confirmation stays inside the coach\'s page. Nothing on it points to the platform.',
        async () => [
          await markerAfterText(page, "h1", '"You are all set": the person has said yes to texts from this business.'),
        ],
      )

      console.log("\n03 the unsubscribe page")
      await page.goto(unsubUrl, { waitUntil: "networkidle", timeout: 120_000 })
      await page.waitForTimeout(1500)
      must((await page.getByText("Unsubscribed", { exact: true }).count()) === 1, "the unsubscribe page did not render")
      must((await page.title()) === "Unsubscribed", `the tab title is "${await page.title()}"`)
      await assertNoPlatformName(page, "unsubscribe")
      await shot(
        page,
        "03-unsubscribing-names-the-coach",
        "Unsubscribing now says whose emails stopped",
        "The same confirmation as before, inside the coach's own page.",
        async () => [
          await markerAfterText(page, "header p", "Whose emails these were. Before, nothing on this page said so."),
        ],
      )

      console.log("\n04 the unsubscribe page on a phone")
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        colorScheme: "light",
        isMobile: true,
      })
      const pp = await phone.newPage()
      await pp.goto(unsubUrl, { waitUntil: "networkidle", timeout: 120_000 })
      await pp.addStyleTag({ content: "nextjs-portal { display: none !important }" })
      await pp.waitForTimeout(1500)
      must(
        (await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) === true,
        "the phone page scrolls sideways",
      )
      const raw = `${OUT}/.raw-04-on-a-phone.png`
      await pp.screenshot({ path: raw })
      const { width, height } = await annotate(raw, `${OUT}/04-on-a-phone.png`, {
        title: "On a phone",
        subtitle:
          "Most people open these links from their phone's email app. The page fits the screen with no sideways scrolling.",
      })
      console.log(`   wrote ${OUT}/04-on-a-phone.png (${width}x${height})`)
      await phone.close()
    }
  } finally {
    if (brandSet) {
      const { error } = await admin
        .from("business_settings")
        .update({ brand_color: null, accent_color: null })
        .eq("business_id", TRAILHEAD)
      const { data } = await admin
        .from("business_settings")
        .select("brand_color, accent_color")
        .eq("business_id", TRAILHEAD)
        .single()
      console.log(`cleanup: Trailhead colours restored -> ${error ? `FAILED ${error.message}` : JSON.stringify(data)}`)
    }
    for (const c of made) {
      await admin.from("contact_suppressions").delete().eq("business_id", TRAILHEAD).eq("identifier", c.email)
      const { error } = await admin.from("contacts").delete().eq("id", c.id).eq("business_id", TRAILHEAD)
      console.log(`cleanup: contact ${c.id} -> ${error ? `FAILED ${error.message}` : "deleted"}`)
    }
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
