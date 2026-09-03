# Calendly per coach — phase 0: the tenancy foundation

**Status:** approved at brainstorming 2026-09-03. Not yet built.
**Date:** 2026-09-03
**Branch:** `feat/calendly-per-coach`, cut from `feat/calendly-booking` @ `225b7fb4`. Worktree at `.claude/worktrees/calendly-per-coach`.
**Parent decision record:** [2026-09-03-native-multi-coach-booking-design.md](2026-09-03-native-multi-coach-booking-design.md) — §3.4 records the owner's reversal to Calendly per coach, §14.4 is the phase table, §4 and §5 are the tenancy and data models this phase implements.
**Provider design:** [panel/A-calendly-per-coach.md](../research/2026-09-03-native-booking/panel/A-calendly-per-coach.md). Where it and the parent spec disagree on tenancy, the parent spec wins — it carries 179 review findings.

**SQL in this document is not a sketch.** Every statement in §2, §3 and §5 was run against the dev clone (`anjvztjiokcgiyhobknq`) inside `begin … rollback` on 2026-09-03 and compiled. That is the one thing phases 1 and 2 of the Full Engine both got wrong, and the parent spec's header says so.

---

## 0. What this phase builds, and what it deliberately does not

Phase 0 makes a second coach *possible* at the schema and the consequence chain. It ships no UI, no OAuth, no second coach. When it is done, a booking still arrives exactly as it does today — through the shipped Calendly webhook, keyed to the owner's own account by environment variable — but it lands stamped with a `business_id` and a `host_id`, and every one of its four consequences is scoped to that business instead of falling to a constant.

**In scope.** Eight new tables with RLS; RLS on `bookings`; seven new `bookings` columns; the four-way split of `ingestBooking`; `businessId`/`hostId` threaded through the ingest and its four consequences; `exitRunsForContact`'s missing tenant predicate; `CaptureLeadInput.businessId`; the admin notification fan-out narrowed from "every admin in the deployment" to "this business's members"; the ads account resolved per business; the booking notification string formatted in the business's zone rather than the server's.

**Out of scope, and each for a stated reason.**

| Not built | Why |
|---|---|
| The `fn_*` RPC quartet for `coach_calendar_connections` | Its caller is the OAuth callback, which is phase 2. An RPC with no caller is a reader-less column. The one thing that had to be settled early — whether the disconnect RPC can delete a Vault secret at all — was settled by probe instead (§8, V1). |
| The `btree_gist` extension and the exclusion constraint (parent spec §5.4) | Calendly arbitrates every booking on this path. A `23P01` raised inside our webhook returns 5xx to Calendly, and 24 hours of that **disables the coach's subscription** and it must be recreated. A constraint that can silently kill a coach's booking feed is worse than no constraint. It returns with the `arbiter` column if a direct-book path is ever built. Owner-confirmed at brainstorming. |
| The neutral `Slot` / `AvailabilityResult` type (parent spec 0c, decision 4) | Its only consumer is the per-business availability provider, which is phase 2. Moved there so it ships beside its second caller rather than as an abstraction over one. |
| The five `google_*` columns, `idempotency_key`, `ip_hash`, `sequence`, `rescheduled_count`, `cancelled_at`/`cancelled_by`/`cancel_reason`, `location_kind`/`location_value`, `visitor_timezone`, `host_timezone`, `consequences_error` (parent spec §5.3) | Native-path columns. Calendly holds the calendar, so nothing in this build writes a Google event id; the rest belong to the native booking route and its manage page. Adding them now is nineteen columns with no writer. `consequences_error` is the one worth revisiting — the never-rethrow catch at `ingest.ts:159-177` currently only `console.error`s — but it is a feature, not tenancy. |
| A `CHECK` on `bookings.source` | Production rows cannot be read from a branch and a losing bet fails the migration mid-deploy (00239's own header). |
| `createBusiness`, the admin form, member invitation, per-business settings editing | Phase 1. Phase 0 gives them their tables. |

---

## 1. Decisions this phase rests on

Three were put to the owner at brainstorming and answered; the rest were resolved against the two source documents and are recorded here because they are places the documents disagree.

1. **No exclusion constraint** (owner). Reason above.
2. **Ads: a `business_id` column with a singleton default, and per-business resolution** (owner). `google_ads_accounts` gains `business_id uuid not null default '…0001'`; `enqueueBookingConversion` takes a `businessId` and picks that business's first active account; a business with no account enqueues nothing. Every existing row defaults to the singleton, so the four rows on the clone and every current reader — including the Firebase twin at `functions/src/ads/dal.ts` — keep working untouched.
3. **RLS on `bookings`: yes** (owner). Verified safe first: all seven `from("bookings")` call sites use the service-role key, including `functions/src/ai/admin-tools.ts:1544`, which goes through `functions/src/lib/supabase.ts` and that file reads `SUPABASE_SERVICE_ROLE_KEY`. There is no anon-key read of `bookings` in the repo.
4. **The connection table is named `coach_calendar_connections` but keyed the parent spec's way.** The brief and proposal §2 name it `coach_calendar_connections` and key it `(business_id, provider)`; parent spec §4.3 names it `calendar_connections` and keys it `(host_id, provider)` with a two-column foreign key. Taken: the brief's **name**, the spec's **key**. The row carries both `business_id` and `host_id`, is unique on `(host_id, provider)`, and takes `foreign key (host_id, business_id) references booking_hosts(id, business_id)`. Keying on the host costs nothing today — there is one host per business — and means "two coaches in one business" is a row, not a migration. The composite foreign key is what stops a row naming business A and a host in business B, which every `.eq("business_id", …)` read would then answer wrongly.
5. **The Vault secret name is `'coach_calendar_connections:' || business_id || ':' || host_id || ':' || provider`.** Tenant-qualified as the brief requires, and unique per host so a second host in one business cannot overwrite the first — which is the exact failure `fn_connect_platform` has today, where the name is `'platform_connections:' || plugin_name` with no tenant segment at all. Written down here; used in phase 2.
6. **The `business_members` backfill inserts every current `role='admin'` user as an `owner` of the singleton**, not one owner. Parent spec §5.1 says "one `business_members` row (the owner)", but §4.2 simultaneously narrows the booking notification fan-out from every `role='admin'` user to the business's members. Backfilling one member would silently stop notifying the other admins — a behaviour change disguised as a tenancy fix. Every admin becomes an owner of the singleton, which makes the fan-out change provably behaviour-identical on day one. The dev clone has exactly one such user; production may have more, and this is written so the count does not matter.
7. **`bookings.business_id` carries a singleton `DEFAULT` through the tightening migration, and only then loses it.** The default is what lets the previous build's inserts stay valid across the deploy where migration and Vercel race. `host_id` and `end_at` cannot have a static default, which is precisely why the tightening is a separate, later migration rather than a flag on this one.

---

## 2. Migration A, part 1 — the eight tables

One migration file, `supabase/migrations/00240_booking_tenancy.sql`. **Check the number before writing it**: 00239 is the highest on this branch, but a peer session on `feat/calendly-booking` may have claimed 00240 in the meantime, and git merges a collision clean.

Statement order is parent spec §5's, and it is load-bearing: assembled in document order the migration fails with `42P01`, because `coach_calendar_connections` and `booking_types` both reference `booking_hosts`, and `booking_notifications` references `bookings`.

```
alter businesses
  → booking_hosts (+ its composite unique index)
  → business_members, business_domains
  → booking_types, booking_availability_rules, booking_availability_overrides
  → coach_calendar_connections
  → booking_notifications
  → RLS + service-role policy on all eight
  → backfill
```

The full DDL is the block validated on the clone; it is reproduced in the implementation plan rather than duplicated here, with these details fixed:

- `businesses` gains `slug text unique` (nullable for one deploy — a UNIQUE column admits any number of NULLs), `status` (`active|paused`), `booking_provider` (`calendly|native`, default `calendly`), `created_by`.
- `booking_hosts` is parent spec §5.1 verbatim, including `create unique index booking_hosts_id_business_key on (id, business_id)` — the composite key the children's two-column foreign keys need.
- `coach_calendar_connections` adds one index the source documents do not have: `unique (event_type_uri) where event_type_uri is not null`. The webhook's tenant proof in phase 2 is "this delivery's `event_type` matches this connection's row", and that proof is only sound if one event type cannot belong to two connections.
- `booking_notifications` uses `unique nulls not distinct (booking_id, kind, sequence, reminder_offset_minutes)`. **Postgres 17.6 confirmed on the clone**, so the 15+ requirement is met (the parent spec had this as "likely 17"). This table has **no writer until phase 4's optional courtesy email**; it is created here because the brief's 0a lists it and because adding a table to a live schema later is more disruptive than an empty one now. Phase 4 will need to widen `kind` — the current closed set is the native path's six values and none of them is "a courtesy note beside Calendly's own confirmation".
- **Every table gets `enable row level security` and the house `for all to service_role using (true) with check (true)` policy in this same file**, matching `00212:38-44`. `CREATE POLICY` has no `IF NOT EXISTS`; the re-run guard belongs in the applier script, never in the `.sql`.

**Backfill, in this order:**

```sql
-- every current admin becomes an owner of the singleton (decision 6)
insert into public.business_members (business_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', u.id, 'owner'
  from public.users u where u.role = 'admin'
on conflict (business_id, user_id) do nothing;

-- one host for the singleton, identity taken from business_settings
insert into public.booking_hosts (business_id, user_id, display_name, email, timezone)
select bs.business_id,
       (select id from public.users where role = 'admin' order by created_at limit 1),
       coalesce(nullif(bs.display_name, ''), b.name),
       coalesce(nullif(bs.reply_to, ''), nullif(bs.sender_email, ''), ''),
       bs.timezone
  from public.business_settings bs
  join public.businesses b on b.id = bs.business_id
 where bs.business_id = '00000000-0000-0000-0000-000000000001'
   and not exists (select 1 from public.booking_hosts h where h.business_id = bs.business_id);
```

`email` is `NOT NULL` but may be the empty string, matching `business_settings`' own `NOT NULL DEFAULT ''` idiom for the same identity fields. It is not used to send anything in this phase.

## 3. Migration A, part 2 — `bookings` grows a tenant

Same file. Additive and nullable, so the previous build keeps inserting successfully for the one deploy where migration and Vercel race.

```sql
alter table public.bookings
  add column if not exists business_id          uuid references public.businesses(id)
                                                default '00000000-0000-0000-0000-000000000001',
  add column if not exists host_id              uuid references public.booking_hosts(id),
  add column if not exists connection_id        uuid references public.coach_calendar_connections(id) on delete set null,
  add column if not exists contact_id           uuid references public.contacts(id) on delete set null,
  add column if not exists chat_conversation_id uuid references public.chat_conversations(id) on delete set null,
  add column if not exists end_at               timestamptz,
  add column if not exists invitee_timezone     text;
```

Seven columns, each with a writer landing in this phase:

| Column | Writer in phase 0 | Reader |
|---|---|---|
| `business_id` | the ingest, explicitly, from both adapters | every scoped read, immediately; `readByKey` gains a `business_id` predicate so a redelivered `calendly_event_uri` can never match across tenants |
| `host_id` | the ingest | phase 2's connection resolution; the `(host_id, booking_date)` index |
| `connection_id` | the ingest (null in phase 0 — the connection row does not exist until phase 2) | phase 2's webhook, phase 3's sweep |
| `contact_id` | the ingest, from the contact it already resolves | phase 1's contact detail, which today matches `bookings` to a contact by in-memory email/phone comparison (`contact-detail.ts:603-611`) |
| `chat_conversation_id` | the Calendly adapter, from the conversation id it already carries into audit metadata (`route.ts:235`) | phase 2's assistant attribution |
| `end_at` | the ingest, `booking_date + duration_minutes` | the range check in §5; admin display |
| `invitee_timezone` | the Calendly adapter, which parses this today at `route.ts:81` and then drops it | phase 3's admin display |

Backfill:

```sql
update public.bookings set business_id = '00000000-0000-0000-0000-000000000001' where business_id is null;
update public.bookings b
   set host_id = (select h.id from public.booking_hosts h
                   where h.business_id = b.business_id order by h.created_at limit 1)
 where b.host_id is null;
update public.bookings
   set end_at = booking_date + make_interval(mins => greatest(coalesce(duration_minutes, 30), 1))
 where end_at is null;
```

`greatest(…, 1)` because `00050:6` is `duration_minutes int DEFAULT 30` with no positivity CHECK; a stored `0` would make `end_at = booking_date` and fail the range check in §5. The clone reports zero such rows today, but the clone is not production.

Indexes and RLS:

```sql
create index if not exists bookings_business_id on public.bookings (business_id);
create index if not exists bookings_host_start  on public.bookings (host_id, booking_date);
create index if not exists bookings_contact_id  on public.bookings (contact_id) where contact_id is not null;

alter table public.bookings enable row level security;
create policy "Service role full access on bookings"
  on public.bookings for all to service_role using (true) with check (true);
```

## 4. The code (0b)

**Do the refactor first, and prove it changed nothing.** `ingestBooking` is 188 lines of straight-line code with four consequences interleaved. Split it into `readAndGate` / `runContactConsequences` / `writeRow` / `runPostWriteEffects` as a pure move — no signature changes, no threading — and run `__tests__/lib/bookings/ingest.test.ts` and `__tests__/api/webhooks/calendly-booking.test.ts` green before touching anything else. Threading a tenant through code you have just restructured makes a test failure ambiguous between the two.

Then, in order:

1. **`BookingIngestInput` gains `businessId: string` (required) and `hostId: string | null`, `connectionId: string | null`.** Required, not defaulted — parent spec §4.2: "a new function that defaults the tenant is how the next leak ships." Both adapters pass `SINGLETON_BUSINESS_ID` and the singleton's host explicitly; phase 2 replaces the Calendly one with the connection's business.
2. **`findContactByIdentifiers({ …, businessId })` and `applyPipelineEvent({ …, businessId })`** stop falling to their defaults. Both already accept the override.
3. **`exitRunsForContact(contactId, reason, businessId)`** — a third parameter and a `.eq("business_id", businessId)` predicate. **This is the one that matters most.** Its current signature is `(contactId: string, reason: string)`, so passing a business id as the second argument type-checks — both are strings — and would write a uuid into `exit_reason` while applying no tenant predicate at all. All four call sites (unsubscribe, payment, booking, tick-time suppression) must be found and updated; the parameter must be typed so `tsc` polices it.
4. **`CaptureLeadInput` gains `businessId?: string`**, threaded to `recordContactEvent`, which already accepts it. Without this every coach's chat-captured lead files under the singleton's contacts.
5. **The admin fan-out narrows to the business's members.** Today: `select id from users where role = 'admin'` — a cross-tenant broadcast the day a second business exists. After: the `business_members` rows for this business, joined to `users`. The §2 backfill makes this identical in behaviour today.
6. **The "New Call Booked" string formats in the business zone.** `ingest.ts:293-296` calls `toLocaleString` with no `timeZone`, i.e. the server process zone — and `TZ` is reserved on Vercel, so the project cannot even set it. Pass `business_settings.timezone`. This closes the fourth of the four zones the research found.
7. **`enqueueBookingConversion({ …, businessId })`** resolves that business's first active account rather than `google_ads_accounts[0]`.
8. **`readByKey` gains `.eq("business_id", businessId)`.**
9. **The ingest writes `end_at`, `contact_id`, `host_id`, `business_id`**; the Calendly adapter additionally writes `chat_conversation_id` and `invitee_timezone`, both of which it already has in hand and currently discards.

## 5. Migration B — the tightening, a separate deploy

`supabase/migrations/00241_booking_tenancy_not_null.sql`, applied only after §4 is deployed and writing all three columns.

```sql
-- preconditions, read back BEFORE running (parent spec §5.3 step C):
--   select count(*) from public.bookings where business_id is null or host_id is null or end_at is null;  -- must be 0
--   select count(*) from public.bookings where end_at <= booking_date;                                     -- must be 0
alter table public.bookings
  alter column business_id set not null,
  alter column host_id     set not null,
  alter column end_at      set not null;
alter table public.bookings
  add constraint bookings_end_after_start check (end_at > booking_date) not valid;
alter table public.bookings validate constraint bookings_end_after_start;
```

`NOT VALID` then `VALIDATE` so the table is not exclusively locked for the full scan. The `business_id` default is **kept** through this migration and dropped in a later one — belt and braces for one more release, exactly as proposal §9 step 4 stages it.

Three deploys, not one. Setting a column `NOT NULL` while the previous build is still serving is how a migration takes production down.

## 6. Tests

**Retarget, do not delete.** Pointing an existing suite at the changed thing is what caught both real bugs in the one-board merge.

| Suite | What changes |
|---|---|
| `__tests__/lib/bookings/ingest.test.ts` (323 lines) | Fixtures gain `businessId`/`hostId`; assertions gain the tenant arguments passed to each consequence. Every existing behaviour assertion stays. |
| `__tests__/api/webhooks/calendly-booking.test.ts` (325 lines) | Same, plus the two newly-written columns. Pin `// @vitest-environment node` — the jsdom suites report "no tests" on this repo (`ERR_REQUIRE_ESM`), and a suite that reports "no tests" looks exactly like a suite that passes. |
| new: `exitRunsForContact` tenancy | Two businesses, one contact id in each, assert the other business's active run is untouched. This test must **fail** against the current two-parameter signature, or it is pinning nothing. |
| new: fan-out scoping | A second business with its own member; assert its booking notifies only its member, and that the singleton's booking still notifies every backfilled admin. Needs a presence control — "no notification for the other business" passes just as well when nothing was inserted at all. |
| new: ads resolution | A business with no `google_ads_accounts` row enqueues nothing; a business with one enqueues against *its* account, not `accounts[0]`. |

**Targeted runs only**, plus `npx tsc --noEmit` compared against the baseline. A falling count hides new errors too, so compare the *file list*, not just the number.

## 7. Verification gates

1. `npx tsc --noEmit` — **baseline is exactly 251 errors**, measured in this worktree on 2026-09-03 at `225b7fb4`.
2. Targeted vitest: the two retargeted suites plus the three new ones, all green.
3. Both migrations applied to the dev clone and **read back** — `pg_constraint`, `pg_policies`, and the `information_schema.columns` shape, not the fact that the apply returned success.
4. A mutation check on the three new suites: apply the change each one claims to catch and confirm it goes red. A test that is green on first run may be pinning a different mechanism than its comment claims.
5. A real-browser pass on `/admin/bookings` and one contact detail page, proving the admin surface still renders after RLS is enabled and the columns land, with annotations burned into the PNGs under `screenshots/calendly-per-coach/`.

## 8. Facts established while designing this, so they are not re-derived

| Fact | How it was established | Consequence |
|---|---|---|
| **V1 — a `SECURITY DEFINER` function granted to `service_role` CAN delete from `vault.secrets`** | Probe on the dev clone: created such a function shaped like `fn_disconnect_platform`, invoked it under `set local role service_role`, got `rows_deleted = 1`, dropped the function and the secret. This is the rigorous form — `00153` proved that being `SECURITY DEFINER` did **not** save a direct `UPDATE` from `42501`, so the `DELETE` had to be exercised the same way. | Parent spec §15.2 V1 is **closed**. The phase-2 disconnect RPC can delete the secret; the "orphan the secret and forget the id" fallback is not needed. |
| Dev clone is **Postgres 17.6**; `btree_gist` available, **not installed** | `current_setting('server_version')` | `unique nulls not distinct` is available. `btree_gist` stays uninstalled — nothing in this plan needs it. |
| All seven `bookings` readers use the service-role key | Enumerated every `from("bookings")` call site and traced each file's client, including the Firebase twin | RLS on `bookings` is safe. |
| `tsc --noEmit` baseline = **251** | Run in this worktree at `225b7fb4` | The gate in §7. |
| Dev clone row counts: 6 bookings, 1 business, 1 admin user, 4 ads accounts, 15 contacts, 0 bookings with a bad `duration_minutes` | `select count(*)` | The backfills have something to act on, and the `greatest(…, 1)` guard is belt-and-braces here but not necessarily in production. |
| The whole §2/§3 DDL compiles | Run inside `begin … rollback` on the clone; 8 tables created, rollback verified clean | The SQL in this document is not a sketch. |

## 9. What phase 0 hands to phase 1 and phase 2

**Phase 1** gets its tables — `business_members` for invitation, `businesses.slug`/`status` for creation, `business_domains` for later — and needs `createBusiness`, which does not exist: `lib/db/businesses.ts` exports a getter and a setter and nothing inserts into `businesses`.

**Phase 2** gets `coach_calendar_connections` and the proven Vault delete, and needs the `fn_*` quartet, the PKCE flow with the state nonce actually checked (the three existing Google flows never check theirs), the refresh under `pg_advisory_xact_lock`, and the neutral `Slot` type moved here from parent spec 0c.

## 10. Post-review addendum: §5's "later deploy" means a later PULL REQUEST

The final whole-branch review (2026-09-03) found that §5's staging plan had a hole: this document, and the migration file itself, both said "a separate deploy" and "must not be folded into either of the others," but everything that actually landed — the tightening migration, the code that writes all three columns, and the columns-nullable migration — sat on **one branch** (`feat/calendly-per-coach`). `.github/workflows/apply-migrations.yml` applies **every pending migration in one unattended run** on push to `main`, with nothing sequencing it against the Vercel build that deploys the same push. Three files on one branch is three migrations in one Action run the moment that branch merges — the three-deploy staging §5 describes was defeated by the branch structure carrying it, not by anything in the SQL.

Concretely: the migration renumbered to `00243_bookings_tenant_not_null.sql` sets `bookings.host_id` and `bookings.end_at` `NOT NULL` with no `DEFAULT` (unlike `business_id`, which keeps one). The Action finishes in a couple of minutes; the Vercel build carrying the code that names those columns on every insert takes several more. For that window, the *previous* build — which does not yet write `host_id`/`end_at` — is still serving, and every booking insert from both vendors (GHL and Calendly) fails `23502` and 500s. Calendly's retry policy disables a subscription after 24 hours of failed delivery.

**The fix, applied on `feat/calendly-per-coach` itself:** `00243_bookings_tenant_not_null.sql` is removed from this branch. A separate branch, **`feat/calendly-per-coach-tighten`**, carries only that file, restored unchanged, and is not pushed or merged by this work. §5's "must not be folded into either of the others" now means: the tightening migration merges to `main` through its **own pull request**, opened only after the pull request carrying `feat/calendly-per-coach` (the columns-nullable migration plus the writers) has merged, deployed, and been observed live — not merely merged in git. Its two preconditions (§5's `select count(*) … must be 0` queries) must be read back against the target database immediately before that second PR merges, not assumed from the dev clone.

"Separate file" was never "separate deploy" in this repo — a PR is the unit this GitHub Actions setup actually serializes on. A future phase that needs a third deploy should plan the PR boundary, not just the file boundary.
