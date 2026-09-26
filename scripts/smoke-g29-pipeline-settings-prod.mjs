// G29 PRODUCTION SMOKE TEST — drives the REAL /admin/pipeline/settings on
// https://www.darrenjpaul.com and proves the deployed route, DAL and
// save_pipeline_stages RPC agree with each other.
//
//   node --env-file=.env.prod scripts/smoke-g29-pipeline-settings-prod.mjs --business <uuid>
//
// --business IS REQUIRED (G45), and here it guards a WRITE. Since 00279 every
// business has an 'assessment' board. The empty-board precondition below is
// checked on the named business's board, and the browser is sent the same
// business in its `djp_business` cookie, so the board the UI reorders is the
// board that was checked. Without that, "this board has no cards" could be
// true of one business while the reorder lands on another's.
//
// ────────────────────────────────────────────────────────────────────────────
// THIS SCRIPT WRITES TO PRODUCTION. It was run once, with the owner's explicit
// go-ahead, after the concern was raised twice.
//
// It is reversible BY CONSTRUCTION:
//   - Subject is the `assessment` board, which holds ZERO cards on all four
//     stages. A reorder there cannot disturb anything a coach is looking at.
//   - A reorder submits every stage, so `planStageSave` emits NO removals and
//     NO card moves. The SQL's DELETE and its card-move UPDATE never run.
//   - The original order is restored through the same UI before exit, and the
//     restore is VERIFIED, not assumed.
//
// It refuses to run unless the env really is production AND the subject board
// really is empty. Both are checked against the database, not asserted.
//
// EVERY HELPER FAILS LOUDLY AND NAMES ITS STEP. A capture script on this very
// branch once reported "the app said nothing" when the truth was a click
// landing on a still-disabled button. A silent no-op in a script that writes
// to a shared database is one edit away from a write nobody notices.
// ────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js"
import { encode } from "next-auth/jwt"
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { findByKeyForBusiness, readBusinessArg } from "./_business-scope.mjs"

const SITE = "https://www.darrenjpaul.com"
const PROD_REF = "epzuvzkokzqtzomeyoha"
const BOARD = "assessment"
const ADMIN_ID = "00000000-0000-0000-0000-000000000001"
const ADMIN_EMAIL = "admin@darrenjpaul.com"
const OUT = "screenshots/g29-prod-smoke"
const WIDTH = 1440
const DSF = 2
const BUSINESS = readBusinessArg(process.argv.slice(2))

function must(cond, msg) {
  if (!cond) throw new Error(`SMOKE FAILED — ${msg}`)
}

const log = (m) => console.log(`  ${m}`)

async function stageRows(supabase) {
  const pipe = await findByKeyForBusiness(supabase, "pipelines", {
    businessId: BUSINESS,
    key: BOARD,
    select: "id, key, business_id",
  })
  must(!!pipe, `business ${BUSINESS} has no ${BOARD} pipeline`)

  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, key, name, kind, position")
    .eq("business_id", BUSINESS)
    .eq("pipeline_id", pipe.id)
    .order("position", { ascending: true })
  must(!error, `could not read stages: ${error?.message}`)
  return { pipelineId: pipe.id, rows: data }
}

async function cardCount(supabase, stageIds) {
  const { count, error } = await supabase
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .in("stage_id", stageIds)
  must(!error, `could not count cards: ${error?.message}`)
  return count ?? 0
}

/** Reads the stage order off the SCREEN, not the database. */
async function orderOnScreen(page) {
  const names = await page.locator('[aria-label$=" name"]').evaluateAll((els) =>
    els.map((e) => /** @type {HTMLInputElement} */ (e).value),
  )
  must(names.length > 0, "no stage name inputs found on the settings screen")
  return names
}

async function saveAndConfirm(page, expected, step) {
  const save = page.getByRole("button", { name: "Save stages" })
  await save.waitFor({ state: "visible", timeout: 15000 })
  must(!(await save.isDisabled()), `${step}: the Save button is disabled, so the click would be a no-op`)
  await save.click()

  // The button reads "Saving…" while in flight and returns to "Save stages".
  // Waiting for the RELOADED order is the real proof — a toast can appear on a
  // route that wrote nothing.
  await page.waitForTimeout(1500)
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Save stages" }).waitFor({ state: "visible", timeout: 15000 })
  const after = await orderOnScreen(page)
  must(
    JSON.stringify(after) === JSON.stringify(expected),
    `${step}: the saved order did not survive a reload.\n    wanted: ${expected.join(" | ")}\n    got:    ${after.join(" | ")}`,
  )
  return after
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(url.includes(PROD_REF), `env does not point at production (${PROD_REF}). Refusing to run.`)
  const secret = process.env.NEXTAUTH_SECRET
  must(!!secret, "NEXTAUTH_SECRET missing from the env file")

  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  console.log("\nPRECONDITIONS")
  const before = await stageRows(supabase)
  const ids = before.rows.map((r) => r.id)
  const cards = await cardCount(supabase, ids)
  must(cards === 0, `the ${BOARD} board holds ${cards} card(s). Refusing to reorder a board with cards on it.`)
  log(`${BOARD} board: ${before.rows.length} stages, ${cards} cards`)
  const originalOrder = before.rows.map((r) => r.name)
  log(`original order: ${originalOrder.join(" | ")}`)
  must(before.rows.length >= 3, "expected at least three stages to reorder")

  console.log("\nSESSION")
  const token = await encode({
    secret,
    salt: "__Secure-authjs.session-token",
    token: { id: ADMIN_ID, sub: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", name: "Darren Paul" },
  })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1100 }, deviceScaleFactor: DSF })
  await ctx.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: token,
      domain: ".darrenjpaul.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
    // The page renders the business this cookie selects (lib/tenancy/resolve.ts),
    // so the board the UI reorders is the board the precondition checked.
    { name: "djp_business", value: BUSINESS, domain: ".darrenjpaul.com", path: "/", secure: true, sameSite: "Lax" },
  ])
  const page = await ctx.newPage()

  try {
    // SESSION ASSERTED BEFORE ANY SCREEN IS JUDGED. A harness without this
    // happily photographs the login page and reports success.
    await page.goto(`${SITE}/admin/pipeline/settings?board=${BOARD}`, { waitUntil: "domcontentloaded" })
    must(!page.url().includes("/login"), `redirected to login — the minted session was rejected (at ${page.url()})`)
    await page.getByRole("button", { name: "Save stages" }).waitFor({ state: "visible", timeout: 20000 })
    log(`signed in, editor rendered at ${page.url()}`)

    mkdirSync(OUT, { recursive: true })
    const onScreen = await orderOnScreen(page)
    must(
      JSON.stringify(onScreen) === JSON.stringify(originalOrder),
      `the screen disagrees with the database before any change.\n    db:     ${originalOrder.join(" | ")}\n    screen: ${onScreen.join(" | ")}`,
    )
    log(`screen matches the database: ${onScreen.join(" | ")}`)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${OUT}/01-before.png`, fullPage: true })

    console.log("\nTHE WRITE — moving stage 2 up, through the real control")
    const moveUp = page.getByRole("button", { name: "Move stage 2 up" })
    await moveUp.waitFor({ state: "visible", timeout: 10000 })
    await moveUp.click()
    const swapped = [onScreen[1], onScreen[0], ...onScreen.slice(2)]
    const afterClick = await orderOnScreen(page)
    must(
      JSON.stringify(afterClick) === JSON.stringify(swapped),
      `the Move up button did not reorder the list.\n    wanted: ${swapped.join(" | ")}\n    got:    ${afterClick.join(" | ")}`,
    )
    log(`reordered on screen: ${afterClick.join(" | ")}`)

    const saved = await saveAndConfirm(page, swapped, "save")
    log(`SAVED and survived a reload: ${saved.join(" | ")}`)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${OUT}/02-after-save.png`, fullPage: true })

    const dbAfter = await stageRows(supabase)
    const dbOrder = dbAfter.rows.map((r) => r.name)
    must(
      JSON.stringify(dbOrder) === JSON.stringify(swapped),
      `the DATABASE does not show the new order.\n    wanted: ${swapped.join(" | ")}\n    got:    ${dbOrder.join(" | ")}`,
    )
    log(`database agrees: positions rewritten by save_pipeline_stages`)

    console.log("\nRESTORE")
    const moveBack = page.getByRole("button", { name: "Move stage 2 up" })
    await moveBack.click()
    const restoredOnScreen = await orderOnScreen(page)
    must(
      JSON.stringify(restoredOnScreen) === JSON.stringify(originalOrder),
      `the restore click did not put the list back.\n    wanted: ${originalOrder.join(" | ")}\n    got:    ${restoredOnScreen.join(" | ")}`,
    )
    await saveAndConfirm(page, originalOrder, "restore")

    const dbFinal = await stageRows(supabase)
    const finalOrder = dbFinal.rows.map((r) => r.name)
    must(
      JSON.stringify(finalOrder) === JSON.stringify(originalOrder),
      `RESTORE FAILED — production is left reordered.\n    wanted: ${originalOrder.join(" | ")}\n    got:    ${finalOrder.join(" | ")}`,
    )
    // Positions themselves, not just the order, must be back to 1..n.
    const positions = dbFinal.rows.map((r) => r.position)
    must(
      JSON.stringify(positions) === JSON.stringify(before.rows.map((r) => r.position)),
      `positions differ after restore: ${positions.join(",")} vs ${before.rows.map((r) => r.position).join(",")}`,
    )
    log(`RESTORED and verified: ${finalOrder.join(" | ")} at positions ${positions.join(",")}`)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${OUT}/03-restored.png`, fullPage: true })

    const cardsAfter = await cardCount(supabase, ids)
    must(cardsAfter === 0, `card count changed from 0 to ${cardsAfter} — something moved cards`)

    console.log("\nSMOKE TEST PASSED — the deployed route, DAL and RPC agree, and production is as it was found.\n")
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`)
  console.error("If this failed AFTER the save and BEFORE the restore, production is left reordered.")
  console.error("Restore by hand from the snapshot printed above under PRECONDITIONS.\n")
  process.exit(1)
})
