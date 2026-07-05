# Household Billing Payer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Let a client have a billing payer (another client) whose saved card covers that client's no-show/late-cancel fees and memberships.

**Architecture:** A `client_billing_payers` link table + a one-hop `resolveBillingUserId()` resolver. Fees and the membership-subscribe route resolve the billing user before charging Stripe. UI control in the Sessions & Billing panel. No flag (inert until a payer is set).

**Tech Stack:** Next.js 16, Supabase service-role DALs, NextAuth v5, Stripe, Zod, Vitest.

## Global Constraints
- **Money resolves through `resolveBillingUserId` only** — one hop, self-reference forbidden.
- **Inert by default:** no `client_billing_payers` row → resolver returns self → today's exact behavior. No feature flag.
- Migration `00179` written now, applied at activation. Commit per task; **do NOT push**.
- All Stripe/DAL mocked in unit tests, mirroring existing `__tests__/` patterns.

---

### Task 1: Migration + DAL + resolver (TDD)
**Files:** Create `supabase/migrations/00179_client_billing_payers.sql`, `lib/db/client-billing-payers.ts`, `lib/services/billing-payer.ts`, `types/database.ts` (add `ClientBillingPayer`); Test `__tests__/lib/services/billing-payer.test.ts`.
**Produces:** `getBillingPayer/setBillingPayer/clearBillingPayer`; `resolveBillingUserId(clientUserId): Promise<string>`.
- [ ] Migration: table per spec (PK client_user_id, payer_user_id not null, created_by, timestamps, `check (client_user_id <> payer_user_id)`, index on payer_user_id, updated_at trigger, RLS own-read). Add `ClientBillingPayer` type.
- [ ] DAL: thin service-role wrappers (get/set-upsert/clear).
- [ ] Resolver test: no row → returns the client id; row present → returns payer id; one-hop (payer has its own payer → still returns the direct payer, not the grand-payer).
- [ ] Implement `resolveBillingUserId` (calls `getBillingPayer`, returns `payer_user_id ?? clientUserId`). Run → pass. Commit.

### Task 2: Fees route to the payer (TDD)
**Files:** Modify `lib/services/session-fees.ts`; Test `__tests__/lib/services/session-fees.test.ts` (extend).
**Consumes:** `resolveBillingUserId`.
- [ ] In `attemptFee`: `const billingUserId = await resolveBillingUserId(session.client_user_id)`; load `getUserById(billingUserId)` + `getDefaultPaymentMethod(billingUserId)`; charge that customer/card. Keep `session_fee_charges.user_id = session.client_user_id`; set the `payments` row `user_id = billingUserId` with `metadata.trainee_user_id = session.client_user_id`. In `retryFeeCharge`: resolve `resolveBillingUserId(charge.user_id)` for user+card.
- [ ] Tests: with a payer set, `chargeSavedCard` is called with the PAYER's customer/card; with no payer, still the client's; still waives when the resolved user has no card. Mock `@/lib/services/billing-payer`. Run → pass. Commit.

### Task 3: Membership subscribe routes to the payer (TDD)
**Files:** Modify `app/api/admin/memberships/checkout/route.ts`; Test `__tests__/api/billing/membership-checkout.test.ts` (extend).
**Consumes:** `resolveBillingUserId`.
- [ ] Resolve `billingUserId = await resolveBillingUserId(parsed.data.userId)`; `getOrCreateStripeCustomer(billingUserId, billingUser.email)` for `customerId`; keep `createMembershipCheckoutSession({ customerId, userId: parsed.data.userId, plan })` (metadata stays the trainee).
- [ ] Test: with a payer, the customer resolves to the payer (getOrCreateStripeCustomer called with payer id) while the checkout `userId` stays the trainee. Mock billing-payer + stripe. Run → pass. Commit.

### Task 4: Set-payer route (TDD)
**Files:** Create `app/api/admin/clients/[id]/billing-payer/route.ts`; Modify `lib/audit/actions.ts` (`client.billing_payer_set`); Test `__tests__/api/billing/billing-payer.test.ts`.
- [ ] Route `POST` (admin): body `{ payerUserId: string | null }`. If null → `clearBillingPayer(id)`. Else validate `payerUserId !== id` (400 self) and the payer exists (`getUserById`), then `setBillingPayer(id, payerUserId, session.user.id)`. Audit. Return `{ ok }`.
- [ ] Tests: 403 non-admin; 400 self-reference; sets payer; clears on null. Run → pass. Commit.

### Task 5: UI — payer control + card reflection (TDD-light)
**Files:** Create `components/admin/billing/BillingPayerControl.tsx`; Modify `components/admin/clients/ClientSessionsPanel.tsx` (render control + pass payer to card), `components/admin/billing/SavedCardPanel.tsx` (payer read-only mode), `app/(admin)/admin/clients/[id]/page.tsx` (load payer + candidate clients + payer's card); Test `__tests__/components/admin/billing/BillingPayerControl.test.tsx`.
**Produces:** `BillingPayerControl({ clientUserId, currentPayerId, candidates })`; `SavedCardPanel` gains optional `payer?: { name: string; card: UserPaymentMethod | null }`.
- [ ] `BillingPayerControl`: a select (Themselves + candidates) → `POST /api/admin/clients/[id]/billing-payer` → `router.refresh()`. Test: renders options incl. current selection; empty candidates → just "Themselves".
- [ ] `SavedCardPanel`: when `payer` prop present, render read-only "Billed to {payer.name} — {card ···· last4 | no card yet}"; else current add-card behavior.
- [ ] `ClientSessionsPanel`: render `BillingPayerControl` in the card section; when a payer is set, pass `payer` to `SavedCardPanel` (payer name + payer's default card) instead of the client's own.
- [ ] Client detail page: load `getBillingPayer(id)`; if set, load payer user + `getDefaultPaymentMethod(payerId)`; load candidate clients (`getUsers` → role client, minus self) → pass to the panel. Run → pass. Commit.

## Final
- Full `vitest run` green (baseline reds excluded); `npx tsc --noEmit` 0 non-test prod errors.
- Adversarial review of the fee + membership payer resolution.
- Journal + memory. Commit on `main`, **do NOT push**.

## Self-Review (plan vs spec)
- Coverage: model/resolver → T1; fees → T2; memberships → T3; set-payer API → T4; UI → T5. ✓
- Money-through-resolver + inert-by-default: T1 resolver, T2/T3 consume it, no flag. ✓
- Types: `resolveBillingUserId` (T1) consumed in T2/T3; `SavedCardPanel.payer` (T5) matches. ✓
