# A2P campaign resubmission — review sheet (2026-08-24)

Campaign `QE2c6890da8086d771620e9b13fadeba0b` on service `MGfcf240b6275f654f62874594a923d956`.

## OUTCOME — APPROVED 2026-08-25

Rechecked with the read-only probe on 2026-08-25 01:55Z: the campaign is
**`campaign_status: VERIFIED`**, `errors: []`, use case `MIXED`, description 683
chars naming YORTAGO LLC, 5 of 5 samples distinct. The description and samples read
back from the API match the copy this script sent, so the edit is what passed vetting.

All three gates are green and the number can send:

| Gate | Status |
|---|---|
| Business profile `BUf7e1dea8b0b2f2f3bbaadf79a24bbb0b` | `twilio-approved` |
| Brand `BN2b541f…` (TCR `BWS458H`) | `APPROVED`, identity `VERIFIED`, STANDARD |
| Campaign `QE2c6890…` | **`VERIFIED`** |
| Number `+18132129256` | SMS/MMS/Voice, in the sender pool |

Approval took ~1 day, not the one-to-three weeks quoted below.

### Delivery proven end to end, 2026-08-25 02:04:50Z

One test message to `+16176504548`, sent with `MessagingServiceSid` (never `From`),
came back **`status=delivered`, `error=none`**. Verified campaign -> messaging service
-> carrier -> handset. No `30007` filtering.

At that moment the account's lifetime history was **1 outbound, 0 inbound, 1 distinct
recipient** — proof that none of the 73 queued consent requests had escaped, and a
clean baseline for measuring anything sent from here.

**Send with `MessagingServiceSid`, never `From`.** The number's *account-side*
`IncomingPhoneNumbers.messaging_service_sid` is `null` even though it sits in the
service's sender pool (`PN27c434bb4fc11b4516e41e38a7bb3621`). The pool membership is
what A2P keys on, so the null is a display quirk, not a misconfiguration — but a
`From` send does not route through the service and so does not reliably carry the
campaign. `lib/lead-engine/sms.ts:176` only takes the `MessagingServiceSid` path when
`business_settings.sms_messaging_service_sid` is non-empty, and migration 00221 seeds
that column `NOT NULL DEFAULT ''`. **Confirm it holds
`MGfcf240b6275f654f62874594a923d956` before enabling sequence dispatch** — otherwise
every app send silently takes the filtered fallback.

Still untested: **inbound STOP/HELP**. Delivery working does not prove opt-out works,
and opt-out is the compliance-critical half.

**Throughput is the unvetted-brand default:** AT&T 4 msg/sec (`msg_class: F`),
T-Mobile `brand_tier: LOW` (~2,000/day). `brand_score` is `null` because no secondary
vetting has run. Fine at current lead volume; raising it means paying for secondary
vetting, which is a separate decision.

**Watch out:** the campaign's `date_updated` still reads `2026-08-23T02:20:13Z`,
identical to `date_created`, even though it was edited on 2026-08-24. That field is
not maintained by an edit. Verify a resubmission by reading `description` /
`message_samples` back, never by the timestamp.

## History — resubmitted 2026-08-24

Legal v4 was redeployed, the live pages were confirmed clean, and the campaign was
edited in place and resubmitted. Verified with an independent read-only probe:

| | before | after |
|---|---|---|
| `campaign_status` | `FAILED` | **`IN_PROGRESS`** |
| `errors` | `30886` on `USE_CASE_DESCRIPTION` | `[]` |
| `sid` | `QE2c6890…` | `QE2c6890…` — same, edited in place, no second vetting fee |
| use case | `MIXED` | `MIXED` — unchanged |
| description | 5x "DJP Athlete", en dash, boilerplate | 683 chars, ASCII-clean, names YORTAGO LLC |
| samples | 5 slots / 4 messages, 1 duplicate | 5 of 5 distinct |

The API edit path worked, so this account **is** enrolled in Twilio's private beta for
editing a FAILED campaign over the API — the Console fallback below was not needed.

Vetting runs one to three weeks. Recheck with the read-only probe; nothing further is
needed unless it comes back `FAILED` again. *(It came back `VERIFIED` on 2026-08-25 —
see the OUTCOME section above.)*

The record of the rejection and the reasoning behind each copy change follows.

Dry run:  `node scripts/resubmit-a2p-campaign.mjs .env.local`
Resubmit: `RESUBMIT=true node scripts/resubmit-a2p-campaign.mjs .env.local`

## Opt-out auto-replies — ALREADY WORKING (corrected 2026-08-25)

**Opt-Out Management is enabled and replying, with Twilio's default wording.**
Confirmed from handset screenshots on 2026-08-25:

| Sent | Reply received |
|---|---|
| `HELP` | "Reply STOP to unsubscribe. Msg&Data Rates May Apply." |
| `STOP` | "You have successfully been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe." |
| `START` | "You have successfully been re-subscribed to messages from this number. Reply HELP for help. Reply STOP to unsubscribe. Msg&Data Rates May Apply." |

An earlier revision of this document claimed "nobody answers HELP or STOP". **That was
wrong**, and the reasoning error is worth keeping: it inferred silence from the account's
outbound message count staying at 1. **Twilio's own opt-out auto-replies never appear in
the Messages resource** — they are sent by the platform, not through the API. Absence
from `GET /Messages.json` is NOT evidence that no message was sent. The only way to see
them is a handset.

So the opt-out surface is compliant as it stands, and STOP genuinely blocks at the
Twilio layer independent of this app's suppression row.

### The one real weakness: the default HELP reply

`Reply STOP to unsubscribe. Msg&Data Rates May Apply.` does **not name the business** and
gives **no support contact**. CTIA guidance expects a HELP reply to identify the program
and offer customer care. Customising it is therefore worth doing — as an improvement, not
as a fix for an outage. STOP and START defaults are fine as they are.

Twilio Opt-Out Management has **no API**. Verified 2026-08-25 three ways: the
Messaging Service resource exposes 22 fields and none is opt-out related; Twilio's own
`links` advertises 8 sub-resources (`alpha_senders`, `channel_senders`,
`destination_alpha_senders`, `messages`, `phone_numbers`, `short_codes`,
`us_app_to_person`, `us_app_to_person_usecases`) and none is opt-out; and
`OptOuts` / `OptOutKeywords` / `AdvancedOptOut` / `AdvancedOptOutKeywords` /
`OptOutSettings` / `Keywords` all 404.

It is therefore configured by hand at **Messaging > Services >
`MGfcf240b6275f654f62874594a923d956` > Opt-Out Management**, which means the wording
lives outside this repo with no diff and no review. This section is the reference copy
— if the console and this file disagree, one of them was edited without the other.

Each is one segment and ASCII-only (TCR is unreliable with non-ASCII — an en dash in
`2-6` contributed to the original campaign rejection).

**HELP** (136 chars) — carries brand, support contact, frequency, rate disclosure, opt-out keyword:

    DJP Athlete: Support - darren@darrenjpaul.com or darrenjpaul.com. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out.

**STOP** (104 chars):

    DJP Athlete: You are unsubscribed and will receive no more messages from us. Reply START to resubscribe.

**START** (132 chars):

    DJP Athlete: You are resubscribed and will receive messages again. Msg&data rates may apply. Reply HELP for help or STOP to opt out.

Support address is `darren@darrenjpaul.com` — the dominant address in the repo (46
uses). Change it here and in the console together.

**`business_settings.sms_help_text` is dead.** Migration 00212 seeds it
`NOT NULL DEFAULT ''` and nothing reads it; with the wording in the console nothing
ever will. Drop it in a future migration rather than leaving a second, silent source of
truth for somebody to wire up later.

**Verify after configuring:** have the tester text `HELP` and confirm the NEW wording
arrives. This genuinely needs a handset and there is no substitute — the reply comes from
Twilio's platform, is invisible to `GET /Messages.json`, and the signed local probe
(`scratchpad/probe-live-webhook.mjs`) cannot see it either. `HELP` blocks nothing, so no
`START` is needed afterwards.

## Where the three gates stand

| Gate | Status |
|---|---|
| Business profile `BUf7e1de…` | `twilio-approved` — the old 18601 rejection is cleared |
| Brand `BN2b541f…` (TCR `BWS458H`) | `APPROVED`, identity `VERIFIED`, STANDARD |
| Campaign `QE2c6890…` | **`FAILED`** — error 30886, field `USE_CASE_DESCRIPTION` |
| Number `+18132129256` | SMS-capable, `in-use`, in the sender pool, webhooks correct |

The campaign was submitted 2026-08-23 02:20Z and rejected. The brand was not
approved until 19:36Z the same day — **17 hours after the campaign was already
dead**. It has had no attempt since the brand cleared.

## Rule that governs the fix

> "A vetting fee is assessed only once per Campaign. So if a Campaign is
> rejected its important to resubmit it rather than deleting and recreating."

**Edit in place. Never delete this campaign.** Deleting forfeits the paid vetting
and starts the fee again. The use case (`MIXED`) is correct, so nothing forces a
recreate.

## 1. Campaign description — the rejected field

Twilio's 30886 remediation: the description must say "who the sender is, who the
recipient is, and why messages are being sent."

**Before** (rejected):

> DJP Athlete uses SMS to communicate with prospective and existing clients, athletes, and parents/guardians who have directly opted in by providing their mobile number and checking the SMS consent box. Messages may include responses to inquiries, consultation and appointment confirmations/reminders, training and scheduling updates, client follow-up, and occasional information about relevant programs, camps, assessments, and services. Message frequency varies, approximately 2–6 messages per month. Message and data rates may apply. DJP Athlete does not purchase third-party contact lists or send unsolicited messages.

**After:**

> YORTAGO LLC, a Florida limited liability company that operates the athlete performance training business DJP Athlete at darrenjpaul.com, is the sender. Recipients are prospective and existing clients who submitted an inquiry or assessment form on darrenjpaul.com and ticked the optional SMS consent box beneath the phone field - adult athletes, and the parents or guardians who enquire on behalf of a minor athlete. Messages are sent to reply to those inquiries, deliver performance assessment results, confirm and remind clients of booked consultations and training sessions, notify clients of schedule changes, and share details of our own training programs, camps and assessments.

Four things changed, each tied to a documented 30886 cause:

1. **Names the registered entity.** The brand is registered as `business_name:
   "YORTAGO"` (EIN 88-2915522). The rejected description said "DJP Athlete" five
   times and never mentioned YORTAGO. Twilio: "use the actual registered business
   name"; 30886 lists "inconsistency with registered brand details" as a cause.
   This is the most likely trigger.
2. **Sender / recipient / purpose are now three explicit clauses** rather than one
   run-on that led with the opt-in mechanism.
3. **Consent boilerplate removed.** "Message and data rates may apply", "does not
   purchase third-party contact lists" and the frequency line are disclosure text —
   they belong in the opt-in flow and the samples, which already carry them. In the
   description they crowded out the program detail the reviewer was looking for.
4. **ASCII only.** The rejected text contained an en dash (`2–6`, U+2013). TCR is
   unreliable with non-ASCII.

## 2. Message samples — a real defect, fixed

The rejected submission had five slots holding **four** distinct messages. Slot 4
was two separate messages concatenated with a `\r\n`, and slot 5 was a verbatim
copy of slot 4's second half. That feeds 30886's "inconsistency with sample
messages".

| # | Before | After |
|---|---|---|
| 1 | assessment results | unchanged (en dash -> `-`, CRLF -> space) |
| 2 | interest / consultation | unchanged (CRLF -> space) |
| 3 | session reminder | unchanged (en dash -> `-`) |
| 4 | **Rotational Reboot + camp glued together** | Rotational Reboot only |
| 5 | **duplicate of slot 4's camp half** | camp registration only |

## 3. Message flow — deliberately untouched

`MESSAGE_FLOW` was not flagged by the rejection, is already ASCII, and quotes the
on-site consent checkbox verbatim. Changing it now would break that match
mid-review. All eight URLs it cites were checked and return 200.

## Prerequisite that is NOT done

The submitted flow links `https://www.darrenjpaul.com/privacy-policy`. That page is
**still live as Version 3** and still ends with:

> This document is a placeholder and requires review by a qualified legal professional before use.

It also lacks the carrier-vetted no-sell sentence. A reviewer following that link to
a document self-labelled as an unreviewed placeholder is an avoidable second
rejection — and error 30933 makes the privacy policy URL a hard requirement for
registration.

**The publish is already DONE — the missing step is a redeploy.** Checked against
prod on 2026-08-24:

| | database row | live page |
|---|---|---|
| privacy_policy | **v4 active**, published 2026-08-23 14:24Z | serving v3 |
| terms_of_service | **v3 active**, published 2026-08-23 14:24Z | serving v2 |

Both rows verified correct: placeholder removed from both, no-sell sentence and
"YORTAGO LLC" present in the policy, the "March 1st 2026" placeholder date gone.
Both `legal_document.published` audit rows exist.

The live page is simply stale — it answers `x-vercel-cache: HIT`,
`x-nextjs-prerender: 1`, `age: 70495` (~19.6 hours). These pages are statically
prerendered and CDN-cached, so a published row never reaches the page without a
redeploy. Do NOT rerun `publish-legal-a2p-cleanup.mjs` — it would build a
needless v5/v4 on top of correct content, and its builder already aborts with
"does not END with the placeholder note" because the disclaimer it anchors on is
gone.

Note that a stale page reads exactly like an unpublished row. "Is the row
published?" and "is it live?" are two different questions — answer both, and
treat `x-vercel-cache: HIT` with a large `age` as proof of the second.

**Order: redeploy + confirm `Version 4` renders, then resubmit the campaign.**

## Note on the API path

Editing a FAILED campaign over the API "is currently available as a Private Beta
product" and must be enabled per-account. The Console path — the blue "Edit
Campaign" link on the campaign detail screen — is enabled by default. The script
attempts the API update and, if the account is not in the beta, says so and falls
back to printing the exact copy to paste into the Console.

Sources: [error 30886](https://www.twilio.com/docs/api/errors/30886) ·
[troubleshooting and rectifying A2P campaigns](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-and-rectifying-a2p-campaigns) ·
[UsAppToPerson resource](https://www.twilio.com/docs/messaging/api/usapptoperson-resource)
