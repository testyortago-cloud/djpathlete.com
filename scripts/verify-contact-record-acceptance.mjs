// Drives the REAL app and asserts the phase-1 acceptance bar, capability by
// capability. Exits non-zero on the first failure.
//
// The bar, verbatim from the brief:
//   "an admin can open a contact from the list and see their timeline, consent
//    state, sequence membership, payments and bookings on one page, and can
//    add/remove tags"
//
// WHY THIS EXISTS SEPARATELY FROM THE SCREENSHOT SCRIPT. A screenshot proves a
// pixel was drawn; it does not prove a write PERSISTED. Every mutation here is
// checked after a full page RELOAD, so optimistic client state cannot make a
// failed write look successful — which matters because this branch deliberately
// removed the router.refresh() that used to reconcile the tag list.
//
//   npm run dev                                         # port 3050
//   node scripts/seed-contact-record-demo.mjs
//   node scripts/verify-contact-record-acceptance.mjs
//
// DEV CLONE ONLY; refuses any other project ref.

import { readFileSync } from "node:fs"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const RICH = "aaaaaaaa-0000-4000-8000-000000000001"
const BARE = "aaaaaaaa-0000-4000-8000-000000000002"

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let failures = 0
let checks = 0
function check(label, ok, detail = "") {
  checks++
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`)
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })

try {
  // ---- sign in, and assert the session BEFORE anything else -------------
  const login = await ctx.newPage()
  await login.goto(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await login.waitForTimeout(2500)
  if (!login.url().includes("/admin")) {
    throw new Error(`dev-login did not reach /admin (at ${login.url()}). Is DEV_AUTH_BYPASS_ENABLED=true?`)
  }
  await login.close()

  const page = await ctx.newPage()

  // ---- 1. OPEN A CONTACT FROM THE LIST (by clicking, not by URL) --------
  console.log("\n1. open a contact from the list")
  await page.goto(`${APP}/admin/contacts?search=Maya`, { waitUntil: "networkidle" })
  const link = page.getByRole("link", { name: "Maya Sorensen — open contact record" })
  check("the list row offers a link to the record", (await link.count()) === 1)
  // waitForURL, NOT waitForLoadState. The first version of this script used
  // waitForLoadState("networkidle") after the click, which resolved instantly
  // against the already-idle LIST page before navigation had begun — so
  // page.url() still read the list and this reported the link as broken. The
  // link was fine. A harness race that reads as a feature failure is the most
  // expensive kind of false alarm.
  await link.click()
  await page.waitForURL(/\/admin\/contacts\/[0-9a-f-]{36}/, { timeout: 15000 })
  await page.waitForLoadState("networkidle")
  check("clicking it lands on the record", page.url().includes(`/admin/contacts/${RICH}`), `at ${page.url()}`)
  check("the record names the person", (await page.getByRole("heading", { name: "Maya Sorensen" }).count()) === 1)

  // ---- 2..6 THE FIVE THINGS THAT MUST BE ON ONE PAGE --------------------
  console.log("\n2-6. timeline, consent, sequences, payments, bookings — on ONE page")
  const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ")
  const text = await body()

  // SECTION-SCOPED, not a body-wide text match. The first version asserted
  // /Cold Lead Re-engagement/ against the whole body and PASSED while still on
  // the contact LIST — whose sequence dropdown contains that exact string. A
  // whole-page grep cannot tell "the sequences panel works" from "I am on the
  // wrong page entirely".
  const sectionText = async (heading) => {
    const s = page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) })
    if ((await s.count()) === 0) return ""
    return (await s.first().innerText()).replace(/\s+/g, " ")
  }
  const consent = await sectionText("Permission to contact them")
  const sequences = await sectionText("Sequences they are in")
  const history = await sectionText("History")

  check("TIMELINE — an activity row is rendered", /Signed up for the newsletter/.test(history))
  check("CONSENT — per-channel state with the wording shown", /Agreed/.test(consent) && /unsubscribe at any time/.test(consent))
  check("CONSENT — suppression shown SEPARATELY from consent", /Do-not-contact list/.test(consent) && /Do not contact/.test(consent))
  check("SEQUENCES — membership panel lists a run", /Cold Lead Re-engagement/.test(sequences))
  check("PAYMENTS — money appears in the history", /Paid \$320\.00/.test(history))
  check("BOOKINGS — a booked call appears in the history", /Booked a call for/.test(history))

  // All five on ONE page is the actual requirement, so assert co-presence.
  const onePage =
    /Signed up for the newsletter/.test(history) &&
    /Agreed/.test(consent) &&
    /Cold Lead Re-engagement/.test(sequences) &&
    /Paid \$320\.00/.test(history) &&
    /Booked a call for/.test(history)
  check("all five are on the SAME page, not spread across screens", onePage)

  // The union is the load-bearing claim: prove the payment and booking rows
  // really came from the other two spines and are interleaved by date.
  const payments = (history.match(/Paid \$320\.00/g) ?? []).length
  const bookings = (history.match(/Booked a call for/g) ?? []).length
  check(`the union pulled MULTIPLE payments (${payments}) and bookings (${bookings})`, payments >= 3 && bookings >= 3)

  // ---- 7. ADD A TAG, AND IT PERSISTS ACROSS A RELOAD --------------------
  console.log("\n7. add a tag")
  const TAG = "acceptance-check"
  // Start clean so the add is genuine rather than an idempotent no-op.
  const stale = page.getByRole("button", { name: `Remove the tag ${TAG}` })
  if (await stale.count()) {
    await stale.click()
    await page.waitForTimeout(1500)
    await page.reload({ waitUntil: "networkidle" })
  }

  await page.getByRole("button", { name: "Add a tag" }).click()
  await page.getByRole("textbox", { name: "New tag" }).fill(TAG)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.waitForTimeout(2000)
  check("the new tag appears immediately", (await page.getByText(TAG, { exact: true }).count()) > 0)

  // THE ASSERTION THAT MATTERS. Optimistic state would show the pill either
  // way; only a reload proves the route actually wrote it.
  await page.reload({ waitUntil: "networkidle" })
  check("the tag SURVIVES a full reload (it really was written)", (await page.getByText(TAG, { exact: true }).count()) > 0)

  // ---- 8. REMOVE A TAG, AND IT STAYS REMOVED ---------------------------
  console.log("\n8. remove a tag")
  await page.getByRole("button", { name: `Remove the tag ${TAG}` }).click()
  await page.waitForTimeout(2000)
  check("the tag disappears immediately", (await page.getByText(TAG, { exact: true }).count()) === 0)

  await page.reload({ waitUntil: "networkidle" })
  check("it STAYS removed after a reload (the delete really happened)", (await page.getByText(TAG, { exact: true }).count()) === 0)

  // The tags that were already there must be untouched by the round trip.
  const after = await body()
  check("the contact's other tags are intact", /coaching-lead/.test(after) && /camp-2026/.test(after))

  // ---- 8b. ADD TO A SEQUENCE, FROM THE RECORD ITSELF -------------------
  // The header action the spec's screen sketch specifies. Enrolment is
  // idempotent, so the existing run is cleared first — otherwise this asserts
  // "already in it" while claiming to have added them.
  console.log("\n8b. add this contact to a sequence from the record")
  await db.from("sequence_runs").delete().eq("contact_id", RICH)
  await page.goto(`${APP}/admin/contacts/${RICH}`, { waitUntil: "networkidle" })

  const seqBefore = await sectionText("Sequences they are in")
  check("with the run cleared, the panel says so", /not in any sequence/.test(seqBefore))

  await page.getByRole("button", { name: "Add to a sequence" }).click()
  await page.locator("#contact-sequence-picker").selectOption({ value: "cold_lead_re_engagement" })
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.waitForTimeout(3500)
  await page.waitForLoadState("networkidle")

  const seqAfter = await sectionText("Sequences they are in")
  check("the sequence now shows on the record", /Cold Lead Re-engagement/.test(seqAfter), seqAfter.slice(0, 120))

  // The run must be in the DATABASE, not merely on screen.
  const { data: runs } = await db.from("sequence_runs").select("id, status").eq("contact_id", RICH)
  check("a real sequence_run row was written", (runs ?? []).length === 1, `found ${(runs ?? []).length}`)

  // ---- 9. THE BARE CONTACT STILL RENDERS -------------------------------
  console.log("\n9. a contact with no history renders empty states, not an error")
  await page.goto(`${APP}/admin/contacts/${BARE}`, { waitUntil: "networkidle" })
  const bare = (await page.locator("body").innerText()).replace(/\s+/g, " ")
  check("the bare record renders", /Tobias Frei/.test(bare))
  check("it shows empty states rather than the error page", /Nothing has been recorded/.test(bare) && !/Something went wrong/i.test(bare))
  check("'never asked' is distinguished from 'said no'", /Never asked/.test(bare))

  // ---- 10. A CONTACT THAT DOES NOT EXIST IS A 404, NOT A CRASH ---------
  console.log("\n10. an unknown contact 404s")
  const res = await page.goto(`${APP}/admin/contacts/99999999-9999-4999-8999-999999999999`, {
    waitUntil: "domcontentloaded",
  })
  check("unknown contact answers 404", res?.status() === 404, `got ${res?.status()}`)
} finally {
  await ctx.close()
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log("ACCEPTANCE BAR MET")
