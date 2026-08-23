// Writes the `legal_document.published` audit row for the privacy policy that
// IS already live but whose audit row failed to insert.
//
// Why this exists: the publish script guessed at audit_logs' shape and used
// `actor_type` / `actor_label`, which do not exist. The document publish (v1
// deactivated, v3 inserted active) had already committed by then, so production
// is serving the right policy with no compliance trail. This backfills it.
//
// Idempotent: exits without writing if a row for this document already exists.
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }

if (new URL(U).host.split(".")[0] !== "epzuvzkokzqtzomeyoha") {
  console.error("Production only; refusing — got", U)
  process.exit(1)
}

async function api(path, init = {}) {
  const r = await fetch(`${U}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  const t = await r.text()
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${t.slice(0, 400)}`)
  try {
    return JSON.parse(t)
  } catch {
    return []
  }
}

const [active] = await api(
  "legal_documents?select=id,version,effective_date,content&document_type=eq.privacy_policy&is_active=eq.true",
)
if (!active) throw new Error("no active privacy policy — stop and investigate before writing an audit row")
if (!active.content.includes("SMS and Text Messaging")) {
  throw new Error("the active policy does not contain the SMS section — refusing to log a publish that did not happen")
}

const existing = await api(`audit_logs?select=id&action=eq.legal_document.published&target_id=eq.${active.id}`)
if (existing.length) {
  console.log(`Audit row already exists for v${active.version} (${existing[0].id}). Nothing to do.`)
  process.exit(0)
}

await api("audit_logs", {
  method: "POST",
  body: JSON.stringify({
    action: "legal_document.published",
    category: "compliance",
    outcome: "success",
    actor_id: null,
    actor_email: null,
    actor_role: "system",
    target_type: "legal_document",
    target_id: active.id,
    target_label: "privacy_policy",
    metadata: {
      version: active.version,
      document_type: "privacy_policy",
      effective_date: active.effective_date,
      supersedes_version: 1,
      note:
        "Adds the SMS/text-messaging section required for A2P registration. Content derived from the v2 draft " +
        "(a332ecf6-88a2-4c9f-8bed-4bf99aa40252) with the section moved inside the policy body as §11 and Contact " +
        "renumbered to §12. Published from scripts/publish-privacy-policy-sms.mjs on the owner's explicit instruction.",
      backfilled:
        "This row was written after the fact: the original publish committed, then its audit insert failed on a " +
        "wrong column name (actor_type/actor_label do not exist). The document itself was unaffected.",
    },
  }),
})

console.log(`Wrote legal_document.published audit row for v${active.version} (${active.id}).`)
