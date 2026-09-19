// Pure transforms for the A2P legal cleanup — no network, no env, no writes.
//
// Separated from scripts/publish-legal-a2p-cleanup.mjs so the edits can be
// verified against a dump of the live documents without holding production
// credentials. Same reasoning as the twin-copy helpers elsewhere in this repo:
// the thing that decides WHAT the new text is should be runnable by something
// that cannot possibly publish it.

/**
 * The exact string both live documents end with. Byte-identical in each —
 * verified against prod 2026-08-23 — and the same literal
 * docs/compliance/build-privacy-policy-v2.mjs's `drop-placeholder-note`
 * targets. That edit was written and its output never published; this is the
 * same removal, applied to what actually shipped.
 */
export const PLACEHOLDER =
  "<hr><p><em>This document is a placeholder and requires review by a qualified legal professional before use.</em></p>"

/**
 * The policy's existing, self-authored version of the no-sell promise. Left
 * untouched — it is what the active document already says, and rewriting
 * settled legal text to match a template is a bigger change than adding to it.
 */
export const NO_SELL_ANCHOR =
  "<p><strong>We do not sell, rent or share your mobile number, or your consent to receive text messages, with any third party for their own marketing purposes.</strong></p>"

/**
 * The same promise in the conventional CTIA wording carrier vetting matches on,
 * plus the literal STOP/HELP keywords. ADDITIVE — the policy ends up carrying
 * both phrasings rather than trading one for the other, because the existing
 * sentence is the one a human wrote for this business and the added one is the
 * one a reviewer greps for. They do not contradict each other.
 */
export const NO_SELL_ADDITION =
  "<p><strong>No mobile information will be sold or shared with third parties or affiliates for marketing or promotional purposes.</strong> Reply STOP to any message to unsubscribe at any time. Reply HELP for assistance.</p>"

/**
 * The rendered policy still shows a BRACKETED placeholder date — "[March 1st
 * 2026]" — while legal_documents.effective_date says 2026-08-18. A reviewer
 * reads the rendered text, not the column. Replacement matches the column.
 */
export const EFFDATE_ANCHOR = "<p><strong>Effective Date:</strong> [March 1st 2026]</p>"
export const EFFDATE_REPLACEMENT = "<p><strong>Effective Date:</strong> 18 August 2026</p>"

/**
 * Name the operating legal entity in the policy body. YORTAGO LLC currently
 * appears ONLY in the site footer — the operator line shipped for error 18601 —
 * and never in the policy itself. 18601 was the registration/site name mismatch,
 * so a policy that cannot say who operates the site is that same defect one
 * layer down. Wording taken verbatim from
 * docs/compliance/build-privacy-policy-v2.mjs's `name-operator` edit.
 */
export const OPERATOR_ANCHOR = '<p>DJP Athlete ("we", "our", "us") is committed to protecting your privacy.'
export const OPERATOR_REPLACEMENT =
  '<p>DJP Athlete is a brand of YORTAGO LLC ("we", "our", "us"), which operates darrenjpaul.com. We are committed to protecting your privacy.'

/** Exactly-one-match replace, or throw. Never guess which occurrence was meant. */
export function subOnce(label, src, find, replace) {
  const n = src.split(find).length - 1
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n} — aborting rather than guessing`)
  return src.replace(find, replace)
}

/**
 * Every privacy-policy edit, as {label, find, replace}. Forward application AND
 * the round-trip check are both derived from this ONE list, so an edit can never
 * be applied without its inverse also being checked — the failure mode of a
 * hand-written inverse is that it silently stops covering a newly added edit,
 * and the "changed more than intended" guard quietly weakens without failing.
 *
 * `drop-placeholder` must be FIRST: it is the only tail-anchored edit, and its
 * inverse is an append rather than a replace.
 */
export const PRIVACY_EDITS = [
  { label: "drop-placeholder", find: PLACEHOLDER, replace: "" },
  { label: "effective-date", find: EFFDATE_ANCHOR, replace: EFFDATE_REPLACEMENT },
  { label: "name-operator", find: OPERATOR_ANCHOR, replace: OPERATOR_REPLACEMENT },
  { label: "add-no-sell", find: NO_SELL_ANCHOR, replace: NO_SELL_ANCHOR + NO_SELL_ADDITION },
]

/**
 * privacy_policy: drop the disclaimer, fix the placeholder date, name the
 * operator, add the carrier-standard sentence. Throws unless the input ends with
 * the disclaimer, each anchor appears exactly once, and reversing every edit
 * reproduces the input byte-for-byte.
 */
export function buildPrivacyPolicy(before) {
  if (!before.endsWith(PLACEHOLDER)) {
    throw new Error("privacy_policy does not END with the placeholder note — content shape changed, aborting")
  }
  let content = before
  for (const e of PRIVACY_EDITS) content = subOnce(`pp/${e.label}`, content, e.find, e.replace)

  let restored = content
  for (const e of [...PRIVACY_EDITS].reverse()) {
    restored = e.replace === "" ? restored + e.find : subOnce(`pp/undo-${e.label}`, restored, e.replace, e.find)
  }
  if (restored !== before) throw new Error("privacy_policy transform changed more than intended — aborting")
  return content
}

/** terms_of_service: drop the disclaimer, change nothing else. */
export function buildTermsOfService(before) {
  if (!before.endsWith(PLACEHOLDER)) {
    throw new Error("terms_of_service does not END with the placeholder note — content shape changed, aborting")
  }
  const content = subOnce("tos/drop-placeholder", before, PLACEHOLDER, "")
  if (content + PLACEHOLDER !== before) throw new Error("terms_of_service transform changed more than intended")
  return content
}

/** Checks reported before any write, and required to pass for one to happen. */
export function privacyPolicyChecks(content) {
  return [
    ["placeholder note removed", !/is a placeholder and requires review/.test(content)],
    ["no bracketed placeholder anywhere", !/\[[^\]]{1,40}\]/.test(content)],
    ["effective date matches the DB column", content.includes("18 August 2026")],
    ["legal entity named in the body", content.includes("YORTAGO LLC")],
    ["CTIA no-sell sentence present", content.includes("No mobile information will be sold or shared")],
    ["original no-sell sentence preserved", content.includes(NO_SELL_ANCHOR)],
    ["Reply STOP present", content.includes("Reply STOP")],
    ["Reply HELP present", content.includes("Reply HELP")],
    ["message frequency present", content.includes("Message frequency varies")],
    ["rates disclosure present", content.includes("Message and data rates may apply")],
    ["SMS section present", content.includes("SMS and Text Messaging")],
  ]
}

export function termsOfServiceChecks(before, content) {
  return [
    ["placeholder note removed", !/is a placeholder and requires review/.test(content)],
    ["body otherwise byte-identical", content === before.slice(0, before.length - PLACEHOLDER.length)],
  ]
}
