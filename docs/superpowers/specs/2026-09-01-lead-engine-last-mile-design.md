# Lead Engine — the last mile

**Status:** design, approved in chat 2026-09-01
**Date:** 2026-09-01
**Branch:** `feat/lead-engine-last-mile`
**Supersedes:** the "What is not finished" tables in
`docs/lead-engine-status-2026-08-24.md` and `-evening.md`. Both are wrong in
five places as of today; the corrections are in §9.

Every count and every flag value in this document was read from production
(`epzuvzkokzqtzomeyoha`) on 2026-09-01, not quoted from those reports.

---

## 1. What this is

Six items were on the table. They are not one feature, and treating them as one
is why three status reports in a row have read as "almost done":

| Kind | Items |
|---|---|
| **One defect** | Email leaves the building. Nothing else is testable until it does. |
| **Two builds** | An athlete account when a deal is won. Closing out injury data / Airtable. |
| **Three release decisions** | The quiz result copy, the chat flip, the GoHighLevel cutover. These are the owner's; the spec defines the gate each passes through and stops there. |

The ordering is not a preference. Every remaining item is unverifiable while
sending is broken, because the only way to know a sequence works is to watch one
land.

---

## 2. The sending defect

### 2.1 What actually happened

On 2026-08-31 the sequence tick ran in production for the first time. Between
12:00:10 and 12:10:16 UTC it attempted all 73 `sms_repermission` runs and
**every one failed**:

```
last_error: sendSequenceEmail failed: The darrenjpaul.com domain is not
            verified. Please, add and verify your domain on
            https://resend.com/domains
```

State now: 73 `sequence_runs` at `status='failed'`, `attempts=1`,
`current_position=0`; 73 `sequence_messages` at `status='failed'`; zero
successful sends in the lifetime of the engine.

The immediate cause is a mismatch. `business_settings.sender_email` is
`noreply@darrenjpaul.com` — the apex. The Resend account has exactly one
verified domain, `send.darrenjpaul.com`, created 2026-05-07. The apex has never
been verified.

**Per the owner's decision, the address moves to the verified subdomain** rather
than the apex being verified: `business_settings.sender_email` and the
`RESEND_FROM_EMAIL` environment variable both become
`noreply@send.darrenjpaul.com`. This changes the From line every athlete sees,
which is accepted.

### 2.2 The preflight already exists, and it did not fire

This is the part that matters, and it is not about a domain.

`assertSendable` in [lib/lead-engine/email.ts:138](../../../lib/lead-engine/email.ts)
is a preflight built for precisely this failure. It runs at
[sequence-tick-runner.ts:617](../../../lib/automation/sequence-tick-runner.ts),
**before any run is claimed**, and the comment above the call says why in
as many words:

> an untouched install would send `from: " <>"`, be rejected by Resend, and land
> in processRun's catch — **permanently failing every claimed run with no admin
> surface and no re-activation path**. Nothing is claimed, so nothing can be
> failed.

That is an exact description of what happened on 31 August. The author saw it
coming, put the guard in the right place, and gave it the right rationale.

It did not fire because its predicate is *emptiness*:

```ts
if (!settings.sender_email?.trim()) missing.push("sender_email")
```

`noreply@darrenjpaul.com` is not empty. It is well-formed, plausible, and
unsendable — and no local string check can know that, because whether a domain
is verified is a fact held at the provider, not in this database.

**So the lesson is not "widen the predicate".** It is that a preflight over
local state cannot cover a provider-side fault, and the system therefore needs
to survive one. Today it does not: one provider-side misconfiguration
permanently destroyed 73 runs in ten minutes.

### 2.3 The fix: a configuration fault must not burn the run

The burn happens at
[sequence-tick-runner.ts:449-460](../../../lib/automation/sequence-tick-runner.ts).
Any throw from the provider call is treated as a per-recipient rejection:

```ts
await markFailed(messageId, message)
await failRun(run.id, message)
```

Terminal, deliberately, and the comment explains the trap it avoids: `recordSend`
will not re-claim a `sequence_messages` row in status `failed`, so a retried run
would deadlock on `send_in_progress` forever. Marking the run failed at the same
time at least keeps that visible rather than looping.

That reasoning is correct for a fault that belongs to the recipient — a mailbox
that does not exist will not exist on the retry either. It is wrong for a fault
that belongs to the **configuration**, which fails every run identically and
self-heals the instant the config changes.

**The distinction becomes explicit, and the default inverts.**

| Fault class | Examples | Handling |
|---|---|---|
| **Configuration** (default) | unverified domain, revoked key, suspended account, quota exhausted, rate limit, provider 5xx | The message row is left `queued`. The run is **deferred**, not failed. |
| **Recipient** | the provider names this address as invalid or refused | Unchanged: `markFailed` + `failRun`, terminal. |

The runner already owns a defer-with-backoff mechanism — `transientBackoffMs`,
5-minute base, doubling to a 60-minute ceiling, used by `runSequenceTick`'s
per-run catch. **The email send path simply never routes into it**, because its
own `try` swallows the throw and calls `markFailed` before the outer catch can
see it. So this is not a new mechanism either; it is the existing one, reached
from the one branch that bypasses it.

Two things make this safe without a single new state:

**The message row stays `queued`, and that is the truth.** Nothing was
delivered. `recordSend` already re-claims a row that is `queued` with a null
`provider_message_id` once it is older than `RECLAIM_WINDOW_MS`
([lib/db/sequences.ts:25](../../../lib/db/sequences.ts), 15 minutes) — its
crashed-attempt path. A configuration fault is indistinguishable from a crash
from the row's point of view, so the existing recovery applies with no change to
`recordSend`. The defer interval must therefore exceed 15 minutes; the existing
`transientBackoffMs` schedule (5 min base, doubling, 60 min ceiling) is raised to
a 20-minute floor for this class so the first retry cannot land inside the
reclaim window and bounce on `send_in_progress`.

**Retries stay bounded.** `MAX_ATTEMPTS` is 5. A configuration fault that is
never fixed costs five deferrals and then fails terminally, exactly as today —
so "default to configuration" cannot produce an infinite loop. It buys roughly
an hour of self-healing, which is the difference between an operator fixing a
DNS record and 73 people needing a database repair.

**Why the default inverts.** Today an unrecognised error burns the run. After
this change an unrecognised error costs five retries. Given the two failure
modes — retry something already dead, or permanently destroy a live campaign
because of a typo in one settings field — the first is plainly the cheaper
mistake, and it is bounded.

### 2.4 A silent defer is a worse bug than a loud failure

Deferring instead of failing removes the alarm along with the damage. If all 73
had quietly deferred on 31 August, nobody would have known either.

So a configuration fault is recorded where the existing watchdog already looks.
The tick summary gains a `config_faults` count, and **a tick that recorded one or
more configuration faults ends its `cron_runs` row as `failed`** — even when
other runs in the same batch sent successfully, because a batch that is half
blocked by a provider misconfiguration is not a healthy tick. The reason string
carries the count and the provider's own message, never `[object Object]` (§8).

`automation-health-scanner` already emails on `critical` and already lists this
cron, so a stuck engine surfaces in the daily 08:00 UTC watchdog rather than in a
status report a week later.

### 2.5 Recovering the 73

They cannot be re-enrolled. `enrolContactManually` refuses a contact whose run
already exists and is not active, returning `already_enrolled_once`
([lib/lead-engine/enroll.ts:201](../../../lib/lead-engine/enroll.ts)) — correct
behaviour that exists to stop a person being mailed the same sequence twice, and
it should not be weakened to serve a one-off repair.

`scripts/repair-failed-sequence-runs.mjs` (new, run by hand, `--dry-run` by
default) does the repair directly:

1. Select `sequence_runs` where `status='failed'` **and** the sequence key is the
   one named on the command line **and** `last_error` matches the given pattern.
   Three predicates, all required, so the script cannot widen to runs it was not
   pointed at.
2. Delete their `sequence_messages` rows. Deletion, not a status change, because
   `(run_id, step_id)` is uniquely indexed — the dead row is what would block the
   re-claim. Nothing was delivered, so no delivery history is lost.
3. Return the runs to `status='active'`, `attempts=0`, `current_position=0`,
   `last_error=null`, `next_run_at` per §2.6.
4. Write one `audit_logs` row for the batch and one
   `contact_timeline_events` row per contact, so the repair is visible on the
   timeline rather than being an invisible hand in the database.
5. Read back and print counts. A run that changed underneath the script is
   skipped, not clobbered — every update is guarded on `status='failed'`.

The script refuses to run against a host it was not explicitly pointed at, in the
manner of `scripts/configure-lead-engine-sms.mjs`, and carries the same header
invariant: **a session prepares it, a human runs it.**

### 2.6 The decision this spec does not make

Those 73 asks were due 2026-08-22 and are now ten days stale. Whether they go out
as-is or re-dated is the owner's call and always was. The script takes
`--next-run-at` explicitly and has no default, so it cannot be run without the
decision having been made.

---

## 3. Won → an athlete account

**Prompted, never automatic**, per the owner's decision: moving a card to Won
opens a step asking which program to grant. A Won card can mean a cash deal, a
camp, or a plan that has not been priced, and each grants something different —
so the safe reading of a dragged card is "ask", not "guess".

The machinery exists. `grantFunnelPurchase` →`grantProgramAccess` →
`assignProgram` → set-password email is the anonymous-checkout path in
[lib/funnels/checkout/](../../../lib/funnels/checkout/). This adds a second
caller, not a second implementation, and the grant rules stay in one place.

Two things the design settles:

**Idempotency needs a key, and there is no Stripe session.**
`funnel_checkout_grants` is keyed on `stripe_session_id`; a manual grant has
none. The key becomes `opportunity_id` — one card, one grant, forever. A
double-click, a card dragged out of Won and back, or two admins on the same card
cannot mint a second account or a second "set your password" email to someone who
has already set one. The column is nullable and mutually exclusive with
`stripe_session_id`; the table's existing "cannot check, therefore refuse"
posture is inherited unchanged.

**A payment-won card must not prompt.** An opportunity carrying
`source_session_id` reached Won through checkout and is already provisioned. The
prompt appears only where it cannot have been, so the two paths can never both
fire on one deal.

The prompt is a step on the existing pipeline board. `pipeline-move.ts` stays a
pure planner and gains nothing: provisioning is a consequence of the move, not
part of deciding it.

---

## 4. Injury data: Airtable is retired, not integrated

The GoHighLevel workflow pushed injury details to Airtable. **No Airtable
integration is built.** `docs/DJP-AI-Automation-Plan.md` sells this platform as
replacing Airtable outright ($480–$1,944/yr), and building a live sync would
keep alive the subscription the plan exists to cancel.

Most of the replacement is already true. Enquiry injury text lands in the app and
renders today — `LeadInquiryPanel` shows "Injuries / Limitations". What is
missing is the quiz half: the Athlete Quiz asks two injury questions (positions
50 and 65, the Rebuilder branch), and those answers do not reach the place a
coach looks for injury context.

Scope, therefore, is narrow and honest:

- Surface the quiz's injury answers alongside the enquiry text on the same panel.
- **They are scored multiple-choice, not narrative.** What a coach gets is "how
  recent" and "how confident the cause was addressed" as bands — not "left ACL,
  March, still swelling". The panel must present them as what they are; labelling
  a band as an injury history would be worse than showing nothing.
- A CSV export is the escape hatch if the old Airtable views are still in use. No
  live sync, no scheduled push, no credentials.

`lib/db/injuries.ts` is untouched. It is the *client* rehab tracker, keyed on a
real `user_id` with milestones, and deliberately does not extend to leads — a
lead has no user, and giving one a rehab record would put marketing data in a
clinical table.

---

## 5. The quiz result sequences: the gate, not the words

All four (`quiz_aspiring_pro`, `quiz_ceiling_breaker`, `quiz_parent_coach`,
`quiz_rebuilder`) are `draft`, one email each, and every body opens:

```
PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this
line is gone.
```

The words are the owner's to write. What this spec adds is a **mechanical gate**:
a test that fails if any sequence is `active` while its body still contains that
marker. Today the marker is an honour system, and an honour system is one SQL
`UPDATE` away from mailing placeholder text to a real athlete who has just been
told something personal about their body.

The gate belongs in the test suite rather than in the send path because it must
fail at build time, when someone can still fix it, rather than at 8am on a
Tuesday.

---

## 6. The chat assistant

Two steps, both small, and last in the order because this is the only item that
opens a new public surface rather than repairing one.

The in-flight work in the tree is committed (`4fb4adaf`) — the server-side
guarantee that a turn always leaves the visitor something to click, because the
model offers a consultation in prose and forgets the tool call. Verified green:
46 tests in `__tests__/api/ask.test.ts`.

Then `chat_assistant_enabled` → `true`. Every prerequisite is already met:
`CHAT_IP_SALT` is set in Vercel, the business identity is filled in, and legal v4
is live.

---

## 7. The cutover

Ordered, because three of these steps reach real people and two cannot be undone.

| # | Step | Reaches people? | Who |
|---|---|---|---|
| 1 | Deploy the code changes in §2.3, §2.4, §3, §4, §5 | No | Session |
| 2 | Move `sender_email` + `RESEND_FROM_EMAIL` to `send.darrenjpaul.com` | No | Human |
| 3 | Send one real email to a mailbox the owner controls, and read it | No | Human |
| 4 | Decide the dating of the 73 (§2.6) | — | Owner |
| 5 | Run `repair-failed-sequence-runs.mjs` | **Yes, on the next tick** | Human |
| 6 | Watch `sequence_messages` go `sent` | — | Either |
| 7 | Un-pause `newsletter_welcome` / `lead_magnet_delivery` | **Yes** | Owner |
| 8 | Write the four result emails; remove the marker; activate | **Yes** | Owner |
| 9 | Flip `chat_assistant_enabled` | Public surface | Owner |
| 10 | Run the new quiz alongside GoHighLevel; disable GHL workflows one at a time | **Yes** | Owner |

**Step 3 is not optional.** The engine has never successfully sent an email in
production. Until one arrives and is read by a human, "sending is fixed" is a
claim about code, not a fact about mail.

Step 10 stays parallel-run first. The GoHighLevel quiz still produces most leads,
and the app's own quiz has one completed attempt in its lifetime.

---

## 8. Deliberately not built

Recorded so nobody rebuilds them in three weeks believing they were forgotten.

- **An Airtable integration** (§4). The plan's economics are to cancel it.
- **Auto-provisioning on Won** (§3). Ruled out by the owner: a mis-dragged card
  would mail a stranger.
- **A local allowlist of verified sending domains.** Considered as a way to widen
  `assertSendable` — an env var naming the sendable domain, checked before the
  From address is built. Rejected: it duplicates state that lives at the provider
  and can only ever be a guess about it. It would not have caught a revoked key,
  an exhausted quota, or a suspended account, and a stale allowlist fails in both
  directions. §2.3 covers the whole class instead of one member of it.
- **Weakening `already_enrolled_once`** to let the 73 be re-enrolled (§2.5). That
  guard is the only thing standing between a repair and a double send.
- **`[object Object]` cron reasons, `lib/email.ts`'s silent success, soft 404s,
  the inert reconciler** (`contacts.user_id` is 0 of 168 on production). Real,
  still open, and out of scope here except where §2.4 touches the reason string
  on this one cron.

---

## 9. Corrections to the 24 August reports

1. **"There is no quiz on the live site" — wrong.** `/go/athlete-quiz` is a
   published funnel: 32 questions, 129 options, 4 branches, 4 tiers, 5 profiles,
   3 attempts, 1 completed.
2. **"A security gap on the deal records" — closed.** `00231_pipeline_rls.sql` is
   applied; all four pipeline tables have policies on production.
3. **"Texts cannot send" — obsolete.** `sms_messaging_service_sid` is set and the
   A2P campaign is `VERIFIED`.
4. **"Nothing has been sent" — obsolete, and worse than it read.** The engine did
   run, on 31 August, and destroyed 73 runs doing it.
5. **"The pipeline board is empty" — obsolete.** Two opportunities, one Won at
   $150.

---

## 10. Testing

Per house practice: targeted suites plus `tsc --noEmit` and a build. Not the full
suite (the baseline is 251 tsc errors and fifteen red tests inherited from
`main`; a falling count hides new errors as surely as a rising one).

| Unit | What must fail if it breaks |
|---|---|
| Fault classification | A configuration fault defers and leaves the row `queued`; a recipient fault still fails terminally. Each direction needs its own test — a single test that passes either way pins neither. |
| Defer floor | The first retry after a configuration fault lands **after** the 15-minute reclaim window, not inside it. |
| Bounded retry | Five configuration faults still end in a terminal failure. |
| Repair script | Its three predicates each independently prevent a match; a run that changes underneath it is skipped. Tested against a seeded clone, never production. |
| Grant idempotency | Two grants on one `opportunity_id` produce one account and one email. A payment-won card never prompts. |
| Placeholder gate | An `active` sequence whose body contains the marker fails the suite. |
| Quiz injury panel | The bands render as bands. An absence assertion needs a presence control beside it, or it passes when nothing rendered at all. |

**Every mutation must be run, not reasoned about.** Comment edits are not
mutations; the code has to physically change and the suite has to be seen going
red.
