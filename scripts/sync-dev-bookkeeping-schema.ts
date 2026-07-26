/**
 * Sync the DEV Supabase project up to the bookkeeping schema prod already has.
 *
 * Why this exists: migrations in this project are applied through the Supabase
 * MCP, which is bound to the PROD project (epzu…). `.env.local` — what
 * `npm run dev` uses — points at a different project (anjv…). So dev silently
 * runs a stale schema: 00191 (payouts), 00192 (finding dismissals) and 00194
 * (payout reconciliation) never landed there, and both /admin/books/reports and
 * /admin/books/insights throw PostgREST 404s locally.
 *
 * Every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, so re-running is safe.
 *
 * Run: npx tsx scripts/sync-dev-bookkeeping-schema.ts
 */
import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"

const PROD_REF = "epzuvzkokzqtzomeyoha"
const MIGRATIONS = [
  "00191_bookkeeping_payouts.sql",
  "00192_bookkeeping_finding_dismissals.sql",
  "00194_bookkeeping_payout_reconciliation.sql",
]
const EXPECTED_TABLES = ["bookkeeping_payouts", "bookkeeping_payout_lines", "bookkeeping_finding_dismissals"]

function loadEnv(): { url: string; key: string } {
  const envPath = path.join(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) throw new Error(".env.local not found — this script only targets local dev")
  const text = fs.readFileSync(envPath, "utf8")
  const pick = (k: string) => {
    const m = text.match(new RegExp(`^${k}=(.*)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
  }
  const url = pick("NEXT_PUBLIC_SUPABASE_URL")
  const key = pick("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local")
  return { url, key }
}

async function main() {
  const { url, key } = loadEnv()
  const ref = url.replace(/^https?:\/\//, "").split(".")[0]

  // Hard guard: never touch production from this script.
  if (ref === PROD_REF) {
    throw new Error(`REFUSING TO RUN: .env.local resolves to the PRODUCTION project (${ref}). Prod migrations go through the Supabase MCP.`)
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("REFUSING TO RUN: NODE_ENV=production")
  }
  console.log(`Target dev project: ${ref}`)

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // DDL cannot go through PostgREST (supabase-js is CRUD-only), so migrations
  // run via the Management API. Needs SUPABASE_ACCESS_TOKEN in the environment.
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is not set.\n" +
        "Either export it, or paste the three migration files into the Supabase SQL editor for this project.",
    )
  }

  for (const file of MIGRATIONS) {
    const sqlPath = path.join(process.cwd(), "supabase", "migrations", file)
    if (!fs.existsSync(sqlPath)) throw new Error(`missing migration file: ${file}`)
    const sql = fs.readFileSync(sqlPath, "utf8")
    process.stdout.write(`applying ${file} … `)
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    })
    if (!res.ok) {
      console.log("FAILED")
      const body = await res.text()
      throw new Error(`${file}: ${res.status} ${body}`)
    }
    console.log("ok")
  }

  // Verify by reading the schema back — never infer success from "no error".
  console.log("\nverifying:")
  let allPresent = true
  for (const table of EXPECTED_TABLES) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true })
    const present = !error
    if (!present) allPresent = false
    console.log(`  ${present ? "PRESENT" : "MISSING "}  ${table}${error ? `  (${error.message})` : ""}`)
  }
  if (!allPresent) throw new Error("verification failed — at least one table is still missing")
  console.log("\ndev schema is in sync.")
}

main().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
