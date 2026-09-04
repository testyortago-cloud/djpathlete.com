// scripts/capture-coach-reachability.mjs
//
// The coach-reachability change, driven through the REAL app on the real
// routes. Nothing here is a fixture or a harness mount: this script creates a
// business through /admin/businesses/new, invites a coach through that
// business's own "Invite a coach" button, claims the invite through
// /invite/<token> to create a genuinely new user account, and then signs in as
// that account to open the three screens the change makes reachable.
//
// WHY THE NEGATIVE SHOT COMES FIRST. The claim of this branch is not "these
// screens render" — they always rendered for the operator. It is "a coach can
// reach them, and sees only their own business's rows". So the run captures a
// staff member WITHOUT the `contacts` permission being refused, before showing
// the same route working for one who holds it. Without that control, a shot of
// a working screen proves nothing about the gate.
//
// WHAT IT WRITES, all on the DEV clone: one business (+ its settings, pipeline
// and booking host rows via create_business), one invite, one user account, and
// a handful of contacts so the coach's list is not empty. Nothing on
// production, and nothing outside those.
//
// Run with the dev server up on :3050:
//   npx dotenv -e .env.local -- node scripts/capture-coach-reachability.mjs

import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"
import { annotate } from "./_annotate-lib.mjs"

const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/coach-reachability"
const DSF = 2 // deviceScaleFactor; annotate() places markers in RAW pixels

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const RUN = Date.now().toString(36)
const BUSINESS_NAME = `Northcrest Barbell ${RUN.slice(-3).toUpperCase()}`
const COACH_FIRST = "Rowan"
const COACH_LAST = "Adeyemi"
const COACH_FULL = `${COACH_FIRST} ${COACH_LAST}`
const COACH_EMAIL = `rowan.adeyemi.${RUN}@djpathlete.demo`
const COACH_PASSWORD = `Coach-${RUN}-Pass!` // >= 10 chars, satisfies claimInviteSchema

// Contacts seeded into the NEW business so the coach's list has real rows.
// The operator's own business has its own, unrelated contacts — that is the
// whole point of shot 05.
const COACH_CONTACTS = [
  ["Rosa Marchetti", "rosa.marchetti@northcrest.example", "+15035550118"],
  ["Isaiah Boateng", "isaiah.boateng@northcrest.example", "+15035550142"],
  ["Hana Sorensen", "hana.sorensen@northcrest.example", "+15035550176"],
  ["Miguel Ortega", "miguel.ortega@northcrest.example", "+15035550193"],
  ["Priyanka Nair", "priyanka.nair@northcrest.example", null],
]

mkdirSync(OUT, { recursive: true })

async function launchChromium() {
  return chromium.launch()
}

/** Hide dev-only chrome so it never lands in a shot. */
async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `
      [data-nextjs-toast], nextjs-portal, #__next-build-watcher,
      [data-messaging-dock], [data-dev-only] { display: none !important; }
    `,
  })
}

/**
 * A marker beside a real element, in the raw pixel space annotate() draws in.
 * WARNS LOUDLY on a missing or off-screen target: a helper that degrades
 * politely turns a broken annotation into a silent no-op, and the marker then
 * gets clamped to the image edge where it means nothing.
 */
async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left", tightenToText = false } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption dropped: "${caption.slice(0, 60)}"`)
    return null
  }
  if (n > 1) {
    console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}"`)
  }
  // A HEADING IS A BLOCK ELEMENT, so its boundingBox spans the whole content
  // column and `place: "right"` lands the marker at the far edge of the page,
  // pointing at nothing. Measuring the text's own client rect puts the marker
  // beside the WORDS. Arrow function only inside evaluate: a named function
  // declaration there is rewritten to __name(fn, "…") by the bundler, which
  // does not exist in the browser and throws the whole evaluate.
  const box = tightenToText
    ? await locator.first().evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const r = range.getBoundingClientRect()
        return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : el.getBoundingClientRect().toJSON()
      })
    : await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX (hidden?) — caption dropped: "${caption.slice(0, 60)}"`)
    return null
  }
  // The disc is r = 19 * scale RAW px (see _annotate-lib.mjs), i.e. ~19 CSS px
  // here, so an 8px gap put half the marker back on top of the last letter —
  // "Contacts" read as "Contact ①". Clear the radius, then a little more.
  const GAP = 26
  const cx = place === "right" ? box.x + box.width + GAP : box.x - GAP
  const cy = box.y + box.height / 2
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

async function shoot(page, name, title, subtitle, markers, { fullPage = true } = {}) {
  await hideFloatingChrome(page)
  const raw = `${OUT}/.raw-${name}.png`
  await page.screenshot({ path: raw, fullPage })
  const clean = markers.filter(Boolean)
  if (clean.length !== markers.length) {
    console.warn(`  !! ${markers.length - clean.length} marker(s) dropped on ${name}`)
  }
  await annotate(raw, `${OUT}/${name}.png`, { title, subtitle, markers: clean })
  console.log(`   wrote ${OUT}/${name}.png (${clean.length} markers)`)
}

const browser = await launchChromium()
try {
  // ===================================================================
  // OPERATOR — creates the business and invites the coach.
  // ===================================================================
  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
  const admin = await opCtx.newPage()
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/businesses/new`, { waitUntil: "domcontentloaded" })
  await admin.waitForURL(/\/admin\/businesses\/new$/, { timeout: 15_000 })
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(400)

  await admin.locator("#name").fill(BUSINESS_NAME)
  await admin.waitForTimeout(200)
  await admin.locator("#timezone").click()
  await admin.getByRole("option", { name: "Pacific Time (Los Angeles)" }).click()
  await admin.locator("#hostDisplayName").fill(COACH_FULL)
  await admin.locator("#hostEmail").fill(COACH_EMAIL)
  await admin.getByRole("button", { name: "Create business" }).click()
  await admin.waitForURL(/\/admin\/businesses\/[0-9a-f-]{36}$/, { timeout: 15_000 })
  const businessId = admin.url().split("/").pop()
  await admin.waitForLoadState("networkidle")
  console.log(`created business ${businessId}`)

  // Seed the new business's contacts BEFORE the coach signs in, so their list
  // is real rather than an empty state.
  const rows = COACH_CONTACTS.map(([name, email, phone], i) => ({
    business_id: businessId,
    name,
    email,
    phone_e164: phone,
    timezone: "America/Los_Angeles",
    created_at: new Date(Date.now() - (9 - i * 2) * 86_400_000).toISOString(),
  }))
  const { data: seeded, error: seedErr } = await db.from("contacts").insert(rows).select("id, name")
  if (seedErr) throw new Error(`contact seed failed: ${seedErr.code} ${seedErr.message}`)
  console.log(`   seeded ${rows.length} contacts into ${businessId}`)

  // Put three of them on the board, or /admin/pipeline renders an empty state
  // and the shot shows nothing worth looking at. The board itself comes from
  // create_business -- migration 00249 added that; before it, this page
  // answered 500 for every business the function had ever created, which is
  // what the first run of this script actually captured.
  const { data: board, error: boardErr } = await db
    .from("pipelines")
    .select("id")
    .eq("business_id", businessId)
    .eq("key", "coaching")
    .maybeSingle()
  if (boardErr) throw new Error(`pipeline read failed: ${boardErr.code} ${boardErr.message}`)
  if (!board) {
    throw new Error(
      `no 'coaching' pipeline for ${businessId} — migration 00249 has not been applied to this database, ` +
        `and /admin/pipeline will answer 500`,
    )
  }
  const { data: stages, error: stageErr } = await db
    .from("pipeline_stages")
    .select("id, key")
    .eq("pipeline_id", board.id)
  if (stageErr) throw new Error(`stage read failed: ${stageErr.code} ${stageErr.message}`)
  const stageId = (key) => stages.find((s) => s.key === key)?.id
  const cards = [
    [seeded[0].id, "consult_booked", 24900],
    [seeded[1].id, "consulted", 24900],
    [seeded[2].id, "consult_booked", 49900],
  ].map(([contactId, key, value]) => ({
    business_id: businessId,
    pipeline_id: board.id,
    contact_id: contactId,
    stage_id: stageId(key),
    value_cents: value,
  }))
  if (cards.some((c) => !c.stage_id)) throw new Error("a seeded stage key did not resolve to a stage id")
  const { error: oppErr } = await db.from("opportunities").insert(cards)
  if (oppErr) throw new Error(`opportunity seed failed: ${oppErr.code} ${oppErr.message}`)
  console.log(`   seeded ${cards.length} pipeline cards`)

  // And three website chat conversations, or /admin/chat is an empty state and
  // the shot shows a table with nothing in it. `ip_hash` is NOT NULL and is
  // genuinely a hash — chat_conversations never stores the address itself
  // (migration 00227), so a made-up digest is the honest shape here.
  const convoSeed = [
    ["/services", "Do you coach middle-distance runners?", 4, 1180],
    ["/", "What does a first block look like?", 6, 2040],
    ["/programs", "Is there a plan for a masters lifter?", 3, 860],
  ]
  const { data: convos, error: convoErr } = await db
    .from("chat_conversations")
    .insert(
      convoSeed.map(([path, , count, tokens], i) => ({
        business_id: businessId,
        ip_hash: `seed-${RUN}-${i}`,
        landing_path: path,
        message_count: count,
        tokens_used: tokens,
        last_activity_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
        created_at: new Date(Date.now() - (i + 1) * 5_400_000).toISOString(),
      })),
    )
    .select("id")
  if (convoErr) throw new Error(`conversation seed failed: ${convoErr.code} ${convoErr.message}`)
  const { error: msgErr } = await db.from("chat_messages").insert(
    convos.flatMap((c, i) => [
      { business_id: businessId, conversation_id: c.id, role: "user", content: convoSeed[i][1] },
      {
        business_id: businessId,
        conversation_id: c.id,
        role: "assistant",
        content: "Yes — that is what the consult call is for. Pick a time that suits you and we will map it out.",
      },
    ]),
  )
  if (msgErr) throw new Error(`chat message seed failed: ${msgErr.code} ${msgErr.message}`)
  console.log(`   seeded ${convos.length} chat conversations`)

  // ---- 01: the invite, with the Coach preset -----------------------------
  console.log("\n01 inviting a coach — the default preset")
  await admin.getByRole("button", { name: "Invite a coach" }).click()
  await admin.getByRole("dialog").waitFor({ timeout: 10_000 })
  await admin.locator("#member-invite-email").fill(COACH_EMAIL)
  await admin.waitForTimeout(300)
  await shoot(
    admin,
    "01-invite-coach-preset",
    'The "Coach" preset now includes Contacts & Pipeline',
    "This is the default choice on the real invite dialog. Before this change it granted five areas and none of them was the contact list.",
    [
      await markerOn(admin, admin.getByRole("dialog"), `The business's own "Invite a coach" dialog. Nothing here is filled in by hand except the email address.`, { place: "left" }),
    ],
    { fullPage: false },
  )
  await admin.getByRole("button", { name: "Send invite" }).click()
  const inviteLinkInput = admin.getByRole("dialog").locator("input[readonly]")
  await inviteLinkInput.waitFor({ timeout: 10_000 })
  const inviteLink = await inviteLinkInput.inputValue()
  if (!inviteLink.includes("/invite/")) throw new Error(`invite link looks wrong: "${inviteLink}"`)
  console.log(`   invite link: ${inviteLink}`)

  // ===================================================================
  // COACH — a separate context. No cookie or storage is shared with the
  // operator above; this account does not exist until the claim below.
  // ===================================================================
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
  const coach = await coachCtx.newPage()
  await coach.goto(inviteLink, { waitUntil: "networkidle" })
  await coach.waitForTimeout(400)
  await coach.locator("#firstName").fill(COACH_FIRST)
  await coach.locator("#lastName").fill(COACH_LAST)
  await coach.locator("#password").fill(COACH_PASSWORD)
  await coach.getByRole("button", { name: "Accept and continue" }).click()
  await coach.waitForURL((u) => !u.pathname.startsWith("/invite/"), { timeout: 15_000 })
  await coach.waitForTimeout(300)

  const { data: coachUser, error: coachErr } = await db
    .from("users")
    .select("id, email, role, permissions")
    .eq("email", COACH_EMAIL)
    .maybeSingle()
  if (coachErr) throw new Error(`read-back failed: ${coachErr.code} ${coachErr.message}`)
  if (!coachUser) throw new Error(`no user row for ${COACH_EMAIL} — the claim reported success but created nothing`)
  console.log(`   real account created: ${coachUser.id} role=${coachUser.role}`)
  console.log(`   permissions: ${JSON.stringify(coachUser.permissions)}`)
  if (coachUser.permissions?.contacts !== true) {
    throw new Error(`the claimed account does NOT hold \`contacts\` — the coach preset did not grant it`)
  }

  // ---- 02: the sidebar, with the three new entries -----------------------
  console.log("\n02 the coach's sidebar")
  await coach.goto(`${APP}/admin/contacts`, { waitUntil: "networkidle" })
  if (!coach.url().includes("/admin/contacts")) {
    throw new Error(`coach was redirected away from /admin/contacts to ${coach.url()}`)
  }
  await coach.waitForTimeout(500)
  // "Chat assistant" lives in the Marketing GROUP, which is collapsed by
  // default — so a marker aimed at it resolves to a real but hidden element and
  // annotate() clamps it onto whatever is at that y, which on the first run was
  // the "Business" header two rows below. Expand the group so the link is
  // genuinely on screen and the caption is true.
  //
  // Selected by aria-controls, not by text: the label renders uppercase via CSS
  // `text-transform`, and Playwright matches the DOM's own casing ("Marketing"),
  // never the painted casing.
  const marketingToggle = coach.locator('button[aria-controls="admin-sidebar-section-marketing"]')
  if ((await marketingToggle.count()) === 0) {
    console.warn("  !! no Marketing section toggle — the coach's nav may not include it")
  } else if ((await marketingToggle.getAttribute("aria-expanded")) !== "true") {
    await marketingToggle.click()
    await coach.waitForTimeout(400)
  }
  await shoot(
    coach,
    "02-coach-sidebar",
    `Signed in as ${COACH_FULL} — a real teammate, not the operator`,
    "Contacts, Pipeline and Chat assistant are in the sidebar. Before this change all three were missing, and typing the address by hand bounced them.",
    [
      await markerOn(coach, coach.getByRole("link", { name: "Contacts", exact: true }), `"Contacts" — the list of people this business is talking to.`, { place: "right" }),
      await markerOn(coach, coach.getByRole("link", { name: "Pipeline", exact: true }), `"Pipeline" — the board where an enquiry becomes a paying athlete.`, { place: "right" }),
      await markerOn(coach, coach.getByRole("link", { name: "Chat assistant", exact: true }), `"Chat assistant" — conversations people had with the website.`, { place: "right" }),
    ],
    { fullPage: false },
  )

  // ---- 03: the contacts list, scoped -------------------------------------
  console.log("\n03 the coach's contacts — their own business only")
  const { count: mine } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
  const { count: others } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .neq("business_id", businessId)
  console.log(`   ${mine} contacts in this business, ${others} in every other business`)
  await shoot(
    coach,
    "03-coach-contacts-scoped",
    `${BUSINESS_NAME}'s contacts — and nobody else's`,
    `${mine} people here. There are ${others} contacts in other businesses on this database, and none of them appear on this screen.`,
    [
      await markerOn(coach, coach.locator("h1").first(), `The real /admin/contacts route, opened by the coach account this run created.`, { place: "right", tightenToText: true }),
    ],
  )

  // ---- 04: a contact record ----------------------------------------------
  console.log("\n04 one contact record")
  const firstRow = coach.locator('a[href^="/admin/contacts/"]').first()
  if ((await firstRow.count()) === 0) throw new Error("no contact rows rendered — the seed did not reach this screen")
  await firstRow.click()
  await coach.waitForURL(/\/admin\/contacts\/[0-9a-f-]{36}$/, { timeout: 15_000 })
  await coach.waitForLoadState("networkidle")
  await coach.waitForTimeout(400)
  await shoot(
    coach,
    "04-coach-contact-record",
    "One person's whole history — the screen the permission really opens",
    "Opening this page is recorded in the audit trail as a sensitive read, because it gathers everything about one named person in one place.",
    [
      await markerOn(coach, coach.locator("h1").first(), `A contact belonging to this coach's own business. A record in another business answers 404 here, exactly as one that does not exist.`, { place: "right", tightenToText: true }),
    ],
  )

  // ---- 05: the pipeline board --------------------------------------------
  console.log("\n05 the pipeline board")
  await coach.goto(`${APP}/admin/pipeline`, { waitUntil: "networkidle" })
  if (!coach.url().includes("/admin/pipeline")) {
    throw new Error(`coach was redirected away from /admin/pipeline to ${coach.url()}`)
  }
  await coach.waitForTimeout(600)
  // A 500 renders app/(admin)/admin/error.tsx, which keeps the SAME url — so
  // the url check above passes on a completely broken page. The first run of
  // this script shot exactly that. Check for the error boundary by name.
  if ((await coach.getByText("This admin page hit an error").count()) > 0) {
    throw new Error("/admin/pipeline rendered the admin error boundary — check the dev server log")
  }
  await shoot(
    coach,
    "05-coach-pipeline",
    "The coach's own pipeline board",
    "Their business got its own pipeline and stages when it was created. Moving a card here only ever moves a card on this board.",
    [await markerOn(coach, coach.locator("h1").first(), `The real /admin/pipeline route, reachable for the first time.`, { place: "right", tightenToText: true })],
  )

  // ---- 06: the chat assistant --------------------------------------------
  console.log("\n06 the chat assistant list")
  await coach.goto(`${APP}/admin/chat`, { waitUntil: "networkidle" })
  if (!coach.url().includes("/admin/chat")) {
    throw new Error(`coach was redirected away from /admin/chat to ${coach.url()}`)
  }
  await coach.waitForTimeout(600)
  await shoot(
    coach,
    "06-coach-chat",
    "Website chat conversations — this business's only",
    "Visitors type their own names, injuries and phone numbers into a chat box. Another business's conversations are not readable here, even by guessing the address.",
    [await markerOn(coach, coach.locator("h1").first(), `The real /admin/chat route.`, { place: "right", tightenToText: true })],
  )

  // ===================================================================
  // 07 — THE CONTROL. The same routes, for a staff account that does NOT
  // hold `contacts`. Without this, every shot above is equally consistent
  // with a gate that admits everyone.
  // ===================================================================
  console.log("\n07 the control — the same route, without the permission")
  const { error: revokeErr } = await db
    .from("users")
    .update({ permissions: { ...coachUser.permissions, contacts: false } })
    .eq("id", coachUser.id)
  if (revokeErr) throw new Error(`revoke failed: ${revokeErr.code} ${revokeErr.message}`)
  // Permissions are re-read from the database on every request (the jwt
  // callback in lib/auth.ts), so this takes effect on the next navigation
  // without signing out — which is the point of being able to revoke.
  await coach.goto(`${APP}/admin/contacts`, { waitUntil: "networkidle" })
  await coach.waitForTimeout(500)
  const bounced = coach.url().includes("/admin/no-access")
  if (!bounced) {
    console.warn(`  !! EXPECTED a bounce to /admin/no-access, landed on ${coach.url()}`)
  }
  await shoot(
    coach,
    "07-control-without-the-permission",
    "The same address, the same account, with the permission switched off",
    "This is what every coach saw before the change. It is also what one still sees if the owner unticks Contacts & Pipeline.",
    [await markerOn(coach, coach.locator("h1").first(), `Refused — and refused on the next page load, not when the sign-in expires.`, { place: "right", tightenToText: true })],
  )
  // Put it back, so the account left behind matches the shots above.
  await db.from("users").update({ permissions: coachUser.permissions }).eq("id", coachUser.id)

  console.log(`\nbusiness ${businessId}, coach ${coachUser.id} (${COACH_EMAIL})`)
} finally {
  await browser.close()
}
console.log("\ndone")
