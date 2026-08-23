# Lead Engine — continuation prompt (Stage 3: the chat assistant)

Paste everything below the line into a fresh session.

---

We are building the **Lead Engine** for djpathlete — a GoHighLevel replacement Darren
Paul accepted as the Full Engine, white-label ready package. Stage 3 is the last
unbuilt stage. Read these first, in this order:

- `docs/superpowers/specs/2026-08-18-lead-engine-design.md` — the design, reconciled
  against this repo. **This is the binding authority.** Stage 3 is §11: *"Chat
  assistant answering only from DB-backed FAQs, services, pricing, programmes, camp
  availability. Tools: `capture_lead`, `book_consult`, `escalate`. The forbidden list
  — no invented pricing, no injury advice, no promised outcomes — gets a refusal test
  suite. A prompt instruction is not a control."* That last sentence is the whole
  brief. A mid-run ruling that contradicts a spec sentence is wrong by default — one
  such ruling shipped a Critical in Stage 1c.
- `docs/lead-engine-status-2026-08-23.md` — where everything stands. It supersedes the
  21 August report, which was stale in three places.

Then, **before writing anything**: skim the newest entries in `JOURNAL.md` (local only,
never commit it), and run `git worktree list` and `git log --oneline -15`. Peer Claude
sessions commit to this repo mid-run, and a continuation prompt describes intent at the
time it was written, not current state.

## What already exists — do not rebuild any of it

Stages 1a, 1b, 1c, 2 (SMS, dark), 4 (entry points + GHL import) and the loose-ends
branch are all merged, pushed and deployed. Migrations `00211`–`00226` are applied to
production. **The engine is live**: the five-minute tick is on, three sequences are
active, 166 GoHighLevel contacts are imported, and funnel submissions enrol real leads
and send real email today.

| Thing you will need | Where it is |
|---|---|
| The one funnel every lead must go through | `recordContactEvent` in `lib/db/contacts.ts` — throws without an identifier, so callers guard first |
| The thin wrapper the entry points actually call | `captureLead` in `lib/lead-engine/capture.ts` (guards, try/catch, returns `contactId \| null`) |
| Consent recording, per channel, with evidence | `recordConsent` in `lib/db/contact-consents.ts` — `wording_shown` is NOT NULL and must quote what the person really saw |
| Suppression (identifier-keyed, contact-wide in effect) | `isSuppressed` / `suppress` in the same file |
| Anthropic helpers, already wired with retries + token tracking | `lib/ai/anthropic.ts` — `callAgent(systemPrompt, userMessage, zodSchema, options)`; models re-exported from `lib/ai/models` as `MODEL_HAIKU` / `MODEL_SONNET` / `MODEL_OPUS` |
| An existing streaming chat surface to learn the house patterns from | `components/admin/AdminAiChat.tsx` (admin-only, not the widget you are building) |
| Audit trail | `recordAudit` in `lib/audit/record.ts`, `withAudit` in `lib/audit/with-audit.ts` |

**The fact sources the assistant is allowed to speak from**, and nothing else:
`lib/db/faqs.ts`, `lib/db/programs.ts`, `lib/db/program-week-pricing.ts`,
`lib/db/events.ts` (camps and clinics), `lib/db/bookings.ts`, `lib/db/testimonials.ts`.
Read each one before designing the retrieval layer — several have visibility, tier or
status columns, and an assistant that ignores those will quote an unpublished programme
or a camp that has sold out.

## Key contracts you must not violate

1. **A prompt instruction is not a control.** Anything the spec forbids must be
   impossible, not discouraged. Pricing that is not read from the database must not be
   *expressible*: prefer returning structured values from a tool and rendering them,
   over asking a model to repeat a number correctly.
2. **Never invent a fact.** If the retrieval layer returns nothing, the honest answer is
   "I don't know, let me put you to a person" — see `escalate`. This repo has a strong
   precedent for honest refusals over confident guesses: read
   `app/(marketing)/sms-consent/[token]/page.tsx` for four states that all say plainly
   what did and did not happen.
3. **No fabricated consent.** If the widget captures a lead, a `contact_consents` row
   exists only where a real consent-bearing act happened, and `wording_shown` quotes the
   actual on-screen text. Do not copy wording into a second place where it can drift —
   `lib/lead-engine/sms-consent.ts` shows the one-resolver pattern that keeps the
   displayed sentence and the filed sentence identical by construction.
4. **The widget is PUBLIC and unauthenticated.** Treat every input as hostile. Rate-limit
   it, cap conversation length and token spend per session, and never let a prompt reach
   a tool that writes without a server-side guard of its own. Look at how
   `app/api/funnels/preview-submit` was built to write nothing at all by construction
   rather than by a filter someone has to maintain.
5. **No brand literals** in `lib/lead-engine/*` — `__tests__/lib/lead-engine/no-brand-literals.test.ts`
   sweeps that directory on disk. Business identity comes from `getBusinessSettings()`.
6. **Admin UI is light-only** here, and every list uses `components/ui/data-table.tsx`.
   Never hand-roll a `<table>`.
7. **Audit actions are a closed set** — adding an event means adding a row to
   `lib/audit/actions.ts`, and `AuditAction` is derived from that array.
8. **Migrations: the next free number is `00227`.** Two branches have already collided on
   a number in this repo; check `ls supabase/migrations | sort | tail -3` yourself before
   claiming one. Renumbering is free before a push and expensive after.

## Your job

Use the Superpowers workflow: `superpowers:brainstorming` first, then a spec, then a
plan, then subagent-driven implementation with a review after each task and a
whole-branch review at the end. Work in a git worktree on a branch. This is a feature
build-out, not a bug fix.

Design decisions worth settling in brainstorming, not mid-build:

- **Where the assistant lives.** A floating widget on the marketing site, a dedicated
  page, or both? Note `components/messaging/MessagingDock.tsx` already occupies the
  bottom-right corner of admin pages.
- **Retrieval shape.** The fact set here is small and structured. Embeddings may be
  unnecessary — a handful of typed tool calls over the DALs above will beat a vector
  store for this data, and is far easier to make provably honest. Justify whichever you
  pick.
- **The three tools.** `capture_lead` (build on `captureLead`, source string is a
  contract — pick one and use it exactly), `book_consult` (read `lib/db/bookings.ts`
  first; decide whether the assistant books or hands over a link), `escalate` (where
  does it go — the inbox, an email to `business_settings.reply_to`, both?).
- **The refusal suite.** This is the deliverable the spec names explicitly. Enumerate
  the forbidden categories, write a test per category that drives the real assistant
  path, and make each one fail first. Mutation-test the guards: break each, watch a
  named test fail, and paste the real output. A guard nobody has broken is a guard
  nobody has tested.

## Verification gates

- `npx tsc --noEmit 2>&1 | grep -cE "error TS"` must be **251** — the measured baseline
  as of 2026-08-23. A falling count hides new errors too; attribute by file, don't trust
  the number.
- Targeted test suites plus `npm run build`. **Do not run the full suite** unless the
  change is genuinely cross-cutting.
- `npx prettier --write` every file you touch.
- **Screenshots are required for new UI**: drive the real app with Playwright, annotate
  the PNGs themselves, and put them in `screenshots/<feature>/`.
  `scripts/capture-loose-ends-screenshots.ts` + `scripts/_annotate-lib.mjs` are a working
  harness to copy — including the dev-login bypass, the dev-clone-only guard, and the
  restore-what-you-touched `finally` block.
- **Never** add `Co-Authored-By` or any AI attribution to a commit or PR.
- **Never push, merge or deploy without an explicit go-ahead from Darren.** Get it green,
  reviewed and committed on a branch so a one-word yes finishes it.

## Two open items you will trip over, neither of them yours

1. **The hourly pipeline reconciler has never repaired a dropped payment webhook.**
   `contacts.user_id` is read in exactly one place and written by nothing in `lib/`,
   `app/` or `scripts/`, so `lib/automation/pipeline-reconcile.ts:187` — which resolves
   the contact with only `{ userId: payment.user_id }` — always gets null and skips. The
   booking half works. Worth its own ticket; do not fold it into Stage 3.
2. **An A2P compliance judgement is outstanding.** The re-permission email and the SMS
   consent page both carry rates, STOP and HELP, but no message-frequency line and no
   Terms/Privacy links. The privacy policy does disclose frequency, so the disclosure
   exists in the policy but not in the flow the consumer saw. Darren or whoever owns the
   Twilio campaign decides whether that split is acceptable — a coder should not.
