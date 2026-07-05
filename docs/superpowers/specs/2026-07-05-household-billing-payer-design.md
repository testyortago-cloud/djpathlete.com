# Household Billing Payer — Design

**Date:** 2026-07-05
**Status:** Approved (autonomous build). Ships committed-not-pushed; migration written-not-applied; naturally inert until a payer is set.

## Problem

Darren's community gym has families: the dad comes Mon/Wed/Fri, the wife + son come Tue/Thu, and **the dad pays for all three**. Today every charge (no-show/late-cancel fees, memberships) resolves the *client's own* Stripe customer + saved card — so there's no way for one person's card to cover another's sessions. This is the biggest fit-gap for his actual setup.

## Goal

Let a client optionally have a **billing payer** — another client whose saved card covers that client's **automatic** charges (**no-show/late-cancel fees** and **memberships**). No payer = they pay for themselves (unchanged). Packs stay coach-chosen at sale time (out of scope).

## Approach — per-client payer link (not a named household)

Each client optionally points to one payer. That naturally forms a household (all pointing at the dad) without a separate household entity, split-billing, or shared memberships. Rejected: a named `households` entity (more structure than needed) and a `client_profiles.billed_to_user_id` column (couples billing to profiles).

## Data model — migration `00179_client_billing_payers.sql`

- **`client_billing_payers`**: `client_user_id uuid PK → users(id)`, `payer_user_id uuid not null → users(id)`, `created_by`, `created_at`, `updated_at`. `check (client_user_id <> payer_user_id)` (no self-pay-loop). Index on `payer_user_id`. RLS: client may read their own row; writes via service-role. A row means "this client's automatic charges bill the payer's card." No row = self.

## Resolver — the single source of truth

`lib/services/billing-payer.ts`:
- `resolveBillingUserId(clientUserId): Promise<string>` → the `payer_user_id` if a row exists, else `clientUserId`. **One hop only** (a payer's own payer is ignored) → no chains, no loops. This is the only place the payer indirection lives; fees and memberships call it.

DAL `lib/db/client-billing-payers.ts`: `getBillingPayer(clientUserId)`, `setBillingPayer(clientUserId, payerUserId, createdBy)` (upsert), `clearBillingPayer(clientUserId)`.

## How the money resolves

- **No-show / late-cancel fees** (`lib/services/session-fees.ts`): the fee charge row still records `user_id = the trainee` (whose session it was), but the off-session charge resolves **`resolveBillingUserId(trainee)`'s** Stripe customer + default card. `retryFeeCharge` resolves the same way. The `payments` (revenue) row is recorded under the **billing user** (who actually paid), with the trainee in `metadata`. So the wife's no-show fee hits the dad's card.
- **Memberships** (`app/api/admin/memberships/checkout/route.ts`): the subscription Checkout is created on the **payer's** Stripe customer (`getOrCreateStripeCustomer(resolveBillingUserId(trainee), payerEmail)`), while `metadata.userId` stays the **trainee** — so the webhook still creates `client_memberships.user_id = trainee`, but `stripe_customer_id` + the billed card = the payer's. The dad can hold all three family memberships on his one card.
- **Card on file**: the payer holds the card. On a client's page, when a payer is set, the card section shows a read-only **"Billed to <Payer> — <payer's card ···· 4242 / no card yet>"** instead of an add-card button. The payer adds their card the normal way on their own page.

## Safety (money-sensitive)

- Charges still only fire when the **resolved billing user has a saved card** — same guard as today, just pointed at the payer. If the dad has no card, the wife's fee waives/fails exactly as a cardless self-payer would.
- **No loops:** DB `check` forbids self-reference; the resolver is one-hop so A→B→A can't cascade.
- **Explicitness:** the UI states whose card is charged, so there's no surprise. Setting a payer is an explicit admin action (audited).
- No feature flag: the feature is inert until a coach sets a payer (no `client_billing_payers` row → `resolveBillingUserId` returns self → today's exact behavior).

## UI

- **`BillingPayerControl`** in the client's **Sessions & Billing** panel: *"Charges for this client go to:"* a select of **Themselves** + other clients (excludes self). Changing it calls `POST /api/admin/clients/[id]/billing-payer` (`{ payerUserId | null }`, admin-gated, audited) → `router.refresh()`.
- **Card section**: reflects the payer (read-only payer-card summary when a payer is set; normal add-card when self).
- Candidate clients are loaded server-side on the client detail page (role `client`, minus self) and passed to the control.

## API

- `POST /api/admin/clients/[id]/billing-payer` — admin-only. Body `{ payerUserId: string | null }`. Sets or clears the link (validates payer ≠ client, payer exists). Audit `admin_write` (new slug `client.billing_payer_set`).

## Testing

- `resolveBillingUserId`: self when no row; payer when set; one-hop only (ignores payer's payer).
- Fees: `attemptFee` charges the **payer's** customer/card when a payer is set; falls back to self when none; still inert when the payer has no card / amount 0.
- Membership checkout: uses the payer's Stripe customer while keeping `metadata.userId = trainee`.
- Set-payer route: admin-gated; rejects self-reference; sets/clears.
- All Stripe/DAL mocked (unit level), mirroring existing `__tests__` patterns.

## Out of scope (YAGNI)

Named/multi households, split billing, one membership covering several people, payer chains, pack purchases routing to the payer.

## Rollout

Migration `00179` written now, applied at activation. Committed on `main`, **not pushed**. Inert until a coach sets a payer, so no flag and no risk sitting deployed.
