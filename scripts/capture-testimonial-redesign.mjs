import { writeFileSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

// The real homepage, with temporary public-photo fixtures in the DEV CLONE.
// Only the named clone is allowed; every temporary row/photo is restored.
const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co") {
  throw new Error("Capture requires the development clone")
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const publicHtml = await (await fetch("https://www.darrenjpaul.com/")).text()
const publicFlight = [...publicHtml.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
  .map((match) => JSON.parse(match[1]))
  .join("")
const property = '"testimonials":'
const from = publicFlight.indexOf(`${property}[`) + property.length
if (from < property.length) throw new Error("Published testimonials not found")
let quoted = false,
  escaped = false,
  depth = 0,
  end = from
for (; end < publicFlight.length; end++) {
  const char = publicFlight[end]
  if (quoted) {
    if (escaped) escaped = false
    else if (char === "\\") escaped = true
    else if (char === '"') quoted = false
  } else {
    if (char === '"') quoted = true
    else if (char === "[") depth++
    else if (char === "]" && --depth === 0) {
      end++
      break
    }
  }
}
const published = JSON.parse(publicFlight.slice(from, end))
const out = "screenshots/testimonial-redesign"
mkdirSync(`${out}/raw`, { recursive: true })
const { data: mohamed, error: lookupError } = await db
  .from("testimonials")
  .select("id,avatar_url")
  .eq("name", "Mohamed Al Mashayiki")
  .single()
if (lookupError) throw lookupError
let temporaryId
let browser
const checks = []
try {
  const athlete = published.find((t) => t.name === "Lewis Cook")
  const { data: inserted, error: insertError } = await db
    .from("testimonials")
    .insert({
      name: athlete.name,
      role: athlete.title,
      quote: athlete.quote,
      avatar_url: athlete.avatarUrl,
      rating: athlete.rating,
      is_active: true,
      is_featured: true,
      display_order: -1,
    })
    .select("id")
    .single()
  if (insertError) throw insertError
  temporaryId = inserted.id
  const { error: updateError } = await db
    .from("testimonials")
    .update({ avatar_url: published.find((t) => t.name === "Mohamed Al Mashayiki").avatarUrl })
    .eq("id", mohamed.id)
  if (updateError) throw updateError
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  })
  // Block browser mutations (including analytics) during this read-only tour.
  await context.route("**/*", (route) =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort(),
  )
  let page = await context.newPage()
  page.on("pageerror", (error) => checks.push({ pageError: error.message }))
  await page.goto("http://localhost:3050/", { waitUntil: "networkidle" })
  await page.addStyleTag({ content: "nextjs-portal { display:none!important }" })
  const section = page.locator("#testimonials")
  await section.waitFor({ state: "visible" })
  await page.evaluate(() =>
    window.scrollTo(0, document.querySelector("#testimonials").getBoundingClientRect().top + window.scrollY - 76),
  )
  await page.getByRole("button", { name: "Dismiss", exact: true }).click()
  await page.getByRole("img", { name: "Lewis Cook", exact: true }).waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#testimonials img")].every((img) => img.complete && img.naturalWidth > 0),
  )
  const screenshot = async (name, title, captions) => {
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#testimonials > div > div")].every(
        (el) => Number(getComputedStyle(el).opacity) >= 0.99,
      ),
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#testimonials [aria-roledescription="slide"]')].every(
        (el) => Number(getComputedStyle(el).opacity) >= 0.99,
      ),
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#testimonials img")].every((img) => img.complete && img.naturalWidth > 0),
    )
    const markers = []
    for (const { selector, caption } of captions) {
      const box = await page.locator(selector).first().boundingBox()
      if (!box) throw new Error(`Missing annotation target: ${selector}`)
      const isQuote = selector.includes("blockquote")
      const mobile = page.viewportSize().width < 600
      markers.push({
        x: Math.round(isQuote ? (mobile ? box.x + box.width - 16 : box.x - 27) : box.x + 20),
        y: Math.round(isQuote && mobile ? box.y - 20 : box.y + 20),
        caption,
      })
    }
    await page.screenshot({ path: `${out}/raw/${name}.png` })
    await annotate(`${out}/raw/${name}.png`, `${out}/${name}.png`, {
      title,
      subtitle:
        "Actual homepage at localhost:3050. Existing public athlete photos and quotes; temporary development data restored after capture.",
      markers,
      scale: page.viewportSize().width < 600 ? 0.75 : 1,
    })
  }
  await screenshot("01-desktop", "Testimonials — desktop", [
    {
      selector: '#testimonials img[alt="Lewis Cook"]',
      caption: "The athlete photo now fills a large part of the story.",
    },
    {
      selector: "#testimonials blockquote",
      caption: "A larger quote and clear athlete details make the story easier to read.",
    },
    {
      selector: '[aria-label="Choose an athlete"]',
      caption: "Choose an athlete directly or move through the stories with the arrows.",
    },
  ])
  await page.getByRole("button", { name: "Read Mohamed Al Mashayiki's testimonial" }).click()
  await page.getByRole("img", { name: "Mohamed Al Mashayiki", exact: true }).waitFor()
  await page.waitForFunction(() => {
    const img = document.querySelector('#testimonials img[alt="Mohamed Al Mashayiki"]')
    return img?.complete && img.naturalWidth > 0
  })
  await screenshot("02-second-athlete", "Another athlete's story", [
    {
      selector: '#testimonials img[alt="Mohamed Al Mashayiki"]',
      caption: "The same layout keeps the next athlete's photo prominent.",
    },
    { selector: "#testimonials blockquote", caption: "Every photo stays paired with the athlete's original quote." },
  ])
  await page.getByRole("button", { name: "Read Wayde van Niekerk's testimonial" }).click()
  await page.getByText("Wayde van Niekerk", { exact: true }).waitFor()
  await screenshot("03-no-photo", "When a photo has not been added", [
    {
      selector: '#testimonials [aria-roledescription="slide"] > div:first-child',
      caption: "Athlete initials keep this story complete while a photo is still missing.",
    },
    { selector: "#testimonials blockquote", caption: "The original quote and athlete details remain fully readable." },
  ])
  const mobileContext = await browser.newContext({
    viewport: { width: 430, height: 1450 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  })
  await mobileContext.route("**/*", (route) =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort(),
  )
  page = await mobileContext.newPage()
  page.on("pageerror", (error) => checks.push({ pageError: error.message }))
  await page.goto("http://localhost:3050/", { waitUntil: "networkidle" })
  await page.addStyleTag({ content: "nextjs-portal { display:none!important }" })
  await page.getByRole("img", { name: "Lewis Cook", exact: true }).waitFor()
  await page.evaluate(() =>
    window.scrollTo(0, document.querySelector("#testimonials").getBoundingClientRect().top + window.scrollY - 80),
  )
  await page.getByRole("button", { name: "Dismiss", exact: true }).click()
  await screenshot("04-mobile", "Testimonials — mobile", [
    { selector: '#testimonials img[alt="Lewis Cook"]', caption: "On a phone, the photo sits above the story." },
    { selector: "#testimonials blockquote", caption: "The quote stays readable without sideways scrolling." },
  ])
  checks.push({
    mobileHasHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  })
  if (checks.some((c) => c.pageError || c.mobileHasHorizontalOverflow)) throw new Error(JSON.stringify(checks))
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2))
  console.log(JSON.stringify({ captures: 4, checks }))
} finally {
  if (browser) await browser.close()
  const { error: restoreError } = await db
    .from("testimonials")
    .update({ avatar_url: mohamed.avatar_url })
    .eq("id", mohamed.id)
  if (restoreError) throw restoreError
  if (temporaryId) {
    const { error: deleteError } = await db.from("testimonials").delete().eq("id", temporaryId)
    if (deleteError) throw deleteError
  }
  console.log("Temporary development testimonial data restored")
}
