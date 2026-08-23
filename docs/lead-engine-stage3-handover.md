# Lead Engine Stage 3 — the chat assistant, handover

**Branch:** `feat/lead-engine-stage3`, based on `e4970016`. **Not pushed, not merged, not
deployed.** Everything below is green and committed, waiting on a go-ahead.

**Date:** 2026-08-23
**Spec:** `docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md`
**Plan:** `docs/superpowers/plans/2026-08-23-lead-engine-stage3-chat.md`
**Screens:** `screenshots/lead-engine-stage3/`

---

## What it does

A visitor can ask a question on the public site — from a launcher in the sticky bar, or at
`/ask` — and get an answer built only from what is published here: FAQs, the public
programme, camps and clinics, testimonials. When it cannot answer, it says so and offers a
person. It can put a details form on screen, hand over a booking link, and escalate to the
operator.

Stage 3 is the last unbuilt stage of the Lead Engine. The rest is live.

---

## Before it can serve a single request

Three things, in this order. The first is not optional — the route throws without it.

| #   | Step                                                          | Why                                                                                                                                                 |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Set **`CHAT_IP_SALT`** in Vercel env (any long random string) | `POST /api/ask` refuses to run without it. An unsalted hash of an IPv4 address is brute-forced in seconds, so it fails loudly rather than degrading |
| 2   | Set **`business_settings.display_name`** and **`reply_to`**   | Both are `""` today. Blank name ⇒ no marketing-consent tick can be shown or filed. Blank reply-to ⇒ escalations are recorded but nobody is emailed  |
| 3   | Flip **`chat_assistant_enabled`** on `/admin/automation`      | Defaults off. This is now a real switch — see below                                                                                                 |

**The off switch works everywhere, immediately.** That took a fix: the flag was originally
read in the marketing layout and baked into every statically generated page, so 13+ routes
would have ignored it until the next deploy — including, fatally, ignoring it being turned
_off_. The launcher now reads `GET /api/ask/config` at the moment it appears. Verified:
`askEnabled` appears in 0 of 355 prerendered payloads.

### After the merge, for retention

`chatRetentionCron` **deploys automatically with the merge** — `deploy-functions.yml` fires
on any push to main touching `functions/**`. Nothing breaks: `cron_chat_retention_enabled`
defaults false, so the route returns `skipped` before writing a `cron_runs` row.

To actually switch retention on: flip `cron_chat_retention_enabled`, **then** add
`chatRetentionCron` to the automation-health expected list and to `lib/cron-catalog.ts`.
Doing that third step first produces a daily false alert for a job nobody broke.

`chat_retention_days` defaults to **90**. It now refuses `0`, `"90"` and `null` rather than
deleting everything.

---

## What is genuinely enforced, and how

The binding requirement was parent spec §11: _"A prompt instruction is not a control."_
Each row below is a structural control, and each has a test that was proven to fail when
the control was removed.

| Forbidden                                          | What actually prevents it                                                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quoting a private client's plan or price           | The assistant reads its own narrow accessors, not the general data layer. `programs` has two visibility columns and the obvious function checks only one — 40 rows are active, **1** is also public, and the other 39 are clients' personal plans with what they paid |
| Inventing a price or a date                        | Every number in a reply is checked against the typed values the lookups actually returned. A turn that fails is discarded whole and replaced with an honest refusal                                                                                                   |
| Giving injury or medical advice                    | Classified **before** the model is called; the model is never asked. A question split across two turns is caught too                                                                                                                                                  |
| Promising outcomes                                 | Detected in the reply and blocked                                                                                                                                                                                                                                     |
| Creating a contact or consent without a real click | No tool the model can call has any write path at all. Only the visitor's own form submission writes                                                                                                                                                                   |
| Model prose reaching the screen unchecked          | The one card that carried a model-written sentence now has it redacted server-side                                                                                                                                                                                    |

---

## Five things you should know

**1. The tests were greener than the code.** Five independent reviewers found three
Criticals and five tests that could not fail, all under a passing suite. Nothing was found
by a test failing; everything was found by breaking a guard on purpose. Every one is now
fixed and re-proven by re-running the mutation that had survived.

**2. The chat tables shipped world-readable, and it is fixed.** Migration `00227`
originally created both tables without row-level security. Supabase grants the public
`anon` key full read/write on such a table, and that key is in the browser bundle — so
every transcript was readable, and writable, by anyone. Confirmed against the clone before
and after. Every sibling migration enables RLS; this one was the outlier.

**3. A privacy leak was observed, investigated, and was not a defect.** During the
screenshot run two turns returned 39 programme cards — 38 non-public, 15 with prices. Cause:
a reviewer's control mutation deleted the `is_public` filter while a dev server hot-reloaded
that same working copy. Not shipped code. The rows were purged from the clone. The lesson —
a mutation applied in a directory that is also serving `npm run dev` is live traffic — is
recorded.

**4. Escalation is honest when it cannot send.** With `reply_to` blank, the conversation is
still marked escalated and shows on `/admin/chat`; the visitor is told it has been flagged
for a person, not that an email went. This mattered because `lib/email.ts` returns a
**success shape** when `RESEND_API_KEY` is unset — "the send didn't throw" never meant
"somebody was told".

**5. `/ask` serves a soft 404 when the flag is off.** The page renders the not-found screen
but with HTTP 200. The gate itself is sound — the response carries no panel markup at all,
and both API routes return a real 404. The cause is pre-existing and repo-wide (confirmed on
clean `main`): `/blog/<bad-slug>` and `/camps/<bad-slug>` do the same.

---

## Found in passing — not this branch's to fix

Each is real, each has evidence, none is folded in.

1. **Every marketing 404 is a soft 404.** `/blog/*` and `/camps/*` return HTTP 200 with the
   not-found page. They are indexable, and search engines penalise soft 404s. `/ask` sets
   `robots: index:false` so it is not exposed the same way.
2. **`lib/email.ts` reports success when it sent nothing.** ~38 senders, and only the new
   chat escalation surfaces delivery to its caller. Anywhere the product says "we've emailed
   you", that can be false with a green log.
3. **A failing cron records no reason.** The house data layer rethrows the raw database
   error object, which is not an `Error`, so the standard cron shell writes the literal
   `"[object Object]"` into `cron_runs.details`. `contact-timeline-retention` and the
   audit-log prune both still have it; the chat one is fixed.
4. **`opportunities` and the pipeline tables are readable by the public anon key** —
   migration `00219` has no RLS either. That is the deal spine. Not fixed here because it
   touches four tables and other subsystems, and doing it unsupervised risks breaking
   something that works. It is a small migration for whoever picks it up.
5. **`npm run lint` does not work at all.** Next 16 removed `next lint`. `tsc --noEmit` plus
   `npm run build` is the entire gate today.
6. **The hourly pipeline reconciler has never repaired a dropped payment webhook** —
   `contacts.user_id` is read in one place and written by nothing. Carried over from the
   previous stage's report, still true.
7. **The A2P message-frequency judgement is still outstanding.** Unchanged.

---

## Verification

- Targeted suites across everything Stage 3 touches: green.
- `npx tsc --noEmit` — **251**, exactly the baseline measured on clean `main`, with zero
  errors attributable to any Stage 3 file.
- `npm run build` — green, and marketing pages remain statically generated.
- Nine annotated screenshots, driven through the real app on the real routes with the real
  model. Light only: this app has no working dark mode — `.dark` is declared in
  `globals.css` and applied nowhere.
- Migration `00227` applied to the dev clone and read back, including the RLS policies.
- Pre-existing failures, confirmed identical on clean `main` and untouched here:
  `funnel-island-traits` (1) and `bookkeeping/SetupPanel` (7).
