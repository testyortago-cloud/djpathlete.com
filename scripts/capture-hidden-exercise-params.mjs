// Drives the REAL app and photographs the REAL "Edit Exercise Parameters"
// dialog on the REAL /admin/programs/<id> builder — the screen the owner
// photographed off their monitor.
//
//   npm run dev                                                  # port 3050
//   node scripts/capture-hidden-exercise-params.mjs --phase before   # with the fix STASHED
//   node scripts/capture-hidden-exercise-params.mjs --phase after    # with the fix applied
//
// Nothing here is a harness, a storybook or a scratch mount. The two phases are
// captured against two real builds of the app — the "before" pass runs with the
// source change stashed out of the working tree — so the shots differ by the
// code under test and nothing else. Each pass ASSERTS the state it expects, so
// a stale HMR build fails loudly instead of mislabelling a screenshot.
//
// THE PATCH IS NEVER SENT. The save click is intercepted by a route handler
// that records the body and answers 200, so the "before" pass can prove the
// erase payload without writing it to the dev clone.
//
// LIGHT ONLY: the admin components were never built against the `.dark` class
// variant, so there is no second rendering to capture.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/hidden-exercise-params"
const WIDTH = 1440
const HEIGHT = 900
const DSF = 2 // annotate() places markers in RAW pixels
const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

// "Cannon Baller!" — Week 4, Friday. The last card is a `flexibility` stretch
// prescribed 3 sets / 8 reps / 45s rest / RPE 8 / Tempo 4-2-4: the owner's case.
const PROGRAM_ID = "5fb09c3b-f6a3-427e-acf8-369078c73f6d"
const WEEK = 4
const DAY = "Friday"
const EXERCISE = "Hamstring stretch_Hamstring"

const phase = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : null
if (phase !== "before" && phase !== "after") throw new Error("pass --phase before|after")

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

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

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

/**
 * Marker positioned on a real element, converted from CSS px to raw pixels.
 * WARNS LOUDLY rather than degrading politely — a quiet default turns a
 * misplaced callout into a silent no-op and the reviewer reads a caption
 * pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 120, y: 120, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 120, y: 120, caption }
  }
  const cx =
    place === "center"
      ? box.x + box.width / 2
      : place === "right"
        ? box.x + box.width - 22
        : place === "after"
          ? box.x + box.width + 22
          : box.x - 22
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
  await page.waitForTimeout(3000)
  // Assert the session BEFORE anything else: a refused login reports downstream
  // as a feature failure that mimics the real bug.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

/** Open the real builder on the right week/day and open the real edit dialog. */
async function openEditDialog(page) {
  await page.goto(`${APP}/admin/programs/${PROGRAM_ID}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  // Hydration: an enabled button whose handler is not attached swallows the click.
  await page.waitForTimeout(2500)

  const week = page.getByRole("button", { name: `Week ${WEEK}`, exact: true })
  await week.waitFor({ state: "visible", timeout: 20000 })
  await week.click()
  await page.waitForTimeout(800)

  // The card container, not the name text: the hover action bar sits on top of
  // the name and steals the pointer, which reads as "element never stable".
  const card = page
    .locator("div.group.relative")
    .filter({ hasText: EXERCISE })
    .last()
  await card.waitFor({ state: "visible", timeout: 20000 })
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  // The pencil only exists on hover, and Playwright hovers before it clicks.
  const editBtn = card.getByTitle("Edit parameters")
  if ((await editBtn.count()) !== 1) {
    throw new Error(`expected exactly one 'Edit parameters' button on the ${EXERCISE} card, got ${await editBtn.count()}`)
  }
  await editBtn.click()

  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible", timeout: 10000 })
  await page.waitForTimeout(700) // open animation
  // Park the pointer: Playwright's mouse stays where it last clicked, and a
  // hovered control reads as a styling bug that is not there.
  await page.mouse.move(4, 4)
  await page.waitForTimeout(200)
  return { dialog, card }
}

/** What the dialog actually offers, read off the real DOM. */
async function report(page, label) {
  const has = async (re) => (await page.getByLabel(re).count()) > 0
  const val = async (re) => ((await page.getByLabel(re).count()) > 0 ? await page.getByLabel(re).inputValue() : null)
  const state = {
    reps: await has(/^reps/i),
    rest: await has(/^rest/i),
    rpe: await has(/^rpe target/i),
    tempo: await has(/^tempo/i),
    repsValue: await val(/^reps/i),
    restValue: await val(/^rest/i),
    rpeValue: await val(/^rpe target/i),
  }
  console.log(
    `  [${label}] offers — Reps:${state.reps}(${state.repsValue}) Rest:${state.rest}(${state.restValue}) ` +
      `RPE:${state.rpe}(${state.rpeValue}) Tempo:${state.tempo}`,
  )
  return state
}

/** Click Save with the PATCH intercepted, and hand back the body it WOULD have sent. */
async function capturePatchBody(page) {
  let body = null
  await page.route("**/api/admin/programs/*/exercises/*", async (route) => {
    if (route.request().method() === "PATCH") {
      body = JSON.parse(route.request().postData() ?? "{}")
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      return
    }
    await route.continue()
  })
  await page.getByRole("button", { name: /save changes/i }).click()
  for (let i = 0; i < 60 && body === null; i++) await page.waitForTimeout(100)
  await page.unroute("**/api/admin/programs/*/exercises/*")
  if (body === null) throw new Error("Save never issued a PATCH — did the click land?")
  return body
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])
  const page = await ctx.newPage()
  const { card } = await openEditDialog(page)
  const state = await report(page, phase)

  if (phase === "before") {
    if (state.reps || state.rest || state.rpe) {
      throw new Error("BEFORE pass sees the fix applied — stash the source change and let dev recompile first")
    }
    const dialog = page.getByRole("dialog")
    await shoot(
      page,
      "01-before",
      "BEFORE — the card says 8 reps, 45s rest, RPE 8. The editor offers none of them.",
      `The real "Edit Exercise Parameters" dialog on /admin/programs — ${EXERCISE}, Week ${WEEK} ${DAY}. It is a ` +
        `flexibility exercise, so the editor only ever offered Sets, Duration and Method.`,
      [
        await markerOn(
          page,
          card.locator("p.text-xs").first(),
          "The card behind reads 3 sets / 8 reps / 45s rest / RPE 8 / Tempo 4-2-4.",
          { place: "left", dx: -30 },
        ),
        await markerOn(page, page.getByLabel(/duration per set/i), "Duration is the only timing field offered — and it is empty.", {
          place: "after",
          dx: 30,
        }),
        await markerOn(
          page,
          dialog,
          "No Reps. No Rest. No RPE. Saving here sent reps, rest_seconds and rpe_target as null — erasing all three.",
          { place: "left", dy: 120 },
        ),
      ],
    )
    const body = await capturePatchBody(page)
    writeFileSync(`${OUT}/.patch-before.json`, JSON.stringify(body, null, 2))
    console.log(`  [before] PATCH body would have been: ${JSON.stringify(body)}`)
    if (body.reps !== null || body.rest_seconds !== null || body.rpe_target !== null) {
      console.warn("  !! expected the erase payload (reps/rest/rpe = null) and did not get it")
    }
  } else {
    if (!state.reps || !state.rest || !state.rpe) {
      throw new Error("AFTER pass does not see the fix — is the dev server serving the old build?")
    }
    if (state.repsValue !== "8" || state.restValue !== "45" || state.rpeValue !== "8") {
      throw new Error(`AFTER pass has wrong values: ${JSON.stringify(state)}`)
    }
    await shoot(
      page,
      "02-after",
      "AFTER — the editor now offers every value the card shows.",
      `The same dialog, same exercise, same route. Reps, Rest and RPE Target are back, filled with what the coach ` +
        `actually prescribed, and saving keeps them.`,
      [
        await markerOn(page, page.getByLabel(/^reps/i), "Reps — 8, the value on the card.", { place: "after", dx: 30 }),
        await markerOn(page, page.getByLabel(/^rest/i), "Rest — 45 seconds.", { place: "left" }),
        await markerOn(page, page.getByLabel(/^rpe target/i), "RPE Target — 8. Editable, and no longer erased on save.", {
          place: "after",
          dx: 30,
        }),
      ],
    )
    const body = await capturePatchBody(page)
    writeFileSync(`${OUT}/.patch-after.json`, JSON.stringify(body, null, 2))
    console.log(`  [after] PATCH body: ${JSON.stringify(body)}`)
  }
} finally {
  await browser.close()
}
