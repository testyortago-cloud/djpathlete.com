# Lead Engine — the steps a human runs

**Status 2026-09-01, after the owner's "merge push then continue to step 2":
steps 1, 2 and 3 are DONE and verified. Step 4 is the next action, and it is
a decision, not a command.**

| Step | State |
|---|---|
| 1. Merge + deploy | **done** — main `774421cd`, migration 00235 applied to prod and read back, deploy Ready |
| 2a. `business_settings.sender_email` | **done** — now `noreply@send.darrenjpaul.com`, confirmed by RETURNING |
| 2b. `RESEND_FROM_EMAIL` | **done** — Production, Preview and Development |
| 2c. Redeploy so 2b takes effect | **done** — `djpathlete-e6q5flff0`, aliased to www.darrenjpaul.com |
| 3. Prove a real email sends | **done, with a control** — see below |
| 4 onward | **not started — step 4 is yours** |

## Step 3 was proved with a control, not just a green send

Both calls made against the live Resend account with the production key:

| From | Result |
|---|---|
| `noreply@send.darrenjpaul.com` (new) | accepted, `last_event: delivered` |
| `noreply@darrenjpaul.com` (old) | **403** `The darrenjpaul.com domain is not verified` |

The control returns the exact error string that destroyed the 73 runs on 31
August, which is what makes the first row mean something: the change is what
fixed it, not something incidental. Sent to `delivered@resend.dev`, Resend's own
test address, so no real person received anything.

Worth noting for the code as well: the control's shape — `statusCode: 403`,
`name: "validation_error"` — is exactly what `classifySendFault` now reads as a
CONFIGURATION fault. So a repeat of this misconfiguration would defer the runs,
not destroy them.

## What is left, and step 4 is a decision only you can make

Read `docs/superpowers/specs/2026-09-01-lead-engine-last-mile-design.md` for why
each one exists. This file is only the order and the commands.

---

## What is true right now

| | |
|---|---|
| `business_settings.sender_email` | `noreply@send.darrenjpaul.com` — **verified, sends** |
| `RESEND_FROM_EMAIL` | the same, live since deploy `djpathlete-e6q5flff0` |
| `cron_sequence_tick_enabled` | `true` — the tick IS running every 5 minutes |
| `sequence_runs` | **73 rows, all `failed`** — nothing else exists, so nothing is due and nothing sends |
| Successful sends by the engine | still **zero** — the 73 have to be repaired first (step 5) |
| `chat_assistant_enabled` | `false` |
| Quiz result sequences | four, all `draft`, all still carrying `PLACEHOLDER COPY` |

---

## Step 1 — merge and deploy the branch — DONE

The repair in step 3 is safe without it, but the fault that caused the damage is
still live until this ships: any provider misconfiguration destroys runs again.

```bash
git checkout main && git pull
git merge --no-ff feat/lead-engine-last-mile
git push origin main
```

Wait for the Vercel deploy to report Ready before step 3. `vercel ls` writes
status to **stderr** — do not redirect it away, or a failed deploy reads as a
success seconds after the push.

## Step 2 — point the sender at the verified domain

Two places, and both must change or half the app keeps failing.

**Database** (one field):

```sql
update business_settings
   set sender_email = 'noreply@send.darrenjpaul.com'
 where sender_email = 'noreply@darrenjpaul.com'
returning business_id, sender_email;
```

**Vercel environment** — `RESEND_FROM_EMAIL`, currently
`Darren J. Paul <noreply@darrenjpaul.com>`, becomes
`Darren J. Paul <noreply@send.darrenjpaul.com>`. This one governs the ~38
senders in `lib/email.ts` — every transactional email in the product, not just
the Lead Engine. Changing it requires a redeploy to take effect.

> If you would rather keep the apex address, the alternative is to verify
> `darrenjpaul.com` at Resend instead and skip this whole step. That was the
> other option on 2026-09-01 and you chose the subdomain; either is fine, but
> do one of them.

## Step 3 — prove one real email arrives

**Do not skip this.** The engine has never successfully sent an email in
production. Until one lands in a mailbox you can open, "sending is fixed" is a
claim about code.

Send yourself anything the product sends — a password reset is the cheapest —
and read it. Check the From line says what you expect.

## Step 4 — decide the dating of the 73

They were due 2026-08-22. Send them as they are, or re-date them. There is no
default; the script refuses to run without an answer.

## Step 5 — repair the 73

Dry run first. It writes nothing without `--apply`.

```bash
node scripts/repair-failed-sequence-runs.mjs \
  --env .env.prod \
  --sequence sms_repermission \
  --error-pattern "domain is not verified" \
  --next-run-at <your answer from step 4>
```

Expected: `failed runs on this sequence: 73` and
`matching all three predicates: 73`. If those two numbers differ from each
other, stop and read why before applying.

Then re-run with `--apply` appended.

**This is the step that reaches 73 real people** — they will be sent on the
next tick after `--next-run-at`.

## Step 6 — watch it work

```sql
select status, count(*) from sequence_messages group by 1;
select cron_name, status, started_at, error_message
  from cron_runs where cron_name = 'sequenceTickCron'
 order by started_at desc limit 5;
```

`sequence_messages` going non-zero on `sent` is the first successful send in the
engine's life. A `sequenceTickCron` row reading `failed` with "configuration
fault" means step 2 did not take — nothing was lost, the runs deferred.

## Step 7 — the rest, in your own time

- Un-pause `newsletter_welcome` and `lead_magnet_delivery` if they should run.
- Write the four quiz result emails, delete the `PLACEHOLDER COPY` line, then
  activate. The test suite now fails if a sequence is active with that line
  still in it, so the branch cannot ship a half-written one.
- Flip `chat_assistant_enabled` to `true`. Everything it needs is already set.
- Start the GoHighLevel parallel run.

---

## If something goes wrong

**Nothing sent, no errors.** Check `cron_sequence_tick_enabled` is still true
and that the sequence is `active` — a sequence needs both.

**A `sequenceTickCron` row says "configuration fault".** The provider rejected
every attempt. The runs are deferred, not lost; they retry for about an hour
(five attempts) and then fail properly. Fix the setting and, if they already
failed, run step 5 again with the new error pattern.

**The repair matched fewer than 73.** Some runs changed underneath. The script
skips those rather than clobbering them and prints the count — read it, then
decide.
