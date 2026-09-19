# Build prompt — close the Lead Engine gaps

Paste the block below verbatim into a fresh Claude Code session. Written 2026-09-07
against `main` @ `9c366ab2`. Regenerate it if more than a week passes — the counts
inside are measured, and measured facts age.

---

```
Build the outstanding Lead Engine gaps in the djpathlete repo.

## Start here

Read these three, in this order, before touching anything:

1. `docs/full-engine-scope-vs-built.md` — the single source of truth. Section 4
   is a numbered list of 15 gaps; section 5C is the build order. It was measured
   from production on 2026-09-06, not quoted from older docs.
2. `CLAUDE.md` — architecture, the design system, and the white-label direction.
3. `JOURNAL.md` — newest entry first. Read at least the top five entries; they
   are a list of mistakes already paid for on exactly this subsystem.

Then RE-MEASURE before planning. Those counts are days old and this repo has a
documented history of status docs drifting. Read production yourself through the
`supabase-prod` MCP (it is READ-ONLY — an UPDATE returns 25006) and confirm the
sequence statuses, run counts and flag values in section 3 still hold. Say
explicitly which ones moved.

## The goal

Close the buildable gaps in section 4 so the owner can run lead follow-up,
pipeline and SMS without GoHighLevel. Done means: each item below is built,
tested, reviewed, committed on its own branch, and green — ready for a one-word
go-ahead to merge.

## Scope, in this order

Build in this order. It is dependency order, not size order.

1. **#4 — the per-sequence reporting screen.** Entered / active / exited, with
   exits broken down by reason (bought, booked, unsubscribed, ran to the end).
   `exit_reason` is already written correctly by `lib/db/sequences.ts`; today it
   is read in exactly one place, the contact detail page. Everything else on
   this list is guesswork until this exists. Promised in all three quoted
   packages.
2. **#5, #6, #7 — sequence content.** Three sequences that do not exist at all
   (abandoned checkout; service application received; camp or clinic deadline),
   real multi-step bodies for the four one-email quiz sequences, and branching.
   Zero branch steps exist in production today although the engine fully
   supports them.
3. **#11 — a screen to manage sequences.** On/off and a step editor. Right now
   activating one requires `scripts/activate-sequence.mjs`.
4. **#12 — make `tag` and `stage` sequence steps do something.** They currently
   advance silently with `note: "unsupported_kind"` at
   `lib/automation/sequence-tick.ts:166`. #2 above will want both.
5. **#8 — pipeline boards and routing.** Design already written:
   `docs/superpowers/specs/2026-09-01-full-engine-phase4-pipeline-boards-design.md`
   (status "not yet approved" — treat it as a strong draft, not a contract).
   The board editor is the easy half. **Routing is the hard half and does not
   exist in any form**: `applyPipelineEvent` takes a `pipelineKey` and no caller
   anywhere passes one, so every booking, payment and quiz result lands on
   Coaching. A board without exactly one `won` and one `lost` stage makes
   `decideMove` throw at runtime, not at build time.
6. **#10 — two-way SMS.** Design already written:
   `docs/superpowers/specs/2026-09-01-full-engine-phase3-two-way-sms-design.md`.
   A conversation view plus a manual send. `sendRenderedSequenceSms` has exactly
   one caller today. A2P is approved and all three Twilio variables are in
   production, so nothing here is blocked on carriers.
7. **#14 — write the three declared-but-never-written contact sources**
   (`shop`, `assessment`, `funnel_checkout`). Half a day, unblocks segmenting.

## Two questions to put to the owner, early, and not decide yourself

- **#13 — the chat bubble on funnel and landing pages.** Excluded today on
  purpose ("a landing page's job is to remove exits"); the quotation says it is
  there. One line either way. Ask, then do it.
- **#15 — consent-gating email.** `hasEmailConsent` is computed and consumed at
  exactly one place, `lib/automation/sequence-tick.ts:85`, inside an *optional*
  branch condition. SMS is hard-gated; email is not. There are 169 contacts with
  zero consent rows, so gating email would silence the entire imported list.
  This is a business decision. Ask before building either way.

## Explicitly NOT in scope

These are the owner's, not yours. Do not do them, and do not touch production
data or flip production flags:

- Unpausing `newsletter_welcome` / `lead_magnet_delivery` (§5A of the doc).
- Repairing the 73 stranded `sms_repermission` runs. The script exists and
  deliberately has no default for `--next-run-at` because the date is the
  owner's call.
- Turning on `cron_pipeline_reconcile_enabled`.
- Publishing funnels.
- Cancelling GoHighLevel. It still holds the consent records and runs the quiz,
  and Calendly has produced zero bookings here so far.

## How to work

Follow the Superpowers workflow — this is a feature build-out, not a bug fix:
`superpowers:brainstorming` → `superpowers:writing-plans` →
`superpowers:subagent-driven-development` → `superpowers:requesting-code-review`.
One branch and one plan per numbered item above; do not build them all on one
branch. Work in a git worktree.

A worktree inherits neither `.env.local` nor `node_modules`. Symlink the env
file; run a real `npm ci` for the modules — a symlinked `node_modules` passes
vitest and then panics Turbopack.

## Invariants — breaking any of these is a defect, not a style choice

- **Never add a new `SINGLETON_BUSINESS_ID` reference.** It is down to 5
  production files and a test fails if the inventory in `lib/tenancy/platform.ts`
  goes stale. Every new table gets `business_id`; every new reader gets a tenant
  predicate.
- **Every list is `components/ui/data-table.tsx`.** Never hand-roll a `<table>`.
  The reporting and sequence-management screens are lists — compose
  `DataTableCard` → `DataTableToolbar` → `DataTable` → rows, with
  `DataTableBadge` for status pills. Note `DataTableEmpty` renders its own `<tr>`.
- **Admin UI is light-only.** `.dark` is a variant these components were never
  built against.
- **No brand names anywhere under `lib/lead-engine/`, comments included** —
  `__tests__/lib/lead-engine/no-brand-literals.test.ts` sweeps for them.
  Business identity comes from `getBusinessSettings()`.
- **A column with no reader is a labelling gap.** Name the reader before adding
  one.
- **Migration numbers collide silently.** Last applied is `00253`; claim the next
  number at branch time and re-check before pushing. Production applies pending
  migrations automatically on merge to main, so code must tolerate the old schema
  for one deploy.
- `__tests__/lib/lead-engine/seed-sequences.test.ts` reads migration 00218 off
  disk and asserts its structure. Write the equivalent test for any new seed
  migration — that suite will not cover it.

## Verification standard

- **Targeted tests only.** Do not run the full suite at checkpoints. Relevant
  suites: `__tests__/lib/lead-engine/`, `__tests__/lib/automation/sequence-*`,
  `__tests__/lib/db/{sequences-list,contact-detail,contact-tags}.test.ts`,
  `__tests__/lib/automation/pipeline-reconcile.test.ts`.
- `nvm use` (Node 24) before vitest. Node is the default environment; route
  suites may need `--environment node` pinned.
- A build (`npm run build` / `tsc --noEmit`) is the separate "did I break
  compilation" gate. The recorded tsc baseline is **238 errors** and the test
  baseline **937 files / 9067 tests** green, both as of 2026-09-05/06 —
  **re-measure both from a detached worktree at your branch point** rather than
  trusting those numbers, and diff the per-file error SET, because a falling
  count still hides new errors.
- **Mutate any test that passes on the first run.** A green-on-first-run test in
  this repo has repeatedly turned out to pin nothing.
- Screenshot every new screen by driving the real app with Playwright, in the
  real route, with real data, annotations burned into the PNG. Put them in
  `screenshots/<feature>/`.

## Traps already paid for — do not rediscover these

- `lib/email.ts` returns a SUCCESS shape when `RESEND_API_KEY` is unset. A send
  that did not throw is not a send.
- The sequence tick returns BEFORE it logs when its flag is off, so a silent
  `cron_runs` table does not prove a dead cron.
- `business_settings.sender_name` and `postal_address` are load-bearing: an empty
  sender name renders `from: " <addr>"` which Resend rejects, and an empty postal
  address stops the tick running at all.
- To report something as missing, grep the helper that performs the verb, not the
  function you expect to call it. Sequence exits live in the event handlers
  (`exitRunsForContact` in the Stripe webhook, `lib/bookings/ingest.ts`, the
  Twilio inbound route, `unsubscribe.ts`), not in `decideStep`. And there are two
  capture modules: `lib/lead-engine/capture.ts` and `lib/funnels/capture-contact.ts`.
- `bookings` stores national-format phones, so `.eq()` against `phone_e164`
  matches zero rows forever.
- Published funnel CSS is frozen — style changes reach a live page only on
  re-publish.
- Other Claude sessions commit to this checkout. Verify from commits, not the
  working tree.

## Testing SMS without a US handset — already solved, do not redo

The owner is in the Philippines and has no US phone. That is not a blocker. All
of the following was measured on 2026-09-07, not reasoned about:

- **You cannot test with a Philippine number, at all.** Outbound to +63 fails
  `21612`. Twilio prices only `mobile` and `local` sender types for Globe and
  Smart and lists **no `longcode` route**, so the US 10DLC number
  `+18132129256` physically cannot reach a PH handset. An earlier `21408` was a
  Geo Permissions problem and has been fixed; `21612` sits behind it and is
  structural. **Do not spend time on Geo Permissions — that part is now correct**,
  and do not buy a PH number: it would test a sender production never uses over
  a route production never takes.
- **The inbound webhook can be driven directly, for free, with no phone and no
  carrier.** Forge a correctly signed Twilio request: HMAC-SHA1 over
  `url + each POST param key and value concatenated in ASCII-sorted key order`,
  base64-encoded, keyed with `TWILIO_AUTH_TOKEN`, sent as `X-Twilio-Signature`.
  The URL must be exactly `https://www.darrenjpaul.com/api/webhooks/twilio/inbound`
  — the **www** form, because the HMAC covers the full URL string and that is
  what `appOrigin()` reconstructs. The apex 307-redirects and would sign over a
  different host.
- **`HELP` from a number with no matching contact is the safe probe.** It is the
  only branch that writes no row and emails nobody.

**Already verified on production, 2026-09-07 — do not repeat these two:**

- Signed `HELP` → `HTTP 200`, `Content-Type: text/xml; charset=utf-8`, body
  `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`. **The 12300
  Invalid-Content-Type defect is confirmed fixed in production**, which had never
  been proven since the fix shipped on 2026-08-25.
- Negative control: a wrong signature and a missing signature header each →
  `HTTP 403 {"error":"invalid signature"}`. The 200 above was therefore earned,
  not a route that answers 200 to anything.

**What the probe still does NOT cover, and what would:**

- **The `STOP` branch's writes** — `contact_suppressions`, `exitRunsForContact`,
  the timeline row. A signed `STOP` from an unused number would prove all three,
  and needs no contact because suppression is identifier-keyed. It writes to
  production, so get the owner's go-ahead first and delete the row afterwards.
- **Twilio's own opt-out auto-replies.** They are generated by the platform and
  appear neither in the Messages API nor in our webhook. Only a handset sees
  them. Do not infer their absence from an API count — that exact mistake has
  been made on this account once already.
- **Real carrier delivery.** Outbound to a US handset was proven `delivered` on
  2026-08-25. A second US Twilio number (~$1.15/month) would close the full round
  trip if the owner approves it; that is the only remaining option that exercises
  both halves.

## Deliverables

Each item: its own branch, committed, targeted tests green, tsc no worse than
baseline, screenshots for anything with UI, and a code review passed. Update
`JOURNAL.md` with a dated entry per item including mistakes and lessons — and
never commit the journal, it is gitignored. Update section 4 of
`docs/full-engine-scope-vs-built.md` as each gap closes so it stays the one
current document.

No Claude or AI attribution in commit messages or PR bodies.

Do not merge to main, deploy, or send anything outward without an explicit
go-ahead. Get it all ready so one word finishes it.
```
