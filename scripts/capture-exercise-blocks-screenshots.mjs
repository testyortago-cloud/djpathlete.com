// Drives the REAL app and captures the exercise blocklist, with the callouts
// burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev                                          # port 3050
//   node scripts/capture-exercise-blocks-screenshots.mjs
//
// LIGHT ONLY, DELIBERATELY. The admin components were never built against the
// `.dark` class variant — forcing it breaks existing pages — so there is no
// second rendering to capture. This is not an omission.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE, and refuses any other
// project ref outright. Two states cannot be reached by driving the UI alone in
// a sensible number of clicks — a movement pattern emptied down to its last
// exercise, and a per-client block on a client whose program is open elsewhere.
// Both are seeded through the app's OWN route (never a direct insert, so the
// captured rows are exactly what a coach's click produces) and every row this
// script creates is deleted again in the finally. Nothing here touches
// production.

import { readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/exercise-blocks"
const WIDTH = 1440

const PROGRAM = "38914555-e9a8-49e8-a86f-ec9142577340" // Ellen the English Ego
const CLIENT = "de68c997-79f9-4488-abe7-72606d568d8e" // Victor Okonjo — its assigned client

// The only four exercises tagged `carry` in a 917-exercise library. Three are
// mis-tagged, which is exactly why a coach would block them — and blocking all
// four is what produces the starvation warning on the last one.
const CARRY_OTHERS = {
  "Offset cable steps_Core": null,
  "Cable rear hip abduction_Hip": null,
  "Suitcase carry-Core": null,
}
const CARRY_LAST = "Barbell shoulder take outs_Shoulder"
const CLIENT_BLOCK = "Weighted deadbug_Core"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const ref = new URL(U).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }

async function rest(path, init = {}) {
  const r = await fetch(`${U}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, Prefer: "return=representation", ...(init.headers ?? {}) },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${t.slice(0, 300)}`)
  try {
    return JSON.parse(t)
  } catch {
    return []
  }
}

async function exerciseIdByName(name) {
  const rows = await rest(`exercises?name=eq.${encodeURIComponent(name)}&select=id,name,movement_pattern`)
  if (!rows.length) throw new Error(`exercise not found: ${name}`)
  return rows[0].id
}

/**
 * Launches Chromium, tolerating the browser-revision drift that bites every
 * time this repo's Playwright is upgraded. Reports the substitution rather than
 * swallowing it — a silent fallback is how you end up puzzling over a rendering
 * difference nobody told you about.
 */
async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

/**
 * Hides dev-only and product chrome that floats over every page: the Next.js
 * dev indicator and the support-chat dock. Injected into the page, never edited
 * into the components — changing app code to take a nicer picture of it makes
 * the picture a lie.
 */
async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
  // The support dock is a plain button with the text "Messages" pinned bottom-right.
  await page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll("button"))) {
      const s = getComputedStyle(b)
      if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
    }
  })
}

const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

/**
 * Marker positioned on a real element, converted from CSS px to the raw pixel
 * space annotate() draws in.
 *
 * WARNS LOUDLY rather than degrading politely. A helper that quietly returns a
 * default turns a misplaced callout into a silent no-op, and the reviewer is
 * left reading a caption that points at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption will be mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption will be mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  // "left" parks the disc just outside the element rather than on top of it —
  // a numbered disc centred on a sentence eats the words it is pointing at.
  const cx = place === "center" ? box.x + box.width / 2 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  // Assert the session BEFORE anything else: an expired or refused login
  // reports downstream as a feature failure that mimics a real bug.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

/** Blocks through the app's own route, using the browser's admin session. */
async function blockViaApi(page, exerciseId, { clientId = null, reason = null } = {}) {
  const res = await page.evaluate(
    async ([id, cid, why]) => {
      const r = await fetch("/api/admin/exercises/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exercise_id: id, ...(cid ? { client_id: cid } : {}), ...(why ? { reason: why } : {}) }),
      })
      return { status: r.status, body: await r.text() }
    },
    [exerciseId, clientId, reason],
  )
  if (res.status !== 200) throw new Error(`block failed ${res.status}: ${res.body}`)
  return JSON.parse(res.body)
}

async function openWeek(page, week) {
  await page.getByRole("button", { name: `Week ${week}`, exact: true }).click()
  await page.waitForTimeout(1200)
}

/**
 * Hovers an exercise card by its visible (possibly truncated) name prefix and
 * returns the card root.
 *
 * Uses raw mouse movement rather than locator.hover(). The hover is what REVEALS
 * the action row, and that row then sits over the text the locator is anchored
 * to — so hover() re-runs its actionability check, finds the target covered by
 * the thing it just revealed, and retries until it times out.
 */
async function hoverCard(page, namePrefix) {
  const card = page.locator("div.group", { hasText: namePrefix }).first()
  if ((await card.count()) === 0) throw new Error(`no card matching "${namePrefix}" on screen`)
  await card.scrollIntoViewIfNeeded()
  // The header is sticky at h-16; nudge down so the card is never under it.
  await page.evaluate(() => window.scrollBy(0, -90))
  await page.waitForTimeout(300)
  const box = await card.boundingBox()
  if (!box) throw new Error(`card "${namePrefix}" has no box`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(700)
  return card
}

const created = []

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1250 }, deviceScaleFactor: 2 })

try {
  await signInAsAdmin(ctx)
  const page = await ctx.newPage()

  // ── 1. The block button, on a real generated day ────────────────────────
  await page.goto(`${APP}/admin/programs/${PROGRAM}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(6000)
  const deadbugCard = await hoverCard(page, "Modified deadb")
  await shoot(page, "01-block-button", "The block button lives on the exercise card", "Week 1 · Monday · Ellen the English Ego — the real program builder", [
    await markerOn(page, deadbugCard.getByTitle("Block from AI generation"), "Hovering an exercise reveals the ⊘ Block button, beside Edit and Remove. This is where the coach notices the repetition, so it is where the control belongs.", { place: "center", dy: -26 }),
    await markerOn(page, deadbugCard.locator("text=Modified deadb"), "\"Modified deadbug\" — one of the three exercises the coach reported turning up in every generated day.", { dy: 40 }),
  ])

  // ── 1b. The Blocked panel — the Exercise Pool's shape, inverted ─────────
  await page.getByRole("button", { name: "Blocked", exact: true }).click()
  await page.waitForTimeout(2500)
  await shoot(page, "02-blocked-panel", "The blocklist is shaped like the Exercise Pool", "The same anatomy the coach already knows — search on top, the list below, click to add", [
    await markerOn(page, page.getByRole("heading", { name: "Blocked" }), "Red and ⊘ where the pool is accent and a spark. They are opposite lists, so opening one closes the other — two of them side by side is how you add to the wrong one."),
    await markerOn(page, page.getByPlaceholder("Search exercises..."), "Search the whole library and click a row to block it, exactly the way the pool works."),
    await markerOn(page, page.getByRole("button", { name: "Victor only" }), "Each block is studio-wide or for this client alone, chosen before you click."),
    await markerOn(page, page.locator("text=in this program or any other"), "The one line that separates it from the pool: the pool is this program only and dies with the tab, a block is permanent and applies everywhere."),
  ])
  await page.getByRole("button", { name: "Blocked", exact: true }).click()
  await page.waitForTimeout(800)

  // ── 2. The dialog, with both scopes ─────────────────────────────────────
  const blockBtn = deadbugCard.getByTitle("Block from AI generation")
  await blockBtn.click({ force: true })
  await page.waitForTimeout(900)
  await shoot(page, "03-block-dialog", "Blocking is scoped, and says what it will not do", "The program is assigned to Victor Okonjo, so both scopes are offered", [
    await markerOn(page, page.locator("text=stays in your library"), "The copy says plainly that the exercise stays in the library and stays in programs already built. The button sits beside a delete, so it would otherwise read as one."),
    await markerOn(page, page.getByText(/For Victor .*only/), "\"For every client\" is the default. \"For Victor Okonjo only\" appears only when the program has an assigned client."),
    await markerOn(page, page.locator("#block-reason"), "An optional reason — this is what the review list shows back, weeks later, when nobody remembers why."),
  ])
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)

  // ── Seed: empty the `carry` pattern down to its last exercise ───────────
  // Done through the app's own POST so the rows are exactly what a click makes.
  for (const name of Object.keys(CARRY_OTHERS)) {
    const id = await exerciseIdByName(name)
    CARRY_OTHERS[name] = id
    const r = await blockViaApi(page, id, { reason: "Mis-tagged as a carry" })
    created.push(r.block.id)
  }
  console.log(`  seeded ${created.length} carry blocks`)

  // ── 3. The starvation warning ───────────────────────────────────────────
  await openWeek(page, 3)
  const carryCard = await hoverCard(page, "Barbell shoulder take")
  await carryCard.getByTitle("Block from AI generation").click({ force: true })
  await page.waitForTimeout(700)
  await page.getByRole("button", { name: "Block", exact: true }).click()
  await page.waitForTimeout(1500)
  await shoot(page, "04-starvation-warning", "Blocking the last of a movement pattern says so, before you walk away", "carry holds only four exercises in a 917-exercise library, and three of those are mis-tagged", [
    await markerOn(page, page.locator("text=last usable"), "The block already succeeded — and the dialog holds open on this warning instead of closing into a toast. A coach who blocks the last carry needs to read it now, not discover it weeks later when carries quietly stopped appearing."),
    await markerOn(page, page.getByRole("button", { name: "Got it" }), "Generation does not break. Days that ask for a carry are re-routed onto the nearest movement pattern that still has exercises in it.", { place: "center", dx: 40 }),
  ])
  const lastId = await exerciseIdByName(CARRY_LAST)
  const lastRows = await rest(`exercise_blocks?exercise_id=eq.${lastId}&select=id`)
  for (const row of lastRows) created.push(row.id)
  await page.keyboard.press("Escape")

  // ── 4. The studio-wide review list ──────────────────────────────────────
  await page.goto(`${APP}/admin/settings/ai-policy`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(800)
  await shoot(page, "05-studio-list", "Every studio-wide block, reviewable and reversible", "/admin/settings/ai-policy — beside the disallowed-techniques policy it belongs with", [
    await markerOn(page, page.locator("text=Blocked exercises"), "Every studio-wide block, with the reason it was made and the date. A list you could only add to would narrow generation with no way to find out why."),
    await markerOn(page, page.getByRole("button", { name: /unblock/i }), "Unblock puts the exercise straight back in front of the AI on the very next generation."),
    await markerOn(page, page.locator("text=Mis-tagged as a carry"), "Three of the four exercises tagged as a \"carry\" are not carries at all. That mis-tagging is the reason Suitcase carry had no competition."),
  ])

  // ── Seed: one per-client block, then the client screen ──────────────────
  const clientExId = await exerciseIdByName(CLIENT_BLOCK)
  const r = await blockViaApi(page, clientExId, { clientId: CLIENT, reason: "Aggravates his shoulder" })
  created.push(r.block.id)

  // ── 5. The per-client list ──────────────────────────────────────────────
  await page.goto(`${APP}/admin/clients/${CLIENT}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(4000)
  const heading = page.locator("text=Blocked for").first()
  if (await heading.count()) await heading.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await shoot(page, "06-client-list", "A block can belong to one client alone", "Victor Okonjo's client screen, straight after his questionnaire and injury notes", [
    await markerOn(page, page.getByText(/Blocked for Victor/), "\"Blocked for Victor\" — this exercise is off the table for him and for nobody else. It sits where the injury notes that usually motivated it already live."),
    await markerOn(page, page.locator("text=Aggravates his shoulder"), "The reason travels with the block, so the next person to look knows why it is there."),
  ])

  console.log("\nall shots captured")
} finally {
  // Put the dev clone back exactly as it was found.
  for (const id of created) {
    await rest(`exercise_blocks?id=eq.${id}`, { method: "DELETE" }).catch((e) => console.warn("cleanup:", e.message))
  }
  const left = await rest(`exercise_blocks?select=id`).catch(() => [])
  console.log(`cleanup: removed ${created.length} block rows; ${left.length} remain in exercise_blocks`)
  await browser.close()
}
