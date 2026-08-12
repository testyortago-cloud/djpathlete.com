/**
 * Ad-hoc read against whatever database .env.local points at.
 *
 * The Supabase MCP connection targets production, so there is no other way to
 * ask the dev clone a question. Read-only by construction: it only ever calls
 * .select().
 *
 * Run: node scripts/dev-db-query.mjs <table> <select> [column=value ...]
 *   node scripts/dev-db-query.mjs users "id,email,role" role=editor
 */
import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), quiet: true })

const [table, columns = "*", ...filters] = process.argv.slice(2)
if (!table) throw new Error("usage: dev-db-query.mjs <table> <select> [col=value ...]")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)

let query = supabase.from(table).select(columns)
for (const f of filters) {
  const [col, ...rest] = f.split("=")
  const value = rest.join("=")
  query = value.includes(",") ? query.in(col, value.split(",")) : query.eq(col, value)
}

const { data, error, count } = await query
if (error) {
  console.error(error.message)
  process.exit(1)
}
console.log(`# ${new URL(url).hostname.split(".")[0]} · ${table} · ${data.length} row(s)${count ? ` of ${count}` : ""}`)
console.log(JSON.stringify(data, null, 2))
