// Real-app capture of: the "Learned from your edits" card (Settings > AI Program Policy) and the
// "Follows on from" note in the AI Generate dialog. Read-only: it opens pages and a dialog, and
// generates nothing. The change log it shows was written by real builder edits on the dev clone.
//
// Run (dev server on 3050, .env.local on the dev clone): node scripts/capture-generator-learning.mjs
import { cpSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { chromium } from "playwright"
import dotenv from "dotenv"
import { annotate } from "./_annotate-lib.mjs"

const env = dotenv.config({ path: ".env.local", quiet: true }).parsed
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "anjvztjiokcgiyhobknq.supabase.co")
  throw Error("Development clone only: .env.local must point at anjvztjiokcgiyhobknq")

const APP = process.env.APP_URL ?? "http://localhost:3050"
// Written outside the project while the browser runs (a new file inside it rebuilds and reloads the page).
const DEST = "screenshots/generator-learning"
const OUT = process.env.CAPTURE_TMP ?? `${tmpdir()}/capture-generator-learning`
const CLIENT = process.env.CLIENT_NAME ?? "Imogen Clarke"
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

const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }))
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
  ).newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  const hideChrome = () =>
    page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster]{display:none!important}" })
  const shot = async (file, opts) => {
    await page.mouse.move(3, 3)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/raw/${file}` })
    await annotate(`${OUT}/raw/${file}`, `${OUT}/${file}`, opts)
  }

  // 1. Settings > AI Program Policy: the change log and what the AI learned.
  await page.goto(`${APP}/api/dev/login?callbackUrl=${encodeURIComponent("/admin/settings/ai-policy")}`, {
    waitUntil: "load",
    timeout: 180000,
  })
  const heading = page.getByRole("heading", { name: "Learned from your edits" })
  await heading.waitFor({ timeout: 120000 })
  await hideChrome()
  const card = heading.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
  await card.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -24))
  const tookOut = page.getByText("AI picks you took out")
  const putIn = page.getByText("Exercises you put in")
  const removedList = page.getByText("You often take out (ranked lower)")
  const addedList = page.getByText("You often put in (ranked higher)")
  const firstRow = card.locator("tbody tr").first()
  check("the card counts AI picks taken out", (await tookOut.locator("xpath=following-sibling::p").innerText()) === "3")
  check("the card counts exercises put in", (await putIn.locator("xpath=following-sibling::p").innerText()) === "2")
  check(
    "the put-in list shows the Pallof press twice",
    /Cable pallof press_Core\s*2 times/.test(await addedList.locator("xpath=..").innerText()),
  )
  check("the log lists 5 changes", (await card.locator("tbody tr").count()) === 5)
  await shot("01-learned-from-your-edits.png", {
    title: "Learned from your edits",
    subtitle: "Settings › AI Program Policy. Every exercise you take out of, or put into, an AI program is logged here.",
    markers: [
      await marker(tookOut, "How many times you took out an exercise the AI had picked (last 180 days).", "above"),
      await marker(putIn, "How many times you put a new exercise into an AI program.", "above"),
      await marker(removedList, "Exercises you keep taking out. The AI now ranks these lower for you."),
      await marker(addedList, "Exercises you keep putting in. The AI now ranks these higher for you.", "above"),
      await marker(firstRow, "The change log: when, what, which program, which week and day."),
    ],
  })

  // 2. AI Generate dialog: the note naming the program the new one follows on from.
  await page.goto(`${APP}/admin/programs`, { waitUntil: "load", timeout: 180000 })
  await hideChrome()
  await page.getByRole("button", { name: "AI Generate" }).click()
  const select = page.locator("#ai-client")
  await select.waitFor({ timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll("#ai-client option").length > 1, null, { timeout: 60000 })
  const value = await select.locator("option", { hasText: CLIENT }).first().getAttribute("value")
  check(`the client list has ${CLIENT}`, !!value)
  await select.selectOption(value)
  const note = page.getByText("Follows on from", { exact: false })
  await note.waitFor({ timeout: 60000 })
  const noteText = await note.innerText()
  check("the dialog names the previous program", /Follows on from “.+”/.test(noteText), noteText)
  await shot("02-follows-on-from.png", {
    title: "The new program follows on from the last one",
    subtitle: `AI Generate › choose a client. ${CLIENT}'s last program is named, and the AI builds on it.`,
    markers: [
      await marker(select, "Choose the client."),
      await marker(note, "The program this one follows on from. The AI reads what it worked on and progresses it."),
      await marker(page.getByText("Ignore athlete profile"), "Switch this on to skip the previous program too."),
    ],
  })

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "))
} finally {
  await browser.close()
}

mkdirSync(DEST, { recursive: true })
cpSync(OUT, DEST, { recursive: true })
console.log(`shots copied to ${DEST}`)
