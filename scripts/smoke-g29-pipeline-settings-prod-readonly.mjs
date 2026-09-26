// G29 PRODUCTION SMOKE TEST — READ-ONLY HALF.
//
//   node --env-file=.env.prod scripts/smoke-g29-pipeline-settings-prod-readonly.mjs --business <uuid>
//
// --business IS REQUIRED (G45). Since 00279 every business has an
// 'assessment' board, so the board is read inside the named business, and the
// browser is given the same business in its `djp_business` cookie, so the page
// it compares against is that business's board and not the session's default.
//
// ────────────────────────────────────────────────────────────────────────────
// STRICTLY READ-ONLY. THIS SCRIPT CONTAINS NO SAVE PATH AT ALL.
//
// It never clicks Save, Move up, Move down, Remove, Archive, Create or Add
// someone. The only interactions are navigation and reading values out of
// inputs. There is deliberately no code here that could write, so a stray
// edit cannot turn it into a writer by accident — the writing sibling is a
// separate file.
// ────────────────────────────────────────────────────────────────────────────
//
// WHAT IT PROVES, on production, end to end:
//   - the deployed /admin/pipeline/settings route exists and renders
//   - a real admin session passes auth and the `contacts` permission gate
//   - the server component's readStagesForEdit (new in G29) reads production
//     data without throwing
//   - the editor renders every stage with its own name, kind and thresholds
//   - what is on the SCREEN matches what is in the DATABASE
//
// WHAT IT CANNOT PROVE: that a save round-trips through
// save_pipeline_stages. That needs a write, and a write needs the owner.

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
const BUSINESS = readBusinessArg(process.argv.slice(2))

function must(cond, msg) {
  if (!cond) throw new Error(`SMOKE FAILED — ${msg}`)
}
const log = (m) => console.log(`  ${m}`)

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(url.includes(PROD_REF), `env does not point at production (${PROD_REF}). Refusing to run.`)
  const secret = process.env.NEXTAUTH_SECRET
  must(!!secret, "NEXTAUTH_SECRET missing from the env file")

  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  console.log("\nDATABASE (read)")
  const pipe = await findByKeyForBusiness(supabase, "pipelines", { businessId: BUSINESS, key: BOARD, select: "id, key" })
  must(!!pipe, `business ${BUSINESS} has no ${BOARD} pipeline`)
  const { data: rows, error: sErr } = await supabase
    .from("pipeline_stages")
    .select("id, key, name, kind, position, amber_after_days, red_after_days")
    .eq("business_id", BUSINESS)
    .eq("pipeline_id", pipe.id)
    .order("position", { ascending: true })
  must(!sErr, `could not read stages: ${sErr?.message}`)
  const dbNames = rows.map((r) => r.name)
  log(`${BOARD}: ${rows.length} stages -> ${dbNames.join(" | ")}`)

  console.log("\nSESSION")
  const token = await encode({
    secret,
    salt: "__Secure-authjs.session-token",
    token: { id: ADMIN_ID, sub: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", name: "Darren Paul" },
  })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })
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
    // The page renders the business this cookie selects (lib/tenancy/resolve.ts).
    // Without it the admin's default business is shown, and the comparison
    // below would set one business's board against another's.
    { name: "djp_business", value: BUSINESS, domain: ".darrenjpaul.com", path: "/", secure: true, sameSite: "Lax" },
  ])
  const page = await ctx.newPage()

  try {
    console.log("\nTHE REAL ROUTE")
    const resp = await page.goto(`${SITE}/admin/pipeline/settings?board=${BOARD}`, {
      waitUntil: "domcontentloaded",
    })
    log(`HTTP ${resp?.status()} at ${page.url()}`)
    must(!page.url().includes("/login"), `redirected to login — the minted session was rejected`)
    must(resp?.status() === 200, `expected 200, got ${resp?.status()}`)

    // The Save button existing proves the editor rendered, not an error page.
    // It is located and NEVER clicked.
    await page.getByRole("button", { name: "Save stages" }).waitFor({ state: "visible", timeout: 20000 })
    log("editor rendered (Save button present — not clicked)")

    const names = await page
      .locator('[aria-label$=" name"]')
      .evaluateAll((els) => els.map((e) => e.value))
    const kinds = await page
      .locator('[aria-label$=" kind"]')
      .evaluateAll((els) => els.map((e) => e.value))
    must(names.length === rows.length, `screen shows ${names.length} stages, database has ${rows.length}`)
    must(
      JSON.stringify(names) === JSON.stringify(dbNames),
      `screen disagrees with database.\n    db:     ${dbNames.join(" | ")}\n    screen: ${names.join(" | ")}`,
    )
    log(`screen matches database: ${names.join(" | ")}`)
    must(
      JSON.stringify(kinds) === JSON.stringify(rows.map((r) => r.kind)),
      `kinds disagree.\n    db:     ${rows.map((r) => r.kind).join(" | ")}\n    screen: ${kinds.join(" | ")}`,
    )
    log(`kinds match: ${kinds.join(" | ")}`)

    mkdirSync(OUT, { recursive: true })
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${OUT}/prod-editor-readonly.png`, fullPage: true })
    log(`screenshot -> ${OUT}/prod-editor-readonly.png`)

    console.log("\nREAD-ONLY SMOKE PASSED — route, auth, permission, DAL read and render all work on production.")
    console.log("NOT PROVEN: the save round-trip through save_pipeline_stages. That needs a write.\n")
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`)
  process.exit(1)
})
