// Drives the REAL app and captures the per-generation equipment control on the
// real Generate Week dialog, with the callouts burned into each PNG by
// scripts/_annotate-lib.mjs.
//
//   npm run dev                                             # port 3050
//   node scripts/capture-travel-equipment-screenshots.mjs
//
// LIGHT ONLY, DELIBERATELY — the admin components were never built against the
// `.dark` class variant, so there is no second rendering to capture.
//
// READ-ONLY against the dev clone: it opens a dialog and ticks boxes in the
// browser, and never submits. Refuses any project ref other than the dev clone.

import { readFileSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/travel-equipment"
const WIDTH = 1440
const DSF = 2

// "PROBE Travel Week — testyortago", assigned to testyortago@gmail.com, whose
// profile carries a 23-item gym. A subject with little equipment would make the
// control look like it does nothing.
const PROGRAM = "22d3ed57-4254-4c75-9ed8-eee8217236e4"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"],
              [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
  await page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll("button"))) {
      const s = getComputedStyle(b)
      if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
    }
  })
}

/** WARNS LOUDLY on both failure paths — a quietly defaulted marker points at nothing. */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  if ((await locator.count()) === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  // Park the pointer: Playwright's mouse stays where it last clicked, leaving a
  // stray hover state in the capture.
  await page.mouse.move(5, 5)
  await page.waitForTimeout(250)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1100 }, deviceScaleFactor: DSF })
  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    await page.goto(`${APP}/admin/programs/${PROGRAM}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(6000)

    // Open the real Generate Week dialog from the real program builder.
    await page
      .getByRole("button", { name: /Generate Week/i })
      .first()
      .click()
    await page.waitForTimeout(1500)

    const dialog = page.getByRole("dialog")
    const equipSwitch = dialog.locator("#equipment-override")

    // ── 1. Default: the control is present and OFF ─────────────────────────
    await shoot(
      page,
      "01-control-off-by-default",
      "The new control, switched off — nothing changes",
      "Generate Week · PROBE Travel Week — testyortago · the real admin program builder",
      [
        await markerOn(
          page,
          dialog.getByText("Limit equipment for this generation"),
          "The new switch sits under Coach Instructions. Left off, this generation behaves exactly as it always has: it uses the equipment saved on the client's profile.",
          { dx: -8 },
        ),
        await markerOn(
          page,
          dialog.locator("#equipment-override"),
          "Off is the default, so every generation you already run is untouched by this change.",
          { place: "center", dx: 40 },
        ),
      ],
    )

    // ── 2. Switched on: the client's real kit is pre-ticked ────────────────
    await equipSwitch.click()
    // Wait for the profile fetch to seed the ticks rather than a fixed guess.
    await dialog.getByText(/of 31 selected/).waitFor({ timeout: 10_000 })
    await page.waitForTimeout(600)
    await shoot(
      page,
      "02-switched-on-real-kit",
      "Switched on, it starts from what the client actually owns",
      "The 23 items on testyortago's profile are pre-ticked — read live from the client's questionnaire",
      [
        await markerOn(
          page,
          dialog.getByText(/of 31 selected/),
          "It reads the client's saved equipment and ticks it for you, so you start from the truth and remove what the hotel does not have.",
          { dx: -8 },
        ),
        await markerOn(
          page,
          dialog.getByRole("button", { name: "Barbell", exact: true }),
          "Every item is one tap. Filled means they can use it this week; hollow means they cannot.",
          { dx: -8 },
        ),
      ],
    )

    // ── 3. The hotel state: cleared down to nothing ────────────────────────
    await dialog.getByRole("button", { name: "Clear all" }).click()
    await page.waitForTimeout(600)
    await shoot(
      page,
      "03-hotel-nothing-available",
      "The hotel case — nothing selected means nothing at all",
      "This is the state that produces a genuine bodyweight week, and it says so before you spend anything",
      [
        await markerOn(
          page,
          dialog.getByText("Nothing selected — bodyweight only."),
          "An empty list is a real answer, not a missing one. The dialog says out loud what the week will be, before you spend anything on it.",
          { dx: -8 },
        ),
        await markerOn(
          page,
          dialog.getByRole("button", { name: "Clear all" }),
          '"Clear all" is one tap for the common case: a client in a hotel room with no gym at all.',
          { place: "center", dy: -26 },
        ),
      ],
    )

    // ── 4. A packed bag: a partial kit ─────────────────────────────────────
    await dialog.getByRole("button", { name: "Yoga Mat", exact: true }).click()
    await dialog.getByRole("button", { name: "Resistance Band", exact: true }).click()
    await page.waitForTimeout(600)
    await shoot(
      page,
      "04-packed-a-mat-and-a-band",
      "A packed bag — tick only what travelled with them",
      "Two items selected; the generated week used nothing else",
      [
        await markerOn(
          page,
          dialog.getByText(/2 of 31 selected/),
          "Tick back only what they packed. A live run with exactly these two produced 19 exercises that used a mat and a band and nothing else.",
          { dx: -8 },
        ),
        await markerOn(
          page,
          dialog.getByRole("button", { name: "Yoga Mat", exact: true }),
          "Filled: the two items that travelled with her. Everything else stays hollow and cannot be chosen.",
          { place: "center", dy: 30 },
        ),
      ],
    )

    console.log(`\nWrote ${OUT}/`)
  } finally {
    await ctx.close()
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
