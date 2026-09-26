# Lead Engine — gaps to ship

**Date:** 2026-09-19 · **Last re-measured against `main` + production:** 2026-09-21 18:00 UTC (`main` @ `7727bc70`) — see [Finished vs not](#finished-vs-not--the-one-screen-answer) · **Source of every gap:** `docs/lead-engine-verification-2026-09-19.md` (measured on production and on `main` @ `10fef0f0`) · **Quotation:** Full Engine, white-label ready.

This is the build ledger. One row per gap, in the order to build. Each row says what the quotation promised, what exists today, what "shipped" means, where the code lives, the test that proves it, a size, and any decision only the owner can make. Sizes: **S** under half a day · **M** one to two days · **L** three to five days · **XL** a week or more.

**Rules for whoever builds from this**
- One branch per gap (or per phase for the S items). Done means: acceptance met, the named test fails on `main` and passes on the branch, `tsc` at the 238/54 baseline with an identical per-file set, `npm run build` exit 0, a whole-branch review, committed. **Nothing is pushed, merged to `main`, or run against production without the owner's word.**
- Read `CLAUDE.md` (white-label rules, tables, sequence management) and the top five `JOURNAL.md` entries first. Re-measure production before trusting any count here — it moves.
- Every new column named below has its reader named next to it. Do not add one without.
- Migrations: **`00275_revoke_anon_security_definer_rpcs.sql` is the highest on `main` (merged + applied to production) as of 2026-09-21. The next free number is `00276`, and it must be re-checked immediately before merging** — a number is only visibly taken if you look in every worktree, and git merges two colliding numbers perfectly cleanly. **This line said `00273` until 2026-09-21 18:00, by which point 00273, 00274 and 00275 were all merged — it was instructing the next builder into exactly the collision the sentence warns about. Re-measure it (`git ls-tree --name-only main supabase/migrations/ | tail -1`), never read it off this paragraph.** Four worktrees still hold unmerged commits (`content-scheduling`, `funnel-step-roles`, `native-booking-research`, `reconcile-cron-description`); check them. Tolerate the old schema for one deploy. Apply to the dev clone.
  - **`apply-migrations.yml` is PATH-FILTERED, which is why a code-only push is safe.** The 2026-09-21 push of four gaps carried no migration file, and that workflow's last run is still on `74ea3f43`. Before any push to `main`, count them: `git diff --name-only origin/main..HEAD | grep -c supabase/migrations/`. It is the difference between a code deploy and a schema change.

---

## Phase 0 — Stop what is hurting a real customer today

### G01 · Renewal payment links enrol an existing client in *abandoned checkout* · **S** · LIVE DEFECT
- **BUILT 2026-09-20** on branch `worktree-renewal-expiry-abandoned-checkout` (worktree `.claude/worktrees/renewal-expiry-abandoned-checkout`), **merged to `main` and pushed 2026-09-19 16:33 UTC; migration 00263 applied on production 16:34 UTC**. Reviewed; tsc 238/55; build exit 0; migration `00263` applied to the dev clone. The refusal is written as a timeline row `enrolment_skipped` with `reason: "cooldown"` (not the `already_enrolled_recently` name below); the edit surface is `PATCH /api/admin/sequences/[key]/settings`.
- **Today:** `lib/automation/pack-link-resend.ts` mints a `session_pack` Checkout session daily; each expiry hits `checkout.session.expired` in `app/api/stripe/webhook/route.ts:403-495`, which counts `session_pack` as a coaching checkout, captures `checkout_abandoned` and enrols `abandoned_checkout`. Nothing blocks re-enrolment after a run completes. One account holder has had seven emails in five days.
- **Shipped when:** an expired session whose `metadata.type === "session_pack"` (every one is minted for an existing client — `createPackCheckoutSession` requires `clientUserId`, `lib/stripe.ts:618-628`) never writes `checkout_abandoned` and never enrols; `handleSessionPackExpired` still reaps the unpaid pack. Add `session_pack` to the expired-path exclusion set (a separate constant from `NON_COACHING_CHECKOUT_TYPES`, whose comment argues the opposite for the *completed* path — leave that path alone).
- **Also ship:** a re-enrolment cooldown. New column `sequences.reenrol_cooldown_days smallint NOT NULL DEFAULT 30` (reader: `enrollIfTriggered`, `lib/lead-engine/enroll.ts:100-118`); refuse with `already_enrolled_recently` when the same contact has a run of the same sequence that completed or exited inside the window, and write a timeline row. Seed `0` for the four `quiz_*` sequences so a retake still gets its result email. Editable on `/admin/sequences/[key]`.
- **Test:** `__tests__/api/stripe/webhook-abandoned-checkout-purchase-guard.test.ts` — expired `session_pack` event → no timeline row, no `sequence_runs` insert, pack reaped. `enroll.test.ts` — completed run 3 days ago → refused; 31 days ago → enrolled; quiz sequence with cooldown 0 → enrolled. Mutate the guard and watch both fail.

### G02 · Repair the affected contact · **S** · owner runs it
- **SCRIPT BUILT 2026-09-20** (same branch): `scripts/exit-sequence-run.mjs`, rehearsed on the dev clone (dry run, then `--apply --remove-tag`, read back). **Run on production by the owner 2026-09-19 16:48 UTC** — read back: run `exited / manual`, claim cleared, `abandoned-checkout` tag removed, timeline note and audit row present, 0 active `abandoned_checkout` runs remain. **G02 closed.**
- Exit that contact's active `abandoned_checkout` run (reason `manual`), remove the `abandoned-checkout` tag (contact detail page has the tag UI), leave a timeline note. If the reporting page has no per-run exit action, add `scripts/exit-sequence-run.mjs <run_id> --reason manual --dry-run` (read back after). Then confirm no new `checkout_abandoned` row appears at 09:00 UTC the next day.

### G03 · Sequence copy is live and unreviewed · **owner, no code** · CLOSED
- Migrations `00253`/`00255` say "DRAFTED, not authored by Darren". All 12 sequences went ON on 9 Sept. Owner reads each on `/admin/sequences/<key>` and edits in place (no deploy). Until then, `abandoned_checkout`, `service_application_received`, `camp_clinic_deadline`, `newsletter_welcome`, `lead_magnet_delivery`, `cold_lead_re_engagement` are sending draft wording.
- **CLOSED 2026-09-20 — owner reviewed and approved the copy AS SEEDED, unchanged.** Sign-off covers **all 12 active sequences**, not only the six this row named: confirmed explicitly, because the row's list is a subset. Measured on production read-only at the moment of sign-off: 12 sequences, all `active`, **35 emails + 5 texts**, and **not one step has ever been hand-edited** — every `sequence_steps.updated_at` is a bulk migration timestamp (`2026-08-21`, `2026-08-31`, `2026-09-08 04:29:45`), identical to the microsecond across many rows, which is a migration and not a person.
  - **What "approved" means here, precisely:** the wording migrations `00253` and `00255` describe in their own headers as "DRAFTED, not authored by Darren" is now the owner's, adopted as written. It was NOT rewritten. A future reader must not mistake this row's closure for "a human authored the copy" — it means a human read it and kept it.
  - **This row's list of six was wrong, in both directions.** It named `newsletter_welcome`, `lead_magnet_delivery` and `cold_lead_re_engagement` (seeded earlier, last touched 2026-08-21) and omitted the four `quiz_*` sequences — which migration `00253` flags as DRAFTED in its own right — plus `new_lead_nurture` and `sms_repermission`. The true figure was 12, never six. The "eight" quoted in the 2026-09-20 session handoff was wrong too, and came from the handoff rather than from this row.
  - Nothing to deploy: sequence copy is edited in place on `/admin/sequences/<key>` and reads from the database, so no branch, no migration and no build is involved in this row.

---

## Phase 1 — Make the data truthful (the branches and boards already built depend on it)

### G04 · `contacts.user_id` has no writer · **M**
- **Today:** 0/170 linked, 55/170 match a `users` row by email. `has_user` ("already a client") is permanently false in all four quiz sequences; `findContactByIdentifiers({userId})` never matches on its first key.
- **Shipped when:** (1) `upsertContactIdentity` (`lib/db/contacts.ts:259-330`) sets `user_id` fill-only on create and update when `input.userId` is given or a `users` row matches the normalised email; (2) `app/api/auth/register` links an existing contact by email at signup; (3) the Stripe completed path passes `session.metadata.userId` / `clientUserId` through; (4) a data migration backfills by lower-cased email, **keyed on the email value, read back on production after apply** (a data migration can succeed and match nothing).
- **Test:** `contacts-record-event.test.ts` — create with matching user → linked; update never overwrites a non-null link. `sequence-tick.test.ts` — `has_user` true for a linked contact. Production read-back: `select count(*) from contacts where user_id is not null` ≥ 55.
- **BUILT 2026-09-20** on branch `worktree-g04-contact-user-link` (worktree `.claude/worktrees/g04-contact-user-link`), commit `e27ccd9c` off `main@cf4dcff5`. **MERGED, PUSHED and DEPLOYED 2026-09-20; migration `00264` applied on production by the workflow — read back: 170 contacts, 43 linked, 0 still linkable.** Two review rounds; tsc 238/54 with a per-file set identical to main; build exit 0; 148 test files / 1463 tests green; ten mutants killed. Migration `00264` applied to the dev clone and read back (0 rows left linkable).
  - Corrections to this row, measured read-only on production 2026-09-20: it is **54** contacts sharing an email with a `users` row, not 55 — the obvious join reports 55 because one address matches two `users` rows differing only by case. After excluding `lead` placeholders the backfill links **43**, so the read-back above should expect **43**, not "≥ 55".
  - Deviation, deliberate: the Stripe path does **not** pass `clientUserId` (only `userId` / `billingUserId`). A parent paying for a child would otherwise link the parent's contact to the child's account. **Owner to confirm.**
  - Widened beyond this row: `/api/admin/clients` and `/api/public/invite/[token]/claim` also link now. They are the other two doors that mint a `users` row, and the backfill runs once — leaving either out means the column starts drifting stale the day after.
  - `sequence-tick.test.ts` was NOT the right home for the `has_user` test: `evaluateBranch` was never broken, and its existing test already covers it. The real gap was that nothing pinned `loadRunContext` SELECTing `user_id` — the fake there is select-string-blind. Test added to `__tests__/db/sequences.test.ts` instead.
  - Noted, not fixed: `lib/db/contact-detail.ts` reads `payments` by `user_id` with no tenant predicate and cannot have one (`payments` has no `business_id`). This row is what takes that branch from dead to live. Harmless at one tenant — belongs in the SaaS direction spec.

### G05 · A first-time buyer gets a contact but no Won card · **S**
- **Today:** `app/api/stripe/webhook/route.ts:284-345` — the pipeline hook runs first and only for a pre-existing contact; `tryCaptureLeadFromCheckout` creates the contact afterwards. The 28 Aug purchase proves it.
- **Shipped when:** capture runs first and returns the contact id + business; the exit and pipeline hook use that id. Tenant for a first-time payer stays `platformBusinessId()` (inventory comment updated).
- **Test:** `pipeline-hooks.test.ts` — completed checkout with no prior contact → contact row AND a Won card with `value_cents`.
- **BUILT 2026-09-20** on branch `worktree-g05-first-buyer-won-card`, commit `4613a380` off `main@e27ccd9c`. **MERGED and DEPLOYED 2026-09-20.** Reviewed (no Critical; one Important fixed, below); 101 test files / 1449 tests green; tsc 238/54 with a per-file set identical to main; build exit 0; seven mutants killed.
  - Beyond the row as written: the lookup and the capture can name DIFFERENT contacts (the lookup matches `user_id` first, the capture matches email/phone), which happens when someone changes their account email. The card goes on the captured row, but **both** rows get their sequences exited — otherwise a paying customer keeps being told they have not signed up yet. Unreachable today (0 of the 43 linked contacts have a mismatched email) and pinned by a test.
  - Ordering hazard, named in the code: exiting after the capture would kill a run the capture had just enrolled. It cannot today — no sequence triggers on `purchase`/`shop`/`funnel_checkout`, verified against production, and the two null-trigger sequences cannot match because enrolment filters with `.eq`. A sequence that DID trigger on a completed checkout would make this ordering wrong.
  - **Expect more Won cards.** Not limited to first-time coaching buyers: every payer who previously had no contact row now mints a card — week access, memberships, session-pack renewals, anonymous funnel and Payment Link purchases. Intended, but it will show as a step-up in board volume.

### Note carried by G04 and G05 — this ledger is not in the repo
Three code comments and two commit messages cite `docs/lead-engine-gaps-to-ship-2026-09-19.md`, but it and `docs/lead-engine-verification-2026-09-19.md` are **untracked**, so a future reader cannot open what those comments defer to. Owner's call whether to commit them.

### G06 · `contacts.timezone` is never written · **S**
- **Today:** 0/170; every contact runs on the business timezone.
- **Shipped when:** funnel, quiz, inquiry, newsletter and chat-capture forms send `timezone` (`Intl.DateTimeFormat().resolvedOptions().timeZone`), validators accept an IANA string, contacts store it fill-only; Calendly ingest backfills from `bookings.invitee_timezone`.
- **Test:** `guardrails.test.ts` — a `Pacific/Auckland` contact at 07:30 local is deferred while the business clock reads mid-morning. Route tests assert the column is written.
- **BUILT 2026-09-20** on branch `worktree-g06-contact-timezone`, commit `ed347bb5` off `main@e27ccd9c`. **MERGED and DEPLOYED 2026-09-20.** Two review rounds; 979 test files / 10330 tests green; tsc 238/54 identical to main; build exit 0; **16 mutants, 16 killed, no survivors**.
  - **EIGHT surfaces, not five.** Review found `/api/contact`, `/api/shop/leads` and `/api/events/[id]/signup` also reach `captureLead` from a browser. Leaving them out would have left a third of the front doors on the coach's clock while this row read "done".
  - The shared Zod field REJECTED an explicit `timezone: null` (`.optional()` accepts a missing key, not a null one) — a 400 on the whole submission, with an error naming a different field, which is the exact failure its leniency exists to prevent. Now `.nullish()`.
  - The merge rule had **no test**: deleting it left every suite green. Three tests now cover it.
  - `merge_contacts` does NOT move `timezone` (verified in 00217/00238), unlike `user_id` — so the survivor's own value stands, and the loser's is rescued only when nothing else is available.
  - Calendly backfills from the invitee's zone; the call is in its OWN try, AFTER the sequence exit and pipeline hook, because written one line higher it would have cost a paying customer their exit and their Won card. Three webhook suites caught that.
  - GHL bookings do NOT backfill — `app/api/webhooks/ghl-booking` hardcodes `inviteeTimezone: null`. Worth its own row.
  - The contact detail screen now SHOWS the zone. It is fill-only forever, so a lead on a VPN reporting UTC is pinned to UTC and gets 4am sends — invisible unless someone can read the value.

### G07 · Legacy newsletter unsubscribe never reaches the engine · **S**
- **Today:** `app/api/newsletter/unsubscribe/route.ts` sets `newsletter_subscribers.unsubscribed_at` only.
- **Shipped when:** it also writes `contact_consents {channel:email, granted:false}` and `suppress(email,"unsubscribed")` when a contact exists, and exits their runs — the same three writes the token route makes (`lib/lead-engine/unsubscribe.ts:82-96`).
- **Test:** route test asserting all three writes.
- **BUILT 2026-09-20** on branch `worktree-g07-g08-unsubscribe-and-proxy`, commit `46c8b236` off `main@e27ccd9c`. **MERGED and DEPLOYED 2026-09-20.** Whole suite 1036 files / 10801 tests green; tsc 238/54; build exit 0; 6 mutants killed.
  - Implemented by EXTRACTING `processUnsubscribe`'s body into `revokeEmailConsentForContact` and calling it from both surfaces — that file's header already warned that two copies of a revocation flow is how one surface suppresses while the other only exits a run.
  - **The stage1b design (decision 6) rejected this in writing**: "anyone can unsubscribe anyone". Accepted rather than dismissed — the route is now rate-limited per IP, the consent row records IP + user agent, and that decision is amended in place so the doc and the code agree.
  - The admin timeline's `unsubscribed` arm asserted "They used the link at the bottom of an email" for every row. False once the form writes them, on the screen a coach reads to answer a complaint. It now reads `row.source`.

### G08 · `POST /api/ghl/contact` is an unauthenticated public proxy · **S**
- No caller anywhere. Delete the route and its GHL helper import. Test: the path 404s.
- **BUILT 2026-09-20**, same branch/commit as G07. **Widened: `POST /api/ghl/webhook` is deleted too.** It was the G08 test's presence control, and turned out strictly worse than the row's own target — the CALLER supplies the URL the server POSTs arbitrary JSON to, with no allowlist, so it reaches internal addresses on request. Unauthenticated, zero callers, no tests, outside the proxy matcher, and named in the same audit line. The whole `app/api/ghl` folder is gone.

---

## Phase 2 — The quoted behaviours that are not built

### G09 · Email opens are not tracked; no "opened the last email" branch · **M**
- **Shipped when:** `app/api/webhooks/resend/route.ts` verifies Resend's Svix signature and, keyed on `provider_message_id`, writes `sequence_messages.delivered_at / opened_at / clicked_at` (columns exist, `00216:133`, no writer today) and marks hard bounces `failed`; new branch condition `{kind:"opened_last_email"}` in `lib/validators/sequence-admin.ts`, `lib/automation/sequence-tick.ts:76-99` and the step editor, true when the most recent sent email in this run has `opened_at`. Owner adds the webhook URL in Resend (outward action, owner does it).
- **Decision:** does a hard bounce suppress the address? Recommend yes (`reason: bounced`).
- **Test:** signed payload updates the row; unsigned → 403; condition true/false; a bounce suppresses.
- **BUILT + MERGED 2026-09-20**, commit `816892cf`, pushed. No migration — the columns exist since 00216, `provider_message_id` is already stamped by `markSent`, and the status CHECK already permits `delivered`/`failed` (checked against production's `pg_constraint`). Whole suite 1040 files / 10890 tests; tsc 238/54; build exit 0; **22 mutants, 22 killed**.
  - **FULLY LIVE 2026-09-20.** All three operator steps done and verified from the Resend API rather than the dashboard: webhook `https://www.darrenjpaul.com/api/webhooks/resend` enabled on the four events; `RESEND_WEBHOOK_SECRET` set in production and redeployed; `open_tracking` and `click_tracking` both true with `send.darrenjpaul.com` fully `verified` (DKIM, MX, SPF and the `links.send` CNAME).
    - Proven end to end against production: a forged signature → **403**, a delivery signed with the real secret → **200** with `unknown_message` (and no write, because the probe used an id no row carries). That pair is the proof — a 403 alone only shows *a* secret is set, not the right one.
    - **www, NOT the apex.** `darrenjpaul.com/api/webhooks/resend` answers **307** to `www`; only the `www` host serves the route. A webhook must never be pointed at a redirect.
    - Historical sends do NOT backfill — webhooks only fire for events after registration, so the four pre-existing `sent` rows stay null forever. First real data arrives with the next sequence email.
    - **That data arrived 2026-09-21 12:00 UTC and the whole path is confirmed live**: of the 73-email re-permission batch, 67 wrote `delivered_at`, 23 wrote `opened_at`, 2 wrote `clicked_at`, and the bounce arm wrote 2 `contact_suppressions` rows. The row is no longer inferred from a signed probe — it is measured on real traffic.
  - **TWO predicates ship, not one.** `clicked_last_email` as well as the quoted `opened_last_email`, because an open is a tracking pixel that Apple Mail Privacy Protection pre-fetches whether or not a human looks. `opened_last_email` over-counts permanently, on the largest slice of a consumer list. The editor lists `clicked` first and prints the caveat under `opened`.
  - **The decision this row asked for:** a hard bounce DOES suppress — but only `Permanent`. Review caught that the first cut suppressed every bounce including `Transient`: a full mailbox or an autoresponder would have permanently ejected a live lead, with no admin screen to undo it. `Undetermined` does not suppress either.
  - **`email.complained` does NOT suppress**, deliberately, and it reads oddly next to a bounce that does — a complaint is a stronger stop signal. It wants its own row: probably revoke consent and exit runs.
  - Two review findings were the feature being wrong, not thin: the bounce type above, and `lastEmail` reading a never-sent row because `order=sent_at.desc` is NULLS FIRST in Postgres while `markFailed` writes no `sent_at` — 73 of production's 77 email rows are exactly that shape. **And the test fake ordered nulls the opposite way to Postgres**, so the regression test would have passed either way; the fake was fixed first.

### G10 · No way to branch on coaching-vs-camp or parent-vs-adult · **M**
- **Today:** `source_is` reads the run's own sequence trigger, identical for everyone in that sequence.
- **Shipped when:** `sequence_runs.enrolment_metadata jsonb NOT NULL DEFAULT '{}'` (reader: `evaluateBranch` and the merge-field renderer in G16) written by `enrollIfTriggered` from an allow-list of event keys (`service`, `role`, `event_kind`, `branch`, `tier`, `quiz_key`, `camp_name`) — never the raw payload; new condition `{kind:"enrolled_metadata_is", key, value}`; the inquiry route puts `service` in event metadata (`app/api/inquiry/route.ts:158-170` passes none today); funnel and quiz submits carry the role-tagged `role` field (`parent` | `athlete`); event signups carry the event's kind (verify the `events` column name before writing it).
- **Test:** enrol with `{service:"camp"}` → condition true; editor round-trips the condition; runs never store an email or phone in the column.
- **BUILT 2026-09-20** on branch `worktree-g10-enrolment-metadata`, off `main@816892cf`, and **MERGED into `main` 2026-09-20** at `14294225` (owner gave the merge word; local only, **NOT pushed, migration 00266 STILL NOT applied to production** — dev clone only, read back). Branch and worktree swept after merge.
  - **The merge had one conflict, in `components/admin/sequences/StepEditor.tsx`**, against session e5's `worktree-branch-predicate-unselectable` (`87b65ede`), which fixed the same G09 bug independently and was merged first at `a08b4690`. Resolved toward e5's exhaustive-`switch`-with-`never` version, with G10's `enrolled_metadata_is` arm moved into `conditionForKind`. A seventh predicate exists today, so the comment's "a sixth predicate is a build failure" was corrected to "an eighth".
  - **The merge also closed a hole BOTH branches had:** nothing pinned which key the rule OPENS on. The answer box starts blank and `validateStepList` only refuses a BLANK answer, so a coach who never touches the key picker ships whatever the default is — `role == "camp"` saves exactly as happily as `service == "camp"` and is false for everybody. Mutating the default from `service` to `role` survived all 29 tests; a named test now fails on it. One review round by a read-only agent: one Critical and six Important, all fixed (below). Whole suite 1045 files / 10955 tests with the 7-test red baseline unchanged; tsc 238/54 with a per-file set identical to main; build exit 0; **50 mutants, 50 killed**.
  - **The migration is `00266`, not `00265`.** A peer session had already committed `00265_media_thumbnails.sql` on `worktree-media-thumbnails-and-insights` (`5d452e69`) and applied it to dev. git merges two colliding numbers perfectly cleanly, so this was caught by looking rather than by the tooling. Resolved by agreement between the sessions; **whoever merges next must re-check the numbering immediately before merging**, because a third worktree appearing invalidates the arrangement.
  - Applied to the dev clone and read back (`jsonb`, `NOT NULL`, `DEFAULT '{}'::jsonb`). `claim_sequence_runs` needed **no change**: it is `RETURNS SETOF public.sequence_runs ... RETURNING r.*`. Proven rather than assumed, by materialising the function's result shape into a temp table with a business id matching nothing — full column list back, `rows_claimed = 0`, no row touched.
  - **The allow-list is key-based AND value-based, and the second half is not optional.** On the funnel path the event metadata bag is the visitor's whole typed payload, and funnel field names are owner-chosen with the charset `^[a-z][a-z0-9_]{0,39}$` — so an owner can legally name a field `service` or `camp_name`. `pickEnrolmentMetadata` therefore also requires a scalar, trims, caps at 120 chars, and refuses anything email- or phone-shaped. The phone rule is **per key**: strict (a 7+ digit run anywhere) for the six machine-written token keys, loose (nothing but digits) for `camp_name`, which is a free title where "Summer Camp 2026-2027" is ordinary. Review caught that a single all-digits rule stored `camp - best on 0412 345 678 after 6pm` verbatim.
  - **`role` is recorded only by a front door that ASKS.** Review's Critical: the first cut derived it from the Athlete Quiz's `parent_coach` branch key but ran for every quiz, so every taker of the Rotational Performance Index — whose branches are sports — was stamped `role: "athlete"`. A parent taking it for their child would have gone down the "write to the athlete" arm. `lib/quizzes/submitter-role.ts` now owns the key, returns `null` when the quiz has no such branch, and the seed imports the constant so the two cannot drift; a test pins the seed still carries it.
  - **A coach is recorded as `parent`.** The quiz offers "a parent or coach" as one answer, so what `role` really separates is the athlete themselves from anyone acting on an athlete's behalf. The editor hint says exactly that, rather than leaving a coach to find out.
  - **Widened, deliberately: a live defect G09 shipped, in the same function this row had to edit.** `setConditionKind` had no arm for `clicked_last_email` or `opened_last_email`, so both render in the dropdown, label correctly, and CLEAR the condition on selection — the coach then gets "This split does not say which people go down each side" against the rule they just picked, and cannot save it. Live on production since `816892cf`. Fixed here; a test now walks the rendered dropdown's own options and asserts each selection sticks. **Session `djpathlete-e5` is also shipping this fix on a one-file branch off `main`** — agreed that whoever merges second resolves `StepEditor.tsx` toward its exhaustive-switch version and adds the one arm for `enrolled_metadata_is`.
  - The event CHECKOUT route deliberately does **not** pass `signup_type`: `camp_clinic_deadline` filters on it, so adding one would chase people who have already paid. Pinned by a test.
  - No producer change can alter which sequences a contact enrols into — `filterMatches` iterates the FILTER's entries, so a new key is invisible to a filter that does not name it, and no key was removed anywhere. Checked against each live `trigger_filter`.
  - **Known and NOT fixed:** a funnel that sells a camp through its own "Register & pay" step records no `event_kind` / `camp_name`, because the capture runs before the event is resolved. Latent only — that path is behind `FUNNEL_CHECKOUT_DEFAULT = false`. The fix is a reordering in a route where ordering has already cost a paying customer their exit once (G06), so it wants its own row rather than a late edit here.

### G11 · Camp deadline is enrolment-relative, not "14/7/3/1 days before the event" · **M**
- **Shipped when:** `sequence_runs.anchor_at timestamptz` (reader: the tick's wait handling) set from `events.start_date` at enrolment for `event_signup`; a `wait` step accepts `config.wait_until = {days_before_anchor: N}`; the tick sets `next_run_at = anchor − N days`, advances straight past a step whose moment has passed, and skips the whole run when no anchor exists; `camp_clinic_deadline` reseeded to 14 → 7 → 3 → 1 with the owner's copy, ON only after G03.
- **Test:** enrol 20 days out → next at −14 d; enrol 5 days out → first two steps skipped, next at −3 d; no anchor → run completes without sending.
- **BUILT + MERGED + PUSHED 2026-09-20**, commit `55d6beb4`, merged at `37bc5135`, `origin/main` now `37bc5135`. Migrations **00267** (`sequence_runs.anchor_at`), **00268** (widens `sequence_steps_wait_needs_minutes` so an anchored wait may carry no minutes), **00269** (re-times `camp_clinic_deadline`), **00270** (its description, which had come to say the opposite of what it does). All four applied to the **DEV CLONE ONLY** and read back — **NOT on production**. Whole suite 1053 files / **11096 tests** with the 7-test red baseline; tsc 238/54 per-file identical; build exit 0; **35 mutants across two sweeps, 35 killed**.
  - **THE ROW'S OWN TEST SKETCH WAS WRONG IN TWO PLACES, and reading the data settled both.** (1) It reads as four countdown reminders at 14/7/3/1. It is not: step 0 is the ACKNOWLEDGEMENT — *"Thanks for putting your name down. Your place isn't held yet"* — so a 14-day wait in front of it leaves somebody who registers interest four months out hearing nothing for three and a half months, having just been told their place is not held. Step 0 stays immediate and the three CHASERS became the countdown, at 14/7/3. (2) "Advances straight past a step whose moment has passed" would SEND "two weeks to go" five days before the camp; the row's own next clause ("first two steps skipped") says the opposite. Built to the second reading.
  - **THE QUOTATION'S FOURTH MOMENT (1 day before) HAS NO EMAIL.** Four emails exist and one is the acknowledgement, so there are three chasers for four named moments. No copy was invented — G03 signed off what exists. **Owner decision: write a fourth chaser, or accept 14/7/3.**
  - **A passed moment takes its whole block with it.** Review found the first cut sent the stale reminder anyway whenever a `tag` (or `branch`, `stage`, `alert`) sat between the wait and the email it gated: the scan stopped at the tag, the runner applied it and advanced one position, and the next tick sent it. Now only a `wait` or a `stop` ends the skip, so a post-event follow-up on ordinary `wait_minutes` still survives a late signup.
  - **A run with no anchor EXITS `not_anchored`, it does not complete.** A completed run arms G01's 30-day re-enrolment cooldown, so completing here would refuse that person's REAL camp signup a week later — a coach hand-enrols a parent on the 1st, the run ends the same day, and their actual signup on the 8th is turned away. The cooldown now forgives the reason, as it already forgives `failed`. Both exit-reason inventories updated.
  - **The anchor is a typed argument, never a `metadata` key.** On the funnel path that bag is the visitor's ENTIRE typed payload and funnel field names are owner-chosen (`^[a-z][a-z0-9_]{0,39}$`), so a field named `event_start_date` would let a stranger decide when mail is sent. `pickEnrolmentMetadata`'s allow-list would have stopped it being STORED; it would not have stopped it being USED.
  - **The editor warns rather than refuses** when the sequence is not started by an event signup — no run of `newsletter_welcome` can ever carry an anchor, so an anchored wait there ends every run. A warning, not a block, because the coach may be about to change what starts the sequence.
  - **Two limitations recorded, not fixed.** (a) The anchor is read ONCE, at the wait; nothing re-checks it at the send, so `siblingRunDefer` (unbounded, 5 minutes at a time), the daily cap or a cron outage can still shift a reminder off its promised moment. (b) Anchored runs now live months rather than days, which makes `sequence_runs_one_active_per_sequence` refuse a SECOND camp's follow-up while the first is still counting down, and makes G14 refuse non-superseding sources for that whole period.

### G12 · No coach reminder two days after a service application; applicant confirmed twice · **S**
- **Shipped when:** `service_application_received` = `wait 2880` → `alert` (to `business_settings.reply_to`: "No reply yet to {{name}}'s application", link to the contact) → the existing lead-facing nudges; step 0 removed because `sendInquiryAutoReply` already confirms instantly. Exits on booking/purchase already mean the alert only fires when nothing happened. Confirm in `sequence-tick-runner.ts:~591` that an `alert` does not count against the contact's daily cap.
- **Decision:** owner approves the alert wording.
- **Test:** `00255`-style seed test for the new shape; runner test that an alert emails `reply_to` and does not consume the cap.
- **BUILT + MERGED + PUSHED 2026-09-20**, commit `672e5583`, merged at `80c9ecbd`. Migration **00271** applied to the dev clone AND to **production** (by `apply-migrations.yml` on push) and read back: `wait 2880 / alert / email / wait 5760 / email / stop`, both nudge emails' wording untouched.
  - **The cap question is answered in BOTH directions, and they are different questions.** `decideStep` returns `{kind:"alert"}` before `sendGuardrailDefer` is consulted, so an alert is never held by the daily cap, quiet hours or a sibling run — the cap protects the LEAD, and this is a message to the coach. It also never CONSUMES the cap: the alert arm calls `sendSequenceEmail` directly with no `recordSend`, so it writes no `sequence_messages` row and cannot eat the lead's own allowance for that day.
  - **The alert had to learn who it was about.** The runner passed `contactName: null`, and `substituteName` replaces `{{name}}` with the empty string — so this row's own proposed wording, "No reply yet to {{name}}'s application", would have arrived as "No reply yet to 's application". It now passes `ctx.contact.name`: in an alert `{{name}}` means the person it CONCERNS, not the recipient.
  - **The subject is a QUESTION, not an assertion, and that is the row's real product finding.** Nothing in this system exits a run because the coach REPLIED — there is no such exit reason (`sequence-exit-reasons.ts` enumerates every one that can reach the database) and nothing reads the coach's inbox. "No reply yet" would therefore be false in exactly the case a diligent coach creates most often, which is how an alert channel gets trained into noise. Shipped as "{{name}} applied two days ago — have you replied?", with the body saying outright that we cannot see their inbox. **Owner may still reword it in the editor; no deploy needed.**
  - **No `{{contact_url}}`.** The renderer knows only `{{name}}`, `{{unsubscribe_url}}` and `{{sms_consent_url}}`, and hard-coding a domain into seeded copy is the white-label problem this repo is walking away from. A merge field for it is a separate, small decision.
  - **In-flight runs are moved with their steps** — the review finding with teeth. `sequence_runs.current_position` names the NEXT step, and every run sits at position 1 for one tick after its acknowledgement email, which is where the ALERT now lives: an untouched run would have told the coach "they applied two days ago" minutes after the application arrived. Runs on the deleted step exit `sequence_edited` (the reason the editor itself writes); runs on the wait are repointed. Measured before and after: **zero runs of this sequence have ever existed**, so nothing was actually moved.
  - Migration guards: refuses to delete a step that has ever sent a message (`sequence_messages_step_id_fkey` cascades); renumbers through a +1000 range because `(sequence_id, position)` is unique; SKIPS rather than fails a tenant whose copy is a shape it does not recognise; raises when NOTHING matched; and checks positions are CONTIGUOUS 0..5, because a dropped renumber leaves a step stranded at 1004 where the count is still six and `decideStep` silently completes the run.
  - Whole suite 1054 files / **11140 tests** with the 7-test red baseline; tsc 238/54 per-file identical; build exit 0; **16 mutants across two sweeps, 16 killed**.

### G13 · Sequence status is not on any leads list · **M** · DONE (merged + pushed 2026-09-21)
- **Shipped when:** `lib/db/contacts-list.ts` joins each contact's latest run (active first) and `ContactsTable.tsx` renders a **Follow-up** column ("New Lead Nurture · step 3 of 8", "Bought", "Booked a call", "Opted out", "—") using `DataTableBadge`; the funnel leads board (`components/admin/funnels/LeadsBoard.tsx`, `lib/db/funnel-leads.ts`) shows the same by contact id; a filter "in a sequence".
- **Test:** `contacts-table.test.tsx` renders each state; the DAL test pins the latest-run selection (active beats exited beats completed).
- **BUILT + MERGED + PUSHED 2026-09-21**, commit `1f8f16a6`, merged at `c93447e7`. No migration. New files: `lib/lead-engine/sequence-status.ts` (pure labeller), `lib/db/contact-sequence-status.ts` (the per-page read).
  - **THE LEADS BOARD CANNOT BE KEYED ON CONTACT ID — this row asked for a join that does not exist.** `funnel_submissions` carries `id, funnel_id, step_id, form_key, email, name, phone, payload, attribution_session_id, ip_address, user_agent, lead_user_id, created_at, status, notes, status_changed_at, kind, quiz_attempt_id` (read off production, not off a migration): no `contact_id`, and no `business_id` either. Keyed on the lowercased EMAIL instead, matched to a tenant-scoped contact. Every failure of that match UNDER-reports ("—") and can never show another person's status; a phone-only submission shows "—" rather than a second, worse copy of `lib/phone.ts` on a display path. The real fix is `funnel_submissions.contact_id` with a writer on the capture path, alongside **G31**.
  - **The badge counts MESSAGES, not steps.** "step 3 of 8" was in this row and is wrong on the data: a sequence's rows are `email, sms, wait, branch, stop, tag, alert`, `new_lead_nurture` is EIGHT rows that send FOUR messages, and `alert` goes to the coach (G12), not the lead. It reads "New Lead Nurture · 1 of 4 sent" — counted as SENT because every other phrasing is wrong at one end ("step 1 of 4" overstates somebody who has had nothing; "step 4 of 4" understates somebody parked on the wait after the last message).
  - **`failed` is a first-class badge ("Stopped early"), and this row never mentioned the status.** It is **73 of the 77 runs in production** — the incident CLAUDE.md records — so rendering them as "—" would have told the coach those 73 people are simply not in a follow-up when the truth is theirs broke.
  - **Latest-run selection is "ACTIVE first, then most recently ENROLLED"**, not this row's "active beats exited beats completed": a fixed status order shows a January opt-out above a March completion. Status order and then run id survive as tie-breaks, which is what makes the ordering TOTAL — two runs from one transaction share a byte-identical `now()` and the read has no `.order()`, so without it the winner is PostgREST's row order and the badge can name a different sequence on every refresh.
  - `contactIdsInSequence` PAGES: PostgREST caps a select at ~1000 rows by truncating, so unpaged the 1001st person would be hidden by the filter while the footer, narrowed by the same id list, agreed with the truncated set.
  - **A review finding worth repeating: the new read reddened `__tests__/app/admin/contacts-page-tenancy.test.tsx`**, which mocks three sibling reads and not this one — so it escaped the mocks and made a LIVE network call from a unit test. My verification had used a suite SELECTION (`__tests__/lib/db`, `lib/lead-engine`, `components/admin`) that excluded `__tests__/app`. Run the whole suite.
  - Whole suite 1071 files / 11326 tests with the 7-test red baseline; tsc 238/54 per-file identical; build exit 0; **6 mutants, 6 killed**.

### G14 · "Nobody in two sequences at once" is not enforced · **S code** · BUILT (option B)
- **Today:** a contact is enrolled into every matching sequence; the younger run is deferred 5 minutes per tick so the oldest sends first (`lib/lead-engine/guardrails.ts:169-185`).
- **Decision (owner):** A — refuse a new enrolment while another run is active (quotation literal; a quiz taker inside the newsletter welcome would not get the result email). **B (recommended)** — the new enrolment exits the older run with `exit_reason: superseded` when the new trigger is a direct response to something the person just did (`quiz`, `inquiry`, `checkout_abandoned`), and is refused otherwise. C — keep serialisation and change the quotation wording.
- **Test:** whichever option, `enroll.test.ts` pins it and the reporting screen shows the new reason.
- **DECIDED 2026-09-20: option B**, **BUILT** the same day, and **MERGED into `main` 2026-09-20** at `fe5d51ad` (owner gave the merge word; local only, **NOT pushed, NOT deployed**). Branch and worktree swept after merge. **No migration** — `sequence_runs.exit_reason` has no CHECK constraint (verified against production's `pg_constraint`, not read off a migration file).
  - **STACKED ON G10 (`71eebeaa`), not branched off `main`.** Both rows rewrite `enrollIfTriggered`, so two branches off `main` would have met in a conflict. **Merging G14 therefore implied merging G10**, and both went in together on 2026-09-20 — G10 at `14294225`, G14 at `fe5d51ad`.
  - **Verified ON `main` AFTER the merge, not just on the branch:** whole suite 1047 files / **11014 tests**, 7 failing = the documented 3-file baseline; tsc **238 errors in 54 files**, per-file set identical to the stored `ce6f2aba` baseline; `npm run build` exit 0.
  - **The superseding set is FOUR sources, not the three this row recommended.** `quiz`, `inquiry`, `checkout_abandoned` and **`event_signup`**, added on the owner's explicit call. Reading each REFUSAL case against the live sequences found one that leaves a person in the wrong sequence entirely: somebody in `newsletter_welcome` who signs up for a camp would be refused `camp_clinic_deadline`, never receive "About the camp you asked about" or any deadline reminder, and go on getting newsletter copy. The recommendation in this row was written from the supersede side only.
  - `lead_magnet` was considered and deliberately LEFT OUT. Checked on production rather than assumed: its step 0 is a `wait` and its first email is "Did the guide answer what you were looking for?" — the download is delivered elsewhere, so this sequence is the follow-up, not the thing the person asked for. Missing it costs a nudge.
  - **A bug this row creates in G01, fixed here.** A `superseded` run counted towards the re-enrolment cooldown, so: subscribe (day 0) → take the quiz (day 1, newsletter run superseded) → subscribe again (day 10) → refused for another three weeks. They asked twice and got it neither time, because of a run WE ended. Now excluded from the cooldown, with the same reasoning that function already carries for `failed`, and a control test proving an ordinary `unsubscribed` exit still counts.
  - **Three sub-decisions this row left open, decided rather than left to read order:** (1) **one event enrols into at most one sequence** — otherwise one event could enrol somebody and immediately supersede its own enrolment, chosen by whichever sequence the query returned first (latent today; no two active sequences can match one event); (2) **insert first, then exit** — reversed, a failed insert after the older run is already exited leaves the person in nothing, whereas this order's worst case is two active runs, i.e. the pre-G14 behaviour; (3) **manual enrolment is exempt** — a coach's explicit instruction is not a trigger.
  - `siblingRunDefer` is UNTOUCHED and still serialises sends. Two active runs remain reachable through manual enrolment, and it is the backstop for that and for a failed supersede.
  - Candidate sequences are now read `.order("key")`. Arbitrary but STABLE: since one event enrols into at most one sequence, the read order decides which, and two identical submissions must not get different follow-ups. A real priority column is what would make it meaningful.
  - Both hand-maintained exit-reason inventories updated (`lib/lead-engine/sequence-exit-reasons.ts`, `lib/db/sequence-reporting.ts`). `superseded` buckets to `other`, never `finished` — the follow-up was interrupted, and counting it as finished would inflate every completion rate by exactly the most engaged people.
  - Two pre-existing tests RETARGETED, not deleted: "enrols into every active sequence whose trigger matches" encoded the behaviour this row reverses, and the 23505 test's `funnel_form` setup no longer reaches a second candidate.
  - **Commit is `34b09a75`** (amended after review). Whole suite 1047 files / 11010 tests with the 7-test red baseline unchanged; tsc 238/54 per-file identical; build exit 0; **35 mutants across two sweeps, 35 killed**.
  - **Review found TWO Criticals, both fixed.**
    - **A manual-only sequence is now outside the rule in BOTH directions** — never superseded, never blocking. Exempting manual enrolment as a CREATOR was worthless while its runs were still TARGETS: `sms_repermission` is "one ask, then stop" (00223) and `onePerContact` counts runs of ANY status, so a quiz submission an hour after a coach ran `scripts/enrol-repermission.ts` would have exited the ask, never sent it, and made it impossible to create again — a destroyed compliance ask, silently, captioned "they did something that started a better-matching follow-up". Making it merely non-supersedable would have turned it into a permanent BLOCKER instead, so both halves have a control test.
    - **The cooldown forgiveness is narrowed to triggers that do not themselves supersede.** Forgiving a `superseded` run for every trigger let a chaser re-arm itself: somebody in `abandoned_checkout` takes the quiz, abandons another checkout a week later, and is re-enrolled inside the 30-day window — the incident `hasRunFinishedWithin` exists to prevent, back through a door this row opened. **The review's own headline example was wrong** and checking mattered: it used the quiz ping-pong, but the four `quiz_*` sequences carry `reenrol_cooldown_days = 0` (migration 00263, so a retake still gets its result email), so that function is never consulted for them and their behaviour is unchanged by this row either way.
  - Nine further findings fixed: one event can no longer supersede a sequence it MATCHED (even when the enrolment into it was refused by the unique index) — the first cut's test asserted the opposite; the two extra reads are skipped entirely when no sequence matches the source, so their failure paths cannot reach an enrolment that was never going to happen; `IS_SUPERSEDING_SOURCE` is a `Record<ContactEventSource, boolean>` rather than a `Set<string>`, so a source added to the union is a compile error rather than a silent "refuses"; the timeline fallback no longer claims a cooldown for a reason it does not recognise; the refusal note blames a deterministic run when several are in the way; and `supersedeRuns`' comment, `enrollIfTriggered`'s docstring and the skip log line all said things that were no longer true.
  - **Not fixed, recorded:** the rule is best-effort under concurrency. Two simultaneous captures for one contact both read the active runs before either inserts, so both enrol — two active runs, old one double-exited. No unique index can express "one active run per contact" and there is no transaction around a contact event; the failure is the pre-G14 state, which `siblingRunDefer` serialises. Noted in the code beside the read.

### G15 · Campaign → revenue shows won deals only · **M** · DONE (merged + pushed 2026-09-21)
- **Shipped when:** `lib/automation/campaign-revenue.ts` adds **Leads** (contacts whose `first_touch_session_id` belongs to the campaign, created in the window), **Registrations** (opportunities created in the window, any outcome, plus paid `event_signups`), keeps Won deals / Won value; organic `/go` sessions are grouped by landing path (the funnel slug) instead of collapsing into "— / — / —"; a 30 / 90 / all-time window on the page.
- **Test:** `campaign-revenue.test.ts` fixture: one campaign → 14 leads, 6 registrations, $2,340; organic funnel rows keyed by slug.
- **BUILT + MERGED + PUSHED 2026-09-21**, commit `e2bbd302`, merged at `4009fce6`. No migration.
  - **"PLUS PAID `event_signups`" IS WRONG AND WAS REMOVED — it double-counted every camp ticket.** A completed `event_signup` checkout already mints a pipeline card: `NO_PIPELINE_CARD_CHECKOUT_TYPES` in `app/api/stripe/webhook/route.ts` is `{shop_order, save_card}` and nothing else, and that file's own comment says outright that `event_signup` "now DOES win a pipeline card once completed". So every paid signup is ALREADY one of the opportunities counted. Worse than the double count: the two halves attributed through DIFFERENT KEYS (`source_session_id` for the opportunity, `gclid` for the signup — `event_signups` has no `session_id` and no `utm_*` columns), so one ticket could be counted into two different campaigns. A test seeds a signup row and proves it changes no number.
  - **The two windows are deliberately different, and there is a test for it:** leads and registrations count when they were CREATED, won deals when they CLOSED. A deal that arrived in March and closed in September is March's registration and September's revenue.
  - Organic `/go` landings get their own row keyed by slug, as this row asked. The line is drawn at `/go/` deliberately — grouping every organic landing by path would turn each marketing page into a row and empty the unattributed bucket of its meaning. A funnel's STEPS collapse to one row, and a utm campaign always wins over the slug.
  - An empty return now means the window held NOTHING (no lead, no enquiry, no deal). It used to mean "nothing won", which hid a window full of leads behind "No won deals yet".
  - Every read PAGES and the attribution lookup CHUNKS at 200 — "all time" scans the whole contacts table, and a silently truncated attribution read is the nastier half: dropped rows do not vanish from the report, they re-classify a campaign's leads as Unattributed. `funnelSlugFromLandingUrl` no longer throws on a slug that is not valid percent-encoding (`/go/100%off` would have 500'd the report permanently; `landing_url` is browser-written).
  - The **Click id** column stays, because `gclid` is still part of the grouping key — dropping it renders two genuinely different gclid-only campaigns as identical "— / —" rows, a bug the DAL's own comment records being fixed once already.
  - **TWO MUTANTS SURVIVED AND BOTH TIMES THE TEST WAS AT FAULT.** `Number(requested) || null` passed every window test because `Number("junk")` is `NaN` and `NaN || null` is `null` — the same all-time answer the "junk" case asserted; there is now a `?days=99999999` case. And raising `PAGE`/`IN_CHUNK` to 100000 passed everything, because the Supabase fake returned whatever it was asked for — **the fake now ENFORCES the limits (truncates at 1000, 414s an over-long `.in()`)**, which is what makes those constants testable at all.
  - Whole suite 1068 files / 11308 tests with the 7-test red baseline; tsc 238/54 per-file identical; build exit 0; **7 mutants, 7 killed**.
  - **THE LEADS COLUMN WILL READ ~0 FOR A WHILE, and that is the data rather than the code.** Leads are contacts whose `first_touch_session_id` is set, and production holds **1 of 170** (re-measured 2026-09-21). The column is correct and fills as new captures arrive — `captureLead` writes the column when the capture carries an attribution session — but almost every existing contact was imported from GHL or captured before the column existed. Do not read an empty Leads column as a broken page, and do not "fix" it by widening what counts as a lead.

### G16 · Templates fill in the name only; `brand_color` never reaches email · **S** · DONE (merged + pushed 2026-09-21) — `{{sport}}`/`{{goals}}` deliberately not shipped
- **Shipped when:** merge fields `{{first_name}}` (derived), `{{sport}}`, `{{goals}}`, `{{service}}`, `{{camp_name}}` read from `enrolment_metadata` (G10); an unknown token renders blank and the step editor's placeholder guard flags it at save; the sequence layout in `lib/lead-engine/email.ts:306-357` uses `brand_color` / `accent_color` with the current hexes as the fallback.
- **Test:** `email.test.ts` renders with metadata; unknown token → blank; brand colour appears in the header band.
- **BUILT + MERGED + PUSHED 2026-09-21**, commit `c433ca5b`, merged at `bd661516`. No migration. New file: `lib/lead-engine/merge-fields.ts` — pure, because the step editor is a client component and `email.ts` builds a `Resend` client at module scope.
  - **`{{sport}}` AND `{{goals}}` ARE NOT SHIPPED — neither has anywhere to come from.** `sport` IS collected (`app/api/inquiry/route.ts` reads it off the application form) but that route passes `metadata: { service }` and nothing else, so it never reaches `enrolment_metadata`; wiring it means adding a key to `ENROLMENT_METADATA_KEYS`, which ALSO widens `branchConditionSchema` and the editor's branch dropdown — a deliberate decision with its own test surface, not a side effect of a rendering change. `goals` is free prose, and `enrolment-metadata.ts` says in as many words that its 120-character cap exists so "nothing resembling prose (or a pasted note) can land in a column a branch compares with `=`". Both render BLANK rather than shipping braces, which is what matters most. **Open, if the owner wants them: one key + one route line for `sport`; `goals` needs a different home entirely.**
  - What DID ship: `{{first_name}}` (derived — a split, not a parse) plus all seven `ENROLMENT_METADATA_KEYS`, taken FROM that array rather than a second copy of it.
  - **The SMS renderer shares the list too, and that was a review finding with teeth.** `sms.ts` carried its own `substituteName`, duplicated because email.ts's was not exported, so it understood `{{name}}` and nothing else — while the new editor warning sits under the TEXT box as well, listing every usable token. A coach typing `{{first_name}}` into a text saw no warning and the handset got literal braces: the exact failure this row exists to prevent, reintroduced by two renderers disagreeing about one list.
  - **`{{unsubscribe_url}}` IS NOT A KNOWN TOKEN, and migration `00271`'s comment is wrong to say it is.** Line 92 claims "the substitutions the renderer knows are {{name}}, {{unsubscribe_url}} and {{sms_consent_url}}" — only two of those are true; nothing in the repo has ever substituted it. The editor now warns about it. The unsubscribe link is rendered unconditionally in the FOOTER either way.
  - `{{ sms_consent_url }}` with spaces is now matched by the same tolerant rule the editor uses — an exact `includes` missed it, skipping both the guard AND the substitution on the one step whose entire purpose is that link.
  - **Colours are derived by `resolvePalette`, not by arithmetic invented in email.ts.** It already owns the contrast-correct INK for a background (measured, never thresholded) and the accent to derive when a coach picks a brand and leaves the accent NULL. Without the first a pale brand made the business name invisible in every sequence email; without the second a coach got their band above the incumbent tenant's gold strip. The hex shape is narrowed to `#rrggbb` — the EXACT shape `paletteSchema`, `POST /api/admin/businesses/brand` and migration `00260`'s CHECK constraints all already enforce.
  - The editor warning is **advisory, not a save gate**: a blank is already the safe outcome, so refusing the save would block a coach whose sequence is otherwise finished.
  - tsc 238/54 per-file identical; build exit 0; **2 mutants, 2 killed**. Whole suite at the 7-test baseline — see the flake note under "The pre-existing RED baseline" below.

### G17 · Seven sequences have no text step · **S code, owner copy** · CODE DONE (six of seven) — COPY STILL THE OWNER'S
- `quiz_*` ×4, `service_application_received`, `camp_clinic_deadline`, `sms_repermission`. Once the owner supplies wording, add via the step editor (no deploy). Texts send only to contacts with an SMS consent row — 0 today — so also ship G18 and the email-consent wording decision below.
- **BUILT BY A PEER SESSION + MERGED + PUSHED 2026-09-20**, commit `c3b507f5`, migration `00272_sequence_text_steps.sql` applied to production. **SIX of the seven**, each behind a wait.
  - **Measured on production 2026-09-21, not read off the commit subject:** eleven of the twelve sequences now hold exactly one `sms` step. The one that does not is **`sms_repermission`** — which is correct rather than an omission, since that sequence's whole job is to ask by EMAIL for permission to text, so a text step in it would be the thing it exists to avoid. The row's "seven" counted it; six is the right number.
  - **STILL THE OWNER'S TO REVIEW.** The copy was drafted, not authored — it is editable at `/admin/sequences/<key>` with no deploy, and the drafting session made judgement calls on the owner's behalf (notably moving the camp text, because the email before it says it will stop).
  - ~~**Texts still reach nobody.**~~ **SUPERSEDED 2026-09-21 12:40 UTC.** `contact_consents` held zero rows of any channel for the whole life of this ledger; the decision-8 re-permission send created the **first 2 `sms / granted` rows**. Texts are sendable to those two people today. The row above predicted the first consent would come from a chat lead ticking a box — it came from the stranded batch instead. G18's consent half now collects them from the chat capture card, but nothing has been captured yet, so every text step in the product remains unsendable in practice. (Email is unaffected: only SMS is consent-gated.) **The first real test of this row is the first chat lead who ticks the box.**

### G18 · Chat collects email consent, not texting consent; no sequence follows a chat lead · **S** · CONSENT HALF DONE — the `ai_chat` SEQUENCE IS THE LAST PHASE 2 ROW OPEN, and needs the owner's copy
- **Shipped when:** the capture card (`components/public/AskCards.tsx:272-296`) shows the SMS consent tick with `renderSmsConsentWording(display_name)` whenever a phone is entered; `app/api/ask/capture/route.ts:388-401` writes `channel:"sms"` as well; a sequence listens to `ai_chat` — either a seeded `chat_lead_follow_up` or `new_lead_nurture` widened to accept a second trigger (decision: seed a separate sequence, so its copy can differ).
- **Test:** `ask-capture.test.ts` — both consent rows written with the exact wording; enrol fires.
- **CONSENT HALF BUILT + MERGED + PUSHED 2026-09-20**, same commit as G12 (`672e5583` / `80c9ecbd`). No migration.
  - **This is the row that unblocks G17.** Measured on production: 90 contacts with a phone and **ZERO** `contact_consents` rows of `channel='sms'` — so every text step in the product was unsendable, whatever copy anybody wrote.
  - A SECOND tick, not a second use of the first: its own sentence (`renderSmsConsentWording`), its own row, independent of the email answer in both directions. It appears only once a phone has been typed and disappears — and un-ticks itself — if the field is cleared.
  - `smsConsent` is **optional on the wire** with a `false` default, unlike the required `marketingConsent` beside it. That field could be required from the day it shipped because no client had ever posted without it; making this one required would 400 every chat panel already open in a visitor's browser for the length of the deploy window.
  - **Three gates, two of them added by the review.** The display-name gate (a sentence that cannot name who is texting is consent to nothing) was there from the start. Added after review: the phone must NORMALISE — `askCaptureSchema` validates it as `string().max(40)`, so "call me" would have filed `granted:true` while the contact stored `phone_e164 = NULL`, the row this function's own docblock says cannot exist. And a prior STOP is not undone by a checkbox on an unauthenticated public panel, on EITHER identifier, matching `confirmSmsConsent`.
  - **STILL OPEN in this row:** the `ai_chat` sequence itself (a seeded `chat_lead_follow_up`, per this row's own decision) is NOT built — it needs the owner's copy. Consent collection is what G17 was blocked on; the follow-up sequence is separate.

### G19 · Chat "books consults" is a hand-over to Calendly · **decision** · ARCHITECTURE ALREADY DECIDED
- Today it shows live times and links into Calendly's page. Building native booking is the separate spec in `docs/native-booking-research` (unfinished). Owner decides: accept the hand-over and amend the wording, or schedule native booking as its own project. No code here until decided.
- **WORKED 2026-09-20. THE ARCHITECTURE HALF OF THIS ROW WAS ALREADY DECIDED — on 2026-09-03, seventeen days before this ledger was written.** The owner was asked the fork twice that day; the second answer reversed the first. What is being built is **Calendly per coach**: one Calendly OAuth application of ours, every coach connects their own account, credentials in a row rather than an environment variable. Recorded in `docs/superpowers/specs/2026-09-03-native-multi-coach-booking-design.md` §0/§3.4/§14.4, on branch `worktree-native-booking-research` at commit `1de8d53a` — whose message is literally "record the owner's reversal — Calendly per coach, not native".
  - **This row re-opened a settled decision because the evidence is invisible.** That branch is unmerged and unpushed, so nothing on `main` says the fork was closed. Same failure this repo has already recorded once ("status docs reopen settled decisions"). **Owner's call whether to merge the research branch** — it is documentation only, 4 commits, no code — so the next reader does not re-litigate it a third time.
  - So "schedule native booking as its own project" is **not** a live option: it was declined. Native stays in the spec as the documented road not taken, costed at 14.5–24 weeks against Calendly-per-coach's 9.5–16.5.
- **The wording half is the OWNER'S to amend, and is not in this repo.** The claim is the quotation's — "Chat books consults from live calendar availability". Everything the visitor and the model actually see is already honest, checked line by line today: the chat prompt says "you cannot book anything yourself" and "Never claim to have saved, booked, or sent anything"; `ConsultCard` says "Nothing is booked yet. This is the page where a consultation is arranged."; the slots card says "Nothing is booked until you finish on the booking page." **No code change is needed for honesty.** What is overstated is the sales line, and the accurate version is "shows live consultation times from the calendar and opens the booking page at the time you pick".
- **What this row actually turned up, and it is not a wording problem** — see the new row below. The chat offers Calendly from ENVIRONMENT VARIABLES while an active per-tenant connection already exists.
- Re-measured on production 2026-09-20: **still 0 Calendly bookings ever**; all 5 bookings are `ghl`, the most recent 2026-07-21. One `coach_calendar_connections` row, `status: connected`, `webhook_state: active`, `scheduling_url` and `event_type_uri` both set, connected 2026-09-04.

### G19b · The chat offers Calendly from env vars, not from the coach's connection · **S** · DONE (merged + pushed 2026-09-21)
- **Today:** `createToolExecutor` (`lib/lead-engine/chat/tools.ts:421-422`) calls `readCalendlyConfig()` / `readCalendlySchedulingUrl()`, which read `CALENDLY_API_TOKEN`, `CALENDLY_EVENT_TYPE_URI` and `CALENDLY_SCHEDULING_URL` from `process.env` (`lib/calendly/env.ts:36-52`). The executor HAS `ctx.businessId` and already tenant-scopes its other lookup with it (`list_camps_and_clinics`, `:533`), but the booking offer never consults it.
- **Why it matters, and it is not tidiness.** The INBOUND half is already per-tenant: `resolveCalendlyTenant` (`lib/bookings/calendly-tenant.ts`) matches a delivery's event type against `coach_calendar_connections` and only falls back to `CALENDLY_EVENT_TYPE_URI` through an explicitly temporary "deploy ramp" that warns on every use. The OUTBOUND half has no equivalent and no ramp. So the moment a SECOND coach connects their own Calendly, their site's chat keeps offering the PLATFORM's calendar: a visitor on coach B's page is shown coach A's free times and books into coach A's diary. Silent, and indistinguishable from working.
- CLAUDE.md names this exact shape: "Prefer per-tenant rows over environment variables for anything a coach owns. An env var is a single-tenant assumption wearing a config file's clothes — that is precisely what `coach_calendar_connections` replaced for Calendly." The replacement was done on one side only.
- **Not a live defect today** — one tenant, one connection, and the env values point at the same account. It is a fuse: it lights the day a second coach connects, which is the whole point of the Calendly-per-coach plan this decision just confirmed.
- **Shipped when:** the chat resolves `{apiToken, eventTypeUri, schedulingUrl}` from the requesting tenant's `coach_calendar_connections` row, falling back to the env values only for the platform tenant and only with the same loud warning `resolveCalendlyTenant` already uses; a second connected business offers its OWN times; and a business with no connection offers the plain consult path rather than somebody else's calendar.
- **Test:** executor test with two businesses, each with a connection → each gets its own `schedulingUrl` and `eventTypeUri`; a business with no connection and no env → `CONSULT_PATH`, never another tenant's link. Mutate the tenant predicate and watch it fail.
- **Decision for the owner:** do this now as a standalone S, or fold it into the Calendly-per-coach project's OAuth phase (which has to touch the same resolution anyway). Doing it now is cheap and removes a cross-tenant fuse; folding it in avoids writing the resolver twice. **DECIDED: done now, standalone.**
- **BUILT + MERGED + PUSHED 2026-09-21**, commit `32b28416`, merged at `8fa6f322`. No migration.
  - **The resolver already existed and had been INERT for weeks.** `lib/calendly/config-for-business.ts` was written at `551855c4` with a header saying outright that nothing called it yet and that a later phase would "change one resolver instead of discovering availability was hard-wired to four environment variables". That paid off exactly as advertised — but it had shipped with the leak still in it: its fallback handed `readCalendlyConfig()` to ANY business with no connection, not just the platform's. **The fallback is now gated on the business BEING the platform**, warned on every use like the inbound ramp; any other business with no connection gets nothing and its visitors are offered `/contact`.
  - `createToolExecutor` resolves from `ctx.businessId`, which the route already threads from `conversation.business_id`.
  - **Resolution is LAZY and memoised once per turn, and that is correctness, not micro-optimisation.** Resolving eagerly would put two reads and a possible OAuth refresh in front of every chat turn including "what do you charge?" — and `accessTokenForConnection` THROWS on a dead grant, so one coach's lapsed Calendly would 500 their whole assistant rather than degrading the one tool that needs it.
  - **The identity reads still throw; the TOKEN read does not.** By the time it runs the owner of the calendar is established, so its failure cannot be mistaken for anybody else's diary — it degrades to that coach's own booking page with no times, rather than taking a working public page down over a lapsed grant. A failed IDENTITY read becomes `/contact`, never the environment.
  - `ToolOutcome.consultHref` became `ToolExecutor.consultHref()`, awaited only when a way-forward card is genuinely about to be added — BOTH of `withWayForward`'s no-op conditions are checked first.
  - **`book_consult` can now transitively reach a WRITE** (`accessTokenForConnection` may refresh that coach's token or record `last_error`). Named in the tools.ts header AND in the source-grep suite's own preamble: those greps check what tools.ts names DIRECTLY, and what they protect is that no tool the model can call writes a contact, consent row, lead or payment.
  - Re-measured before planning: one business, one `booking_hosts` row, one connected `coach_calendar_connections` row — so the fuse was real and **unlit**. This is prevention, not an incident.
  - Whole suite green at the 7-test baseline; tsc 238/54 per-file identical; build exit 0; **8 mutants, 8 killed**.

---

## Phase 3 — Entry points and the pipeline

> **These rows' claims were SPOT-VERIFIED on 2026-09-21 and hold up** — unlike three of the four
> Phase 2 rows built that day, which each named a column, a join or a source that does not exist or
> is already counted. So the rot was concentrated in the rows being worked, not spread through the
> document. Checked against production and the code, not re-read from the row:
> `bookings.service_type` does **not** exist (G22 correct); `app/api/questionnaire/route.ts` makes
> **zero** calls to `captureLead`/`recordContactEvent` (G20 correct); `routeToPipeline` has an
> `assessment` arm and an `event_signup` PAYMENT arm but **no camp/clinic ENQUIRY arm**, so those
> fall to the Coaching default (G24 correct); both `recordContactEvent` mentions in the assessment
> route are comments saying why it is not called (G21 correct); `sms_sender_phone` is
> `z.string().trim().max(32)` with no E.164 normalisation (G33 correct; normalised since, by G33 itself, 2026-09-25); and all seven funnel tables
> plus `faqs`, `programs`, `testimonials` and `marketing_attribution` genuinely have no
> `business_id` (G31 and G35 correct). **Re-verify anyway before building — this note ages.**

### G20 · Questionnaire is not connected · **S**
- `app/api/questionnaire/route.ts` writes `client_profiles` + GHL only. Ship `captureLead({source:"questionnaire"})` with the session user's email, name fill-only, timeline row. Test: route writes the spine.
- **BUILT 2026-09-21.** No migration. Re-measured first: the route really did make zero
  `captureLead`/`recordContactEvent` calls, and `questionnaire` was already a `ContactEventSource`
  member, so no union widening was needed.
  - **"name fill-only" did not exist and had to be built.** The row assumed `contacts.name` behaved
    like the three identity columns beside it. It does not: `user_id`, `first_touch_session_id` and
    `timezone` are all fill-only, and `name` was written unconditionally on every branch
    (`name: input.name ?? undefined`), so any supplied name won outright. That is almost certainly
    why the row assumed it. Shipped as `namePatch` + an **opt-in** `nameFillOnly` flag threaded
    `captureLead → recordContactEvent → upsertContactIdentity`, defaulting to false.
  - **The default is opt-in deliberately, not timidly.** Every pre-existing caller (contact form,
    inquiry, newsletter, shop, both event routes, the Stripe webhook) receives a name the person
    typed on THAT form moments earlier — the freshest evidence there is. The questionnaire is the
    first caller for which that is false: it is session-gated, so its only name is the ACCOUNT's.
    Making fill-only global would have quietly frozen the first name six entry points ever recorded.
  - **`findMatchCandidates` had to start selecting `name`**, in BOTH the email and phone queries.
    Without it `existing.name` reads `undefined`, which the guard cannot tell from "no name yet", and
    fill-only silently degrades to the overwrite it exists to prevent. The test harness is
    projection-BLIND, so a behaviour test alone cannot catch this — pinned by a projection test, the
    same way `user_id` and `first_touch_session_id` already are.
  - **A blank name counts as no name in BOTH directions**, found by the code review rather than by
    me. The first cut applied the blank rule only to the EXISTING value, so fill-only could write the
    very whitespace it defines as "no name" — reachable, not theoretical: `registerSchema` is
    `z.string().min(1)` with no `.trim()` and `lib/auth.ts` composes the session name from those
    fields, and the written `"   "` would blank the `?? fallback` labels on the contacts table, the
    contact detail page and the SMS thread. Both blank rules live inside the `fillOnly` branch so the
    default path stays byte-for-byte what the six other callers already did.
  - **It MINTS a contact where the assessment route does not, and that divergence is deliberate and
    unresolved.** `app/api/assessment/submit/route.ts` is equally session-gated and attaches only to
    an existing contact, under the 8 Sept ruling. G20 asks for the mint; **G21 is the open decision
    on whether the assessment route should match.** Said outright in the route, in `platform.ts` and
    here, so nobody "simplifies" one into the other without deciding.
  - **Tenant: `platformBusinessId()`**, the same seam and the same reason as the assessment route —
    session carries a userId only, `users` has no `business_id`, no per-coach relationship exists to
    resolve a client's tenant from. Added to the inventory in `lib/tenancy/platform.ts`, which
    `platform-inventory.test.ts` enforces in both directions.
  - **Known divergence worth a line in the G21 decision:** the spine matches by EMAIL, while the
    assessment route looks up by `userId`. A client whose contact row carries a different address (a
    Stripe receipt email, say) gets a second contact row rather than a match. Consistent with every
    other `captureLead` caller and no constraint breaks, so it is a design divergence, not a bug.
  - Whole suite green at the 7-test baseline (1075 files / 11457 tests); tsc 238/54 per-file
    identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`; build exit 0; **17 mutants, 17
    killed** — including one genuine survivor found on the first sweep (the MERGE branch's fill-only
    had no test, exactly as that branch's `timezonePatch` line once had none).

### G21 · Assessment only annotates an existing contact · **S, decision** · **BUILT 2026-09-21 — RULING REVERSED**
- **OWNER RULED 2026-09-21: mint the contact.** Built on branch `worktree-g21-assessment-mints-a-contact` off `main@cf76b633`. `app/api/assessment/submit/route.ts` now calls `captureLead` instead of `findContactByIdentifiers` + `recordEventForExistingContact`. No migration: `"assessment"` was already a `ContactEventSource` member and `contact_timeline_events.source` has no CHECK constraint.
- **The 8 Sept rationale had expired, and the stale comment is corrected in the same change** — it argued from "0 of 170 production contacts have a user_id"; G04 made it 43 of 170. Its *conclusion* (keep matching on email) is still right for a different reason: 127 of 170 are still unlinked, so a userId-only lookup would miss them. Recorded in the route so nobody "simplifies" it back.
- **The G20 inconsistency is closed, not just noted.** `app/api/questionnaire/route.ts`, `lib/tenancy/platform.ts` and this row all described the two session-gated routes as deliberately disagreeing. All three are updated; the routes now behave identically.
- **Minting enrols nobody today**, verified on production: no sequence has `trigger_source = 'assessment'`, and the two null-trigger sequences cannot match because enrolment filters with `.eq`. A sequence that *did* trigger on `assessment` would message every submitter — noted in the route as the thing to check before adding one.
- **ACCEPTED TRADE-OFF, found in review — one case is handled WORSE than before.** `captureLead` → `recordContactEvent` matches candidates on **email and phone only** (`findMatchCandidates`); the `userId` it is passed does not participate in matching, it only fills the link once a row is chosen. The `findContactByIdentifiers` this replaced matched `user_id` **first**. So if a client's account email diverges from their contact email, an assessment submission now mints a **second** contact carrying the same `user_id` instead of appending. The divergence is reachable — `PATCH /api/admin/clients/[id]` updates `users.email` and never touches `contacts` — but unreachable in today's data: **0 of the 43 linked contacts have a mismatched email** (production, 2026-09-21). Same hazard G05 met on the Stripe path. Accepted and written into the route rather than absorbed silently: fixing it properly means teaching `recordContactEvent` to match on `user_id`, which changes behaviour for *every* `captureLead` caller. **Worth its own row.**
- **Tests:** `__tests__/api/assessment/submit-route.test.ts` **retargeted, not replaced** — though not one-to-one, and the header says so. The route no longer branches on contact-exists (that moved inside `recordContactEvent`), so with `captureLead` mocked this suite cannot distinguish those two and does not claim to; that lives in `__tests__/db/contacts-record-event.test.ts`. 10 tests, **13/13 mutants killed**, including ordering (capture must run after the assessment row) and `nameFillOnly`.
- **Also corrected:** `recordEventForExistingContact`'s doc block in `lib/db/contacts.ts` still justified itself by the reversed gap-#14 ruling. Its only remaining caller is `lib/bookings/ingest.ts` (G22); the contract is still sound, the rationale was stale.

#### Original row, for the record
- The 8 Sept ruling chose attach-only. The quotation counts assessment as an entry point and, with G04, every submitter is a linked client anyway. **Recommend reversing the ruling:** create when missing. Owner confirms; then `app/api/assessment/submit/route.ts:76-82` calls `recordContactEvent`.
- **THE RULING'S OWN RATIONALE IS NOW OUT OF DATE, found 2026-09-21.** Verified: both mentions of `recordContactEvent` in that route are COMMENTS explaining why it is not called, so the row's description of the behaviour is accurate. But one of those comments argues from "`contacts.user_id` has no originating writer anywhere in this repo … A userId-only lookup finds nobody, ever (0 of 170 production contacts have a user_id)". **G04 gave it a writer and backfilled: production is now 43 of 170.** Re-measure before re-litigating this decision — the premise it turns on changed, and the recommendation to reverse is on firmer ground than the row knew. The stale comment should be corrected in the same change.

### G22 · Bookings never create a contact or a timeline row; no service type is stored · **M**
- **Shipped when:** `ingestBooking` (`lib/bookings/ingest.ts:294-355`) captures a contact (`source:"booking"`, new `ContactEventSource` member) when none matches, writes `booking_scheduled` / `booking_cancelled` timeline rows, and persists `bookings.service_type text` (reader: the reconciler in G26 and `routeToPipeline`) from the Calendly event-name match and the GHL calendar.
- **Test:** `ingest.test.ts` — stranger's booking → contact + timeline + card; `calendly-booking.test.ts` — `service_type` stored.
- **BUILT 2026-09-21. MIGRATION `00273` — the first schema change of this phase**, applied to the dev
  clone and verified before the code was written. Additive, nullable, no default, no backfill.
  Re-measured first: `bookings.service_type` really was absent and `contact_id` really was present.
  - **`booking` is a new `ContactEventSource`, and the type system made that a decision rather than
    a default.** Two `Record<ContactEventSource, …>` maps refused to compile until it was answered:
    `IS_PURCHASE_SOURCE` (false — booking time is not buying; a paid consult is a separate Stripe
    event that writes its own `purchase` row) and `IS_SUPERSEDING_SOURCE` (true — a slot in their own
    diary is the most deliberate act on that list). The second is **unreachable today**: no sequence
    has `trigger_source = 'booking'`, checked against production, so a booking capture enrols nobody.
    Recorded as such rather than left looking load-bearing.
  - **A LATENT ORDERING TRAP, found while answering that.** `exitRunsForContact` exits EVERY active
    run for a contact, and `captureLead` reaches `enrollIfTriggered` — so on a freshly minted contact
    the ingest would have enrolled and un-enrolled the same person in one request, with nothing
    saying why. The exit is now gated on the contact having ALREADY existed, which also loses
    nothing: a brand-new contact has no prior runs.
  - **Timeline rows are for the ENGINE, not the screen — found by the code review.**
    `mergeTimeline` already merges the `bookings` table through `describeBooking`, status included
    ("Booked a call for 8 Sep — cancelled"). Rendering the new rows as well printed the same fact
    twice at two different timestamps. They are written (G27 measures silence from
    `contact_timeline_events`, and before this a booking left no trace there at all) and **skipped
    at render**.
  - **On TRANSITION only**, the same rule the audit row already used. A Calendly `invitee.created`
    retry against a still-`scheduled` row, or a coach editing a GHL appointment, would otherwise
    write a second `booking_scheduled` — and since G27 that row **resets the gone-quiet clock**, so a
    redelivery would make a silent person look like they had just been in touch.
  - **`service_type` is a separate best-effort UPDATE, not a column on the INSERT**, and that is the
    careful choice. `writeRow`'s insert already carries a retry for 00241's tenant columns whose
    trigger matches on the ERROR CODE alone — so a missing `service_type` would fire that retry, the
    retry strips only tenant columns, it would fail identically a second time, and **the booking
    would be lost**. Writing it afterwards cannot touch the insert at all.
  - **G27's documented blind spot is closed:** `booking_scheduled` joined `CONTACT_ACTIVITY_KINDS`,
    so somebody who books a consult today no longer shows red on the stage called "Consult Booked".
    `booking_cancelled` is deliberately NOT on it — a cancel can be the coach's doing as easily as
    theirs.
  - **The writer ships without its reader, deliberately and in writing.** `pipeline-reconcile.ts`
    still routes every replayed booking to `coaching`; teaching it to read the new column is **G26**,
    and it is what `cron_pipeline_reconcile_enabled` is waiting for. The migration, the ingest and
    the reconciler all now say so — the three comments that previously claimed the column did not
    exist have been corrected.
  - Whole suite green at the 7-test baseline (1075 files / 11560 tests); tsc 238/54 per-file
    identical; build exit 0; **22 mutants, 22 killed**.

### G23 · A payment does not close the enquiry card on another board · **S**
- After the Won card is created on the routed board, close any open card for the same contact on other boards as `won` with `value_cents 0` and `outcome_reason paid_elsewhere` (no double-counting). Test in `pipeline-hooks.test.ts`.
- **BUILT 2026-09-21.** No migration. **Shipped as `lost`, NOT `won` — the row's wording would have
  lost a real sale**, and that was proved by driving a second payment through the real state machine
  rather than by reading it:
  - **`decideMove`'s payment arm returns `{kind:"noop", reason:"already_won"}` for any already-won
    card.** So sweeping the camp card to Won and then selling that person an actual camp place
    records the sale NOWHERE: the board keeps a card at `value_cents: 0` and the money is absent
    from both the board and campaign revenue. Before the sweep existed, that card was simply still
    open and the payment closed it Won at full value. A `lost` card has no such trap — the same arm
    re-closes it as won at full value, reusing the row, so the history reads
    opened → lost (paid elsewhere) → won. The trap is specifically "checkout with no fresh enquiry
    in between", which is the common path.
  - **`lost` is also truer and cheaper.** From THAT board's point of view the enquiry did not become
    a sale; the conversion is recorded as Won exactly once, where the money landed. And because
    `campaign-revenue.ts` reads `outcome = 'won'`, a lost card is already outside its Won query —
    **no downstream filter is needed at all.** Closing as Won at 0 would have kept the MONEY right
    while still adding 1 to `wonCount` per board, inflating the conversion rate that page exists to
    report. (Swept cards share the contact's `first_touch_session_id`, so they land in the same
    campaign bucket as the sale — the double count was real, not theoretical.)
  - `closed_trigger` is `payment`, never `manual`: `decideMove` treats a manual close as
    `humanClosed` and refuses to move the card again, so a sweep stamping `manual` would permanently
    freeze a board the coach never touched.
  - Each card moves to **its own board's** lost stage, found by `kind` (00219's schema comment: the
    state machine keys on `kind` so a business can rename a stage). A board with no lost stage is
    skipped rather than parked on another board's stage id.
  - **Errors are isolated PER CARD.** The first cut let one board's transient failure unwind past
    every remaining card and leave them open behind a single log line — the exact stale-card state
    this gap removes, reintroduced by its own error handling.
  - **Two test fakes were hardened, and both had hidden a real bug.** `__tests__/db/pipeline.test.ts`
    had no `.is()` at all, so the sweep's "still open" predicate threw a TypeError that its own
    catch swallowed into a silent no-op; and the campaign-revenue fake was projection-BLIND, so
    dropping a column from a `select()` left the suite green. That one now PROJECTS, like it already
    enforces PostgREST's row and `.in()` caps.
  - Whole suite green at the 7-test baseline (1075 files / 11507 tests); tsc 238/54 per-file
    identical; build exit 0; **15 mutants, 14 killed and one declared EQUIVALENT** (excluding the
    just-won card is masked by the open-only predicate, since both call sites sweep after their own
    write).

### G24 · Camp and clinic enquiries route to Coaching · **S**
- `lib/lead-engine/pipeline-route.ts:196-208`: `inquiry` with `serviceType ∈ {camp, clinic}` → `camps_clinics`. Update `pipeline-route.test.ts:70`.
- **BUILT 2026-09-21.** No migration. The row is correct and was re-measured: `camp` and `clinic`
  really are members of `SERVICE_TYPES` (`in_person, online, assessment, clinic, camp`), and only
  the PAYMENT for a camp place reached that board, so it showed the sales and not the enquiries.
  - **Shipped "however it arrives", matching the assessment arm, rather than gated on
    `event === "inquiry"` as the row's wording suggested.** Behaviourally this is IDENTICAL today,
    measured rather than assumed: the Calendly adapter is the only producer of a booking
    `serviceType` and emits `"assessment"` or null (a string match on the event-type name), GHL
    passes null, and no payment call site passes `serviceType` at all. The difference materialises
    the day G22 gives `bookings` a real `service_type` — at which point a camp booking reaches the
    right board with nobody having to remember this table.
  - **Placed AFTER the refund refusal, which stays first and unconditional.** A refund's
    `serviceType` describes how the ORIGINAL payment would route today, not which board the card
    being amended lives on. A mutant that moved the arm above the refusal is in the sweep.
  - **Exact `===` matches, not a substring test.** `camping`, `clinical`, `Camp` and
    `summer camp` are pinned as NON-matches — a `.includes()` would have looked convenient and
    routed a coach's free-text label onto a real board.
  - **Nothing to backfill: production has 3 inquiries total** (2 `in_person`, 1 `assessment`) and
    **zero** camp/clinic. This is forward-looking; no existing card is mis-filed. All three boards
    (`coaching`, `assessment`, `camps_clinics`) are seeded, active and have 4 stages each in
    production, so the new cards land somewhere real and visible.
  - **Two stale comments corrected, one of them load-bearing.** `lib/bookings/ingest.ts`'s
    `serviceType` doc claimed everything but `assessment` goes to Coaching. And the reconciler's
    booking-replay note said routing bookings is "trivial today" without saying WHY — it is trivial
    only because that call passes no `serviceType` at all. **That is a trap for G22:** the live path
    would route a camp booking to Camps & Clinics while the replay routes it to Coaching, producing
    a duplicate card the per-pipeline unique constraint cannot block. Both files now say so, and say
    to change them together.
  - Also corrected: the module header claimed `inquiry` is not a `PipelineEvent` kind. It has been
    one since `{ kind: "inquiry"; serviceType }` was added to the union.
  - Whole suite green at the 7-test baseline (1075 files / 11470 tests); tsc 238/54 per-file
    identical; build exit 0; **9 mutants, 9 killed**.

### G25 · A coaching refund can amend a camp card · **S**
- `resolveWonPipelineKey` (`lib/db/pipeline.ts:530-553`): prefer the Won card whose `metadata.stripe_session_id` matches the refunded charge's session; fall back to newest only when none matches. Test both.
- **BUILT 2026-09-21.** No migration. **The row named a column that does not exist**, and re-measuring
  changed the shape of the fix:
  - **`opportunities` has NO `metadata` column.** The session id lives in `source_event_id`
    (migration 00225), which `deriveSourceEventId` writes from the EVENT metadata's
    `stripe_session_id` on create — the first of `SOURCE_EVENT_ID_KEYS`. Production agrees: both Won
    cards carry a `cs_live_…` id there.
  - **The refund carries no session id to match with.** `charge.refunded` gives a charge and a
    payment intent; `SOURCE_EVENT_ID_KEYS`' own comment says refunds pass `stripe_charge_id` and
    deliberately excludes it. No local table bridges the two — `payments` has no
    `stripe_session_id` column and **0 of its 59 production rows** carry one in `metadata`. So the
    webhook now asks Stripe (`checkout.sessions.list({payment_intent})`), best-effort, under an
    explicit 5s timeout, and passes the answer through. A failed or empty lookup yields no key,
    which is exactly the "no preference" input the resolver already handles.
  - **Nothing to backfill and nothing broken today: production has 4 opportunities, 2 Won, and ZERO
    contacts with more than one Won card.** This is prevention, not an incident.
  - **A limitation the row did not know about, found by the code review.** `source_event_id` is
    stamped only by the CREATE branch, so it is set on a card a checkout created ALREADY WON. The
    `close` branch never writes it — so a card OPENED by an inquiry/booking/quiz and later CLOSED
    Won by a payment carries null and can never match. Today that costs nothing (both production Won
    cards were created already-Won), but **G24 routing camp and clinic enquiries onto their own
    board makes the open-then-close shape more common.** Not fixed here on purpose: `source_event_id`
    is a CREATION idempotency key under a partial unique index, and stamping the closing session id
    onto it would overload one column with a second meaning and collide with a later delivery of
    that session's create. **The clean fix is a separate nullable column written by the close
    branch — a migration, and a gap of its own.**
  - **A determinism defect in the first cut, also found by review, fixed rather than documented.**
    `amount_refunded` is cumulative per CHARGE and the ledger baseline is charge-scoped but
    card-agnostic, so two deliveries of one charge resolving to DIFFERENT cards split the refund
    (delivery 1 takes $40 off the camp card; delivery 2 fails its lookup, lands on coaching, and
    takes $60 off THAT). Now the strongest signal is checked first: **the card a previous delivery
    of this same charge already amended**, read from the stage-event ledger — local, no network,
    same answer every time. That also closes a PRE-EXISTING version of the split (a new Won card
    closing between two deliveries moved "most recent Won").
  - **Still not solved, stated plainly:** this resolves the BOARD, not the CARD. Two Won cards on the
    SAME board still amend the newer one. Unreachable today; closing it means threading the resolved
    opportunity id into the amend.
  - Whole suite green at the 7-test baseline (1075 files / 11491 tests); tsc 238/54 per-file
    identical; build exit 0; **18 mutants, 17 killed and one declared EQUIVALENT** (the anchor's
    opportunity-read tenant predicate is masked by the pipelines read that follows it — defence in
    depth, not an independent guard, and the sweep script says so rather than hiding it).
  - **REGRESSION, found 2026-09-25 and fixed on `worktree-postgrest-select-contract` (`46bd6baf`).**
    The determinism fix above (`resolveChargeAmendedPipelineKey`) selected and ordered
    `opportunity_stage_events` by `created_at`. That table has only `occurred_at` (00219), so every
    call answered 42703. It runs before both fallbacks for any refund that carries a charge id,
    which the webhook always passes. The webhook catches the throw and logs "refund pipeline hook
    failed", so **from the deploy of this row until the fix lands, no refund amends any card**: not
    the G25 choice, and not the older "most recent Won" either. The 17 killed mutants could not see
    it because the in-memory fake stamps `created_at` on every row of every table. It was found by
    the live select contract (`npm run test:integration:selects`), the first check in the repo that
    sends each select to a real PostgREST. **Whether any real refund was lost is unverified:** the
    production read was not permitted in that session. Look for "refund pipeline hook failed" in
    the Stripe webhook's logs since 2026-09-21.

### G26 · The pipeline repair cron must stay off · **M** (after G22)
- `lib/automation/pipeline-reconcile.ts` reconciles every board, routes bookings by the persisted `service_type`, and handles `event_signup` payments instead of counting them failed. Then the owner sets `cron_pipeline_reconcile_enabled` true (outward action). Test: an assessment booking already carded on Assessment is not duplicated on Coaching.
- **BUILT 2026-09-21.** No migration (G22's `00273` is what it reads). All three parts shipped:
  bookings route per row from the stored `service_type`, payments resolve their OWN board for the
  open-card precondition, and the wrong-board guard that counted every `event_signup` as `failed` is
  gone — a camp registration is exactly what this pass exists to repair, and it was reported as a
  fault on every tick.
  - **The duplicate-card test the flag was waiting on is pinned directly:** an assessment booking
    already carded on Assessment by the live webhook is found there by the replay and NOT duplicated
    onto Coaching.
  - **G23's cross-board sweep must NOT fire on a replay — found by the code review, and it was a
    defect this row created.** Removing the payment skip made `closeOpenCardsOnOtherBoards`
    reachable from the reconciler for the first time. That sweep means "they have JUST bought"; a
    replay carries a payment missed up to 30 days ago, so somebody whose camp payment went astray
    three weeks back and has since opened a FRESH coaching enquiry would have that new enquiry
    closed `paid_elsewhere` at zero value. The sweep is now gated on `source === "hook"`.
  - **A fourth projection-blind fake, and a fourth real bug hidden by one.** Dropping `service_type`
    from the reconciler's bookings projection left every test green while the reader got `undefined`
    and routed everything to Coaching — this gap, silently intact. That fake now PROJECTS. The same
    fake also had no `.is()`, so G23's sweep threw and was swallowed on every won payment: the
    behaviour this row newly makes reachable was entirely unexercised.
  - **The DEFAULT board stays resolved EAGERLY, outside the per-payment try.** A business whose own
    coaching board is missing is genuinely broken, and throwing there is what puts it in
    `failures[]` and names it on the cron run. Resolved lazily with the rest, the same fault would
    have read as "one payment failed" — a broken tenant wearing a transient error's clothes.
  - **ONE BOUNDED RESIDUAL, measured rather than waved away.** `service_type ?? null` cannot tell
    "never stamped" from "coaching", and 00273 shipped with no backfill — so a booking ingested
    between 2026-09-13 and that deploy would still duplicate. **Production had ZERO bookings of any
    status in the last 30 days**, so the residual is currently empty; the window is closed going
    forward and bounded behind by the scan window. The exact re-measurement query is in the module
    comment.
  - `cron_pipeline_reconcile_enabled` **is still OFF and stays the owner's call** — flipping it is an
    outward action. What changed is that the hazard blocking it is gone.
  - Whole suite green at the 7-test baseline (1075 files / 11574 tests); tsc 238/54 per-file
    identical; build exit 0; **11 mutants, 11 killed**.

### G27 · "Gone quiet" measures stage age, not silence · **S**
- Amber stays stage-entry age; red becomes "no contact activity for `red_after_days`" from the latest non-engine timeline event. Add the missing render test for the dot and labels (`pipeline-board.test.tsx` has none).
- **BUILT 2026-09-21.** No migration. The row is correct on both halves: red measured stage age, and
  `pipeline-board.test.tsx` had 7 tests and **zero** mention of staleness — the whole "who do I
  chase?" signal was unpinned.
  - **"Non-engine" is an ALLOW-LIST, not a deny-list, and the direction is the safety argument.**
    `contact_timeline_events.kind` is plain text with no CHECK (00214), so a new kind starts being
    written with nothing to announce it. A deny-list would let a new ENGINE kind silently count as
    the person speaking and hold a stale card green for ever — this bug, reintroduced. An allow-list
    merely fails to count a new PERSON kind, so a card goes red while they are talking to us: the
    coach chases someone who replied, which is visible and recoverable. Production's shape makes the
    split concrete: of 271 timeline rows, **256 are `ghl_import` or `sms_repermission_candidate`**
    and only 12 are real activity.
  - **`occurred_at`, not `created_at`** — found by the code review, and the kind of thing that ships
    invisibly. The table carries both; they differ on only **2 of 271** production rows today, and
    `contact_timeline_contact_idx` is `(contact_id, occurred_at DESC)`, so the wrong column also
    walks past the index that exists for this query. A later backfill setting `occurred_at` to real
    historical moments would have made the entire imported cohort read as "active today".
  - **The read is scoped, ordered and PAGED.** An unbounded read of an append-only table truncates
    silently at PostgREST's 1000-row cap, so the per-contact maximum would have been computed over
    an arbitrary page and an actively-replying contact would flip to red for no visible reason. Both
    bounding guards are pinned by a fixture with a full page of rows.
  - **A BOOKING IS NOT COUNTED YET, and that is G22's to close.** No booking writes a timeline row at
    all — neither the Calendly nor the GHL webhook — so someone who books a consult today with no
    other recent activity shows red on the stage called "Consult Booked". **When G22 adds
    `booking_scheduled` / `booking_cancelled` rows, add `"booking_scheduled"` to
    `CONTACT_ACTIVITY_KINDS` in the same change.** Deliberately NOT patched by also anchoring on
    `entered_stage_at`: a coach dragging a card would then make a silent person look fresh again,
    which is where this bug came from. Payments already count (the Stripe capture writes
    `entry_point`).
  - **The dot's words changed too.** A red dot labelled "Stalled" sat directly above the card's only
    number, "Entered today" — a contradiction the moment red stopped meaning stage age. Now
    "Slowing down — a while in this step" and "No reply from them lately", which say which question
    each colour answers.
  - Whole suite green at the 7-test baseline (1075 files / 11535 tests); tsc 238/54 per-file
    identical; build exit 0; **22 mutants, 20 killed and 2 declared EQUIVALENT** — the scoping filter
    and the early-break counter mask each other, so a mutant that drops BOTH is included and killed
    rather than pretending either is independently pinned.

### G28 · Manual texts are not consent-gated · **S, decision** · **BUILT 2026-09-21**
- **OWNER RULED 2026-09-21: gate it, with the audited override.** Built on branch `worktree-g28-manual-texts-need-consent` off `main@cf76b633`. No migration — `contact_consents` and `hasConsent` already existed.
- **The premise, accepted with eyes open: `contact_consents` has 0 rows in production**, so this refuses *every* manual text on day one and each send needs the coach to press **Send without permission on file** until consent accumulates. That is the ruling, not a defect.
- **`sendManualSms` now runs FOUR checks, in this order: suppression → consent → configuration → segment length.** Consent sits ahead of configuration for the same reason suppression does: a credentials error must not mask a legal one that an admin then "fixes". A new required `consentOverride: boolean` argument means a future call site fails to compile rather than inheriting a policy silently.
- **THE INVARIANT: the override skips consent, NEVER suppression.** A STOP is not a preference. Suppression is checked first and no tick reaches past it. The existing suppression suite now passes `consentOverride: true` on every call and still expects `SmsSuppressedError` — that *is* the proof, not a separate claim. A dedicated mutant (`let the override skip SUPPRESSION too`) is killed.
- **No contact means no consent.** `contactId` is optional on `sendManualSms`, so without an explicit branch the gate would be bypassed by texting a number with no contact row — the easiest thing in the world to do from the compose box.
- **An unreadable consent row is a 502, not a refusal.** `hasConsent` throws rather than returning false, and that throw propagates: "could not read" and "they said no" are different answers.
- **Accountability:** a refusal writes `sms.send_refused` with `reason: "no_consent"` (its own slug, not a `sent_manual` row with `outcome: failure`). A send that went out *having skipped* the check stamps `consent_override: true` on the `sms.sent_manual` row — and a request that carried the tick but was refused anyway does **not**, or the trail would claim a text that never happened.
- **The override button is NOT called "Send anyway"** — that accessible name already belongs to the quiet-hours confirmation, and Testing Library's `name:` is a full-string match, so two controls sharing it are indistinguishable to a test and to a screen reader. It reads **"Send without permission on file"**, and the client branches on the machine-readable `reason`, never on the prose.
- **One real bug caught while building:** `onClick={handleSend}` would have passed React's MouseEvent as the new first parameter `consentOverride` — truthy — turning *every* ordinary send into a silent override. It is `onClick={() => handleSend()}`, with a mutant pinning it.
- **Tests:** 29 in `send-manual-sms.test.ts`, 34 in `sms-send-route.test.ts`, 33 in `sms-composer.test.tsx`. **22/22 mutants killed** across all three layers. One known *equivalent* mutant is documented in the route suite rather than reported as a survivor.

### G29 · No board or stage editor, no hand-made card · **L** · **BUILT 2026-09-23**
- **`/admin/pipeline/settings`** — a coach reshapes a board's stages (reorder, rename, retime, add, remove with a destination for the cards that are on it), creates and archives boards, and files a person onto a board by hand from the board itself. Every reshaping used to be a migration.
- **The hand-made card enrols nobody, and that is structural, not a flag.** It never calls `recordContactEvent`, the only caller of `enrollIfTriggered`, and `__tests__/lib/lead-engine/enroll-call-site-inventory.test.ts` pins that call site at exactly one so the next author cannot quietly add a second. Filing ten old leads on a Sunday sends zero emails.
- **Migrations `00276`** (one atomic whole-list stage save, mirroring `save_sequence_steps`) **and `00277`** (the move destination must be a stage of THIS board that is staying — without it a crafted request relocated cards onto another board, where they rendered on neither).
- **Two invisibility doors closed, both found by the whole-branch review, not by the nine task reviews:** flipping a stage's kind from `won` to `open` hid every closed card on it, and so did sending a closed stage's cards to an open destination. `readBoard` filters open columns on `outcome IS NULL`, so either one put finished deals on no screen while they still counted in revenue.
- **Verified on production 2026-09-23**, not only in tests: a reorder saved through the real UI, round-tripped to the database, and was restored. Four cards filed through the real dialog on the dev clone produced 0 `sequence_runs`.
- **Deliberately not built:** a board can be archived but not un-archived from any screen (`listPipelines` is active-only). The UI says so before the click, the confirm is two-step, and no cards are deleted. Restore is `listAllPipelines` + a button whenever the owner wants it.

---

## Phase 4 — White-label: the third promise, made true at the edges

### G30 · Transactional lead mail is hard-wired to DJP Athlete · **M** · **BUILT 2026-09-23**
- Was: inquiry alert (`to: sales@`, `cc: darren@`), inquiry auto-reply ("Coach Darren / DJP Athlete", GHL booking link), funnel lead alert (`darren@` always first), chat handover, quiz alert — all `from: RESEND_FROM_EMAIL` in the DJP-wordmarked `emailLayout`.
- **Shipped when:** each takes `businessId`, sends from `sender_name <sender_email>`, replies to `reply_to`, addresses the coach at `reply_to` (plus the funnel's own `notify_emails`), renders `display_name` / `logo_url` / `postal_address` in the layout, and links the booking page from the tenant's connection rather than the GHL widget. The no-brand-literals test's ROOTS grow to cover these senders.
- **Built on branch `worktree-g30-tenant-lead-mail` off `main@1056a5c6`, merged `d3e282e6`.** No migration: every column was already on `business_settings` and already read by `getBusinessSettings()`. Decision 9 held — alerts go to the tenant's own `reply_to`, and `notify_emails` stayed additive rather than becoming the destination.
- **THIS ROW SHIPPED ONE CLAUSE OF ITS OWN "SHIPPED WHEN" SHORT, on purpose.** The auto-reply's booking button is still this platform's GoHighLevel widget, offered to every applicant whoever they applied to. Swapping it for the tenant's own connection is a different subsystem (`coach_calendar_connections.scheduling_url`, already read by `lib/calendly/config-for-business.ts`, which correctly gives a business with no connection NOTHING rather than this platform's calendar) and it changes where real DJP traffic books. Carried as an open item under §Everything still waiting on the owner. **Everything else in the clause list is done.**
- **The five moved to `lib/email/lead-alerts.ts`, and that was forced by the test, not by taste.** The shipping condition was that `no-brand-literals.test.ts` covers them, and that sweep scans FILES — `lib/email.ts` is ~2,700 lines of this platform's own athlete-facing mail (password resets, verification, newsletter) and can never be pointed at. So the senders had to leave, which forced the layout helpers out first into `lib/email/layout.ts` as a pure move, committed and verified `tsc`-identical before anything else was touched. `lib/email.ts` re-exports all five, so no caller changed its import.
- **`assertSendable` and `BusinessNotConfiguredError` moved to `lib/email/business-identity.ts`** and are re-exported from `lib/lead-engine/email.ts` unchanged. They had to leave that file because it builds its Resend client at module scope — importing it from a route would turn a missing API key into an import-time crash. Copying the rule would have left two sendability gates free to drift.
- **`to` is a parameter only where the recipient is NOT the coach.** The inquiry auto-reply keeps it (the destination is the applicant). The other four read `reply_to` themselves, so exactly one place decides which column addresses a coach — `runEscalation` and the quiz route both stopped reading settings and now hand over a `businessId` alone.
- **Two failure modes kept distinct, because their fixes differ:** a tenant missing `postal_address` may not lawfully send at all; a tenant with no `reply_to` may send but has nobody to be told. The two flag-returning senders report both as `{ delivered: false }` with separate log lines naming the field; the three throwing senders throw. A settings read that FAILS throws in every case — a database outage must not be filed as `not_configured`.
- **The permissive case is built and tested:** a blank `reply_to` does NOT stop the auto-reply, because there the destination is the applicant's own address and refusing would leave a person who just applied with silence.
- **Test:** `__tests__/lib/email/lead-alerts.test.ts`, 36 cases, every one asserting a value came from settings with the old constant absent and every absence assertion paired with a presence control. **34 planted mutants, all killed** — constant `from`, hardcoded `to`, restored CC, swapped `replyTo`, platform layout in place of the tenant one, both refusal gates removed, case-sensitive de-duplication, and each route quietly dropping the tenant id. Two were deliberately permissive mutants (the auto-reply wrongly refusing a blank `reply_to`); both were caught.
- **ROOTS grew by three** — `lib/email/lead-alerts.ts`, `lib/email/business-identity.ts`, `lib/quizzes/alert.ts` — and the sweep was checked for vacuity by planting this platform's name in each in turn and confirming it fails.
- **WHAT THE SWEEP CANNOT SEE, written into the test beside the new roots** so a green run is not over-read: it matches NAMES, so a platform-owned URL passes untouched. That is exactly why the booking widget above is spelled out in the swept file as `PLATFORM_BOOKING_LINK` rather than imported from somewhere the sweep cannot reach. `lib/email/layout.ts` is deliberately unswept — it holds the platform's chrome for the ~35 app emails that still want it, and what keeps the alerts off that fallback is a type (`tenantEmailLayout` cannot be called without a settings row), not a regex.
- **Production impact, measured before merging rather than assumed.** One tenant, every settings field filled, `reply_to` = `darren@darrenjpaul.com` — which IS the old `ADMIN_CC`. So the chat handover, quiz alert and funnel lead alert keep their existing destination. The inquiry alert does not: it was `to: sales@` + `cc: darren@` and is now `darren@` alone, so **`sales@darrenjpaul.com` stops receiving new-inquiry alerts.** That is decision 9 working as specified, but it is a mailbox going quiet.

### G30b · Every sender fallback named a Resend domain that is gone · **S** · **BUILT 2026-09-23**
- Found while checking G30 was safe to deploy. `GET https://api.resend.com/domains` returns exactly ONE row: `mail.darrenjpaul.com`, verified, us-east-1, created 2026-09-20. **`send.darrenjpaul.com` is not in the account at all**, and the apex never was.
- Five `RESEND_FROM_EMAIL ?? ...` fallbacks still named the old subdomain — `lib/resend.ts`, `lib/email.ts`, `lib/messaging/email-new-message.ts`, `functions/src/newsletter-send.ts`, `functions/src/lib/notify-job-done.ts`. An unset variable would have sent from a domain the account does not have: "domain is not verified", messages dropped — the 2026-08-31 fault with the subdomains swapped.
- **Nothing was broken today, which is what made it easy to miss.** `GET /emails` shows the last 100 production sends are all `Darren J. Paul <noreply@mail.darrenjpaul.com>`, app mail included. The Firebase runtime binds `RESEND_FROM_EMAIL` as a secret, so its two copies are backstops too. A fallback only runs when something else has already failed — precisely when it must work.
- **THE LESSON, and this comment had been wrong twice by the time it was fixed:** it first claimed Resend verifies `send.` ONLY, then was "corrected" to say `mail.` was verified *too*. Both were inferences from a DELIVERY LOG — what `business_settings.sender_email` happened to name, what had delivered recently. **A delivery log tells you what someone CHOSE; only `GET /domains` tells you what is ALLOWED.** The note now in `lib/email.ts` records that so the next reader queries the list.
- `lib/email/sender-domains.ts` is deliberately untouched: it reads the live list at runtime so its behaviour cannot go stale, and its mentions of the old subdomain are the 08-31 incident narrative plus one illustrative example that doubles as a test fixture.

### G31 · The funnel subsystem has no `business_id` · **L** · **BUILT + MERGED 2026-09-25**
- Was: `funnels`, `funnel_steps`, `funnel_step_versions`, `funnel_submissions`, `funnel_step_turns`, `funnel_checkout_grants`, `lead_magnets` with no tenant key, every reader over them unscoped, and `/go/<slug>` resolved by slug alone.
- **Shipped when:** add `business_id NOT NULL DEFAULT` platform (tolerate the old schema for one deploy), tenant predicates on every `lib/db/funnels.ts` and `lib/db/funnel-leads.ts` reader, `/go/<slug>` resolved by Host then slug (slugs unique per business), `loadCatalogues()` unfrozen, `platform.ts` inventory updated and the `SINGLETON` comment in `lib/db/funnels.ts:572` retired. Tests per reader (mutate the predicate VALUE, not the arity). **All of it done.**
- **Built on `worktree-g31-funnel-tenancy` off `main@534c21b4`. TWO MERGES, deliberately: `2c3a659d` (migration `00278` alone) then `2b4dd3c1` (the code).** Spec `docs/superpowers/specs/2026-09-24-funnel-tenancy-design.md`, plan `docs/superpowers/plans/2026-09-24-funnel-tenancy.md`. 22 commits, 115 files, +6450/-946.
- **THE ROW UNDERSTATED ITS OWN SCOPE, measured not inherited.** It names two DAL files; there are **seven** — `funnel-builder.ts`, `lead-magnets.ts`, `funnel-checkout-grants.ts`, `funnel-page-tree.ts` and `funnel-schema-support.ts` join the two — and **47 exported functions, not 29**, of which 45 needed the tenant and 2 are genuinely pure (`searchClause`, a string builder; `__resetIntakeColumnCache`, a test hook). A grep for bare table access across `app`, `lib`, `components` and `functions/src` found nothing outside those seven, so the DAL boundary does hold.
- **`funnels.slug` was ALREADY unique** — `pg_constraint` does not list plain unique *indexes*, and `funnels_slug_key` is one, on `lower(slug)`. There was no latent duplicate-slug bug; what changed is that index's scope. `lead_magnets_slug_key`, by contrast, is a table CONSTRAINT, so it needed `drop constraint` — `drop index` is refused on a constraint-backed index and would have **failed the migration on production**.
- **Why two merges.** `apply-migrations.yml` applies on push while Vercel is still building and nothing sequences the two. Shipping the predicates alongside the column would have meant a "column missing? read unscoped" fallback in 47 readers, and a tolerance path that never turns off is a cross-tenant leak nobody sees. Push 1 carried the spec, the plan, the migration and its test — **no application code** — so every deployed reader kept working on the column's DEFAULT. Push 2 followed only after the migration was **confirmed applied to production**: 7 columns, 5 cascading composite FKs, per-tenant slug indexes, 0 nulls across 9 funnels. **The DEFAULT must outlive this branch**; dropping it is a later row and needs the seed/capture scripts fixed first (below).
- **Composite FKs REPLACE the simple ones, never supplement them.** The leads inbox embeds `funnels` and `funnel_steps` through `funnel_submissions`, which has an FK to both; two relationships per pair makes PostgREST answer `PGRST201` instead of rows. `00252` hit this for events and the fix is followed here, with `ON DELETE CASCADE` carried onto all five — `deleteFunnel` and `deleteStep` depend on that cascade.
- **TWO DEFECTS NO UNIT TEST COULD HAVE FOUND, both caught by the live two-tenant run:**
  - **The leads inbox was 500ing for every tenant.** Its embed used a `:column` hint (`funnels:funnel_id`), which cannot resolve against a composite FK — PostgREST returned `PGRST200`. Not a tenancy leak: a full admin-surface outage. Every mock-based test passed, because they all mock PostgREST. Worse, the spec's own instruction to "preserve the embed string byte-identical", and the test written to enforce it, actively **pinned the bug**. Fixed to `"*, funnels(name, slug), funnel_steps(name)"`, which works only because the FKs were replaced rather than supplemented.
  - **`?preview=1` leaked another tenant's unpublished funnel.** It gated on the GLOBAL session role and then resolved the tenant from the Host, so a `staff` member of tenant B could read tenant A's draft on the platform host. Now requires membership of the resolved tenant and fails closed on a read error.
- **Two more the whole-branch review found in seams between individually-correct tasks:** `SlugTakenError` was thrown by the DAL while both routes still classified by the substrings "duplicate"/"unique", so a reused slug 500'd where it used to 409; and two admin pages called `resolveAdminTenant()` unguarded, rendering a 500 page instead of `notFound()`.
- **The funnel-window cron iterates businesses** (`listBusinesses({activeOnly:true})` then per-business), with per-business and per-funnel isolation. Resolving a single tenant would have left a second tenant's expired page published forever while the cron reported success nightly.
- **A funnel purchase is now filed under the FUNNEL's tenant, not the payer's.** `createFunnelProgramCheckoutSession` stamps `businessId` into the Stripe session metadata and the webhook prefers it, **falling back to `payerBusinessId` when absent** — sessions created before the deploy still complete, so that fallback is not optional. Without this, coach B's sale landed on coach A whenever the buyer was already A's contact, plus an idempotency false negative that silently re-ran account creation, program assignment and the welcome email.
- **Verified:** `tsc --noEmit` 238 errors / 54 files with a per-file set byte-identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`, re-run on the MERGED tree because `main` had moved; `npm run build` exit 0 on the merged tree; `SINGLETON_BUSINESS_ID` unchanged at 5; all four `__tests__/lib/tenancy/` suites green including both inventory reverse-checks; **19/19 checks driven over real HTTP against a second tenant in the dev clone**, cleanup verified on all four runs.
- **Deliberately not done, and each is recorded rather than implied:** `resolvePublicTenant` is not wrapped in react `cache()`, so `/go` does two `business_domains` lookups per render and a transient failure on exactly one can render one tenant's metadata over another's body — the fix touches all ~27 callers and was not worth taking unreviewed. Seed and capture **scripts** still omit `business_id` and look parents up by slug with no predicate; they must be fixed **before the column DEFAULT can be dropped**. `programs`, `session_pack_products` and `faqs` have no `business_id` column at all, so `loadCatalogues` leaves those three reads untenanted — an honest gap, commented in `resolve.ts`, not a missed conversion.
- **`scripts/verify-funnel-tenancy.ts` is not run by CI**, and it is the only thing in the repo that can catch a live PostgREST fault of the kind that 500'd the leads inbox. Wiring it in is the highest-value follow-up this row leaves behind.
  - **Answered 2026-09-25, differently from how it was asked.** The script itself cannot usefully run in CI: it needs `next dev` (the dev-login bypass 404s under `NODE_ENV=production`), it writes fixtures into the shared dev clone, and branches reach GitHub only when merged, so a GitHub job could only report the fault after it deployed. What catches the fault class instead is `npm run test:integration:selects`: every `.from().select()` in the deployed code, with the `.order()` columns applied to it (1,283 select sites and 471 order columns, about 780 distinct probes), sent to the dev clone with `limit=0`, read-only, in about fifteen seconds. Its controls prove that G31's exact hint still answers PGRST200, and restoring that hint fails the run at all four call sites. It is the pre-merge gate (CLAUDE.md), with a post-merge backstop workflow. **Its first run found five live faults no mocked suite had seen** — see G25's regression note, and `KNOWN_REFUSED` in the test for the three left for the owner.

### G32 · A new tenant gets no sequences · **M** · **DONE (merged + pushed + applied to production 2026-09-26, `a04f2603`)**
- `create_business()` (`00249`) seeds Coaching only. Ship a sequence template set copied on create (the twelve keys, brand-free bodies, all `draft`), plus the two extra boards. Test parses the function and a fixture run proves twelve `draft` rows for a new business.
- **Built on `worktree-g32-business-starter-set` off `main@5b580027`. MERGED 2026-09-26 as `a04f2603` on the owner's word (`--no-ff`; merged tree `60060f41` byte-identical to the gated branch tree, `main` had not moved), and pushed.** The migrations workflow (run 36242500925) logged "applied 00279_business_starter_set.sql" on production. **Read back on production the same evening:** Primary still has 12 sequences (none draft), 3 boards, and nothing created by the migration, so the backfill was a no-op there as predicted. Anon and authenticated have no EXECUTE on the four functions; service_role does; `create_business` calls the helper. Worktree and branch deleted, review record preserved in `.superpowers/sdd/2026-09-26-g32-business-starter-set/`. Spec `docs/superpowers/specs/2026-09-26-g32-business-starter-set-design.md`, plan `docs/superpowers/plans/2026-09-26-g32-business-starter-set.md`. **One migration, `00279_business_starter_set`, applied to the dev clone 2026-09-26** (by sending the committed file to the Management API, since `apply.mjs` refuses the dev clone; recorded in its `schema_migrations`). Not applied to production: the migrations workflow does that on push.
- **The owner ruled four things (2026-09-26), and approved the design's first section:**
  1. Scope: the whole row now, knowingly as groundwork (a new business cannot use the sequences yet, see below).
  2. **Eleven, not twelve:** every platform sequence except `sms_repermission`, which was a one-off for GHL-imported contacts. The row's "twelve" predates that ruling.
  3. The wording is a **light edit of the approved copy**, every change listed for approval.
  4. The set lives in a **SQL helper in a migration**, not a TypeScript module or a template table.
- **What was built:**
  - `seed_starter_board`, `seed_starter_sequence` and `seed_business_starter_set` (plpgsql). They add each board and each sequence only when that business has none with that key, so they are safe on any business any number of times. `create_business()` keeps its six-argument signature and calls the helper instead of inserting Coaching itself, so the three boards are defined in one place and a business is never half-provisioned. Grants restated: anon and authenticated can execute none of the four; `create_business` is granted to service_role.
  - Every sequence is `draft`, keeps the platform's `trigger_source`/`trigger_filter`, and has an explicit cooldown (0 for the four `quiz_*`, 30 otherwise). Every insert names `business_id`, because all four tables default it to the platform.
  - The two extra boards are stamped `now() + 1 ms`, so every business lists Coaching first (a single `now()` would have listed it last).
  - The migration backfilled every business keyed on absence. **Dev clone: the 7 test businesses each gained 2 boards, 8 stages and 11 draft sequences (91 steps); Primary unchanged (12 sequences, 93 steps, 3 boards).** On production the backfill should change nothing, because Primary already has every key (ledger reads of 2026-09-20/23). Production was not read.
  - **The wording** (58 fields, the full list in the spec §2.2): every email greets with `{{first_name}}`. The four older texts follow 00272's rules (plain ASCII, no `{{name}}`, one segment). "Athlete Quiz" became "quiz". "Already training with us" became "already have an account with us", which is what the branch actually checks. The in-person and spectator lines are gone from the camp copy, as is the coach alert's claim about an automatic email. All eleven descriptions are rewritten for a coach, with no internal names, Stripe or GHL. Structure is identical to the platform's.
  - `createBusiness` now maps a duplicate to "slug taken" only when it names `businesses_slug_key`. The longer function made a bare 23505 ambiguous. The admin route catches by type, so an unrelated clash is now a real 500, not a false 409.
  - Stale comments corrected in `lib/db/pipeline.ts`, the pipeline pages, `lib/automation/pipeline-reconcile.ts`, their tests and two capture scripts. The board fallback stays: a business can archive a board by hand.
- **What this does NOT do, so nobody assumes it:** a new business still cannot use these sequences. Nothing in the app writes `business_domains`, so every public form files under the platform. Only `users.role = 'admin'` can read, edit, switch on or enrol into a sequence. The owner cannot set the sender details sending requires (G34). Switching a draft on checks nothing (`findLivePlaceholders` has no caller), so the drafts are the only safety, and only the operator can switch one on. **A future copy migration** that rewrites a sequence by key now reaches every business's drafts. It must say which businesses it touches, and must replace `seed_business_starter_set` in the same migration if new businesses should get the change (the migration header says so).
- **Discovery found four things outside this row, recorded as G46-G49 below.**
- **Verified:** migration static test 21/21, then 26/26 with the live half on the dev clone (5 live tests, none skipped). The live half creates a throwaway business through `create_business`, proves the boards (Coaching first), the eleven drafts, every step filed under it and the platform unchanged, then re-runs the helper to prove it adds back only a deleted sequence and leaves an edited draft alone. It deletes the business afterwards; 0 left over. Six static mutants and two live mutants each turned red. `businesses.test.ts` RED→GREEN, with its 60 importer suites (1,076 tests) green. The pipeline and reconciler suites whose comments changed are green (178 + 34). tsc 238 / 54, per-file identical to the baseline. `test:integration:selects` 22/22. `npm run build` exit 0. Screenshots from the real app on the dev clone: `screenshots/g32-business-starter-set/` (a backfilled business's eleven drafts and its three boards, annotated). Five task reviews plus fix rounds; final whole-branch review (Opus): ready to merge with fixes; nothing that changes behaviour; its comment/doc fixes landed before merge (this commit range). It confirmed the dev clone's four function bodies are byte-identical to the file, the grants, that drafts cannot be enrolled or claimed, and that the deploy order does not matter.

### G33 · `sms_sender_phone` is saved un-normalised · **S** · **BUILT 2026-09-25**
- Normalise to E.164 in `lib/validators/business.ts:76-81` and the form; inbound match is verbatim (`lib/db/businesses.ts:200-205`). Retire the stale "dormant" comment. Test: national format rejected or normalised.
- **BUILT 2026-09-25.** No migration. `businessSettingsPatchSchema.sms_sender_phone` is now a transform: `''` stays `''` (not configured), a number that starts with `+` and that `normalisePhone` (`lib/lead-engine/identity.ts`) calls valid is saved as E.164, and anything else is refused beside the field. The form (`BusinessSettingsForm`) validates with the same schema through `zodResolver`, which submits the TRANSFORMED value, and the route parses the body again, so the transform is idempotent on E.164 and a test pins both passes.
- **National format is REFUSED, not guessed** (the decision taken before building). Read with a default country of US, Mexico City's `55 1234 5678` is a VALID US number, `+15512345678` (checked against libphonenumber, not assumed), so a default would work for a US coach and silently file anyone else's number under +1. The message tells the coach to start with `+` and the country code "exactly as Twilio shows the number". *The first draft of this comment used a UK number as the example; the probe showed it reads as an INVALID US number, so it would have been refused, not mis-filed. The example was wrong, not the rule.*
- **The characters are checked before libphonenumber sees the value**: digits, spaces, `( ) . -`, and one `+` at the start. libphonenumber reads a number out of surrounding text and drops an extension silently, so `+1 202 555 0123 ext. 5`, `... abc`, `tel:+1...` and `+12025550123+` all parse as `+12025550123` without it. "Digits" means the four sets libphonenumber reads (ASCII, fullwidth, Arabic-Indic, Persian), so a coach on a Japanese or Arabic keyboard is not told a correct number is "not a phone number"; the saved value is ASCII E.164 either way. **The fullwidth PLUS (U+FF0B) stays refused on purpose:** libphonenumber lists it as a plus but does not treat it as "international", so it falls back to the US default and `＋65 8123 4567` (Singapore) would save as `+16581234567`, a valid Jamaican number. The review's first suggestion was to accept it; its own verifier found this.
- **The row's own pointers were stale, and this change moved one of them.** The field was at `business.ts:69-74`, not `:76-81`. The inbound match is `getBusinessBySmsNumber` in `lib/db/businesses.ts`; this change added 20 lines above it, so the `:200-205` range above now lands in its doc comment (go by the function name). The "dormant, no admin route writes this field yet" comment was already false: `BusinessSettingsForm` had a free-text input for it. Comment replaced; the input now has a placeholder (`+1 202 555 0123`) and a hint it is described by.
- **One addition the row did not ask for: a taken number answers 409, not 500.** `00247`'s partial unique index lets one business per number. Normalising makes that index see clashes it used to miss (`+1 202 555 0123` and `+12025550123` were two strings to it), and before this a clash was a raw PostgREST error, a 500, and a form saying "try again". `updateBusinessSettings` now maps a 23505 that names `sms_sender_phone` (index name in `message`, column in `details`) to `SmsSenderPhoneTakenError`, and the route answers 409 without naming the other business, which is another tenant. Any other unique violation is rethrown as it came (a control test pins that). The message says **"The settings were not saved"**, not "nothing was saved": the route writes a body's `business` half first, with no transaction around the two, so a request carrying both has already changed the business row. The form sends `settings` only, so only a direct API caller sees that case.
- **Stored values are NOT re-normalised.** It cannot be done in SQL (libphonenumber is not in Postgres). The dev clone's 8 rows are all `''` (measured 2026-09-25). Production was not readable from this session; `lib/db/businesses.ts`'s own doc comment says every live row has it empty. **What an old value does on the next save depends on the value.** One that starts with `+` and is valid is normalised. Any other one (a national number, or an E.164-shaped number libphonenumber calls invalid) makes EVERY save of the settings form fail, whichever field was changed, until the phone field is corrected or cleared, because the form submits every field and validates the whole patch. The error shows beside the phone field, so the cause is visible, and such a value never matched an inbound text anyway. The only other writer, `scripts/configure-lead-engine-sms.mjs`, checks the E.164 SHAPE only (`/^\+[1-9][0-9]{6,14}$/`), not validity, so it can write a value the form then refuses; its own usage example, `+15551234567`, is one.
- **Limits, stated so nobody assumes otherwise:** validity comes from libphonenumber-js's bundled metadata (1.13.11), the same check lead capture uses, so a number range newer than that metadata would be refused until the package is bumped. Short codes and alphanumeric sender IDs are not accepted here (the free-text field used to take them); those senders go through the Messaging Service SID field, which inbound resolution tries first.
- **Reviewed by a five-lens workflow** (validator, downstream readers, form, error mapping, tests and claims), each lens followed by a verifier told to refute it. 10 findings came back, all minor and all confirmed, 9 of them distinct; every one is fixed above or in the tests. The readers lens settled the one real worry: the chat assistant's number check grounds replies on the stored sender number, so an E.164 value would refuse a reply that writes it as "(202) 555-0123". But the model is never shown that number (`buildSystemPrompt` lists display name, postal address and timezone only), so no honest reply can contain it.
- **Verified:** new `__tests__/lib/validators/business.test.ts` (41), plus new cases in the form suite, the route suite and `__tests__/lib/db/businesses.test.ts` (80 across the four); every suite that imports the validator, the business DAL, the settings route or either business form, 41 files / 824 tests, green (the live-model lane `chat-live` excluded). Mutation-checked, each failing where it should: validate without transforming (11 failures across validator, route and form); drop the `+` rule (7, measured on the first version of the suite); the `+` rule answering with the WRONG message (12: every national case, the route's 400 and the form, which only fail since the assertions name the exact message); accept any characters (6); allow `+` anywhere (1, and only after adding `+12025550123+`, because libphonenumber already refused the first mid-`+` fixture on its own); ASCII-only digits (the three scripts plus fullwidth national); map every 23505 regardless of column (the control); `zodResolver(..., { raw: true })` (the form's E.164 case); a form that never renders the field error (the form case, which the hint used to satisfy); a 409 that says "Nothing was saved" or echoes the error (the two 409 cases). tsc 238 / 54, per-file set identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`. `test:integration:selects` 12/12. `npm run build` exit 0 (the settings form is a client component, and it now carries libphonenumber-js). `SINGLETON_BUSINESS_ID` still 5. Lint not run (broken repo-wide).
- **Driven in the real app**, signed in on the dev clone, on `/admin/businesses/<Primary>`: `screenshots/g33-sms-sender-phone/` shows the empty field with its hint, a national number refused, and an extension refused, captured by `scripts/capture-g33-sms-sender-phone-screenshots.mjs`, which throws if the form sends a PATCH (it sent none). The 409 was not captured: it needs two businesses on the shared clone to claim one number, so the tests carry it.

### G34 · Settings are owner-only · **decision, scoping**
- `/admin/businesses` is in `OWNER_ONLY_PREFIXES`. Letting a tenant coach edit their own branding touches the "do not elaborate permissions" invariant in `CLAUDE.md`; it belongs in the SaaS direction spec, not here. Record the decision; no code until then.

### G35 · Readers with no tenant predicate · **S → M** · **DONE (merged + pushed + deployed 2026-09-26, `79320de8`)**
- Chat facts read `faqs`, `programs`, `testimonials` with no `business_id` (those tables have none — a seam to name in `platform.ts`); `hasConsent` is keyed on contact UUID only; campaign-revenue reads `marketing_attribution` without one (no column). Name each seam honestly in `lib/tenancy/platform.ts` or add the predicate where a column exists.
- **Its one owner question is answered: owners, in-app.** It asked where the SEO and social agents' admin alert should go. Both read a `profiles` table that does not exist, so PostgREST answered `PGRST205` on every run and no agent alert has ever reached anyone. The owner ruled neither "the first admin user" (which makes an untenanted reader live) nor the tenant's `reply_to` email: the alert is a bell row for each **owner** of the job's business. Both `profiles` entries are deleted from `KNOWN_REFUSED`, in the same commit that stopped reading `profiles`.
- **Built on `worktree-g35-untenanted-readers` off `main@8b7fb0e6`. MERGED 2026-09-26 as `79320de8` on the owner's word (`--no-ff`; the merged tree `7f12a476` is byte-identical to the gated branch tree, because `main@af4c41c3` had been merged into the branch and gated first), and pushed.** Deployed by the push: Vercel "Deployment has completed"; Firebase functions run 36229709928, 85 "Successful update operation", 0 errors; select-contract backstop run 36229709947 success. No migration. Worktree and branch deleted. Spec `docs/superpowers/specs/2026-09-25-g35-untenanted-readers-design.md` (`4f3fa23b`), plan `docs/superpowers/plans/2026-09-25-g35-untenanted-readers.md` (`10ba091d`). No migration. One commit per spec section, listed below.
- **THE ROW NAMED THREE READERS. THE SWEEP FOUND A CLASS, and that is why it grew from S to M.** Before designing, a discovery workflow (five investigators and a completeness critic, 13 claims re-checked) swept every read of the 38 tables that carry `business_id`: **197 read sites, 41 with no business predicate.** Most of the 41 are safe by construction: keyed on a webhook id, a token, or an id that came from an already-scoped read. The critic then found what the sweep could not see by construction: readers of tables with NO `business_id`, behind a staff permission an owner can grant or a public route that resolved another business's Host. That class became the new shelf (D1) and most of G36-G45 below.
- **Production has one business** (`Primary`, measured 2026-09-23), so nothing here was leaking in production. Every item was a fuse for the white-label destination, not an incident. The dev clone has second businesses, and that is where the cross-business paths could be reached.
- **The owner ruled four things (2026-09-25):**
  1. **Scope:** fix the readers where the tenant is already in hand, name every no-column seam honestly, and record the large ones as new rows with the owner's questions. Not "only what the row says", and not "make the admin AI chat and `/admin/programs` owner-only now".
  2. **Show nothing:** the chat's facts and a funnel's live FAQ and testimonial sections give a business that is not the platform NOTHING, never the platform's rows. The chat's Calendly offer already follows this rule.
  3. **Agent alerts go to the owners** of the job's business, as bell rows.
  4. **Contact and inquiry bells go to owner + coach:** the site business's members with role `owner` or `coach`.
- **What was built, one commit per spec section:**
  - **A1 · `115306ef` · consent.** `hasConsent(contactId, channel, businessId)` filters on the business in the query, before the limit, so another business's newer revoke cannot cancel this business's grant either. `contact_consents` has two separate foreign keys and no composite, and its `business_id` defaults to the platform's id, so nothing in the schema kept a consent row's business equal to its contact's (dev clone: 0 of 59 rows mismatched). All three callers already held the tenant. `contactsWithEmailConsent`'s claim that the report and the engine cannot disagree is now true by construction instead of true by data.
  - **A2 · `4df9c2db` · bookings.** `PATCH /api/admin/bookings` (permission `schedule`, which the Coach preset grants) resolved no tenant and filtered on id alone, and it returned the row with the contact's name, email and phone. It now resolves the admin tenant (403 when there is none). `getBookingById` and `updateBookingStatus` take `businessId` first and filter the UPDATE as well as the read. A booking of another business, or no booking at all, answers 404 before anything is written (a missing row used to be a `PGRST116` and a 500). `getBookingsInRange` takes the tenant, so the Daily Brief lists the business's own calls. `getUpcomingBookings` had no caller and read every business's bookings; it is deleted.
  - **A3 · `ebe9b3a9` · chat conversations.** `getConversation(id, businessId)`: the tenant is required and always applied (it was optional, and both public routes passed none). `/api/ask` and `/api/ask/capture` resolve the Host before reading, so a conversation id from another business's site reads as absent: both `/api/ask` and `/api/ask/capture` answer their existing 404, and nothing is created (Ruling R7; the spec's "starts a fresh conversation" was overruled, and the spec now says so). `runEscalation` reads under the conversation's business. `readContactIdentity(businessId, contactId)` is fenced too, and **the spec missed its second caller**: the pipeline grant route (`app/api/admin/pipeline/grant/route.ts`) was ported in the same commit. The capture route joined the Host boundary's inventory in `lib/tenancy/public.ts`.
  - **A4 · `396d7860` · quizzes.** `getQuizDefinition(businessId, quizId)`. Nothing compared a quiz's business with an attempt's, so business B's host could open an attempt (stamped B) on business A's quiz, and submit filed B's contact, card and consent row against A's quiz. Progress now resolves the Host first and refuses an existing attempt stamped with another business (404). Submit reads under the attempt's business and still resolves nothing, which is the invariant `platform.ts` records. `getAttempt` stays keyed on its id, a bearer token issued to the visitor, and its doc comment says why. **The spec missed `QuizIsland`**, which reads the quiz too. A Host read there would hide a coach's own quiz from their preview canvas (on the previews the Host is the admin's), so this commit added the required `FunnelRenderContext.businessId`: set from the Host by `/go`, and from the admin tenant by both preview routes. B2 uses the same field.
  - **A5 · `9acdbdd0` · bell alerts.** The contact and inquiry routes belled every `users.role = 'admin'` row, whichever business's site the lead came from. They now bell the site business's owners and coaches through one reader, `listBusinessMemberUserIds(businessId, LEAD_ALERT_ROLES)`. This changes three things the owner will see; they are (a) to (c) below.
  - **B1 · `d56337b6` · chat facts.** `searchPublicFaqs`, `listPublicProgrammes` and `listPublicTestimonials` take the conversation's tenant and return `[]`, before any query, when it is not the platform. The tool executor passes it through one `tenantFor()` guard, which throws on a turn with no tenant. A coach's `/ask` assistant now says it does not know, instead of quoting the platform's prices and clients as that coach's.
  - **B2 · `69147da5` · funnel islands.** `FaqIsland` and `TestimonialsIsland` receive the render context and show nothing off the platform, before any read. They use the route's tenant, not `resolvePublicTenant()` inside the island: on the preview routes the Host is the admin's, and the preview must agree with `/go`, whose disagreement G31 called this subsystem's worst failure.
  - **B3/B4 · `d451a2ff` · builder catalogue, publish gate, build prompt.** `loadCatalogues` answers `faqPageKeys: []` and a new required `liveFeedsAvailable: false` for any business that is not the platform, without reading `faqs`. `resolveDoc` records a live FAQ or live testimonial section there as an `UnavailableLiveFeed`, not an `UnknownFaqKey`: that one's "no page has FAQs yet" would send the owner to add rows that still would not show. `publishGate` blocks on it. Nothing inspected testimonial sections before. The build route's own FAQ-key read follows the same rule, and its Block B tells a non-platform builder to use inline FAQs, and a quoted testimonial only for words the owner gave verbatim (that last half is the final review's F1; the first wording asked for "quoted testimonials written for this business", i.e. invented ones). All five new `platformBusinessId()` callers of B1-B3 are named on the NARROWER VARIANT shelf.
  - **C1 · `a87162e4` · the agent job carries its business.** The weekly SEO cron, the Tue/Thu social cron and the manual social run stamp `businessId: platformBusinessId()` into the job. The manual route uses the PLATFORM id, not the admin's selected business, though it has a session: every table the agents read or write has no `business_id`, and their subject is the platform's own blog (CORRECT BY CONSTRUCTION shelf). The tests mock the seam to a distinct id, because `SYSTEM_USER_ID` and the platform business id are the same literal, and a test on the real id cannot tell the stamp from `userId`.
  - **C2-C4 · `0eb8efb5` · alerts to owners.** `notifyBusinessOwners` (`functions/src/lib/`, a functions-only helper: `functions/` cannot import `lib/`, and the Next.js member reader, `listBusinessMemberUserIds`, is deliberately different — owner + coach, and it inserts nothing) reads `business_members` for `role = 'owner'` with literal select strings the select contract probes, checks the read error, and inserts one bell row per owner. It returns the FIRST owner's notification id (`created_at`, then `user_id`), because the outcome tracker resolves a flag by reading one notification by id: "acknowledged" means that owner read it. A job with no `businessId` skips its alert (the SEO flag returns `executed: false` with a reason) and never defaults. `seo-agent.ts` now logs each action's error and rejection reason; it dropped them before, which is why the `PGRST205` stayed invisible. The social alert links to `/admin/strategy`, because `/admin/social-agent/memos` is not a page. Deploy order does not matter: new functions with an old route skip the alert, and old functions ignore the new field.
  - **D1/D2 · `85451da6` · UNTENANTED BY SCHEMA.** A new shelf in `lib/tenancy/platform.ts` names twelve readers (19 reads) of tables with no `business_id`, on surfaces a second business can reach. Each entry names its table, its surface, who reaches it, and the row that owns it (G04, G31, G37, G38, G40, G42, G43, G45). The inventory test keeps the shelf true: each read must still be inside the function named for it, no migration may add `business_id` to its table, every path the shelf names must be an entry, every function its entries name must be an entry's function or a stated context name (added by the final review, F5: the path check alone passed with a row of a multi-row file dropped; it still cannot see a dropped TABLE row of a function that keeps others, or a route-handler entry, and the test says so), and a fixture for a table that HAS the column (`events`) must fail. The live select contract probes `select=business_id` on each shelf table and expects `42703`, the only check that sees a column added outside the migrations. The same commit reworded the NARROWER VARIANT shelf's header, which described only the fallback case: five of its entries consult the seam as a COMPARISON instead (the chat's booking offer, the chat facts, the two funnel islands, the builder catalogue and the build route).
  - **D3 · `387dd833` · comments.** Every shelf read says in place that its table has no `business_id` and which row owns it, and the test fails for an entry without that note. Four comments that argued the opposite are corrected: the pipeline page's "nothing to scope"; `findAttributionForContact`'s phase-4 reason and its "user_id is never shared across businesses" (`linkContactsToUser` shares it by design); and the booking ingest's "nothing writes `contacts.user_id`" (G04 gave it writers).
  - **Final review · `f11dc869`, `770f6156`, `8454abec` + this ledger commit.** A six-lens whole-branch review with a verifier per lens (range `8b7fb0e6..04d8019f`) confirmed 13 findings, one of them important, and refuted one. All 13 are fixed (F1-F8) except one recorded under G45 by ruling. **F1 (important):** Block B's line told a coach's builder to write "quoted testimonials written for this business". The model has no real quotes, so that asked it to invent endorsements under the coach's brand. It now allows `source: "quote"` only for words the owner gave verbatim, and otherwise no testimonial section. **F2:** the automatic reviser never saw Block B, and Block A tells every model to prefer live feeds, so a review round could put a live feed back. It now gets the same line in its user message, on every round. **F3:** the builder canvas note on a live section sent every business to "your Testimonials list", which holds the platform's rows. Off the platform it now says the feed is not available and to switch to your own content. **F4:** the event island resolved the Host, so both previews could show a coach a different event than `/go`. It now reads under the render context like its siblings, and left `lib/tenancy/public.ts`'s caller list. **F5:** the shelf's reverse check is now function-level too. **F6-F7:** the S1 surface wording, and a test that read the dev clone. **F8:** this row, G44, G45, the headline and the spec, corrected as described in place.
  - **The session that started this fix wave died mid-run, and left a trap worth knowing about.** Its agent was killed while mutation-testing F3, between applying a mutant (`liveFeedsAvailable === true || true` in `render.ts`) and restoring it. So the working tree held a deliberately broken line that showed every coach the platform's "change them under Testimonials" note. It was found by reading the agent's transcript (the mutant edit's result arrived, the restore's never did, and the file's mtime was the mutant's), and restored before anything was committed.
- **FIVE BEHAVIOUR CHANGES THE OWNER WILL SEE:**
  - **(a) The inquiry's AI lead analysis now needs an owner or coach.** It is requested by the business's first owner or coach (fixed `created_at`, `user_id` order) instead of the first admin row, so `ai_generation_log` and the audit actor name that business's own person. A business with no owner or coach member, or a failed recipients read, gets no analysis, the same as "no admin" did before.
  - **(b) The contact route no longer stops when the recipients read fails.** It used to return early, which also skipped the platform inbox's email, the visitor's auto-reply and the GHL sync. The failure is now logged and all three still run.
  - **(c) Contact and inquiry bells go to the owners and coaches of the site's business.** In production that is the same people only if `Primary`'s owners still match the admins migration `00246` backfilled. A `Primary` member with role `coach` would newly get these bells. Staff do not, by the ruling. **Confirmed on production 2026-09-26 (read after the G32 deploy): 1 owner, 3 staff, no coaches, and the one admin user is that owner, so the same person is alerted as before.**
  - **(d) The coach-facing blocker names no brand.** The spec's wording said live FAQs and testimonials "come from DJP Athlete's own lists". It was built as "Live FAQs are not available for this business, so the section would show nothing. Switch it to your own FAQs (Inline)." (and the same for testimonials, ending "your own quotes"), because a white-label coach should not read the platform owner's name in their own builder.
  - **(e) The gate stops NEW publishes only.** A page a non-platform business had already published with a live FAQ or testimonial section now shows an empty section band. The island is the only guarantee, because `steps/[stepId]/publish/route.ts` lets a step with no section document through the gate. The dev clone has no such page, and production has one business, so there is none there either.
- **The row's consent example was the only consent reader that needed the predicate.** Suppressions were already per-business: `contact_suppressions_uniq` is `UNIQUE (business_id, identifier)` (`00215`), and `isSuppressed(identifier, businessId)` filters on it. Only `hasConsent` was missing it.
- **Deliberately not built, and where each one lives now:** everything in G36-G45 below. That includes the composite foreign keys and dropping the platform `DEFAULT` (G44), converting any subsystem G36-G39 names, and binding the checkout's product to the page (G40). The builder's "Content source" select still offers "Live" to a non-platform business. A live section chosen there shows the blocker on the preview banner and is refused at publish, and threading tenant data into the inspector was not worth it for a state the gate already stops. Also not built, and recorded here so nobody assumes otherwise:
  - **The contact form's EMAIL half still takes no business.** A5 routed the contact route's BELLS to the site business's owners and coaches, but `sendContactFormEmail` still goes to `INFO_EMAIL` cc `ADMIN_CC`, and `sendContactAutoReply` still sends the platform's copy ("Thanks for reaching out to DJP Athlete") with the platform's booking link. So another business's contact message lands in the platform's inbox, and its visitor gets the platform's auto-reply. The fix has G30's shape (the tenant's own `reply_to` and brand), and it is carried forward on that shape rather than widened into G35.
  - **The marketing site served on a coach's host.** It is the platform's own site in full, not a reader at a time; it belongs on the "output keyed to one host" shelf.
  - **Hard-bounce and shared-sender suppression policy.** Per-business suppression is already correct for STOP and unsubscribe (`contact_suppressions_uniq`, above). Whether a hard bounce on one business's send should suppress the address for every business on a shared sender is a policy question. It has no row of its own yet, and neither G38 nor G44 covers it; it is recorded only here, and belongs beside G38's newsletter decision when that is taken.
- **Verified, in three rounds.** (1) Whole branch at `387dd833`: every test file importing or mocking any of the 54 changed modules, 193 files / 2994 tests green (the live-model `chat-live` lane excluded); functions suites 4 files / 49 tests; functions build exit 0; tsc 238 / 54 per-file identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`; `test:integration:selects` 22/22; `npm run build` exit 0; `SINGLETON_BUSINESS_ID` 5. (2) The final fix wave: every test file importing a module it changed, plus the two inventory tests, 29 files / 904 tests; the 30th such file, `__tests__/integration/builder-colour-live.test.ts`, is a paid live-model probe outside the unit lane and was not run (tsc covers it). Every new test was seen red before its fix; F3's two mutants and F5's dropped-row proof were run live. A scoped re-review of the fix wave confirmed F1-F8 and found five minor items, all acted on. (3) **`main` (`af4c41c3`, the OpenRouter work) merged INTO this branch at `03905f2a`, and gated as the tree it will merge as:** 30 files / 925 tests (the fix-wave list plus main's new `build-route-recovery.test.ts`); G35's functions suites 4 / 49 and the functions tsc clean; tsc 238 / 54 per-file identical; selects 22/22; build exit 0; `SINGLETON_BUSINESS_ID` 5. Only this ledger line changed after that gate. Lint not run (broken repo-wide). Production was not read.

#### Found by G35's sweep (2026-09-25) — recorded, not built

Ten rows the G35 sweep and its critic found. None is built. Each carries its evidence and, where the spec says it needs one, the owner's question. Production has one business, so none of them leaks today; each is a fuse for the white-label destination. "Shelf entry S1-S12" means an entry on the UNTENANTED BY SCHEMA shelf, numbered as in the spec's §D1 table; `lib/tenancy/platform.ts` lists them in the same order, unnumbered.

### G36 · Grantable staff surfaces read every business's data · **M** · **owner decision**
- **The headline is the admin AI chat.** `/api/admin/ai-chat` sits behind `ai_tools` (`lib/permissions/registry.ts:577`), a checkbox an owner can grant, and runs about 46 tool reads with no tenant: clients' personal details, payments, orders, subscriptions, bookings, events and signups, attribution.
- The same holds for the blog, website-CMS, money, analytics and exercise-library surfaces, which read tables with no `business_id`. They are named here as whole subsystems, one decision each, rather than one reader at a time on the UNTENANTED BY SCHEMA shelf (its preamble points here).
- The precedent is `/admin/ads`, made owner-only (2026-09-04) for exactly this reason. That narrowed who can reach the reader; it did not scope it.
- **Question:** scope these surfaces, or make them owner-only (the ads precedent) before any of them is granted to another business's staff?

### G37 · Programmes, assignments and client lists are shared across businesses · **M/L** · **owner decision**
- Reachable through the Coach preset (`programs`, `contacts`, `lib/permissions/registry.ts:270-291`) by every second-business coach on the dev clone today. Such a coach sees the platform's private programmes, most of them named after an athlete; every assignment; and every client of every business. A public programme that coach creates goes into the platform's chat, because `programs` has no `business_id` and the platform's chat reads every public row.
- The readers are shelf entries S1-S5: `getPrograms`, `getAllPrograms`, `getProgramById` (`lib/db/programs.ts`); `getAssignments`, `getAssignmentCountsByProgram` (`lib/db/assignments.ts`); the copy-sources GET (`app/api/admin/programs/copy-sources/route.ts`), which returns each assignee's full name; `getClients` (`lib/db/users.ts`), the assign picker's roster; and `listGrantablePrograms` (`lib/db/pipeline.ts`), which lets a coach grant another business's programme from their own board.
- **Question:** the programs tenancy ruling that the phase 5a spec already parks (`docs/superpowers/specs/2026-09-06-tenancy-phase5a-events-per-tenant-design.md`, "It needs an owner ruling before it gets a phase"). Is a coach's programme their business's own, or content the platform shares with every coach?

### G38 · One newsletter list for every business · **M** · **owner decision**
- `newsletter_subscribers` has no `business_id`. A visitor who subscribes on business B's host, under consent wording that names B, joins the one list. The platform mails them (`functions/src/newsletter-send.ts:43`), and they are uploaded to the platform's Google Ads Customer Match list (`lib/ads/audiences.ts:107`).
- The admin readers are shelf entry S10: `getActiveSubscribers` and `getAllSubscribers` (`lib/db/newsletter.ts`), on `/admin/newsletter` behind `blog`, which the Marketing Manager preset grants.
- **Question:** does each business get its own newsletter list, mailed from its own sender? Or is it one platform list, in which case a coach's subscribe form must not promise the coach's newsletter?

### G39 · The ads subsystem mixes businesses · **unsized** · **frozen, owner decision**
- Customer Match uploads every business's bookers (`lib/ads/audiences.ts:88`) and subscribers (`:107`) under the platform's ad account. Conversion adjustments pick a booking from any business (`lib/ads/conversions.ts:136`). The strategist is fed every business's events (`lib/ads/agent.ts:933`). The accounts list, and its disconnect, span every business: `listGoogleAdsAccounts` (`lib/db/google-ads-accounts.ts:10`) reads every account, and the disconnect route (`app/api/integrations/google-ads/disconnect/route.ts:26-28`) deactivates every account it lists. The pipeline's bookings arm reads a table that HAS a `business_id` with no predicate (`lib/ads/pipeline.ts:150`).
- This extends the DELIBERATELY FROZEN shelf in `lib/tenancy/platform.ts`, which already names the ads accounts' readers. `/admin/ads` is owner-only since 2026-09-04, so no teammate reaches it today.
- **Question:** scope the ads subsystem per business, or keep it the platform's own account and stop feeding it other businesses' bookers, subscribers and events?

### G40 · Funnel checkout sells any priced programme · **S** · **correctness, no owner**
- `app/api/funnels/checkout/route.ts` checks only that `productId` is a UUID (`:41`) whose programme has a price (`:99-106`). It does not check that the product is one of the published page's offers, that it is active or public, or that it is this business's. The sale is filed under the Host's business. Shelf entry S8.
- **Fix:** bind `productId` to the published version's offers.

### G41 · The strategy critic's attribution read filters on columns that do not exist, and the select contract cannot see it · **S** · **no owner**
- `functions/src/strategy/critic-signals.ts:60` reads `marketing_attribution` with `.gte("occurred_at", cutoff)`, and `aggregateAttribution` / `aggregateFunnel` (`:26-49`) group on `channel` and `event_type`. None of the three columns exists: not in `00101`, which creates the table, nor in any later migration, and the dev clone's `information_schema.columns` agrees (re-measured 2026-09-26). PostgREST answers `42703`, the code never reads `attrRes.error`, and `attrRes.data ?? []` turns the error into "no attribution". **The Chief critic has never seen attribution.**
- `npm run test:integration:selects` cannot see this. It probes select lists and `.order()` columns, not filter columns.
- **Fix both:** the critic's read and the contract's blind spot.

### G42 · `marketing_attribution` has no tenant · **unsized** · **owner decision**
- The DAL's reason for no column ("the tenant is not resolved until phase 4") expired with the Host boundary. `landing_url` carries the host on 509 of 512 dev-clone rows (re-measured 2026-09-26), so a backfill is possible. Production was not measured.
- `findAttributionForContact` (shelf entry S9) reads by `user_id`, and it crosses businesses through `linkContactsToUser`: once one login is linked to two businesses' contacts, a click id captured on one business's page attaches to the other's purchase or booking.
- **Question:** give `marketing_attribution` a `business_id` backfilled from the landing host, or keep it one platform table and accept that attribution can cross businesses?

### G43 · Every business's customers accept the platform's waiver · **unsized** · **owner / legal decision**
- `getActiveDocument` (`lib/db/legal-documents.ts`, shelf entry S11) serves the platform's `legal_documents` on the camp and clinic pages, each event's page, the event signup and checkout, and the funnel form. Those surfaces resolve another business's Host tenant, and their customers see, and record acceptance of, the platform's waiver.
- **Question:** does each business need its own waiver and terms, and until then may another business's customers accept the platform's? This is a legal decision before it is a code one.

### G44 · Schema guards for tenancy · **M** · **later**
- The platform `DEFAULT` on `business_id` in 30 of 38 tenanted tables (measured on the dev clone 2026-09-26 from `information_schema.columns.column_default`; the eight without one are `booking_hosts`, `booking_notifications`, `booking_types`, `business_domains`, `business_members`, `business_settings`, `coach_calendar_connections` and `team_invites`): one schema-wide decision, already known from `00278`. G31 records that the seed and capture scripts must be fixed before it can be dropped.
- No composite foreign key ties a consent row (or any cascading child) to its contact's business. A1 made the reader filter; the schema still allows the mismatch.
- `merge_contacts` never checks that the survivor exists in `p_business`.
- The `lead_magnets` "active lead magnets are public" RLS policy returns every business's magnets to the anon key.

### G45 · Small ownership checks · **S** · **no owner**
- `markAsRead(id)` (`lib/db/notifications.ts:20-25`) updates a notification by id without checking who owns it.
- `getLeadInquiryById` (`lib/db/lead-inquiries.ts`, shelf entry S12) reads by id with no tenant. The regenerate-analysis route reaches it through `leads`.
- `/admin/team` lists, revokes and resends every business's invites. It is operator-only today.
- `sendManualSms` checks consent on `args.contactId` but sends to `args.phone`, and the route does not check that the two match. That is within one business, so it is a G28 concern.
- The SEO job reports "completed" whatever its actions did.
- The funnel form's and quiz's SMS-consent wording reads its business name from the Host (`resolvePublicTenant()` in `FormIsland` and `QuizIsland`), not from the render context. On `/go` that is the page's own business. On both previews the Host is the admin's, so a coach's preview names the platform's business in the consent line. Preview-only wording: nothing is filed under it (preview submits write nothing). Left by the G35 final review (Ruling R12), because the live page's wording must keep matching the route that files the consent, which reads the Host.
- **00279 is the first thing that makes a sequence key and a board key repeat across businesses** (true on the dev clone now; on production once a second business exists — 00279 seeds the same `sequences.key` and `pipelines.key` values, e.g. `'assessment'`, for every business). Three operator scripts look a row up by key with no business predicate and will throw once a second business shares that key: `scripts/repair-failed-sequence-runs.mjs` (~122-128, `maybeSingle` on a sequence key — the 73-run incident's repair tool) and `scripts/smoke-g29-pipeline-settings-prod.mjs` (~50-53) / `scripts/smoke-g29-pipeline-settings-prod-readonly.mjs` (~55-58) (`.single()` on the `pipelines` row where `key='assessment'`). They fail loudly, never silently on the wrong row; each needs a business scope.

#### Found by G32's discovery (2026-09-26) — recorded, not built

### G46 · The dev clone has drifted from the migrations · **S** · **no owner**
- Its `save_sequence_steps` runs e8a10efb's body, not the one in `00256` on `main`. It lacks the `GET DIAGNOSTICS ... ROW_COUNT` check 375b3375 added, which refuses a save whose step ids did not all match (without it a bad id punches a gap in the positions, and the tick reports the run as finished). Measured with `pg_get_functiondef`: neither `GET DIAGNOSTICS` nor `v_updated` is present.
- `00231`'s RLS is not on its pipeline tables. `pipelines`, `pipeline_stages`, `opportunities` and `opportunity_stage_events` have RLS off there, and anon has SELECT and INSERT. `00231` is not in the dev clone's migration ledger.
- Also missing from that ledger: `00249` (its body is live, applied outside the ledger).
- **Production is not known to share this.** It was measured locked down on 2026-09-21 (S01: 0 tables with RLS off) and was not re-read. Fix: apply the two current bodies to the dev clone and read them back. Every test that runs live against the dev clone is testing the older `save_sequence_steps` until then.

### G47 · Cloning the built-in quiz copies "Book a call with Darren" · **S** · **no owner**
- `lib/quizzes/seed/rpi-athlete-quiz.ts` (about lines 183-184): two result bands carry `ctaLabel: "Book a call with Darren"`. A business that creates a quiz funnel with `copyFrom: builtin:rpi` gets the platform owner's name on its own quiz's call-to-action.
- Found by G32's critic. It matters to G32 because the four `quiz_*` starter sequences only fire for a quiz cloned this way.

### G48 · The `has_user` branch crosses businesses · **S** · **blocked on G37**
- The `quiz_*` sequences' `{"kind":"has_user"}` branch tests `contacts.user_id IS NOT NULL` (`lib/automation/sequence-tick.ts`, ~166). `linkContactsToUser` sets `user_id` on EVERY business's contact with the same email (`lib/db/contacts.ts`, ~669-681).
- So a platform client who takes another coach's quiz takes the "you already have an account with us" arm, and is never asked to talk.
- G32 made the wording say what the branch checks (an account). The check itself needs "a client of THIS business", which the schema cannot express until users or client relationships carry a business (G37).
- **2026-09-26: investigated, nothing built; the owner has a question (options below).**
  - **Two writers set `contacts.user_id` across businesses, not one.** `linkContactsToUser` (`lib/db/contacts.ts`, called at registration) fills it on every business's contact with that email. So does `upsertContactIdentity` itself, through `resolveLinkableUserId` (~`:542`), on any write to a contact that has no link yet (fill-only): a brand-new contact under any business is linked on creation to an existing account with the same email. Changing only the register route would not close it.
  - **What per-business evidence exists today** (the dev clone's `information_schema`, read 2026-09-26). Tables with both a `business_id` and a person: `bookings`, `event_signups`, `funnel_checkout_grants`, `opportunities`, `contact_tags`, `quiz_attempts`, `sequence_runs`, `chat_conversations`, `contact_consents`. Every table that says someone IS a client has no `business_id`: `users`, `payments`, `subscriptions`, `program_assignments`, `client_packages`, `client_memberships`, `scheduled_sessions`, `client_profiles`, `session_fee_charges`. So "a client of THIS business" can only be guessed from lead-side proxies (booked, bought through this business's funnel checkout, signed up for its event). That is the guess this row says not to build.
  - **It is latent while coaches have no hosts.** `/api/quiz/progress` reads the quiz under the Host's tenant (`resolvePublicTenant()`), and nothing in the app writes `business_domains`. So a non-platform business's quiz, served on a host that resolves to another business, 404s on the first answer, and its `quiz_*` sequences cannot enrol anyone. The wrong arm becomes reachable the day a coach's host resolves to their business. (Production's `business_domains` rows were not read for this.)
  - **Options put to the owner:**
    - **(A)** Wait for G37, and make "G48 closes before any coach gets a host" an explicit precondition of coach domains.
    - **(B)** An interim: take the `has_user` branch out of the four `quiz_*` drafts for every business except the platform, so everyone gets the prospect arm until G37. That needs a migration editing only non-platform drafts, and `seed_business_starter_set` replaced whole.
    - **(C)** An interim: a new branch condition backed by the lead-side proxies above.
    - Recommendation: **A**. Nothing is reachable today, and B or C would each be undone by G37.

### G49 · A tenant's unsubscribe and consent links land on the platform's branded pages · **M** · **later, with coach domains**
- `appOrigin()` is deployment-wide (`lib/automation/sequence-tick-runner.ts`, ~464-477). The unsubscribe and `{{sms_consent_url}}` pages sit under `app/(marketing)`, whose navbar is the platform's (`SiteNavbar.tsx`). A coach's lead who unsubscribes lands on the platform's site.
- It needs per-business hosts (nothing writes `business_domains` yet) or a neutral, unbranded page for these two routes.

---

## Decisions only the owner can make (blocking the rows that name them)

| # | Decision | Blocks |
|---|---|---|
| 1 | Approve the copy of the eight unreviewed sequences | G03 (live now), G11, G12, G17 |
| 2 | ~~One-sequence-at-a-time: option A, B or C~~ **RULED 2026-09-20: option B**, built and merged the same day at `fe5d51ad`; the superseding set became FOUR sources on the owner's call. | ~~G14~~ closed |
| 3 | ~~Gate manual texts on consent, with an audited override?~~ **RULED 2026-09-21: YES — gate it, with the audited "Send anyway" override.** See below. | G28 |
| 4 | ~~Hard bounce suppresses the address?~~ **RULED 2026-09-21: YES — HARD bounces only. Soft bounces are ignored entirely.** See §Rulings. | G09 |
| 5 | ~~Assessment submitters become contacts?~~ **RULED 2026-09-21: YES — mint the contact, matching the questionnaire.** See below. | G21 |
| 6 | Chat booking: accept hand-over wording, or schedule native booking | G19 |
| 7 | Email-consent wording on the funnel, quiz and inquiry forms (0 consent rows today) | G17 in practice |
| 8 | ~~The 73 stranded re-permission runs~~ **RULED AND DONE 2026-09-21: re-dated and sent at 12:00 UTC.** 73 sent, 67 delivered, 23 opened, **2 SMS consents created**. See §Rulings. | ~~G28 in practice~~ unblocked |
| 9 | ~~Notifications: who receives alerts per tenant~~ **RULED 2026-09-21: the tenant's own `reply_to`.** | G30 |
| 10 | ~~`sms_help_text` and the Twilio HELP auto-reply wording~~ **RULED 2026-09-21: drafted to carrier convention, owner approves the words before it is configured.** | — |
| 11 | ~~Tenant coaches editing their own settings~~ **RULED 2026-09-21: record the decision, write NO code — it belongs in the SaaS direction spec.** | G34 (stays open, deliberately) |

### Rulings recorded 2026-09-21

**Decision 5 / G21 — assessment submitters DO become contacts.** Reverses the 8 Sept attach-only ruling.
The 8 Sept ruling argued from "`contacts.user_id` has no originating writer anywhere in this repo … 0 of
170 production contacts have a user_id". **G04 gave it a writer and backfilled: production is 43 of 170,
re-verified 2026-09-21.** The premise is gone. The owner also resolved the inconsistency it created:
`app/api/questionnaire/route.ts` (G20, shipped) is equally session-gated and already MINTS a contact, and
the two routes disagreeing on purpose was written into the route, `lib/tenancy/platform.ts` and this ledger.
They now agree. **Note the conclusion of the stale comment was still correct for a different reason** — the
lookup must keep matching on email, because only 43 of 170 are linked and a `userId`-only lookup would miss
127. Correct the argument, keep the behaviour.

**Decision 3 / G28 — manual texts ARE consent-gated, with an audited override.** Measured when ruled:
`contact_consents` had **0 rows** in production, so the gate blocked every manual text from day one.
**That premise expired the same day: the decision-8 send created the first 2 consent rows at 12:40 and
14:09 UTC.** The gate now has something to let through, and the override is the exception it was meant
to be rather than the only way to send. The owner accepted that
knowingly: the coach can tick **Send anyway**, which records `consent_override:true` on the `sms.sent_manual`
audit metadata. Nothing is silently blocked, and nothing sends without a deliberate act. Implementation is
`sendManualSms` (`lib/lead-engine/sms.ts`) + composer + route.

**RLS grouping (S01) — all thirteen in ONE migration, no policies.** The owner chose the single-migration
option over a staged rollout, on the measured basis that no policies are required at all. See §Security.

**The RPC exposure (S02) — folded into the same branch as a second migration.** Not deferred to its own task.

---

## Housekeeping (fold into whichever phase touches them)

- `lib/db/funnels.ts:572` names `SINGLETON_BUSINESS_ID` in prose, so `CLAUDE.md`'s count command returns 6. Reword the comment (retire it in G31) or change the documented count.
- Add a "superseded 2026-09-19" banner to `docs/full-engine-scope-vs-built.md` and `docs/lead-engine-audit-2026-09-13.md`.
- ~~RLS is disabled on 13 tables~~ — **MOVED OUT OF HOUSEKEEPING. It was a security task, not a tidy-up. See §Security below. Closed 2026-09-21 by migrations `00274` and `00275`.**
- `lead_magnets` has 0 rows; the lead-magnet entry point has nothing to serve until the owner creates one.

---

## Security (NOT lead-engine gaps — filed here because this ledger is where the work was tracked)

### S01 · Thirteen public tables had no RLS, and `anon` held full DML · **BUILT 2026-09-21**
- Migration `00274_enable_rls_on_open_tables.sql`, branch `worktree-rls-and-rpc-lockdown`, merged at `4030e6f9`. **LIVE ON PRODUCTION since 2026-09-21 06:11 UTC** — re-measured 18:00 UTC: `pg_class.relrowsecurity = false` on **0** public tables, down from 13. (This line read "awaiting the owner's word before the push" for the twelve hours after it had already shipped.)
- **Measured on production 2026-09-21.** Thirteen tables with `pg_class.relrowsecurity = false` and zero policies: `agent_tool_baselines, assessment_questions, assessment_results, chief_strategist_memos, coach_ai_policy, event_signups, events, exercise_blocks, generated_exercise_usage, membership_plans, program_week_access, program_week_pricing, repo_migrations`. Supabase's own linter flags all thirteen `rls_disabled_in_public` at **ERROR / EXTERNAL**.
- **The grant was `anon=arwdDxtm`, not SELECT.** INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. The read was proven end-to-end with the publishable key and `Prefer: count=exact` + `limit=0` (`program_week_access` → HTTP 206 `*/500`; `contacts` as an RLS-on **control** → `*/0`). The write was confirmed at the grant level and deliberately **not** probed against production.
- **Two corrections to what the owner had been told.** (1) `assessment_results` and `event_signups` are **empty, 0 rows** — a fuse that lights on the first assessment submission or camp signup, not a live leak. (2) It was never read-only.
- **No policies, deliberately.** Every reader of all thirteen goes through `createServiceRoleClient()`; `createBrowserSupabaseClient` and `createServerSupabaseClient` have **zero callers repo-wide**; `service_role` has `rolbypassrls = true`. Twenty-eight tables here already run RLS-on-with-zero-policies (`audit_logs`, `funnels`, `cron_runs`), which is the empirical proof it works. **The earlier Housekeeping line said "enabling RLS without policies blocks all access, so policies come first" — that is wrong for this codebase and this migration disproves it.** A `select using (true)` policy on the reference tables was considered and rejected: it would preserve the exposure and buy nothing.
- **RLS does not cover TRUNCATE, REFERENCES, TRIGGER or MAINTAIN** — `ENABLE ROW LEVEL SECURITY` leaves `relacl` untouched. Those four are revoked outright in the same migration, or `anon` would keep TRUNCATE on all thirteen. Post-change `relacl` reads `anon=arwd`, and RLS denies all four of those.

### S02 · Five SECURITY DEFINER functions were callable by `anon` over `/rest/v1/rpc/` · **BUILT 2026-09-21**
- Migration `00275_revoke_anon_security_definer_rpcs.sql`, same branch, **live on production 2026-09-21 06:11 UTC**. **Found by the Supabase linter during S01 — it was in no audit and no ledger row.**
- `create_message` inserts a message with a **caller-supplied sender id and sender role** and never checks the caller is that user or a participant; `confirm_event_signup` / `cancel_event_signup` flip a signup's state and move `events.signup_count`; `create_form_review_message_with_attachment` is the same shape; `is_messaging_admin` leaks an authorization answer. None has any caller check — verified by reading `pg_get_functiondef`, not inferred from the names.
- **Honest severity:** each needs a UUID the caller has no legitimate way to obtain, so in practice they are gated by UUID entropy. That is obscurity, not authorization — a real finding, but a *smaller* live risk than S01, which needs no identifier at all.
- **Three of the five were granted to `PUBLIC`** (`=X/postgres` in `proacl`). A revoke naming only `anon` and `authenticated` would have left all three callable — a migration that reads like a fix and changes nothing. The revoke names PUBLIC first.
- **`is_messaging_admin` keeps `authenticated`, and that is load-bearing.** It is called inside **six** RLS policy expressions, all `TO authenticated` — four in `public` and two on `realtime.messages`. Postgres checks EXECUTE on a policy-invoked function as the querying role, so revoking it there makes those policies *raise* rather than filter. `service_role` keeps EXECUTE on all five; that is how the app calls them.
- **Not fixed here:** the missing authorization checks *inside* those functions. This migration stops the internet reaching them; it does not make them safe to expose. Worth its own row.

---

## Order and size at a glance

| Phase | Gaps | Size |
|---|---|---|
| 0 — stop the bleeding | G01, G02, G03 | S + owner |
| 1 — truthful data | G04, G05, G06, G07, G08 | M + 4 S ≈ 3 days |
| 2 — quoted behaviours | G09, G10, G11, G12, G13, G14, G15, G16, G17, G18 | 5 M + 5 S ≈ 2 weeks |
| 3 — entry points + pipeline | G20–G29 | 2 M + 7 S + 1 L ≈ 1 week |
| 4 — white-label edges | ~~G30~~, ~~G31~~, G32, ~~G33~~, ~~G35~~ | G32 merged and applied to production 2026-09-26; G30 built 2026-09-23, G31 merged 2026-09-25, G33 built 2026-09-25, G35 merged 2026-09-26 |
| 4b — found by G35's sweep | G36-G45 | decisions + S/M rows |

Phase 0 today. Phases 1 and 2 are what make the quotation's sentences true. Phases 3 and 4 are what make "GoHighLevel replacement" and "white-label ready" true.

---

## Paste-able prompt for a fresh build session

```
Build the Lead Engine gaps in the djpathlete repo, from docs/lead-engine-gaps-to-ship-2026-09-19.md.

Read first, in this order: that ledger; docs/lead-engine-verification-2026-09-19.md (the evidence
behind every row); CLAUDE.md; the top five JOURNAL.md entries. Then RE-MEASURE production through
the read-only supabase-prod MCP before planning (sequence statuses, run counts, contacts.user_id
count, checkout_abandoned timeline rows) and say what moved.

Scope: PHASES 0, 1 AND 2 ARE DONE AND LIVE (except G18's ai_chat half, which needs the owner's
copy). Start at PHASE 3 in row order — G20 first, then G22-G27 — skipping any row whose owner
decision (ledger §Decisions) is not yet answered, and list those at the end instead of guessing. Each gap on its own branch off main via EnterWorktree; TDD; the ledger
names the test that must fail on main first; mutate the guard you add and show the test failing;
tsc must hold the 238/54 baseline with an identical per-file error set; npm run build exit 0;
whole-branch review before you call it done. Targeted suites while you work — but run the WHOLE
suite before calling a row done: a suite selection has hidden a red test three times in this
ledger's history, once while also making a live network call from a unit test.

RE-MEASURE THE SCHEMA A ROW ASSERTS, NOT JUST THE COUNTS. Three of the four rows built on
2026-09-21 named a column, a join or a source that does not exist or is already counted. Before
building a row: information_schema.columns for the column list, pg_constraint for the FKs
(information_schema hides them), and grep for the WRITER of any column the row wants to read.
When the row is wrong, build what the data supports, say so in the code AND in the commit, and
name what the rest would take.

Do NOT push, merge to main, apply a migration to production, flip a system_settings flag, send
an email or text, or run any script against .env.prod. Get each branch green and reviewed, then
leave a report naming the branch, the commits, the verification you ran, and what you left out.
Never add Co-Authored-By or any Claude attribution to commits.

Traps already paid for: quote every glob in zsh (--include="*.ts"); read information_schema
before joining a table; a comment describing a bug matches a naive grep; a green test that
passed first try may pin the wrong mechanism — mutate it; a data migration can succeed and match
nothing — read production back; every new column needs a named reader.
```

---

## Status — PHASES 0-3 COMPLETE AND LIVE (last re-measured 2026-09-23)

### Finished vs not — the one-screen answer

**36 of 51 rows are finished, merged, pushed and deployed. 15 are not.** Five of the 15 need
no owner and can be built now: G40, G41, G45, G46 and G47. G44 and G49 are recorded for later, and
G48 waits on G37. The other seven wait on the owner: G34 is parked by ruling, and G36, G37, G38, G39,
G42 and G43 are decisions only the owner can take. *(Updated 2026-09-26: G32 merged and applied to
production, and the four rows its discovery found added as G46-G49, so the count went from 47 to 51.)* Separately, some finished rows still need wording only the owner
can write (below). *(Corrected 2026-09-26 by the G35 final review: this sentence said everything not
finished was an owner decision or owner wording, which G40, G41 and G45 are not. Commit `04d8019f`'s
message makes the same overstatement, "each is a scoping decision, not a bug fix"; the commit is not
rewritten.)* *(Updated 2026-09-26: G35 is merged and deployed, and the ten rows its sweep found are added
as G36-G45, so the count went from 37 to 47.)*
*(Corrected 2026-09-25. This line said "30 of 36 … 6 are not" through G30b, G31 and G33, while the
scoreboard below moved on.)*

**FINISHED — built, reviewed, merged, pushed, live on production:**

| Phase | Rows | Note |
|---|---|---|
| 0 — stop the bleeding | G01 G02 G03 | G03 closed with no code |
| 1 — truthful data | G04 G05 G06 G07 G08 | `contacts.user_id` now 43 of 170 linked |
| 2 — quoted behaviours | G09 G10 G11 G12 G13 G14 G15 G16 G17 G18 G19 G19b | two partial, see below |
| 3 — entry points + pipeline | G20 G21 G22 G23 G24 G25 G26 G27 G28 G29 | whole phase complete |
| 4 — white-label (so far) | G30 G30b G31 G33 G35 | the rest of Phase 4 is open, below. *(This row was missing while the four before G35 closed; added 2026-09-26.)* |
| Security (not a gap) | S01 S02 | migrations `00274`/`00275` live; 0 tables with RLS off |

**NOT FINISHED — 15 rows, none of them started:**

| Row | What | Size | Why it is open |
|---|---|---|---|
| G34 | Settings are owner-only | — | **Deliberately parked.** Decision 11 ruled: record it, write NO code — it belongs in the SaaS direction spec |
| G36 | Grantable staff surfaces read every business's data | **M** | **Owner decision:** scope them, or make them owner-only first |
| G37 | Programmes, assignments and client lists are shared across businesses | **M/L** | **Owner decision:** the programs tenancy ruling phase 5a parked |
| G38 | One newsletter list for every business | **M** | **Owner decision:** one list per business, or one platform list |
| G39 | The ads subsystem mixes businesses | — | **Frozen; owner decision** |
| G40 | Funnel checkout sells any priced programme | **S** | Not started; needs no owner |
| G41 | The strategy critic's attribution read filters on columns that do not exist | **S** | Not started; needs no owner |
| G42 | `marketing_attribution` has no tenant | — | **Owner decision:** a column and a backfill, or one platform table |
| G43 | Every business's customers accept the platform's waiver | — | **Owner / legal decision** |
| G44 | Schema guards for tenancy | **M** | Not started; later |
| G45 | Small ownership checks | **S** | Not started; needs no owner |
| G46 | The dev clone has drifted from the migrations | **S** | Not started; needs no owner |
| G47 | Cloning the built-in quiz copies "Book a call with Darren" | **S** | Not started; needs no owner |
| G48 | The `has_user` branch crosses businesses | **S** | Blocked on G37; investigated 2026-09-26, owner asked A/B/C |
| G49 | Unsubscribe and consent links land on the platform's pages | **M** | Later, with coach domains |

**FINISHED IN CODE, NOT FINISHED IN WORDS — these need the owner, not a developer:**
- **G18's `ai_chat` sequence** — the consent half is live; the follow-up sequence a chat lead enters
  is not built and needs the owner's copy. **The last Phase 2 row still open.**
- **G17's six text steps** — drafted, not authored. Editable at `/admin/sequences/<key>`, no deploy.
  As of 2026-09-21 they can finally reach somebody: 2 SMS consents exist.
- **G12's alert wording** — shipped as a question, because nothing in the system can know whether
  the coach replied. Reword in the editor.
- **G16's `{{sport}}`** — renders blank today; one `ENROLMENT_METADATA_KEYS` entry plus one line in
  `app/api/inquiry/route.ts`. `{{goals}}` needs a different home entirely.
- **Decisions 1, 6 and 7** in §Decisions are still untouched.

**FINISHED BUT NOT SWITCHED ON:**
- **`cron_pipeline_reconcile_enabled` does not exist as a row in `system_settings`** — re-measured
  against production **2026-09-23**, still no row, so the job is off by ABSENCE and
  `defaultEnabled: false` is the only thing holding it. G26 removed the hazard that kept it off and
  the owner ruled to enable it, but the switch has never been thrown. It belongs in
  `/admin/automation`, which records `updated_by` — which is why it is the owner's click and not a
  script's.
- ~~**`worktree-reconcile-cron-description` is unmerged**~~ — **MERGED 2026-09-23** (`16106686`).
  The blocker it describes is gone: `/admin/automation` no longer tells the owner this job "should
  stay off for now", because G26 fixed the second-card hazard that sentence was about. Nothing now
  stands between the ruling and the switch.
- **A ruling is not a row, and that branch asserted otherwise.** Its comment in
  `lib/automation/pipeline-reconcile.ts` said the flag "WAS TURNED ON by owner ruling 2026-09-21".
  It was not — the ruling happened, the switch did not, and the two were fused into one sentence.
  Corrected on merge (`185c6ae1`) after measuring production rather than reading the comment. This
  is the same failure as the G21/G28 note above, in a code comment instead of a scoreboard: a reader
  who believed it would debug an unrepaired board by reading a file that has never run.


**PHASE 1 COMPLETE AND LIVE. PHASE 2 COMPLETE AND LIVE except G18's `ai_chat` half, which needs
the owner's copy.** Worktrees and branches swept after every merge.

| Row | Commit | State |
|---|---|---|
| G04 | `e27ccd9c` | merged + **pushed**; migration `00264` applied on production, 43 contacts linked |
| G05 | `4613a380` | merged (fast-forward) |
| G06 | `ed347bb5` | merged |
| G07+G08 | `46c8b236` | merged |
| **G09** | `816892cf` | merged + pushed — **inert until the three operator steps in the runbook** |

| **G17** | `c3b507f5` | peer session; merged + pushed; migration `00272` live — six of seven sequences |
| **G19b** | `32b28416` | merged at `8fa6f322` + pushed |
| **G13** | `1f8f16a6` | merged at `c93447e7` + pushed |
| **G15** | `e2bbd302` | merged at `4009fce6` + pushed |
| **G16** | `c433ca5b` | merged at `bd661516` + pushed |
| **G20** | `a71938f9` | merged at `cca12349` + pushed |
| **G21** | `490957e4` | merged at `e36377f7` + pushed — ruling reversed the same day |
| **G22** | `8858d558` | merged at `8e5d4ed2` + pushed; migration `00273` live |
| **G23** | `667ad846` | merged at `b4a5a1ee` + pushed |
| **G24** | `e345fdee` | merged at `df56d26c` + pushed |
| **G25** | `1e53a50c` | merged at `66a32aa0` + pushed |
| **G26** | `8399d87c` | merged at `cf76b633` + pushed — **the cron it unblocks is still OFF** |
| **G27** | `50cce63c` | merged at `7e80a55c` + pushed |
| **G28** | `ea9e3d59` | merged at `58db9ffe` + pushed — **no longer blocks everything: 2 consents exist** |
| **S01+S02** | `767d5559` | merged at `4030e6f9` + pushed; migrations `00274`/`00275` live |

`main` is at **`7727bc70`**, level with `origin/main` (re-measured 2026-09-21 18:00 UTC; this
paragraph said `01ee31ce` until then, 36 commits behind). **G01-G28 are merged and deployed except
G18's `ai_chat` half**; G03 and G19 are closed with no code. The 36 commits between `01ee31ce` and
`7727bc70` are AI/generation work — **no lead-engine code has changed since this ledger was last
edited**, so every row below still describes the code that is running.

**THREE OF THE FOUR ROWS BUILT ON 2026-09-21 SHIPPED A CORRECTION TO THEIR OWN "SHIPPED WHEN".**
G13 asked for a join on a column `funnel_submissions` does not have; G15 asked for a source that is
already counted (double-counting every camp ticket); G16 named two merge fields with no producer.
Each is written up in its own row above. **Re-measure the SCHEMA a row asserts, not just the counts
— this ledger's own rules say to re-measure counts and say nothing about shape, which is the part
that rots silently.** `information_schema.columns` for the column list, `pg_constraint` for the FKs
(`information_schema` hides them), and grep for the WRITER of any column a row wants to read.

**ALL MIGRATIONS ARE APPLIED TO PRODUCTION.** `00266`-`00272` went in automatically via
`apply-migrations.yml` on push, and each result was read back rather than assumed: both
`sequence_runs` columns present, the widened wait CHECK live, `camp_clinic_deadline` counting down
14/7/3, and `service_application_received` reshaped to wait/alert/email/wait/email/stop with zero
runs disturbed.

Verified on the MERGED result, not just per branch (2026-09-21, after all four gaps): whole suite
**1074 files / 11439 tests** with the 7-failure baseline below; tsc **238 errors / 54 files** with a
per-file set identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`; `npm run build` exit 0 after
`rm -rf .next/dev`.

**Scoreboard, re-measured 2026-09-26 on `main@a04f2603` (G32 merged and applied to production): 51 rows · 36 done · 15 open.**
Done: G01 G02 G03 G04 G05 G06 G07 G08 G09 G10 G11 G12 G13 G14 G15 G16 G17 G18 G19 G19b G20 **G21** G22 G23 G24 G25 G26 G27 **G28** **G29** **G30** **G30b** **G31** **G32** **G33** **G35**.
Open: G34 G36 G37 G38 G39 G40 G41 G42 G43 G44 G45 G46 G47 G48 G49.
*(G46-G49 are the four rows G32's discovery added.)*

**G35 is Done: merged, pushed and deployed on 2026-09-26.** *(This paragraph was written on
G35's branch, when it was counted Done while still unmerged.)* **The row count went from 37 to 47** because G35's sweep
recorded ten new rows, G36-G45, under its own heading after G35. They are rows, not lettered
sub-rows: each is a separate decision or fix, and none was built in G35.

**G31 merged 2026-09-25 in TWO pushes** — `2c3a659d` (migration `00278` alone) then `2b4dd3c1`
(the code), the second only after the first was confirmed applied to production. Its row above
records the two live defects the two-tenant run caught that no unit test could, and the three
things left deliberately undone.

**The row count went 36 to 37** because G30b is a new lettered sub-row, the same shape as G19b:
a defect found while shipping its parent, fixed in the same branch, and given its own row so it is
greppable rather than buried in a bullet.

**G30 is counted done with ONE clause of its own "shipped when" carried forward** — the auto-reply
still links this platform's booking widget rather than the tenant's connection. It is listed under
§Everything still waiting on the owner rather than left implicit in a green row, because a row
marked BUILT whose clause list is not fully met is exactly how this ledger has misled before.

**Verified on the MERGED result for G30 (2026-09-23, `d3e282e6`):** the merge is a `--no-ff` of a
branch that was 0 behind `main`, so the merged tree hash is byte-identical to the branch tree that
was gated (`f6ea7fe8`). Whole suite **1091 files / 11992 tests**, 13 failures across 4 files —
`__tests__/migrations/00062.test.ts` (3, needs a live DB), `coach-reachability` (1),
`funnel-builder-initial-prompt` (3), `lib/ai/tool-loop` (6, an unrelated OpenRouter migration).
That is 6 more than the 7-failure baseline recorded above on 2026-09-21, all 6 in `tool-loop`, and
none of them this work. `functions/` separately: **97 files / 810 tests** green with its own `tsc`
silent. App `tsc --noEmit` **238 errors / 54 files**, per-file set identical to
`.claude/baselines/tsc-ce6f2aba-perfile.txt`. `npm run build` exit 0.
**`npm run lint` was not run: it is broken repo-wide** (`package.json` runs `next lint`, removed in
Next 16, and there is no eslint config).

**One flake seen, recorded so it is not mis-attributed:**
`__tests__/app/funnel-draft-preview-page.test.tsx` failed in 1 of 3 full runs and passes in
isolation; runs 1 and 3 reproduced the baseline exactly. It is not on this work's path and it is
not in the documented baseline either — a second flaky suite to know about.

**G21 and G28 were listed as open in the same commits that merged them** (`e36377f7`, `58db9ffe`) —
their own rows above said BUILT while this line still said open. A row's status lives in two places
in this document, and only one of them got updated. When closing a row, edit both.

**Phases 0, 1 and 3 are COMPLETE. Phase 2 is complete except one half of G18** — every other row
in them is built, reviewed, merged and pushed, and every migration through `00275` is applied to
production. G18's `ai_chat` follow-up sequence is NOT built and is blocked on the owner's copy, so
"every row is built" was an overclaim; it is counted under Done in the scoreboard because that list
means FINISHED IN CODE, and G18's outstanding half is in the owner section below. G21 and G28, the two rows that were
blocked on an owner decision, were ruled on and built the same day. G29, the last Phase 3 row and the one deliberately deferred until Phases 0-2 were done, was
built, merged and smoke-tested on production on 2026-09-23. G30 and G31, the first two Phase 4 rows, were merged and pushed on 2026-09-23 and 2026-09-25. G33 was built on 2026-09-25. G35 was merged, pushed and deployed on 2026-09-26. G32 was merged, pushed and applied to production on 2026-09-26. What remains is G34 (a decision, not work), **the ten rows G35's sweep found, G36-G45**, and **the four G32's discovery found, G46-G49**: six wait on an owner decision (G36-G39, G42, G43), five are small fixes that need no owner (G40, G41, G45, G46, G47), G48 waits on G37, and G44 and G49 are for later.

**Everything still waiting on the owner, in one place:**
- **G18's `ai_chat` half** — the follow-up sequence a chat lead should enter is NOT built and needs
  the owner's copy. The consent half is live. This is the only Phase 2 row still open.
- **G17's text copy** — six sequences have a text step, drafted not authored, editable at
  `/admin/sequences/<key>` with no deploy. This line said `contact_consents` is EMPTY; **measured
  against production 2026-09-23 it holds 2 granted `sms` rows** (latest 2026-09-21) plus one
  `granted:false` email row, which is what the FINISHED-IN-CODE section above already said. So the
  text steps CAN reach somebody — two people — and the blocker is the copy alone.
- **G12's alert wording** — shipped as a question ("{{name}} applied two days ago — have you
  replied?") because nothing in the system can know whether the coach replied. Reword in the editor.
- **G16's `{{sport}}`** — one `ENROLMENT_METADATA_KEYS` entry plus one line in
  `app/api/inquiry/route.ts` would make it work, but it also widens what a coach can branch on.
  `{{goals}}` needs a different home entirely. Both render blank today.
- **G30's booking button** — the inquiry auto-reply still sends every applicant to this platform's
  own GoHighLevel widget, whoever they applied to. The tenant-aware version reads
  `coach_calendar_connections.scheduling_url` via `lib/calendly/config-for-business.ts` (a business
  with no connection gets NO button rather than this platform's calendar). It was left out of G30
  because it changes where real DJP traffic books, which is the owner's call, not a refactor.
- **G30 made `sales@darrenjpaul.com` go quiet** — new-inquiry alerts now go to
  `business_settings.reply_to` (`darren@`) alone, per decision 9. If `sales@` should still receive
  them, the fix is a recipient list, not a revert.
- **G35's behaviour change (c) — CONFIRMED, no change in who is alerted.** Read on production
  2026-09-26 after the G32 deploy: `Primary` has 1 owner, 3 staff and no coaches, and its one
  `users.role = 'admin'` user IS that owner. So contact and inquiry bells reach exactly the person
  they reached before G35; staff still get none, by the ruling.
  *(G35's own question, where the agents' alert goes, is answered: owners, as bell rows. See the
  row.)*
- **G36 · the grantable staff surfaces** — scope the admin AI chat, blog, website CMS, money,
  analytics and exercise-library surfaces, or make them owner-only (the ads precedent) before any is
  granted to another business's staff.
- **G37 · programmes, assignments and client lists** — the programs tenancy ruling phase 5a parked:
  is a coach's programme their business's own, or content the platform shares with every coach?
- **G38 · the newsletter list** — one list per business, mailed from its own sender, or one
  platform list with subscribe forms that say so.
- **G39 · the ads subsystem** — scope it per business, or keep it the platform's own account and
  stop feeding it other businesses' bookers, subscribers and events.
- **G42 · `marketing_attribution`** — give it a `business_id` backfilled from the landing host
  (509 of 512 dev-clone rows carry one), or keep one platform table and accept that attribution can
  cross businesses.
- **G43 · the waiver** — may another business's customers accept the platform's `legal_documents`,
  or does each business need its own first? A legal decision before a code one.
- **The decisions in §Decisions** that Phase 3 rows still name (G21, G28, G34).

**G32 is done** (merged and applied to production 2026-09-26). **Next unblocked:** the five **S** rows that need no
owner: **G40** (bind the funnel checkout's product to the published page's offers), **G41** (the
strategy critic's attribution read, and the select contract's blindness to filter columns), **G45**
(small ownership checks), **G46** (bring the dev clone's drifted functions and RLS back in line with
the migrations — worth doing first, since every live test runs against it) and **G47** (the quiz
clone's "Book a call with Darren"). **G35 is done** (merged 2026-09-26).
**G33 is done.** **G34 is not work**: decision 11 ruled record it, write no code. G36-G39, G42 and
G43 wait on the questions above, and G44 is schema work for later.

*(Corrected 2026-09-25. This paragraph ended in a half-sentence, "so **G32** that has to land
before **G32** has a shape to copy", left from an edit that removed its middle.)*

*(Corrected 2026-09-23. This line used to read "G20, then G22-G27" — every row it named is in the
Done list above. It was written when those were the next rows and never moved again, which is the
same two-places-stale failure this document warns about two paragraphs up.)*

**A trap the merge itself surfaced:** the first build of merged `main` FAILED with
`Cannot find module '../../../app/api/ghl/contact/route.js'` from `.next/dev/types/validator.ts` —
a STALE generated artifact left by an earlier dev-server run, still listing a route this work
deleted. No source was wrong. `rm -rf .next/dev` and rebuild fixes it. It is local-only (Vercel
builds from a clean checkout), but it will bite anyone who had the dev server running.

**The pre-existing RED baseline, re-measured 2026-09-21 on merged `main`** (all control-run; do not blame a branch for these):
- `__tests__/migrations/00062.test.ts` — 3 tests, needs a live database.
- `__tests__/lib/coach-reachability.test.ts` — 1 test. **New to this list.**
- `__tests__/components/admin/funnel-builder-initial-prompt.test.tsx` — 3 tests. **New to this list.**
- `__tests__/api/spine/purchase-spine.test.ts` — **no longer red**, fixed by G04.

**A trap this session paid for twice:** a suite SELECTION can hide a red test. `__tests__/lib/tenancy` was outside two broad runs, and both times something real was hiding there. Run the whole suite before calling a row done. **It happened a third time on 2026-09-21**: G13's verification used `__tests__/lib/db` + `lib/lead-engine` + `components/admin`, which excludes `__tests__/app` — where `contacts-page-tenancy.test.tsx` was red AND making a live network call, because it mocks three sibling reads and not the new one.

**`__tests__/db/social-post-media.test.ts` WAS intermittently red and is now fixed — do not re-add it to the list above.** It failed on two of four full runs (`post_type` 'carousel' → 'text') while passing 10/10 in isolation, which looks exactly like a flake and is not one. `backfill_social_post_media()` (migration `00093`) sets `post_type = 'text'` for every post with no media at position 0, no `media_url` and no `source_video_id` — and it is **not a trigger, it runs when MIGRATIONS ARE APPLIED**. These tests hit the shared dev clone, so any session applying a migration mid-run executes it over everyone's in-flight fixtures, and between `newPost("carousel")` and the first `attachMedia` the fixture is exactly the post that function exists to correct. Fixed at `01ee31ce` by re-stating `post_type` AFTER the media exists, which removes the window rather than narrowing it. **Proved on the dev clone by running the backfill's own `WHERE` clause — never its `UPDATE`, so the probe could not disturb another session: `true` before the first `attachMedia`, `false` after.** When a live-DB test fails only under load, grep the migrations for the column being asserted before calling it flaky.

---

## §Rulings — the second batch, 2026-09-21

Eight more decisions taken in the same session that shipped the RLS lockdown, G21 and
G28. Recorded here with the measured premise each was taken on, because a ruling whose
premise is not written down is the thing that goes stale and gets re-litigated — decision
5 (G21) had already done exactly that.

**THREE OF THESE HAVE NO ROW IN THE TABLE ABOVE, deliberately.** The flag
(`cron_pipeline_reconcile_enabled`), `{{sport}}` and the outstanding copy were all real
owner decisions the table never listed. They are recorded here rather than appended as
rows 12–14, because that insertion point is where a concurrent branch adds its own
section and the two collide in every merge. If the table is ever renumbered, give them
rows then.

**Decision 8 — the 73 stranded re-permission runs: RE-DATE AND SEND.**
Measured on production 2026-09-21: **73 runs, 73 distinct people, all created 2026-08-22,
all `status = 'failed'` at `attempts = 1`.** Nothing was ever sent to any of them. A query
keyed on `status = 'active'` returns 0 and looks clean — it is not.
The sequence is **one email**, subject *"Can we text you?"*, followed by a `stop` step.
**This decision and G28 are the same decision.** G28 now refuses every manual text because
`contact_consents` has zero rows; `sms_repermission` is the mechanism that puts rows in
that table. Leaving the 73 stranded means the G28 override is needed forever.
**DONE — it ran on production 2026-09-21 at 12:00 UTC**, via
`scripts/repair-failed-sequence-runs.mjs` (tracked on `main` since 2026-09-01; a second script
for the same incident was written and thrown away — grep `scripts/` before building a repair).
Read back from production at 18:00 UTC:

| | |
|---|---|
| Emails sent | **73** |
| Delivered | 67 |
| Opened | 23 |
| Clicked | 2 |
| Bounced (2 suppressed) | 3 |
| Still `sent`, no delivery event | 3 |
| Runs now `completed` | 72 of 73 |
| **`contact_consents` rows created** | **2**, both `sms / granted / sms_consent_link` |

**This is the first time the Lead Engine has reached real leads at scale.** Everything before it
was a test address or a Stripe purchase. The `attempts = 1` failure cause was diagnosed first, as
this paragraph demanded: `business_settings.sender_email` named an unverified domain, corrected to
`noreply@mail.darrenjpaul.com` on 2026-09-20, and the domain reads `verified` from the Resend API.

**One bounce did not suppress, and that is the guard working.** `kaciawager@gmail.con` is `failed`
with no `contact_suppressions` row, while the other two bounces have one. Only a `Permanent` bounce
suppresses ([app/api/webhooks/resend/route.ts:95](../app/api/webhooks/resend/route.ts#L95)) —
deliberately, so a full mailbox never permanently ejects a live lead. A `.con` domain arguably
should have come back Permanent; worth one check against the Resend API if that address matters.

**Decision 12 (new) — `cron_pipeline_reconcile_enabled`: TURN IT ON.**
Verified: there is **no row** in `system_settings`; it is off by absence and the code
defaults false. G26 removed the duplicate-card hazard that was blocking it, and the
residual check its module comment documents re-ran at **0** (production has 5 bookings
all-time, 0 in the last 30 days). Owner said turn it on. Still to do, and outward-facing.

**Decision 9 — alert recipients: the tenant's own `reply_to`.**
Today all of it is hard-wired to DJP Athlete (`to: sales@`, `cc: darren@`, funnel alerts
always darren@ first, `from: RESEND_FROM_EMAIL`, DJP-wordmarked layout). Each alert takes
a `businessId`, sends from that tenant's `sender_name <sender_email>`, replies to their
`reply_to`, addresses the coach at `reply_to`, and renders their `display_name` /
`logo_url` / `postal_address`. **One address per tenant — no new column, no new UI.** The
funnel's existing `notify_emails` was offered as an addition and not taken; if a coach
later needs per-campaign routing, that column is already there. Unblocks G30.

**Decision 11 — tenant coaches editing their own settings: RECORD, DO NOT BUILD.**
Honours the `CLAUDE.md` invariant. This is a scoping question for the SaaS direction spec,
not something to settle inside a task that happens to touch permissions. **G34 stays open
deliberately** — that is the ruling, not an omission. The narrow version (a coach edits
only their own branding, no new roles or tiers) was offered and explicitly not taken.

**Decision 4 — hard bounce suppresses: YES, HARD ONLY.**
A hard bounce means the address does not exist; a soft bounce means a full mailbox or a
temporary server fault. **Soft bounces are ignored entirely** — no counter, no
suppress-after-N. Treating them alike would cut off people whose inbox was full that
morning. The qualifier is the guard: anything reading this must check the bounce TYPE, not
that a bounce happened. Unblocks G09.

**Decision 10 — `sms_help_text` / Twilio HELP reply: drafted to carrier convention.**
Shape: who is texting, what it is about, HELP for help, STOP to opt out, rates may apply —
built from the tenant's own business name. **Owner approves the exact words before it is
configured.** Remember that Twilio auto-replies are invisible to the API, so the handset
may see more than the code sent; verification has to be done on a real handset, and SMS
cannot currently be tested from the Philippines.

**Decision 13 (new) — `{{sport}}`: add it, merge field AND branching.**
The code is one `ENROLMENT_METADATA_KEYS` entry plus one line in
`app/api/inquiry/route.ts`. **The decision was never the code** — adding it also widens
what a coach can branch on, so `sport` becomes a routing input rather than a word in an
email. Owner took that knowingly; the branching is the point. Before building, measure
what fraction of inquiries actually carry a sport value: a branch on a usually-empty field
sends everyone down the else arm. Note `{{goals}}` remains deliberately unshipped.

**Decision 14 (new) — outstanding copy (G12, G17, G18): Claude drafts, owner approves in the admin.**
Written in plain English for the athlete or parent reading it, not for the person who
built the app. G17's six texts are editable live at `/admin/sequences/<key>` with **no
deploy**. Nothing can send while `contact_consents` is empty, so there is no urgency and
no risk in drafting first. G18 still needs the `ai_chat` sequence itself, which is the last
Phase 2 row open.

### What these rulings do NOT cover
Decisions 1, 2, 6 and 7 are untouched by this batch. Decision 3 (G28) and decision 5 (G21)
were ruled earlier the same day and are recorded above the table.
