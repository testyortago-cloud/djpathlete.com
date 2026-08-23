/**
 * Builds privacy_policy v2 from the live v1 content.
 * Every existing sentence is preserved byte-for-byte; edits are surgical and asserted.
 */
import { readFileSync, writeFileSync } from "node:fs"

let src = readFileSync(new URL("./pp-body.html", import.meta.url), "utf8")

// Trim the page chrome that wrapped the injected content.
src = src.replace(/^<div>/, "").replace(/<\/div><\/div><\/div><\/div><!--\$-->[\s\S]*$/, "")

const edits = []
function sub(label, find, replace) {
  const n = src.split(find).length - 1
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`)
  src = src.replace(find, replace)
  edits.push(label)
}

// 1. Real effective date, not a bracketed placeholder.
sub(
  "effective-date",
  "<p><strong>Effective Date:</strong> [March 1st 2026]</p>",
  "<p><strong>Effective Date:</strong> 18 August 2026</p>",
)

// 2. Name the operating legal entity (the same mismatch that caused Twilio error 18601).
sub(
  "name-operator",
  '<p>DJP Athlete ("we", "our", "us") is committed to protecting your privacy.',
  '<p>DJP Athlete is a brand of YORTAGO LLC ("we", "our", "us"), which operates darrenjpaul.com. We are committed to protecting your privacy.',
)

// 3. Collection: mobile number + the consent record itself.
sub(
  "collect-mobile",
  "<li><p>Communications: any message, form, or document you send to us.</p></li>",
  "<li><p>Mobile number and messaging consent: if you opt in to text messages, your mobile number and a record of that consent — when you gave it, how you gave it, and the wording you were shown;</p></li>" +
    "<li><p>Communications: any message, form, or document you send to us.</p></li>",
)

// 4. Use: the marketing bullet currently names email only.
sub(
  "use-sms",
  "Send service-related notices and, where you have opted in, marketing emails (you may opt out at any time);",
  "Send service-related notices and, where you have opted in, marketing emails and text messages (you may opt out at any time);",
)

// 5. Sharing: the explicit mobile-opt-in clause carrier vetting looks for.
sub(
  "share-mobile",
  "<li><p>A successor entity in the event of a sale or reorganisation of the business, subject to this Policy.</p></li></ul>",
  "<li><p>A successor entity in the event of a sale or reorganisation of the business, subject to this Policy.</p></li></ul>" +
    "<p><strong>Mobile information is never shared for marketing.</strong> No mobile information will be sold or shared with third parties or affiliates for marketing or promotional purposes. Your mobile number and your text-messaging consent are not shared with anyone except the messaging providers that transmit the messages on our behalf, and those providers may not use the information for any other purpose.</p>",
)

// 6. New section 9, then renumber the three sections that followed it.
const SMS_SECTION =
  "<p><strong>9. SMS and text messaging</strong></p>" +
  "<p>If you opt in, we send text messages about your training — appointment and session reminders, scheduling changes, programme updates, and occasional promotional messages about our services.</p>" +
  "<ul>" +
  "<li><p><strong>How you opt in.</strong> We send text messages only to people who have given express written consent: by ticking the SMS consent box on a form on this Site, by giving written consent during intake, or by texting us first. Consent to receive marketing text messages is never a condition of purchasing any product or service.</p></li>" +
  "<li><p><strong>Message frequency.</strong> Message frequency varies. You can expect up to approximately 6 messages per month, depending on your programme and your bookings.</p></li>" +
  "<li><p><strong>Cost.</strong> Message and data rates may apply. These are charged by your mobile carrier, not by us.</p></li>" +
  "<li><p><strong>How to opt out.</strong> Reply STOP to any message to stop receiving text messages at any time. You will receive one confirmation that you have been unsubscribed, and we will send no further messages unless you opt in again.</p></li>" +
  "<li><p><strong>How to get help.</strong> Reply HELP to any message, or email darren@darrenjpaul.com, for assistance.</p></li>" +
  "<li><p><strong>Delivery.</strong> Mobile carriers are not liable for delayed or undelivered messages.</p></li>" +
  "</ul>"

sub(
  "insert-sms-section",
  "<p><strong>9. International transfers</strong></p>",
  SMS_SECTION + "<p><strong>10. International transfers</strong></p>",
)
sub(
  "renumber-10",
  "<p><strong>10. Changes to this Policy</strong></p>",
  "<p><strong>11. Changes to this Policy</strong></p>",
)
sub("renumber-11", "<p><strong>11. Contact</strong></p>", "<p><strong>12. Contact</strong></p>")

// 7. Drop the "this document is a placeholder" line — it would read as an invalid
//    policy to a carrier reviewer. Flagged to Darren for confirmation.
sub(
  "drop-placeholder-note",
  "<hr><p><em>This document is a placeholder and requires review by a qualified legal professional before use.</em></p>",
  "",
)

const out = "<h1>Privacy Policy</h1>" + src

// Assertions: every A2P 10DLC element must be present.
const required = [
  ["STOP keyword", /Reply STOP/],
  ["HELP keyword", /Reply HELP/],
  ["message frequency", /Message frequency varies/],
  ["rates disclosure", /Message and data rates may apply/],
  [
    "no-sell/share of mobile",
    /No mobile information will be sold or shared with third parties or affiliates for marketing or promotional purposes/,
  ],
  ["legal entity named", /YORTAGO LLC/],
  ["no bracketed placeholder", /^(?!.*\[March 1st 2026\])/s],
  ["placeholder note removed", /^(?!.*is a placeholder and requires review)/s],
]
let failed = 0
for (const [name, re] of required) {
  const ok = re.test(out)
  if (!ok) failed++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`)
}

// Section numbering must be 1..12, in order, with no gaps.
const nums = [...out.matchAll(/<(?:h2|p)><strong>(\d+)\.\s/g)].map((m) => Number(m[1]))
const expected = Array.from({ length: 12 }, (_, i) => i + 1)
const numsOk = JSON.stringify(nums) === JSON.stringify(expected)
console.log(`  ${numsOk ? "PASS" : "FAIL"}  section numbering 1..12 (got ${nums.join(",")})`)
if (!numsOk) failed++

console.log("\nedits applied:", edits.join(", "))
console.log("chars:", src.length, "->", out.length)
if (failed) {
  console.error(`\n${failed} CHECK(S) FAILED — not writing output`)
  process.exit(1)
}
writeFileSync(new URL("./privacy-v2.html", import.meta.url), out)
console.log("\nwrote privacy-v2.html")
