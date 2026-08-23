// scripts/ghl-export.mjs
//
// One-shot, READ-ONLY export of everything the GoHighLevel API will give us,
// written to `ghl-export/<timestamp>/`. Run before the GHL account is cancelled.
//
//   node scripts/ghl-export.mjs
//
// WHY THIS EXISTS
// The GHL account holds records that cannot be reconstructed once it closes:
// who consented to be texted and when, the conversation history that proves it,
// and 437 opportunities' worth of pipeline state. Losing them is not an
// inconvenience — an un-evidenced SMS list is a list you are not allowed to
// text.
//
// SILENT TRUNCATION IS THE FAILURE MODE THIS GUARDS AGAINST.
// Every paginated read compares what it fetched against the `total` the API
// reported and prints a loud WARN on a shortfall. A partial export that looks
// complete is worse than a failed one, because nobody re-runs it.
//
// WHAT THIS CANNOT EXPORT: workflow STEPS. GHL exposes workflow id/name/status
// and nothing else — no triggers, waits, or message bodies, under any scope.
// `workflows-manifest.csv` is written as the checklist for capturing those by
// hand before the account goes away.

import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const KEY = process.env.GHL_API_KEY
const LOCATION = process.env.GHL_LOCATION_ID
const BASE = "https://services.leadconnectorhq.com"

if (!KEY || !LOCATION) {
  console.error("✖ GHL_API_KEY / GHL_LOCATION_ID missing from .env.local")
  process.exit(1)
}

// GHL's published ceiling is 100 requests / 10s. 120ms between calls keeps us
// under half of that, which matters because the per-conversation message reads
// below fire one request each.
const THROTTLE_MS = 120
// Bounds every paginator. A cursor that stops advancing would otherwise spin
// forever; this turns that into a WARN and a partial file we can see.
const MAX_PAGES = 500

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const outDir = path.join("ghl-export", stamp)
fs.mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const warnings = []
const summary = []

async function api(pathname) {
  await sleep(THROTTLE_MS)
  const res = await fetch(pathname.startsWith("http") ? pathname : BASE + pathname, {
    headers: { Authorization: `Bearer ${KEY}`, Version: "2021-07-28", Accept: "application/json" },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`${res.status} ${pathname.split("?")[0]} — ${body.slice(0, 160)}`)
  }
  return res.json()
}

/**
 * Walks every page of a list endpoint and returns deduped records.
 *
 * Three cursor styles are tried in order because GHL is not consistent across
 * resources: `meta.nextPageUrl` (contacts, opportunities), then `page=N`, then
 * `startAfterId`/`startAfter` (conversations). Dedupe by `id` is what makes
 * trying several safe — a paginator that silently restarts at page one would
 * otherwise produce a file full of duplicates that still "looks" complete.
 */
async function fetchAll(firstPath, listKey) {
  const byId = new Map()
  let next = firstPath
  let reportedTotal = null
  let pages = 0

  while (next && pages < MAX_PAGES) {
    const json = await api(next)
    pages++

    const rows = Array.isArray(json[listKey]) ? json[listKey] : []
    const before = byId.size
    for (const row of rows) byId.set(row.id ?? `${listKey}-${byId.size}`, row)
    const added = byId.size - before

    const total = json?.meta?.total ?? json?.total
    if (total != null) reportedTotal = total

    // No new records means the cursor has stopped advancing, whatever it claims.
    if (rows.length === 0 || added === 0) break

    const raw = json?.meta?.nextPageUrl
    if (raw) {
      next = raw
      continue
    }
    const startAfterId = json?.meta?.startAfterId ?? json?.meta?.startAfter
    if (startAfterId && rows.length > 0) {
      const url = new URL(BASE + firstPath)
      url.searchParams.set("startAfterId", String(startAfterId))
      next = url.pathname + url.search
      continue
    }
    next = null
  }

  if (pages >= MAX_PAGES) warnings.push(`${listKey}: hit the ${MAX_PAGES}-page cap — export may be incomplete`)
  const records = [...byId.values()]
  if (reportedTotal != null && records.length < reportedTotal) {
    warnings.push(
      `${listKey}: fetched ${records.length} but API reported ${reportedTotal} — SHORT BY ${reportedTotal - records.length}`,
    )
  }
  return { records, reportedTotal }
}

/**
 * Conversations need their own paginator.
 *
 * `/conversations/search` returns `{conversations, total, traceId}` and NO
 * `meta` block at all — so there is no nextPageUrl and no startAfterId for the
 * generic walker to follow, and it silently stopped at the first 100 of 190.
 * The cursor is the `sort` field carried on each conversation row, fed back in
 * as `startAfterDate`.
 */
async function fetchAllConversations() {
  const byId = new Map()
  let cursor = null
  let reportedTotal = null
  let pages = 0

  while (pages < MAX_PAGES) {
    const url = new URL(`${BASE}/conversations/search`)
    url.searchParams.set("locationId", LOCATION)
    url.searchParams.set("limit", "100")
    if (cursor != null) url.searchParams.set("startAfterDate", String(cursor))

    const json = await api(url.pathname + url.search)
    pages++

    const rows = Array.isArray(json.conversations) ? json.conversations : []
    if (json.total != null) reportedTotal = json.total

    const before = byId.size
    for (const row of rows) byId.set(row.id, row)
    if (rows.length === 0 || byId.size === before) break

    // `sort` is either [timestamp, id] or a bare timestamp depending on the row.
    const last = rows[rows.length - 1]
    const next = Array.isArray(last?.sort) ? last.sort[0] : last?.sort
    if (next == null || next === cursor) break
    cursor = next
  }

  if (pages >= MAX_PAGES) warnings.push(`conversations: hit the ${MAX_PAGES}-page cap`)
  const records = [...byId.values()]
  if (reportedTotal != null && records.length < reportedTotal) {
    warnings.push(
      `conversations: fetched ${records.length} but API reported ${reportedTotal} — SHORT BY ${reportedTotal - records.length}`,
    )
  }
  return { records, reportedTotal }
}

function write(name, data) {
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(data, null, 2))
}

async function step(label, name, fn) {
  process.stdout.write(`  ${label.padEnd(22)}`)
  try {
    const { records, reportedTotal } = await fn()
    write(name, records)
    const note = reportedTotal != null && reportedTotal !== records.length ? ` (API said ${reportedTotal})` : ""
    console.log(`${String(records.length).padStart(5)} records${note}`)
    summary.push([label, records.length])
    return records
  } catch (err) {
    console.log(`FAILED — ${err.message}`)
    warnings.push(`${label}: ${err.message}`)
    summary.push([label, "FAILED"])
    return []
  }
}

console.log(`\nGHL export → ${outDir}\n`)

await step("Contacts", "contacts", () => fetchAll(`/contacts/?locationId=${LOCATION}&limit=100`, "contacts"))
await step("Pipelines", "pipelines", () => fetchAll(`/opportunities/pipelines?locationId=${LOCATION}`, "pipelines"))
await step("Opportunities", "opportunities", () =>
  fetchAll(`/opportunities/search?location_id=${LOCATION}&limit=100`, "opportunities"),
)
await step("Custom field defs", "custom-fields", () => fetchAll(`/locations/${LOCATION}/customFields`, "customFields"))
await step("Tags", "tags", () => fetchAll(`/locations/${LOCATION}/tags`, "tags"))
await step("Forms", "forms", () => fetchAll(`/forms/?locationId=${LOCATION}&limit=100`, "forms"))
await step("Form submissions", "form-submissions", () =>
  fetchAll(`/forms/submissions?locationId=${LOCATION}&limit=100`, "submissions"),
)
await step("Calendars", "calendars", () => fetchAll(`/calendars/?locationId=${LOCATION}`, "calendars"))
await step("Users", "users", () => fetchAll(`/users/?locationId=${LOCATION}`, "users"))

const conversations = await step("Conversations", "conversations", fetchAllConversations)

// Message bodies are the consent evidence — a conversation row on its own only
// says a thread exists, not what was said in it or who spoke first. One request
// per thread, which is why the throttle above matters.
//
// This needs `conversations/message.readonly`, which is a SEPARATE scope from
// `conversations.readonly`. Without it every read 401s, so bail after the first
// failure rather than burning 190 requests to learn the same thing.
if (conversations.length > 0) {
  process.stdout.write(`  ${"Messages".padEnd(22)}`)
  const threads = []
  let scopeDenied = false
  let failed = 0

  for (const convo of conversations) {
    try {
      const json = await api(`/conversations/${convo.id}/messages`)
      const messages = json?.messages?.messages ?? json?.messages ?? []
      threads.push({ conversationId: convo.id, contactId: convo.contactId, messages })
    } catch (err) {
      if (String(err.message).startsWith("401")) {
        scopeDenied = true
        break
      }
      failed++
    }
  }

  if (scopeDenied) {
    console.log("   SKIPPED — missing scope")
    warnings.push(
      "conversation messages: 401 — add the `conversations/message.readonly` scope (separate from `conversations.readonly`) and re-run",
    )
    summary.push(["Messages", "SKIPPED (scope)"])
  } else {
    write("conversation-messages", threads)
    const total = threads.reduce((n, t) => n + t.messages.length, 0)
    console.log(`${String(total).padStart(5)} messages across ${threads.length} threads`)
    summary.push(["Messages", total])
    if (failed > 0) warnings.push(`Messages: ${failed} thread(s) could not be read`)
  }
}

// The last message of every thread rides along on the conversation row itself,
// so this survives even when the message scope is missing. It is not a
// substitute for full history, but it does record direction and date — enough
// to show a human replied first on a given thread.
if (conversations.length > 0) {
  write(
    "conversation-last-message",
    conversations.map((c) => ({
      conversationId: c.id,
      contactId: c.contactId,
      lastMessageDate: c.lastMessageDate,
      lastMessageType: c.lastMessageType,
      lastMessageDirection: c.lastMessageDirection,
      lastMessageBody: c.lastMessageBody,
    })),
  )
}

// ── Workflows: names only, plus the manual-capture checklist ─────────────────
const workflows = await step("Workflows", "workflows", () =>
  fetchAll(`/workflows/?locationId=${LOCATION}`, "workflows"),
)

if (workflows.length > 0) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const csv = [
    "name,status,id,created,updated,CAPTURED_BY_HAND",
    ...workflows.map((w) =>
      [esc(w.name), esc(w.status), esc(w.id), esc(w.createdAt), esc(w.updatedAt), esc("NO")].join(","),
    ),
  ].join("\n")
  fs.writeFileSync(path.join(outDir, "workflows-manifest.csv"), csv)
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60))
console.log("Written to:", outDir)

if (warnings.length > 0) {
  console.log("\n⚠  WARNINGS — do not treat this export as complete:")
  for (const w of warnings) console.log("   •", w)
} else {
  console.log("\n✓ No shortfalls detected — every count matched what the API reported.")
}

const active = workflows.filter((w) => String(w.status).toLowerCase() === "published").length
console.log(
  `\n⚠  ${workflows.length} workflows exported BY NAME ONLY (${active} published).\n` +
    `   GHL has no endpoint for workflow steps. Open each published workflow and\n` +
    `   screenshot it, then mark it off in workflows-manifest.csv. Once the account\n` +
    `   is cancelled this logic is unrecoverable.\n`,
)

fs.writeFileSync(
  path.join(outDir, "MANIFEST.json"),
  JSON.stringify(
    { exportedAt: new Date().toISOString(), locationId: LOCATION, counts: Object.fromEntries(summary), warnings },
    null,
    2,
  ),
)
