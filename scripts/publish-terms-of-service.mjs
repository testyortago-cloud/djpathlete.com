/**
 * Publishes docs/compliance/terms-of-service-v3.html as a NEW active version of the
 * terms_of_service legal document, and writes the legal_document.published audit row.
 *
 * Creates a new version rather than editing v2 in place, because user_consents rows
 * reference legal_document_id — rewriting v2's content would silently change what
 * people already agreed to. Mirrors createDocument() in lib/db/legal-documents.ts:
 * bump version, deactivate the previous active row, insert the new one as active.
 *
 * Unlike scripts/publish-privacy-policy.mjs this DOES write the audit row. That
 * script's omission is why scripts/backfill-legal-publish-audit.mjs had to exist.
 *
 *   node scripts/publish-terms-of-service.mjs .env.prod --dry    # show what would happen
 *   node scripts/publish-terms-of-service.mjs .env.prod          # publish
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const envPath = process.argv[2]
const dryRun = process.argv.includes("--dry")
if (!envPath) {
  console.error("usage: node scripts/publish-terms-of-service.mjs <env-file> [--dry]")
  process.exit(1)
}

const env = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error(`missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in ${envPath}`)
  process.exit(1)
}

const content = readFileSync(new URL("../docs/compliance/terms-of-service-v3.html", import.meta.url), "utf8")

const required = [
  ["STOP keyword", /replying STOP/],
  ["HELP keyword", /Reply HELP/],
  ["message frequency", /Message frequency varies/],
  ["rates disclosure", /Message and data rates may apply/],
  ["no-sell/share of mobile", /No mobile information will be sold or shared with third parties or affiliates/],
  ["consent not a condition", /not a condition of purchase/],
  ["carrier liability", /Carriers are not liable/],
  ["legal entity named", /YORTAGO LLC/],
  ["SMS section heading", /<p><strong>11\. SMS and Text Messaging<\/strong><\/p>/],
]
const missing = required.filter(([, re]) => !re.test(content)).map(([n]) => n)
if (missing.length) {
  console.error("REFUSING TO PUBLISH — content is missing:", missing.join(", "))
  process.exit(1)
}
console.log(`content OK (${content.length} chars), all ${required.length} A2P elements present`)

const sb = createClient(url, key)
console.log("target project:", url.replace(/^https:\/\/([^.]+).*/, "$1"))

const { data: current, error: readErr } = await sb
  .from("legal_documents")
  .select("*")
  .eq("document_type", "terms_of_service")
  .order("version", { ascending: false })
if (readErr) {
  console.error("read failed:", readErr.message)
  process.exit(1)
}
console.table(
  current.map(({ id, version, effective_date, is_active, content }) => ({
    id,
    version,
    effective_date,
    is_active,
    chars: content.length,
  })),
)

// An inactive version numbered ABOVE the active one is somebody else's unpublished
// draft. Publishing over it would bury work nobody has read.
const active = current.find((d) => d.is_active)
const drafts = current.filter((d) => !d.is_active && d.version > (active?.version ?? 0))
if (drafts.length) {
  console.log(`\nFOUND ${drafts.length} UNPUBLISHED DRAFT(S) newer than the active v${active?.version}:`)
  for (const d of drafts) {
    console.log(`  v${d.version}  id=${d.id}  effective=${d.effective_date}  chars=${d.content.length}`)
  }
  if (!process.argv.includes("--force")) {
    console.log("\nSTOPPING — review the draft(s) above. Re-run with --force to publish anyway.")
    process.exit(2)
  }
  console.log("\n--force given, publishing over the draft(s) above")
}

// The new content must be the active document plus the SMS section, nothing else.
if (!active) {
  console.error("REFUSING — no active terms_of_service to build on")
  process.exit(1)
}
if (!content.includes(active.content.slice(0, 400))) {
  console.error("REFUSING — built content does not open with the active document; rebuild from the live row")
  process.exit(1)
}

const nextVersion = (current?.[0]?.version ?? 0) + 1
const effective_date = new Date().toISOString().slice(0, 10)
console.log(`\nwould publish v${nextVersion}, effective ${effective_date}, superseding v${active.version}`)

if (dryRun) {
  console.log("--dry given, stopping here")
  process.exit(0)
}

const { error: deactErr } = await sb
  .from("legal_documents")
  .update({ is_active: false })
  .eq("document_type", "terms_of_service")
  .eq("is_active", true)
if (deactErr) {
  console.error("deactivate failed:", deactErr.message)
  process.exit(1)
}

const { data: inserted, error: insErr } = await sb
  .from("legal_documents")
  .insert({
    document_type: "terms_of_service",
    title: active.title,
    content,
    version: nextVersion,
    effective_date,
    is_active: true,
  })
  .select()
  .single()

if (insErr) {
  console.error("insert failed:", insErr.message)
  console.error(`NOTE: v${active.version} was already deactivated — reactivate it (id ${active.id}) or re-run`)
  process.exit(1)
}

console.log(`\npublished v${inserted.version} (id ${inserted.id}), active, effective ${inserted.effective_date}`)

const { error: auditErr } = await sb.from("audit_logs").insert({
  action: "legal_document.published",
  category: "compliance",
  outcome: "success",
  actor_id: null,
  actor_email: null,
  actor_role: "system",
  target_type: "legal_document",
  target_id: inserted.id,
  target_label: "terms_of_service",
  metadata: {
    version: inserted.version,
    document_type: "terms_of_service",
    effective_date: inserted.effective_date,
    supersedes_version: active.version,
    note:
      "Adds section 11 'SMS and Text Messaging' required for A2P 10DLC campaign registration, filling the existing" +
      " gap in the section numbering (the document ran 10 -> 12). Every other byte of v" +
      `${active.version} is preserved. Built by docs/compliance/build-terms-v3.mjs and published by` +
      " scripts/publish-terms-of-service.mjs on the owner's explicit instruction.",
  },
})
if (auditErr) {
  console.error(`\nWARNING: document published but the audit row failed: ${auditErr.message}`)
  console.error("The document itself is fine. Record the publication somewhere durable.")
  process.exit(1)
}
console.log("wrote legal_document.published audit row")
