// Real-app capture: weekly scan topics as boxes on /admin/topic-suggestions. Switch one off (crossed out,
// kept), add a topic with keywords (one search per keyword), and "Suggest your own topic" (its card joins
// this week's brief and it becomes a scan topic).
//
// DEV CLONE ONLY (anjvztjiokcgiyhobknq). Writes through the real screen: system_settings blog_scan_topics +
// blog_scan_queries, and one content_calendar card. In `finally` both settings are put back exactly as they
// were and the card is deleted by id. It never clicks "Research" or "Run scan now": both start a job that
// the DEPLOYED Firebase functions pick up.
//
// Run (dev server on 3051, started with --webpack):
//   env RESEND_API_KEY= node node_modules/next/dist/bin/next dev --webpack --port 3051
//   node scripts/capture-topic-suggestions.mjs
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
const OUT = "screenshots/topic-suggestions"
const W = 1440
const H = 900
const OFF = "energy system conditioning aerobic capacity team-sport athlete research"
const FOCUS = { name: "Agility and change of direction", keywords: ["deceleration", "cutting mechanics", "reactive agility"] }
const OWN = "Deceleration training for youth soccer players"
mkdirSync(`${OUT}/raw`, { recursive: true })

const t0 = Date.now()
const beats = []
const beat = (msg) => {
  const line = `[+${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`
  beats.push(line)
  console.log(line)
}
const assertions = []
const check = (name, ok, evidence = "") => {
  assertions.push({ name, ok, evidence })
  beat(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` -- ${evidence}` : ""}`)
  if (!ok) throw Error(`ASSERTION FAILED: ${name} ${evidence}`)
}
const marker = async (loc, caption, place = "before") => {
  const b = await loc.first().boundingBox()
  if (!b) throw Error(`no box for marker: ${caption}`)
  if (b.y < 0 || b.y + b.height > H) throw Error(`marker target is off screen (y ${Math.round(b.y)}): ${caption}`)
  const x = place === "after" ? b.x + b.width + 22 : place === "above" ? b.x + b.width / 2 : b.x - 22
  const y = place === "above" ? b.y - 22 : b.y + b.height / 2
  return { x: Math.round(x), y: Math.round(y), caption }
}
const settings = async () => {
  const { data } = await db.from("system_settings").select("key,value").in("key", ["blog_scan_queries", "blog_scan_topics"])
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
}

const startedAt = new Date().toISOString()
const before = await settings()
let cardId = null
let browser
try {
  const lines = before.blog_scan_queries
  if (!Array.isArray(lines) || !lines.includes(OFF)) throw Error(`the clone's scan list must contain "${OFF}"`)
  if (before.blog_scan_topics) throw Error("blog_scan_topics is already set on the clone; this capture expects the first-read state")
  beat(`clone scan list: ${lines.length} lines`)

  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: "reduce" })).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const hideChrome = () =>
    page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  const saved = () =>
    page.waitForResponse((r) => r.url().endsWith("/api/admin/topic-suggestions/topics") && r.request().method() === "POST")

  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/topic-suggestions`, { waitUntil: "load", timeout: 120000 })
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Weekly scan topics" }) })
  await section.waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500) // hydration
  const boxes = section.locator("ul > li")
  check("the old one-line-per-search list shows as one box per line, all on", (await boxes.count()) === lines.length && (await section.getByRole("switch", { checked: true }).count()) === lines.length, `${await boxes.count()} boxes`)

  // 1. Switch one off: it stays, crossed out, and leaves the scan.
  let res = saved()
  await section.getByRole("switch", { name: `Search "${OFF}" in the weekly scan` }).click()
  check("switching off saves (200)", (await res).status() === 200)
  let s = await settings()
  check("the topic is kept, switched off", s.blog_scan_topics?.some((t) => t.name === OFF && t.active === false), JSON.stringify(s.blog_scan_topics?.find((t) => t.name === OFF)))
  check("and the scan no longer searches it", !s.blog_scan_queries.includes(OFF) && s.blog_scan_queries.length === lines.length - 1)
  check("it is crossed out on screen", await section.getByText(OFF, { exact: true }).evaluate((el) => getComputedStyle(el).textDecorationLine.includes("line-through")))

  // 2. A focus topic with keywords: one search per keyword.
  await section.getByRole("textbox", { name: "New topic", exact: true }).fill(FOCUS.name)
  await section.getByRole("textbox", { name: "Keywords for the new topic, comma-separated" }).fill(FOCUS.keywords.join(", "))
  res = saved()
  await section.getByRole("button", { name: "Add topic" }).click()
  check("adding the topic saves (200)", (await res).status() === 200)
  s = await settings()
  const expected = FOCUS.keywords.map((k) => `${FOCUS.name} ${k} research`)
  check("the scan searches each keyword", expected.every((q) => s.blog_scan_queries.includes(q)), JSON.stringify(s.blog_scan_queries.slice(-3)))
  const focusBox = boxes.filter({ hasText: FOCUS.name })
  await focusBox.getByText("3 searches").waitFor({ timeout: 15000 })

  await hideChrome()
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.evaluate(() => window.scrollBy(0, -80))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/raw/01-scan-topics.png` })
  await annotate(`${OUT}/raw/01-scan-topics.png`, `${OUT}/01-scan-topics.png`, {
    title: "Each weekly scan topic is its own box",
    subtitle: "Marketing > Topic Suggestions > Weekly scan topics",
    markers: [
      await marker(boxes.filter({ hasText: OFF }).getByRole("switch"), "Switched off: crossed out and left out of the scan. It stays here, so you can switch it back on any week.", "before"),
      await marker(focusBox.getByText("3 searches"), "Keywords dig deeper: each one is its own search.", "after"),
      await marker(section.getByRole("button", { name: "Add topic" }), "Add a topic, with keywords if you want them.", "above"),
    ],
  })
  beat("shot 01")

  // 3. Suggest your own topic: the card joins this week's brief, and the title becomes a scan topic.
  const own = page.getByPlaceholder(/Rotational power for golfers/)
  await own.fill(OWN)
  const added = page.waitForResponse((r) => r.url().endsWith("/api/admin/topic-suggestions/custom") && r.request().method() === "POST")
  const addBtn = page.getByRole("button", { name: "Add", exact: true })
  beat(`suggest box value "${await own.inputValue()}", Add buttons ${await addBtn.count()}, disabled ${await addBtn.first().isDisabled()}`)
  await addBtn.click()
  const addRes = await added.catch(async (e) => {
    await page.screenshot({ path: `${OUT}/raw/debug-add.png` })
    throw e
  })
  const body = await addRes.json()
  cardId = body.id ?? null
  check("the card is added (201)", addRes.status() === 201, String(addRes.status()))
  check("and the title is now a scan topic, switched on", body.scan_topic === "on", String(body.scan_topic))
  const { data: card } = await db.from("content_calendar").select("scheduled_for, metadata").eq("id", cardId).single()
  const { data: latest } = await db
    .from("content_calendar")
    .select("scheduled_for")
    .eq("entry_type", "topic_suggestion")
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .single()
  check("the card is dated with the newest brief, so it shows as this week's", card.scheduled_for === latest.scheduled_for, `${card.scheduled_for}`)
  const ownBox = boxes.filter({ hasText: OWN })
  await ownBox.getByText("Your topic").waitFor({ timeout: 30000 })
  check("its box carries the label Your topic", await ownBox.getByText("Your topic").isVisible())

  const cardEl = page.locator("article", { hasText: OWN })
  await cardEl.waitFor({ timeout: 30000 })
  check("the card says where it came from", await cardEl.getByText("Your topic", { exact: true }).isVisible())
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "))
  await hideChrome()

  await ownBox.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/raw/02-your-topic-box.png` })
  await annotate(`${OUT}/raw/02-your-topic-box.png`, `${OUT}/02-your-topic-box.png`, {
    title: "Your own topic is added to the weekly scan",
    subtitle: "Marketing > Topic Suggestions > Weekly scan topics",
    markers: [
      await marker(ownBox.getByText("Your topic"), "\"Suggest your own topic\" also adds it here, so the weekly scan looks for more on it. Switch it off when you are done with it.", "after"),
    ],
  })
  beat("shot 02")

  // The list's own heading (not the help text above, which also says "this week's brief").
  const brief = page.getByText(/This week.s brief/).last()
  await cardEl.evaluate((el) => el.scrollIntoView({ block: "center" }))
  await page.mouse.move(3, 3)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/raw/03-your-topic-card.png` })
  await annotate(`${OUT}/raw/03-your-topic-card.png`, `${OUT}/03-your-topic-card.png`, {
    title: "And its card lands in this week's brief",
    subtitle: "Marketing > Topic Suggestions > This week's brief",
    markers: [
      await marker(cardEl.getByText("Your topic", { exact: true }), "Each card says where it came from: Weekly scan, Researched, Your topic or SEO agent.", "after"),
    ],
  })
  check("the card sits under this week's brief heading", (await brief.boundingBox()).y < (await cardEl.boundingBox()).y)
  beat("shot 03")

} finally {
  try {
    if (browser) await browser.close()
  } catch {}
  if (cardId) {
    const { error } = await db.from("content_calendar").delete().eq("id", cardId)
    beat(`cleanup card: ${error ? "ERROR " + error.message : "ok"}`)
  }
  await db.from("system_settings").upsert({ key: "blog_scan_queries", value: before.blog_scan_queries, updated_at: new Date().toISOString() }, { onConflict: "key" })
  if (before.blog_scan_topics === undefined) await db.from("system_settings").delete().eq("key", "blog_scan_topics")
  else await db.from("system_settings").upsert({ key: "blog_scan_topics", value: before.blog_scan_topics }, { onConflict: "key" })
  const after = await settings()
  const restored =
    JSON.stringify(after.blog_scan_queries) === JSON.stringify(before.blog_scan_queries) &&
    JSON.stringify(after.blog_scan_topics) === JSON.stringify(before.blog_scan_topics)
  const { count } = await db.from("content_calendar").select("id", { count: "exact", head: true }).eq("title", OWN)
  beat(`cleanup verified: settings restored ${restored}; cards titled "${OWN}" left: ${count}`)
  writeFileSync(`${OUT}/run.json`, JSON.stringify({ startedAt, app: APP, assertions, beats }, null, 2))
}
