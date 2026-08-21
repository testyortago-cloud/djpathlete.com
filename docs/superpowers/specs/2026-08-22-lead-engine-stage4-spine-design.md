# Lead Engine Stage 4 — every lead joins the spine, and GHL's history comes home

Approved in-chat 2026-08-22 ("lgtm"), with one scoping answer recorded: the
"service application" entry point stays unresolved by the human — this stage
checks the GHL export's `forms.json` for anything so named and otherwise
parks it for switch-over. Parent authority:
`docs/superpowers/specs/2026-08-18-lead-engine-design.md` (§5 contacts, §6
consent, §11 Stage 4). The Stage 2 spec's §6 amendment (consent checkboxes
follow the contact spine) is closed by this stage.

**The premise:** today exactly one route feeds the contact spine (funnel
submit). Every other lead source writes its own silo. Stage 4 gives each
remaining entry point ONE additive write — upsert a contact via
`recordContactEvent` — without changing what any route already does, and
imports the GHL account's contacts under the §6 consent position before that
account is cancelled.

## 1. Scope

1. The email env-hole fix (Stage 2's parked finding — first task).
2. Entry-point wiring: contact form, newsletter, shop leads (lead magnet),
   inquiry (both forms), event signup, shop checkout, questionnaire.
3. SMS consent checkboxes on the newly-wired phone forms (InquiryForm,
   StepUpInquiryForm, EventSignupModal) — closing the Stage 2 deferral.
4. `scripts/activate-sequence.mjs` — the human flip for draft sequences.
5. The GHL import from the export snapshots, plus the ready-to-send
   (never auto-sent) re-permission email flow.

Non-goals: switch-over and disabling any GHL workflow; Stage 3; SMS
go-live; the Athlete Quiz; any change to sequence copy; sending anything
outward (the re-permission flow ships armed, dark).

## 2. Verified facts this design stands on (re-verify at plan time)

- `recordContactEvent` (lib/db/contacts.ts) is the single spine funnel;
  `enrollIfTriggered` is reached ONLY from inside it and reads ACTIVE
  sequences matching the event's `source`.
- Route survey (2026-08-22): `/api/contact` creates a `users` row + two
  emails (auto-reply → its sequence, if ever built, opens with wait);
  `/api/newsletter` writes `newsletter_subscribers` + GHL tag sync, no email
  to the subscriber; `/api/shop/leads` upserts a shop lead + sends the
  download email; `/api/inquiry` creates/backfills a `users` row, captures
  gclid, sends notify + auto-reply; event signup writes `event_signups` +
  receipt email; shop checkout is Stripe-webhook-completed; questionnaire
  route exists at `app/api/questionnaire/route.ts` (behavior verified at
  plan time).
- The GHL export snapshots (`ghl-export/<ts>/`, latest 2026-08-17T02-41-39)
  hold `contacts.json`, `tags.json`, `conversations.json` +
  `conversation-messages.json`, `form-submissions.json`, `forms.json`,
  `opportunities.json`, `custom-fields.json`, with a MANIFEST and loud
  truncation warnings already handled by the exporter.
- Stage 2 shipped: `renderSmsConsentWording`/`hasSmsConsentDisplayName`
  (shared checkbox guard), `smsEnvPresent()` + throwing sender (the pattern
  the email fix copies), suppression/consent DAL, and the seeded sequences
  waiting on `newsletter` / `lead_magnet` sources.

## 3. First task — the email env-hole

`lib/lead-engine/email.ts:24-34`'s resend guard silently returns
`{data:null, error:null}` on missing `RESEND_API_KEY`, so the runner records
sent-but-never-sent and burns the `(run_id, step_id)` claim (confirmed by
Stage 2's final review; dormant while prod has the key). Fix, copying the
sms pattern verbatim:

- `emailEnvPresent(): boolean` exported from `lib/lead-engine/email.ts`
  (RESEND_API_KEY non-blank).
- The tick gate: email sends require `emailEnvPresent()`; absent → the
  step advances with timeline reason `email_env_missing`, NO message row,
  NO claim — mirroring `sms_env_missing` exactly, per-tick, computed once.
- The resend guard THROWS naming the missing var (backstop, unreachable
  from the runner once gated); the alert-step path and every other caller
  of the email senders is enumerated and its behavior on the new throw
  decided in the plan (an ops alert that throws must not kill the tick).
- Tests mirror `sequence-tick-sms.test.ts`'s env cases.

## 4. Entry-point wiring

One additive write per route. The write is fire-and-forget relative to the
route's primary job on QUERY failures but runs BEFORE the response where
the contact id is needed for consent; losing attribution is acceptable,
losing the lead is not; a spine failure must never 500 a working form.

| Route | source string | identifiers | notes |
|---|---|---|---|
| `/api/contact` | `contact_form` | email, name | already emails the lead — any future sequence on this source opens with wait (00218 audit row) |
| `/api/newsletter` | `newsletter` | email | makes `newsletter_welcome` enrolable; EMAIL consent row written here (the subscribe action is the consent act; wording = the form's subscribe label, rendered server-side) |
| `/api/shop/leads` | `lead_magnet` | email | makes `lead_magnet_delivery` enrolable |
| `/api/inquiry` | `inquiry` (or `step_up` — see amendment) | email, phone, name + gclid/gbraid/wbraid/fbclid | phone present → checkbox (§5); keep its existing users-row behavior untouched. *Amended at execution (2026-08-22): StepUpInquiryForm posts `form_context: "step_up"` and records source `step_up` — the union member existed unemitted, and folding Step Up into generic `inquiry` would have made its leads permanently untargetable by future sequences.* |
| event signup | `event_signup` | parent email, phone | audited: opens-with-wait class |
| shop checkout (Stripe webhook, completed) | `purchase` | email, name | a paying customer is a contact; NO sequence rides this source in this stage |
| `/api/questionnaire` | `questionnaire` | per plan-time verification | wired only if it is a genuine lead-capture surface; if it is auth-gated like assessments, excluded with the same reasoning, recorded |

Rules: identifiers normalise through `normaliseEmail`/`normalisePhone`;
every write carries attribution when the route has it; `enrollIfTriggered`
fires naturally — which is the POINT for newsletter/lead_magnet and a no-op
for sources with no active sequence. Email consent rows are written only
where the route's UI actually shows consent-bearing wording (newsletter
subscribe; elsewhere the lead is contactable under the existing
transactional/legitimate-interest basis the site already operates — no
fabricated consent rows, per §6: absence of consent is a state, not a bug).

## 5. Checkboxes on the newly-wired phone forms

InquiryForm, StepUpInquiryForm, EventSignupModal gain the Stage 2 checkbox
(unchecked, shared wording, `hasSmsConsentDisplayName` gate on BOTH sides,
server-side consent row keyed to the contact the route now creates, source
= the route's source string). Same screenshot rules as Stage 2.

## 6. `scripts/activate-sequence.mjs`

House argv pattern: `node scripts/activate-sequence.mjs <env-file> <sequence-key> [--dry-run]`
— flips exactly one sequence `draft → active` (refuses any other
transition and unknown keys, prints before/after, strict flag validation
per the Stage 2 lesson). Deactivation is `... <key> --pause` (active →
paused). Human-run only.

## 7. The GHL import

A one-shot, resumable, HUMAN-RUN script (`scripts/import-ghl-contacts.mjs`,
argv env-file + snapshot dir + `--dry-run` default-on: executing for real
requires `--execute`). Reads the export snapshot, never the live API.

- **Identity:** upsert by normalised email (then phone) through the same
  merge-respecting path the spine uses; existing contacts are enriched,
  never duplicated; existing suppressions always win.
- **Consent:** EMAIL consent imported ONLY where the export carries
  evidence (GHL's own dnd/consent fields or a tag whose meaning the
  MANIFEST/tags.json documents); the consent row quotes the evidence
  (`wording_shown` = a serialized citation of the GHL field/tag + value +
  export timestamp). No evidence → no row. **SMS: every phone imports with
  NO sms consent, unconditionally** (parent §6's "Finding 2 honoured
  literally"). GHL DND-marked contacts import straight into
  `contact_suppressions`.
- **No enrolment:** the import writes through a dedicated DAL path that
  never calls `enrollIfTriggered`; a mutation test proves an imported
  contact triggers zero sequence runs.
- **Provenance:** every imported contact gets a timeline event
  (`ghl_import`, metadata: snapshot timestamp, ghl contact id) and the
  ghl id lands on the contact row if a column for it exists (plan-time
  check; if none, metadata only — no new column without a reader).
- **Attribution:** first-touch fields from GHL import only where the
  export actually carries them; never fabricated.
- **The ~90 phones:** the import tags their contacts (timeline event
  `sms_repermission_candidate`) and the re-permission email ships as a
  DRAFT sequence (`sms_repermission`, manual-enrolment, trigger NULL, copy
  authored in the seed style with the existing consent-wording clause) plus
  an ops script to enrol the candidates — three human steps to fire, zero
  taken by this stage.
- **Service application check:** the import task greps `forms.json` +
  `form-submissions.json` for anything named like "service application"
  and reports the finding; no code rides on the answer.
- The import is validated against the snapshot in dry-run (counts per
  outcome class: created / enriched / suppressed / consent-imported /
  skipped-no-evidence) and unit-tested against fixture JSON built from the
  REAL export's field shapes (mock-the-real-contract).

## 8. Outward-action guarantees

Nothing in this stage sends, publishes, or writes outside the repo when it
merges: the import and activation scripts are human-run; the re-permission
sequence is draft + manual-only; wired sources enrol only into ACTIVE
sequences (the two that could go active stay draft until the human flips);
the email fix only makes an existing dark path honest.

## 9. Testing

Per-task TDD + mutation checks (a wired route that drops its spine write; an
import that fabricates a consent row; an import that enrols); the
no-brand-literals sweep extends to every new lib file; tsc comm-diff against
a re-measured baseline; targeted suites + build; screenshots for the three
changed forms. Branch `feat/lead-engine-stage4-spine` in a worktree; the
usual holds: no merge, no push, no real-DB writes, nothing sent.
