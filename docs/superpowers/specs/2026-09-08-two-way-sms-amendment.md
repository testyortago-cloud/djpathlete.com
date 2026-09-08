# Two-way SMS (gap #10) — amendment to the 2026-09-01 design

**Date:** 2026-09-08
**Amends:** `docs/superpowers/specs/2026-09-01-full-engine-phase3-two-way-sms-design.md`
(status "not yet approved")

**This is an amendment, not a replacement.** That design is sound and its three
decisions are well argued; duplicating it would create a second document to drift.
What follows is what changed under it, what I verified, and the rulings I took while
the owner was asleep.

---

## 1. Every precondition it says to confirm now HOLDS

The design says, in capitals, to confirm `business_settings.sms_messaging_service_sid`
before this phase sends anything. Read from production 2026-09-08:

| Field | Value | Verdict |
|---|---|---|
| `sms_messaging_service_sid` | `MGfcf240b6275f654f62874594a923d956` | matches the required SID exactly |
| `sender_name` | `Darren J. Paul` | non-empty — an empty one renders `from: " <addr>"`, which Resend rejects outright |
| `postal_address` | present | non-empty — an empty one stops the tick running at all |
| `timezone` | `America/New_York` | as expected |
| `sms_sender_phone` | `""` | empty, and CORRECT: the design mandates sending with `MessagingServiceSid`, never `From` |

`sendRenderedSequenceSms` still has exactly **one** caller
(`lib/automation/sequence-tick-runner.ts:369`), confirming the gap is real and unchanged.

A2P is approved and all three Twilio variables are in production. **Nothing here is
blocked on carriers.**

---

## 2. The three decisions — rulings taken, and which one still needs the owner

The design recommends an answer for each. I am adopting all three; one needs review.

### 2.1 Quiet hours on a manual reply — WARN, do not block. ADOPTED.
A human replying inside a live conversation is a different act from bulk marketing at
2am, and silently queueing a reply until 8am while someone waits is worse than sending
it. Second click, with the contact's local time shown. The sequence path keeps deferring
exactly as it does now — nothing touches `quietHoursDefer`.

### 2.2 Opt-out sentence on a manual message — FIRST message in a rolling 30 days only. ADOPTED, **BUT THIS ONE NEEDS THE OWNER.**
Appending "Reply STOP to opt out" to every one-line reply in an ongoing conversation
reads as automated and wastes a third of a segment. The design flags this as
compliance-adjacent and so do I: **it is a judgment about the owner's regulatory
exposure, not about code.** It is one boolean in `renderManualSms` to reverse, and no
other change. Sequence sends are unaffected and keep appending every time.

**Do not treat my adoption of this as a decision. It is a default so the work can
proceed; the owner or their counsel overrides it.**

### 2.3 Texting someone who sent STOP — NO, and not a preference. ADOPTED.
Enforced at three layers: the send function, the disabled compose box, and the route.
**"A guard on the client path is not a guard"** — if the claim is "no surface can text a
suppressed number", the ROUTE has to enforce it, not the button. Suppression is
identifier-keyed and checked before consent, so it survives a contact merge.

---

## 3. Testing reality — settled, do not re-litigate

**Outbound SMS cannot be tested from the Philippines at all.** Three sends to a PH handset
failed: `21408` first (Geo Permissions), then — after the owner enabled PH — the error
CHANGED to `21612`, which is structural. Twilio prices only `mobile` and `local` sender
types for Globe and Smart and lists **no `longcode` route**, so the US 10DLC number cannot
physically reach a PH handset. **Do NOT spend time on Geo Permissions (already correct) and
do NOT buy a PH number.**

**Inbound CAN be driven for free, with no phone.** Forge a correctly signed Twilio request:
HMAC-SHA1 over `url + each POST param key and value concatenated in ASCII-sorted key
order`, base64, keyed with `TWILIO_AUTH_TOKEN`, sent as `X-Twilio-Signature`. The URL must
be exactly `https://www.darrenjpaul.com/api/webhooks/twilio/inbound` — the **www** form,
because the HMAC covers the full URL and the apex 307-redirects. A signed `HELP` from an
unknown number is the safe probe: it writes no row and emails nobody. **Already verified
against production on 2026-09-07 — do not repeat it.**

So: the conversation view and the inbound path are fully testable here. The manual OUTBOUND
send is the one thing that cannot be end-to-end verified from this location, and that
limitation must be stated in the branch's report rather than papered over with a mock that
implies otherwise.

---

## 4. One thing to check that the design does not mention

`sequence_messages` is tied to a `sequence_run`, so **it cannot hold a manual send** — the
design says so and proposes schema in its §4.1. Before writing that migration, re-read
gap #11's `00256`: it added `save_sequence_steps` and changed `claim_sequence_runs`, and
its two-phase negative-position renumber is a pattern worth reusing rather than reinventing
if any ordering problem appears here. Also re-check the migration number at branch time —
`00256` is claimed by gap #11 and numbers collide silently.
