# Lead Engine — status report, 2026-08-24

Supersedes `docs/lead-engine-status-2026-08-23.md`, which is now wrong in four
places. Corrections are at the bottom.

Everything below was read from **production** (`epzuvzkokzqtzomeyoha`) today, not
from the plans. Where a claim is a count, the count came from the database.

---

## Bottom line

**The Lead Engine is built, merged and deployed — and it is inert.** Not blocked
on code. Every remaining gap is a switch that is off, plus one genuinely unbuilt
piece (the Athlete Quiz).

The thing to act on: **73 real people are enrolled in a sequence, all 73 are
overdue since 22 August, and not one message has been sent.**

---

## The finding that matters

| | |
|---|---|
| `sequence_runs` for `sms_repermission` | **73**, every one `status=active`, `current_position=0`, **`attempts=0`** |
| `next_run_at` on all 73 | `2026-08-22T12:00:00Z` — **~2 days overdue** |
| `sequence_messages` | **0 rows** |
| Send events in `contact_timeline_events` | **none** (only `ghl_import` 166, `sms_repermission_candidate` 90) |
| `last_error` on the 73 | none |

`attempts=0` with no errors means the tick has never *tried*. The cause is one
setting:

```
cron_sequence_tick_enabled = false
```

`sequenceTickCron` is scheduled in `functions/src/index.ts` and does fire every
five minutes, but `app/api/admin/internal/sequence-tick/route.ts` checks that flag
and returns `{skipped}` **before** `logCronStart`. That is why `sequenceTickCron`
appears nowhere in `cron_runs` while ten other crons log daily — the absence is
by design, not a broken scheduler.

**The sequence engine has never run in production.**

---

## Every gate, and where it stands

### Ready — no longer blocking

| Gate | State |
|---|---|
| `business_settings.display_name` | `"DJP Athlete"` — was blank at Stage 3 handover |
| `business_settings.reply_to` | `darren@darrenjpaul.com` — was blank |
| `CHAT_IP_SALT` in Vercel | set (Preview + Production) |
| Four Twilio env vars in Vercel | all set (Preview + Production) |
| Stage 3 chat code | merged (`ec3acb16`) and deployed |
| Legal v4 | published **and** live (privacy Version 4, terms v3) |

### Off — each is a deliberate switch nobody has flipped

| Switch | Value | Consequence while off |
|---|---|---|
| `cron_sequence_tick_enabled` | `false` | **Nothing sends. This is the master switch.** |
| `chat_assistant_enabled` | `false` | The assistant is dark on every surface |
| Sequence `newsletter_welcome` | `paused` | Subscribers get no welcome |
| Sequence `lead_magnet_delivery` | `paused` | Lead magnets are not delivered |
| Sequence `sms_repermission` | `paused` | The 73 stay parked |
| Sequence `cold_lead_re_engagement` | `draft` | By design — manual enrolment only |
| Sequence `new_lead_nurture` | **`active`** | The only active one, and still inert while the tick is off |

Note the two-lock design: a sequence must be `active` **and** the tick must be on.
Turning on the tick alone changes nothing for four of the five.

### Waiting on a third party

| | |
|---|---|
| SMS sending | A2P campaign `QE2c6890…` resubmitted 24 Aug, now `IN_PROGRESS`. Vetting 1–3 weeks. |
| `business_settings.sms_messaging_service_sid` | blank — `scripts/configure-lead-engine-sms.mjs` fills it the day A2P clears |

---

## Genuinely not built

1. **The Athlete Quiz replacement.** Still in GoHighLevel, still producing most
   leads, still the single biggest remaining piece of work — but no longer
   unscoped. As of this evening `feat/athlete-quiz` (worktree
   `.claude/worktrees/athlete-quiz`, 4 commits) carries a design spec, an
   implementation plan, migration `00228_athlete_quiz.sql` (seven tables, RLS
   written into the creating migration — unlike `00219`), `lib/db/quizzes.ts`,
   `lib/quizzes/types.ts` and two test files. **Not built:** the quiz UI, the
   scoring engine (`lib/quizzes/score.ts` is uncommitted work-in-progress), the
   funnel wiring, and the GHL switch-over. Picked up by a second session on
   2026-08-24 — do not commit to that branch from here.
2. **Two GoHighLevel automations need homes** — one creates client accounts on a
   won sale, one pushes injury data to Airtable.
3. **The switch-over itself** — parallel run, then disable GHL workflows one at a
   time.

---

## Empty tables worth explaining

- `contact_consents` — **0 rows.** Nothing has been captured yet because no form
  submission has come through the new spine in production.
- `opportunities` — **0 rows.** The pipeline board renders, but there are no cards
  because nothing has enrolled or converted through it yet.

Neither is a defect; both are what "deployed but never exercised" looks like.

---

## Carried-over defects (from the Stage 3 handover, all still open)

1. `opportunities` and the pipeline tables have **no RLS** (migration `00219`) —
   readable by the public anon key that ships in the browser bundle. This is the
   deal spine. Small migration; nobody has picked it up.
2. `lib/email.ts` **reports success when it sent nothing** — ~38 senders.
3. A failing cron records `"[object Object]"` as its reason —
   `contact-timeline-retention` and the audit-log prune still have it.
4. Every marketing 404 is a **soft 404** (HTTP 200), repo-wide.
5. `npm run lint` **does not work at all** — Next 16 removed `next lint`.
   `tsc --noEmit` + `npm run build` is the whole gate.
6. The hourly pipeline reconciler has **never repaired a dropped payment webhook**
   — `contacts.user_id` is read in one place and written by nothing.
7. `cron_chat_retention_enabled` is **seeded by no migration**, so no row exists in
   `system_settings`. It defaults false in code, but there may be nothing for
   `/admin/automation` to toggle. (Confirmed 2026-08-24: zero hits for the key
   across `supabase/migrations/`.)

## Fifteen tests are red on `main` right now, across five suites

All verified on a clean `ec3acb16`. **None is caused by the Lead Engine** — this
is inherited breakage. Recording it so nobody re-diagnoses it.

**Twelve of the fifteen are a single missing config line.** `report-shell` (5)
and `SetupPanel` (7) both die in `beforeEach`, before the component is touched:
`TypeError: Cannot read properties of undefined (reading 'clear')` on
`localStorage.clear()`. `vitest.config` sets `environment: "jsdom"` but no
`environmentOptions`, so jsdom runs at its default `about:blank` — an opaque
origin, where `localStorage` is not populated. `__tests__/setup.tsx` does not
supply it either. The fix:

```js
environmentOptions: { jsdom: { url: "http://localhost:3050" } }
```

Not applied here: it is shared config every suite loads, so it is a cross-cutting
change needing a full-suite run, not a targeted one.

The other three are independent:

1. `__tests__/lib/funnels/sections/leadgen.test.ts` — 15 passed / 1 failed.
   `FunnelForm.tsx emits classes neither stylesheet targets: ['djp-test-run']`.
   The draft-preview test-run marker ships a class with no CSS rule behind it.
   **The rule belongs in `SECTION_CSS.form`, not in another kind's block** —
   [doc.ts:256](lib/funnels/sections/doc.ts) emits only the CSS for kinds the
   page actually uses, while the test joins every kind, so a rule filed under an
   unrelated kind turns the suite green while leaving the live page unstyled.
2. `__tests__/components/admin/funnel-island-traits.test.ts` — 14 passed / 1
   failed. `form.eventId is edited by a trait but the schema drops it`.
3. `__tests__/components/receipt-row-editor.test.tsx` — 1 failed, the PDF
   preview iframe.

Also worth knowing before anyone edits the AI page-builder prompt:
`SECTION_BUILDER_BLOCK_A` is **16,929 characters against a 17,000 ceiling — 71
characters of headroom** with ten section kinds. The suite is green, but an
eleventh kind cannot fit. Raising the ceiling needs a fresh token-budget
justification, since the test derives 17,000 from ~4 characters per token.

---

## Uncommitted work in the tree

A chat-markdown change is unmerged: `lib/lead-engine/chat/markdown.ts`,
`components/public/AskMarkdown.tsx`, `__tests__/lib/lead-engine/chat-markdown.test.ts`,
plus edits to `app/api/ask/route.ts`, `AskPanel.tsx`, `prompt.ts`, `tools.ts` and
`screenshots/ask-panel-markdown/`.

**Assessed 2026-08-24: it is finished and green.** 78 tests pass across
`chat-markdown.test.ts` (13), `ask.test.ts` (46) and `AskPanel.test.tsx` (19);
`tsc --noEmit` sits at exactly the 251-error baseline with **no** error in any of
the touched files; annotated screenshots are in `screenshots/ask-panel-markdown/`.
It is ready to commit — it is not a source of remaining Lead Engine risk. Note it
ships dark either way: `chat_assistant_enabled` is `false`, so merging it changes
nothing a visitor can see until that switch is flipped.

---

## Corrections to the 23 August report

1. **Stage 3 is not "Not started" — it is built, merged and deployed.** The 23rd's
   report predates the merge. `docs/lead-engine-stage3-handover.md` also still says
   "Not pushed, not merged, not deployed"; both are stale.
2. **The 73 re-permission asks were enrolled, NOT sent.** The 23rd says "73
   re-permission asks enrolled and sent". `scripts/enrol-repermission.ts` only
   creates `sequence_runs` rows — sending is the tick's job, and the tick has never
   run. `sequence_messages` is empty and no send event exists on any timeline.
3. **`newsletter_welcome` and `lead_magnet_delivery` are not running.** The 23rd
   says both were "activated" on 22 August. Both read `paused` today.
4. **Twilio A2P is no longer blocked on error 18601.** The business profile is
   `twilio-approved` and the brand is `APPROVED`/`VERIFIED`. The campaign was
   separately rejected under 30886, has been fixed and resubmitted, and is
   `IN_PROGRESS`. See `docs/compliance/2026-08-24-a2p-campaign-resubmission.md`.

---

## What "turn it on" actually looks like

Not a recommendation to do it now — the ordering matters, and step 1 releases mail
to 73 real people who were imported from GoHighLevel.

1. Decide whether the 73 overdue re-permission asks should still go out two days
   late, or be re-dated first. **Flipping the tick on releases all 73 at once.**
2. Un-pause the sequences that should run.
3. Flip `cron_sequence_tick_enabled`.
4. Watch `cron_runs` for `sequenceTickCron` appearing, and `sequence_messages`
   going non-zero.
5. Separately, flip `chat_assistant_enabled` — its env and settings prerequisites
   are all met now.
