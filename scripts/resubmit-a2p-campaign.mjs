/**
 * Edits and resubmits the FAILED A2P 10DLC campaign after rejection 30886
 * (invalid campaign description).
 *
 * EDIT, NEVER DELETE. Twilio assesses the vetting fee once per campaign:
 * "if a Campaign is rejected its important to resubmit it rather than
 * deleting and recreating." This script has no delete path at all, by
 * design. The MIXED use case is correct, so nothing forces a recreate.
 *
 * Dry run is the default and prints the exact payload. Resubmitting is
 * opt-in via RESUBMIT=true, matching publish-legal-a2p-cleanup.mjs, because
 * this one is outward-facing to a third-party reviewer and a bad submission
 * costs one to three weeks.
 *
 *   node scripts/resubmit-a2p-campaign.mjs .env.local
 *   RESUBMIT=true node scripts/resubmit-a2p-campaign.mjs .env.local
 *
 * Editing a FAILED campaign over the API is a Twilio Private Beta feature
 * and is off by default. When the account is not enrolled the update is
 * refused; the script detects that and prints the copy to paste into the
 * Console instead ("Edit Campaign" on the campaign detail screen), which is
 * enabled for everyone.
 *
 * Copy under review: docs/compliance/2026-08-24-a2p-campaign-resubmission.md
 */
import { readFileSync } from "node:fs"

const SERVICE_SID = "MGfcf240b6275f654f62874594a923d956"
const CAMPAIGN_SID = "QE2c6890da8086d771620e9b13fadeba0b"
const BRAND_SID = "BN2b541fc50cabc7a9964d427e38444eac"

// Names the registered entity (brand is registered as YORTAGO, EIN
// 88-2915522 -- not "DJP Athlete"), states sender / recipient / purpose as
// three explicit clauses, carries no consent boilerplate, and is ASCII-only.
// The rejected version failed on all four counts.
const DESCRIPTION =
  "YORTAGO LLC, a Florida limited liability company that operates the athlete " +
  "performance training business DJP Athlete at darrenjpaul.com, is the sender. " +
  "Recipients are prospective and existing clients who submitted an inquiry or " +
  "assessment form on darrenjpaul.com and ticked the optional SMS consent box " +
  "beneath the phone field - adult athletes, and the parents or guardians who " +
  "enquire on behalf of a minor athlete. Messages are sent to reply to those " +
  "inquiries, deliver performance assessment results, confirm and remind clients " +
  "of booked consultations and training sessions, notify clients of schedule " +
  "changes, and share details of our own training programs, camps and assessments."

// Five DISTINCT samples. The rejected submission had five slots holding four
// messages: slot 4 was two messages concatenated, slot 5 duplicated slot 4's
// second half. Internal CRLFs flattened to spaces, en dashes to hyphens.
const MESSAGE_SAMPLES = [
  "DJP Athlete: Thanks for completing your performance assessment. Your results are ready - review your next steps here: https://www.darrenjpaul.com/assessment Reply STOP to opt out, HELP for help.",
  "DJP Athlete: Hi [First Name], thanks for your interest in our athlete performance training. You can learn more or book a consultation here: https://www.darrenjpaul.com/in-person Reply STOP to opt out, HELP for help.",
  "DJP Athlete: Reminder - your session with Darren is on [Day] at [Time], [Location]. Reply STOP to opt out, HELP for help.",
  "DJP Athlete: Hi [First Name], our Rotational Reboot program starts [Date]. Full details and schedule: https://www.darrenjpaul.com/programs/rotational-reboot Reply STOP to opt out, HELP for help.",
  "DJP Athlete: Hi [First Name], early registration for our [Month] performance camp is now open. Details here: https://www.darrenjpaul.com/camps Msg&data rates may apply. Reply STOP to opt out, HELP for help.",
]

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

function nonAscii(s) {
  return [...s].filter((c) => c.charCodeAt(0) > 127)
}

async function main() {
  const envPath = process.argv[2] ?? ".env.local"
  const resubmit = process.env.RESUBMIT === "true"
  const force = process.env.FORCE === "true"
  const env = loadEnv(envPath)

  const user = env.TWILIO_MAIN_SID || env.TWILIO_ACCOUNT_SID
  const pass = env.TWILIO_MAIN_SID ? env.TWILIO_CLIENT_SECRET : env.TWILIO_AUTH_TOKEN
  if (!user || !pass) throw new Error(`missing Twilio credentials in ${envPath}`)
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
  const api = async (url, init) => {
    const res = await fetch(url, { ...init, headers: { Authorization: auth, ...(init?.headers ?? {}) } })
    let body
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  }

  console.log(`env file : ${envPath}`)
  console.log(`mode     : ${resubmit ? "RESUBMIT (live)" : "dry run (prints only)"}`)

  // --- Guard 1: the copy must be ASCII. An en dash is what we are fixing.
  const bad = [...nonAscii(DESCRIPTION), ...MESSAGE_SAMPLES.flatMap(nonAscii)]
  if (bad.length) {
    throw new Error(`non-ASCII characters in the payload: ${JSON.stringify(bad)}`)
  }
  // --- Guard 2: five DISTINCT samples. The old defect was a duplicate.
  if (new Set(MESSAGE_SAMPLES).size !== MESSAGE_SAMPLES.length) {
    throw new Error("message samples contain a duplicate")
  }
  console.log(`copy     : ASCII clean, ${MESSAGE_SAMPLES.length} distinct samples`)

  // --- Guard 3: only ever touch a campaign that is actually FAILED.
  const list = await api(`https://messaging.twilio.com/v1/Services/${SERVICE_SID}/Compliance/Usa2p`)
  if (!list.ok) throw new Error(`campaign lookup failed ${list.status}: ${JSON.stringify(list.body)}`)
  // NOTE: this endpoint returns a LIST ({compliance: [...]}), not an instance.
  // Reading .campaign_status off the response gives undefined, which reads as
  // "never submitted" and is exactly how this got misdiagnosed once already.
  const campaign = (list.body.compliance ?? []).find((c) => c.sid === CAMPAIGN_SID)
  if (!campaign) throw new Error(`campaign ${CAMPAIGN_SID} not found on service ${SERVICE_SID}`)
  console.log(`campaign : ${campaign.sid} status=${campaign.campaign_status} usecase=${campaign.us_app_to_person_usecase}`)
  for (const e of campaign.errors ?? []) console.log(`  prior error ${e.error_code} on ${(e.fields ?? []).join(",")}`)

  if (campaign.campaign_status !== "FAILED" && !force) {
    console.log(`\nREFUSING: status is ${campaign.campaign_status}, not FAILED.`)
    console.log("Only a FAILED campaign should be edited. Set FORCE=true to override.")
    process.exit(1)
  }

  // --- Guard 4: the live privacy policy must not still be the placeholder.
  // The submitted message flow links it, and 30933 makes it a hard requirement.
  // Resubmitting into a known-bad prerequisite burns a review cycle.
  const pp = await fetch("https://www.darrenjpaul.com/privacy-policy").then((r) => r.text()).catch(() => "")
  const placeholder = pp.includes("placeholder and requires review by a qualified legal professional")
  console.log(`privacy  : live page ${placeholder ? "STILL carries the placeholder disclaimer" : "clean of the placeholder disclaimer"}`)
  if (placeholder && !force) {
    console.log("\nREFUSING: the privacy policy linked from the submitted message flow still")
    console.log("says it is an unreviewed placeholder.")
    console.log("")
    console.log("This is a STALE PAGE, not an unpublished row. privacy_policy v4 and")
    console.log("terms_of_service v3 went active in prod on 2026-08-23 14:24Z and both are")
    console.log("correct. These pages are statically prerendered and CDN-cached, so the row")
    console.log("never reaches the page without a redeploy.")
    console.log("")
    console.log("REDEPLOY, then confirm the live page renders Version 4, then rerun.")
    console.log("Do NOT rerun publish-legal-a2p-cleanup.mjs -- the content is already correct")
    console.log("and republishing would stack a needless version on top of it.")
    console.log("Set FORCE=true to override.")
    process.exit(1)
  }

  // All seven parameters are required on update even to change one field.
  const form = new URLSearchParams()
  form.set("Description", DESCRIPTION)
  form.set("MessageFlow", campaign.message_flow)   // untouched: it was not flagged
  form.set("HasEmbeddedLinks", String(campaign.has_embedded_links))
  form.set("HasEmbeddedPhone", String(campaign.has_embedded_phone))
  form.set("AgeGated", "false")
  form.set("DirectLending", "false")
  for (const s of MESSAGE_SAMPLES) form.append("MessageSamples", s)

  console.log("\n===== PAYLOAD =====")
  console.log(`Description (${DESCRIPTION.length} chars):\n${DESCRIPTION}\n`)
  MESSAGE_SAMPLES.forEach((s, i) => console.log(`Sample ${i + 1}: ${s}`))
  console.log(`\nMessageFlow: unchanged (${campaign.message_flow.length} chars)`)
  console.log(`HasEmbeddedLinks=${campaign.has_embedded_links} HasEmbeddedPhone=${campaign.has_embedded_phone} AgeGated=false DirectLending=false`)

  if (!resubmit) {
    console.log("\nDry run. Nothing was sent. Rerun with RESUBMIT=true to submit.")
    return
  }

  const url = `https://messaging.twilio.com/v1/Services/${SERVICE_SID}/Compliance/Usa2p/${CAMPAIGN_SID}`
  const res = await api(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })

  if (res.ok) {
    console.log(`\nSUBMITTED. status is now ${res.body?.campaign_status}`)
    console.log("Vetting runs one to three weeks. Recheck with the read-only probe.")
    return
  }

  console.log(`\nUPDATE REFUSED ${res.status}: ${res.body?.message ?? JSON.stringify(res.body)}`)
  console.log(`(twilio code ${res.body?.code ?? "?"})`)
  console.log("\nEditing a FAILED campaign over the API is a Twilio Private Beta feature and")
  console.log("is off by default. Either ask Twilio support to enable it on this account,")
  console.log("or paste the copy printed above into the Console:")
  console.log(`  Messaging > Services > ${SERVICE_SID} > Regulatory Compliance`)
  console.log('  then the blue "Edit Campaign" link on the campaign detail screen.')
  console.log("Do NOT delete the campaign -- the vetting fee is charged once per campaign.")
  process.exit(1)
}

main().catch((e) => { console.error(`\nFAILED: ${e.message}`); process.exit(1) })
