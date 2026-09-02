// Drives the REAL app and captures /admin/contacts and /admin/contacts/[id],
// with the callouts burned into each PNG by scripts/_annotate-lib.mjs.
//
//   npm run dev                                        # port 3050
//   node scripts/seed-contact-record-demo.mjs          # the two subjects
//   node scripts/capture-contact-record-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Nothing is rendered in a
// harness, a storybook or a scratch page. The tag in shot 04 is added by typing
// into the real input and letting the real POST route write it, so that shot is
// evidence the route works end to end and not merely that a fixture renders.
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
const OUT = "screenshots/contact-record"
const WIDTH = 1440
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const RICH = "aaaaaaaa-0000-4000-8000-000000000001" // Maya Sorensen
const BARE = "aaaaaaaa-0000-4000-8000-000000000002" // Tobias Frei

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Clears the sequence run this capture is about to create.
 *
 * WITHOUT THIS THE SHOT LIES ON THE SECOND RUN. Enrolment is idempotent, so a
 * re-run answers "Nobody new was added — everyone you picked is already in it"
 * while the caption underneath claims she was just added. Deleting the row
 * first means the button press in shot 05 is always a real first enrolment and
 * the caption is always true.
 */
async function clearSequenceRuns(contactId) {
  const r = await fetch(`${SUPA}/rest/v1/sequence_runs?contact_id=eq.${contactId}`, {
    method: "DELETE",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!r.ok) throw new Error(`clearSequenceRuns -> HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

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
 * Marker positioned on a real element, converted from CSS px to the raw pixel
 * space annotate() draws in.
 *
 * WARNS LOUDLY rather than degrading politely — a helper that quietly returns a
 * default turns a misplaced callout into a silent no-op, and the reviewer reads
 * a caption pointing at nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) {
    console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  }
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  const cx = place === "center" ? box.x + box.width / 2 : box.x - 22
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
  const page = await ctx.newPage()

  // ---------------------------------------------------------------- 03 list
  await page.goto(`${APP}/admin/contacts?search=Maya`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const checkbox = page.getByRole("checkbox", { name: "Select Maya Sorensen" })
  const link = page.getByRole("link", { name: "Maya Sorensen — open contact record" })
  console.log(`  list: checkbox=${await checkbox.count()} link=${await link.count()}`)

  await shoot(page, "03-list-links-to-the-record", "The contact list now links to each record", "/admin/contacts", [
    await markerOn(
      page,
      link,
      "The name is a link to that person's record. Its accessible name is \"Maya Sorensen — open contact record\", which the checkbox's \"Select Maya Sorensen\" neither contains nor is contained by — so a test asking for one can never pick up the other.",
      { place: "center", dy: -34 },
    ),
    await markerOn(
      page,
      checkbox,
      "The tick box still does what it always did. Picking people and adding them to a sequence in bulk is untouched by the link sitting beside it.",
      { place: "center", dx: -30 },
    ),
    await markerOn(
      page,
      page.locator("span").filter({ hasText: /^coaching-lead$/ }).first(),
      "Tags show on the list too, read for the whole page in one go rather than one lookup per row. They sit under the name instead of in their own column, which would push the phone number and date off a laptop screen.",
      { place: "left", dx: -6 },
    ),
  ])

  // ------------------------------------------- bulk enrol still works (real)
  await clearSequenceRuns(RICH)
  await checkbox.check()
  await page.waitForTimeout(300)
  // #sequence-picker, not `select` first — the first select on the page is the
  // "what you can reach them on" FILTER, which has no sequence options at all.
  await page.locator("#sequence-picker").selectOption({ value: "cold_lead_re_engagement" })
  await page.waitForTimeout(300)
  const enrolButton = page.getByRole("button", { name: "Enrol selected" })
  if ((await enrolButton.count()) === 0) throw new Error("bulk enrol button not found — the list toolbar changed")
  await enrolButton.click()
  await page.waitForTimeout(3000)
  console.log("  bulk enrol: clicked \"Enrol selected\"")
  await shoot(
    page,
    "05-bulk-enrol-still-works",
    "Adding people to a sequence in bulk still works",
    "/admin/contacts — the behaviour the link had to not break",
    [
      await markerOn(
        page,
        page.getByText(/^Enrolled |Nobody/).first(),
        "Maya was ticked and added to \"Cold Lead Re-engagement\" through the real button, after the link was added to the same cell. This is the check that the new link did not break the one thing this list was built to do.",
        { place: "left", dx: -6 },
      ),
    ],
  )

  // ---------------------------------------------------------------- 01 rich
  await page.goto(`${APP}/admin/contacts/${RICH}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(800)

  await shoot(
    page,
    "01-rich-contact-record",
    "One person's whole history, on one page",
    "/admin/contacts/aaaaaaaa-0000-4000-8000-000000000001 — Maya Sorensen",
    [
      await markerOn(page, page.getByRole("button", { name: "Add to a sequence" }), "The one action on this screen: put THIS person into a sequence. It posts to the same route the list's bulk button uses, so the wording for \"that sequence is still a draft\" is identical on both screens.", { place: "left", dx: -6 }),
      await markerOn(page, page.getByText("coaching-lead").first(), "Tags. Added and removed here, stored in their own table so they survive two records being merged together.", { place: "left", dx: -6 }),
      await markerOn(page, page.getByRole("heading", { name: "Permission to contact them" }), "What they agreed to, per channel, with the exact words they were shown at the time. This is the column with legal weight.", { dx: -6 }),
      await markerOn(page, page.getByRole("heading", { name: "Do-not-contact list" }), "Kept SEPARATE from consent on purpose. They agreed to texts in July and then texted STOP in August — both are true, and one \"subscribed: yes/no\" could not say so.", { dx: -6 }),
      await markerOn(page, page.getByRole("heading", { name: "Sequences they are in" }), "A sequence is a state, not an event, so it sits beside the history rather than inside it.", { dx: -6 }),
      await markerOn(page, page.getByText("Paid $320.00").first(), "MONEY. Payments are not in the timeline table — they hang off the user account. A page that read only the timeline would show the forms and silently leave the payments out.", { place: "left", dx: -6 }),
      await markerOn(page, page.getByText(/Booked a call/).first(), "BOOKED CALLS. These are real GoHighLevel rows, matched on a phone number the bookings table stores as \"(617) 650-4548\" while the contact stores \"+16176504548\". Comparing those two directly matches nothing, ever.", { place: "left", dx: -6 }),
      await markerOn(page, page.getByText(/Gave a different email address/).first(), "The other person's address in this row is masked to m***@i***. It is somebody else's identifier, and this screen already logs who opened it.", { place: "left", dx: -6 }),
    ],
  )

  // ------------------------------------------------- 04 add a tag, for real
  // Re-runnable: drop the tag first if a previous run already added it, so the
  // shot always shows the ADD happening rather than a "already has it" notice.
  const existing = page.getByRole("button", { name: "Remove the tag tampa camp" })
  if (await existing.count()) {
    await existing.click()
    await page.waitForTimeout(1500)
  }
  await page.getByRole("button", { name: "Add a tag" }).click()
  await page.getByRole("textbox", { name: "New tag" }).fill("Tampa Camp")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.waitForTimeout(2000)

  const added = page.getByText("tampa camp").first()
  console.log(`  tag added and visible: ${(await added.count()) > 0}`)

  await page.evaluate(() => window.scrollTo(0, 0))
  await shoot(
    page,
    "04-tag-added-through-the-real-route",
    "Adding a tag, through the real screen and the real route",
    "/admin/contacts/… — typed into the input, written by POST /api/admin/contacts/[id]/tags",
    [
      await markerOn(page, added, "\"Tampa Camp\" was typed into the box on this page and saved by the real route. It is stored lowercased, so the same tag typed three different ways stays one tag.", { place: "center", dy: -20 }),
    ],
  )

  // ---------------------------------------------------------------- 02 bare
  await page.goto(`${APP}/admin/contacts/${BARE}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(800)

  await shoot(
    page,
    "02-bare-contact-record",
    "The same screen for somebody with no history yet",
    "/admin/contacts/aaaaaaaa-0000-4000-8000-000000000002 — Tobias Frei",
    [
      await markerOn(page, page.getByText("No tags yet.").first(), "Every panel here is empty because this person really has nothing, not because a read failed. A failed read throws and shows the error page instead — those two must never look the same.", { place: "center", dy: -20 }),
      await markerOn(page, page.getByText("Never asked").first(), "\"Never asked\" is not the same as \"said no\". Nobody has ever put a consent question in front of this person.", { place: "center", dy: -18 }),
      await markerOn(page, page.getByText(/do-not-contact list right now/).first(), "Carefully worded: coming off that list DELETES the row, so an empty list cannot prove they were never on it.", { place: "center", dy: -18 }),
      await markerOn(page, page.getByText("Nothing has been recorded for this person yet.").first(), "The empty history, which is the control for the rich one. If this looked identical for Maya, the union would be broken for everybody.", { place: "center", dy: -18 }),
    ],
  )

  console.log("\ndone.")
} finally {
  await ctx.close()
  await browser.close()
}
