# Recurring Sessions + Flexible Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Recurring standing in-person slots with expected/attended/no-show tracking, plus flexible billing (card-on-file, auto-withdrawal memberships, no-show/late-cancel fees).

**Architecture:** Four flag-gated phases. A = template `recurring_sessions` → generated `scheduled_sessions` + a coach schedule view + no-show cron (attendance decoupled from packs). B = save a card via Stripe hosted `setup` checkout. C = "session membership" recurring subscriptions reusing the existing subscription engine via a `session_membership` metadata type. D = admin-configurable no-show/late-cancel fees charged **off-session** against the saved card.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role DALs), NextAuth v5, Stripe (Checkout setup/subscription modes + off-session PaymentIntents), Zod, Vitest, Firebase `onSchedule` crons, Resend.

## Global Constraints

- **All four phase flags DB-backed in `system_settings`, default OFF:** `recurring_sessions_enabled`, `card_on_file_enabled`, `session_memberships_enabled`, `session_fees_enabled` (`getSetting<boolean>(key, false)`).
- **No real charge until enabled + configured + card saved.** All Stripe calls gated by flags; every test mocks Stripe. Fee amounts / cancel window / cadence live in `system_settings` / catalogue tables (admin-editable), never hardcoded.
- **Reuse:** `getOrCreateStripeCustomer`, subscription webhook lifecycle, hosted-checkout + `session.metadata.type` dispatcher, `onSchedule → token-gated internal route` cron pattern, Resend + notification preferences, idempotent `checkInClient` ledger.
- **Migrations** 00175–00178 via `mcp__supabase__apply_migration`, applied as an activation step (not during build; tests mock the DB).
- **Commit after each task; do NOT push** (solo-dev main; push = prod deploy).

---

## PHASE A — Recurring slots + attendance

### File structure
- `supabase/migrations/00175_recurring_sessions.sql` — `recurring_sessions`, `scheduled_sessions`.
- `lib/db/recurring-sessions.ts` — CRUD for standing slots.
- `lib/db/scheduled-sessions.ts` — CRUD + range queries for occurrences.
- `lib/services/session-schedule.ts` — pure `datesForSlot`, `scanNoShows`; orchestration `ensureUpcomingSessions`, `markAttended/markNoShow/cancelSession/rescheduleSession/reassignSession/addAdhocSession`.
- `lib/validators/sessions.ts` — Zod schemas.
- `lib/packs/flags.ts` — add `recurringSessionsEnabled()` etc.
- `app/api/admin/sessions/**` — route handlers (slots CRUD, session mutations).
- `app/api/admin/internal/session-no-show/route.ts` — cron target.
- `functions/src/index.ts` — `sessionNoShowScanCron`.
- `app/(admin)/admin/schedule/page.tsx` + `components/admin/schedule/*` — schedule view.
- `components/admin/schedule/StandingSlotsPanel.tsx` — on client detail page.

### Task A1: Migration + types
**Files:** Create `supabase/migrations/00175_recurring_sessions.sql`; modify `types/database.ts`.
**Interfaces:** Produces tables per spec; TS types `RecurringSession`, `ScheduledSession`, `ScheduledSessionStatus`.
- [ ] Write the migration (two tables, indexes, unique `(client_user_id, session_date, start_time)`) exactly per spec §Phase A data model.
- [ ] Add matching TS interfaces + status union to `types/database.ts`.
- [ ] Commit `feat(sessions): recurring + scheduled sessions schema + types` (migration written, not yet applied).

### Task A2: Pure schedule helpers (TDD)
**Files:** Create `lib/services/session-schedule.ts`; Test `__tests__/lib/services/session-schedule.test.ts`.
**Interfaces:** Produces `datesForSlot(slot: {day_of_week:number}, from: Date, to: Date): string[]` (ISO dates, inclusive, only matching weekday); `scanNoShows(sessions: {id,session_date,start_time,duration_minutes,status}[], now: Date, bufferMinutes: number): string[]` (ids to mark no_show).
- [ ] Failing tests: `datesForSlot` returns only the correct weekday dates in range; empty when none; `scanNoShows` returns only past-by-buffer `scheduled` sessions, excludes attended/cancelled/future.
- [ ] Implement both pure functions (no DB, no `Date.now()` inside — `now` passed in).
- [ ] Run → pass. Commit `feat(sessions): pure schedule date + no-show helpers`.

### Task A3: DALs (recurring + scheduled)
**Files:** Create `lib/db/recurring-sessions.ts`, `lib/db/scheduled-sessions.ts`.
**Interfaces:** Produces `createRecurringSession/listRecurringForClient/updateRecurringSession/listActiveRecurringSessions`; `upsertScheduledSession/listScheduledInRange/getScheduledById/updateScheduledSession`. All service-role, mirror `lib/db/session-checkins.ts` style.
- [ ] Write DAL functions (thin Supabase wrappers, cast results). No test (thin DAL, covered via service tests).
- [ ] Commit `feat(sessions): recurring + scheduled session DALs`.

### Task A4: Orchestration service (TDD)
**Files:** Modify `lib/services/session-schedule.ts`; Test `__tests__/lib/services/session-schedule.orchestration.test.ts`.
**Interfaces:** Produces `ensureUpcomingSessions(now, horizonDays=14)` (idempotent generation from active slots via `datesForSlot` + `upsertScheduledSession`); `markAttended(id,{by,checkinId?})`, `markNoShow(id,by)`, `cancelSession(id,{by,reason})`, `rescheduleSession(id,{date,time})`, `reassignSession(id,newClientUserId)`, `addAdhocSession({...})`.
- [ ] Failing tests (mock DALs): generation upserts one row per matching date and is idempotent; markAttended sets status+attended_at; cancel/reschedule/reassign transitions.
- [ ] Implement. Run → pass. Commit `feat(sessions): schedule generation + attendance orchestration`.

### Task A5: Flags + validators
**Files:** Modify `lib/packs/flags.ts`, add `lib/validators/sessions.ts`; Test `__tests__/lib/packs/session-flags.test.ts`.
**Interfaces:** Produces `recurringSessionsEnabled()`, `cardOnFileEnabled()`, `sessionMembershipsEnabled()`, `sessionFeesEnabled()` (all default false); Zod `recurringSlotSchema`, `scheduledMutationSchema`, `adhocSessionSchema`.
- [ ] Failing test: each flag defaults false, reads the right key.
- [ ] Implement flags + validators. Run → pass. Commit `feat(sessions): phase flags (default off) + validators`.

### Task A6: Admin API routes (TDD)
**Files:** Create `app/api/admin/sessions/route.ts` (POST create slot, GET range), `app/api/admin/sessions/[id]/route.ts` (PATCH slot / pause), `app/api/admin/sessions/occurrence/[id]/route.ts` (PATCH attended/no_show/cancel/reschedule/reassign); Tests under `__tests__/api/sessions/`.
**Interfaces:** Consumes A4 service + A5 validators. All admin-gated (`auth()` role admin), flag-gated (403 when `recurringSessionsEnabled` off), audit via `recordAudit` (new slugs `session.*`).
- [ ] Failing tests: non-admin 403; flag-off 403; create slot; mark occurrence attended/no_show/cancel calls the service.
- [ ] Implement routes + add audit slugs to `lib/audit/actions.ts` (`session.slot_created`, `session.attended`, `session.no_show`, `session.cancelled`, `session.rescheduled`). Run → pass. Commit `feat(sessions): admin schedule API routes`.

### Task A7: No-show cron target + Firebase job
**Files:** Create `app/api/admin/internal/session-no-show/route.ts`; modify `functions/src/index.ts` (add `sessionNoShowScanCron`), `lib/cron-catalog.ts`; Test `__tests__/api/internal/session-no-show.test.ts`.
**Interfaces:** Consumes `scanNoShows` + DALs. Token-gated (Bearer `INTERNAL_CRON_TOKEN`), `isCronSkipped({enabledKey:'cron_session_no_show_enabled', defaultEnabled:false})`.
- [ ] Failing test: unauthorized without token; marks the returned ids no_show.
- [ ] Implement route + `onSchedule` hourly job (fetch internal route, mirror `packRenewalScanCron`) + catalogue entry. Run → pass. Commit `feat(sessions): no-show scan cron`.

### Task A8: Schedule view + standing-slots panel
**Files:** Create `app/(admin)/admin/schedule/page.tsx`, `components/admin/schedule/ScheduleAgenda.tsx`, `components/admin/schedule/StandingSlotsPanel.tsx`; modify `app/(admin)/admin/clients/[id]/page.tsx` (add panel), `components/admin/admin-nav.ts` (Schedule link); Test `__tests__/components/admin/schedule/ScheduleAgenda.test.tsx`.
**Interfaces:** Consumes A3 range query + A4 (`ensureUpcomingSessions` on load). Presentational agenda with per-row Attended/No-show/Cancel buttons (POST to A6 routes → `router.refresh()`); flag-gated (page redirects when off; nav link only when on).
- [ ] Failing test: agenda renders sessions grouped by date with status chips + action buttons; empty state.
- [ ] Implement page + components + nav (gated) + client-page panel. Run → pass. Commit `feat(sessions): coach schedule view + standing-slots panel`.

### Task A9: Check-in bridge
**Files:** Modify `lib/services/session-credits.ts` (`checkInClient` — after success, best-effort mark today's scheduled session attended) OR the three check-in routes; Test `__tests__/lib/services/checkin-schedule-bridge.test.ts`.
**Interfaces:** Consumes A4 `markAttended` + a `findTodayScheduledForClient(clientUserId, date)` DAL. Gated by `recurringSessionsEnabled`; best-effort (a schedule failure never fails the check-in).
- [ ] Failing test: a successful check-in marks the matching scheduled session attended with `checkinId`; no matching session → no throw; flag off → no-op.
- [ ] Implement bridge (try/catch, flag-gated). Run → pass. Commit `feat(sessions): check-in marks the scheduled session attended`.

---

## PHASE B — Card-on-file (task outline; expand at build time)

- **B1 Migration + types:** `00176_card_on_file.sql` (`user_payment_methods`), TS type. Commit.
- **B2 DAL:** `lib/db/payment-methods.ts` — `getDefaultPaymentMethod`, `upsertPaymentMethod`, `deletePaymentMethod`. Commit.
- **B3 Save-card route (TDD):** `POST /api/admin/clients/[id]/save-card` → `stripe.checkout.sessions.create({mode:"setup", customer, metadata:{type:"save_card",userId}})`; admin+flag gated; returns `{url}`. Extend `createSetupCheckoutSession` in `lib/stripe.ts`. Test mocks Stripe. Commit.
- **B4 Webhook handler (TDD):** `handleSaveCardCheckout` on `checkout.session.completed` where `metadata.type==="save_card"` → retrieve setup_intent → payment_method → upsert. Branch in the webhook dispatcher. Test mocks Stripe retrieve. Commit.
- **B5 Admin UI:** saved-card display + "Update/Remove card" on client detail page (flag-gated). Commit.

## PHASE C — Auto-withdrawal memberships (task outline; expand at build time)

- **C1 Migration + types:** `00177_session_memberships.sql` (`membership_plans`, `client_memberships`), TS types. Commit.
- **C2 DALs:** `lib/db/membership-plans.ts`, `lib/db/client-memberships.ts` (incl. `getMembershipBySubscriptionId`). Commit.
- **C3 Plan catalogue admin (TDD):** `/admin/memberships/plans` + `GET/POST/PATCH /api/admin/memberships/plans` (admin-gated). Mirror session-pack products. Commit.
- **C4 Subscribe route (TDD):** `POST /api/admin/memberships/checkout` → ensure recurring Price (`createStripeProductAndPrice recurring`) → subscription-mode checkout with `metadata:{type:"session_membership",planId,userId}`. Test mocks Stripe. Commit.
- **C5 Webhook branch (TDD):** in subscription handlers, when `metadata.type==="session_membership"` (or `client_memberships` lookup) write `client_memberships` on `checkout/invoice.succeeded/invoice.failed(past_due grace)/updated/deleted`. Test mocks Stripe. Commit.
- **C6 Admin UI:** membership panel on client page (subscribe / status / cancel via billing portal). Commit.

## PHASE D — No-show / late-cancel fees (task outline; expand at build time)

- **D1 Config + migration + types:** fee settings keys in `system_settings` (helpers in `lib/packs/flags.ts`: `noShowFeeCents()`, `lateCancelFeeCents()`, `cancelWindowHours()`); `00178_session_fee_charges.sql` (`session_fee_charges`, unique `(scheduled_session_id, kind)`). Commit.
- **D2 Off-session charge primitive (TDD):** `chargeSavedCard({user, amountCents, description, idempotencyKey})` in `lib/stripe.ts` → `paymentIntents.create({customer, payment_method, off_session:true, confirm:true}, {idempotencyKey})`; typed failures `no_card|declined|error`. Test mocks Stripe (success / decline / no-card guard). Commit.
- **D3 Fee service (TDD):** `lib/services/session-fees.ts` — `chargeNoShowFee(scheduledSession)`, `chargeLateCancelFee(scheduledSession, now)`: guard on `sessionFeesEnabled` + amount>0 + default card; create `session_fee_charges` (unique prevents double), attempt charge, record `payments` + audit on success, `failed`+coach-notify on decline. Test: inert when disabled/no-card/amount 0; charges once; decline → failed. Commit.
- **D4 Wire triggers:** `cancelSession` (A4) → if within `cancelWindowHours` call `chargeLateCancelFee`; `session-no-show` cron (A7) → after `markNoShow` call `chargeNoShowFee`. Both flag+config gated, best-effort. Tests. Commit.
- **D5 Admin fees view:** fee settings in `/admin/automation`; charges list with **retry** / **waive** actions. Commit.

---

## Final verification (after all phases)
- Full `vitest run` green (baseline reds excluded); `npx tsc --noEmit` no new prod-source errors.
- Adversarial review of the two money paths (`chargeSavedCard`, membership webhook branch).
- Update JOURNAL.md + memory. Commit on `main`, do NOT push.

## Self-Review (plan vs spec)
- **Coverage:** A→A1-A9; B→B1-B5; C→C1-C6; D→D1-D5; flags/config in A5+D1; crons A7+D4; UI A8/B5/C6/D5. ✓
- **Money-inert-by-default:** flags default off (A5), charge guarded on flag+amount+card (D2/D3), tests mock Stripe. ✓
- **Type consistency:** `ScheduledSessionStatus` (A1) used by A4/A6/A8; `chargeSavedCard` signature (D2) consumed by D3; `session_membership` metadata type (C4) matched in C5 webhook branch. ✓
- **Decomposition:** four independently-shippable phases, each its own flag + tests. ✓
