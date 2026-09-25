// G33: the sender phone number on a business's settings page, captured on the
// real route in the real running app.
//
//   npx next dev --port 3063 > <scratchpad>/dev.log 2>&1 &
//   APP=http://localhost:3063 node scripts/capture-g33-sms-sender-phone-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN AT /admin/businesses/<Primary>, signed in as the
// dev-clone operator via /api/dev/login. No harness, no isolated mount.
//
// WRITES NOTHING. All three states are refusals the form makes BEFORE it sends
// anything, and the script listens for the PATCH and throws if one goes out, so
// a shot cannot quietly be of a save that happened. The one state it cannot
// reach without writing is the 409 for a number another business already sends
// from: that needs two businesses on the shared dev clone to claim one number,
// so it is covered by the route and DAL tests instead, and said so here.
//
// LIGHT ONLY. The admin surface has no working dark mode (a `.dark` class
// variant the admin components were never built against), so there is no dark
// shot to take.
//
// WHY THE WINDOW IS SHORT (1440 x 500). The field directly above this one,
// "Messaging service ID", holds the dev clone's placeholder SID ("MGdev000..."),
// which is a fixture and does not belong on camera. This field sits near the
// bottom of a long form, so at a normal height the page is already scrolled as
// far as it goes and that row stays in view. A shorter window lets the field sit
// just under the header with the SID scrolled away behind it. The Next.js dev
// badge is hidden too; the "Messages" button is the app's own and stays.
//
// DEV CLONE ONLY. It refuses any other project ref outright.

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/g33-sms-sender-phone"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels
const PRIMARY = "00000000-0000-0000-0000-000000000001"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_REF)) {
  console.error(`REFUSING TO RUN: .env.local does not point at the dev clone (${DEV_REF}).`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

/** A marker anchored to a real element. Warns loudly on every failure path. */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx = box.x - 22
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  }
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

/** A marker just past the text inside an input (its value, or its placeholder). */
async function markerAfterInputText(page, locator, caption) {
  if ((await locator.count()) !== 1) {
    console.warn(`  !! INPUT MARKER TARGET MATCHED ${await locator.count()} ELEMENTS: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const box = await locator.boundingBox()
  const textRight = await locator.evaluate((el) => {
    const ctx2d = document.createElement("canvas").getContext("2d")
    const cs = getComputedStyle(el)
    ctx2d.font = cs.font
    return ctx2d.measureText(el.value || el.placeholder).width + parseFloat(cs.paddingLeft)
  })
  return { x: Math.round((box.x + textRight + 30) * DSF), y: Math.round((box.y + box.height / 2) * DSF), caption }
}

// A VIEWPORT shot, not fullPage: boundingBox() is viewport-relative, so the two
// coordinate spaces agree without any scroll bookkeeping.
async function shot(page, slug, title, subtitle, markersFn) {
  await page.mouse.move(4, 4)
  await page.waitForTimeout(300)
  const markers = await markersFn()
  const raw = `${OUT}/.raw-${slug}.png`
  await page.screenshot({ path: raw })
  await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers })
  console.log(`   wrote ${OUT}/${slug}.png`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 500 }, deviceScaleFactor: DSF })
const page = await ctx.newPage()

let patches = 0
page.on("request", (req) => {
  if (req.method() === "PATCH" && req.url().includes("/api/admin/businesses/")) patches++
})

try {
  console.log("signing in")
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForURL(/\/admin\//, { timeout: 60_000 })
  const session = await (await page.request.get(`${APP}/api/auth/session`)).json()
  if (session?.user?.role !== "admin") throw new Error(`no admin session: ${JSON.stringify(session)}`)
  console.log(`   signed in as ${session.user.email}`)

  await ctx.addCookies([{ name: "djp_business", value: PRIMARY, domain: "localhost", path: "/", sameSite: "Lax" }])
  await page.goto(`${APP}/admin/businesses/${PRIMARY}`, { waitUntil: "networkidle", timeout: 120_000 })
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important } nextjs-portal { display: none !important }" })
  // The Save button renders enabled before React attaches its handler.
  await page.waitForTimeout(4000)

  const heading = (await page.locator("h1").first().textContent())?.trim()
  console.log(`   showing business: ${heading}`)

  const field = page.getByLabel("Sender phone number")
  if ((await field.count()) !== 1) throw new Error("expected exactly one 'Sender phone number' field")
  const stored = await field.inputValue()
  if (stored !== "") throw new Error(`expected Primary's sender number to be empty on the dev clone, found ${JSON.stringify(stored)}`)

  // The field's LABEL goes 80 CSS px from the top, just under the 63 px header,
  // which puts the Messaging service ID row (and its dev SID) behind it. Checked
  // after every framing rather than trusted: the SID must be off screen.
  const label = page.getByText("Sender phone number", { exact: true })
  const sidField = page.getByLabel("Messaging service ID")
  async function frameTheField() {
    // The admin layout scrolls an inner container, not the window, so move
    // whichever ancestor actually scrolls.
    const moved = await label.evaluate((el) => {
      let box = el.parentElement
      while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) {
        box = box.parentElement
      }
      const scroller = box ?? document.scrollingElement
      const delta = el.getBoundingClientRect().top - 80
      scroller.scrollBy({ top: delta, behavior: "instant" })
      return { scroller: scroller.tagName + (scroller.className ? "." + String(scroller.className).split(" ")[0] : ""), delta }
    })
    console.log(`   scrolled ${moved.scroller} by ${Math.round(moved.delta)}px`)
    await page.waitForTimeout(200)
    const sid = await sidField.boundingBox()
    const labelBox = await label.boundingBox()
    if (!sid || sid.y + sid.height > 63) throw new Error(`the dev SID is still in view (bottom at ${sid && sid.y + sid.height}px)`)
    console.log(`   framed: label at ${Math.round(labelBox.y)}px, SID bottom at ${Math.round(sid.y + sid.height)}px`)
  }
  async function saveAndWaitForRefusal() {
    await page.getByRole("button", { name: /save/i }).last().click()
    await page.waitForTimeout(800)
    await frameTheField()
  }

  // ---- 01: the empty field -------------------------------------------------
  console.log("\n01 the empty field")
  await frameTheField()
  const hint = page.locator("#sms-sender-phone-hint")
  await shot(
    page,
    "01-empty-field",
    "The sender phone number now shows its shape",
    `The "Text messages" section of the settings page for "${heading}". Nothing is typed yet, and nothing is saved by this screenshot.`,
    async () => [
      await markerAfterInputText(page, field, 'The grey example inside the box shows the shape: a "+", then the country code, then the number.'),
      await markerOn(page, hint, "The line under the box says the same thing in words. It also says the number is saved without spaces, so nobody is surprised when it comes back as +12025550123.", { place: "left" }),
    ],
  )

  // ---- 02: a number with no country code -----------------------------------
  console.log("\n02 a number with no country code")
  await field.fill("(202) 555-0123")
  await saveAndWaitForRefusal()
  const countryCode = page.getByText(/Start with \+ and the country code/)
  if ((await countryCode.count()) === 0) throw new Error("the country-code message did not appear")
  await shot(
    page,
    "02-no-country-code",
    "A number with no country code is not saved",
    'Typed "(202) 555-0123" and pressed "Save settings". Nothing was sent. The page says what to type instead.',
    async () => [
      await markerAfterInputText(page, field, "The number as a coach might type it. Saved like this, a text that comes in to this number would not be matched to this business."),
      await markerOn(page, countryCode, 'The message beside the box says what to do: start with "+" and the country code, the way Twilio shows it.', { place: "left" }),
    ],
  )

  // ---- 03: something that is not a phone number ----------------------------
  console.log("\n03 not a phone number")
  await field.fill("+1 202 555 0123 ext. 5")
  await saveAndWaitForRefusal()
  const notANumber = page.getByText(/That is not a phone number/)
  if ((await notANumber.count()) === 0) throw new Error("the not-a-phone-number message did not appear")
  await shot(
    page,
    "03-not-a-phone-number",
    "Extra words are refused, not quietly dropped",
    'Typed "+1 202 555 0123 ext. 5" and pressed "Save settings". Nothing was sent.',
    async () => [
      await markerAfterInputText(page, field, 'A number that sends texts has no extension. The page says so, instead of quietly saving the number without the "ext. 5".'),
      await markerOn(page, notANumber, "The page asks for the number exactly as Twilio shows it.", { place: "left" }),
    ],
  )

  if (patches !== 0) throw new Error(`the form SENT ${patches} PATCH request(s); these shots must be of refusals only`)
  console.log(`\nPATCH requests sent: ${patches}. done`)
} finally {
  await browser.close()
}
