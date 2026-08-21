# Lead Engine Stage 4 — Spine Wiring + GHL Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every remaining lead source writes one additive contact-spine event; the two waiting sequences become enrolable; the GHL export imports under the literal consent position; the email env-hole closes; every outward action stays a human-run script.

**Architecture:** Each route gains a `captureContactFromX`-style helper call built on `recordContactEvent` (`lib/db/contacts.ts:110`, returns `{contactId, created, merged}`, throws without an identifier — callers guard first, per `lib/funnels/capture-contact.ts:25`). The import is a standalone script over the export snapshot with a dedicated no-enrolment DAL entry. The email fix transplants Stage 2's `smsEnvPresent` pattern.

**Tech Stack:** Next.js route handlers, Supabase service-role, Vitest, plain Node ops scripts (argv env-file house pattern).

**Spec:** `docs/superpowers/specs/2026-08-22-lead-engine-stage4-spine-design.md` (parent: `2026-08-18-lead-engine-design.md` §5/§6/§11; Stage 2 spec for the checkbox/guard components)

## Global Constraints

- **A spine failure must never break the route's primary job.** Wrap every new `recordContactEvent` call in try/catch that logs and continues — except where the consent row needs the contactId, in which case the consent write (not the response) depends on it. Losing attribution is acceptable; losing the lead is not.
- **Additive only.** No existing behavior of any wired route changes: same emails sent, same rows written, same responses. Task reviews diff behavior, not just code.
- **Source strings are contracts** (enrolment matches on them): `contact_form`, `newsletter`, `lead_magnet`, `inquiry`, `event_signup`, `purchase`, `questionnaire`. Exactly these spellings.
- **No fabricated consent.** A consent row exists only where a consent-bearing act happened (newsletter subscribe; a checked SMS checkbox; documented GHL evidence). `wording_shown` NOT NULL always quotes the real act.
- **Imports never enrol.** The import path must be provably unable to reach `enrollIfTriggered`.
- **No brand literals** in new `lib/lead-engine/*` files (sweep test ROOTS).
- **Identifiers normalise** through `normaliseEmail`/`normalisePhone` (recordContactEvent does this internally — do not pre-normalise then double-handle).
- **tsc baseline: re-measure on the branch base before Task 1**; every task ends comm-identical.
- Commit per task on `feat/lead-engine-stage4-spine`; never push/merge; never write any real DB (the import runs only in dry-run against the snapshot files, plus fixture unit tests); never send anything.
- Ops scripts: argv env-file pattern, strict flag validation (unknown `-` args refuse — Stage 2's lesson), `main().catch` (no top-level await), `node --check` + prettier.

---

### Task 1: The email env-hole closes

**Files:**
- Modify: `lib/lead-engine/email.ts` (guard → throw; export `emailEnvPresent`), `lib/automation/sequence-tick-runner.ts` (email gate beside the sms gate)
- Test: `__tests__/lib/automation/sequence-tick-email-env.test.ts` (new; model on `sequence-tick-sms.test.ts` env cases), extend `__tests__/lib/lead-engine/email.test.ts`

**Interfaces:**
- Produces: `emailEnvPresent(): boolean` (RESEND_API_KEY non-blank, trimmed); the resend guard in `lib/lead-engine/email.ts:24-34` now THROWS naming the var instead of returning `{data:null,error:null}`; the runner's per-tick availability object gains email: when `!emailEnvPresent()`, email send steps advance with timeline kind `sequence_step_unsupported`, reason `email_env_missing`, NO recordSend, summary counter `skipped_email`.

- [ ] **Step 1:** Enumerate every caller of the throwing guard first: `grep -n "resend.emails.send\|sendRenderedSequenceEmail\|sendSequenceEmail" lib/ app/ -r`. The runner's alert step and the inbound webhook's ops alert CATCH locally already (verify; if any caller would newly crash on the throw, wrap it in that caller with a logged catch — list each in the report).
- [ ] **Step 2:** Failing tests: (a) tick with RESEND_API_KEY unset + due email step → advance, timeline reason `email_env_missing`, no message row, no provider call; (b) email.ts sender throws naming RESEND_API_KEY when unset (update the existing "skips silently" test to the new contract); (c) success path unchanged (markSent gets the real provider id).
- [ ] **Step 3:** Run → FAIL. **Step 4:** implement (mirror the sms gate structurally — same availability-object pattern, sitting beside it). **Step 5:** run new + `sequence-tick-sms.test.ts` + `sequence-tick.test.ts` (route) + `email.test.ts` → ALL PASS. **Step 6:** mutation: disable the gate, watch (a) fail on a recordSend call; restore, capture output. **Step 7:** tsc gate; commit `fix(lead-engine): a missing email key defers honestly instead of lying about sent`.

---

### Task 2: The spine helper + the three email-only routes (newsletter, shop leads, contact form)

Batched: three same-shape wirings sharing one helper.

**Files:**
- Create: `lib/lead-engine/capture.ts`
- Modify: `app/api/newsletter/route.ts`, `app/api/shop/leads/route.ts`, `app/api/contact/route.ts`
- Test: `__tests__/api/spine/newsletter-spine.test.ts`, `__tests__/api/spine/shop-leads-spine.test.ts`, `__tests__/api/spine/contact-spine.test.ts`

**Interfaces:**
- Produces: `captureLead(input: { source: string; email?: string | null; phone?: string | null; name?: string | null; attribution?: { gclid?: string | null; gbraid?: string | null; wbraid?: string | null; fbclid?: string | null } | null; metadata?: Record<string, unknown> }): Promise<string | null>` — guards no-identifier → null; calls `recordContactEvent` with the input mapped to its real signature (READ `RecordContactEventInput` in `lib/db/contacts.ts` first and mirror how `capture-contact.ts` maps fields, including attribution passthrough); try/catch → `console.error` + null. Later tasks consume exactly this.

Per route:
- **newsletter**: after the subscriber write succeeds, `captureLead({source:"newsletter", email})`; when contactId returns, `recordConsent({contactId, channel:"email", granted:true, source:"newsletter", wordingShown: NEWSLETTER_CONSENT_WORDING, ip, userAgent})` where `NEWSLETTER_CONSENT_WORDING` is a new exported constant in `lib/lead-engine/capture.ts` matching the subscribe form's actual visible label — READ the newsletter form component to quote it exactly; if the form shows no consent-bearing text beyond a "Subscribe" button, the constant states that act ("Subscribed via the newsletter form (Subscribe button)") — evidence describes reality, never invents wording.
- **shop leads**: after `upsertLead`, `captureLead({source:"lead_magnet", email, metadata:{product_id}})`. No consent row (the download delivery is transactional).
- **contact form**: after its user-row logic, `captureLead({source:"contact_form", email, name})`. No consent row.

- [ ] **Steps (TDD per route, one cycle each):** failing test asserting (a) the spine event fires with the exact source + identifiers; (b) `recordContactEvent` throwing does NOT change the route's response or its existing writes/emails (mock it to throw; assert the original behavior intact); (c) newsletter's consent row exists with the exact wording, and absent when the subscriber write failed. Implement; run each route's existing suite + the new one; commit per the batch: `feat(lead-engine): three email routes join the contact spine`.
- [ ] **Enrolment check** (this is what makes the batch matter): one test with an ACTIVE `newsletter_welcome`-shaped sequence in the mock asserting the newsletter wiring enrols via `recordContactEvent`'s own internals — do NOT mock `recordContactEvent` for this one; use the in-memory store pattern from `__tests__/lib/lead-engine/` suites.
- [ ] tsc gate; mutation: drop the `captureLead` call from the newsletter route → its spine test fails naming it; restore with output captured.

---

### Task 3: Inquiry route + both inquiry forms' checkboxes

**Files:**
- Modify: `app/api/inquiry/route.ts`, `components/public/InquiryForm.tsx`, `components/public/StepUpInquiryForm.tsx`
- Test: `__tests__/api/spine/inquiry-spine.test.ts` (+ extend the forms' existing suites if any; else component tests beside them)

Wiring: `captureLead({source:"inquiry", email, phone, name, attribution:{gclid: <the route's resolved gclid>, gbraid, wbraid, fbclid}})` — READ the route's existing attribution resolution (`:43-76`) and pass through what it already computes; do not re-derive. Checkbox: both forms gain the Stage 2 checkbox (READ `components/funnels/islands/FunnelForm.tsx`'s checkbox + `FormIsland.tsx`'s guard for the pattern; these are client components — the wording must arrive server-rendered: find each form's server parent and thread `smsConsentWording` down as a prop, using `getBusinessSettings` + `hasSmsConsentDisplayName` exactly as `FormIsland` does). Route: checked + phone + non-blank display name → `recordConsent({channel:"sms", granted:true, source:"inquiry", wordingShown: renderSmsConsentWording(displayName), ip, userAgent})` keyed to the captureLead contactId; the write is fire-and-forget after the primary flow.

- [ ] TDD: route tests (spine event with attribution; consent row only when checked+phone+name-present; throw-isolation as Task 2's (b)); component tests (unchecked default, hidden when no wording). Screenshots of BOTH forms on the real pages, light, annotated → `screenshots/lead-engine-stage4/`. Mutation: drop the server-side `hasSmsConsentDisplayName` guard → blank-name test fails. Commit `feat(lead-engine): the inquiry forms join the spine and ask before texting`.

---

### Task 4: Event signup + modal checkbox

**Files:**
- Modify: the event signup route (find via EventSignupModal's submit — expected `app/api/events/[id]/signup/route.ts`; if checkout-path signups exist too, wire where the signup ROW is created so both paths pass through), `components/public/EventSignupModal.tsx`
- Test: `__tests__/api/spine/event-signup-spine.test.ts`

Same shape as Task 3: `captureLead({source:"event_signup", email: parent_email, phone, name})`, checkbox with source `event_signup`. READ the route first — it already emails a receipt (00218 audit: opens-with-wait class); nothing about that changes.

- [ ] TDD + throw-isolation + screenshot (closest reachable state if the clone has no open event — never fabricate data) + mutation + commit `feat(lead-engine): an event signup is a contact too`.

---

### Task 5: Stripe checkout → spine, and the questionnaire ruling

**Files:**
- Modify: `app/api/stripe/webhook/route.ts` (the checkout.session.completed path)
- Test: `__tests__/api/spine/purchase-spine.test.ts`
- Investigate: `app/api/questionnaire/route.ts`

Stripe: ONE `captureLead({source:"purchase", email: session.customer_details.email ?? existing resolution, name})` at the single point every completed checkout passes (READ the route; place it BEFORE the metadata-type branches, beside the existing `applyPipelineEvent`-adjacent calls, with the same fire-and-forget isolation the route already uses for its side hooks — study how `tryEnqueueAdsValueAdjustment` is isolated and match it). NO consent row; NO sequence rides `purchase`. CAUTION: this webhook has many test suites — run ALL of `__tests__/api/stripe/webhook-*.test.ts` after; every one must stay green untouched.

Questionnaire: READ the route. If it requires `auth()` (an existing logged-in user, like assessments) → EXCLUDE, recording the reasoning in the task report and a one-line spec §4 note (the controller commits the spec edit). If it is genuinely public lead capture → wire it exactly like Task 2's shape with source `questionnaire`.

- [ ] TDD (a completed checkout with no metadata type → spine event; a merch/save_card/event checkout → STILL a spine event, deliberately — a paying human is a contact regardless of what they bought; document that in the test name) + throw-isolation + mutation + commit `feat(lead-engine): a paying customer is always a contact`.

---

### Task 6: `scripts/activate-sequence.mjs`

**Files:** Create `scripts/activate-sequence.mjs`.

House pattern + Stage 2's strict-argv lesson. `node scripts/activate-sequence.mjs <env-file> <sequence-key> [--pause] [--dry-run]`: default transition draft→active; `--pause` = active→paused; refuses unknown keys (reads the sequences table first and prints what exists), refuses any other current-status transition, refuses unknown flags/extra args, prints before/after. Header documents which keys are meaningfully activatable after this branch (newsletter_welcome, lead_magnet_delivery) and that enrolment starts at the NEXT matching event, not retroactively.

- [ ] `node --check`, `--dry-run` transcript against a NONEXISTENT env path for the refusal cases (no real reads), prettier, commit `feat(lead-engine): activating a sequence is a deliberate, narrow script`.

---

### Task 7: The import DAL — a path that cannot enrol

**Files:**
- Create: `lib/lead-engine/import.ts`
- Test: `__tests__/lib/lead-engine/import.test.ts`

**Interfaces:**
- Produces: `importGhlContact(record: GhlContactRecord, ctx: { snapshotTimestamp: string }): Promise<ImportOutcome>` where `GhlContactRecord` is typed from the REAL export shapes (id, email, phone, firstName, lastName, contactName, dnd: boolean, dndSettings: object, tags: string[], source, dateAdded, attributions, customFields — build the type by READING `ghl-export/2026-08-17T02-41-39/contacts.json` field docs in the task, main checkout path, read-only) and `ImportOutcome` is `{ kind: "created" | "enriched" | "suppressed_only" | "skipped_no_identifier"; contactId: string | null; emailConsentImported: boolean; smsRepermissionCandidate: boolean }`.
- Logic: identifier guard → `skipped_no_identifier`; upsert through the same match/merge internals `recordContactEvent` uses BUT via a dedicated function that never calls `enrollIfTriggered` — implement by exporting the needed internals from `lib/db/contacts.ts` (a `upsertContactIdentity` extraction that `recordContactEvent` itself then calls — refactor, do not duplicate; existing suites must stay green) ; `dnd === true` → suppress both identifiers (reason `ghl_dnd_import`); email consent row ONLY when a documented evidence rule matches (rule set lives as data in the file: GHL `dndSettings` email-channel absence is NOT evidence; a tag in an allowlist the task builds from `tags.json` reality IS — the task READS tags.json and reports which tags exist and which, if any, constitute consent evidence; empty allowlist = no consent imported, correct and stated); `wording_shown` = `JSON.stringify({ghl_field, value, snapshot: ctx.snapshotTimestamp})`; phone present → timeline `sms_repermission_candidate`; every outcome writes timeline `ghl_import` with the ghl id in metadata (plan-time check confirmed: no ghl id column exists on contacts — metadata only, no new column without a reader).

- [ ] TDD with fixtures copied from REAL records (scrubbed values, real shapes); the load-bearing tests: an import can NEVER create a sequence run (assert the runs store is untouched even with an ACTIVE matching-source sequence present — the mutation test for this is mandatory: route the import through `recordContactEvent` instead and watch it fail); dnd → suppression rows; no-evidence → zero consent rows; re-run idempotency (same record twice → enriched, not duplicated). Commit `feat(lead-engine): an imported contact arrives quietly — no runs, no invented consent`.

---

### Task 8: The import script + service-application check

**Files:**
- Create: `scripts/import-ghl-contacts.mjs`
- Test: transcript-verified (ops script), plus `node --check`/prettier

`node scripts/import-ghl-contacts.mjs <env-file> <snapshot-dir> [--execute]` — DRY-RUN IS THE DEFAULT; `--execute` is the only way to write, strict argv otherwise. Reads `contacts.json`, streams each through the Task 7 DAL (in dry-run: through a `dryRun` flag on the DAL calls? NO — simpler and safer: dry-run never loads the DAL; it parses, classifies with the same pure rule functions exported from `lib/lead-engine/import.ts` (extract the classification as pure functions so script-dry-run and DAL share them), and prints the outcome-class counts + first 5 examples per class). Resumable: `--execute` writes a progress file next to the snapshot (`import-progress.json`, ghl ids done) and skips those on re-run. Also greps `forms.json` + `form-submissions.json` (case-insensitive) for /service.?application/ and prints the finding loudly.

- [ ] Run dry-run for REAL against the actual snapshot with `.env.local` (READ-ONLY by construction — dry-run loads no DB client at all; verify by grepping the dry-run code path) and paste the class counts into the report. The controller will include those numbers in the final report to the human. Commit `feat(lead-engine): the GHL import rehearses by default and remembers where it stopped`.

---

### Task 9: The re-permission draft sequence + enrol script (00223)

**Files:**
- Create: `supabase/migrations/00223_lead_engine_repermission_sequence.sql`, `scripts/enrol-repermission.mjs`
- Test: extend `__tests__/lib/lead-engine/seed-sequences.test.ts` (parse 00223)

00223 seeds sequence `sms_repermission` (trigger_source NULL — manual only, status `draft`) with ONE email step (immediate — these are existing contacts receiving a single ask, not a nurture): subject `Can we text you?`, body (plain, no brand words, no punctuation after `{{name}}`, renderer appends nothing extra — this is email): asking to reply YES or tap a link to agree to texts; the body's consent-ask sentence must be compatible with `renderSmsConsentWording`'s clause (STOP/HELP mention). Position 1 `stop`. The seed test asserts: draft, NULL trigger, exactly email+stop, no brand literal, `{{name}}` punctuation rule. `scripts/enrol-repermission.mjs <env-file> [--execute]` (dry default): finds contacts with a `sms_repermission_candidate` timeline event, no sms consent, not suppressed, and enrols them into the sequence via the EXISTING manual-enrolment DAL if one exists — READ `lib/db/sequences.ts`/`enroll.ts` for an enrol function; if none is exported for manual use, add `enrolContactManually(contactId, sequenceKey)` to `lib/lead-engine/enroll.ts` with a unit test (active-sequence check, duplicate-run guard — reuse the existing enrolment internals).

- [ ] TDD on any new lib function; seed tests; dry-run transcript against a nonexistent env (refusal paths only); commit `feat(lead-engine): the re-permission ask ships loaded, safety on`.

---

### Task 10: Final gates

- [ ] One combined vitest run of every suite Tasks 1-9 name (list them explicitly in the report with the exact command + pasted totals — the pasted output IS the claim); tsc comm-diff vs the Task-0 baseline, both directions empty; prettier --check on created files; no-brand-literals sweep; `npm run build` grep'd for touched files; screenshots exist for the three changed forms. Commit any prettier fixes: `test(lead-engine): stage 4 gates`.

---

## Self-review (at authoring)

- Spec coverage: §3→T1; §4 table→T2 (newsletter/lead_magnet/contact_form), T3 (inquiry), T4 (event_signup), T5 (purchase + questionnaire ruling); §5→T3/T4; §6→T6; §7→T7/T8/T9 (import, evidence rules, no-enrolment, provenance, candidates, service-application check, re-permission); §8 holds by construction (dry-run defaults, drafts, human scripts); §9→T10 + per-task steps.
- Type consistency: `captureLead` produced in T2, consumed T3/T4/T5 with the same signature; `importGhlContact`/pure classifiers produced T7, consumed T8; `enrolContactManually` T9-local.
- Placeholders: none; where a value depends on reading reality (newsletter wording, tags allowlist, questionnaire auth), the task's step says exactly what to read and what each finding implies — those are investigation outcomes, not TBDs.
