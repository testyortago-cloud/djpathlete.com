# G32 — A new business starts with its boards and a starter set of sequences

**Date:** 2026-09-26 · **Ledger row:** G32 in `docs/lead-engine-gaps-to-ship-2026-09-19.md` · **Branch:**
`worktree-g32-business-starter-set` off `main@5b580027` · **Migration:** `00279` (re-check it is free before
merging) · **Status:** approved in conversation up to §1; §2-§6 decided by the builder while the owner was away
(autonomous mode), each decision marked **[builder]** so it can be overruled at review.

## 0. What the owner asked for, and what is assumed

**Said by the owner (2026-09-26, answering four questions and approving §1):**
1. Scope: the whole row now. `create_business()` seeds all three boards AND a starter set of sequences, all
   draft, plus a backfill for businesses that lack them. Groundwork, knowingly: a new business cannot use the
   sequences yet (§5).
2. The starter set is **eleven**: every platform sequence except `sms_repermission`.
3. The wording is a **light edit of the approved copy**: change only what is DJP-shaped, and list every change
   for approval (§2).
4. The set lives in a **SQL helper in a migration**, called by `create_business()` and by the migration's own
   backfill. Not a TypeScript module passed in, not a template table.
5. §1 below, as presented.

**Assumed by the builder:** that "the approved copy" means the repo's end state, which is what the dev clone
holds (all 45 bodies compared by the discovery agents), not production's hand-run variants (see §2.1).

## 1. What the migration does (approved)

One file, `supabase/migrations/00279_business_starter_set.sql`. No application code changes except stale
comments and one error mapping (§3.4).

1. **`public.seed_business_starter_set(p_business_id uuid)`** adds whatever that business is missing, keyed
   on absence: a board is added only if the business has no board with that key; a sequence only if it has no
   sequence with that key. Safe on any business, any number of times.
   - **Boards:** `coaching` (moved here from `create_business()`, so the three boards are defined in one
     place), `camps_clinics` and `assessment`, each with the exact stages the platform has (00249, 00257):

     | Board | Stages (key · name · position · kind · amber/red days) |
     |---|---|
     | `coaching` "Coaching" | `consult_booked` "Consult Booked" 1 open 3/7 · `consulted` "Consulted" 2 open 5/14 · `won` "Won" 3 won · `lost` "Lost" 4 lost |
     | `camps_clinics` "Camps & Clinics" | `interested` "Interested" 1 open 3/7 · `registered` "Registered" 2 open 5/14 · `won` 3 · `lost` 4 |
     | `assessment` "Assessment" | `assessment_booked` "Assessment Booked" 1 open 3/7 · `assessment_completed` "Assessment Completed" 2 open 5/14 · `won` 3 · `lost` 4 |

   - **Sequences:** the eleven, every one `status = 'draft'`, keeping the platform's `trigger_source` and
     `trigger_filter` so each is wired the same way when switched on. `reenrol_cooldown_days` is set
     explicitly: 0 for the four `quiz_*` (a retake must get its result email, 00263), 30 for the rest.
   - **Every row names its business.** `sequences.business_id`, `sequence_steps.business_id`,
     `pipelines.business_id` and `pipeline_stages.business_id` all DEFAULT to the platform's id; an insert that
     leaves one out files it under the platform, silently. The tick would still send such a step (it reads by
     `sequence_id`), but the editor would not show it and the next save would collide.
   - **Steps:** each sequence is ONE dollar-quoted JSON literal in `save_sequence_steps`' `p_steps` shape
     (00256: the array index is the position; `kind, wait_minutes, subject, body, branch_condition,
     on_true_position, on_false_position, config`), expanded with `jsonb_array_elements ... WITH ORDINALITY`
     exactly as that RPC does.
2. **`create_business()` is replaced** with the SAME six arguments (so `lib/db/businesses.ts` is unchanged and
   the deploy order does not matter). It calls the helper instead of inserting the coaching board itself, and
   stays one transaction, so a business can never be half-provisioned.
3. **Grants, restated.** `create or replace` re-fires Supabase's default privileges and hands anon and
   authenticated EXECUTE back. Both `create_business` and every new function: `revoke all ... from public`,
   `revoke execute ... from anon, authenticated`; `create_business` alone is granted to `service_role`. The new
   functions need no grant: nothing calls them over PostgREST.
4. **Backfill:** the migration runs the helper for EVERY business. Keyed on absence inside the helper, so it
   changes the 7 dev-clone test businesses (each gains 2 boards, 8 stages, 11 draft sequences) and nothing on
   production, whose one business already has all of it.
5. **Board order.** `listPipelines` orders by `created_at, key`, and everything inserted in one transaction
   shares `now()`, so a new business would list Assessment, Camps & Clinics, Coaching. The two extra boards are
   stamped `now() + interval '1 millisecond'`, so every business lists Coaching first, as the platform does.

## 2. The wording **[builder, within the owner's "light edit" ruling]**

### 2.1 Baseline
The repo's end state of each sequence, which the dev clone holds exactly. Production differs in one known
place: `new_lead_nurture` there has 8 steps (a text added by the 2026-08-31 SMS go-live runbook, whose wording
exists in the repo only as a comment in 00222). The starter set uses the repo's 6-step shape: the runbook step
was the platform's own go-live decision, not part of the approved sequence set. Production copy edited in the
step editor after 2026-09-20 cannot be seen from here and is deliberately not copied: the owner's live edits
are the owner's voice, not a starter template.

### 2.2 Every change (58 fields; generated, each edit asserted to match exactly once)

**Greeting, 33 emails:** `Hi {{name}}` becomes `Hi {{first_name}}` (G16's token), so a lead reads "Hi Jane",
not "Hi Jane Smith". A nameless contact still reads "Hi", exactly as before.

| Sequence | Step | Field | Before | After | Why |
|---|---|---|---|---|---|
| `lead_magnet_delivery` | 5 | body | Hi {{name}} — did the download land? | Did the download land? | text rules (00272): no {{name}}, plain ASCII |
| `newsletter_welcome` | 4 | body | Hi {{name}} — thanks for joining the newsletter. Expect one useful training idea a week, no filler. | Thanks for joining the newsletter. Expect useful training ideas, no filler. | text rules; no weekly promise a coach may not keep |
| `cold_lead_re_engagement` | 4 | body | Hi {{name}} — no pressure. | No pressure. | text rules |
| `abandoned_checkout` | 4 | body | Hi {{name}} — you started | You started | text rules |
| `service_application_received` | 1 | body (coach alert) | They have already had the automatic "we have your application" email, and the follow-up emails are still going out on schedule. | The follow-up emails are still going out on schedule. | drops a claim about an automatic email this business may not send |
| `camp_clinic_deadline` | 0 | body | It's a small group, coached in person, working on | It's a small group, working on | does not assume the camp is in person |
| `camp_clinic_deadline` | 2 | body | Parents are welcome to watch. Athletes usually | Athletes usually | does not state a spectator policy the coach may not have |
| `quiz_ceiling_breaker`, `quiz_rebuilder`, `quiz_aspiring_pro` | 0 | subject | Your Athlete Quiz result | Your quiz result | no platform product name |
| `quiz_ceiling_breaker` | 8 | body | You're already training with us, so there is nothing to sign up for here. | You already have an account with us, so there is nothing to sign up for here. | says what the branch checks (an account) |
| `quiz_rebuilder` | 8 | body | You're already training with us, so this isn't about booking anything. | You already have an account with us, so this isn't about booking anything. | same |
| `quiz_aspiring_pro` | 8 | body | You're already training with us, so there's nothing to sign up for here. | You already have an account with us, so there's nothing to sign up for here. | same |
| `quiz_parent_coach` | 8 | body | The athlete is already training with us, so there's nothing here to sign up for. | The athlete already has an account with us, so there's nothing here to sign up for. | same |

The text rules are 00272's: plain ASCII (one em dash forces the whole message to UCS-2 and roughly triples its
cost), no `{{name}}` (it can render empty and makes the length non-deterministic), one segment with the opt-out
sentence appended. The four older texts from 00222 predate them.

**Descriptions** (all eleven rewritten for a coach; none names internal code, Stripe, GHL, a platform page or
a platform programme). The four quiz descriptions gain: "It only runs for a quiz copied from the built-in
athlete quiz, whose results carry these names." The full before/after list is in the plan's Task 1 data.

**Kept on purpose:** names (the quiz ones are the built-in quiz's own result names); every structural field
(kinds, waits, the camp countdown anchors, the tag, both branches and their targets) is identical to the
platform's; the coach alert keeps `{{name}}` (a coach wants the full name).

## 3. How it is proven **[builder]**

### 3.1 Static test — `__tests__/migrations/00279_business_starter_set.test.ts`
Parses the migration (comments stripped first) and asserts:
- The eleven `$seq$...$seq$` literals parse as JSON; the key set is exactly the eleven; `sms_repermission` is
  absent; every sequence is `draft`; cooldown 0 for `quiz_*`, 30 otherwise; every `trigger_source` is a
  `ContactEventSource` value or null; the quiz filters' `branch` values are `RPI_ATHLETE_QUIZ`'s branch keys.
- Every step list passes the app's own `validateStepList`; no email or text uses a token outside
  `MERGE_FIELD_KEYS` (`unknownMergeFields`); every text is plain ASCII, carries no `{{`, and is ONE segment
  with `SMS_OPT_OUT_SENTENCE` appended (`countSmsSegments`).
- **Structure parity:** each sequence's steps equal the platform's end state in every field except `subject`
  and `body`, against a checked-in fixture of the platform's steps as of this migration
  (`__tests__/migrations/fixtures/00279-platform-sequences.json`, dumped read-only from the dev clone, which
  matches the migrations' end state).
- **Brand sweep** over names, descriptions, subjects and bodies: `no-brand-literals.test.ts`'s `FORBIDDEN` plus
  the words the discovery found it misses: `Athlete Quiz`, `RPI`, `Step-Up`, `GHL`, `sales inbox`, a bare
  `darrenjpaul`, `Stripe`, and any `http`. The migration is also added to that test's `ROOTS`.
- The three boards' stages equal the table in §1 exactly.
- Every `insert into public.sequences|sequence_steps|pipelines|pipeline_stages` in the file names
  `business_id`.
- `create_business` keeps its six-argument signature, is `security definer` with `search_path = public`,
  calls the helper, and no longer inserts a board itself; the grant block names `public`, `anon`,
  `authenticated` for every function defined, and grants `create_business` to `service_role` only.
- The backfill loops over every business and calls the helper (no id list).
Each check is mutation-tested: a planted fault (a status `active`, a dropped `business_id`, an em dash in a
text, a branch arm without its stop, a missing revoke) must turn it red.

### 3.2 Live test on the dev clone
Same file, a `describeIf` block gated on the dev clone's URL (the 00276/00277 pattern, so a missing env reads
as skipped, never as a quiet pass of the static half). It creates a throwaway business through
`create_business`, then asserts: three boards, listed Coaching first by the app's own `listPipelines`; eleven
sequences, all draft; each sequence's step count equals the literal's; every step's `business_id` is the new
business; the platform business's row counts are unchanged; running the helper a second time adds nothing.
It deletes the business in `afterAll` (every table involved cascades).

### 3.3 Applying it to the dev clone
Through the Supabase MCP `apply_migration`, as recent rows did (the dev clone has no `repo_migrations`, so
`scripts/migrations/apply.mjs` refuses there). Read back afterwards: the function body, the grants, and the 7
businesses' counts. **This changes shared fixture businesses** other sessions use; see §5.

### 3.4 One error mapping
`createBusiness` (`lib/db/businesses.ts`) turns ANY `23505` into `SlugTakenError`. The new function inserts
more rows, so a duplicate elsewhere would tell the operator the slug is taken. It now maps only a violation
that names `businesses_slug_key` (checked in `message` and `details`, the G33 pattern) and rethrows anything
else as it came. Test: the slug case, an unrelated 23505 (control), and the doc comment corrected (it still
says 00244 and four rows).

### 3.5 Gates
Targeted suites (the files written or edited, plus every suite importing a changed module), `tsc` at 238/54
per-file identical, `npm run test:integration:selects`, `npm run build`, `SINGLETON_BUSINESS_ID` still 5, and
a whole-branch review. Screenshots from the real app on the dev clone: a backfilled business's
`/admin/sequences` (eleven drafts) and `/admin/pipeline` (three boards, Coaching first), annotated.

## 4. Stale text this makes false **[builder]**
`lib/db/pipeline.ts` (the fallback's comment, ~998-1005, and `listPipelines`' doc, ~1878-1880),
`app/(admin)/admin/pipeline/page.tsx` (~50-53, ~130), `app/(admin)/admin/pipeline/settings/page.tsx` (~44),
`lib/db/businesses.ts` (createBusiness' doc), and test comments in `pipeline-board.test.tsx` (~204, ~258),
`pipeline.test.ts` (~2848) and `pipeline-page-tenancy.test.tsx` (~149). The fallback itself stays: a business
can still archive a board, and the memory `seeding-a-board-is-not-provisioning-it` explains why.
Two capture scripts use "Northcrest 10E has no sequences" as their wrong-tenant control
(`scripts/capture-sequence-reporting-screenshots.mjs`, `scripts/capture-sequence-content-screenshots.mjs`); the
backfill breaks that, so the control changes to "10E's sequences are its own, all draft".

## 5. What this does NOT do (so nobody assumes it) **[builder]**
- **A new business still cannot use these sequences.** Three things stand in the way, none of them G32's:
  nothing in the app writes `business_domains`, so every public form files under the platform; only
  `users.role = 'admin'` can read, edit, switch on or enrol into a sequence; and the owner cannot set
  `sender_email` / `postal_address`, which sending requires (G34, parked by ruling).
- **No switch-on guard.** Switching a sequence on checks nothing (`findLivePlaceholders` has no caller). The
  drafts are the only safety, and only the platform operator can switch one on.
- **Future copy migrations.** 00271/00272 rewrote copy matched by key, for every business. From now on a
  migration that changes sequence copy by key reaches tenants' drafts too, which they may have edited. Such a
  migration must say which businesses it touches, and must update the starter set in the same migration if new
  businesses should get the change. The helper's header says so.
- Not fixed here, recorded as ledger rows (§6): the dev clone's drift, the quiz clone's "Book a call with
  Darren", `has_user` crossing businesses, and the unsubscribe/consent links' platform-branded pages.

## 6. Ledger
G32's row records what was built and verified. New rows for what discovery found outside G32:
- **G46 · The dev clone has drifted from the migrations:** its `save_sequence_steps` lacks the row-count check
  375b3375 added (it runs e8a10efb's body), and 00231's RLS is not on its pipeline tables (anon can SELECT and
  INSERT there). Production was measured locked down on 2026-09-21 and was not re-read.
- **G47 · Cloning the built-in quiz copies "Book a call with Darren"** (`lib/quizzes/seed/rpi-athlete-quiz.ts`).
- **G48 · The `has_user` branch crosses businesses:** it tests `contacts.user_id`, and `linkContactsToUser` sets
  that on every business's contact with the same email, so a platform client who takes another coach's quiz
  takes the "already has an account" arm.
- **G49 · A tenant's unsubscribe and consent links land on the platform's branded pages** (`appOrigin()` is
  deployment-wide; the pages sit under `app/(marketing)` with the platform navbar).
