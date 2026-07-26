/**
 * Seed a filmable AI Bookkeeper demo dataset into the DEV Supabase project.
 *
 * WHY IT REPLACES RATHER THAN APPENDS: the dev project is a clone of prod, so
 * its ledger carries real client names and emails. Insights and the Reports
 * per-book summary are NOT book-scoped (listEntriesForInsights /
 * listAccountsForReports take no book filter), so adding a "demo book" would
 * leave the real rows on camera anyway. This wipes the bookkeeping_* tables in
 * dev and rewrites them with invented data.
 *
 * Volumes are chosen to clear the exact thresholds the finders use — below
 * them the screens render empty and there is nothing to film. See
 * docs/superpowers/specs/2026-07-26-bookkeeper-walkthrough-video-design.md §1B.
 *
 * Deterministic: same input every run, so a re-record matches the last take.
 *
 * Run:   npx tsx scripts/seed-bookkeeping-demo.ts
 * Undo:  npx tsx scripts/seed-bookkeeping-demo.ts --clean
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const PROD_REF = "epzuvzkokzqtzomeyoha"
const BUSINESS = "b0000000-0000-4000-8000-000000000001"
const HOUSEHOLD = "b0000000-0000-4000-8000-000000000003"
const CLEAN = process.argv.includes("--clean")

// Anchor everything to a fixed year so report presets ("This year") always hit.
const YEAR = 2026
const d = (m: number, day: number) => `${YEAR}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`

function loadEnv() {
  const text = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
  const pick = (k: string) => {
    const m = text.match(new RegExp(`^${k}=(.*)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
  }
  return { url: pick("NEXT_PUBLIC_SUPABASE_URL"), key: pick("SUPABASE_SERVICE_ROLE_KEY") }
}

/** Invented vendors only — nothing copied from the real ledger. */
const MONTHLY_DAYS = [
  [3, 5], [4, 4], [5, 5], [6, 4], [7, 5],
] as const // ~30-31 day gaps -> vendor-sweep monthly cadence (needs median gap 25-35)

const SOFTWARE_DAYS = [
  [3, 12], [4, 11], [5, 12], [6, 11], [7, 12],
] as const

type Row = Record<string, unknown>

async function wipe(sb: SupabaseClient) {
  // Order matters: children before parents.
  const tables = [
    "bookkeeping_payout_lines",
    "bookkeeping_payouts",
    "bookkeeping_finding_dismissals",
    "bookkeeping_period_closes",
    "bookkeeping_assets",
    "bookkeeping_ledger_entries",
    "bookkeeping_documents",
  ]
  for (const t of tables) {
    // PostgREST refuses an unfiltered DELETE; filter on the one column every
    // one of these tables shares (id) rather than created_at, which
    // bookkeeping_finding_dismissals does not have (it uses dismissed_at).
    const { error } = await sb.from(t).delete().not("id", "is", null)
    if (error) throw new Error(`wipe ${t}: ${error.message}`)
    process.stdout.write(`  cleared ${t}\n`)
  }
}

async function main() {
  const { url, key } = loadEnv()
  const ref = url.replace(/^https?:\/\//, "").split(".")[0]
  if (ref === PROD_REF) throw new Error(`REFUSING TO RUN: .env.local resolves to PRODUCTION (${ref}).`)
  if (process.env.NODE_ENV === "production") throw new Error("REFUSING TO RUN: NODE_ENV=production")
  console.log(`Target dev project: ${ref}${CLEAN ? "  (--clean)" : ""}\n`)

  const sb = createClient(url, key, { auth: { persistSession: false } })

  console.log("wiping bookkeeping tables:")
  await wipe(sb)
  if (CLEAN) {
    console.log("\nclean complete — bookkeeping tables are empty.")
    return
  }

  // ---- account id lookup -------------------------------------------------
  const { data: accounts, error: accErr } = await sb
    .from("bookkeeping_accounts")
    .select("id,name,book_id,account_type,service_line")
  if (accErr) throw new Error(accErr.message)
  const acc = (book: string, name: string) => {
    const a = accounts!.find((x) => x.book_id === book && x.name.toLowerCase() === name.toLowerCase())
    if (!a) throw new Error(`account not found: ${name}`)
    return a.id as string
  }

  // Give two business expense accounts a service line so profit-by-line shows
  // DIRECT costs; everything else stays null and becomes the shared bucket the
  // allocation toggle distributes.
  for (const [name, line] of [["Equipment", "performance_training"], ["Software & Subscriptions", "teams_center"]] as const) {
    const { error } = await sb.from("bookkeeping_accounts").update({ service_line: line }).eq("id", acc(BUSINESS, name))
    if (error) throw new Error(`service_line ${name}: ${error.message}`)
  }
  console.log("\nset service_line on 2 expense accounts (direct vs shared cost demo)")

  // ---- documents ---------------------------------------------------------
  const docs: Row[] = []
  const docId: string[] = []
  for (let i = 0; i < 10; i++) {
    const id = crypto.randomUUID()
    docId.push(id)
    const isStatement = i < 3
    docs.push({
      id,
      book_id: BUSINESS,
      kind: isStatement ? "statement" : "receipt",
      original_filename: isStatement ? `statement-${YEAR}-0${i + 4}.pdf` : `receipt-${i}.jpg`,
      storage_path: `bookkeeping/demo/${id}/${isStatement ? "statement.pdf" : "receipt.jpg"}`,
      mime_type: isStatement ? "application/pdf" : "image/jpeg",
      file_size_bytes: 180_000 + i * 4_321,
      retain_until: `${YEAR + 7}-12-31`,
      row_count: isStatement ? 42 : 1,
      posted_count: isStatement ? 42 : 1,
    })
  }
  const { error: docErr } = await sb.from("bookkeeping_documents").insert(docs)
  if (docErr) throw new Error(`documents: ${docErr.message}`)
  console.log(`inserted ${docs.length} documents`)

  // ---- ledger ------------------------------------------------------------
  const entries: Row[] = []
  let n = 0
  const push = (r: Row) => entries.push({ id: crypto.randomUUID(), currency: "usd", source_ref: `demo:${++n}`, ...r })

  // Income across service lines, Jan-Jul, invented client labels.
  const incomeSpec: Array<[string, number, number, number, string]> = [
    ["Performance Training — Sports", 1, 14, 45000, "Jordan M. — 10-session block"],
    ["Performance Training — Stripe", 1, 28, 32500, "Riley T. — monthly training"],
    ["Teams / Center Work", 2, 6, 120000, "Northside HS — winter team block"],
    ["Session Packs", 2, 19, 60000, "Avery K. — 12-pack"],
    ["Camps & Clinics", 3, 7, 185000, "Spring break camp — 14 athletes"],
    ["Performance Training — Sports", 3, 21, 45000, "Jordan M. — renewal"],
    ["Memberships", 4, 2, 24900, "Membership — Casey L."],
    ["Performance Training — Stripe", 4, 16, 32500, "Riley T. — monthly training"],
    ["Teams / Center Work", 5, 8, 95000, "Westlake Academy — spring block"],
    ["Session Packs", 5, 22, 60000, "Morgan P. — 12-pack"],
    ["Camps & Clinics", 6, 12, 210000, "Summer camp week 1"],
    ["Memberships", 6, 2, 24900, "Membership — Casey L."],
    ["Shop", 6, 25, 8400, "Resistance band set"],
    ["Performance Training — Sports", 7, 9, 45000, "Quinn D. — 10-session block"],
    ["Camps & Clinics", 7, 14, 195000, "Summer camp week 3"],
    ["Memberships", 7, 2, 24900, "Membership — Casey L."],
  ]
  for (const [name, m, day, cents, memo] of incomeSpec) {
    push({
      book_id: BUSINESS, account_id: acc(BUSINESS, name), direction: "income",
      amount_cents: cents, occurred_on: d(m, day), memo, counterparty: memo.split(" — ")[0],
      source: "platform_import",
    })
  }

  // Recurring vendor #1 — monthly cadence on Equipment.
  for (const [m, day] of MONTHLY_DAYS) {
    push({
      book_id: BUSINESS, account_id: acc(BUSINESS, "Equipment"), direction: "expense",
      amount_cents: 18900, occurred_on: d(m, day), memo: "Monthly equipment resupply",
      counterparty: "Northgate Sports Supply", source: "statement_import",
      business_purpose: "Training equipment for athlete sessions",
    })
  }
  // Recurring vendors #2 and #3 — both monthly on the SAME account, which is
  // what trips vendor-sweep's duplicate_group (two monthly vendors, one account).
  for (const [m, day] of SOFTWARE_DAYS) {
    push({
      book_id: BUSINESS, account_id: acc(BUSINESS, "Software & Subscriptions"), direction: "expense",
      amount_cents: 4900, occurred_on: d(m, day), memo: "Video analysis subscription",
      counterparty: "Kinetic Video Cloud", source: "statement_import",
      business_purpose: "Athlete video breakdown",
    })
    push({
      book_id: BUSINESS, account_id: acc(BUSINESS, "Software & Subscriptions"), direction: "expense",
      amount_cents: 2400, occurred_on: d(m, day), memo: "Clip editing subscription",
      counterparty: "ClipStudio Pro", source: "statement_import",
      business_purpose: "Social clips for programs",
    })
  }

  // Substantiation gaps: purpose-required accounts left blank, older than the
  // watchdog's 14-day minimum age so they actually surface.
  const gapSpec: Array<[string, number, number, number, string, string]> = [
    ["Travel", 3, 18, 42800, "Flight — coaching clinic", "Skyline Air"],
    ["Meals (business purpose)", 4, 9, 6250, "Lunch meeting", "Corner Deli"],
    ["Vehicle", 4, 27, 8900, "Fuel", "QuickFuel"],
    ["Travel", 5, 15, 31500, "Hotel — recruiting showcase", "Lakeside Inn"],
    ["Meals (business purpose)", 6, 3, 5480, "Team meal", "Corner Deli"],
    ["Vehicle", 6, 20, 9250, "Fuel", "QuickFuel"],
  ]
  for (const [name, m, day, cents, memo, cp] of gapSpec) {
    push({
      book_id: BUSINESS, account_id: acc(BUSINESS, name), direction: "expense",
      amount_cents: cents, occurred_on: d(m, day), memo, counterparty: cp,
      source: "receipt", business_purpose: null,
    })
  }

  // Well-formed receipt-backed expenses (document_id linked -> paperclip).
  const okSpec: Array<[string, number, number, number, string, string]> = [
    ["Equipment", 2, 11, 34500, "Medicine ball set", "Northgate Sports Supply"],
    ["Professional Fees", 2, 24, 75000, "Accountant — annual filing", "Bell & Associates CPA"],
    ["Phone & Internet", 3, 1, 8900, "Business line", "Metro Telecom"],
    ["Phone & Internet", 4, 1, 8900, "Business line", "Metro Telecom"],
    ["Equipment", 5, 17, 22800, "Agility ladder + cones", "Northgate Sports Supply"],
    ["Professional Fees", 6, 8, 25000, "Legal — waiver review", "Hartley Legal"],
    ["Phone & Internet", 6, 1, 8900, "Business line", "Metro Telecom"],
    ["Equipment", 7, 8, 41200, "Force plate maintenance", "Northgate Sports Supply"],
  ]
  okSpec.forEach(([name, m, day, cents, memo, cp], i) => {
    push({
      book_id: BUSINESS, account_id: acc(BUSINESS, name), direction: "expense",
      amount_cents: cents, occurred_on: d(m, day), memo, counterparty: cp,
      source: "receipt", business_purpose: "Business operations",
      document_id: docId[3 + (i % 7)],
    })
  })

  // Uncategorized expenses -> the Insights sweep + amber rows on Reports.
  const uncatSpec: Array<[number, number, number, string, string]> = [
    [3, 26, 12400, "Card purchase", "Riverside Market"],
    [4, 14, 7800, "Card purchase", "Fuel Stop 12"],
    [5, 2, 15900, "Card purchase", "Office Supply Co"],
    [5, 29, 4300, "Card purchase", "Riverside Market"],
    [6, 17, 9600, "Card purchase", "Parkside Cafe"],
    [6, 30, 21500, "Card purchase", "Gear Outlet"],
    [7, 6, 6700, "Card purchase", "Fuel Stop 12"],
    [7, 19, 13850, "Card purchase", "Office Supply Co"],
  ]
  for (const [m, day, cents, memo, cp] of uncatSpec) {
    push({
      book_id: BUSINESS, account_id: null, direction: "expense",
      amount_cents: cents, occurred_on: d(m, day), memo, counterparty: cp,
      source: "statement_import",
    })
  }

  // Household rows on the exact home-office allowlist names.
  const houseSpec: Array<[string, number[], number]> = [
    ["Rent", [2, 3, 4, 5, 6, 7], 195000],
    ["Utilities", [2, 3, 4, 5, 6, 7], 18400],
    ["Internet", [2, 3, 4, 5, 6, 7], 8900],
    ["Renter's Insurance", [2, 5], 14200],
    ["Home Repairs & Maintenance", [4, 6], 26500],
  ]
  for (const [name, months, cents] of houseSpec) {
    for (const m of months) {
      push({
        book_id: HOUSEHOLD, account_id: acc(HOUSEHOLD, name), direction: "expense",
        amount_cents: cents, occurred_on: d(m, 1), memo: name, counterparty: `${name} provider`,
        source: "manual",
      })
    }
  }

  const { error: entErr } = await sb.from("bookkeeping_ledger_entries").insert(entries)
  if (entErr) throw new Error(`ledger: ${entErr.message}`)
  console.log(`inserted ${entries.length} ledger entries`)

  // ---- payouts + lines ---------------------------------------------------
  const payouts: Row[] = []
  const lines: Row[] = []
  const payoutSpec: Array<[number, number, number[]]> = [
    [5, 6, [45000, 32500, 24900]],
    [5, 20, [60000, 8400]],
    [6, 5, [24900, 210000]],
    [6, 19, [32500, 45000]],
    [7, 3, [24900, 195000]],
  ]
  payoutSpec.forEach(([m, day, grossList], i) => {
    const id = crypto.randomUUID()
    const gross = grossList.reduce((a, b) => a + b, 0)
    // Stripe-shaped fee: 2.9% + 30c per charge, integer cents throughout.
    const fee = grossList.reduce((a, g) => a + Math.round(g * 0.029) + 30, 0)
    payouts.push({
      id, stripe_payout_id: `po_demo_${i + 1}`, book_id: BUSINESS,
      amount_cents: gross - fee, gross_cents: gross, fee_cents: fee,
      arrival_date: d(m, day), status: "paid", currency: "usd",
      fees_reconciled: true, reconcile_delta_cents: 0,
    })
    grossList.forEach((g, j) => {
      const f = Math.round(g * 0.029) + 30
      lines.push({
        id: crypto.randomUUID(), payout_id: id,
        stripe_balance_txn_id: `txn_demo_${i + 1}_${j + 1}`, type: "charge",
        amount_cents: g, fee_cents: f, net_cents: g - f,
        txn_date: d(m, Math.max(1, day - 2)), description: "Payment", source_ref: `ch_demo_${i + 1}_${j + 1}`,
      })
    })
  })
  const { error: poErr } = await sb.from("bookkeeping_payouts").insert(payouts)
  if (poErr) throw new Error(`payouts: ${poErr.message}`)
  const { error: plErr } = await sb.from("bookkeeping_payout_lines").insert(lines)
  if (plErr) throw new Error(`payout lines: ${plErr.message}`)
  console.log(`inserted ${payouts.length} payouts + ${lines.length} fee lines`)

  // ---- closed months -----------------------------------------------------
  const closes: Row[] = []
  for (const period of [`${YEAR}-04`, `${YEAR}-05`]) {
    const inPeriod = entries.filter((e) => String(e.occurred_on).startsWith(period) && e.book_id === BUSINESS)
    const income = inPeriod.filter((e) => e.direction === "income").reduce((a, e) => a + Number(e.amount_cents), 0)
    const expense = inPeriod.filter((e) => e.direction === "expense").reduce((a, e) => a + Number(e.amount_cents), 0)
    closes.push({
      id: crypto.randomUUID(), book_id: BUSINESS, period,
      income_cents: income, expense_cents: expense, net_cents: income - expense,
      entry_count: inPeriod.length,
    })
  }
  const { error: clErr } = await sb.from("bookkeeping_period_closes").insert(closes)
  if (clErr) throw new Error(`closes: ${clErr.message}`)
  console.log(`inserted ${closes.length} closed months`)

  // ---- assets ------------------------------------------------------------
  const assets: Row[] = [
    ["Force plate system", 480000, 0, "2024-03-15", 7],
    ["Video capture rig", 265000, 25000, "2024-09-01", 5],
    ["Turf + flooring build-out", 890000, 0, "2025-01-20", 15],
    ["Sled + prowler set", 138000, 10000, "2025-06-10", 7],
  ].map(([name, basis, salvage, on, years]) => ({
    id: crypto.randomUUID(), book_id: BUSINESS, name,
    basis_cents: basis, salvage_cents: salvage, in_service_on: on,
    method: "straight_line", convention: "half_year", recovery_years: years,
  }))
  const { error: asErr } = await sb.from("bookkeeping_assets").insert(assets)
  if (asErr) throw new Error(`assets: ${asErr.message}`)
  console.log(`inserted ${assets.length} assets`)

  // ---- verification: prove the SCREENS will be alive, not just that rows exist
  console.log("\nverifying demo thresholds:")
  const checks: Array<[string, boolean, string]> = []

  const expenses = entries.filter((e) => e.direction === "expense")
  const uncat = expenses.filter((e) => e.account_id === null)
  const noPurpose = expenses.filter((e) => e.business_purpose === null && e.account_id !== null)
  const byVendor = new Map<string, string[]>()
  for (const e of expenses) {
    const k = String(e.counterparty ?? "")
    if (!byVendor.has(k)) byVendor.set(k, [])
    byVendor.get(k)!.push(String(e.occurred_on))
  }
  const monthlyVendors = [...byVendor.entries()].filter(([, ds]) => {
    if (ds.length < 3) return false
    const sorted = ds.slice().sort()
    const gaps = sorted.slice(1).map((x, i) => (Date.parse(x) - Date.parse(sorted[i])) / 86_400_000)
    const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    return med >= 25 && med <= 35
  })
  const sharedAccounts = accounts!.filter(
    (a) => a.book_id === BUSINESS && a.account_type === "expense" && a.service_line === null,
  )

  checks.push(["expense rows >= 40", expenses.length >= 40, `${expenses.length}`])
  checks.push(["uncategorized >= 5", uncat.length >= 5, `${uncat.length}`])
  checks.push(["missing business purpose >= 4", noPurpose.length >= 4, `${noPurpose.length}`])
  checks.push(["monthly-cadence vendors >= 2", monthlyVendors.length >= 2, monthlyVendors.map(([v]) => v).join(", ")])
  checks.push(["shared-cost accounts >= 1", sharedAccounts.length >= 1, `${sharedAccounts.length}`])
  checks.push(["payouts with fee lines >= 4", payouts.length >= 4 && lines.length >= 8, `${payouts.length}/${lines.length}`])
  checks.push(["closed months >= 2", closes.length >= 2, `${closes.length}`])
  checks.push(["assets >= 3", assets.length >= 3, `${assets.length}`])
  checks.push(["documents >= 8", docs.length >= 8, `${docs.length}`])

  let ok = true
  for (const [label, pass, detail] of checks) {
    if (!pass) ok = false
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(32)} ${detail}`)
  }
  if (!ok) throw new Error("threshold verification failed — screens would film empty")

  const totalFee = payouts.reduce((a, p) => a + Number(p.fee_cents), 0)
  console.log(`\nseeded. Stripe fees in window: $${(totalFee / 100).toFixed(2)}`)
}

main().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
