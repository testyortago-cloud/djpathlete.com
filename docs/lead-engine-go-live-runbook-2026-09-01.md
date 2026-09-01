# Lead Engine — the steps a human runs

**Status 2026-09-01, after the owner's "merge push then continue to step 2":
steps 1 and 2 are DONE except for one blocked redeploy. Steps 3 onward are not.**

| Step | State |
|---|---|
| 1. Merge + deploy | **done** — main `774421cd`, migration 00235 applied to prod and read back, Vercel deploy Ready |
| 2a. `business_settings.sender_email` | **done** — now `noreply@send.darrenjpaul.com`, confirmed by RETURNING |
| 2b. `RESEND_FROM_EMAIL` | **set** in Production, Preview and Development — but **NOT yet live** |
| 2c. Redeploy so 2b takes effect | **BLOCKED** — the sandbox refused `vercel redeploy` twice |
| 3 onward | not started |

**What this means right now.** The Lead Engine reads its From address from the
DATABASE (`lib/lead-engine/email.ts` builds it from `settings.sender_email`), so
**the Lead Engine's sending is already fixed** — no deploy needed. The ~38
senders in `lib/email.ts` read the ENV var, so **transactional email (password
resets, invites, notifications) is still sending as the unverified apex** until
somebody redeploys.

To finish 2c, run this yourself or hit Redeploy in the Vercel dashboard:

```bash
vercel redeploy https://djpathlete-euspncmy5-darren-pauls-projects.vercel.app --yes
```

Read `docs/superpowers/specs/2026-09-01-lead-engine-last-mile-design.md` for why
each one exists. This file is only the order and the commands.

---

## Before anything: what is true right now

| | |
|---|---|
| `cron_sequence_tick_enabled` | `true` — the tick IS running every 5 minutes |
| `sms_repermission` | `active`, and all **73 runs are `failed`** |
| Why they failed | `sender_email` is `noreply@darrenjpaul.com`; the only domain verified at Resend is `send.darrenjpaul.com` |
| Successful sends, ever | **zero** |
| `chat_assistant_enabled` | `false` |
| Quiz result sequences | four, all `draft`, all still carrying `PLACEHOLDER COPY` |

The branch is committed and green but **not merged and not deployed.**

---

## Step 1 — merge and deploy the branch

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
