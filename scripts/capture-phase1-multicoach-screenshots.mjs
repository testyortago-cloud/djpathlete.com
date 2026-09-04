// Phase 1 multi-coach proof: an operator creates a SECOND business through
// the real "Add a business" form (never seeded), invites a coach into it,
// edits its settings, and the admin screens start showing THAT business's
// own rows instead of the singleton's. This script drives every one of those
// steps through the real running app and the real browser.
//
//   npm run dev > /tmp/phase1-dev.log 2>&1 &
//   node scripts/capture-phase1-multicoach-screenshots.mjs
//
// EVERY SHOT IS THE REAL SCREEN ON THE REAL ROUTE. Shots 01-08 are signed in
// as the real dev-clone operator (admin@darrenjpaul.com, via /api/dev/login).
// Shots 09-10 are signed in as a REAL invited coach: a brand-new user account
// created by actually claiming the invite minted in shot 04, through the
// real /invite/<token> claim form and the app's own sign-in.
//
// A DISCOVERED PERMISSION GAP, DOCUMENTED RATHER THAN SKIPPED. The plan for
// this task assumed a signed-in coach could load /admin/contacts. Reading
// lib/permissions/registry.ts and app/(admin)/admin/contacts/page.tsx shows
// that page calls requireAdmin() directly and /admin/contacts appears in NO
// PATH_PERMISSIONS rule — it is reachable by role:"admin" only, and
// roleForPermissions() (lib/permissions/registry.ts:576) never returns
// "admin" for an invited teammate, whatever preset is chosen. So a coach is
// redirected to /admin/no-access before that page ever renders — this is not
// a bug this phase introduced, and is not this task's to fix. Shot 09 proves
// the phase's actual claim on a screen a coach CAN reach (/admin/bookings,
// gated by the "schedule" permission the "Coach" preset grants). Shot 10
// captures the /admin/contacts attempt as-is, landing on /admin/no-access, as
// the documented evidence for this substitution rather than a bare claim in
// a report.
//
// LIGHT ONLY, DELIBERATELY. The admin UI is light-only; `.dark` is a class
// variant these components were never built against, and there is no toggle
// that applies it. There is no second rendering to capture.
//
// DEV CLONE ONLY, and it refuses any other project ref outright.
//
// WRITES ARE ADDITIVE. This script creates exactly one new business, one new
// booking host row (via create_business), one new invite, and one new user
// account (the coach, created by really claiming that invite). It edits that
// one business's settings. It never touches the singleton's own rows, never
// deletes anything, and never touches an id prefixed ca1e0d1e-0002-... or
// aaaaaaaa-0000-....

import { mkdirSync, readFileSync, unlinkSync } from "node:fs"
import { chromium } from "playwright"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createClient } from "@supabase/supabase-js"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/calendly-per-coach-phase1"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
if (env.DEV_AUTH_BYPASS_ENABLED !== "true" || !env.DEV_AUTH_BYPASS_EMAIL) {
  throw new Error("DEV_AUTH_BYPASS_ENABLED/DEV_AUTH_BYPASS_EMAIL missing from .env.local")
}

const RUN = Date.now().toString(36)
const seed = Number.parseInt(RUN, 36)

// A varied, human-looking business per run — not a fixed constant — so a
// re-run of this script (it errored out once while authoring it) doesn't try
// to reuse an already-taken slug from the earlier attempt. Every entry here
// slugifies to something readable, which is the whole point of shot 02.
const BUSINESS_NAMES = [
  "Solstice Performance Coaching",
  "Ironwood Athletic Development",
  "Bluecrest Youth Performance",
  "Trailhead Strength & Conditioning",
  "Northline Sports Performance",
  "Cascade Athlete Development",
  "Redwood Youth Athletics",
  "Summit Performance Coaching",
]
const COACH_FIRST = ["Priya", "Jordan", "Maya", "Devon", "Elena", "Marcus", "Nadia", "Theo"]
const COACH_LAST = ["Whitfield", "Larkspur", "Osei", "Marchetti", "Solberg", "Delgado", "Kavanagh", "Renner"]

const BUSINESS_NAME = BUSINESS_NAMES[seed % BUSINESS_NAMES.length]
const COACH_FIRST_NAME = COACH_FIRST[seed % COACH_FIRST.length]
const COACH_LAST_NAME = COACH_LAST[Math.floor(seed / 7) % COACH_LAST.length]
const COACH_FULL_NAME = `${COACH_FIRST_NAME} ${COACH_LAST_NAME}`
const COACH_EMAIL = `${COACH_FIRST_NAME.toLowerCase()}.${COACH_LAST_NAME.toLowerCase()}.${RUN}@djpathlete.demo`
const COACH_PASSWORD = `Coach-${RUN}-Pass!` // >= 10 chars, satisfies claimInviteSchema
const DISPLAY_NAME_EDIT = `${BUSINESS_NAME} — Personal Training`

// A distinct, non-reserved, guaranteed-taken slug for the 409 shot: the
// business this run creates. RESERVED_SLUGS (lib/validators/business.ts)
// already contains "primary", so typing the singleton's own slug would show
// a CLIENT-SIDE "reserved" message, never the server's 409 — a different
// code path from the one this shot is supposed to prove.
let businessId = ""
let businessSlug = ""
let inviteLink = ""

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
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"], [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

/**
 * A marker beside a real element, in the raw pixel space annotate() draws in.
 * WARNS LOUDLY when the target is missing or ambiguous rather than degrading
 * — a helper that degrades politely turns a broken annotation into a silent
 * no-op (memory: annotate() markers are raw pixels).
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  else if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  } else cx = box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers, { fullPage = true } = {}) {
  mkdirSync(OUT, { recursive: true })
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
  const r = await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers })
  unlinkSync(raw)
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
}

const browser = await launchChromium()

try {
  // =====================================================================
  // OPERATOR SESSION — shots 01-08
  // =====================================================================
  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
  const admin = await opCtx.newPage()

  console.log(`run ${RUN} — business "${BUSINESS_NAME}", coach ${COACH_FULL_NAME} <${COACH_EMAIL}>`)
  console.log("\nsigning in as the real operator")
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/businesses`, { waitUntil: "domcontentloaded" })
  await admin.waitForURL(/\/admin\/businesses/, { timeout: 20_000 })
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(400) // hydration — an enabled button before hydration has no handler yet

  // ---- 01: the businesses list, before the second business exists --------
  console.log("\n01 the businesses list, singleton only")
  const primaryRow = admin.locator("tr").filter({ hasText: "Primary" }).first()
  await shoot(
    admin,
    "01-admin-businesses-list-before",
    "Every coach on this platform starts here — today, there is one",
    `The singleton "Primary" business is the only row. Nothing about this app has been multi-tenant until now.`,
    [
      await markerOn(admin, admin.getByRole("link", { name: "Add a business" }), "Add a business — the real form this whole proof runs through. Nothing in this script inserts a business row directly.", { place: "left" }),
      await markerOn(admin, primaryRow, `The singleton, seeded before multi-tenancy existed. Its web address is "primary" — also a reserved word, which shot 08 uses.`, { place: "right", dx: 10 }),
    ],
    { fullPage: false },
  )

  // ---- 02: the create form, filled ----------------------------------------
  console.log("\n02 the create form, filled in")
  await admin.getByRole("link", { name: "Add a business" }).click()
  await admin.waitForURL(/\/admin\/businesses\/new/, { timeout: 10_000 })
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(400)

  const nameInput = admin.locator("#name")
  await nameInput.fill(BUSINESS_NAME)
  // Slug auto-fill is React state driven off onChange — give it a beat.
  await admin.waitForTimeout(200)
  const slugValue = await admin.locator("#slug").inputValue()
  if (!slugValue) throw new Error("slug did not auto-fill from the name — BusinessCreateForm regressed")
  businessSlug = slugValue
  console.log(`   slug auto-filled to "${businessSlug}"`)

  // Timezone: the shadcn Select, not a native <select> — open it and pick a
  // human-language label. Never the IANA id; COMMON_TIMEZONES exists so a
  // non-programmer never has to read one.
  await admin.locator("#timezone").click()
  await admin.getByRole("option", { name: "Pacific Time (Los Angeles)" }).click()

  await admin.locator("#hostDisplayName").fill(COACH_FULL_NAME)
  await admin.locator("#hostEmail").fill(COACH_EMAIL)
  await admin.waitForTimeout(200)

  await shoot(
    admin,
    "02-admin-businesses-new-filled",
    "A real form, not a seeded row — this is the whole claim of the phase",
    `The web address filled itself in from the name the moment it was typed, and the time zone reads in plain English.`,
    [
      await markerOn(admin, nameInput, `Name: "${BUSINESS_NAME}", just typed.`, { place: "right" }),
      await markerOn(admin, admin.locator("#slug"), `Web address auto-filled to "${businessSlug}" — it follows the name until this field is edited directly.`, { place: "right" }),
      await markerOn(admin, admin.locator("#timezone"), `"Pacific Time (Los Angeles)" — a plain-language label. The stored value is the IANA id underneath it, never shown here.`, { place: "left" }),
      await markerOn(admin, admin.locator("#hostDisplayName"), `Who takes the calls: ${COACH_FULL_NAME} — the same person shot 04 invites as this business's coach.`, { place: "right" }),
    ],
  )

  await admin.getByRole("button", { name: "Create business" }).click()
  await admin.waitForURL(/\/admin\/businesses\/[0-9a-f-]{36}$/, { timeout: 15_000 })
  businessId = admin.url().split("/").pop()
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(400)
  console.log(`   created business ${businessId}`)

  const { data: createdRow, error: createdErr } = await db
    .from("businesses")
    .select("id, name, slug, status")
    .eq("id", businessId)
    .maybeSingle()
  if (createdErr) throw new Error(`read-back failed: ${createdErr.code} ${createdErr.message}`)
  if (!createdRow) throw new Error(`business ${businessId} was not found by read-back — the form reported success but nothing was written`)
  console.log(`   read back: ${JSON.stringify(createdRow)}`)

  // ---- 03: the new business's settings, edited and saved ------------------
  console.log("\n03 the business's settings, edited and saved")
  await admin.locator("#display_name").fill(DISPLAY_NAME_EDIT)
  await admin.getByRole("button", { name: "Save settings" }).click()
  await admin.getByText("Settings saved").waitFor({ timeout: 10_000 })
  // "Save settings" sits at the BOTTOM of this long form, and .click() auto-
  // scrolled it into view — left uncorrected, the fullPage:false shot below
  // would frame wherever that scroll landed (the Legal card and the Save
  // button), not the top of the page, and every marker below would resolve
  // off-screen and get clamped into a meaningless cluster at the image edge.
  await admin.evaluate(() => window.scrollTo(0, 0))
  await admin.waitForTimeout(300)

  // fullPage:false, DELIBERATELY, on this one screen only. A full-page capture
  // of this form (several viewports tall) reproducibly duplicated the fixed
  // header/sidebar partway down the image — a real Chromium
  // captureBeyondViewport stitching artifact on this exact page height, not a
  // toast-timing race (reproduced twice, once with the toast already gone).
  // Shot 04, on the SAME page and taller still, never showed it — the only
  // other difference there is an open Radix dialog, which locks page scroll.
  // Rather than chase a rendering bug in Chromium's screenshot pipeline, this
  // shot stays at the top of the page: h1, Members, and the first two
  // grouped-heading cards (Identity, Email) all fit in one 1440x1000 viewport
  // and are enough to prove "this business's own settings, saved, grouped
  // under plain headings" without the lower cards.
  await shoot(
    admin,
    "03-admin-business-detail-settings",
    `${BUSINESS_NAME}'s own settings — grouped under plain headings`,
    `Just saved: a real PATCH to /api/admin/businesses/${businessId}, read back by this same page.`,
    [
      await markerOn(admin, admin.locator("h1", { hasText: BUSINESS_NAME }), `${BUSINESS_NAME}, ${businessSlug}. This business's own page — not the singleton's.`, { place: "right" }),
      await markerOn(admin, admin.locator("#display_name"), `Display name just edited to "${DISPLAY_NAME_EDIT}" and saved — this business's own identity, independent of the singleton's.`, { place: "right" }),
      // CardTitle renders a plain `[data-slot="card-title"]` div, not a
      // heading tag — and the Members table above has its OWN "Email" column
      // header, an exact-text collision a bare getByText("Email") would hit.
      await markerOn(admin, admin.locator('[data-slot="card-title"]').filter({ hasText: "Email" }), `Grouped under plain headings — Identity, Email, Timing, Text messages, Legal — not one long form.`, { place: "right" }),
    ],
    { fullPage: false },
  )

  // ---- 04: the members card, inviting a real coach -------------------------
  console.log("\n04 inviting a coach — the members card")
  await admin.getByRole("button", { name: "Invite a coach" }).click()
  // getByLabel("Email") is a SUBSTRING match (Playwright, not Testing
  // Library) and also resolves "Sender email" and "Reply-to email" on this
  // same page — the id is the only unambiguous target.
  await admin.locator("#member-invite-email").fill(COACH_EMAIL)
  // businessRole and the permission preset both default to "coach" already —
  // that default is what the dialog opens with, and it's what this run keeps.
  await admin.getByRole("button", { name: "Send invite" }).click()
  const inviteLinkInput = admin.getByRole("dialog").locator('input[readonly]')
  await inviteLinkInput.waitFor({ timeout: 10_000 })
  inviteLink = await inviteLinkInput.inputValue()
  if (!inviteLink.includes("/invite/")) throw new Error(`invite link looks wrong: "${inviteLink}"`)
  console.log(`   invite link: ${inviteLink}`)
  await admin.waitForTimeout(300)

  await shoot(
    admin,
    "04-admin-business-invite-coach",
    "A real invite, with a real link — not a mocked email",
    `Sent to ${COACH_EMAIL}. Shots 09-10 are that exact coach, having actually claimed this link.`,
    [
      await markerOn(admin, admin.getByRole("dialog"), `The dialog this business's own "Invite a coach" button opened.`, { place: "right" }),
      await markerOn(admin, inviteLinkInput, `The real invite link, valid for 7 days. Copied here exactly as an operator would.`, { place: "left" }),
    ],
  )

  await admin.getByRole("button", { name: "Done" }).click()
  await admin.waitForTimeout(300)

  // ---- 05: both businesses listed ------------------------------------------
  console.log("\n05 both businesses listed")
  await admin.goto(`${APP}/admin/businesses`, { waitUntil: "networkidle" })
  await admin.waitForTimeout(300)
  const newRow = admin.locator("tr").filter({ hasText: BUSINESS_NAME }).first()
  await newRow.scrollIntoViewIfNeeded()
  await shoot(
    admin,
    "05-admin-businesses-list-after",
    "Two businesses now — the singleton, and the one this run just created",
    `Both rows are real: the singleton seeded before multi-tenancy, and ${BUSINESS_NAME} created through the form above.`,
    [
      await markerOn(admin, admin.locator("tr").filter({ hasText: "Primary" }).first(), "The singleton, unchanged.", { place: "left" }),
      await markerOn(admin, newRow, `${BUSINESS_NAME} — created moments ago through the real form, not inserted.`, { place: "left" }),
    ],
    { fullPage: false },
  )

  // ---- 06/07: the switcher, and the same screen reading two businesses -----
  console.log("\n06 the switcher + the singleton's own contacts")
  await admin.goto(`${APP}/admin/contacts`, { waitUntil: "networkidle" })
  await admin.waitForTimeout(400)
  const switcherTrigger = admin.getByLabel("Switch business")
  // Make sure we're looking at Primary first, regardless of cookie state left
  // over from an earlier run.
  //
  // THE TRIGGER'S LABEL LAGS THE CLICK BY ~1.3s. BusinessSwitcher's <Select>
  // is a CONTROLLED component driven by the `currentId` SERVER prop, not by
  // Radix's own state — onValueChange fires selectBusiness() then
  // router.refresh(), and the visible label only changes once that refresh's
  // RSC round trip lands. A short waitForTimeout here reads as "it didn't
  // switch": debugged by polling the trigger's own text, plain
  // waitForTimeout(400) was consistently one refresh behind, and a SECOND
  // switch issued before the first settles is dropped outright — handleChange
  // early-returns on `nextId === currentId`, comparing against the STILL-STALE
  // currentId. Waiting for the label itself is the only correct signal.
  await switcherTrigger.click()
  await admin.getByRole("option", { name: "Primary" }).click()
  await switcherTrigger.getByText("Primary", { exact: true }).waitFor({ timeout: 10_000 })
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(300)
  const primaryCount = admin.locator("span").filter({ hasText: /contacts?$/ }).first()
  await shoot(
    admin,
    "06-admin-contacts-switcher-primary",
    "The switcher only appears now that there are two businesses to pick from",
    `Reading the singleton's own contacts — the operator's default tenant.`,
    [
      await markerOn(admin, switcherTrigger, `The switcher. It renders only when a caller has more than one business — a coach with one sees nothing here at all.`, { place: "left" }),
      await markerOn(admin, primaryCount, `The singleton's own contact count — this business has real history.`, { place: "right" }),
    ],
    // fullPage: the footer's contact count sits below the fold on a list
    // this long — a viewport-only shot leaves markerOn() a real, but
    // off-screen, box, which annotate() then clamps into the visible frame
    // and mispositions.
  )

  console.log("\n07 the switcher, switched to the new business — its own (empty) contacts")
  await switcherTrigger.click()
  await admin.getByRole("option", { name: BUSINESS_NAME }).click()
  await switcherTrigger.getByText(BUSINESS_NAME, { exact: true }).waitFor({ timeout: 10_000 })
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(300)
  const emptyRow = admin.getByText("No contacts yet. They appear here the moment someone fills in a form on a published page.")
  await shoot(
    admin,
    "07-admin-contacts-switcher-new-business",
    `Switched to ${BUSINESS_NAME} — a different result, same screen, same code`,
    `Zero contacts is the correct answer here: this business is minutes old and no public page belongs to it yet. The wrong answer would have been the singleton's rows.`,
    [
      await markerOn(admin, switcherTrigger, `Now reading "${BUSINESS_NAME}" — the switcher's own selection, not a URL parameter.`, { place: "left" }),
      await markerOn(admin, emptyRow, "The empty state, not the singleton's contacts. This is the isolation the whole phase exists to prove.", { place: "above" }),
    ],
  )

  // ---- 08: the slug-taken 409, rendered on the field -----------------------
  console.log("\n08 the duplicate-web-address 409, on the field")
  await admin.goto(`${APP}/admin/businesses/new`, { waitUntil: "networkidle" })
  await admin.waitForTimeout(400)
  await admin.locator("#name").fill(`${BUSINESS_NAME} — Second Location`)
  await admin.waitForTimeout(150)
  // Touch the slug field directly so it stops following the name, then
  // overwrite it with the ALREADY-TAKEN, NON-RESERVED slug from shot 02.
  // "primary" is on RESERVED_SLUGS (lib/validators/business.ts) and would
  // short-circuit into a client-side "reserved" message before ever reaching
  // the server's 409 — a different code path from the one this shot proves.
  const slugField = admin.locator("#slug")
  await slugField.fill("x")
  await slugField.fill(businessSlug)
  await admin.locator("#timezone").click()
  await admin.getByRole("option", { name: "Eastern Time (New York)" }).click()
  await admin.locator("#hostDisplayName").fill("Placeholder Host")
  await admin.getByRole("button", { name: "Create business" }).click()
  await admin.locator("#slug-error").waitFor({ timeout: 10_000 })
  await admin.waitForTimeout(200)
  await shoot(
    admin,
    "08-admin-businesses-new-slug-conflict",
    "The 409 lands on the field, not a toast",
    `Typing "${businessSlug}" — already taken by the business created in shot 02 — and submitting again.`,
    [
      await markerOn(admin, admin.locator("#slug"), `The web address this run already claimed.`, { place: "right" }),
      await markerOn(admin, admin.locator("#slug-error"), `The server's 409, rendered under the field it belongs to — exactly where Task 4's test pins it.`, { place: "right" }),
    ],
  )

  await opCtx.close()

  // =====================================================================
  // COACH SESSION — shots 09-10. A SEPARATE browser context: no cookie,
  // storage or session is shared with the operator above. This account did
  // not exist until the claim below created it.
  // =====================================================================
  console.log(`\nclaiming the invite as ${COACH_FULL_NAME} — a brand-new account, not a fixture`)
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
  const coach = await coachCtx.newPage()
  await coach.goto(inviteLink, { waitUntil: "networkidle" })
  await coach.waitForTimeout(400)
  await coach.locator("#firstName").fill(COACH_FIRST_NAME)
  await coach.locator("#lastName").fill(COACH_LAST_NAME)
  await coach.locator("#password").fill(COACH_PASSWORD)
  await coach.getByRole("button", { name: "Accept and continue" }).click()
  // The form auto-signs-in and pushes to /editor regardless of the granted
  // role (a pre-existing quirk of InviteClaimForm, unrelated to this phase) —
  // wait for SOME navigation away from the claim page rather than a specific
  // URL, then drive to the real destination ourselves.
  await coach.waitForURL((u) => !u.pathname.startsWith("/invite/"), { timeout: 15_000 })
  await coach.waitForTimeout(300)

  const { data: coachUser, error: coachErr } = await db
    .from("users")
    .select("id, email, role")
    .eq("email", COACH_EMAIL)
    .maybeSingle()
  if (coachErr) throw new Error(`read-back failed: ${coachErr.code} ${coachErr.message}`)
  if (!coachUser) throw new Error(`no user row for ${COACH_EMAIL} — the claim reported success but created nothing`)
  console.log(`   real account created: ${coachUser.id} role=${coachUser.role}`)
  const { data: membership } = await db
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", coachUser.id)
    .eq("business_id", businessId)
    .maybeSingle()
  if (!membership) throw new Error(`claim created the user but no business_members row links them to ${businessId}`)
  console.log(`   membership: ${JSON.stringify(membership)}`)

  // ---- 09: the coach's own bookings — scoped, and no switcher --------------
  console.log("\n09 the coach's own bookings — scoped to their business, no switcher")
  await coach.goto(`${APP}/admin/bookings`, { waitUntil: "networkidle" })
  if (!coach.url().endsWith("/admin/bookings")) {
    throw new Error(`coach was redirected away from /admin/bookings to ${coach.url()} — the "schedule" permission the Coach preset grants should allow this`)
  }
  await coach.waitForTimeout(400)
  const switcherOnCoachScreen = await coach.getByLabel("Switch business").count()
  if (switcherOnCoachScreen !== 0) {
    console.warn(`  !! EXPECTED NO SWITCHER for a single-business coach, found ${switcherOnCoachScreen}`)
  }
  const bookingsHeading = coach.locator("h1", { hasText: "Bookings" })
  await shoot(
    coach,
    "09-admin-bookings-coach-scoped",
    `Signed in as ${COACH_FULL_NAME} — a real teammate, not the operator`,
    `${BUSINESS_NAME}'s own bookings screen. No switcher: this account belongs to exactly one business.`,
    [
      await markerOn(coach, bookingsHeading, `The real /admin/bookings route, signed in as the coach this run actually invited and who actually claimed the link.`, { place: "right" }),
    ],
    { fullPage: false },
  )
  if (switcherOnCoachScreen === 0) {
    console.log("   confirmed: no switcher rendered for this single-business account")
  }

  // ---- 10: the coach attempts /admin/contacts — documents the gap ---------
  console.log("\n10 the coach attempts /admin/contacts — lands on /admin/no-access")
  await coach.goto(`${APP}/admin/contacts`, { waitUntil: "networkidle" })
  await coach.waitForTimeout(400)
  const landedOnNoAccess = coach.url().endsWith("/admin/no-access")
  if (!landedOnNoAccess) {
    console.warn(`  !! EXPECTED a redirect to /admin/no-access, landed on ${coach.url()} instead`)
  }
  await shoot(
    coach,
    "10-admin-contacts-coach-no-access",
    "/admin/contacts is admin-only today — not a hole this phase opened",
    `requireAdmin() gates this page directly, and no invited teammate can hold role "admin". This is the real result of the real attempt, not staged.`,
    [
      await markerOn(coach, coach.locator("h1"), `"That area isn't part of your access" — the house pattern for a signed-in user with nothing to show here.`, { place: "right" }),
    ],
  )
} finally {
  await browser.close()
}
console.log("\ndone")
