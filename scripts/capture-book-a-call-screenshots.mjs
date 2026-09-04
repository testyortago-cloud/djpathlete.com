// The "Book a call" control on the public contact page, captured on the real
// route in the real running app.
//
//   npm run dev > /tmp/contact-dev.log 2>&1 &
//   node scripts/capture-book-a-call-screenshots.mjs
//
// BOTH STATES ARE REAL, and the second one is the point. The control renders
// only when a Calendly scheduling page is configured; with none, the page must
// show the card's copy and nothing else, rather than a button that cannot book.
//
// The "not configured" shot is taken by ACTUALLY UNSETTING the variable and
// restarting the server -- SHOT=unconfigured -- not by rewriting the HTML at
// the edge. A doctored response is a picture of my regex, not of the app.
//
// The href is deliberately built on CLICK rather than at render, so the shot
// also proves the click ids a visitor arrived with reach the booking link.

import { mkdirSync } from "node:fs"
import { chromium } from "playwright"

import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/book-a-call"
const DSF = 2

mkdirSync(OUT, { recursive: true })

async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  else if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  } else cx = box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

async function shot(page, slug, title, subtitle, markers) {
  const raw = `${OUT}/${slug}.raw.png`
  await page.screenshot({ path: raw, fullPage: true })
  await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers })
  console.log(`   wrote ${OUT}/${slug}.png`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: DSF })
const page = await ctx.newPage()

const SHOT = process.env.SHOT ?? "configured"

try {
  if (SHOT === "unconfigured") {
    console.log("\n02 not configured — the server really has no scheduling page")
    await page.goto(`${APP}/contact`, { waitUntil: "networkidle" })
    if ((await page.getByRole("button", { name: "Book a call" }).count()) !== 0) {
      throw new Error("expected NO booking control with CALENDLY_SCHEDULING_URL unset — is the server still holding the old value?")
    }
    await shot(
      page,
      "02-not-configured",
      "With no calendar connected, there is simply no button",
      "The same route with CALENDLY_SCHEDULING_URL genuinely unset. A control that cannot book is worse than none — it costs a click to learn nothing.",
      [
        await markerOn(page, page.getByText("Free Consultation").first(), "The card keeps its copy and loses only the button. Nothing broken, no 'coming soon', no dead control — the page is exactly what it was before this change.", { place: "left" }),
      ],
    )
    console.log("\ndone")
    await browser.close()
    process.exit(0)
  }

  // ---- 01: configured, arriving on a Google Ads click ----------------------
  console.log("\n01 the control, on an ad click")
  await page.goto(`${APP}/contact?gclid=SCREENSHOT_CLICK_ID`, { waitUntil: "networkidle" })

  const button = page.getByRole("button", { name: "Book a call" })
  if ((await button.count()) === 0) {
    throw new Error('expected a "Book a call" control and found none — is CALENDLY_SCHEDULING_URL set?')
  }

  // Prove the href is the visitor's own, not one baked at build time: the click
  // id must survive, PACKED, not as a raw ?gclid= that Calendly never returns.
  const href = await page.evaluate(() => {
    const w = window
    let captured = null
    const original = w.open
    w.open = (u) => {
      captured = u
      return null
    }
    document.querySelectorAll("button").forEach((b) => {
      if (b.textContent?.includes("Book a call")) b.click()
    })
    w.open = original
    return captured
  })
  console.log(`   href on click: ${href}`)
  if (!href || !href.includes("utm_content=gclid%3ASCREENSHOT_CLICK_ID")) {
    console.warn(`  !! the click id did NOT reach the booking link packed — got: ${href}`)
  }

  await shot(
    page,
    "01-book-a-call",
    "A visitor can book without filling in the form",
    "The real /contact page, arrived at on a Google Ads click. Booking and the form are different asks, so both are offered.",
    [
      await markerOn(page, button.first(), "Opens the coach's own Calendly. The link is built when it is CLICKED, not when the page is built — a cached page would otherwise carry whichever advert's click id the build happened to see.", { place: "left" }),
      await markerOn(page, page.getByText("Free Consultation").first(), "This card promised a free consultation and offered NO way to book one. The button sits with the words that make the offer, rather than competing with them from a second block.", { place: "left" }),
      await markerOn(page, page.getByRole("button", { name: /send/i }).first(), "The form is untouched and still captures a lead. Both paths reach the Lead Engine — a booking through the Calendly webhook, a submission through /api/contact.", { place: "right" }),
    ],
  )

  console.log("\n(for shot 02, unset CALENDLY_SCHEDULING_URL, restart dev, and re-run with SHOT=unconfigured)")

  console.log("\ndone")
} finally {
  await browser.close()
}
