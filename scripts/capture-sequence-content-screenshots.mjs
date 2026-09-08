// Drives the REAL app and captures /admin/sequences and /admin/sequences/[key]
// after migration 00255 (three new sequences seeded as draft, four quiz_*
// sequences rewritten to 8 steps and set to paused), with the callouts burned
// into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev                                                   # port 3050
//   node scripts/capture-sequence-content-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page. The rows and counts on screen are
// real `sequences`/`sequence_steps` rows already on the dev clone, applied by
// migration 00255 and verified in task-7a (twelve sequences: three new drafts,
// four quiz_* paused at 8 steps, abandoned_checkout with 8 steps/1 branch/1
// config step).
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to
// choices[0] with no cookie, and on this dev clone that is the seeded test
// business "Northcrest Barbell 10E", which has no sequences at all. Every
// shot here must run against "Primary" (00000000-0000-0000-0000-000000000001)
// or the report is a wall of zeros that looks like a broken feature.
//
// LIGHT ONLY, DELIBERATELY. The admin components were never built against the
// `.dark` class variant — forcing it breaks existing pages — so there is no
// second rendering to capture. This is not an omission.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/sequence-content"
const WIDTH = 1440
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

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
  await page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll("button"))) {
      const s = getComputedStyle(b)
      if (s.position === "fixed" && b.textContent?.trim() === "Messages") b.style.display = "none"
    }
  })
}

/**
 * The rendered extent of an element's TEXT, not the element's own box.
 *
 * boundingBox() on a block-level element (a <p>, a <td>) returns the box of
 * the BLOCK, which stretches to the width of its container regardless of how
 * short the text inside it is — measured directly on "8 steps" here: a
 * left-aligned six-character string inside a full-width <p> reported
 * width:1136. "after" on that box lands 22px past the FAR edge of the
 * container, nowhere near the visible word — it took a debug script printing
 * the raw rect to catch, since markerOn() itself saw a normal, non-empty box
 * and had nothing to warn about. A DOM Range around the element's own
 * contents gives the true glyph extent instead.
 */
async function textBox(locator) {
  const handle = await locator.first().elementHandle()
  if (!handle) return null
  return handle.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = Array.from(range.getClientRects())
    if (rects.length === 0) return null
    const x0 = Math.min(...rects.map((r) => r.x))
    const y0 = Math.min(...rects.map((r) => r.y))
    const x1 = Math.max(...rects.map((r) => r.x + r.width))
    const y1 = Math.max(...rects.map((r) => r.y + r.height))
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  })
}

/**
 * Marker positioned on a real element, converted from CSS px to the raw pixel
 * space annotate() draws in.
 *
 * WARNS LOUDLY rather than degrading politely — a helper that quietly returns
 * a default turns a misplaced callout into a silent no-op, and the reviewer
 * reads a caption pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", tight = false } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) {
    console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  }
  const box = tight ? await textBox(locator) : await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
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

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage: true })
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

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)

  // CRITICAL — set the business cookie BEFORE navigating anywhere that reads
  // the tenant. Without it resolveAdminTenant() lands on choices[0], which on
  // this dev clone is "Northcrest Barbell 10E" — a seeded test business with
  // no sequences at all.
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()

  // ---------------------------------------------------------------- 01 list
  await page.goto(`${APP}/admin/sequences`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const rowCount = await page.locator("tbody tr").count()
  const emptyState = await page.getByText("No sequences have been set up yet.").count()
  console.log(`  list: rows=${rowCount} empty-state=${emptyState}`)
  if (rowCount !== 12 || emptyState > 0) {
    throw new Error(
      `expected 12 sequence rows on Primary (migration 00255 applied), got rows=${rowCount} empty-state=${emptyState} — the tenant cookie did not take, or the migration is not on this env`,
    )
  }

  const abandonedRow = page.locator("tbody tr", { hasText: "Abandoned checkout" })
  const serviceRow = page.locator("tbody tr", { hasText: "Service application received" })
  const campRow = page.locator("tbody tr", { hasText: "Camp or clinic deadline" })
  const rebuilderRow = page.locator("tbody tr", { hasText: "Quiz — Rebuilder" })
  const aspiringRow = page.locator("tbody tr", { hasText: "Quiz — Aspiring Pro" })
  const ceilingRow = page.locator("tbody tr", { hasText: "Quiz — Ceiling Breaker" })
  const parentRow = page.locator("tbody tr", { hasText: "Quiz — Parent or Coach" })

  console.log(
    `  rows found: abandoned=${await abandonedRow.count()} service=${await serviceRow.count()} camp=${await campRow.count()} rebuilder=${await rebuilderRow.count()} aspiring=${await aspiringRow.count()} ceiling=${await ceilingRow.count()} parent=${await parentRow.count()}`,
  )

  // Every marker below targets the LAST element on its own row's status line
  // ("after" lands past that element's own right edge, in space that is
  // genuinely empty because nothing else follows it on that line). Pointing
  // "after" at a BADGE instead, when explanation text sits right next to it
  // with only an 8px gap, lands the marker ON TOP of that text instead of
  // past it — measured and discarded during review of the first draft of this
  // script, which put five of seven markers on the wrong row or mid-word.
  const rebuilderBadge = rebuilderRow.locator("span", { hasText: "Paused" }) // no explanation text follows it — entered=1 suppresses whyEmpty()
  const abandonedExplanation = abandonedRow.getByText("Not switched on yet.")
  const serviceExplanation = serviceRow.getByText("Not switched on yet.")
  const campExplanation = campRow.getByText("Not switched on yet.")
  const aspiringExplanation = aspiringRow.getByText("Paused, so nobody new is being added.")
  const ceilingExplanation = ceilingRow.getByText("Paused, so nobody new is being added.")
  const parentExplanation = parentRow.getByText("Paused, so nobody new is being added.")

  await shoot(
    page,
    "01-twelve-sequences-three-new-four-rewritten",
    "Three brand-new follow-ups, and four rewritten from a single email into a real series",
    "/admin/sequences",
    [
      await markerOn(
        page,
        abandonedExplanation,
        "New. Somebody leaves a checkout without paying, and this follows up automatically once it is switched on.",
        { place: "after" },
      ),
      await markerOn(
        page,
        serviceExplanation,
        "New. Fires when someone applies for coaching, so the office isn't the only thing that notices.",
        { place: "after" },
      ),
      await markerOn(page, campExplanation, "New. All three new sequences start switched off — nobody enters until a person reads the copy and turns them on.", {
        place: "after",
      }),
      await markerOn(
        page,
        rebuilderBadge,
        "This one used to be a single email. It's now an 8-step series, paused on purpose until someone reads the new copy — the same is true for all four quiz results.",
        { place: "after" },
      ),
      await markerOn(page, aspiringExplanation, "Rewritten too, same as the other three quiz results.", { place: "after" }),
      await markerOn(page, ceilingExplanation, "Rewritten too, same as the other three quiz results.", { place: "after" }),
      await markerOn(page, parentExplanation, "Rewritten too, same as the other three quiz results.", { place: "after" }),
    ],
  )

  // ------------------------------------------------ 02 abandoned_checkout detail
  await page.goto(`${APP}/admin/sequences/abandoned_checkout`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const stepText = page.getByText(/^8 steps$/)
  const enteredTile = page.locator("div.rounded-xl.border.border-border.bg-white.p-4.shadow-sm").first()
  const emptyRunsRow = page.getByText("Nobody has entered this sequence yet.")
  console.log(
    `  detail(abandoned_checkout): steps=${await stepText.count()} enteredTile=${await enteredTile.count()} emptyRunsRow=${await emptyRunsRow.count()}`,
  )

  await shoot(
    page,
    "02-abandoned-checkout-branch-tag-sms",
    "The one with a branch, a tag step and a text message",
    "/admin/sequences/abandoned_checkout",
    [
      await markerOn(
        page,
        stepText,
        "8 steps: one of them checks whether this person has agreed to texts, and only sends the SMS reminder if they have. Everyone else gets email only.",
        // "8 steps" renders inside a block-level <p> that stretches to the
        // full content width, so boundingBox() is nowhere near the visible
        // glyphs — tight:true measures the actual text extent instead. See
        // textBox() above.
        { place: "after", tight: true },
      ),
      await markerOn(page, enteredTile, "Zero so far — this sequence is still a draft, so nobody has been added to it yet.", {
        place: "center",
        dy: -14,
      }),
      await markerOn(
        page,
        emptyRunsRow,
        "Not broken — genuinely nobody yet. It starts filling in once the sequence is switched on and the Stripe webhook for an abandoned checkout is confirmed.",
        // getByText() here matches the <td> (DataTableEmpty), whose own box
        // includes its py-12 padding — "center", dy: -20 measured the disc's
        // clearance against that padded box and put it on the text itself,
        // covering part of "entered". tight:true swaps in the real text
        // line's own box, and "left" sits in the wide blank gutter before
        // the (table-centered) sentence rather than guessing a vertical
        // offset large enough to clear a line whose true height was never
        // measured.
        { place: "left", dx: -10, tight: true },
      ),
    ],
  )

  // --------------------------------------------------- 03 quiz_rebuilder detail
  await page.goto(`${APP}/admin/sequences/quiz_rebuilder`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const rebuilderStepText = page.getByText(/^8 steps$/)
  const enteredTile2 = page.locator("div.rounded-xl.border.border-border.bg-white.p-4.shadow-sm").first()
  const optedOutBadge = page.locator("span").filter({ hasText: /^Opted out$/ })
  console.log(
    `  detail(quiz_rebuilder): steps=${await rebuilderStepText.count()} enteredTile=${await enteredTile2.count()} optedOutBadge=${await optedOutBadge.count()}`,
  )

  await shoot(
    page,
    "03-quiz-rebuilder-one-email-to-eight-steps",
    "Quiz — Rebuilder: the same real person, now inside an 8-step series instead of one email",
    "/admin/sequences/quiz_rebuilder",
    [
      await markerOn(
        page,
        rebuilderStepText,
        "This used to say 1 step. The whole quiz-result series was rewritten, including a branch partway through for whether the person has an account yet.",
        { place: "after", tight: true }, // see the note on stepText above — same block-level <p>
      ),
      await markerOn(
        page,
        enteredTile2,
        "This person's history carried over untouched — rewriting the sequence's steps doesn't erase who already went through it.",
        { place: "center", dy: -14 },
      ),
    ],
  )

  console.log("\ndone.")
} finally {
  await ctx.close()
  await browser.close()
}
