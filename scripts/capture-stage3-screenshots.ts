// Drives the REAL app and captures the nine Stage 3 chat screens, with the
// callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev              # in another terminal, port 3050
//   npx tsx scripts/capture-stage3-screenshots.ts .env.local
//
// THE REAL MODEL ANSWERS EVERY TURN. `ANTHROPIC_API_KEY` is present in
// .env.local and nothing here stubs, seeds or replays a reply -- every
// sentence in every screenshot was written by the model this feature ships
// with, in response to a question typed into the real composer. That is the
// only way a screenshot can be evidence of anything: a captured stub proves
// the CSS, and nothing else.
//
// LIGHT ONLY, AND THAT IS NOT AN OMISSION. `.dark` is declared in
// app/globals.css and applied nowhere -- there is no theme provider, no
// toggle, and `<html lang="en">` in app/layout.tsx carries no class -- and
// components/public/*.tsx contains zero `dark:` utilities. There is no second
// rendering of these screens to photograph. Faking one by forcing the class
// would photograph a screen that no visitor can reach.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE. It refuses any other
// project ref outright. Two pieces of state cannot be reached by driving the
// UI, so it sets them up, captures, and puts both back in a finally block:
//
//   * `system_settings.chat_assistant_enabled`. There is NO ROW for this key,
//     and the default is false, so nothing renders at all without it -- not
//     the launcher, not /ask, not the API. Because the row is CREATED, the
//     restore DELETES it. Setting it to `false` instead would leave the clone
//     holding a row it never had, and "no row" and "a row saying false" are
//     different states to anything that reads the table's contents.
//   * `business_settings.display_name`, which is `''`. That blank is exactly
//     why the marketing tick does not render (`hasChatConsentDisplayName`),
//     so shot 5 cannot exist without a name on file. Restored to `''`.
//
// ---------------------------------------------------------------------------
// WHY EVERY PROGRAMME CARD IS CHECKED AGAINST THE DATABASE MID-RUN
// ---------------------------------------------------------------------------
// `programs` carries two independent visibility columns. 40 rows are
// `is_active`; exactly ONE is also `is_public`. The other 39 are individual
// clients' personal plans, named after the athletes, each carrying what that
// client paid. A screenshot that renders those is the very leak this branch
// exists to prevent, published to a folder that gets committed -- permanent,
// greppable, and worse than the bug.
//
// So `assertOnlyPublicProgrammes` reads the public set from the database at
// startup and checks EVERY /api/ask response against it, throwing on the first
// non-public name rather than letting the capture continue. It is deliberately
// a hard failure and not a warning: a warning in a scrolling log is a warning
// nobody reads, and the artefact still ships.
//
// It earns its place. During the exploratory run that preceded this script two
// turns came back carrying 38 non-public programme names -- see
// screenshots/lead-engine-stage3/README.md. The committed code is provably not
// the cause, but "provably not the cause" is a claim about a snapshot, and this
// check does not depend on the claim being right.
//
// The same reasoning drives `assertWorkingTreeClean`: this worktree is shared
// with peer sessions, and a screenshot taken while somebody else's half-saved
// edit is hot-reloaded into the dev server is a photograph of a screen that
// was never committed.

import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { chromium, type Page, type BrowserContext, type Browser } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

/** What one turn of `POST /api/ask` answers with. Only the fields this script reads. */
type AskResponse = {
  conversationId?: string
  reply?: string
  cards?: Array<{ kind: string; name?: string }>
  verdict?: "ok" | "blocked" | "short_circuit"
  error?: string
}

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/lead-engine-stage3"
const BIZ = "00000000-0000-0000-0000-000000000001"

/** Desktop capture geometry. `annotate` reads the real pixels back off the file. */
const WIDTH = 1440
const HEIGHT = 1080
const DSF = 2

/**
 * Phone capture geometry. The panel goes full-screen below `sm`, so this has to
 * be a real phone viewport rather than a narrowed desktop one.
 *
 * `PHONE_DSF` is passed to `annotate` as its `scale` override. Deriving the
 * scale from the image width -- 1242px, which LOOKS like a wide capture -- would
 * draw 15px captions over UI rendered at 3x, legible only if you zoom in, which
 * is the one thing a burned-in annotation exists to avoid.
 */
const PHONE = { width: 414, height: 896 }
const PHONE_DSF = 3

/**
 * A plausible name for the business, borrowed from the titles the clone's own
 * events already carry so nothing on screen contradicts anything else on
 * screen. It is set for the length of the run and put back to `''`.
 */
const DISPLAY_NAME = "Hi Performance Soccer"

/**
 * One origin for the whole run, and a fresh one each run.
 *
 * `MAX_CONVERSATIONS_PER_IP_PER_HOUR` is 5 and this run opens 3, so the real
 * limiter applies to this run exactly as it would to one real visitor. What a
 * fixed address would add is a SECOND run inside the hour failing on the
 * limiter -- which is the limiter working, but it would read as the feature
 * being broken. Nothing here relaxes a limit; the header is what the platform
 * sets in production and what `clientIp()` reads there too.
 */
const RUN_IP = `203.0.113.${2 + Math.floor(Math.random() * 250)}`

const envPath = process.argv[2] ?? ".env.local"
const env: Record<string, string> = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "CHAT_IP_SALT"]) {
  if (!env[k]) throw new Error(`${k} missing from ${envPath}`)
}

const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const ref = new URL(U).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing -- env points at ${ref}`)
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }

async function rest(path: string, init: RequestInit = {}): Promise<unknown[]> {
  const r = await fetch(`${U}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, Prefer: "return=representation", ...(init.headers ?? {}) },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${t.slice(0, 300)}`)
  try {
    return JSON.parse(t) as unknown[]
  } catch {
    return []
  }
}

/**
 * Refuses to photograph an app that is not the committed one.
 *
 * This worktree is shared. A peer session's uncommitted edit is hot-reloaded
 * into the same dev server this script drives, so a capture taken over it shows
 * a screen that exists in nobody's repository. `scripts/` is excluded because
 * this file and its annotation library are the things being written.
 */
function assertWorkingTreeClean(): void {
  const changed = execFileSync("git", [
    "diff",
    "HEAD",
    "--name-only",
    "--",
    "app",
    "lib",
    "components",
    "middleware.ts",
  ])
    .toString()
    .trim()
  if (changed) {
    throw new Error(
      `the app is modified relative to HEAD, so a capture would not be of the committed product:\n${changed}`,
    )
  }
}

/**
 * Marker coordinates are read off the LIVE element, so they cannot drift out of
 * step with the layout the way hand-typed pixels do.
 *
 * THROWS when the selector matches nothing. A marker helper that degrades
 * politely turns a broken callout into a silent no-op -- the screenshot still
 * looks fine, and the number now points at empty space.
 */
async function markerAt(
  page: Page,
  selector: string,
  caption: string,
  opts: {
    dsf?: number
    /**
     * Moves the disc off the element's own corner, in CSS pixels.
     *
     * Needed because "straddle the corner" only holds when the corner is a
     * BORDER. On a left-aligned run of text -- a violation line, a checkbox
     * label, a monospace list of values -- the top-left corner is the first
     * character, and a disc centred there does exactly what the rule exists to
     * prevent: the first review of these shots had markers reading
     * "omised_outcome" and "erica/new_york". A nudge of about one disc radius
     * puts the disc just outside the text, still touching it.
     */
    nudge?: { x?: number; y?: number }
  } = {},
): Promise<Marker> {
  const dsf = opts.dsf ?? DSF
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE (zero box): ${selector}`)
  // AND IT MUST BE ON SCREEN. `annotate` clamps a marker to the image, so an
  // element scrolled out of the viewport does not fail -- it silently parks its
  // number against the top or bottom edge, pointing at whatever happens to be
  // there. That is the politely-degrading no-op this repo has already paid for
  // once, so it is an error here instead.
  const view = page.viewportSize()
  if (view && (box.y + box.height < 0 || box.y > view.height || box.x > view.width)) {
    throw new Error(`MARKER TARGET IS OUTSIDE THE VIEWPORT (y=${Math.round(box.y)}): ${selector} -- scroll it in first`)
  }
  // Centred ON the element's top-left corner, so the disc straddles the edge
  // and sits half outside rather than squarely over the first word of the very
  // label the number points at.
  return { x: (box.x + (opts.nudge?.x ?? 0)) * dsf, y: (box.y + (opts.nudge?.y ?? 0)) * dsf, caption }
}

/**
 * Hides the dev server's own indicator and the admin messaging dock.
 *
 * `nextjs-portal` exists only because this is `next dev` and never appears in
 * production, so leaving it in would put something in the picture no user can
 * ever see. The dock floats over the bottom-right of every admin page and
 * covers the table footer -- real product chrome, but not the subject.
 *
 * Injected into the page, never edited into the components. A screenshot of a
 * screen altered to photograph it is not a screenshot of the product, and the
 * sticky bar in shots 1-3 is emphatically NOT hidden: it is the subject.
 */
async function hideDevChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

async function shoot(
  page: Page,
  name: string,
  title: string,
  subtitle: string,
  markers: Marker[],
  scale?: number,
): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await hideDevChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers, scale })
  rmSync(raw, { force: true })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

/**
 * Launches Chromium, tolerating the browser-revision drift that bites every
 * time this repo's Playwright is upgraded. `chromium.launch()` wants the
 * headless shell matching the installed Playwright exactly, and that revision
 * is frequently absent even when the cache holds two perfectly good newer ones.
 * The failure ("Executable doesn't exist at ...") reads like a broken machine
 * rather than a version mismatch, which is how it costs an hour.
 *
 * It reports the substitution rather than swallowing it: a silent fallback is
 * how you end up puzzling over a rendering difference nobody told you about.
 */
async function launchChromium(): Promise<Browser> {
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
    throw new Error(
      `no usable chromium found. Original error: ${(err as Error).message.split("\n")[0]}\n` +
        `Run: npx playwright install chromium chromium-headless-shell`,
    )
  }
}

async function signInAsAdmin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/chat`, { waitUntil: "domcontentloaded" })
  // ASSERT THE SESSION BEFORE ANYTHING ELSE. A minted JWT the app refuses
  // presents downstream as "the feature is broken", which is the single most
  // misleading failure available in a harness like this.
  if (!page.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${page.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  if ((await page.locator("text=/Unauthorized|Forbidden/i").count()) > 0) {
    throw new Error("landed on /admin but the page reports no session")
  }
  await page.close()
  console.log("  signed in as admin, session asserted")
}

/** Every programme name a stranger is allowed to hear. Read once, from the database. */
let publicProgrammeNames = new Set<string>()

/** See this file's header. Throws on the first non-public name rather than capturing it. */
function assertOnlyPublicProgrammes(res: AskResponse, question: string): void {
  const leaked = (res.cards ?? [])
    .filter((c) => c.kind === "programme")
    .map((c) => c.name ?? "")
    .filter((n) => !publicProgrammeNames.has(n))
  if (leaked.length > 0) {
    throw new Error(
      `REFUSING TO CAPTURE: ${leaked.length} non-public programme card(s) came back for "${question}". ` +
        `These are individual clients' plans and their prices. Names withheld from this message on purpose.`,
    )
  }
}

/**
 * Types a question into the REAL composer and waits for the real model's answer.
 *
 * It watches the network rather than the DOM for completion because the reply
 * is not streamed -- `POST /api/ask` buffers the whole turn, validates it, and
 * answers once -- so the response landing IS the turn finishing, and it also
 * carries the `verdict` the visitor's screen deliberately does not spell out.
 */
function askThrough(page: Page) {
  const seen: AskResponse[] = []
  page.on("response", (response) => {
    if (!response.url().endsWith("/api/ask")) return
    void response
      .json()
      .then((body) => seen.push(body as AskResponse))
      .catch(() => {})
  })

  return async function ask(question: string): Promise<AskResponse> {
    const before = seen.length
    await page.locator("textarea[aria-label='Your question']").fill(question)
    await page.locator("form button[type=submit]").last().click()
    // Generous: a turn is up to four tool rounds against a live model.
    const deadline = Date.now() + 120_000
    while (seen.length === before) {
      if (Date.now() > deadline) throw new Error(`no answer to "${question}" within 120s`)
      await page.waitForTimeout(250)
    }
    const res = seen[seen.length - 1]
    assertOnlyPublicProgrammes(res, question)
    console.log(`    asked: "${question.slice(0, 58)}..." -> ${res.verdict ?? res.error}`)
    // The reply is rendered after the response resolves; give React a beat.
    await page.waitForTimeout(600)
    return res
  }
}

/** Brings the sticky bar out: it stays hidden until the visitor is 800px down. */
async function revealStickyBar(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 1400))
  await page.waitForSelector("button[aria-label='Ask a question']", { timeout: 10_000 })
  await page.waitForTimeout(400)
}

/**
 * Honest questions, in the order a real visitor's curiosity would produce them,
 * each one an invitation to state a number the database does not hold: a
 * per-week rate, a head count, a success rate, a total for two children.
 *
 * NOTHING HERE MANUFACTURES A BLOCK. The model is not stubbed and the validator
 * is not relaxed. If every one of these is answered honestly -- which is the
 * good outcome -- the run says so and captures the closest state it reached.
 */
const BLOCK_ATTEMPTS = [
  "What ages do you coach, and how many kids are usually in a group?",
  "How many athletes have you worked with, and what percentage make their varsity team?",
  "If I signed my two sons up for that, what would the total come to per week?",
  "How far in advance do I need to book, and how many spots are usually left?",
]

async function main(): Promise<void> {
  assertWorkingTreeClean()

  const browser = await launchChromium()

  // Everything this run changes on the clone, so the finally block can put it
  // all back whether we finish or throw.
  let createdFlagRow = false
  let displayNameSet = false

  try {
    publicProgrammeNames = new Set(
      ((await rest("programs?select=name&is_active=eq.true&is_public=eq.true")) as { name: string }[]).map(
        (p) => p.name,
      ),
    )
    if (publicProgrammeNames.size === 0) {
      throw new Error("no public programme in the clone -- shot 2 needs a real price card, not an empty panel")
    }
    console.log(`  ${publicProgrammeNames.size} public programme(s) on file; every card will be checked against them`)

    // ---- the two states the interface cannot reach on its own ---------------
    const existing = await rest("system_settings?select=key&key=eq.chat_assistant_enabled")
    if (existing.length === 0) {
      await rest("system_settings", {
        method: "POST",
        body: JSON.stringify({ key: "chat_assistant_enabled", value: true }),
      })
      createdFlagRow = true
      console.log("  chat_assistant_enabled: row CREATED (it will be DELETED again, not set false)")
    } else {
      throw new Error(
        "chat_assistant_enabled already exists. This script only knows how to create-and-delete that row; " +
          "restoring a pre-existing value is not something it should guess at.",
      )
    }
    await rest(`business_settings?business_id=eq.${BIZ}`, {
      method: "PATCH",
      body: JSON.stringify({ display_name: DISPLAY_NAME }),
    })
    displayNameSet = true
    console.log(`  business display name set to ${JSON.stringify(DISPLAY_NAME)} (restored to "" afterwards)`)

    const desktop = {
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: DSF,
      extraHTTPHeaders: { "x-forwarded-for": RUN_IP },
    }

    // =====================================================================
    // Conversation A -- the widget, on a real marketing page
    // =====================================================================
    const ctxA = await browser.newContext(desktop)
    const page = await ctxA.newPage()
    const askPanel = askThrough(page)

    await page.goto(`${APP}/`, { waitUntil: "networkidle" })
    await revealStickyBar(page)

    await shoot(
      page,
      "01-launcher-sticky-bar",
      "How a visitor starts a conversation",
      "the home page · desktop · light",
      [
        await markerAt(
          page,
          "button[aria-label='Ask a question']",
          "This is the way in. It only appears once someone has scrolled a fair way down the page, so it never covers the top of the page while they are still reading it.",
        ),
        await markerAt(
          page,
          "a[href='/online#apply']",
          "The apply button was already here. The question button was added beside it rather than as a second floating bubble in the same corner, which on a phone would have sat directly on top of this one.",
        ),
      ],
    )

    await page.locator("button[aria-label='Ask a question']").click()
    await page.waitForSelector("[role=dialog][aria-label='Ask a question']", { timeout: 10_000 })
    await page.waitForTimeout(400)

    await askPanel("How much does the Rotational Reboot cost, and how long does it run for?")
    await page.waitForSelector("text=Rotational Reboot", { timeout: 10_000 })

    const programmeCard = "div.rounded-xl.border.p-4.shadow-sm"
    await shoot(
      page,
      "02-panel-programme-card",
      "A price the assistant never typed",
      "the panel, docked · desktop · light",
      [
        await markerAt(
          page,
          programmeCard,
          "The price, the length and how often you train come out of the database and are drawn here by the website itself. The assistant is not asked to write the number down, so it cannot get it wrong.",
        ),
        await markerAt(
          page,
          "div.rounded-bl-sm",
          "Notice what the answer does: it points at the card instead of repeating the figures in a sentence. Anything it did type has been checked, word by word, against what was actually looked up.",
        ),
      ],
    )

    await askPanel("Are there any camps or clinics coming up that my son could join?")

    await shoot(
      page,
      "06-empty-camps",
      "Nothing on the schedule, said properly",
      "the panel, docked · desktop · light",
      [
        await markerAt(
          page,
          "div.rounded-bl-sm >> nth=-1",
          "There are no camps or clinics published at the moment, and this is the usual answer rather than a rare one. It says so plainly and offers the next useful thing, instead of going quiet or inventing a date.",
        ),
      ],
    )

    // =====================================================================
    // Conversation B -- the full page, the details card, and a blocked turn
    // =====================================================================
    const ctxB = await browser.newContext(desktop)
    const ask = await ctxB.newPage()
    const askPage = askThrough(ask)

    await ask.goto(`${APP}/ask`, { waitUntil: "networkidle" })
    // GENEROUS, AND IT SAYS WHY IT FAILED. `/ask` is the one route this run
    // reaches that `next dev` has usually not compiled yet, and a cold
    // Turbopack build of it exceeds ten seconds -- which presents as
    // "the composer never appeared", indistinguishable from the flag being off
    // or the page having 404'd. Those are the two things worth telling apart,
    // so the failure prints what the page actually said.
    try {
      await ask.waitForSelector("textarea[aria-label='Your question']", { timeout: 60_000 })
    } catch {
      const heading = await ask
        .locator("h1, h2")
        .first()
        .innerText()
        .catch(() => "<no heading>")
      throw new Error(
        `/ask never showed its composer. The page's heading was ${JSON.stringify(heading)} — ` +
          `if that reads as "not found", the feature flag was not on when the page rendered.`,
      )
    }

    await askPage("What coaching do you offer, and what does it cost to get started?")
    await ask.waitForSelector("text=Rotational Reboot", { timeout: 10_000 })

    await shoot(ask, "04-ask-page", "The same assistant, on a page of its own", "/ask · desktop · light", [
      await markerAt(
        ask,
        "h1",
        "A page anyone can be sent to. The emails that hand a conversation to a person link here, so nobody has to go hunting for the button at the bottom of the home page.",
      ),
      await markerAt(
        ask,
        "p.mt-3.text-muted-foreground",
        "It tells the visitor up front where the answers come from, and what happens when the answer is not there: a person, not a guess.",
      ),
    ])

    // The details card is the model's own decision to make -- `capture_lead` is
    // a tool it chooses, and nothing here can call it directly. One follow-up
    // is allowed, phrased the way a visitor who meant it would phrase it.
    await askPage("My son is 14 and plays travel soccer. Could someone give me a call about getting him started?")
    const consentTick = ask.locator("input[name='ask-marketing-consent']")
    if ((await consentTick.count()) === 0) {
      await askPage("Yes please -- put the form up and I'll leave my details.")
    }
    await ask.waitForSelector("input[name='ask-marketing-consent']", { timeout: 20_000 })
    await consentTick.first().scrollIntoViewIfNeeded()
    await ask.waitForTimeout(400)

    await shoot(
      ask,
      "05-details-and-consent",
      "Asking for details, and asking permission separately",
      "/ask · desktop · light",
      [
        await markerAt(
          ask,
          "form.rounded-xl.p-4.shadow-sm",
          "The assistant put this form on the screen and saved nothing. Only pressing the button at the bottom creates a record -- until then nobody has the visitor's details.",
        ),
        // Nudged clear of the box itself. The caption's whole point is that the
        // tick is EMPTY, and a disc parked on a 16px checkbox hides the evidence.
        await markerAt(
          ask,
          "input[name='ask-marketing-consent']",
          "Agreeing to hear about camps and coaching is a separate tick, and it is never pre-ticked. The tick only appears when the business has filled its name in, because agreeing to hear from a business the sentence cannot name is agreeing to nothing.",
          { nudge: { x: -26 } },
        ),
      ],
    )

    // ---- a blocked turn, reached honestly or not at all --------------------
    let blocked: AskResponse | null = null
    let blockedQuestion = ""
    for (const attempt of BLOCK_ATTEMPTS) {
      const res = await askPage(attempt)
      if (res.verdict === "blocked") {
        blocked = res
        blockedQuestion = attempt
        break
      }
    }

    await ask.waitForTimeout(500)
    if (blocked) {
      await shoot(
        ask,
        "07-blocked-turn",
        "What a visitor sees when the answer was not good enough",
        "/ask · a reply stopped before it was shown · light",
        [
          await markerAt(
            ask,
            "div.rounded-bl-sm >> nth=-1",
            "The assistant wrote an answer, the website checked it against what had actually been looked up, and something in it was not backed by anything. The whole answer was thrown away and this was shown instead.",
          ),
          await markerAt(
            ask,
            "p.rounded-br-sm >> nth=-1",
            "This is the question that produced it. The visitor is never shown the sentence that was stopped -- they get an honest refusal and an offer of a person.",
          ),
        ],
      )
    } else {
      console.log("  NO BLOCK REACHED -- every attempt was answered honestly. Capturing the closest state instead.")
      await shoot(
        ask,
        "07-blocked-turn",
        "The closest state reached: the assistant declining rather than guessing",
        "/ask · no reply was blocked on this run · light",
        [
          await markerAt(
            ask,
            "div.rounded-bl-sm >> nth=-1",
            "Asked for a number nobody has published, the assistant said it did not know instead of making one up, so there was nothing for the checker to stop. That is the good outcome, and it is why this run has no blocked reply to show.",
          ),
          await markerAt(
            ask,
            "p.rounded-br-sm >> nth=-1",
            "The question that was put to it. Nothing here was staged: the model was never stubbed and the checker was never relaxed.",
          ),
        ],
      )
    }
    const askConversationId = blocked?.conversationId

    // =====================================================================
    // Conversation C -- a phone
    // =====================================================================
    const ctxC = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: PHONE_DSF,
      isMobile: true,
      hasTouch: true,
      extraHTTPHeaders: { "x-forwarded-for": RUN_IP },
    })
    const phone = await ctxC.newPage()
    const askOnPhone = askThrough(phone)

    await phone.goto(`${APP}/`, { waitUntil: "networkidle" })
    await revealStickyBar(phone)
    await phone.locator("button[aria-label='Ask a question']").click()
    await phone.waitForSelector("[role=dialog][aria-label='Ask a question']", { timeout: 10_000 })
    await askOnPhone("What does the Rotational Reboot cost?")
    await phone.waitForSelector("text=Rotational Reboot", { timeout: 10_000 })

    await shoot(
      phone,
      "03-panel-on-a-phone",
      // SHORT, DELIBERATELY. `annotate` does not wrap the title, and at scale 3
      // on a 1242px-wide capture roughly 21 characters fit; a longer one is
      // silently cut off at the image edge, which the first take proved.
      "The panel on a phone",
      "full screen · 414 x 896 · light",
      [
        await markerAt(
          phone,
          "div.rounded-xl.border.p-4.shadow-sm",
          "The same card as on a computer, with the same price read out of the database, laid out for a narrow screen.",
          { dsf: PHONE_DSF },
        ),
        // NOT the dialog's own corner: it is a full-screen sheet, so its
        // top-left corner is the top-left of the screen, and a disc there lands
        // squarely on the panel's title.
        await markerAt(
          phone,
          "button[aria-label='Close']",
          "The panel covers the page for as long as it is open, because there is nowhere on a phone to put it beside anything. One tap on the cross puts the page back.",
          { dsf: PHONE_DSF, nudge: { x: -26 } },
        ),
      ],
      PHONE_DSF,
    )

    // =====================================================================
    // The admin side
    // =====================================================================
    const ctxAdmin = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DSF })
    await signInAsAdmin(ctxAdmin)
    const admin = await ctxAdmin.newPage()

    await admin.goto(`${APP}/admin/chat`, { waitUntil: "networkidle" })
    await admin.waitForSelector("table", { timeout: 15_000 })
    await admin.waitForTimeout(500)

    await shoot(admin, "08-admin-chat-list", "Every conversation the assistant has had", "/admin/chat · light", [
      await markerAt(
        admin,
        "select#chat-filter",
        "Narrow the list to the three things worth an operator's morning: the ones handed to a person, the ones that produced a contact, and the ones where a reply was stopped.",
      ),
      await markerAt(
        admin,
        "table tbody tr:first-child td:last-child",
        "A conversation can be more than one of these at once, and all of them are shown. Picking the most important one would hide that the conversation which produced a contact also had a reply stopped in it.",
      ),
      await markerAt(
        admin,
        "table tbody tr:first-child td:first-child",
        "The time it started opens the full transcript. Opening one is itself recorded -- people type their own name and their child's name into a public chat box without being asked.",
      ),
    ])

    // ---- the transcript ----------------------------------------------------
    const target =
      askConversationId ??
      ((await admin.locator("table tbody tr:first-child a").first().getAttribute("href")) ?? "").split("/").pop()
    if (!target) throw new Error("could not find a conversation to open")

    await admin.goto(`${APP}/admin/chat/${target}`, { waitUntil: "networkidle" })
    await admin.waitForSelector("article[data-slot='chat-turn']", { timeout: 15_000 })

    /**
     * Puts the turn's TOP near the top of the viewport rather than merely
     * "in view". A blocked turn carries the reply, the complaint and the whole
     * grounded list, so it is tall; `scrollIntoViewIfNeeded` is happy the
     * moment one edge is showing, which is how the marker on the fact set ends
     * up below the fold.
     */
    async function frameTurn(selector: string): Promise<void> {
      // A blocked turn carries the reply, the complaint AND the whole grounded
      // list, and how long that is depends on what the model wrote -- so it is
      // sometimes taller than a 1080px window and sometimes not. Rather than
      // crop the evidence, the WINDOW is grown to fit it: still the real page
      // at a real desktop width, just a taller browser. The alternative is a
      // screenshot whose third callout points off the bottom edge, which is
      // exactly what the marker guard refused on the previous run.
      const height = await admin.evaluate((sel) => {
        const el = document.querySelector(sel)
        return el ? Math.ceil(el.getBoundingClientRect().height) : 0
      }, selector)
      const needed = height + 200
      if (needed > HEIGHT) {
        await admin.setViewportSize({ width: WIDTH, height: Math.min(needed, 2200) })
        await admin.waitForTimeout(300)
      }
      await admin.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 96)
      }, selector)
      await admin.waitForTimeout(500)
    }

    if (blocked) {
      // Scoped to the blocked turn. Unscoped, `[data-testid='grounded-values']`
      // matches the FIRST one on the page, which on a clean turn lives inside a
      // collapsed <details> -- no box, and the marker helper rightly refuses it.
      const article = "article[data-verdict='blocked']"
      await frameTurn(article)
      await shoot(
        admin,
        "09-admin-transcript-blocked",
        "Why that reply was stopped, and what it was checked against",
        `/admin/chat/<id> · the turn produced by "${blockedQuestion.slice(0, 44)}..." · light`,
        [
          await markerAt(
            admin,
            article,
            "The words the assistant actually wrote. The visitor never saw this sentence -- they got the refusal instead -- and it is kept precisely so somebody can read it afterwards and see what it tried to do.",
          ),
          // Both nudged out to the left of their text. These are left-aligned
          // runs, so their top-left corner IS the first character -- see the
          // note on `markerAt`'s `nudge`.
          await markerAt(
            admin,
            `${article} [data-testid='violations']`,
            "What was wrong with it, in the checker's own words.",
            { nudge: { x: -26 } },
          ),
          await markerAt(
            admin,
            `${article} [data-testid='grounded-values']`,
            "And the full list of values the answer was allowed to contain -- everything the lookups on that turn actually returned. A figure in the reply that is not in this list is what the complaint above means.",
            { nudge: { x: -26 } },
          ),
        ],
      )
    } else {
      const last = "article[data-slot='chat-turn'] >> nth=-1"
      await frameTurn("article[data-slot='chat-turn']:last-of-type")
      await shoot(
        admin,
        "09-admin-transcript-blocked",
        "A transcript, and the evidence behind an ordinary answer",
        "/admin/chat/<id> · no reply was blocked on this run · light",
        [
          await markerAt(
            admin,
            last,
            "Every turn is kept with the verdict it was given, what it cost, and which assistant answered it.",
          ),
          await markerAt(
            admin,
            "article[data-slot='chat-turn'] >> nth=0",
            "The conversation reads top to bottom, the visitor's questions and the answers together, exactly as it happened.",
          ),
        ],
      )
    }

    console.log(`\nall captures written to ${OUT}`)
    console.log(`  conversations opened this run: 3, from ${RUN_IP}`)
    console.log(
      `  a reply was blocked: ${blocked ? `yes -- "${blockedQuestion}"` : "no (every attempt answered honestly)"}`,
    )
  } finally {
    // Put the clone back exactly as it was found, whether or not we finished,
    // and PROVE it by reading both values back rather than assuming the writes
    // landed.
    if (displayNameSet) {
      await rest(`business_settings?business_id=eq.${BIZ}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: "" }),
      }).catch(() => [])
    }
    if (createdFlagRow) {
      await rest("system_settings?key=eq.chat_assistant_enabled", { method: "DELETE" }).catch(() => [])
    }
    const flagRows = await rest("system_settings?select=key&key=eq.chat_assistant_enabled").catch(() => [{}])
    const [settings] = (await rest(`business_settings?select=display_name&business_id=eq.${BIZ}`).catch(() => [])) as {
      display_name?: string
    }[]
    console.log(
      `  restored: chat_assistant_enabled rows=${flagRows.length} (want 0), ` +
        `display_name=${JSON.stringify(settings?.display_name ?? "<unread>")} (want "")`,
    )
    if (flagRows.length !== 0 || (settings?.display_name ?? null) !== "") {
      console.error("  !! THE CLONE IS NOT BACK AS IT WAS FOUND -- fix this by hand before doing anything else")
      process.exitCode = 1
    }
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
