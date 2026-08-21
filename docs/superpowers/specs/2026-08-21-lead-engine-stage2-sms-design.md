# Lead Engine Stage 2 — SMS, built ready and kept dark

Approved in-chat by Darren's operator 2026-08-21 ("yes lgtm"), with two scoping
decisions made explicitly: **seed SMS copy into the sequences now**, and
**include the consent checkbox on live phone-collecting forms**. Parent
authority: `docs/superpowers/specs/2026-08-18-lead-engine-design.md` (§3.1
Twilio, §6 consent, §7 sequence engine, §11 Stage 2). Where this document and
the parent disagree, the parent wins unless a line here explicitly says it
amends the parent.

**The premise:** A2P registration blocks *delivery*, not *construction*. Twilio
credentials in `.env.local` authenticate today (API key `TWILIO_MAIN_SID` +
`TWILIO_CLIENT_SECRET`; the account has 0 numbers, 0 messaging services, a
rejected TrustHub profile). Stage 2 builds the entire SMS path, proves it
against Twilio's test credentials and magic numbers, and leaves it dark behind
config that only a human fills on the day Twilio clears. **No code deploy is
needed on that day.**

## 1. Scope

1. `lib/lead-engine/sms.ts` — the settings-driven sender.
2. The tick runner's `sms` send path (replacing today's
   `no_sms_sender_wired` skip at `sequence-tick-runner.ts:172-194`).
3. Two Twilio webhooks: inbound (STOP/HELP/START + timeline) and status
   (delivery lifecycle onto `sequence_messages`).
4. Migration `00221`: business SMS config columns, sms step body CHECK,
   delivery statuses.
5. SMS consent capture on public phone-collecting forms (checkbox + wording,
   server-side consent row).
6. Seeded SMS steps: authored into the three DRAFT sequences; the ACTIVE
   sequence's step ships as documented copy, not a live row (§7 below).
7. The sandbox test lane against Twilio test credentials.

Non-goals: buying numbers, messaging-service setup, A2P submission (Darren's
chain, per parent §3.1); the GHL number import and re-permission email
(Stage 4); the chat assistant (Stage 3); any change to email behaviour.

## 2. Verified code facts this design stands on (re-verify at plan time)

- `sequence_steps.kind` already allows `'sms'`; the CHECK constraints guard
  email/wait/branch but **not** sms body presence (00216:45-60).
- `decideStep` already handles sms: no consent → advance with
  `no_sms_consent`; consent → `{kind:"send", channel:"sms"}`
  (`lib/automation/sequence-tick.ts:131-140`). Guardrails (quiet hours, daily
  cap, sibling defer) are channel-agnostic and already applied.
- The runner's sms case currently records a **skipped** `sequence_messages`
  row with reason `no_sms_sender_wired` (`sequence-tick-runner.ts:172-194`).
- `sequence_messages.channel` already allows `'sms'`; `status` CHECK is
  `queued|sent|failed|skipped` — **no delivery statuses exist**, and no email
  delivery webhook exists; delivery tracking is new ground owned by this stage.
- `contact_suppressions` is keyed by email **or phone** (parent §6) — the
  phone suppression path exists; STOP wires into it, not around it.
- `contact_consents` requires `wording_shown NOT NULL` — every consent write
  in this stage quotes its exact UI or message wording.

## 3. The sender — `lib/lead-engine/sms.ts`

Mirrors `lib/lead-engine/email.ts` in structure and rules:

- **Settings-driven identity, no brand literals.** The no-brand-literals sweep
  (`__tests__/lib/lead-engine/no-brand-literals.test.ts`) adds this file and
  the new webhook/consent files to its ROOTS.
- **Config on `business_settings`** (00221): `sms_messaging_service_sid text`
  and `sms_sender_phone text`, both `NOT NULL DEFAULT ''` matching the
  existing identity columns. Sending uses the messaging service when set,
  else the sender phone. `assertSmsSendable(settings)` throws
  `SmsNotConfiguredError` (carrying `missing`, mirroring
  `BusinessNotConfiguredError`) when neither is set.
- **Credentials from env**: requests authenticate with the API key
  (`TWILIO_MAIN_SID` + `TWILIO_CLIENT_SECRET`) against
  `TWILIO_ACCOUNT_SID`'s Messages endpoint. The account auth token is used
  **only** for webhook signature validation (§5), never for sends — parent
  §3.1's ruling.
- **Client**: the `twilio` npm SDK, added as a dependency (it also provides
  `validateRequest` for §5). If the plan's implementer finds the SDK
  unreasonable in this runtime, plain `fetch` against
  `2010-04-01/Accounts/{sid}/Messages.json` is the sanctioned fallback — the
  module's public surface must not change either way.
- **The opt-out sentence is a shared exported constant**,
  `SMS_OPT_OUT_SENTENCE` ("Reply STOP to opt out, HELP for help."), appended
  to every outbound marketing text; the STOP consent-revocation row and the
  seeded copy both reference the same constant so wording cannot drift —
  the `UNSUBSCRIBE_FOOTER_SENTENCE` pattern.
- `renderSequenceSms({ settings, body, contactName })` is pure:
  `{{name}}` substitution via the same fallback rules as email (empty string,
  never a guessed name), body + opt-out sentence. `body_rendered` on
  `sequence_messages` records exactly what was handed to the provider.
- Segment awareness: log a warning above 3 GSM segments; never block.

## 4. The tick runner's sms path

Replace the `no_sms_sender_wired` skip with a real executor, preserving every
existing invariant:

- **Preflight before claiming** (the `BusinessNotConfiguredError` pattern):
  `runSequenceTick` checks SMS configuration ONCE per tick. When unconfigured
  — production today — sms steps behave exactly as now: **advance with a
  skipped message row**, reason `sms_not_configured`. Runs never stall and
  never fail on a channel that cannot exist yet. (Amendment to parent §6's
  "unsupported kind" grouping: sms leaves that group the moment the business
  is configured.)
- When configured: render once, insert the `sequence_messages` row
  (idempotency `(run_id, step_id)` — the existing unique index), send the
  same rendered bytes, record `provider = 'twilio'`,
  `provider_message_id`, `status = 'sent'`. Provider failure → `failed` with
  the provider error, run continues per the existing failure rules.
- A send to a suppressed phone must be impossible by construction: the
  context `decideStep` consumes already carries `isSuppressed` (read in
  `lib/db/sequences.ts:123-126`; verify the reader still covers the phone
  channel at plan time) — the plan adds a mutation test proving the claim.

## 5. The Twilio webhooks

`app/api/webhooks/twilio/inbound/route.ts` and
`app/api/webhooks/twilio/status/route.ts`. Both validate
`X-Twilio-Signature` against `TWILIO_AUTH_TOKEN` and reject on mismatch or
absent env (fail closed; a 403 is success for an unconfigured install).
Both are registered in the middleware public-path list only if webhooks
require it (verify at plan time — the existing `ghl-booking` webhook is the
pattern to copy).

**Inbound:**

- STOP words (Twilio's canonical set: STOP, STOPALL, UNSUBSCRIBE, CANCEL,
  END, QUIT, case-insensitive): one motion writes (a) the phone suppression,
  (b) the consent revocation row quoting the inbound message as
  `wording_shown` evidence, (c) the timeline event, (d) exits active runs
  for the contact — mirroring `lib/lead-engine/unsubscribe.ts` exactly; reuse
  its helpers rather than re-implementing.
- START/UNSTOP/YES: lifts the suppression and writes a granted consent row
  quoting the inbound message. (Twilio itself also enforces its own
  carrier-level stop list; ours is the compliance record.)
- HELP: no DB write beyond the timeline event; Twilio's Messaging Service
  auto-responds to HELP/STOP at carrier level once configured — our reply is
  configured there, not coded here.
- Anything else: timeline event on the matched contact (matched by
  normalised phone), plus the ops-alert email to the operator when no
  contact matches or the message looks like a real question. No auto-reply.

**Status:** maps Twilio's callback statuses onto `sequence_messages.status`,
whose CHECK gains `'delivered'` and `'undelivered'` in 00221. **Status
updates are monotonic**: `delivered` is terminal and can never be
overwritten (callbacks arrive out of order); `undelivered`/`failed` never
overwrite `delivered`; unknown message SIDs are logged and dropped, never
500'd (Twilio retries on 5xx — a poison callback must not retry forever).

## 6. Consent capture on phone fields

- A shared template `SMS_CONSENT_WORDING` (marketing consent language
  naming the business via `business_settings.display_name` at render,
  message/data rates, STOP/HELP mention) rendered as an **unchecked**
  checkbox beside every public phone field. The consent row stores the
  **rendered** sentence as shown to that visitor — never the raw template —
  so `wording_shown` quotes what the person actually read. Unchecked =
  phone captured, NO sms consent row — absence of consent, per parent §6.
- The consent row is written **server-side in the capture path**
  (channel `sms`, granted, source = the form's source string, evidence = IP,
  user agent, and the exact wording constant) — the route, not the button,
  is the guard.
- The plan enumerates every public phone-collecting form by grepping routes
  and components, funnel forms first; each wired form is a separate task
  with its own screenshot.

## 7. Seeded SMS copy (00222, data migration)

The three DRAFT sequences gain their sms steps as real rows — safe because
`enrollIfTriggered` reads only ACTIVE sequences and none of the three can
enrol anyone yet:

- `newsletter_welcome`: one sms after the existing final email + a 1-day
  wait — a short welcome nudge.
- `lead_magnet_delivery`: one sms after the day-3 email — "did the download
  land" nudge.
- `cold_lead_re_engagement`: one sms as the final touch after the last
  email + wait.

Every seeded sms body ends with the opt-out sentence by construction (the
renderer appends it; the seed bodies do NOT duplicate it — one source).

**The ACTIVE sequence (`new_lead_nurture`) is not touched.** Positions are
contiguous and in-flight runs advance by `position + 1`, so inserting a row
would derail live runs. Its authored sms copy ships in the migration file as
a documented comment block, with the run-safe insertion procedure (pause →
verify no run mid-window → renumber → resume) written beside it, to execute
the day Twilio clears. This is a deliberate deviation from "text steps across
all eight sequences" and is the only part of Stage 2 that stays unfinished
on purpose.

## 8. The sandbox test lane

- **Unit tests mock the Twilio client** — house style, the way email tests
  mock `resend`.
- An **env-gated integration suite** (skips cleanly when
  `TWILIO_TEST_ACCOUNT_SID`/`TWILIO_TEST_AUTH_TOKEN` are absent, following
  the existing integration-lane pattern) sends real API requests with
  Twilio's **test credentials** and **magic numbers**: from `+15005550006`
  (valid), to numbers that simulate invalid (`+15005550001`),
  can't-route, and full-queue outcomes — asserting our request shape, error
  mapping, and status handling against Twilio's real responses with zero
  deliverable messages. Darren grabs the test pair from Console → Account →
  API keys & tokens → Test credentials; until then the suite skips and says
  why.
- Webhook tests replay captured Twilio callback payloads with real
  signatures computed from a test auth token.

## 9. Dark-state guarantees (all verifiable today)

| Lock | State today | Lifted by |
|---|---|---|
| `business_settings` sms columns empty | empty ('' defaults) | human runs the ops script after Twilio clears |
| No number / messaging service on the account | 0 of each | Darren's A2P chain (parent §3.1) |
| Zero contacts hold sms consent | true | checkbox ships (this stage) + Stage 4 re-permission |
| Active sequence has no sms step | true | run-safe insertion procedure (§7) |

Any one lock keeps SMS silent; all four hold today. The ops script
(`scripts/` argv-env pattern) that fills the sms columns is part of this
stage — written, tested against the clone, **never run against prod by a
session** (prod writes are the human's, per the standing permission line).

## 10. Testing and verification

Targeted suites plus `tsc --noEmit` comm-diffed against the re-measured main
baseline (251 as of 2026-08-21 — re-measure first). Mutation-revert cycles on
the claims that matter most: STOP writes suppression AND revocation AND exits
runs; delivered is never downgraded; a consent row always quotes wording; an
unconfigured business claims nothing and fails nothing; the idempotency index
holds under a duplicated tick. The no-brand-literals sweep extends to every
new file. Screenshots (real app, annotated, light mode) for every form that
gains the checkbox. Build on `feat/lead-engine-stage2-sms` in a worktree;
nothing merges, pushes, or touches prod without an explicit go-ahead.
