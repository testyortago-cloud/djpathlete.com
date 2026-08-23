/**
 * Publishes docs/compliance/privacy-policy-v2.html as a NEW active version of the
 * privacy_policy legal document.
 *
 * Creates a new version rather than editing v1 in place, because user_consents rows
 * reference legal_document_id — rewriting v1's content would silently change what
 * people already agreed to. This mirrors createDocument() in lib/db/legal-documents.ts:
 * bump version, deactivate the previous active row, insert the new one as active.
 *
 * PREFER THE ADMIN UI (/admin/legal) WHERE POSSIBLE. POST /api/admin/legal does the
 * same thing AND writes a `legal_document.published` audit row; this script talks to
 * the database directly and therefore leaves no audit trail. Use it only when the
 * admin UI is not reachable, and note the publication somewhere durable afterwards.
 *
 *   node scripts/publish-privacy-policy.mjs .env.prod          # publish
 *   node scripts/publish-privacy-policy.mjs .env.prod --dry    # show what would happen
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const envPath = process.argv[2]
const dryRun = process.argv.includes("--dry")
if (!envPath) {
  console.error("usage: node scripts/publish-privacy-policy.mjs <env-file> [--dry]")
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

const content = readFileSync(new URL("../docs/compliance/privacy-policy-v2.html", import.meta.url), "utf8")

// Refuse to publish content that is missing any A2P 10DLC element.
const required = [
  ["STOP keyword", /Reply STOP/],
  ["HELP keyword", /Reply HELP/],
  ["message frequency", /Message frequency varies/],
  ["rates disclosure", /Message and data rates may apply/],
  ["no-sell/share of mobile", /No mobile information will be sold or shared with third parties or affiliates/],
  ["legal entity named", /YORTAGO LLC/],
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
  .eq("document_type", "privacy_policy")
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

// An inactive version with a HIGHER number than the active one is somebody else's
// unpublished draft. Publishing on top of it would bury work we never looked at,
// so describe it and stop unless --force says otherwise.
const active = current.find((d) => d.is_active)
const drafts = current.filter((d) => !d.is_active && d.version > (active?.version ?? 0))
if (drafts.length) {
  console.log(`\nFOUND ${drafts.length} UNPUBLISHED DRAFT(S) newer than the active v${active?.version}:`)
  for (const d of drafts) {
    const text = d.content
      .replace(/<(p|li|h1|h2|ul|hr)[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    console.log(`\n  v${d.version}  id=${d.id}  effective=${d.effective_date}  chars=${d.content.length}`)
    console.log(
      "  A2P:",
      required.map(([n, re]) => `${n.split(" ")[0]}:${re.test(d.content) ? "YES" : "no"}`).join("  "),
    )
    console.log("  sections:", text.filter((l) => /^\d+\.\s/.test(l)).join(" | ") || "(none)")
    console.log("  opens:", JSON.stringify(text.slice(0, 3).join(" / ").slice(0, 220)))
  }
  if (!process.argv.includes("--force")) {
    console.log("\nSTOPPING — review the draft(s) above. Re-run with --force to publish anyway.")
    process.exit(2)
  }
  console.log("\n--force given, publishing over the draft(s) above")
}

const nextVersion = (current?.[0]?.version ?? 0) + 1
const effective_date = new Date().toISOString().slice(0, 10)
console.log(`\nwould publish v${nextVersion}, effective ${effective_date}, and deactivate the current active row`)

if (dryRun) {
  console.log("--dry given, stopping here")
  process.exit(0)
}

const { error: deactErr } = await sb
  .from("legal_documents")
  .update({ is_active: false })
  .eq("document_type", "privacy_policy")
  .eq("is_active", true)
if (deactErr) {
  console.error("deactivate failed:", deactErr.message)
  process.exit(1)
}

const { data: inserted, error: insErr } = await sb
  .from("legal_documents")
  .insert({
    document_type: "privacy_policy",
    title: "Privacy Policy",
    content,
    version: nextVersion,
    effective_date,
    is_active: true,
  })
  .select()
  .single()

if (insErr) {
  console.error("insert failed:", insErr.message)
  console.error("NOTE: the previous version was already deactivated — re-run or reactivate v1 manually")
  process.exit(1)
}

console.log(`\npublished v${inserted.version} (id ${inserted.id}), active, effective ${inserted.effective_date}`)
