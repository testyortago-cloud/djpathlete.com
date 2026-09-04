/**
 * Builds terms-of-service-v3.html from the CURRENTLY ACTIVE terms of service (v2)
 * by inserting a new "11. SMS and Text Messaging" section.
 *
 * Why a builder and not a hand-edited file: the terms are 13,905 characters of
 * legal text that nobody should be re-typing. Every existing byte is preserved —
 * the only change is one insertion, anchored on an exact string that must match
 * exactly once or this throws.
 *
 * WHY SECTION 11: the live document numbers its sections 1-10 and then jumps
 * straight to 12. There is no section 11. The SMS section fills that existing
 * gap, so NOTHING is renumbered and no cross-reference anywhere can break. It
 * also lands the SMS terms at the same number the privacy policy uses for its
 * own SMS section, which is what a carrier reviewer comparing the two will see.
 *
 * SECOND EDIT: the document's own "Effective Date" line is moved to the date this
 * amendment is published, so the date printed in the body matches the
 * legal_documents.effective_date the page renders above it. Adding a section while
 * leaving a stale date in the text is the kind of internal contradiction that got
 * the privacy policy's "[March 1st 2026]" placeholder flagged.
 *
 * FORMATTING: body paragraphs are plain, not wrapped in <strong>. Bolding in this
 * document is arbitrary (sections 1, 4, 8 and 12 are unbolded; 2, 6, 7, 9, 10 are
 * fully bold), so there is no house style to match. Plain matches section 12, the
 * paragraph this one is inserted directly above.
 *
 *   node docs/compliance/build-terms-v3.mjs <active-v2.html> <out.html>
 */
import { readFileSync, writeFileSync } from "node:fs"

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error("usage: node docs/compliance/build-terms-v3.mjs <active-v2.html> <out.html>")
  process.exit(1)
}

const source = readFileSync(inPath, "utf8")

// The insertion point. Anchored on section 12's heading so the new section lands
// between "10. Privacy and Data" and "12. Parent / Guardian Responsibilities".
const ANCHOR = "<p><strong>12. Parent / Guardian Responsibilities</strong></p>"

const occurrences = source.split(ANCHOR).length - 1
if (occurrences !== 1) {
  console.error(`REFUSING — anchor matched ${occurrences} times, expected exactly 1:\n  ${ANCHOR}`)
  process.exit(1)
}

// Refuse to run twice. A second insertion would produce two section 11s.
if (/<p><strong>11\./.test(source) || /SMS/i.test(source)) {
  console.error("REFUSING — the source already contains a section 11 or an SMS mention; it may already be built")
  process.exit(1)
}

const SECTION = [
  "<p><strong>11. SMS and Text Messaging</strong></p>",
  "<p>If you provide a mobile number and tick the text-message consent box on one of our website forms, you agree" +
    " to receive text messages from DJP Athlete, the training service operated by YORTAGO LLC. Because the Athlete" +
    " is a minor, the Parent provides the mobile number and gives this consent on the Athlete’s behalf.</p>",
  "<p>These messages may include replies to your inquiry, assessment results and other information you asked for," +
    " appointment and session reminders, training and program information, educational content, and occasional" +
    " promotional offers.</p>",
  "<p>Message frequency varies, approximately 2 to 6 messages per month. Message and data rates may apply. Any" +
    " such charges are set by your mobile carrier and are your responsibility.</p>",
  "<p>Consent to receive text messages is not a condition of purchase. You do not need to agree to them in order" +
    " to register for, pay for, or take part in any of our services.</p>",
  "<p>You can opt out at any time by replying STOP to any message from us. You will receive one confirmation" +
    " message and then no further messages. CANCEL, QUIT, UNSUBSCRIBE, OPTOUT, STOPALL, REVOKE and END also stop" +
    " messages. Reply HELP for assistance, or email info@darrenjpaul.com.</p>",
  "<p>No mobile information will be sold or shared with third parties or affiliates for marketing or promotional" +
    " purposes. We do not sell, rent or share your mobile number, or your consent to receive text messages, with" +
    " any third party for their own marketing purposes.</p>",
  "<p>Message delivery is not guaranteed. Carriers are not liable for delayed or undelivered messages.</p>",
  "<p>How we store and use your mobile number, and the record of your consent, is described in our Privacy Policy" +
    " at https://www.darrenjpaul.com/privacy-policy.</p>",
].join("")

const withSection = source.replace(ANCHOR, SECTION + ANCHOR)

// Every byte of the original must survive: this step is the input plus the section.
if (withSection.length !== source.length + SECTION.length) {
  console.error("REFUSING — output length is not input + section; the replace did more than insert")
  process.exit(1)
}

// Second edit: the body's own effective date, in the document's existing style
// ("May 3rd 2026"), not ISO.
const DATE_ANCHOR = "<p><strong>Effective Date:</strong> May 3rd 2026</p>"
if (withSection.split(DATE_ANCHOR).length - 1 !== 1) {
  console.error(`REFUSING — effective-date anchor did not match exactly once:\n  ${DATE_ANCHOR}`)
  process.exit(1)
}
const d = new Date()
const day = d.getDate()
const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th"
const month = d.toLocaleString("en-US", { month: "long" })
const NEW_DATE = `<p><strong>Effective Date:</strong> ${month} ${day}${suffix} ${d.getFullYear()}</p>`
const output = withSection.replace(DATE_ANCHOR, NEW_DATE)
console.log(`  effective date in body: "May 3rd 2026" -> "${month} ${day}${suffix} ${d.getFullYear()}"`)
if (!output.endsWith(source.slice(-600))) {
  console.error("REFUSING — the document tail changed")
  process.exit(1)
}
if (!output.startsWith("<h1>Terms of Service</h1>")) {
  console.error("REFUSING — the document no longer opens with its title")
  process.exit(1)
}
// Nothing but the two intended edits: strip both and the rest must be byte-identical.
if (output.replace(SECTION, "").replace(NEW_DATE, DATE_ANCHOR) !== source) {
  console.error("REFUSING — the output differs from the source by more than the two intended edits")
  process.exit(1)
}

// A2P 10DLC elements the carrier reviewer looks for.
const required = [
  ["STOP keyword", /Reply(ing)? STOP|replying STOP/],
  ["HELP keyword", /Reply HELP/],
  ["message frequency", /Message frequency varies/],
  ["rates disclosure", /Message and data rates may apply/],
  ["no-sell\/share of mobile", /No mobile information will be sold or shared with third parties or affiliates/],
  ["consent not a condition", /not a condition of purchase/],
  ["carrier liability", /Carriers are not liable/],
  ["legal entity named", /YORTAGO LLC/],
  ["privacy policy link", /https:\/\/www\.darrenjpaul\.com\/privacy-policy/],
]
const missing = required.filter(([, re]) => !re.test(output)).map(([n]) => n)
if (missing.length) {
  console.error("REFUSING — built content is missing:", missing.join(", "))
  process.exit(1)
}

writeFileSync(outPath, output)
console.log(`built ${outPath}`)
console.log(`  ${source.length} chars in -> ${output.length} chars out (+${SECTION.length})`)
console.log(`  all ${required.length} A2P elements present`)
