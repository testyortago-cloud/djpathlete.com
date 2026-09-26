// G35: a coach's business sees none of the platform's untenanted content,
// captured on the real routes of the real running app.
//
//   npx next dev --port 3064 > <scratchpad>/g35-dev.log 2>&1 &
//   APP=http://localhost:3064 node scripts/capture-g35-untenanted-screenshots.mjs
//
// FOUR SHOTS, TWO PAIRS. Each pair is ONE screen, once for a coach's business
// ("Trailhead Strength & Conditioning") and once for the platform's own
// ("Primary"). The platform shot is the control: without it, "nothing is shown"
// on the coach's shot passes just as well for a page that failed to load.
//   01 / 02  the public "Ask a question" page (/ask). One real visitor question,
//            answered by the real assistant, one real model call each.
//   03 / 04  the full-screen draft preview (/preview/<slug>) of a page whose
//            questions section is set to "Live" (the platform's FAQ list).
//
// HOW THE COACH'S WEB ADDRESS IS REACHED. Every public request carries
// `x-forwarded-host: phase4-coach.test`, a host business_domains maps to
// Trailhead, on a localhost URL. It is the header lib/tenancy/public.ts reads
// FIRST, and the one Vercel sets from the real request in production, so the
// server takes the same path it takes for a visitor on the coach's own domain.
// The obvious alternative does not work: pointing the browser at
// http://phase4-coach.test:3064 (--host-resolver-rules) loads the HTML, but the
// app's CSP carries `upgrade-insecure-requests`, Chromium exempts only
// localhost from it, so every script and stylesheet is rewritten to https and
// fails with ERR_SSL_PROTOCOL_ERROR. The page never hydrates and the chat never
// answers. --unsafely-treat-insecure-origin-as-secure does not exempt it either
// (both tried 2026-09-26). The platform control sends
// `x-forwarded-host: www.darrenjpaul.com`, which a business_domains row maps to
// Primary, rather than relying on "localhost" falling through to it.
//
// WHAT IT WRITES. Dev clone only; it refuses any other project ref outright.
//   * TWO DRAFT LANDING PAGES, created here and DELETED in `finally` (the
//     failure path too), then re-read to prove they are gone. One `funnels` row
//     plus one `funnel_steps` row each; deleting the funnel cascades the step.
//     One is owned by Trailhead, one by Primary, and both hold the same
//     document: a hero and a questions section set to "Live". Nothing else can
//     put that section on screen: no funnel on the dev clone has a live FAQ
//     section (checked 2026-09-26), so the coach's page AND its control both
//     need a subject. Never published, never visible outside the preview.
//   * EACH CHAT QUESTION IS A REAL VISIT, so the app writes what it writes for
//     any visitor: one chat_conversations row and its chat_messages rows (and
//     escalated_at, if the assistant hands the visitor to a person; no email
//     can leave, because reply_to is empty for every business on the dev
//     clone). Those rows are the evidence this script reads back, so they are
//     kept, and their ids are printed.
//   Analytics requests (Google tag, Analytics, DoubleClick) are aborted, so
//   capture traffic never reaches the real analytics property. They draw
//   nothing on screen.
//
// LIGHT ONLY. The admin surface has no working dark mode, and the draft
// preview is an admin screen. The two /ask shots are light for the same pair to
// compare like with like.
//
// NO FIXTURE TEXT ON CAMERA. The draft's copy is written as a real coach's page
// would be. Any client the platform's answer names in shot 02 is one of the
// platform's own published testimonials, the same ones its public site shows.
//
// THE CAPTIONS ARE CHECKED, NOT ASSUMED. The model words its answer
// differently every run, so each chat caption is either backed by an assertion
// (what the server recorded, what is on screen) or added only when its
// condition holds.

import { mkdirSync, readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { chromium } from "playwright"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3064"
const OUT = "screenshots/g35-untenanted-readers"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const PRIMARY = "00000000-0000-0000-0000-000000000001"
const TRAILHEAD = "82d5b238-1653-4a04-9d2d-2f65e5a8c225"
const COACH_HOST = "phase4-coach.test"
const PLATFORM_HOST = "www.darrenjpaul.com"
const QUESTION = "What do your clients say about you?"

// ONLY=chat or ONLY=preview retakes one pair. The chat is limited to five new
// conversations an hour per origin, and every local run is one origin, so a
// preview retake should not spend two of them.
const ONLY = process.env.ONLY ?? "all"
if (!["all", "chat", "preview"].includes(ONLY)) throw new Error(`ONLY must be chat or preview, not ${ONLY}`)

const STAMP = String(Date.now()).slice(-6)
const COACH_SLUG = `g35-live-faq-coach-${STAMP}`
const PLATFORM_SLUG = `g35-live-faq-platform-${STAMP}`

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_REF)) {
  console.error(`REFUSING TO RUN: .env.local does not point at the dev clone (${DEV_REF}).`)
  process.exit(1)
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

mkdirSync(OUT, { recursive: true })

function must(condition, message) {
  if (!condition) throw new Error(message)
}

// ---------------------------------------------------------------------------
// The draft both preview shots render. Validated by the app itself: a document
// its schema refused would preview as "This page can't be previewed", which
// the preview step below checks for.
// ---------------------------------------------------------------------------
const DOC = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [
    {
      id: "intro",
      kind: "hero",
      variant: "centered",
      style: { pad: "normal", align: "center", headline: "lg" },
      props: {
        eyebrow: "Off-season strength",
        headline: "Get stronger before race season",
        sub: "Two coached sessions a week for eight weeks, built around your running. The common questions are answered below.",
        primaryCta: { label: "Read the questions", target: { kind: "anchor", sectionId: "questions" } },
      },
    },
    {
      id: "questions",
      kind: "faq",
      variant: "stack",
      style: { pad: "roomy", tone: "muted", align: "left", headline: "md" },
      props: { heading: "Questions, answered", source: "live", pageKey: "faq" },
    },
  ],
}

async function createDraft(businessId, slug) {
  const { data: funnel, error } = await db
    .from("funnels")
    .insert({
      business_id: businessId,
      slug,
      name: "Off-Season Strength",
      kind: "page",
      goal: "leads",
      status: "draft",
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create the draft ${slug}: ${error.message}`)
  const { error: stepError } = await db.from("funnel_steps").insert({
    business_id: businessId,
    funnel_id: funnel.id,
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
    project_data: DOC,
  })
  if (stepError) throw new Error(`could not create the draft's page ${slug}: ${stepError.message}`)
  console.log(`   created draft ${slug} (${funnel.id}) owned by ${businessId}`)
  return funnel.id
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

/** A marker anchored to a real element. Warns loudly on every failure path. */
async function markerOn(locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx = box.x - 22
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  if (place === "top-left") cy = box.y + 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

/**
 * A marker just past the END of an element's text, on its last line. For a
 * full-width block (a banner line, a heading) the element's own box starts at
 * the page edge, so "left of the box" parks the disc on top of the first
 * letters. The text's own extent comes from a Range over its contents.
 */
async function markerAfterText(locator, caption, { gap = 28 } = {}) {
  const n = await locator.count()
  if (n !== 1) {
    console.warn(`  !! TEXT MARKER TARGET MATCHED ${n} ELEMENTS: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const last = await locator.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0)
    const r = rects[rects.length - 1]
    return r ? { right: r.right, top: r.top, height: r.height } : null
  })
  if (!last) {
    console.warn(`  !! TEXT MARKER TARGET HAS NO TEXT BOX: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  return { x: Math.round((last.right + gap) * DSF), y: Math.round((last.top + last.height / 2) * DSF), caption }
}

async function hideDevChrome(page) {
  await page.addStyleTag({
    content: "html { scroll-behavior: auto !important } nextjs-portal { display: none !important }",
  })
}

/**
 * Markers are built by a callback invoked HERE, after the pointer is parked and
 * the page has settled, so they are measured on the frame that is captured.
 *
 * `fitPage` makes the WINDOW as tall as the page instead of taking a
 * `fullPage` capture. The preview's "Preview — not published" pill is fixed to
 * the bottom of the window, and a full-page capture leaves it where the
 * original window ended, on top of the questions list. A window the height of
 * the page puts it at the true bottom, where a real tall window shows it, and
 * keeps boundingBox() and the image in one coordinate space.
 */
async function shot(page, slug, title, subtitle, markersFn, { fitPage = false } = {}) {
  if (fitPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: 1440, height })
    await page.waitForTimeout(600)
    must((await page.evaluate(() => window.scrollY)) === 0, `${slug}: the page must be at the top`)
  }
  await page.mouse.move(4, 4)
  await page.waitForTimeout(400)
  const markers = await markersFn()
  const raw = `${OUT}/.raw-${slug}.png`
  await page.screenshot({ path: raw })
  await annotate(raw, `${OUT}/${slug}.png`, { title, subtitle, markers })
  console.log(`   wrote ${OUT}/${slug}.png`)
}

async function newContext(browser, { viewport, forwardedHost } = {}) {
  const ctx = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 1100 },
    deviceScaleFactor: DSF,
    colorScheme: "light",
    // public/sw.js can front same-origin reads once registered; a fresh
    // context never registers it anyway, and blocking it keeps every read here
    // a read of the server.
    serviceWorkers: "block",
    ...(forwardedHost ? { extraHTTPHeaders: { "x-forwarded-host": forwardedHost } } : {}),
  })
  await ctx.route(
    /googletagmanager\.com|google-analytics\.com|doubleclick\.net|google\.com\/(ccm|rmkt|pagead)/,
    (route) => route.abort(),
  )
  return ctx
}

// ---------------------------------------------------------------------------
// The chat: one real question on one host
// ---------------------------------------------------------------------------

async function askOnHost(browser, forwardedHost) {
  const ctx = await newContext(browser, { forwardedHost })
  const page = await ctx.newPage()
  await page.goto(`${APP}/ask`, { waitUntil: "networkidle", timeout: 180_000 })
  await hideDevChrome(page)
  must((await page.locator("h1").first().textContent())?.trim() === "Ask a question", "the /ask page did not render")

  // Hydration check: Send is disabled in the server HTML and only React
  // enables it, in response to the typed text. A fill before hydration is
  // lost, so retry it until React has seen it.
  const box = page.getByLabel("Your question")
  const send = page.getByRole("button", { name: "Send" })
  let hydrated = false
  for (let i = 0; i < 10 && !hydrated; i++) {
    await page.waitForTimeout(1000)
    await box.fill(QUESTION)
    hydrated = !(await send.isDisabled())
  }
  must(hydrated, "the chat never hydrated: Send stayed disabled after typing")

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/ask") && r.request().method() === "POST", { timeout: 180_000 }),
    send.click(),
  ])
  const body = await response.json()
  must(response.ok(), `POST /api/ask answered ${response.status()}: ${JSON.stringify(body)}`)
  must(typeof body.conversationId === "string", "the answer carried no conversation id")

  const answer = page.locator("div.rounded-bl-sm.bg-muted")
  await answer.first().waitFor({ state: "visible", timeout: 30_000 })
  must((await answer.count()) === 1, `expected one answer on screen, found ${await answer.count()}`)
  await page.waitForTimeout(800)

  // What the server stored, read back rather than trusted from the screen.
  const { data: convo, error: convoError } = await db
    .from("chat_conversations")
    .select("id, business_id, escalated_at")
    .eq("id", body.conversationId)
    .single()
  if (convoError) throw new Error(`could not read conversation ${body.conversationId}: ${convoError.message}`)
  const { data: turns, error: turnsError } = await db
    .from("chat_messages")
    .select("role, content, verdict, fact_set")
    .eq("conversation_id", body.conversationId)
    .order("created_at", { ascending: true })
  if (turnsError) throw new Error(`could not read messages for ${body.conversationId}: ${turnsError.message}`)
  const assistant = turns.filter((t) => t.role === "assistant").at(-1)
  const facts = assistant?.fact_set?.facts ?? []
  const count = (kind) => facts.filter((f) => f.kind === kind).length

  console.log(`   host ${forwardedHost} -> conversation ${convo.id} filed under ${convo.business_id}`)
  console.log(
    `   verdict ${assistant?.verdict}; facts: ${count("testimonial")} testimonial, ${count("faq")} faq, ${count("programme")} programme, ${facts.length} total; escalated ${convo.escalated_at ?? "no"}`,
  )
  console.log(`   reply: ${JSON.stringify(body.reply)}`)
  const cards = Array.isArray(body.cards) ? body.cards : []
  console.log(`   cards: ${JSON.stringify(cards)}`)

  // The WHOLE assistant turn — the bubble and every card under it — is what a
  // leak check must read. A card is on screen as much as the sentence is.
  const turn = answer.locator("xpath=..")
  return {
    ctx,
    page,
    reply: String(body.reply ?? ""),
    turnText: (await turn.innerText()).trim(),
    cards,
    convo,
    verdict: assistant?.verdict,
    testimonialFacts: count("testimonial"),
    faqFacts: count("faq"),
    programmeFacts: count("programme"),
    question: page.getByText(QUESTION, { exact: true }),
    answer,
    consultButton: turn.getByRole("link", { name: /book a consultation/i }),
  }
}

const mentions = (text, needle) => text.toLowerCase().includes(needle.toLowerCase())

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const { data: testimonialRows, error: tErr } = await db.from("testimonials").select("name").eq("is_active", true)
if (tErr) throw new Error(`could not read testimonials: ${tErr.message}`)
const testimonialNames = testimonialRows.map((r) => r.name.trim()).filter(Boolean)
must(testimonialNames.length > 0, "the dev clone has no active testimonials, so the control cannot show any")
console.log(`platform testimonials on the dev clone: ${testimonialNames.length}`)

const browser = await chromium.launch()
const createdFunnelIds = []

try {
  if (ONLY !== "preview") await chatPair()
  if (ONLY !== "chat") await previewPair()
  console.log("\nall assertions passed")
} finally {
  await browser.close()
  // The drafts are this run's own. Removed either way, then RE-READ: a delete
  // call that returned no error is not proof the rows are gone.
  for (const id of createdFunnelIds) {
    const { error } = await db.from("funnels").delete().eq("id", id)
    console.log(
      `   delete funnels.id=${id}: ${error ? `FAILED ${error.message}` : "ok (cascades its funnel_steps row)"}`,
    )
  }
  if (createdFunnelIds.length > 0) {
    const [{ data: funnelsLeft }, { data: stepsLeft }] = await Promise.all([
      db.from("funnels").select("id").in("id", createdFunnelIds),
      db.from("funnel_steps").select("id").in("funnel_id", createdFunnelIds),
    ])
    console.log(
      `   re-read: ${funnelsLeft?.length ?? "?"} funnels and ${stepsLeft?.length ?? "?"} funnel_steps rows left for ${createdFunnelIds.join(", ")}`,
    )
    if ((funnelsLeft?.length ?? 1) !== 0 || (stepsLeft?.length ?? 1) !== 0) {
      console.error("   !! CLEANUP INCOMPLETE — delete the rows above by hand")
      process.exitCode = 1
    }
  }
}

async function chatPair() {
  // ---- 01: the coach's /ask ----------------------------------------------
  console.log("\n01 the coach's Ask page")
  const coach = await askOnHost(browser, COACH_HOST)
  must(
    coach.convo.business_id === TRAILHEAD,
    `the coach's conversation was filed under ${coach.convo.business_id}, not Trailhead`,
  )
  must(
    coach.testimonialFacts === 0 && coach.faqFacts === 0 && coach.programmeFacts === 0,
    "the coach's turn was handed platform rows",
  )
  const leaked = [...testimonialNames, "Darren", "DJP"].filter((n) => mentions(coach.turnText, n))
  must(leaked.length === 0, `the coach's answer names platform content: ${leaked.join(", ")}`)
  // The caption says the answer admits there is nothing to show. Checked, not
  // assumed: the model words it differently every time.
  must(
    /\b(no|not|none)\b|n't/i.test(coach.reply) && /testimonial|review|client|said|feedback|stor/i.test(coach.reply),
    `the coach's answer does not plainly say there is nothing to show — re-read it before captioning: ${coach.reply}`,
  )
  const coachConsult = coach.cards.find((c) => c.kind === "consult")
  if (coachConsult) {
    // Trailhead has no calendar connection, so the offer must be this site's
    // own page, never the platform's booking calendar.
    must(
      coachConsult.href.startsWith("/") && !mentions(coachConsult.href, "calendly"),
      `the coach's consult card leads to ${coachConsult.href}`,
    )
    console.log(`   the coach's consult card leads to ${coachConsult.href} (this site's own page)`)
  }
  const coachLogo = coach.page
    .locator('a[href="/"]')
    .filter({ has: coach.page.getByAltText("DJP Athlete") })
    .filter({ visible: true })
  await shot(
    coach.page,
    "01-coach-chat-no-platform-clients",
    "A coach's own site no longer borrows the platform's clients",
    `The "Ask a question" page on the web address of "Trailhead Strength & Conditioning", a coach's business. A visitor asked "${QUESTION}" This is the real answer.`,
    async () => [
      await markerOn(
        coach.question,
        "The visitor's question, typed into the real page and sent to the real assistant.",
      ),
      await markerOn(
        coach.answer,
        `The answer says there are no client stories to show. It does not quote or sum up any of the platform's ${testimonialNames.length} client stories, and it does not mention Darren. This coach has no client stories of their own on the site yet, so there is nothing true to quote.`,
      ),
      ...(coachConsult
        ? [
            await markerOn(
              coach.consultButton,
              "Instead, it offers a way to reach a person. \"Book a consultation\" opens this site's own page for arranging one, not the platform's booking calendar.",
            ),
          ]
        : []),
      await markerAfterText(
        coachLogo,
        "The bar along the top is the site's shared frame. It looks the same on every web address today. Giving each coach their own name there is separate work, not part of this change.",
      ),
    ],
  )
  await coach.ctx.close()

  // ---- 02: the platform's /ask (control) ---------------------------------
  console.log("\n02 the platform's Ask page (control)")
  const platform = await askOnHost(browser, PLATFORM_HOST)
  must(
    platform.convo.business_id === PRIMARY,
    `the platform's conversation was filed under ${platform.convo.business_id}, not Primary`,
  )
  must(platform.testimonialFacts > 0, "CONTROL FAILED: the platform's turn was handed no testimonials")
  const named = testimonialNames.filter((n) => mentions(platform.turnText, n))
  const saysDarren = mentions(platform.reply, "Darren")
  must(
    named.length > 0 || saysDarren,
    `CONTROL FAILED: the platform's answer draws on none of its client stories: ${platform.reply}`,
  )
  // The chat has no card for client stories (components/public/AskCards.tsx
  // renders programme, event, consult, slots and capture only), so a reply
  // that points at "the cards" for them is describing its own screen wrongly.
  const pointsAtCards = /\bcards?\b/i.test(platform.reply)
  await shot(
    platform.page,
    "02-platform-chat-uses-its-clients",
    "The platform's own site still answers from its clients' stories",
    `The same page and the same question on the platform's own web address, ${PLATFORM_HOST}. This is the comparison for the shot before: the client stories exist, and only the platform's own site uses them.`,
    async () => [
      await markerOn(platform.question, "The same question, word for word."),
      await markerOn(
        platform.answer,
        `The answer is built from the platform's own published client stories. The lookup handed it ${platform.testimonialFacts} of them` +
          (named.length > 0 ? `, and it names ${named.join(", ")}` : "") +
          (saysDarren ? ". It talks about Darren by name" : "") +
          ". That is right here, because they are this business's own clients.",
      ),
      ...(pointsAtCards
        ? [
            await markerOn(
              platform.answer,
              "It says the stories are on cards beside the reply. The chat has no card for client stories, so that part is the assistant describing its own screen wrongly. That is a separate problem, not part of this change.",
              { place: "right" },
            ),
          ]
        : []),
    ],
  )
  await platform.ctx.close()
}

async function previewPair() {
  // ---- the two drafts ------------------------------------------------------
  console.log("\ncreating the two drafts")
  createdFunnelIds.push(await createDraft(TRAILHEAD, COACH_SLUG))
  createdFunnelIds.push(await createDraft(PRIMARY, PLATFORM_SLUG))

  const adminCtx = await newContext(browser, { viewport: { width: 1440, height: 1000 } })
  const page = await adminCtx.newPage()
  console.log("\nsigning in")
  await page.goto(`${APP}/api/dev/login?callbackUrl=/api/auth/session`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  })
  const session = await (await page.request.get(`${APP}/api/auth/session`)).json()
  must(session?.user?.role === "admin", `no admin session: ${JSON.stringify(session)}`)
  console.log(`   signed in as ${session.user.email}`)

  async function openPreview(businessId, slug) {
    await adminCtx.clearCookies({ name: "djp_business" })
    await adminCtx.addCookies([
      { name: "djp_business", value: businessId, domain: "localhost", path: "/", sameSite: "Lax" },
    ])
    // The previous shot grew the window to its own page's height.
    await page.setViewportSize({ width: 1440, height: 1000 })
    const response = await page.goto(`${APP}/preview/${slug}`, { waitUntil: "networkidle", timeout: 180_000 })
    must(response?.status() === 200, `/preview/${slug} answered ${response?.status()} for business ${businessId}`)
    await hideDevChrome(page)
    await page.waitForTimeout(1500)
    must(
      (await page.getByText("This page can't be previewed").count()) === 0,
      `${slug}: the app refused the draft document`,
    )
    must(
      (await page.getByText("Get stronger before race season").count()) === 1,
      `${slug}: the draft's hero did not render`,
    )
  }

  // ---- 03: the coach's draft preview ----------------------------------------
  console.log("\n03 the coach's draft preview")
  await openPreview(TRAILHEAD, COACH_SLUG)
  const blocker = page.getByText(/uses live FAQs\. Live FAQs are not available for this business/)
  must((await blocker.count()) === 1, "the live-FAQ blocker is missing from the coach's preview")
  const blockerText = (await blocker.textContent()).trim()
  must(
    blockerText ===
      `Section "questions" uses live FAQs. Live FAQs are not available for this business, so the section would show nothing. Switch it to your own FAQs (Inline).`,
    `unexpected blocker wording: ${blockerText}`,
  )
  const coachFaqSection = page.locator("section.djp-s-faq")
  must((await coachFaqSection.count()) === 1, "the coach's preview has no questions section")
  must((await page.locator("[data-djp-faq]").count()) === 0, "the coach's preview SHOWS platform FAQs")
  must((await page.locator('[data-djp-island="faq"]').count()) === 0, "the coach's preview rendered the FAQ island")
  const bannerHeading = page.getByText("This page previews, but publishing will refuse it", { exact: true })
  await shot(
    page,
    "03-coach-preview-live-faq-blocked",
    "A coach's page can no longer show the platform's questions",
    `The full-screen preview of a draft page owned by "Trailhead Strength & Conditioning". Its questions section is set to "Live", which pulls from the platform's own list of questions and answers.`,
    async () => [
      await markerAfterText(
        bannerHeading,
        "The warning at the top says the page cannot be published yet. It is the same check that runs when the coach presses publish.",
      ),
      await markerAfterText(
        blocker,
        'It says what is wrong and how to fix it, in plain words: the "Live" questions are not available for this business, so switch the section to the coach\'s own questions.',
      ),
      await markerAfterText(
        coachFaqSection.locator("h2"),
        "The questions section shows its heading and nothing under it. The platform's questions, which talk about the platform by name, are not shown on this coach's page.",
      ),
    ],
    { fitPage: true },
  )

  // ---- 04: the platform's draft preview (control) ------------------------------
  console.log("\n04 the platform's draft preview (control)")
  await openPreview(PRIMARY, PLATFORM_SLUG)
  must(
    (await page.getByText("This page previews, but publishing will refuse it").count()) === 0,
    "the platform's preview carries a blocker banner",
  )
  const faqItems = page.locator("[data-djp-faq]")
  const shown = await faqItems.count()
  must(shown > 0, "CONTROL FAILED: the platform's preview shows no FAQs")
  const firstQuestion = (await faqItems.nth(0).locator("summary").textContent()).trim()
  console.log(`   platform preview lists ${shown} questions, the first "${firstQuestion}"`)
  await shot(
    page,
    "04-platform-preview-live-faq-renders",
    "The same section on the platform's own page still lists its questions",
    `The same draft page, word for word, owned by the platform's own business, "Primary". This is the comparison for the shot before.`,
    async () => [
      await markerAfterText(
        page.getByText("Off-season strength", { exact: true }),
        'No warning at the top. On the platform\'s own page, the "Live" questions are allowed.',
      ),
      await markerOn(
        faqItems.nth(0).locator("summary"),
        `The "Live" questions appear, pulled from the platform's own list: ${shown} of them, starting with "${firstQuestion}". They are the platform's own questions, which is exactly why a coach's page must not show them.`,
      ),
    ],
    { fitPage: true },
  )
  await adminCtx.close()
}
