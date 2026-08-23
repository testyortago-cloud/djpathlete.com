// Drives the REAL app and captures the two new screens, with the callouts
// burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev              # in another terminal, port 3050
//   npx tsx scripts/capture-loose-ends-screenshots.ts .env.local
//
// WHY IT SIGNS THE CONSENT TOKEN WITH THE APP'S OWN SIGNER rather than
// hand-rolling the string: the token format IS the security boundary, and a
// page reached by a token this script minted its own way would prove nothing
// about the page a real contact reaches. Importing `smsConsentUrl` means the
// captured page is arrived at exactly as an emailed link arrives at it.
//
// LIGHT ONLY, DELIBERATELY. `.dark` exists in app/globals.css but there is no
// theme provider anywhere in the app and neither of these routes carries a
// single `dark:` class, so there is no second rendering to capture -- this is
// not an omission.
//
// IT WRITES TO THE DEV CLONE, AND ONLY THE DEV CLONE. It refuses any other
// project ref outright. Three states cannot be reached by driving the UI --
// a business with its name filled in, a contact with a phone, and a phone
// that has already texted STOP -- so it sets them up, captures, and puts
// every one of them back in a finally block. Nothing here touches production.

import { readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { chromium, type Page, type BrowserContext, type Browser } from "playwright"
import { annotate } from "./_annotate-lib.mjs"

type Marker = { x: number; y: number; caption: string }

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/lead-engine-loose-ends"
const DSF = 2 // deviceScaleFactor; annotate() reads the real pixels back off the file
const WIDTH = 1440
const BIZ = "00000000-0000-0000-0000-000000000001"
const DISPLAY_NAME = "DJP Athlete"

const envPath = process.argv[2] ?? ".env.local"
const env: Record<string, string> = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXTAUTH_SECRET"]) {
  if (!env[k]) throw new Error(`${k} missing from ${envPath}`)
}
// The signer reads this out of the environment, so it must be the same secret
// the running dev server verifies with.
process.env.NEXTAUTH_SECRET = env.NEXTAUTH_SECRET

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
 * Marker coordinates are read off the LIVE element, so they cannot drift out
 * of step with the layout the way hand-typed pixels do.
 *
 * THROWS when the selector matches nothing. A marker helper that degrades
 * politely turns a broken callout into a silent no-op -- the screenshot still
 * looks fine, and the number now points at empty space.
 */
async function markerAt(page: Page, selector: string, caption: string): Promise<Marker> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) throw new Error(`MARKER TARGET NOT FOUND: ${selector}`)
  const box = await el.boundingBox()
  if (!box) throw new Error(`MARKER TARGET NOT VISIBLE (zero box): ${selector}`)
  // Centred ON the element's top-left corner, so the disc straddles the edge
  // and sits half outside. Nudging it inwards instead parks it squarely over
  // the first word of the very label the number is pointing at, which is how
  // the first run produced a marker covering a filter's text.
  return { x: box.x * DSF, y: box.y * DSF, caption }
}

/**
 * Hides two things that would otherwise sit on top of the feature:
 *
 *  - `nextjs-portal`, the dev-server's own indicator. It exists only because
 *    this is `next dev` and never appears in production, so leaving it in
 *    would put something in the picture that no user can ever see.
 *  - the messaging dock, which floats over the bottom-right corner of every
 *    admin page and covers the table's own footer. Real product chrome, but
 *    not the subject here.
 *
 * Injected into the page, never edited into the components: the screenshot has
 * to be of the real screen as it really ships, and changing app code to take a
 * nicer picture of it makes the picture a lie.
 */
async function hideFloatingChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"] { display: none !important; }`,
  })
}

async function shoot(page: Page, name: string, title: string, subtitle: string, markers: Marker[]): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

/**
 * Launches Chromium, tolerating the browser-revision drift that bites every
 * time this repo's Playwright is upgraded.
 *
 * `chromium.launch()` wants the headless SHELL matching the installed
 * Playwright exactly — `chromium_headless_shell-<rev>` — and that revision is
 * frequently absent even when the cache holds two perfectly good newer ones,
 * because `npx playwright install` is scoped per project and per version. The
 * failure ("Executable doesn't exist at …") reads like a broken machine rather
 * than a version mismatch, which is how it costs an hour.
 *
 * So: try the expected build, and on failure fall back to the newest shell
 * actually present. A shell one or two revisions off renders this app's CSS
 * identically — this is a screenshot, not a browser-compat test — and taking a
 * capture with it beats blocking on a several-hundred-megabyte download.
 *
 * It reports which build it used rather than swallowing the substitution,
 * because a silent fallback is how you end up puzzling over a rendering
 * difference you were never told about.
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
  await page.goto(`${APP}/api/dev/login?callbackUrl=/admin/contacts`, { waitUntil: "domcontentloaded" })
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

async function main(): Promise<void> {
  const { smsConsentUrl } = await import("../lib/lead-engine/sms-consent-token")

  const browser = await launchChromium()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1080 }, deviceScaleFactor: DSF })

  // Everything this run changes on the clone, so the finally block can put it
  // all back whether we finish or throw.
  const madeContactIds: string[] = []
  const madePhones: string[] = []
  const madeSuppressions: string[] = []
  let displayNameSet = false

  try {
    await signInAsAdmin(ctx)
    const page = await ctx.newPage()

    // ---- the consent page BEFORE the business has a name ------------------
    // Captured first, because it is the state the clone is already in. It is
    // a real state with real copy, and it is worth seeing.
    const [seed] = (await rest("contacts?select=id&limit=1")) as { id: string }[]
    if (!seed) throw new Error("the dev clone has no contacts -- an empty page is a broken screenshot")

    await page.goto(smsConsentUrl(APP, seed.id, BIZ), { waitUntil: "networkidle" })
    await shoot(
      page,
      "07-consent-not-ready",
      "The consent page when the business has not filled its name in",
      "/sms-consent/<token> · dev clone · light",
      [
        await markerAt(
          page,
          "h1",
          "The wording a person agrees to names the business, so with no name on file there is no sentence to show. It explains itself and points them back to the email, rather than showing a 404 or a half-written promise.",
        ),
      ],
    )

    // ---- set up the states the UI cannot reach on its own -----------------
    await rest(`business_settings?business_id=eq.${BIZ}`, {
      method: "PATCH",
      body: JSON.stringify({ display_name: DISPLAY_NAME }),
    })
    displayNameSet = true

    const agreePhone = "+15550100411"
    const stoppedPhone = "+15550100422"
    const unsubEmail = "nadia.f+shot@example.test"
    const unsubPhone = "+15550100433"
    for (const [name, email, phone] of [
      ["Rosa Delgado", "rosa.delgado+shot@example.test", agreePhone],
      ["Theo Marchand", "theo.marchand+shot@example.test", stoppedPhone],
      ["Nadia Farouk", unsubEmail, unsubPhone],
    ] as const) {
      const [row] = (await rest("contacts", {
        method: "POST",
        body: JSON.stringify({ business_id: BIZ, name, email, phone_e164: phone }),
      })) as { id: string }[]
      madeContactIds.push(row.id)
      madePhones.push(phone)
    }
    const [agreeContact, stoppedContact, unsubContact] = madeContactIds

    // Neither of these can be reached by driving the interface. A STOP arrives
    // over SMS from a handset; an unsubscribe is a suppression keyed on the
    // EMAIL address, and it is the one that used to be missed — the page
    // checked the phone only, so an unsubscribed contact was told "you are all
    // set" while the engine would refuse every send.
    await rest("contact_suppressions", {
      method: "POST",
      body: JSON.stringify({ business_id: BIZ, identifier: stoppedPhone, reason: "sms_stop" }),
    })
    madeSuppressions.push(stoppedPhone)
    await rest("contact_suppressions", {
      method: "POST",
      body: JSON.stringify({ business_id: BIZ, identifier: unsubEmail, reason: "unsubscribed" }),
    })
    madeSuppressions.push(unsubEmail)

    // ---- the consent ask --------------------------------------------------
    await page.goto(smsConsentUrl(APP, agreeContact, BIZ), { waitUntil: "networkidle" })
    await shoot(page, "04-consent-ask", "What a contact sees when they tap the link", "/sms-consent/<token> · light", [
      await markerAt(
        page,
        "p.border-border",
        "The exact sentence they are agreeing to, shown before they agree. This same string is what gets filed as the evidence — the page never hands its own copy to the write, so the two cannot drift apart.",
      ),
      await markerAt(
        page,
        "button[type=submit]",
        "Only pressing this writes anything. Loading the page writes nothing at all, because mail scanners open every link in an inbox and a page that recorded consent on load would manufacture it.",
      ),
    ])

    // ---- and after they agree ---------------------------------------------
    await page.locator("button[type=submit]").first().click()
    await page.waitForURL(/done=1/, { timeout: 15000 })
    await page.waitForLoadState("networkidle")
    await shoot(page, "05-consent-confirmed", "After they press I agree", "/sms-consent/<token>?done=1 · light", [
      await markerAt(
        page,
        "h1",
        "The permission is now on file with the wording, the time and the address it came from. Pressing it twice does not file a second agreement — they only agreed once.",
      ),
    ])

    // ---- the person who already texted STOP -------------------------------
    await page.goto(smsConsentUrl(APP, stoppedContact, BIZ), { waitUntil: "networkidle" })
    await shoot(
      page,
      "06-consent-stopped",
      "Someone who already texted STOP gets the truth, not a button",
      "/sms-consent/<token> · light",
      [
        await markerAt(
          page,
          "h1",
          "A STOP came from their own handset; a tapped link in an email is a weaker signal, so it cannot undo one. Telling them they are all set while they stayed blocked would simply be a lie.",
        ),
      ],
    )

    // ---- the person who unsubscribed from the emails ----------------------
    await page.goto(smsConsentUrl(APP, unsubContact, BIZ), { waitUntil: "networkidle" })
    await shoot(
      page,
      "08-consent-unsubscribed",
      "Someone who unsubscribed is not offered a button either",
      "/sms-consent/<token> · light",
      [
        await markerAt(
          page,
          "h1",
          "Suppression is held against the address or the number, and either one stops every message. This page used to ask only about the number, so somebody who had unsubscribed was told they were all set while nothing would ever be sent.",
        ),
      ],
    )

    // ---- the contacts list ------------------------------------------------
    await page.goto(`${APP}/admin/contacts`, { waitUntil: "networkidle" })
    await page.waitForTimeout(500)
    await shoot(
      page,
      "01-contacts-list",
      "Contacts — everyone the business has ever heard from",
      "/admin/contacts · dev clone · light",
      [
        await markerAt(
          page,
          "input[aria-label='Search contacts']",
          "Search by name, email or phone. The filters live in the web address, so a filtered view is a link you can send to someone.",
        ),
        await markerAt(
          page,
          "select[aria-label='Filter by what you can reach them on']",
          "Narrow to the people you can actually reach — the ones with an email, or the ones with a phone number.",
        ),
        await markerAt(
          page,
          "input[aria-label='Select every contact on this page']",
          "Tick people one at a time, or take the whole page at once.",
        ),
      ],
    )

    // ---- ticked, with a draft sequence chosen -----------------------------
    await page.locator("input[aria-label='Select every contact on this page']").check()
    // By value, not by label: the option's text carries the status suffix
    // ("… (draft)"), which is exactly the thing under test and must be free to
    // change without breaking the capture.
    await page.locator("#sequence-picker").selectOption("cold_lead_re_engagement")
    await page.waitForTimeout(400)
    await shoot(
      page,
      "02-contacts-draft-warning",
      "It says a draft will send nothing BEFORE you press the button",
      "/admin/contacts · light",
      [
        await markerAt(
          page,
          "#sequence-picker",
          "Every sequence in this database is seeded switched off, so the picker prints the state next to the name instead of hiding it.",
        ),
        await markerAt(
          page,
          "p.text-accent",
          "The warning arrives before the click, not after it. Without this the first thing a coach learns about a draft is a red box telling them nothing happened.",
        ),
      ],
    )

    // ---- and the honest refusal after pressing it -------------------------
    await page.locator("button:has-text('Enrol selected')").click()
    await page.waitForSelector("[role=status]", { timeout: 15000 })
    await page.waitForTimeout(400)
    await shoot(
      page,
      "03-contacts-enrol-refused",
      "Nobody was enrolled, and it names the real reason",
      "/admin/contacts · light",
      [
        await markerAt(
          page,
          "[role=status]",
          "It names the actual status rather than failing generically, so a paused sequence reads as paused and a draft reads as a draft — and it says what to do next.",
        ),
      ],
    )

    console.log("\nall captures written to", OUT)
  } finally {
    // Put the clone back exactly as it was found, whether or not we finished.
    for (const id of madeContactIds) {
      await rest(`contact_consents?contact_id=eq.${id}`, { method: "DELETE" }).catch(() => [])
      await rest(`contact_timeline_events?contact_id=eq.${id}`, { method: "DELETE" }).catch(() => [])
      await rest(`sequence_runs?contact_id=eq.${id}`, { method: "DELETE" }).catch(() => [])
      await rest(`contacts?id=eq.${id}`, { method: "DELETE" }).catch(() => [])
    }
    for (const identifier of [...madeSuppressions, ...madePhones]) {
      await rest(`contact_suppressions?identifier=eq.${encodeURIComponent(identifier)}`, { method: "DELETE" }).catch(
        () => [],
      )
    }
    if (displayNameSet) {
      await rest(`business_settings?business_id=eq.${BIZ}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: "" }),
      }).catch(() => [])
    }
    if (madeContactIds.length || displayNameSet) console.log("  dev clone restored to how it was found")
    await ctx.close()
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
