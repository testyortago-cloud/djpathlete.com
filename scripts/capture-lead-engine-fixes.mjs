// scripts/capture-lead-engine-fixes.mjs
//
// Annotated evidence for the UI this branch adds, driven against the REAL
// admin on the dev clone. Never a harness, never a mockup: every shot below is
// the actual screen at the actual route.
//
//   node --env-file=.env.local scripts/capture-lead-engine-fixes.mjs <stage>
//
// Stages:
//   boards   /admin/pipeline — the board switcher (needs a tenant with >1 board;
//            the platform tenant has three since migration 00257)
//   sender   /admin/businesses/<id> — the sender-email refusal, driven by asking
//            Resend for the account's verified domains
//   deadend  the builder — "Publish funnel" refusing a page that leads nowhere
//   sms      /admin/sms/<phone> — the missing-Twilio-credentials notice. ONLY
//            renders when the deployment has no Twilio env, so run the dev
//            server with those three vars blanked first (see the README note).
//
// Admin UI is light-only (CLAUDE.md), so there is no dark pass to take.

import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { existsSync, readdirSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP_URL ?? "http://localhost:3050"
const OUT = "screenshots/lead-engine-fixes"
const WIDTH = 1440
const DSF = 2
const PLATFORM = "00000000-0000-0000-0000-000000000001"

const stage = process.argv[2]
if (!stage) throw new Error("usage: capture-lead-engine-fixes.mjs <boards|sender|deadend|sms>")
mkdirSync(OUT, { recursive: true })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (existsSync(exe)) return await chromium.launch({ executablePath: exe })
    }
    throw new Error("no chromium build available")
  }
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  if (!page.url().includes("/admin")) throw new Error(`dev-login did not reach /admin (at ${page.url()})`)
  await page.close()
}

// A marker's coordinates are RAW PIXELS in the captured image, so the CSS box
// has to be multiplied by the deviceScaleFactor. Warns loudly rather than
// degrading: a marker silently drawn at 100,100 is worse than a missing shot.
const seen = new Map()
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", key } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 70)}"`)
    return { x: 120, y: 120, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n}, using the first: "${caption.slice(0, 70)}"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 70)}"`)
    return { x: 120, y: 120, caption }
  }
  const id = key ?? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
  if (seen.has(id)) console.warn(`  !! TWO MARKERS RESOLVED TO THE SAME ELEMENT as "${seen.get(id).slice(0, 50)}"`)
  seen.set(id, caption)
  const cx =
    place === "center"
      ? box.x + box.width / 2
      : place === "right"
        ? box.x + box.width - 22
        : place === "after"
          ? box.x + box.width + 22
          : place === "inset"
            ? box.x + 24
            : box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((box.y + box.height / 2 + dy) * DSF), caption }
}

// Dev-only furniture is hidden from the RECORDER, never by editing app code:
// Next's error overlay and the floating Messages dock are not part of the
// feature and reading them as product would be wrong.
async function hideFloatingChrome(page) {
  await page
    .addStyleTag({ content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }` })
    .catch(() => {})
  await page
    .evaluate(() => {
      for (const b of Array.from(document.querySelectorAll("button"))) {
        const s = getComputedStyle(b)
        if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
      }
    })
    .catch(() => {})
}

// MUST RUN BEFORE ANY markerOn() CALL. Playwright's boundingBox() is
// VIEWPORT-relative, while a fullPage screenshot is DOCUMENT-sized — so a
// marker computed while the page is scrolled lands at the wrong height, and
// on a long form it lands off the top of the page entirely. Scrolling to the
// top first makes the two coordinate spaces agree. (Resetting inside shoot()
// is too late: the marker arguments are evaluated before the call.)
async function resetScroll(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.waitForTimeout(250)
}

// The pointer is parked before every capture: Playwright leaves the mouse
// where it last clicked, and a hovered control reads as a styling bug.
async function shoot(page, name, title, subtitle, markers, { fullPage = false } = {}) {
  await hideFloatingChrome(page)
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.mouse.move(4, 4)
  await page.waitForTimeout(250)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
  await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  // Per shot, not per run: the duplicate-target warning exists to catch two
  // markers pointing at one element in the SAME image, and a run-long map
  // turns every repeat of a persistent element (the page heading) into a
  // false positive that would mask a real collision.
  seen.clear()
  console.log(`  ${name}.png`)
}

const browser = await launchChromium()
try {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })
  await signInAsAdmin(ctx)
  // The dev tenant default is NOT the platform business, and the platform is
  // the only tenant on this clone with more than one board.
  await ctx.addCookies([{ name: "djp_business", value: PLATFORM, url: APP }])
  const page = await ctx.newPage()

  if (stage === "boards") {
    await page.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    const nav = page.getByRole("navigation", { name: "Pipeline boards" })
    await nav.waitFor({ timeout: 10000 })
    await resetScroll(page)
    await shoot(
      page,
      "01-pipeline-board-switcher",
      "The Pipeline screen now names every board this coach has",
      "Before this change the screen always showed Coaching, and cards routed to the other boards could not be seen at all.",
      [
        await markerOn(page, nav, "One button per board. Clicking one shows that board's cards.", { place: "after", dx: 26 }),
        await markerOn(page, nav.getByRole("link", { name: "Coaching" }), "The board you are looking at is filled in.", {
          place: "center",
          dy: 36,
        }),
        await markerOn(page, page.getByRole("heading", { level: 1 }), "The heading and the wording below it name the same board.", {
          place: "left",
          dx: -4,
        }),
      ],
    )

    await page.getByRole("link", { name: "Camps & Clinics" }).click()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(800)
    await resetScroll(page)
    await shoot(
      page,
      "02-pipeline-camps-board",
      "Clicking 'Camps & Clinics' opens that board",
      "The address bar keeps ?board=camps_clinics, so this view can be bookmarked and shared.",
      [
        await markerOn(page, page.getByRole("link", { name: "Camps & Clinics" }), "Now filled in — this is the board on screen.", {
          place: "center",
          dy: 36,
        }),
        await markerOn(page, page.getByRole("heading", { level: 1 }), "A camp sign-up opens its card here, not on Coaching.", {
          place: "left",
          dx: -4,
        }),
      ],
    )
  }

  if (stage === "sender") {
    const { data: biz } = await db.from("businesses").select("id, name").eq("id", PLATFORM).single()
    await page.goto(`${APP}/admin/businesses/${biz.id}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(900)
    const field = page.locator("#sender_email")
    await field.waitFor({ timeout: 10000 })
    const original = await field.inputValue()
    console.log(`  sender_email currently: ${original}`)
    // The exact address that broke sending on 2026-08-31: the apex, which
    // Resend has never verified. Typed into the real form, saved for real.
    await field.fill("noreply@darrenjpaul.com")
    await page.getByRole("button", { name: /save/i }).first().click()
    await page.waitForTimeout(3000)
    await resetScroll(page)
    // The inline banner, NOT the toast: both carry the same sentence, and
    // `.first()` across the whole page can resolve to either.
    const banner = page.locator('[role="alert"]').filter({ hasText: /not verified/i }).first()
    await shoot(
      page,
      "03-sender-email-refused",
      "An email address on an unverified domain is now refused, and says why",
      "Sending from this address is what silently dropped 73 emails on 31 August. The form now checks the address with the email provider before saving it.",
      [
        // OUTSIDE the banner: an inset disc covers the first word of the one
        // sentence this shot exists to show.
        await markerOn(page, banner, "The refusal names the domain that failed and the one to use instead.", { place: "left" }),
        await markerOn(page, field, "The address that was typed. Nothing was saved.", { place: "after", dx: 28 }),
      ],
      { fullPage: true },
    )
    // Put the field back to what it was. The refusal means nothing was saved,
    // but the box still holds the typed text until the page is reloaded.
    await field.fill(original)
    console.log(`  restored the field to: ${original}`)
  }

  if (stage === "deadend") {
    const { data: f } = await db
      .from("funnels")
      .select("id, slug, name")
      .eq("slug", "off-season-speed-camp-rx0f")
      .maybeSingle()
    if (!f) throw new Error("expected the verification funnel off-season-speed-camp-rx0f on this clone")
    const { data: steps } = await db
      .from("funnel_steps")
      .select("id, slug, position")
      .eq("funnel_id", f.id)
      .order("position")
    const entry = steps[0]
    await page.goto(`${APP}/admin/funnels/${f.id}/edit/${entry.id}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(2500)

    // The page was ALREADY made a dead end before this stage ran: its form's
    // "After submit" is back on "Show a message", so nothing on it opens the
    // thank-you page. Driving that change through the builder's own inspector
    // needs a click inside the canvas iframe that would not reliably resolve
    // here, so the draft was edited directly on the dev clone — see the review
    // sheet. Everything below IS the real screen: the real rail, the real
    // "Publish funnel" button, and the real refusal it returns.
    const rail = page.locator("text=leads nowhere").first()
    await shoot(
      page,
      "04-builder-leads-nowhere",
      "The builder says the signup page now leads nowhere",
      "The form was switched back to showing a message, so nothing on this page opens the thank-you page.",
      [await markerOn(page, rail, "'leads nowhere' — this page is a dead end.", { place: "after", dx: 26 })],
    )

    await page.getByRole("button", { name: "Publish funnel" }).click()
    await page.waitForTimeout(4000)
    await shoot(
      page,
      "05-publish-refused-dead-end",
      "'Publish funnel' now refuses, and names the page at fault",
      "Before this change the button published anyway, and the visitor who filled the form landed on a 'Page not found'.",
      [
        // OUTSIDE the bullet: an inset disc covers the sentence itself.
        await markerOn(page, page.locator("text=/leads nowhere/i").last(), "The refusal names the page and says what to do about it.", {
          place: "left",
        }),
      ],
      { fullPage: true },
    )
  }

  if (stage === "sms") {
    const { data: row } = await db.from("sms_messages").select("phone").limit(1).maybeSingle()
    if (!row) throw new Error("no sms_messages row on this clone to open a thread for")
    await page.goto(`${APP}/admin/sms/${encodeURIComponent(row.phone)}`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200)
    const notice = page.locator("text=/Twilio credentials/i").first()
    if ((await notice.count()) === 0) {
      throw new Error(
        "the missing-credentials notice is not on screen — this stage needs the dev server started with TWILIO_ACCOUNT_SID, TWILIO_MAIN_SID and TWILIO_CLIENT_SECRET blank",
      )
    }
    await shoot(
      page,
      "06-sms-env-missing",
      "A text conversation says plainly when the server cannot send",
      "Before this change the box looked ready and the send failed afterwards with an error code and no explanation.",
      [
        // OUTSIDE the notice: an inset disc covers the sentence itself.
        await markerOn(page, notice, "Names the missing setup instead of failing after you press Send.", { place: "left" }),
      ],
      { fullPage: true },
    )
  }

  await page.close()
} finally {
  await browser.close()
}
