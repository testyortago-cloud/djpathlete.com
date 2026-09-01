/**
 * Read-only look at the Gmail receipt poller: its switches, the Gmail
 * connection it borrows from /admin/inbox, its recent cron runs, and the
 * documents it has actually ingested.
 *
 * Answers "an invoice arrived in the mailbox and never appeared in the
 * review queue — which gate dropped it?" without touching the mailbox or
 * writing anything.
 *
 *   node scripts/inspect-gmail-receipts.mjs .env.prod
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const KEYS = [
  "cron_bookkeeping_gmail_receipts_enabled",
  "bookkeeping_gmail_receipt_label",
  "bookkeeping_gmail_receipt_forwarders",
  "bookkeeping_gmail_receipt_forwarders_since",
  "bookkeeping_gmail_receipt_query",
  "bookkeeping_gmail_receipt_query_window_days",
  "bookkeeping_gmail_scannable_mimes",
  "bookkeeping_gmail_settled_message_ids",
  "bookkeeping_gmail_unreadable_message_ids",
  "bookkeeping_gmail_message_attempts",
]

function summarize(key, value) {
  if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? "y" : "ies"}` +
    (value.length && value.length <= 6 ? ` — ${JSON.stringify(value)}` : "")
  if (value && typeof value === "object") {
    const n = Object.keys(value).length
    return `${n} key(s)` + (n && n <= 6 ? ` — ${JSON.stringify(value)}` : "")
  }
  return JSON.stringify(value)
}

async function main() {
  const [envPath = ".env.prod"] = process.argv.slice(2)
  const env = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  console.log(`# ${new URL(url).hostname.split(".")[0]} · via ${envPath}\n`)

  console.log("== system_settings ==")
  const { data: settings, error: sErr } = await db
    .from("system_settings").select("key,value,updated_at").in("key", KEYS)
  if (sErr) console.log("  ERROR:", sErr.message)
  else {
    const byKey = Object.fromEntries(settings.map((r) => [r.key, r]))
    for (const k of KEYS) {
      const row = byKey[k]
      if (!row) { console.log(`  ${k}: <NO ROW — falls back to the code default>`); continue }
      console.log(`  ${k}: ${summarize(k, row.value)}   (updated ${row.updated_at})`)
    }
  }

  console.log("\n== platform_connections (gmail) ==")
  const { data: conns, error: cErr } = await db
    .from("platform_connections")
    .select("plugin_name,status,account_handle,last_sync_at,last_error,connected_at,updated_at")
    .eq("plugin_name", "gmail")
  if (cErr) console.log("  ERROR:", cErr.message)
  else if (!conns.length) console.log("  <no gmail row — Gmail is NOT connected>")
  else for (const c of conns) {
    console.log(`  mailbox=${c.account_handle ?? "?"}  status=${c.status}  connected=${c.connected_at}`)
    console.log(`  last_sync=${c.last_sync_at ?? "-"}  updated=${c.updated_at}  last_error=${c.last_error ?? "-"}`)
  }

  console.log("\n== cron_runs · bookkeepingGmailReceiptsCron (latest 12) ==")
  const { data: runs, error: rErr } = await db
    .from("cron_runs").select("started_at,finished_at,status,detail")
    .eq("cron_name", "bookkeepingGmailReceiptsCron")
    .order("started_at", { ascending: false }).limit(12)
  if (rErr) console.log("  ERROR:", rErr.message)
  else if (!runs.length) console.log("  <NEVER RUN — no cron_runs rows at all>")
  else for (const r of runs) console.log(`  ${r.started_at}  ${r.status}  ${JSON.stringify(r.detail)}`)

  console.log("\n== bookkeeping_documents ingested from Gmail (latest 15) ==")
  const { data: docs, error: dErr } = await db
    .from("bookkeeping_documents")
    .select("id,created_at,original_filename,mime_type,external_ref,scan_result,posted_count")
    .like("external_ref", "gmail:%")
    .order("created_at", { ascending: false }).limit(15)
  if (dErr) console.log("  ERROR:", dErr.message)
  else if (!docs.length) console.log("  <NONE — the poller has never ingested a message>")
  else for (const d of docs) {
    const scan = d.scan_result
      ? `scanned(${d.scan_result.vendor ?? "?"} ${d.scan_result.total ?? d.scan_result.amount ?? "?"})`
      : "NO scan_result"
    console.log(`  ${d.created_at}  ${d.external_ref}  ${d.mime_type}  ${scan}  posted=${d.posted_count ?? "-"}  ${d.original_filename}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
