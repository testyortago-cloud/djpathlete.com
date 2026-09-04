# Full Engine Phase 3 — two-way SMS

**Status:** design, not yet approved
**Date:** 2026-09-01
**Branch:** `feat/two-way-sms` (not created)
**Parent:** [docs/full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) §4
**Depends on:** Phase 1 (the contact detail page is where the send action lives)
**Closes scope lines:** "Two-way SMS … sending … and inbound replies landing in
your admin rather than only on your phone"
**Owner decision, 2026-09-01:** a full conversation view, not just a send button.

---

## 1. What this is

The inbound half works and the outbound half is automated-only.

`sendRenderedSequenceSms` has **exactly one caller in the repo** — the sequence
tick runner. There is no way to text a person from the admin and no way to reply
to one. Inbound messages write a `contact_timeline_events` row (invisible until
Phase 1) and forward to your `reply_to` email. `/admin/inbox` is a Gmail view
and has nothing to do with SMS.

So a conversation currently lives in three places, none of them together: their
message in your email, your reply on your phone, and a truncated copy of half of
it in a table with no screen.

**A2P is approved and delivery is proven** (2026-08-25, `delivered`, `error=none`
to a real handset), so nothing here is blocked on carriers.

---

## 2. What is true today

| | |
|---|---|
| Outbound | `sendRenderedSequenceSms` ([lib/lead-engine/sms.ts:147](../../../lib/lead-engine/sms.ts#L147)), one caller |
| Outbound record | `sequence_messages` — tied to a `sequence_run`, so it cannot hold a manual send |
| Inbound record | a `contact_timeline_events` row, **body capped at 500 chars** |
| Delivery status | `app/api/webhooks/twilio/status`, signature-verified against `appOrigin()` |
| Opt-out text | `renderSequenceSms` appends `"Reply STOP to opt out, HELP for help."` to **every** sequence text |
| Suppression | `contact_suppressions`, checked before consent, identifier-keyed |
| Quiet hours | `quietHoursDefer` in [guardrails.ts](../../../lib/lead-engine/guardrails.ts), business timezone |

**Send with `MessagingServiceSid`, never `From`.** The number's account-side
`messaging_service_sid` reads `null` even though it sits in the service's sender
pool; pool membership is what A2P keys on. A `From` send does not route through
the service and so does not reliably carry the campaign — it takes the filtered
path silently. `sms.ts:176` only uses the service when
`business_settings.sms_messaging_service_sid` is non-empty, and migration 00221
seeds that column `NOT NULL DEFAULT ''`. **Confirm it holds
`MGfcf240b6275f654f62874594a923d956` before this phase sends anything.**

---

## 3. Three decisions this phase forces

These are not implementation details. Each one is a rule about what your business
does, and the code has to encode one answer.

### 3.1 Does a manual reply respect quiet hours?

**Recommendation: warn, do not block.** Quiet hours exist for bulk marketing at
2am. A human replying inside a live conversation is a different act, and a system
that silently queues your reply until 8am while the person is waiting is worse
than one that lets you send it. The compose box shows *"It's 11:40pm for Jane —
send anyway?"* and requires a second click.

The sequence path keeps deferring exactly as it does now. Nothing about §3.1
touches `quietHoursDefer`.

### 3.2 Does a manual message carry the opt-out sentence?

**Recommendation: not on every message.** Appending "Reply STOP to opt out" to a
one-line reply in an ongoing conversation reads as automated and wastes a third
of the segment. Append it on the **first outbound message to a contact in a
rolling 30 days**, and never on subsequent replies in the same thread.

Sequence sends are unaffected — they keep appending every time.

> Flagged rather than assumed: this is a compliance-adjacent judgment. If your
> counsel wants the sentence on every message, that is one boolean in
> `renderManualSms` and no other change.

### 3.3 Can you text someone who has sent STOP?

**No, and this one is not a preference.** A suppressed number is blocked at the
send function, the compose box is disabled with the reason shown, and the API
route refuses with a distinct status. Three layers, because a guard on the
client path is not a guard — if the claim is "no surface can text a suppressed
number", the route is what has to enforce it, not the button.

---

## 4. What to build

### 4.1 Schema

```sql
-- 002xx_sms_messages.sql
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body          text NOT NULL,
  twilio_sid    text,
  status        text NOT NULL DEFAULT 'queued',
  error_code    text,
  sent_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sequence_message_id uuid REFERENCES public.sequence_messages(id) ON DELETE SET NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_twilio_sid_key
  ON public.sms_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_contact_idx
  ON public.sms_messages (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_phone_idx
  ON public.sms_messages (phone, occurred_at DESC);
```

RLS on, service-role policy only. Copy 00214's policy verbatim.

**`contact_id` is nullable and `phone` is not.** A text can arrive from a number
that matches nobody — the inbound webhook already handles that case for
suppressions. The thread is keyed on the phone number; the contact link is an
enrichment.

**`sequence_message_id` rather than duplicating the body.** A sequence send
writes both rows: `sequence_messages` stays the engine's record, `sms_messages`
is the conversation's. One is about a run, the other is about a person. Pointing
one at the other keeps them from disagreeing.

### 4.2 Backfill, and why it is partial

Existing inbound history lives in `contact_timeline_events` with **bodies capped
at 500 characters**. Backfill what is there, and mark it: `status = 'imported'`.
Do not pretend the truncated bodies are complete.

> A data migration can succeed and match nothing. Key the backfill on the
> timeline `kind`, verify the row count before and after, and read it back from
> the database rather than trusting the statement's own report.

### 4.3 Routes and DAL

| Route | Purpose |
|---|---|
| `/admin/messages` | Thread list — one row per phone, newest first, unread count |
| `/admin/messages/[phone]` | One conversation |
| `/api/admin/sms/send` | POST — send a manual message |

`lib/lead-engine/sms.ts` gains:

```ts
renderManualSms(args: { body, appendOptOut: boolean }): { text: string }
sendManualSms(args: { contactId?, phone, body, sentBy }): Promise<Result>
```

`sendManualSms` checks, in this order and failing on the first: suppression →
configuration (`assertSmsSendable`) → segment length. Not quiet hours — see §3.1.

`withAudit()` on the route. New slugs:

```ts
{ slug: "sms.sent_manual",  category: "marketing", description: "Admin sent a text to a contact" },
{ slug: "sms.send_refused", category: "marketing", description: "Manual text refused (suppressed or unconfigured)" },
```

### 4.4 The inbound webhook grows one write

It keeps everything it does — the keyword handling, the timeline rows, the
`reply_to` forward — and adds an `sms_messages` insert on the `sms_inbound` path.

**Do not remove the email forward in this phase.** Until you have used the new
screen for a fortnight, the email is the thing that actually reaches you. Remove
it as a separate, deliberate change.

**Keep answering empty TwiML.** Twilio parses the response as TwiML and rejects
anything else — a JSON body 12300s every STOP, which is how 27 green tests
missed a broken opt-out once already. The route still answers 200 when it is
wrong, so the assertion has to be on the body, not the status.

### 4.5 The screen

House `DataTable` chrome for the thread list. The conversation itself is not a
table — a simple alternating bubble list, newest at the bottom, with a compose
box pinned below it. Light-only, per the admin UI convention.

Delivery state renders per message: queued → sent → delivered, or failed with
the carrier's reason. The `status` webhook already receives these; wire it to
update `sms_messages.status` by `twilio_sid`.

### 4.6 The remaining sequence text steps

Mechanical, and it belongs here because it is the same subsystem:

- `new_lead_nurture`'s SMS step exists **only as a commented-out runbook** inside
  migration 00222. Apply it for real.
- The four quiz sequences still carry `PLACEHOLDER COPY`. The copy is yours to
  write; `placeholder-guard.ts` already fails the suite if one goes `active`
  still carrying the line, so this cannot ship half-done.

---

## 5. Traps

- **Two guards mask each other.** If both the compose box and the route block
  suppressed numbers, a test asserting "cannot text a suppressed contact" passes
  with either one removed. Test the route directly, with the UI out of the
  picture.
- **A send that did not throw is not a send.** `lib/email.ts` returns a success
  shape when `RESEND_API_KEY` is unset; do not repeat that shape here. A manual
  send with no `sms_messaging_service_sid` must fail loudly and visibly in the
  UI, not return `{ ok: true }`.
- **Twilio auto-replies are invisible to the API.** The account's outbound count
  will not include the Messaging Service's own HELP reply. Do not use the API's
  message count to conclude something was not sent — that has already produced a
  wrong verdict here once.
- **Segment counting.** A GSM-7 message is 160 characters; one emoji or curly
  apostrophe flips the whole message to UCS-2 at 70. Show the count and the
  segment total in the compose box, computed the same way Twilio computes it.
- **Text assertions must exclude prose.** Grepping the route file for `"STOP"`
  also matches the long comment block explaining STOP. Assert on behaviour.
- **Mutations are live against a running dev server.** If you mutation-test the
  suppression guard, the mutant genuinely sends. Point the harness at a number
  you own.

---

## 6. Tasks

1. Confirm `business_settings.sms_messaging_service_sid` on prod holds the
   `MG…` SID. **Nothing else in this phase matters if it is empty.**
2. Migration `002xx_sms_messages.sql` + RLS, applied to the dev clone, read back.
3. Backfill from the timeline, marked `imported`, count verified by read-back.
4. `lib/db/sms-messages.ts` — thread list, one thread, insert, status update.
5. `renderManualSms` + `sendManualSms` with the three-check order. Tests before
   implementation; mutate the suppression check specifically.
6. `/api/admin/sms/send` with `withAudit` and two new slugs.
7. Inbound webhook writes `sms_messages`. Retarget its existing suite; keep the
   empty-TwiML assertion.
8. Sequence sends write `sms_messages` too, linked by `sequence_message_id`.
9. `/admin/messages` list + thread + compose. Send action on the Phase 1 contact
   page links here.
10. Wire the status webhook to update `sms_messages.status`.
11. Apply the `new_lead_nurture` SMS step from 00222's runbook.
12. **Test inbound STOP and HELP against a real handset.** Never done. Delivery
    working does not prove opt-out works, and opt-out is the half with legal
    consequences.
13. Screenshot the thread view — a real conversation, both directions, a
    delivery state, and the suppressed-contact refusal.

---

## 7. Out of scope

- MMS.
- A shared team inbox with assignment and read receipts. One coach, for now.
- Merging SMS and email into one unified inbox. The proposal explicitly quotes
  that as the next phase, not this one.
- Removing the `reply_to` email forward — later, deliberately, once the screen
  has proven itself.
- Writing the quiz sequence copy. Mechanically unblocked here; the words are yours.
