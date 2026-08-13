# Session Pack Auto-Renew — Design

**Date:** 2026-08-14
**Status:** Approved (design), not yet implemented
**Supersedes nothing.** Extends: `2026-06-13-session-packs-design.md`, `2026-07-03-recurring-sessions-and-billing-design.md`

## Problem

A client burns through a session pack and nothing happens. There is no
auto-renewal anywhere in the system: the only pack automation that exists
(`packRenewalScanCron` → `/api/admin/internal/pack-renewals`) sends a *reminder*
email saying "get in touch to renew" and never touches Stripe. That cron is also
off — `cron_pack_renewals_enabled` is absent from `system_settings` and defaults
to `false`.

Today two clients sit at 1 credit remaining (Sirisha Chennadi, Sandeep Chennadi,
both 9/10 used). When they take their last session the pack flips to `depleted`
and their *next* check-in is refused with `no_credits`. The coach has to notice,
open the client, sell a pack, and send a payment link by hand.

### The blocker nobody had noticed

Auto-charging requires a card on file. Production state at time of writing:

| Metric | Value |
|---|---|
| Rows in `user_payment_methods` | **0** |
| Clients with a `stripe_customer_id` | 11 of 54 |
| `session_fee_charges` rows ever written | **0** |

Not one client has a saved card, and the entire off-session charging path has
never fired in production. The cause is in `createPackCheckoutSession`
(`lib/stripe.ts`): pack checkout runs `mode: "payment"` with only a
`customer_email` — no `customer`, no `setup_future_usage`. **Buying a pack has
never saved a card.**

So this project is two things, and the second is the larger:

1. An auto-renew engine (small — the pattern already exists in `session-fees.ts`).
2. Getting cards on file at all (the real work, and a consent problem as much as
   a code one).

## Decisions

Settled during brainstorming; recorded here because each one closes off
alternatives a reader might otherwise reopen.

| Question | Decision | Rejected |
|---|---|---|
| What happens at pack end | Auto-charge the card on file | Auto-send a link; alert coach only; client self-serve |
| How cards get on file | Both: bundle into pack checkout **and** ask existing clients | Either alone; coach collects in person |
| When the charge fires | When the pack hits **zero** | At a low threshold; just-in-time at check-in; monthly |
| On decline | One attempt, then fall back to a payment link + alert coach | Retry schedule; alert-only; block check-ins |
| What saving a card authorises | Explicit opt-in checkbox **and** coach can arm per client | Client-only; coach-only; card-on-file implies renewal |
| What a renewal buys | A clone of the pack that just ran out | A separately configured renewal product |

**Explicitly not doing:** converting clients to Stripe Subscriptions via the
existing `session_memberships` system. Stripe would handle dunning, card expiry
and SCA for free, but it bills monthly on a clock and the chosen trigger is
usage-based. Noted so a future reader knows it was considered, not missed.

## Architecture

### Data model

Three columns on `client_packages`:

| Column | Type | Purpose |
|---|---|---|
| `auto_renew` | `boolean not null default false` | Armed by the checkout checkbox or by the coach |
| `renewed_from_package_id` | `uuid null references client_packages(id)` | Provenance chain |
| `renewal_attempted_at` | `timestamptz null` | Marker for the sweeper |

One new table, deliberately shaped like `session_fee_charges` (00178):

```sql
create table public.pack_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  source_package_id uuid not null references client_packages(id) on delete cascade,
  new_package_id uuid references client_packages(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  billing_user_id uuid not null references users(id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','skipped')),
  stripe_payment_intent_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (source_package_id)
);
```

**`unique (source_package_id)` is the double-charge guard.** It is the same
mechanism as `unique (scheduled_session_id, kind)` on `session_fee_charges`: the
insert *is* the lock. A concurrent inline trigger and cron sweep race to insert;
exactly one wins, the loser gets `null` back and stops.

RLS enabled, no client read policy — matching `session_fee_charges`. Clients see
the charge on their card statement and in the receipt email.

Migration number: **00207**.

#### Why `auto_renew` lives on the pack, not the user

The consent captured is literally "when *this* pack runs out, buy another one".
A renewal pack inherits `auto_renew` from its source, so the arrangement
continues until someone switches it off.

The cost: the coach cannot pre-arm a client who currently holds no pack. This is
accepted in exchange for one unambiguous source of truth — "is auto-renew on?"
has exactly one answer, attached to the thing being renewed. A `users`-level
default was considered and rejected as YAGNI.

### The charge path — `lib/services/pack-renewal.ts`

Mirrors `attemptFee` in `lib/services/session-fees.ts` closely enough that a
reader of one can read the other.

```
attemptPackRenewal(pkg)
  │
  ├─ guard: packAutoRenewEnabled() flag
  ├─ guard: pkg.auto_renew === true
  ├─ guard: remainingCredits(pkg) === 0
  ├─ guard: pkg.price_cents > 0
  │
  ├─ createRenewalAttemptIfAbsent({ source_package_id: pkg.id })
  │     └─ null → already attempted → return { renewed: false, reason: "already_attempted" }
  │
  ├─ billingUserId = resolveBillingUserId(pkg.client_user_id)   // household payer
  ├─ [user, card] = getUserById(billingUserId), getDefaultPaymentMethod(billingUserId)
  │
  ├─ no stripe_customer_id or no card
  │     └─ status "skipped" / reason "no_card"
  │        → create PENDING renewal pack + mint link + email + notify coach
  │
  └─ chargeSavedCard({ idempotencyKey: `pack_renew_${pkg.id}` })
        │
        ├─ ok   → create renewal pack (paid, credits/price/session_type cloned,
        │          auto_renew inherited, renewed_from_package_id = pkg.id)
        │       → attempt status "succeeded" + new_package_id
        │       → createPayment mirror row (metadata.type = "pack_auto_renewal")
        │       → recordAudit "pack.auto_renewed"
        │       → receipt email to payer (cc client when different)
        │
        └─ fail → attempt status "failed" + failure_reason
                → create PENDING renewal pack
                → resolvePackPaymentLink() + email it to the payer
                → in-app notification to admins
                → recordAudit "pack.auto_renew_failed"
```

The decline branch deliberately lands in **today's manual flow**: a pending pack
with a payment link in the payer's inbox. The failure mode is the status quo, not
a broken state.

The idempotency key is pack-stable (`pack_renew_${pkg.id}`), matching the
session-fee convention. Trade-off inherited from that design: a retry inside
Stripe's idempotency window replays the original outcome rather than making a
genuinely new attempt. Acceptable — there is no automatic retry here by
decision, and a manual re-attempt is the payment link.

### Triggers

**Primary — inline on depletion.** In `checkInClient`
(`lib/services/session-credits.ts`), after the CAS bump that flips the pack to
`depleted` *and after the check-in row is written*, fire
`void attemptPackRenewal(pkg)`. Fire-and-forget:

- The check-in has already succeeded, so Stripe latency never sits inside the
  door-open path.
- A renewal failure must never fail a check-in. This mirrors the existing
  `handleCheckinProgramAdvance` treatment, where program-side failures are
  swallowed because attendance is the primary record.

**Safety net — cron sweep.** Extend `/api/admin/internal/pack-renewals` to also
find packs where `status = 'depleted' AND auto_renew = true` with no row in
`pack_renewal_attempts`, and attempt them. Covers a serverless instance dying
mid-`void`, and any pack depleted by a path other than check-in.

Both routes hit the same unique index, so the race is safe by construction.

### Card capture at checkout

`createPackCheckoutSession` gains:

- `customer: <stripe customer id>` (replacing `customer_email`)
- `payment_intent_data: { setup_future_usage: "off_session" }`
- `metadata.autoRenew: "true" | "false"` from the checkbox

`handleSessionPackCheckout` (webhook) then reads the PaymentIntent's
`payment_method`, calls `upsertDefaultPaymentMethod`, and sets `auto_renew` on
the created pack from metadata.

#### ⚠️ The mutually-exclusive customer trap

Stripe Checkout rejects `customer` and `customer_email` together. The existing
`customer_email` logic is not incidental — it exists because a parent opened a
payment link and found the athlete's email locked in (Stripe makes a provided
`customer_email` read-only), sending the receipt to the wrong inbox. See the
comment block at `lib/stripe.ts:435`.

Therefore the Stripe customer **must be resolved against the payer's email**,
following the same precedence the current code uses:

```
explicit billToEmail  →  household payer (resolveBillingUserId)  →  the client
```

Concretely: resolve the payer first, then `getOrCreateStripeCustomer` for *that*
identity, then attach. Getting this wrong silently reintroduces a bug that was
already fixed once, and the saved card would be attached to the wrong person —
which then makes the auto-charge itself charge the wrong card. This is the
highest-risk edit in the project.

A payer with no user account (`billToEmail` only) has no `users` row to hang a
`stripe_customer_id` on. **Decision: do not save a card for account-less payers.**
Their checkout keeps today's `customer_email` behaviour, no card is stored, and
auto-renew stays unavailable — they continue with payment links exactly as now.

The rejected alternative was storing the payer's card against the *trainee's*
`user_id`. That creates a row asserting a card belongs to someone who does not own
it, which `getDefaultPaymentMethod(billingUserId)` would then happily charge for
unrelated fees. Saving a stranger's card under an athlete's account to avoid an
edge case is not a trade worth making; the fallback costs nothing but a payment
link.

Implementation consequence: `createPackCheckoutSession` branches — an explicit
`billToEmail` keeps `customer_email`; otherwise resolve the payer and attach a
`customer`.

### Surfaces

| Surface | Change |
|---|---|
| `components/admin/packs/SellPackDialog.tsx` | Auto-renew checkbox, default **unchecked**, with the price and credit count in the label |
| `components/client/MyCardPanel.tsx` | Auto-renew state + always-visible off switch |
| `components/admin/packs/ClientPackagesPanel.tsx` | Per-client auto-renew toggle + attempt history |
| Client self-purchase checkout | Same checkbox as `SellPackDialog` |

Consent copy must name the amount and the trigger, e.g. *"Save my card and
automatically buy another 10-session pack ($750) when this one runs out. Cancel
any time."*

New endpoints:

- `PATCH /api/admin/session-packs/[id]/auto-renew` — coach arms/disarms
- `PATCH /api/client/session-packs/[id]/auto-renew` — client disarms their own

Both audited (`pack.auto_renew_enabled` / `pack.auto_renew_disabled`, category
`commerce`). The client route must only ever act on the caller's own pack.

### Backfill for existing clients

The add-card flow already works end to end and is already enabled
(`card_on_file_enabled` is `true` in production): `/api/client/save-card` →
`createSetupCheckoutSession` → webhook `save_card` branch →
`upsertDefaultPaymentMethod`, surfaced by `MyCardPanel`. Nobody has ever been
asked to use it.

Deliverable is therefore an **email campaign**, not a feature: a one-off send to
the current roster linking to the client portal's add-card panel. Drafted and
queued, **not sent** — sending is a coach decision.

## Feature flags

| Key | Default | Guards |
|---|---|---|
| `pack_auto_renew_enabled` | `false` | Every charge path. Nothing renews until this is on. |
| `card_on_file_enabled` | `true` (already) | Card capture + save-card routes |

Per repo convention (`no_default_feature_flags`), a flag exists here because this
moves real money. `pack_auto_renew_enabled` is checked at the top of
`attemptPackRenewal`, so flipping it off halts renewals instantly without a
deploy.

## Error handling

| Condition | Behaviour |
|---|---|
| Flag off | No-op, no attempt row written |
| `auto_renew` false | No-op, no attempt row written |
| Attempt row exists | Stop — never charge twice |
| No card / no customer | `skipped`, pending pack + payment link emailed |
| Card declined (`reason: "declined"`) | `failed`, pending pack + payment link emailed + coach notified |
| Stripe network error / 5xx (`reason: "error"`) | `failed` with reason, coach notified to reconcile against Stripe. **No replacement pack, no payment link.** |

**Corrected 2026-08-14 after Task 4 review.** The two `chargeSavedCard` failure
reasons are not interchangeable, and an earlier draft of this table treated them
as one. A `"declined"` is a known outcome: no money moved, so inviting the client
to pay by link is safe. An `"error"` — network timeout, Stripe 5xx — means the
outcome is **unknown and the card may already have been charged**. Minting a
fresh Checkout Session there would take payment a second time, because a Checkout
Session is outside the `pack_renew_${id}` idempotency key that protects the
retry path. `lib/services/session-fees.ts:154-161` already documents this hazard
for fee retries; it applies identically here. On `"error"` the system records and
escalates to a human, and does nothing else.
| Receipt email fails | Swallowed — never affects the money path (matches `notifyPayerCharged`) |
| Renewal throws entirely | Swallowed at the check-in call site; check-in still succeeds |

## Testing

Written test-first. The bar is that each test fails for the right reason before
the code exists — this repo's dominant defect class is tests that pass without
verifying their claim.

**Pure logic (no mocks):**
- `shouldAttemptRenewal(pkg, flagOn)` — truth table across armed/unarmed,
  depleted/not, zero-price, expired.
- Clone semantics: credits, price, session_type, `auto_renew` inheritance,
  `renewed_from_package_id`.

**Service (`pack-renewal.test.ts`):**
- Success → renewal pack created paid, attempt `succeeded`, payments mirror row,
  audit written.
- Decline → attempt `failed`, pack created **pending**, link email sent, admin
  notified.
- No card → attempt `skipped` with reason `no_card`, **not** `failed`.
- Second call with an existing attempt row → returns `already_attempted` and
  `chargeSavedCard` is **not** called.
- Household payer: charge uses the payer's customer + card, `user_id` records the
  trainee, `billing_user_id` records the payer.

**Concurrency:**
- Two simultaneous `attemptPackRenewal` calls for one pack → `chargeSavedCard`
  called exactly once (the second gets `null` from the insert).

**Check-in integration:**
- Depleting check-in still returns `ok: true` when renewal **throws**.
- Renewal is not attempted on a check-in that leaves credits remaining.

**Checkout:**
- Session is created with `customer` **and** `setup_future_usage`, and **without**
  `customer_email`.
- Payer precedence preserved: explicit `billToEmail` → household payer → client.
  This is a regression test for the wrong-inbox bug.
- `metadata.autoRenew` round-trips to `client_packages.auto_renew`.

**Authorisation:**
- Client auto-renew route rejects a pack belonging to someone else.

Targeted runs only (`npx vitest run <path>`) plus `npm run build`, per repo
convention. No full-suite run — and note the known-flaky Stripe webhook suite
(`test_baseline_not_green`) is pre-existing, not caused by this work.

## Rollout

1. Migration 00207 applied to prod via `mcp__supabase__apply_migration`.
   **Note:** pushing to `main` auto-applies repo migrations, so the push and the
   migration are the same event — this is why the work stops before the push.
2. `pack_auto_renew_enabled` stays **false**.
3. **Canary on the coach's own account.** The `darren paul` client row holds a
   10-credit pack at `price_cents = 200` ($2) with 9 remaining. Save a card on
   that account, arm auto-renew, burn the pack down, and confirm a real $2 charge
   produces a real renewal pack. This exercises the entire live path — Stripe,
   webhook, receipt — for two dollars, before a single client is armed.
4. Flip the flag on with no client packs armed. Nothing should happen.
5. Send the add-card campaign (coach decision).
6. Arm the first real client only after the canary is verified.

## Risks

| Risk | Mitigation |
|---|---|
| Wrong card charged via customer/payer mix-up | Payer-precedence regression test; the highest-risk edit, called out above |
| Double charge | `unique (source_package_id)` + pack-stable idempotency key + explicit concurrency test |
| Double-counted revenue in the books | Packs already write a `payments` mirror row; renewal reuses the same path with `metadata.type = "pack_auto_renewal"` so bookkeeping can distinguish it. Verify against `payments_mirror_rows_double_count`. |
| Client surprised by a charge | Opt-in default off, explicit consent copy naming the amount, always-visible off switch, receipt on every charge |
| Renewal failure breaks check-in | Fire-and-forget + swallowed; covered by an explicit test |
| Junior athletes / parent payers | Household payer resolution reused unchanged; payer gets the receipt |

## Out of scope

- Retry/dunning schedules (explicitly rejected)
- Time-based recurring billing (use `session_memberships`)
- Changing the existing reminder cron's behaviour beyond adding the sweep
- Auto-renew for memberships or programs
- Actually sending the add-card campaign
