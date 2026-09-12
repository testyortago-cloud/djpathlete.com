// Drives the REAL app and captures the two-way SMS screens — /admin/sms, the
// conversation at /admin/sms/[phone], and the "Text" action on the contact
// record — with the callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   node scripts/seed-sms-thread-dev.mjs
//   npm run dev > /tmp/dev.log 2>&1 &        # port 3050
//   node scripts/capture-two-way-sms-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page: the sidebar, the header and the
// spacing in these files are the product's own.
//
// NOTHING IS EVER SENT. The only control here that can put a text on a wire is
// the composer's Send button, and the one place this script clicks it is
// during quiet hours — where the FIRST click is defined to warn and return
// without sending (SmsComposer.tsx, decision 1). The second click never
// happens. Shot 04's Send is disabled by the suppression and is never clicked
// at all. No POST to /api/admin/sms/send is made by this script.
//
// TENANT COOKIE IS LOAD-BEARING. resolveAdminTenant() falls back to
// choices[0] with no cookie, and for an operator that list is every business
// ordered by name — on this clone, "Northcrest Barbell 10E", which has no
// texts at all. An empty screen would read exactly like a broken tenant
// predicate. Every shot runs against "Primary".
//
// LIGHT ONLY, DELIBERATELY. The admin UI was never built against `.dark`;
// forcing it breaks existing pages. There is no dark capture to take.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.

import { mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/two-way-sms"
const WIDTH = 1440
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const PRIMARY_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
const TALKING = "+12025550123"
const STOPPED = "+13105550198"
const DANA_ID = "5b5c0000-0000-4000-8000-000000000101"

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

/** Framework overlays and floating docks are not part of the product. */
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

/** The rendered extent of an element's TEXT, not its box — for inline spans in a wide flex row. */
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
 * Marker positioned on a real element. WARNS LOUDLY rather than degrading
 * politely: a helper that quietly falls back turns a broken annotation into a
 * silent no-op, and the PNG then points at nothing while looking fine.
 *
 * `seen` catches the other half of that failure — two captions resolving to
 * the SAME element, which reads as one marker with two meanings.
 */
const seen = new Map()
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", tight = false, key } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) {
    console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 70)}…"`)
  }
  const box = tight ? await textBox(locator) : await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 70)}…"`)
    return { x: 100, y: 100, caption }
  }
  const id = key ?? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
  if (seen.has(id)) {
    console.warn(`  !! TWO MARKERS RESOLVED TO THE SAME ELEMENT as "${seen.get(id).slice(0, 50)}…"`)
  }
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

/**
 * fullPage screenshots scroll to the top before capturing, so every marker
 * must be measured from that same scrollTop:0 frame — Playwright's own
 * actionability scrolling during .fill()/.click() otherwise leaves the
 * document somewhere else and boundingBox() returns coordinates for a
 * different origin than the image has.
 */
async function resetScroll(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }))
  await page.waitForTimeout(200)
}

async function shoot(page, name, title, subtitle, markers) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  await page.mouse.move(4, 4) // park the pointer — a hovered control reads as a styling bug
  await page.waitForTimeout(150)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage: true })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
  seen.clear()
}

async function signInAsAdmin(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)
  // ASSERT THE SESSION FIRST. A dev-login that silently did not take shows up
  // later as an empty feature screen, which mimics the scariest real bug here.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await page.close()
}

const browser = await launchChromium()
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: DSF })

try {
  await signInAsAdmin(ctx)
  await ctx.addCookies([{ name: "djp_business", value: PRIMARY_BUSINESS_ID, url: APP }])

  const page = await ctx.newPage()

  // ------------------------------------------------------------- 01 the list
  await page.goto(`${APP}/admin/sms`, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)

  const rows = await page.locator("tbody tr").count()
  console.log(`  thread list rows=${rows}`)
  if (rows !== 3) {
    throw new Error(
      `expected 3 thread rows on Primary, got ${rows} — the tenant cookie did not take, or the seed did not run`,
    )
  }

  const danaLink = page.getByRole("link", { name: "Dana Okafor", exact: true })
  const danaFailed = page.locator("tbody tr", { hasText: "Dana Okafor" }).getByText("failed", { exact: true })
  const stranger = page.getByText("Not in your contacts", { exact: true })

  await resetScroll(page)
  await shoot(page, "01-thread-list", "Every text conversation, newest first", "/admin/sms", [
    await markerOn(page, danaLink, "One row per phone number. Click the name to open the conversation.", {
      place: "left",
      tight: true,
    }),
    await markerOn(
      page,
      danaFailed,
      'The last text to Dana says "failed" — you can see a text did not arrive without opening it.',
      { place: "after" },
    ),
    await markerOn(
      page,
      stranger,
      "A text from a number you have never saved still gets its own conversation, listed by the number.",
      { place: "left", tight: true },
    ),
  ])

  // ----------------------------------------------------- 02 the conversation
  await page.goto(`${APP}/admin/sms/${encodeURIComponent(TALKING)}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)

  const bubbles = await page.locator("p.whitespace-pre-wrap").count()
  console.log(`  conversation bubbles=${bubbles}`)
  if (bubbles !== 6) throw new Error(`expected 6 texts in Dana's conversation, got ${bubbles}`)

  const theirs = page.getByText("I've been stuck at 205 since May", { exact: false })
  const deliveredStates = page.getByText("delivered", { exact: true })
  const lastDelivered = deliveredStates.nth((await deliveredStates.count()) - 1)
  const failedState = page.getByText("failed (30006)", { exact: true })

  await resetScroll(page)
  await shoot(
    page,
    "02-conversation",
    "One conversation — theirs on the left, yours on the right",
    `/admin/sms/${TALKING} · times shown in the business's own timezone`,
    [
      await markerOn(page, theirs, "What Dana sent you. Their texts sit on the left, like the phone in your pocket.", {
        place: "left",
      }),
      await markerOn(
        page,
        lastDelivered,
        'Every text you send carries what happened to it. "delivered" means it reached her handset.',
        { place: "after", tight: true },
      ),
      await markerOn(
        page,
        failedState,
        "This one never arrived. 30006 is the phone company saying the number could not be reached — without this line it would look exactly like a text she ignored.",
        { place: "after", tight: true },
      ),
    ],
  )

  // --------------------------------------------------- 03 the compose box
  const draft = "Great work today Dana 💪 Hold the brace at the bottom on Thursday and we will re-test the squat."
  const box = page.locator("#sms-compose-body")
  await box.waitFor({ state: "visible" })
  await box.fill(draft)
  await page.waitForTimeout(300)

  const counter = page.getByText(/characters · \d+ segments?/)
  const counterText = await counter.first().innerText()
  const ucs2 = page.getByText(/switched this to UCS-2/)
  console.log(`  compose counter: "${counterText}"  ucs2Note=${await ucs2.count()}`)
  if ((await ucs2.count()) !== 1) throw new Error("the UCS-2 note did not appear — the draft has no emoji in it")
  if (!/2 segments/.test(counterText)) {
    throw new Error(`expected the draft to need 2 segments, counter says "${counterText}"`)
  }

  await resetScroll(page)
  await shoot(
    page,
    "03-compose-segments",
    "The box counts what a text will cost you as you type",
    `/admin/sms/${TALKING} · a draft with one emoji in it`,
    [
      await markerOn(page, box, "Write the text here. Nothing is sent until you press the button below.", {
        place: "left",
      }),
      await markerOn(
        page,
        counter,
        'The running count. Phone companies bill per "segment", so this is how many texts you are actually paying for.',
        { place: "after", tight: true },
      ),
      await markerOn(
        page,
        ucs2,
        "One emoji changes the alphabet the phone network uses, and the room per text shrinks. That is why this short message costs two texts, not one.",
        { place: "after", tight: true },
      ),
    ],
  )

  // ------------------------------------------------- 05 quiet-hours warning
  // Captured on the same page and BEFORE navigating away. The first click
  // warns and returns without sending; the second one is never made.
  const sendButton = page.getByRole("button", { name: "Send", exact: true })
  await sendButton.waitFor({ state: "visible" })
  await page.waitForTimeout(900) // hydration — a button clicked too early has no handler attached
  await sendButton.click()
  await page.waitForTimeout(400)

  const quietWarning = page.getByText(/That is late for a text/)
  if ((await quietWarning.count()) !== 1) {
    throw new Error(
      "the quiet-hours warning did not appear — it is inside the sending window where the contact is. " +
        "Re-run scripts/seed-sms-thread-dev.mjs to re-pick the contact's timezone, then capture again.",
    )
  }
  const sendAnyway = page.getByRole("button", { name: "Send anyway", exact: true })
  const notNow = page.getByRole("button", { name: "Not now", exact: true })

  await resetScroll(page)
  await shoot(
    page,
    "05-quiet-hours-warning",
    "Late where they are? The first press asks, it does not send",
    `/admin/sms/${TALKING} · after pressing Send once`,
    [
      await markerOn(
        page,
        quietWarning,
        "It reads the clock where Dana is, not where you are, and names her timezone so you can check.",
        { place: "left", dx: -40 },
      ),
      await markerOn(
        page,
        sendAnyway,
        'The button changed its words. Press "Send anyway" and it goes — you know things this box does not.',
        { place: "left" },
      ),
      await markerOn(page, notNow, 'Or back out. "Not now" leaves your words in the box for the morning.', {
        place: "after",
      }),
    ],
  )

  // --------------------------------------------------- 04 the refusal state
  await page.goto(`${APP}/admin/sms/${encodeURIComponent(STOPPED)}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)

  const optedOut = page.getByText(/has opted out of texts from you/)
  const stopBubble = page.getByText("STOP", { exact: true })
  const disabledSend = page.getByRole("button", { name: "Send", exact: true })
  console.log(`  refusal: banner=${await optedOut.count()} stopBubble=${await stopBubble.count()}`)
  if ((await optedOut.count()) !== 1) throw new Error("the opted-out banner is missing — is the suppression row there?")
  if (!(await disabledSend.isDisabled())) throw new Error("the Send button is NOT disabled on a suppressed number")
  if (!(await page.locator("#sms-compose-body").isDisabled())) throw new Error("the compose box is NOT disabled")

  await resetScroll(page)
  await shoot(
    page,
    "04-suppressed-refusal",
    "Someone who texted STOP cannot be texted again",
    `/admin/sms/${STOPPED} · the compose box switched off, with the reason`,
    [
      await markerOn(page, stopBubble, 'Marcus texted the word "STOP". That is all it takes.', { place: "left" }),
      await markerOn(
        page,
        optedOut,
        "The box says who, and says how they can come back: they text START themselves. You cannot do it for them.",
        { place: "left" },
      ),
      await markerOn(
        page,
        disabledSend,
        "Greyed out, and the typing box with it. The app refuses this again on the way out, so it cannot be clicked past.",
        { place: "after" },
      ),
    ],
  )

  // ------------------------------------------------ 06 the contact's record
  await page.goto(`${APP}/admin/contacts/${DANA_ID}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)

  const textAction = page.getByRole("link", { name: "Text", exact: true })
  const phoneLink = page.getByRole("link", { name: TALKING, exact: true })
  const agreed = page.getByText("Agreed to receive text messages", { exact: true })
  console.log(
    `  contact record: textAction=${await textAction.count()} phone=${await phoneLink.count()} consent=${await agreed.count()}`,
  )
  if ((await textAction.count()) !== 1) throw new Error('the "Text" action is missing from the contact record')
  const href = await textAction.getAttribute("href")
  if (href !== `/admin/sms/${encodeURIComponent(TALKING)}`) {
    throw new Error(`the Text action points at ${href}, not at Dana's conversation`)
  }

  await resetScroll(page)
  await shoot(
    page,
    "06-contact-text-link",
    'Every person with a number now has a "Text" button on their record',
    `/admin/contacts/${DANA_ID}`,
    [
      await markerOn(
        page,
        textAction,
        "Press it and you land in the conversation with this person. Nothing to look up.",
        {
          place: "left",
        },
      ),
      // Deliberately to the LEFT of the number, over the decorative phone
      // icon: to the right of it sits "Added <date>" with a 16px gap, and a
      // disc placed there covers a word.
      await markerOn(page, phoneLink, "It only shows up when there is a number on file to text.", {
        place: "left",
        tight: true,
      }),
      await markerOn(
        page,
        agreed,
        "Her history says she agreed to be texted, and when. That is the record you want if anyone ever asks.",
        { place: "left", tight: true },
      ),
    ],
  )

  console.log("\ndone")
} finally {
  await ctx.close()
  await browser.close()
}
