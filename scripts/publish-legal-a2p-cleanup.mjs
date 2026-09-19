// Publishes privacy_policy v4 and terms_of_service v3, removing the
// "this document is a placeholder" disclaimer from both and adding the
// carrier-standard mobile-data sentence to the privacy policy's SMS section.
//
// WHY: the A2P campaign's message_flow points a carrier reviewer at
// /privacy-policy and /terms-of-service as the compliance basis for the
// opt-in. Both pages currently end with "This document is a placeholder and
// requires review by a qualified legal professional before use." A reviewer
// reading that on the policy the submission leans on is a plausible rejection
// on its own — this is the same class of defect as the 18601 name mismatch,
// where the registration said one thing and the site said another.
//
// docs/compliance/build-privacy-policy-v2.mjs already had a
// `drop-placeholder-note` edit AND an assertion for it. Its output was never
// published: the active privacy_policy v3 came from
// scripts/publish-privacy-policy-sms.mjs, a different artifact, which
// (correctly) preserved v1 byte-for-byte and so carried the disclaimer
// forward. No row in legal_documents has ever passed that builder's checks.
//
// WHY A SCRIPT AND NOT /admin/legal: same reason as
// scripts/publish-privacy-policy-sms.mjs — the supported publish path is
// POST /api/admin/legal, which needs an authenticated prod admin session, and
// the dev-login bypass 404s when VERCEL is set. This reproduces that route's
// deactivate-then-insert semantics and its `legal_document.published` audit
// row rather than inventing a different mutation against a legal table.
//
// WRITES ARE OPT-IN, inverted from publish-privacy-policy-sms.mjs's
// DRY_RUN=true convention. That script defaulted to writing; this one defaults
// to printing. Deliberate: this edits the text of TWO live legal documents, and
// the failure mode of a default-write script invoked by muscle memory is an
// unreviewed change to a legal page. Set PUBLISH=true to write.
//
//   node --env-file=.env.prod scripts/publish-legal-a2p-cleanup.mjs
//   PUBLISH=true node --env-file=.env.prod scripts/publish-legal-a2p-cleanup.mjs
//
// v1 MUST NOT BE EDITED — 31 user_consents rows point at it. This only ever
// inserts a NEW version and deactivates the current one.

import {
  buildPrivacyPolicy,
  buildTermsOfService,
  privacyPolicyChecks,
  termsOfServiceChecks,
} from "./_legal-a2p-cleanup-lib.mjs"

const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUBLISH = process.env.PUBLISH === "true"
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }

if (!U || !K) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.prod)")
  process.exit(1)
}
if (new URL(U).host.split(".")[0] !== "epzuvzkokzqtzomeyoha") {
  console.error("This script is for production only; refusing — got", U)
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

const plan = []

// ── privacy_policy: drop the disclaimer + add the carrier sentence ───────────
{
  const docs = await api(
    "legal_documents?select=id,version,is_active,title,content,effective_date&document_type=eq.privacy_policy&order=version",
  )
  const active = docs.find((d) => d.is_active)
  if (!active) throw new Error("no active privacy_policy — aborting")
  const content = buildPrivacyPolicy(active.content)
  plan.push({ type: "privacy_policy", active, docs, content, checks: privacyPolicyChecks(content) })
}

// ── terms_of_service: drop the disclaimer only ───────────────────────────────
{
  const docs = await api(
    "legal_documents?select=id,version,is_active,title,content,effective_date&document_type=eq.terms_of_service&order=version",
  )
  const active = docs.find((d) => d.is_active)
  if (!active) throw new Error("no active terms_of_service — aborting")
  const content = buildTermsOfService(active.content)
  plan.push({ type: "terms_of_service", active, docs, content, checks: termsOfServiceChecks(active.content, content) })
}

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0
for (const p of plan) {
  console.log(`\n=== ${p.type} — active v${p.active.version} (${p.active.id}) ===`)
  console.log(
    `    length ${p.active.content.length} -> ${p.content.length} (${p.content.length - p.active.content.length})`,
  )
  console.log(`    effective_date ${p.active.effective_date} (UNCHANGED — this is a clarification, not a new`)
  console.log(`    data practice; a new date would imply a re-consent event that did not happen)`)
  for (const [name, ok] of p.checks) {
    if (!ok) failed++
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`)
  }
  console.log(`    new tail: ${JSON.stringify(p.content.slice(-200))}`)
}

if (failed) {
  console.error(`\n${failed} check(s) FAILED — refusing to publish.`)
  process.exit(1)
}

if (!PUBLISH) {
  console.log("\n--- DRY RUN. Nothing written. Set PUBLISH=true to publish. ---")
  process.exit(0)
}

// ── publish: same semantics as createDocument / POST /api/admin/legal ─────────
for (const p of plan) {
  const nextVersion = Math.max(...p.docs.map((d) => d.version)) + 1
  await api(`legal_documents?document_type=eq.${p.type}&is_active=eq.true`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false }),
  })

  let inserted
  try {
    ;[inserted] = await api("legal_documents", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        document_type: p.type,
        title: p.active.title,
        content: p.content,
        effective_date: p.active.effective_date,
        version: nextVersion,
        is_active: true,
      }),
    })
  } catch (e) {
    // Never leave the site with no active document of this type.
    console.error(`INSERT FAILED for ${p.type} — restoring v${p.active.version} as active:`, e.message)
    await api(`legal_documents?id=eq.${p.active.id}`, { method: "PATCH", body: JSON.stringify({ is_active: true }) })
    throw e
  }

  // Real audit_logs columns are actor_id / actor_email / actor_role. There is
  // no actor_type or actor_label — guessing those is what made an earlier run
  // publish the document and then fail on the audit row.
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
      target_id: inserted.id,
      target_label: p.type,
      metadata: {
        version: inserted.version,
        document_type: p.type,
        effective_date: inserted.effective_date,
        note:
          "Removes the 'this document is a placeholder' disclaimer that the A2P campaign's message_flow points carrier reviewers at. " +
          (p.type === "privacy_policy"
            ? "Also adds the carrier-standard mobile-information sentence alongside the existing equivalent wording."
            : "No other change."),
      },
    }),
  })

  console.log(`published ${p.type} v${inserted.version} (${inserted.id})`)
}

console.log("\nDone. Re-check the live pages before telling Twilio anything.")
