# Recurring In-Person Sessions + Flexible Billing — Design

**Date:** 2026-07-03
**Status:** Approved to build all phases (autonomous). Ships flag-OFF, unpushed, no real charges until activated.

## Problem (from Darren's feedback)

DJP runs a community gym with **standing weekly slots** — "father Mon/Wed/Fri 5:45am, wife + son Tue/Thu, sometimes they swap." Clients pay in mixed ways: individually, "2 sessions a week," or want **automatic withdrawal**. He also wants to **charge if they don't cancel in time** (no-show / late-cancel fee). The current model (prepaid packs + arrival-only check-in) can't express any of this: nothing schedules a session ahead, nothing knows a client was *expected and didn't come*, and there is **no off-session card charging** anywhere in the app.

## Scope — four flag-gated phases (build all; ship dormant)

- **A — Recurring slots + attendance** (foundation, no money): standing-slot templates → generated dated sessions; coach schedule view with one-tap attended/no-show; swaps via per-occurrence edits; no-show detection cron. Attendance is **decoupled from packs** (works with or without credits).
- **B — Card-on-file** (low risk): save a client's card via Stripe **hosted setup checkout** (`mode: "setup"`), store the payment-method id. The shared primitive for D and any future auto-charge.
- **C — Auto-withdrawal** (recurring $): "session memberships" — a recurring Stripe subscription (weekly/monthly) that isn't tied to a program. Reuses the existing subscription engine + webhook via a `session_membership` type.
- **D — No-show / late-cancel fees** (off-session $): admin-configurable fee amounts + cancellation window; when a session becomes no-show or is cancelled late, charge the saved card **off-session**; record + audit; graceful decline handling.
- *(E — hybrid/online client linking: out of scope, noted for the future.)*

## Cross-cutting principles

- **Every phase behind a DB flag in `system_settings`, default OFF** (`getSetting(key, false)`): `recurring_sessions_enabled`, `card_on_file_enabled`, `session_memberships_enabled`, `session_fees_enabled`. Nothing activates until flipped.
- **Money handling is inert until configured.** No off-session charge fires unless: the fee flag is on AND a fee amount > 0 is configured AND the client has a saved card. No membership charges anyone until a plan is created and a client subscribes. Real Stripe calls are gated; all tests mock Stripe.
- **Business policy is admin-configurable, not hardcoded** — fee amounts, cancel window, membership cadence/price live in `system_settings` / catalogue tables the coach edits.
- **Reuse, don't duplicate:** the Stripe subscription lifecycle + billing portal, `getOrCreateStripeCustomer`, the hosted-checkout + webhook dispatcher (`session.metadata.type` switch), the `onSchedule → token-gated internal route` cron pattern + pack-renewal scanner shape, Resend + notification preferences, and the idempotent check-in ledger.
- **Migrations** applied via `mcp__supabase__apply_migration` (00175+). Written now; applied as an activation step.

---

## Phase A — Recurring slots + attendance

### Data model (migration `00175_recurring_sessions.sql`)
- **`recurring_sessions`** — a standing slot. One row per `(client, weekday, time)`.
  `id, client_user_id (FK users), day_of_week smallint (0=Sun..6=Sat), start_time time, duration_minutes int default 60, location text, notes text, status text default 'active' ('active'|'paused'), created_by (FK users), created_at, updated_at`. Index `(client_user_id, status)`.
- **`scheduled_sessions`** — concrete dated occurrences.
  `id, client_user_id (FK users), recurring_session_id (FK recurring_sessions ON DELETE SET NULL — null = ad-hoc/walk-in), session_date date, start_time time, duration_minutes int, status text default 'scheduled' ('scheduled'|'attended'|'no_show'|'cancelled'), attended_at timestamptz, checkin_id (FK session_checkins ON DELETE SET NULL — set only if a credit was also burned), cancelled_at timestamptz, cancel_reason text, notes text, created_by, created_at, updated_at`.
  Unique `(client_user_id, session_date, start_time)` (idempotent generation). Indexes `(session_date, status)`, `(client_user_id, session_date)`.

### Logic
- **Generation** — `lib/services/session-schedule.ts:ensureUpcomingSessions(now, horizonDays=14)`: for each active `recurring_session`, upsert `scheduled_sessions` for each matching weekday within the horizon (skip dates already cancelled/attended). Pure day-matching helper `datesForSlot(slot, from, to)` is unit-tested. Called by a daily cron **and** on-demand when the schedule view loads.
- **Attendance (decoupled)** — `markAttended(scheduledSessionId, {by, checkinId?})` sets `status='attended', attended_at`. Works with no pack. `markNoShow`, `cancelSession(reason)`, `rescheduleSession(newDate,newTime)`, `reassignSession(newClientUserId)` (swaps), `addAdhocSession(...)`.
- **Check-in bridge** — after any successful check-in (coach tap / QR / personal link), best-effort resolve the client's nearest `scheduled` session for today and `markAttended(..., {checkinId})`. If none, optionally create an ad-hoc attended session. Never fails the check-in. Gated by `recurring_sessions_enabled`.
- **No-show cron** — `sessionNoShowScanCron` (Firebase `onSchedule`, hourly) → `POST /api/admin/internal/session-no-show` → `scanNoShows(now, bufferMinutes)`: sessions whose `session_date + start_time + duration + buffer < now` and still `scheduled` → `no_show`. Optional daily coach summary email (Resend, pref-gated). Pure selection tested.

### UI
- **`/admin/schedule`** (new) — day/week agenda: expected sessions grouped by date, each row = client, time, status chip, one-tap **Attended / No-show / Cancel**, **Reschedule** and **Reassign** actions, and **Add ad-hoc session**. Server component loads via `ensureUpcomingSessions` + a range query; mutations via small admin API routes → `router.refresh()`.
- **Client detail page** — a "Standing sessions" panel to add/edit/pause a client's recurring slots.
- Admin nav: "Schedule" link (Coaching section).

### Tests
Pure: `datesForSlot`, `scanNoShows`, reschedule/reassign transitions. Routes: attended/no-show/cancel admin-gated; generation idempotency.

---

## Phase B — Card-on-file

### Data model (migration `00176_card_on_file.sql`)
- **`user_payment_methods`** — `id, user_id (FK users), stripe_payment_method_id text unique, brand text, last4 text, exp_month int, exp_year int, is_default bool default true, created_at`. (`users.stripe_customer_id` already exists.)

### Logic
- **Save-card flow (hosted, no Elements):** `POST /api/admin/clients/[id]/save-card` (admin) or a client-portal button → `getOrCreateStripeCustomer(user)` → `stripe.checkout.sessions.create({ mode: "setup", customer, metadata: { type: "save_card", userId }, success_url, cancel_url })` → returns hosted URL.
- **Webhook:** extend the dispatcher — `checkout.session.completed` with `mode === "setup"` (or `metadata.type === "save_card"`) → retrieve the `setup_intent` → `payment_method` → fetch its card brand/last4 → upsert `user_payment_methods` (unset previous default). New handler `handleSaveCardCheckout`.
- Helpers `lib/db/payment-methods.ts`: `getDefaultPaymentMethod(userId)`, `upsertPaymentMethod(...)`, `deletePaymentMethod(id)`. Admin UI: show saved card (brand ···· last4) on the client page + "Update card" / "Remove".

### Tests
Save-card route returns a setup URL (admin-gated); webhook `handleSaveCardCheckout` stores the PM (mocked Stripe retrieve).

---

## Phase C — Auto-withdrawal (session memberships)

### Data model (migration `00177_session_memberships.sql`)
- **`membership_plans`** — catalogue: `id, name, price_cents, billing_interval text ('week'|'month'), sessions_per_period int null, stripe_price_id text, is_active bool, sort_order, created_at, updated_at`.
- **`client_memberships`** — `id, user_id (FK users), plan_id (FK membership_plans), stripe_subscription_id text unique, stripe_customer_id text, status text ('active'|'past_due'|'canceled'|'unpaid'|'incomplete'|'trialing'|'paused'), current_period_start, current_period_end, cancel_at_period_end bool, canceled_at, created_at, updated_at`.

### Logic
- **Subscribe:** `POST /api/admin/memberships/checkout` (or client-portal) → ensure the plan has a recurring Stripe Price (`createStripeProductAndPrice` with `recurring: { interval }`) → `createSubscriptionCheckoutSession`-style call in `mode: "subscription"` with `metadata: { type: "session_membership", planId, userId }`.
- **Webhook (reuse subscription lifecycle, branch on type):** the existing subscription handlers detect `metadata.type === "session_membership"` (or a `client_memberships` lookup by `stripe_subscription_id`) and write to `client_memberships` instead of program `subscriptions`: `checkout` → create row; `invoice.payment_succeeded` → record payment + roll period; `invoice.payment_failed` → `past_due` (grace, no revoke); `updated/deleted` → sync/cancel. Self-serve cancel via existing billing portal.
- Admin: a **Memberships catalogue** page (like session-pack products) + a "Membership" panel on the client page (subscribe / view status / cancel). MRR reporting can later include memberships.

### Tests
Membership checkout creates a subscription-mode session with the right metadata (admin-gated); webhook branch writes `client_memberships` on completed/succeeded/failed/canceled (mocked Stripe).

---

## Phase D — No-show / late-cancel fees (off-session charge)

### Config (no table — `system_settings`)
`no_show_fee_cents` (default 0), `late_cancel_fee_cents` (default 0), `cancel_window_hours` (default 12). Fees only fire when `session_fees_enabled` AND the relevant amount > 0.

### Data model (migration `00178_session_fee_charges.sql`)
- **`session_fee_charges`** — `id, scheduled_session_id (FK), user_id, kind text ('no_show'|'late_cancel'), amount_cents int, status text ('pending'|'succeeded'|'failed'|'waived'), stripe_payment_intent_id text, failure_reason text, created_at`. One charge per session per kind (unique `(scheduled_session_id, kind)`), so a session is never double-charged.

### Logic — off-session charging primitive (net-new, `lib/stripe.ts`)
- `chargeSavedCard({ user, amountCents, description, idempotencyKey })`: requires `user.stripe_customer_id` + a default `user_payment_methods` row → `stripe.paymentIntents.create({ amount, currency: "usd", customer, payment_method, off_session: true, confirm: true }, { idempotencyKey })`. Returns `{ ok, paymentIntentId }` or a typed failure (`no_card | declined | error`). **Called only from D, only when enabled + configured.**
- **Trigger points:**
  - *Late cancel:* when `cancelSession` runs and the session start is within `cancel_window_hours` of now → create a `session_fee_charges(kind='late_cancel', pending)` → attempt `chargeSavedCard` → set succeeded/failed. If no card or fee 0 → skip (record `waived` or nothing).
  - *No-show:* the no-show scan, after marking `no_show`, creates a `no_show` fee charge and attempts it.
- Each attempt records a `payments` row on success (revenue tracking) + `recordAudit`. Declines → `status='failed'`, notify coach (Resend, best-effort); a manual "retry charge" / "waive" admin action exists. Unique constraint + idempotency key prevent double charges.
- Admin: fee settings in `/admin/automation` (or a Sessions settings page); a "Fees" view listing charges with retry/waive.

### Tests
`chargeSavedCard` (mocked Stripe: success, declined → typed failure, no-card guard); fee-on-late-cancel and fee-on-no-show create-and-charge (mocked); double-charge prevented by the unique constraint; all inert when flag off / amount 0 / no card.

---

## Rollout / activation (manual, after review)
1. Apply migrations 00175–00178.
2. Phase A: flip `recurring_sessions_enabled`, add clients' standing slots, use `/admin/schedule`.
3. Phase B: flip `card_on_file_enabled`, save cards.
4. Phase C: flip `session_memberships_enabled`, create membership plans, subscribe clients.
5. Phase D: set fee amounts + window, flip `session_fees_enabled` **last** (real charges).

## Testing / verification
New unit/route tests per phase (mirroring `__tests__/api/session-packs/` mocked-DAL style + mocked Stripe). Full `vitest run` green (baseline reds excluded). Adversarial review of the two money paths (off-session charge, membership webhook) before completion.

## Out of scope (YAGNI)
Group classes/capacity, client self-scheduling, family/household payer grouping (each family member is their own client; swaps are per-occurrence edits), hybrid/online linking, calendar (ICS) sync.
