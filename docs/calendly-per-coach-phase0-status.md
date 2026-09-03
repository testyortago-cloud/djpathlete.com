# Calendly per coach — phase 0 status and handover

**Date:** 2026-09-03
**Branches:** `feat/calendly-per-coach` (the work) and `feat/calendly-per-coach-tighten` (one migration, held back deliberately — see §3). Neither is pushed. Neither is merged.
**Cut from:** `feat/calendly-booking` @ `225b7fb4`.
**Spec:** [2026-09-03-calendly-per-coach-phase0-tenancy-design.md](superpowers/specs/2026-09-03-calendly-per-coach-phase0-tenancy-design.md) · **Plan:** [2026-09-03-calendly-per-coach-phase0-tenancy.md](superpowers/plans/2026-09-03-calendly-per-coach-phase0-tenancy.md)

---

## 1. What is done

Phase 0 of §14.4 in the parent design spec. A second coach is now *possible* at the schema and at the consequence chain. Nothing user-facing changed, and no second coach exists — that is phase 1.

| | |
|---|---|
| **Eight new tables** | `booking_hosts`, `business_members`, `business_domains`, `booking_types`, `booking_availability_rules`, `booking_availability_overrides`, `coach_calendar_connections`, `booking_notifications` — each with RLS and a service-role policy in the same migration |
| **`bookings` grew a tenant** | `business_id`, `host_id`, `connection_id`, `contact_id`, `chat_conversation_id`, `end_at`, `invitee_timezone`; three indexes; RLS turned on |
| **The ingest carries a tenant** | split four ways (`readAndGate` / `runContactConsequences` / `writeRow` / `runPostWriteEffects`) and threaded with a **required** `businessId` |
| **Four consequences scoped** | sequence exit (a real `business_id` predicate at last), pipeline card, ads conversion (per business, not `accounts[0]`), admin notification (this business's members, not every admin in the deployment) |
| **The fourth timezone closed** | the "New Call Booked" string renders in the business's zone, not the server process zone — which on Vercel cannot even be set, because `TZ` is reserved |

**Verified, not asserted:** 147/147 across 11 targeted suites; `tsc --noEmit` at 251 errors with an error **set** byte-identical to the branch point (a matching count alone would hide a swap); all four migrations applied to the dev clone and read back; four annotated screenshots driven through the real admin routes by a real signed Calendly webhook, in `screenshots/calendly-per-coach/`.

## 2. What is deliberately NOT done

Each of these is a decision, not an omission. Reasons are in the spec's §0 table.

- **No exclusion constraint and no `btree_gist`.** Calendly arbitrates every booking on this path. A `23P01` raised inside our webhook returns 5xx, and Calendly answers 24 hours of 5xx by **disabling the coach's subscription**, which must then be recreated by hand. A constraint that can silently kill a coach's booking feed is worse than no constraint.
- **No `fn_*` RPC quartet** for `coach_calendar_connections` — its caller is the phase-2 OAuth callback.
- **No neutral `Slot` type** — its only consumer is the phase-2 availability provider.
- **Nineteen of the parent spec's `bookings` columns are absent** — they are native-path columns and nothing in this build would write them.
- **No `CHECK` on `bookings.source`.**

## 3. THE ONE THING TO GET RIGHT WHEN MERGING

**`feat/calendly-per-coach` and `feat/calendly-per-coach-tighten` are two pull requests, in that order, and the second waits for the first to be live.**

This is not tidiness. `.github/workflows/apply-migrations.yml` applies **every pending migration in one unattended run** on push to main, and nothing sequences that Action against the Vercel build the same push triggers. Migration `00243` sets `bookings.host_id` and `end_at` NOT NULL; neither has a DEFAULT, and the *previous* build names neither on insert. Merge them together and there is a window — the Action finishes in a couple of minutes, the Vercel build takes several — where the old build inserts against a NOT NULL schema and **every booking, both vendors, fails with `23502` and answers 500**.

So:

1. Merge `feat/calendly-per-coach`. It carries `00240`, `00241`, `00242` — all additive, all nullable, `business_id` defaulted to the singleton so the old build keeps inserting.
2. Wait for the Vercel deploy to be **live**, not merely merged.
3. Read the preconditions back on production:
   ```sql
   select count(*) from public.bookings where business_id is null or host_id is null or end_at is null;  -- must be 0
   select count(*) from public.bookings where end_at <= booking_date;                                     -- must be 0
   ```
4. Only then merge `feat/calendly-per-coach-tighten`.

**The dev clone is ahead of the merge branch:** `00243` is already applied there. That is expected and harmless; it is why the tightening's behaviour is already proven.

## 4. The deploy race, and the code that survives it

`lib/bookings/ingest.ts` carries a fallback for the window where the code is live and `00241` is not: `TENANT_COLUMNS`, `isMissingTenantColumnsError`, `stripTenantColumns`, and a sticky `tenantColumnsAbsent` flag. Two things about it are load-bearing and easy to undo by accident:

- **The flag is set only from the INSERT retry.** The read and update narrow paths fall back and log but must never latch it — after `00243` their narrow forms can *succeed*, so latching from them would make every later insert on that instance strip `host_id`/`end_at` and 500 silently.
- **PostgREST resolves, it does not throw.** A missing table or column comes back as `{ data: null, error }`. Any read that destructures only `data` cannot tell a failure from an empty result. Two separate defects on this branch were exactly that; `readByKey`, `singletonHostId` and the `business_members` read now all check `error`.

Once `00243` is everywhere and the branch history no longer matters, this machinery can be deleted.

## 5. Known, accepted, and handed to phase 1

- **`upsertGoogleAdsAccount` never writes `business_id`.** `getActiveGoogleAdsAccounts` now filters on it, so this is a per-tenant reader with a singleton-only writer: no business but the singleton can ever have an ads account. Correct for phase 0 — a business with no account enqueues nothing — but the write half is outstanding and documented in that file.
- **`findAttributionByEmail` is untenanted.** `marketing_attribution` has no `business_id`, so a shared lead's click id could cross into another coach's conversion. Phase 1.
- **Sibling calls beside `exitRunsForContact`** in the Stripe and Twilio routes still default their tenant (`findContactByIdentifiers`, `applyPipelineEvent`, `suppress`, `recordConsent`). Identical behaviour today; both call sites now carry a comment saying the singleton there is a sanctioned placeholder.
- **`singletonHostId` returning null now fails the insert** with `23502`, because `host_id` is NOT NULL. It logs its read error rather than swallowing it, which is the only diagnostic. Phase 2 replaces the call entirely with the host on the connection row the delivery matched.

## 6. What phase 1 and phase 2 inherit

**Phase 1** has its tables and needs `createBusiness` — which does not exist; `lib/db/businesses.ts` exports a getter and a setter and nothing inserts into `businesses`. Then the admin form, member invitation, per-business settings editing, and the admin screens scoped off the singleton constant.

**Phase 2** has `coach_calendar_connections` and one fact proven early by probe: **a `SECURITY DEFINER` function granted to `service_role` CAN delete from `vault.secrets`** (parent spec §15.2 V1, closed — `rows_deleted = 1` under `set local role service_role`). So the disconnect RPC needs no fallback design. Still to build: the `fn_*` quartet, PKCE with the state nonce **actually checked** — the three existing Google flows never check theirs — refresh under `pg_advisory_xact_lock` because Calendly's refresh tokens are single-use, and the neutral `Slot` type.

## 7. Open questions for the owner, due before phase 2

These change the connect flow's copy and the legal text, so they want answering before the OAuth work starts, not after.

1. **Who pays the Calendly seat** — the coach (self-paid, coach is the data controller, $0 to DJP) or DJP (a seat in a DJP organization, $10–16/coach/month, DJP is the controller)? A Calendly user can belong to only **one** organization at a time, so a coach who already runs their own must leave it or use a second email.
2. **Which prospective coaches already have Calendly accounts, on what plans, and are their calendars connected in Calendly with "check for conflicts" ON?** That setting is what makes their real commitments block slots, and **no API exposes whether it is on** — it is this design's one genuine blind spot.
3. **Should coaches see each other's bookings at all,** and does "DJP staff" mean the owner only?
