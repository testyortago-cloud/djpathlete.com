# Session Packs — In-Person Session Credit Tracking

**Date:** 2026-06-13
**Status:** Design approved (autonomous delegation — user asleep; defaults documented below)
**Author:** Claude (brainstormed with Darren)

## Problem

Darren coaches in-person clients. They either buy a multi-session **package** (e.g. a
10-pack) or **pay per session**. Today he tracks "who has done how many sessions, who's
behind, who's due to renew" manually in his head / notes. As the in-person roster grows
this is error-prone and labour-intensive, especially in the pre-session rush.

He wants: a client buys a pack → it's "activated" on their record → at the end of each
session he **checks them in** (one tap, or the client scans a QR) → a credit is deducted →
when the balance runs low the app **nudges** the client and him to sort the renewal.

Payment is **not** the hard part — his existing Stripe handles the money. The labour he
wants gone is the **attendance + balance + renewal tracking**.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Build vs buy | **Build into DJP Athlete**, using existing Stripe as the payment rail |
| 2 | Client model | **Reuse existing `users` (role=`client`) records.** No separate roster. New walk-ins use the existing client-creation flow |
| 3 | Check-in methods | **Both** — client scans coach's QR (self-check-in) **and** a one-tap coach fallback |
| 4 | Pack shapes | **All of**: configurable sizes, pay-per-session drop-ins, packs expire, multiple session types & prices |
| 5 | Reminders | **Email the client + notify the coach + in-app notification** at low-balance / expiry thresholds. **No SMS** in v1 |
| 6 | Google Calendar | **Two-way sync — Phase 2** (designed here, built after Phase 1 ships) |

### Defaults chosen autonomously (open questions a/b/c)

- **(a)** Packs hang off existing client records — confirmed by decision #2.
- **(b)** QR self-check-in uses **one shared coach QR** → a self-check-in page that
  **resolves the client**: if the scanner is logged in as a client, it's them; otherwise
  the page shows a searchable list of clients-with-an-active-pack to tap. A personal
  per-client QR is **not** built in v1 (more moving parts, marginal benefit for a solo PT).
  The coach can void any mistaken check-in in one tap, which makes the "tap your name"
  approach safe enough.
- **(c)** Calendar two-way sync is **Phase 2**. Phase 1 is fully usable without it.

## Scope

**Phase 1 (this build — usable within days):** pack catalogue, purchase via Stripe (or
cash/comp), credit ledger, both check-in methods, low-balance + expiry reminders, coach UI
on the existing client page, and a fast "Today" check-in screen.

**Phase 2 (designed, deferred):** Google Calendar two-way sync.

**Explicitly out of scope (YAGNI):** in-app card terminal / tap-to-pay hardware (use
Stripe payment links / Stripe Tap-to-Pay externally), SMS reminders, group-class
roster management, waitlists, multi-coach/staff accounts, client-facing self-purchase of
packs (coach sells; client pays the resulting Stripe link).

## Architecture

Everything reuses existing infrastructure: `users` (clients), `payments`, `notifications`,
`audit_logs`, `system_settings` (feature flags), Stripe Checkout + webhook, Resend email,
the Firebase `onSchedule` → internal-API cron pattern, and the `/admin/clients/[id]` UI.

New code is organised as small, independently-testable units:

```
lib/
  validators/session-packs.ts        # Zod schemas (products, packages, check-ins)
  db/
    session-pack-products.ts         # catalogue DAL
    client-packages.ts               # purchased-balance DAL
    session-checkins.ts              # attendance-ledger DAL
  services/
    session-credits.ts               # PURE credit math + orchestration (the core unit)
  qr/checkin-token.ts                # sign/verify self-check-in tokens
  automation/pack-renewal-scanner.ts # PURE reminder selection (which packs to nudge)
app/api/
  admin/session-packs/...            # sell, list, check-in, void (coach actions)
  stripe/webhook/route.ts            # EXTEND: credit pack on checkout.session.completed
  checkin/route.ts + app/checkin/... # public QR self-check-in surface
  admin/internal/pack-renewals/route.ts  # cron target
functions/src/index.ts               # EXTEND: packRenewalScanCron onSchedule
```

### Component responsibilities

1. **Pack catalogue (`session_pack_products` + DAL)** — the coach's reusable list of
   sellable packs. *What it does:* stores name, session type, credit count, price, validity
   window. *Used by:* the "Sell pack" UI and the Stripe checkout builder. *Depends on:*
   nothing app-specific.

2. **Credit ledger (`client_packages` + `session_checkins` + `lib/services/session-credits.ts`)**
   — the heart. *What it does:* a `client_packages` row is a purchased balance; each
   `session_checkins` row is an append-only −1 deduction (or a voided no-op). The service
   exposes **pure** functions for the math and thin orchestration wrappers for the writes.
   *Used by:* both check-in paths, the webhook, the reminder scanner, the coach UI.
   *Depends on:* the two DALs.

3. **Check-in surfaces** — (a) `app/checkin` public page reached by scanning the coach QR;
   (b) the coach one-tap button on the client card and Today screen. Both call the same
   `checkInClient()` orchestration in the service so the rules live in one place.

4. **QR token (`lib/qr/checkin-token.ts`)** — signs a short-lived token embedded in the
   coach's check-in QR (HMAC over `{coachId, issuedDay}` with `NEXTAUTH_SECRET`). The
   self-check-in page verifies it before showing the roster, so a stale screenshot can't be
   reused indefinitely. Pure, fully unit-tested.

5. **Reminder scanner (`lib/automation/pack-renewal-scanner.ts` + internal route + cron)** —
   a **pure** selector decides which packages are at a threshold (`2 left`, `0 left`,
   `expiring within N days`) and not yet notified at that threshold; the route fans out
   email + coach + in-app notifications and stamps the threshold so each fires once.

6. **Coach UI** — a **Packages** panel on `/admin/clients/[id]` (balance, history, "Sell
   pack", "Check in", "Void") and a standalone **`/admin/today`** check-in screen
   (active-pack clients, one-tap check-in, link/QR for self-check-in).

## Data model

New migration `00170_session_packs.sql` (written, **not applied** to the live DB until
Darren approves — consistent with the `00168_workout_sessions` pattern). All money in
integer cents. All timestamps `timestamptz`. FKs to `users(id)` cascade on delete the same
way existing client-owned tables do.

### `session_pack_products` (catalogue)
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `name` | text not null | e.g. "10-Session 1:1" |
| `session_type` | text not null | free text label (1-on-1, small-group, 30-min…) |
| `credits` | int not null check > 0 | 1 = a drop-in product |
| `price_cents` | int not null check >= 0 | |
| `validity_days` | int null check > 0 | null = never expires |
| `stripe_price_id` | text null | optional pre-made Stripe price; else ad-hoc price_data |
| `is_active` | bool not null default true | |
| `sort_order` | int not null default 0 | |
| `created_at`/`updated_at` | timestamptz | `updated_at` trigger |

### `client_packages` (purchased balance)
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `client_user_id` | uuid not null fk users(id) on delete cascade | |
| `product_id` | uuid null fk session_pack_products(id) | null for ad-hoc packs |
| `session_type` | text not null | snapshotted from product/ad-hoc |
| `credits_total` | int not null check > 0 | |
| `credits_used` | int not null default 0 check >= 0 | denormalised for fast balance; ledger is source of truth, this is kept in sync |
| `price_cents` | int not null check >= 0 | what was charged |
| `payment_method` | text not null | `stripe` \| `cash` \| `comp` |
| `payment_status` | text not null default 'pending' | `pending` \| `paid` \| `not_required` (comp) \| `refunded` |
| `stripe_session_id` | text null | checkout session |
| `stripe_payment_id` | text null | |
| `purchased_at` | timestamptz not null default now() | |
| `expires_at` | timestamptz null | purchased_at + validity_days; null = never |
| `status` | text not null default 'active' | `active` \| `depleted` \| `expired` \| `refunded` \| `cancelled` |
| `last_reminded_threshold` | text null | `low` \| `empty` \| `expiring` — dedupes reminders |
| `notes` | text null | |
| `created_by` | uuid null fk users(id) | coach |
| `created_at`/`updated_at` | timestamptz | |

Index: `(client_user_id, status)`, `(status, expires_at)`.

### `session_checkins` (append-only ledger)
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `client_package_id` | uuid not null fk client_packages(id) on delete cascade | |
| `client_user_id` | uuid not null fk users(id) on delete cascade | denormalised for query ease |
| `checked_in_at` | timestamptz not null default now() | |
| `session_date` | date not null | local session day (defaults to today) |
| `method` | text not null | `qr_self` \| `coach_tap` \| `manual` |
| `credit_delta` | int not null default -1 | always -1 in v1 (column allows future flexibility) |
| `voided` | bool not null default false | undo restores the credit |
| `voided_reason` | text null | |
| `voided_by` | uuid null fk users(id) | |
| `voided_at` | timestamptz null | |
| `calendar_event_id` | text null | Phase 2 link |
| `created_by` | uuid null fk users(id) | coach (null for pure self-check-in) |
| `notes` | text null | |
| `created_at` | timestamptz not null default now() | |

Partial unique guard against double check-in: a DB-level idempotency is hard to express
cleanly, so it lives in the service (reject a second non-voided check-in for the same
`client_package_id` within a configurable window, default 4 hours).

**Balance invariant:** `credits_remaining = credits_total − count(non-voided checkins)`,
and `client_packages.credits_used` is maintained equal to that count by the service on
every check-in / void (single source of truth = ledger; denormalised column = cache).

### Phase 2 tables (designed, not built in Phase 1)
- `calendar_connections` — coach Google OAuth tokens (encrypted via the existing vault
  pattern used for `platform_connections`), `calendar_id`, `sync_token`, watch
  `channel_id`/`resource_id`/`expiration`.
- `calendar_event_links` — maps a Google event ↔ `client_user_id`/`client_package_id`/
  `session_checkins.id`, with `origin` (`app`|`google`) and `status`.

## Key flows

### Sell a pack
1. Coach opens client → **Sell pack** → picks a catalogue product (or enters ad-hoc:
   credits, price, type, validity).
2. **Stripe:** `POST /api/admin/session-packs/checkout` builds a Checkout Session
   (using `stripe_price_id` or inline `price_data`), metadata `{kind:'session_pack',
   client_user_id, product_id|adhoc fields, credits, validity_days}`. Returns a URL the
   coach sends/opens on the client's phone. Pack row created with `payment_status='pending'`.
   **Cash/comp:** coach marks it paid/comp directly; pack row created `paid`/`not_required`,
   `status='active'` immediately.
3. **Webhook (`checkout.session.completed`)** with `metadata.kind==='session_pack'` →
   mark the pack `paid` + `active`, stamp `stripe_payment_id`, set `expires_at` from
   `validity_days`, record a `payments` row (existing table) + `pack.sold` audit.

### Check-in (QR self)
1. Client scans the coach's QR → `app/checkin?token=…`.
2. Page verifies the token (`lib/qr/checkin-token`). If valid:
   - logged-in client → resolve to them; else show searchable active-pack client list.
3. Client taps their name → confirm → `POST /api/checkin` → `checkInClient()`:
   pick the client's active pack (oldest non-expired with credits), insert a
   `session_checkins` row (`method='qr_self'`), bump `credits_used`, flip pack to
   `depleted` if it hits 0, and if remaining ≤ threshold enqueue a reminder check.
4. Confirmation screen shows remaining balance.

### Check-in (coach tap)
Coach card / Today screen → **Check in** → same `checkInClient()` with `method='coach_tap'`,
`created_by=coach`. One tap, no QR.

### Void / undo
Coach → **Void** on a check-in → set `voided`, restore the credit (`credits_used−1`),
re-open pack from `depleted`→`active` if needed. `pack.checkin_voided` audit.

### Reminder cron (daily)
`packRenewalScanCron` (Firebase `onSchedule`, default 09:00 UTC) → `isCronSkipped` gate →
`POST /api/admin/internal/pack-renewals` → `selectPacksNeedingReminder()` (pure) finds
active packs where `remaining ∈ {≤2, 0}` or `expires_at` within N days **and**
`last_reminded_threshold` < the threshold reached → for each: client email (Resend) +
coach notification + client in-app notification → stamp `last_reminded_threshold`. Logged
via the `cron_runs` twin helpers; added to the automation-health expected list.

## Cross-cutting

- **Feature flags** (DB-backed per house rule, default off):
  `feature_session_packs_enabled`, `feature_qr_checkin_enabled`,
  `cron_pack_renewals_enabled`. UI and routes guard on these.
- **Audit slugs** (added to `lib/audit/actions.ts`, category `commerce`/`client_action`):
  `pack.sold`, `pack.checkin`, `pack.checkin_voided`, `pack.refunded`, `pack.expired`.
- **Reminder thresholds** configurable via `system_settings`
  (`pack_reminder_low_at` default 2, `pack_reminder_expiry_days` default 7).
- **Authz:** coach actions are admin-only (existing middleware on `/admin/*` + `/api/admin/*`).
  The public `/checkin` + `/api/checkin` are gated by a valid signed token; a self-check-in
  can only ever deduct from the resolved client's own pack.

## Error handling & edge cases

| Case | Handling |
|------|----------|
| Double check-in same session | Service rejects a 2nd non-voided check-in within the window (default 4h); returns the existing one idempotently |
| Mistaken check-in | Void restores the credit and re-activates a depleted pack |
| Pack hits 0 mid-session | Allowed to reach 0 (`status='depleted'`); no negative balance — a check-in with no remaining credit on any active pack is rejected with a clear "no credits" error so the coach sells/renews |
| Drop-in, no pack | Coach sells a `credits=1` product (or ad-hoc) then checks in; or a one-step "log drop-in" that creates+consumes a 1-credit pack |
| Expiry | `pack-renewal-scanner` (or a check-time guard) flips past-`expires_at` active packs to `expired`; expired credits excluded from balance and from check-in selection |
| Refund | `charge.refunded` webhook → pack `refunded`/`cancelled`; audit |
| Stripe webhook idempotency | Reuse existing webhook's idempotency (lookup by `stripe_session_id`/event) before crediting |
| QR token stale | Token carries an issue-day; verify rejects tokens older than the allowed window |
| Reminder double-send | `last_reminded_threshold` ordering ensures one send per threshold escalation |

## Testing strategy

- **Unit (pure, no DB):** credit math (`remaining`, depletion, void/restore), reminder
  selection across thresholds + expiry + already-notified, QR token sign/verify (valid,
  tampered, expired), drop-in/ad-hoc shaping, expiry lapse.
- **Integration (mocked DAL/Stripe):** sell→webhook→pack credited; check-in→decrement→
  depleted; void→restore; check-in with no credits rejected; double-check-in idempotent.
- **E2E (Playwright, later):** sell a 3-pack → check in to 1 left → reminder selection
  flags it; QR page resolves client and deducts.
- Follows existing `__tests__/` layout and `setup.tsx`; mock Resend + next-auth as the
  current suite does.

## Phasing & sequencing

- **Slice 0:** migration (unapplied), types, validators, feature flags, audit slugs.
- **Slice 1:** DALs + `session-credits` service + QR token (TDD).
- **Slice 2:** coach API routes + Stripe webhook extension (TDD).
- **Slice 3:** reminder scanner + internal route + `onSchedule` cron (TDD).
- **Slice 4:** coach UI (Packages panel, Today screen, `/checkin` page).
- **Phase 2 (separate spec/plan):** Google Calendar two-way sync.

Each slice ends green and committed locally on `main` (no push, no deploy, migration not
applied) so Darren can review and ship with a one-word go-ahead.
