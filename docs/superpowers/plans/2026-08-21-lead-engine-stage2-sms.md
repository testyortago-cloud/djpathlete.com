# Lead Engine Stage 2 — SMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete SMS path — sender, tick executor, both Twilio webhooks, consent capture, seeded copy, ops scripts — proven against Twilio's test credentials, with four independent locks keeping it dark until A2P clears.

**Architecture:** `lib/lead-engine/sms.ts` mirrors `lib/lead-engine/email.ts` (settings-driven, pure renderer, provider wrapper); the tick runner's existing `no_sms_sender_wired` skip becomes a real executor that follows the email branch's exact invariant structure; two new webhook routes validate `X-Twilio-Signature` and write through existing consent/suppression/timeline helpers; delivery statuses extend `sequence_messages` monotonically.

**Tech Stack:** Next.js 16 route handlers, Supabase (service-role), Twilio REST API via `fetch` (no SDK dependency — the spec's sanctioned fallback, chosen deliberately: one form-encoded POST and a 15-line HMAC do not justify the package), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-lead-engine-stage2-sms-design.md` (parent: `docs/superpowers/specs/2026-08-18-lead-engine-design.md`)

## Global Constraints

- **No brand literals** in any new lib/webhook file: no `DJP Athlete`, no `Darren`, no `darrenjpaul.com` (regexes in `__tests__/lib/lead-engine/no-brand-literals.test.ts`). Identity renders from `BusinessSettings` only.
- **`wording_shown` is NOT NULL** — every consent row quotes the exact rendered wording the person saw (or the inbound message that constitutes the act).
- **A failed read is neither consent nor absence** — never wrap `hasConsent`/`isSuppressed` in a swallowing try/catch.
- **`business_id` defaults to `'00000000-0000-0000-0000-000000000001'`** on every new row; new identity-ish columns are `NOT NULL DEFAULT ''` matching 00212.
- **Delivered is terminal.** No write path may downgrade a `sequence_messages` row out of `delivered`.
- **Phones normalise through `normalisePhone`** (`lib/lead-engine/identity.ts:19`), emails through `normaliseEmail`. Suppression identifiers are stored lowercased by `suppress()` — pass the normalised form.
- **tsc baseline:** re-measure on `main` before Task 1 (251 as of 2026-08-21); every task ends at the same normalised error list (`comm`), not just the same count.
- Commit per task on `feat/lead-engine-stage2-sms`; never push, never merge, never write to any real database. Migrations run only against test fixtures/SQL-parsing tests in this plan.
- Test env: run vitest from the worktree root. Existing suites to keep green are named per task; do not run the full suite.

---

### Task 1: Migration 00221 — SMS config columns and delivery statuses

**Files:**
- Create: `supabase/migrations/00221_lead_engine_sms_config.sql`
- Modify: `lib/db/businesses.ts` (BusinessSettings type + row mapping)
- Test: `__tests__/lib/lead-engine/sms-schema.test.ts`

**Interfaces:**
- Produces: `business_settings.sms_messaging_service_sid`, `business_settings.sms_sender_phone` (both `text NOT NULL DEFAULT ''`); `sequence_messages.status` additionally allows `'delivered'` and `'undelivered'`; `sequence_steps` CHECK that an `sms` step has a body; `BusinessSettings` type gains `sms_messaging_service_sid: string` and `sms_sender_phone: string`.

- [ ] **Step 1: Write the failing schema test** (house pattern: parse the SQL file, assert its contents — see `__tests__/lib/lead-engine/pipeline-schema.test.ts` for the style)

```ts
// __tests__/lib/lead-engine/sms-schema.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const sql = readFileSync("supabase/migrations/00221_lead_engine_sms_config.sql", "utf8")

describe("00221 — sms config schema", () => {
  it("adds both business_settings columns NOT NULL DEFAULT ''", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS sms_messaging_service_sid\s+text\s+NOT NULL DEFAULT ''/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS sms_sender_phone\s+text\s+NOT NULL DEFAULT ''/)
  })
  it("extends sequence_messages.status with delivered/undelivered, keeping the old four", () => {
    const m = sql.match(/status IN \(([^)]+)\)/)
    expect(m).not.toBeNull()
    const statuses = m![1].split(",").map((s) => s.trim().replace(/'/g, ""))
    expect(statuses.sort()).toEqual(
      ["delivered", "failed", "queued", "sent", "skipped", "undelivered"].sort(),
    )
  })
  it("requires a body on sms steps", () => {
    expect(sql).toMatch(/kind <> 'sms' OR body IS NOT NULL/)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (file does not exist)

Run: `npx vitest run __tests__/lib/lead-engine/sms-schema.test.ts`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/00221_lead_engine_sms_config.sql
-- Lead Engine Stage 2: SMS sender configuration + delivery statuses.
-- Design: docs/superpowers/specs/2026-08-21-lead-engine-stage2-sms-design.md §3, §5.
--
-- Both columns default '' (not NULL) to match 00212's identity columns:
-- assertSmsSendable treats blank as unconfigured. Filling them is a human
-- act on the day Twilio clears — scripts/configure-lead-engine-sms.mjs.

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS sms_messaging_service_sid text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sms_sender_phone          text NOT NULL DEFAULT '';

-- An sms step without a body is unrunnable; 00216 guarded email but not sms.
ALTER TABLE public.sequence_steps
  DROP CONSTRAINT IF EXISTS sequence_steps_sms_body_check;
ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_sms_body_check
  CHECK (kind <> 'sms' OR body IS NOT NULL);

-- Twilio status callbacks report a delivery lifecycle email never had.
-- 'delivered' is TERMINAL: application code enforces that no later callback
-- (they arrive out of order) downgrades it. 'undelivered' is Twilio's
-- carrier-rejection outcome, distinct from 'failed' (we never handed it off).
ALTER TABLE public.sequence_messages
  DROP CONSTRAINT IF EXISTS sequence_messages_status_check;
ALTER TABLE public.sequence_messages
  ADD CONSTRAINT sequence_messages_status_check
  CHECK (status IN ('queued','sent','failed','skipped','delivered','undelivered'));
```

Note: 00216 declared the status CHECK inline, so its auto-generated name is
`sequence_messages_status_check`; verify with `grep -n "status" supabase/migrations/00216_lead_engine_sequences.sql`
that no explicit CONSTRAINT name differs, and adjust the DROP if it does.

- [ ] **Step 4: Update the type and mapping** in `lib/db/businesses.ts` — add to `BusinessSettings`:

```ts
  sms_messaging_service_sid: string
  sms_sender_phone: string
```

and add both fields to the row-cast/return in `getBusinessSettings` following how `postal_address` is mapped. Check for a test fixture factory for BusinessSettings (`grep -rn "sms_help_text" __tests__ | head`) and extend it so existing suites keep compiling.

- [ ] **Step 5: Run the new test + neighbors — expect PASS**

Run: `npx vitest run __tests__/lib/lead-engine/sms-schema.test.ts __tests__/lib/lead-engine/seed-sequences.test.ts __tests__/lib/lead-engine/email.test.ts`

- [ ] **Step 6: tsc gate** — `npx tsc --noEmit 2>&1 | grep -cE "error TS"` equals the baseline; if any new error names a file you touched, fix it.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(lead-engine): sms config columns and the delivery lifecycle"`

---

### Task 2: `lib/lead-engine/sms.ts` — renderer, preflight, sender

**Files:**
- Create: `lib/lead-engine/sms.ts`
- Modify: `__tests__/lib/lead-engine/no-brand-literals.test.ts` (ROOTS — `lib/lead-engine` is a directory root, so new files under it are swept automatically; VERIFY that, and add the webhook routes now so later tasks are pre-covered: `app/api/webhooks/twilio` as a root)
- Test: `__tests__/lib/lead-engine/sms.test.ts`

**Interfaces:**
- Consumes: `BusinessSettings` (with Task 1's fields), `normalisePhone` from `@/lib/lead-engine/identity`.
- Produces:
  - `SMS_OPT_OUT_SENTENCE = "Reply STOP to opt out, HELP for help."`
  - `class SmsNotConfiguredError extends Error { readonly missing: string[] }`
  - `smsConfigured(settings: BusinessSettings): boolean` — true when either sid or phone is non-blank
  - `assertSmsSendable(settings: BusinessSettings): void` — throws SmsNotConfiguredError listing `["sms_messaging_service_sid|sms_sender_phone"]` when neither set
  - `renderSequenceSms(args: { body: string; contactName: string | null }): { text: string }` — pure: `{{name}}` substitution (same empty-string fallback contract as email's `substituteName` — reimplement locally, do not export email internals), then `"\n\n" + SMS_OPT_OUT_SENTENCE` appended exactly once
  - `sendRenderedSequenceSms(args: { to: string; text: string; settings: BusinessSettings; statusCallbackUrl?: string }): Promise<{ providerMessageId: string | null }>` — POSTs `https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json`, Basic auth `TWILIO_MAIN_SID:TWILIO_CLIENT_SECRET`, form body `To`, `Body`, and `MessagingServiceSid` (when set) else `From` (sender phone), plus `StatusCallback` when given. Missing env (`TWILIO_ACCOUNT_SID`, `TWILIO_MAIN_SID`, `TWILIO_CLIENT_SECRET`) → console.warn + return `{ providerMessageId: null }` (the resend-guard pattern in `lib/lead-engine/email.ts:24-34`). Non-2xx → throw `Error` carrying Twilio's `code` and `message` from the JSON body.
  - Segment warning: if `text.length > 459` (3 GSM-7 segments at 153 chars each), `console.warn` with the length; never block.

- [ ] **Step 1: Write the failing tests** — cover: opt-out sentence appended exactly once; `{{name}}` fills and falls back to empty (no double space artifacts — assert exact string); `smsConfigured` truth table over blank/sid/phone; `assertSmsSendable` throws with `missing` populated; `sendRenderedSequenceSms` posts the exact form fields (mock `global.fetch`, capture the Request: assert URL, Authorization header base64 of `sid:secret`, `MessagingServiceSid` present when configured and `From` when only phone); provider 400 (mock `{ code: 21211, message: "Invalid 'To'..." }`) throws an Error whose message contains both; missing env returns null id without calling fetch. Mock the real contract — build the fetch mock from Twilio's documented response shape (`{ sid: "SM..." , status: "queued" }`), not from the implementation.

- [ ] **Step 2: Run — expect FAIL** (module not found): `npx vitest run __tests__/lib/lead-engine/sms.test.ts`

- [ ] **Step 3: Implement `lib/lead-engine/sms.ts`.** Head comment mirrors `email.ts`'s: settings-driven, brand-literal-free, why fetch instead of the SDK (spec §3's sanctioned fallback: one form POST + HMAC does not justify a dependency). Structure the send exactly like the interface above; nothing else exported.

- [ ] **Step 4: Run — expect PASS**, plus the sweep: `npx vitest run __tests__/lib/lead-engine/sms.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts`

- [ ] **Step 5: tsc gate, then commit** — `git commit -m "feat(lead-engine): the sms sender — settings-driven, provider-agnostic bytes"`

---

### Task 3: The tick runner's sms executor

**Files:**
- Modify: `lib/automation/sequence-tick-runner.ts:172-199` (the `channel === "sms"` branch) and its imports; the tick's per-run loop where `settings` is loaded (compute `smsConfigured(settings)` once per tick, pass into `processRun`)
- Test: `__tests__/lib/automation/sequence-tick-sms.test.ts` (new; model the mock harness on the existing `__tests__/api/admin/internal/sequence-tick.test.ts`)

**Interfaces:**
- Consumes: Task 2's `smsConfigured`, `renderSequenceSms`, `sendRenderedSequenceSms`; existing `recordSend` / `markSent` / `markFailed` (`lib/db/sequences.ts:194,249,263`), `writeTimelineEvent`, `advanceRun`, `failRun`, `deferRun`.
- Produces: runner behavior later tasks and ops rely on —
  - **Unconfigured** (production today): insert a `sequence_messages` row via `recordSend` then immediately mark it `skipped`… **NO.** `recordSend` claims `(run_id, step_id)` permanently, which would block the real send after Twilio clears. Instead: keep today's behavior — timeline event + advance — but change `reason` to `"sms_not_configured"` and add `summary.skipped_sms = (summary.skipped_sms ?? 0) + 1`. The spec's "skipped message row" is satisfied by the timeline event; a claimed message row would be a live-day bug. **This is a deliberate, documented amendment to spec §4** — record it in the task's commit message and in the spec file itself (append one sentence to §4: "Amended at plan time: the unconfigured path writes the timeline event only — a sequence_messages row would permanently claim (run_id, step_id) and block the real send later.").
  - **Configured**: mirror the email branch exactly — recipient guard (`ctx.contact.phone_e164` null → `failRun` loud, same comment rationale as email's unreachable guard); render once via `renderSequenceSms`; `recordSend({ channel: "sms", toIdentifier: phone, subject: null, bodyRendered: rendered.text, ... })`; `!claimed` → `deferRun(..., "send_in_progress")`; try covers ONLY `sendRenderedSequenceSms` (statusCallbackUrl = `${appOrigin()}/api/webhooks/twilio/status`); catch → `markFailed` + `failRun`; success → `markSent(messageId, "twilio", providerMessageId)` + `advanceRun` + `summary.sent += 1`.

- [ ] **Step 1: Write the failing tests.** Cases: (a) consented contact + configured business → provider called with rendered text ending in the opt-out sentence, message row sent with provider twilio; (b) consented + unconfigured → advance, timeline `sequence_step_unsupported` with reason `sms_not_configured`, provider NOT called, no message row; (c) provider throws → row failed, run failed, and a **second** tick does not re-send (idempotency: recordSend refuses the failed row); (d) contact with no phone + consent → run fails loud; (e) suppressed phone → decideStep exits before the runner sends (mutation-proof: flip `isSuppressed` in ctx and watch the exit reason). Follow the existing suite's in-memory Supabase mock; remember the shared mock supports only one `.order()` per query.

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run __tests__/lib/automation/sequence-tick-sms.test.ts`

- [ ] **Step 3: Implement** the branch replacement. Keep the email branch untouched; the sms branch reads as its sibling, comment-for-comment where the rationale is shared (point to the email branch rather than duplicating prose).

- [ ] **Step 4: Run new + existing tick suites — expect ALL PASS**: `npx vitest run __tests__/lib/automation/sequence-tick-sms.test.ts __tests__/api/admin/internal/sequence-tick.test.ts __tests__/lib/lead-engine/email.test.ts`

- [ ] **Step 5: Mutation check** — comment out the `markSent` call, assert test (a) fails on message status; restore. Comment out the unconfigured guard, assert (b) fails. Capture both failures in the task report.

- [ ] **Step 6: tsc gate, spec §4 amendment sentence, commit** — `git commit -m "feat(lead-engine): sms steps send for real when the business is configured"`

---

### Task 4: Signature validation + the status webhook

**Files:**
- Create: `lib/lead-engine/twilio-signature.ts`, `app/api/webhooks/twilio/status/route.ts`
- Modify: `lib/db/sequences.ts` (add `applyDeliveryStatus`)
- Test: `__tests__/lib/lead-engine/twilio-signature.test.ts`, `__tests__/api/webhooks/twilio-status.test.ts`

**Interfaces:**
- Produces:
  - `validateTwilioSignature(args: { url: string; params: Record<string, string>; signature: string; authToken: string }): boolean` — Twilio's scheme: HMAC-SHA1 (node:crypto) over `url + sortedKeys.map(k => k + params[k]).join("")`, base64, timing-safe compare (`crypto.timingSafeEqual` on equal-length buffers, false otherwise).
  - `applyDeliveryStatus(providerMessageId: string, twilioStatus: string): Promise<"updated" | "ignored" | "unknown_message">` in `lib/db/sequences.ts`. Mapping: `delivered→delivered`, `undelivered→undelivered`, `failed→failed`, `sent|queued|accepted→ignored` (we already recorded `sent` at send time). **Monotonic**: read the row by `provider_message_id` + `provider = 'twilio'`; if current status is `delivered`, always `ignored`; `undelivered`/`failed` never overwrite `delivered`; `delivered` overwrites `sent`/`failed`/`undelivered` (late delivery beats an earlier pessimistic callback). Unknown sid → `"unknown_message"`.
  - Route: POST, form-encoded. Absent `TWILIO_AUTH_TOKEN` env or bad signature → 403. Valid → `applyDeliveryStatus(MessageSid, MessageStatus)`, always 200 with the outcome (Twilio retries 5xx forever — a poison callback must never 500). The public URL for signature computation: `${appOrigin()}${pathname}` — reuse the runner's `appOrigin()` helper (extract it to `lib/lead-engine/origin.ts` if it is not already importable; keep the localhost-refusal behavior).

- [ ] **Step 1: Failing tests.** Signature: golden vector — compute expected base64 by hand in the test from a fixed token/url/params (document the derivation in a comment), assert true; flip one param byte → false; unequal length → false, no throw. Status: build a signed request helper in the test; delivered updates a sent row; a later `failed` callback returns ignored and leaves delivered; `failed` after `sent` updates; unknown sid → 200 `unknown_message`; bad signature → 403 and the DB untouched; missing env → 403.

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run __tests__/lib/lead-engine/twilio-signature.test.ts __tests__/api/webhooks/twilio-status.test.ts`

- [ ] **Step 3: Implement** all three files. `applyDeliveryStatus` does the read-then-write in two statements with the monotonic rules in code, not SQL (the in-memory test mock does not run SQL); a comment notes the benign race (two concurrent callbacks both read pre-delivered — worst case one extra idempotent write, never a downgrade, because the guard re-checks in the update's `.neq("status", "delivered")` filter — include that filter).

- [ ] **Step 4: Run — expect PASS.** Also `npx vitest run __tests__/lib/lead-engine/no-brand-literals.test.ts` (the new ROOTS cover these files).

- [ ] **Step 5: Mutation check** — remove the `.neq("status", "delivered")` filter and the in-code guard; the monotonic test must fail. Restore. tsc gate. Commit: `git commit -m "feat(lead-engine): delivery truth arrives by webhook, and delivered is terminal"`

---

### Task 5: The inbound webhook — STOP, START, HELP, and everything else

**Files:**
- Create: `app/api/webhooks/twilio/inbound/route.ts`
- Modify: `lib/db/contact-consents.ts` (add `unsuppress`)
- Test: `__tests__/api/webhooks/twilio-inbound.test.ts`

**Interfaces:**
- Consumes: `validateTwilioSignature` (Task 4), `normalisePhone`, `findContactByIdentifiers` (`lib/db/contacts.ts` — verify exact signature before use), `recordConsent`, `suppress`, `exitRunsForContact` (`lib/db/sequences.ts:409`), `writeTimelineEvent`, `getBusinessSettings`, `sendRenderedSequenceEmail` with `includeUnsubscribeFooter: false` for the ops alert (the alert-step pattern at `sequence-tick-runner.ts:301-313`).
- Produces: `unsuppress(identifier: string, businessId?: string): Promise<void>` — deletes the suppression row for the lowercased identifier; absent row is success.

Behavior (all writes only after signature passes):
- Normalise `From` via `normalisePhone`; match a contact by phone.
- **STOP set** (`STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` — trimmed, case-insensitive, exact word): `suppress(phone, "sms_stop")` + (if contact matched) `recordConsent({ granted: false, source: "sms_inbound", wordingShown: <the raw inbound Body> })` + `exitRunsForContact(contactId, "sms_stop")` + timeline `sms_stop_received`. No contact matched → suppress + timeline-less 200 (suppression is identifier-keyed and works without a contact).
- **START set** (`START, UNSTOP, YES`): `unsuppress(phone)` + (if matched) `recordConsent({ granted: true, source: "sms_inbound", wordingShown: <raw Body> })` + timeline `sms_start_received`.
- **HELP**: timeline `sms_help_received` only (the carrier-level auto-reply is Messaging Service config, not code — spec §5).
- **Anything else**: timeline `sms_inbound` with the body in metadata (scrubbed by length, 500 chars max), plus the ops-alert email to `settings.reply_to` when a contact matched (subject "New SMS reply", body = from + text) — rendered through `renderSequenceEmail` with `includeUnsubscribeFooter: false`. No auto-reply to the sender, ever.
- Always 200 after a valid signature (Twilio retry semantics), 403 otherwise.

- [ ] **Step 1: Failing tests** — one per behavior above, plus: STOP writes BOTH the suppression and the revocation and exits runs (assert all three stores); "Stop" lowercase and `" STOP "` padded match; `"STOP IT"` (extra words) does NOT match the STOP set (Twilio treats bare keywords; a sentence goes to "anything else"); bad signature → 403, zero writes.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** route + `unsuppress`.
- [ ] **Step 4: Run — expect PASS**: `npx vitest run __tests__/api/webhooks/twilio-inbound.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts`
- [ ] **Step 5: Mutation check** — drop the `exitRunsForContact` call: the STOP test must fail naming it. Drop signature validation: the 403 test must fail. Restore both, capture output. tsc gate. Commit: `git commit -m "feat(lead-engine): STOP is one motion — suppression, revocation, exit, timeline"`

---

### Task 6: SMS consent capture on funnel forms

**Files:**
- Modify: the funnel form renderer (find it: `grep -rn "\"tel\"" lib/funnels app components | grep -v test` — the component that renders published funnel form fields) and `app/api/funnels/submit/route.ts` (the `phone` path at :106-140)
- Create: `lib/lead-engine/sms-consent-wording.ts`
- Test: `__tests__/api/funnels/submit-sms-consent.test.ts` (+ extend the funnel form component's existing suite if one exists)

**Interfaces:**
- Produces: `renderSmsConsentWording(displayName: string): string` returning exactly:
  `"I agree to receive text messages from {displayName} about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help."` — composed with `SMS_OPT_OUT_SENTENCE`'s vocabulary but a standalone sentence; the STOP/HELP clause must match the runtime behavior Tasks 2/5 implement.

Behavior:
- The form renderer shows an **unchecked** checkbox with the rendered wording under every `tel` field, posting `sms_consent: boolean`.
- The submit route, when `phone` is present AND `sms_consent === true`: after the existing `capture-contact` write, `recordConsent({ contactId, channel: "sms", granted: true, source: "funnel_form", wordingShown: renderSmsConsentWording(settings.display_name), ip, userAgent })`. The server re-renders the wording from the same inputs the page used — evidence is what was shown, and both sides render from one function. Checkbox absent/false → phone captured, NO consent row.
- **Published-funnel caveat** ([[published-funnel-css-is-frozen]]): determine whether published funnel pages render the form from live code or from a frozen publish artifact. If frozen, the checkbox reaches existing live funnels only on re-publish — write the finding into the task report and add the re-publish step to the go-live runbook (Task 8's comment block). Do NOT re-publish anything yourself.

- [ ] **Step 1: Failing test** — submit with `sms_consent: true` + phone writes the consent row quoting the exact rendered wording; without the flag writes none; consent write failure does NOT fail the lead capture (the lead matters more — wrap in the same fire-and-forget pattern the route uses for GHL sync; verify what that pattern is before assuming).
- [ ] **Step 2: Run — expect FAIL.** Step 3: implement. Step 4: run + PASS (`npx vitest run __tests__/api/funnels/submit-sms-consent.test.ts` + the funnel submit route's existing suite).
- [ ] **Step 5: Screenshot** the real funnel form with the checkbox — real app, real route, light mode, annotated, into `screenshots/lead-engine-sms/funnel-consent.png` (drive the dev server against the clone DB; if the only reachable funnel page cannot render without prod data, screenshot the closest reachable state and say so in the report).
- [ ] **Step 6: tsc gate, commit** — `git commit -m "feat(lead-engine): the funnel phone field asks before it texts"`

---

### Task 7: The remaining public phone forms

**Files:**
- Modify: `components/public/InquiryForm.tsx`, `components/public/StepUpInquiryForm.tsx`, `components/public/EventSignupModal.tsx`, and each form's API route (find each route by following the component's submit handler)
- Test: extend each route's existing suite (find with `grep -rln "InquiryForm\|StepUpInquiry\|event.*signup" __tests__/api` — create `-sms-consent` variants beside them following Task 6's shape)

**Interfaces:** Consumes Task 6's `renderSmsConsentWording` and the same server-side `recordConsent` pattern. Produces nothing new.

- [ ] **Step 1: Enumerate** — `grep -rln "type=\"tel\"\|'tel'" components app lib | grep -v test | grep -v node_modules`, subtract `components/public/shop/AddressForm.tsx` (shipping address for physical orders — not marketing capture; a consent checkbox there would be false context. Record the exclusion and reason in the task report). Any OTHER hit not named in this task is new information: stop and add it to the task before wiring.
- [ ] **Step 2-5: per form**, smallest first: failing route test (consent row written when checked, absent when not, exact wording), implement checkbox + server write (the route resolves/creates the contact — these routes may not call `capture-contact` today; if a form's route never touches the contact spine, the consent row has no `contact_id` to reference — in that case wire `recordContactEvent` for that route ONLY if it is one of the parent spec's named Stage 4 sources is NOT this task's call: instead capture consent keyed by the created/found contact where one exists, and where none exists, record the finding in the report and leave that form checkbox-less — a checkbox that stores nothing is worse than none).
- [ ] **Step 6: Screenshots** of each wired form (same rules as Task 6) into `screenshots/lead-engine-sms/`.
- [ ] **Step 7: tsc gate, commit** — `git commit -m "feat(lead-engine): every marketing phone field now asks"`

---

### Task 8: Migration 00222 — seeded SMS copy for the three draft sequences

**Files:**
- Create: `supabase/migrations/00222_lead_engine_seed_sms_steps.sql`
- Test: extend `__tests__/lib/lead-engine/seed-sequences.test.ts` (it parses 00218; point the new cases at 00222)

The three DRAFT sequences have zero runs (enrolment reads ACTIVE only), so
position rewrites are safe there and ONLY there. Shape per sequence — insert
before the final `stop`, shifting the stop:

- `newsletter_welcome` (steps 0,1-wait,2,3-stop): stop moves 3→5; insert `3: wait 1440`, `4: sms` — body:
  `"{{name}}, thanks for joining the newsletter — expect one useful training idea a week, no filler. Save this number so you know it's us."`
- `lead_magnet_delivery` (read its positions from 00218 before writing SQL): insert after the day-3 email, same shift pattern — body:
  `"Hi {{name}} — did the download land? If anything in it raises a question, text back and a real person answers."`
- `cold_lead_re_engagement` (steps 0,1-wait,2,3-stop): stop 3→5; `3: wait 4320`, `4: sms` — body:
  `"{{name}}, no pressure — if getting back to training is still on your mind, reply here and we'll find a time to talk."`

Rules the SQL must obey: single UPDATE per stop row (`SET position = position + 2`) BEFORE the inserts (unique `(sequence_id, position)` — verify that index exists in 00216 and order statements to never collide); every body plain text, NO opt-out sentence (the renderer appends it — one source, spec §7); `ON CONFLICT DO NOTHING` idempotency matching 00218's style.

**The `new_lead_nurture` block** — at the end of the file, inside a SQL comment: the authored sms body
(`"{{name}} — quick text to say the email with next steps is in your inbox. If texting is easier, reply here any time."`),
plus the run-safe insertion runbook: set sequence `paused`; wait until `SELECT count(*) FROM sequence_runs WHERE sequence_id = ... AND status = 'active'` is zero or every active run's `current_position` ≤ 1; apply the same shift+insert; set `active`. Note the re-publish caveat from Task 6 if it applies.

- [ ] **Step 1: Failing seed tests** — parse 00222: each draft sequence gains exactly one sms row and its stop lands two higher; no sms body contains the words "STOP" or the business name; the new_lead_nurture section is comment-only (regex: no INSERT touching `new_lead_nurture` outside `--` lines).
- [ ] **Step 2: FAIL → Step 3: write the SQL → Step 4: PASS**: `npx vitest run __tests__/lib/lead-engine/seed-sequences.test.ts __tests__/lib/lead-engine/sms-schema.test.ts`
- [ ] **Step 5: tsc gate (unchanged — SQL only), commit** — `git commit -m "feat(lead-engine): sms copy seeded where no run can trip over it"`

---

### Task 9: Ops scripts — configure, inspect, and the go-live runbook

**Files:**
- Create: `scripts/configure-lead-engine-sms.mjs`
- Modify: `scripts/inspect-lead-engine.mjs` (add sms columns to the business_settings select + print Twilio account state: numbers count, messaging services count via the API when creds present)

House pattern (`scripts/flip-lead-engine-on.mjs`): argv env-file path, only fills EMPTY fields, prints before/after, never run by a session against prod — the header comment says so. `configure-lead-engine-sms.mjs` takes `node scripts/configure-lead-engine-sms.mjs .env.prod <messaging_service_sid|phone>` and writes the one field the argument's shape indicates (`MG…` → sid; `+…` → phone via `normalisePhone`-equivalent validation inline — scripts cannot import TS).

- [ ] **Step 1: Write both** (no unit tests — ops scripts are verified by running against a scratch value: run configure against a COPY of `.env.local`'s project? NO — never write any real DB in this plan. Verify by `node --check` syntax pass and a `--dry-run` flag that prints the would-be write; implement `--dry-run`, run it against `.env.local`, capture output in the report).
- [ ] **Step 2: tsc gate (scripts are .mjs — wrap nothing in main()? follow the fixed pattern: no top-level await outside async main), prettier check both files, commit** — `git commit -m "feat(lead-engine): the day Twilio clears is a script run, not a deploy"`

---

### Task 10: The sandbox lane + final verification

**Files:**
- Create: `__tests__/integration/twilio-sandbox.test.ts`
- Modify: nothing else

- [ ] **Step 1: The env-gated suite** — `describe.skipIf(!process.env.TWILIO_TEST_ACCOUNT_SID || !process.env.TWILIO_TEST_AUTH_TOKEN)`; when present: real POST to the test account's Messages endpoint (test creds use Basic `TEST_SID:TEST_TOKEN` directly — document that test credentials do NOT accept API-key auth, hence the separate pair) from magic `+15005550006`: (a) to `+15005550010`-style valid → 201, `sid` returned, our error mapping stays silent; (b) to `+15005550001` → Twilio error 21211 and our thrown Error carries code+message; (c) `From` a non-magic number → 21212. Assert against Twilio's REAL responses — this suite is the mock-the-real-contract check for Task 2's mocks. When env absent: a single test asserts the skip reason prints the console path to the credentials.
- [ ] **Step 2: Run it now** (env absent → clean skip) and record: whoever holds the Twilio console grabs Console → Account → API keys & tokens → Test credentials into `.env.local` as `TWILIO_TEST_ACCOUNT_SID` / `TWILIO_TEST_AUTH_TOKEN`, then `npx vitest run __tests__/integration/twilio-sandbox.test.ts`.
- [ ] **Step 3: Final gates, in order:** (1) all suites named in Tasks 1–8 in one run; (2) `npx tsc --noEmit` comm-diff vs the baseline captured before Task 1 — identical lists both directions; (3) `npx prettier --check` on every file this branch created (fix new files only); (4) the no-brand-literals sweep; (5) `npm run build` grep'd for files this branch touched.
- [ ] **Step 4: Commit** any final fixes — `git commit -m "test(lead-engine): the sandbox lane proves the wire format"`

---

## Self-review (done at authoring)

- **Spec coverage:** §3 sender → Task 2; §4 runner → Task 3 (with one documented amendment — the unconfigured path's message row would poison idempotency; the spec file gets the amendment sentence); §5 webhooks → Tasks 4, 5; §6 consent UI → Tasks 6, 7; §7 seeds → Task 8; §8 sandbox → Task 10; §9 dark-state table → Tasks 1, 9 (config columns + script); 00221/00222 → Tasks 1, 8. Gap check: parent §11 Stage 2 "STOP/HELP mirrored into contact_suppressions" → Task 5; "consent capture on every phone field" → Tasks 6, 7 with the AddressForm exclusion reasoned.
- **Types:** `smsConfigured`/`assertSmsSendable`/`renderSequenceSms`/`sendRenderedSequenceSms` names used identically in Tasks 2, 3, 9, 10; `applyDeliveryStatus` in Task 4 only; `unsuppress` in Task 5 only; `renderSmsConsentWording` in Tasks 6, 7.
- **Placeholders:** none — every step carries code, exact copy, or an exact command.
