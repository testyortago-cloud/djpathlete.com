# Session pack — "bill to" a different email

**Date:** 2026-07-29
**Status:** design approved, phase 1 in build

## Problem

A coach sells an in-person pack to a junior athlete, but a parent pays. Today the Stripe
Checkout link is addressed to the **trainee's** email, and Stripe makes a supplied
`customer_email` **read-only** on the payment page — so the parent cannot correct it and
the receipt lands in the kid's inbox.

The trigger case: Luca Morello (`lucagmorello@icloud.com`), pending pack of 10×
Performance training at $1,500, paid by his dad, who has no account in the system.

The existing escape hatch is the **household billing payer**
([lib/services/billing-payer.ts](../../../lib/services/billing-payer.ts)), but a payer must
be an **existing user with role `client`**
([billing-payer route](../../../app/api/admin/clients/%5Bid%5D/billing-payer/route.ts)). A
parent who will never log in has to be given a full client account — which emails them a
temporary password and creates a GHL contact — just to receive one receipt.

Camps and clinics already solved exactly this: `createEventCheckoutSession` takes a
`parentEmail` and pins it as `customer_email`
([lib/stripe.ts](../../../lib/stripe.ts)). Packs are the outlier.

## Goal

Let the coach type any email when selling a pack (or fix it on an already-pending pack),
have the Stripe link addressed to that person, and have the app email them the link with
the client CC'd.

## Non-goals (phase 2, specced at the bottom, not built)

- Memberships and no-show / late-cancel fees.
- An admin-generated **program** payment link.
- Any concept of an account-less payer who can hold a card.

## Data model — migration `00195_pack_bill_to_email.sql`

Two nullable columns on `client_packages`:

- `bill_to_email text` — who this pack's link is addressed to. `NULL` = today's behavior.
- `bill_to_emailed_at timestamptz` — stamped when the link is emailed, so the UI can show
  "emailed 3m ago" rather than leaving the coach guessing whether it sent.

Both nullable and unused until a coach types an address, so the migration is inert on
arrival. **No feature flag** — same reasoning as the household payer: the feature does
nothing until explicitly used, so there is nothing to gate.

## Resolution order — the one behavioral change

`createPackCheckoutSession` gains an optional `billToEmail`. The addressee resolves:

1. **`billToEmail`** (explicit, per-pack) — wins
2. the household payer's email (`resolveBillingUserId`) — today's behavior
3. the client's own email
4. `undefined` when the lookup throws — unchanged

An explicit per-pack address beats a household payer because it is the more specific,
more recent, deliberately-typed instruction. Where both exist the UI states which one is
in effect, so the override is never silent.

Two callers pass it:

- [checkout route](../../../app/api/admin/session-packs/checkout/route.ts) — from the sell
  dialog, persisting it onto the new pack row.
- [payment-link route](../../../app/api/admin/session-packs/%5Bid%5D/payment-link/route.ts) —
  read back off `pack.bill_to_email`, so a **re-minted** link keeps the same addressee
  instead of silently reverting to the client. This is the failure mode that made a
  non-persisted design unacceptable.

## Emailing the link

New `sendPackPaymentLinkEmail` in [lib/email.ts](../../../lib/email.ts), following the
existing `emailLayout` house style.

- **To** — the bill-to address (or the client, when none is set).
- **CC** — the client. Dropped when it equals the To address, so an ordinary sale never
  CCs someone their own email.

New route `POST /api/admin/session-packs/[id]/email-link`:

- Resolves the live link exactly as the copy-link route does (reuses that logic rather
  than minting a second, competing session).
- Sends **blocking** — the coach must learn immediately if delivery failed, matching the
  Add Client precedent.
- Stamps `bill_to_emailed_at` and audits a new `pack.payment_link_emailed` action.

## Changing the address on an existing pack

`PATCH /api/admin/session-packs/[id]/bill-to` sets or clears `bill_to_email`.

Because a pinned email is baked into the Checkout session at creation, changing it means
the open session must be **expired and re-minted**. Reuses the delete route's guards:

- session `complete` → **409**, never repoint a paid session (would strand the payment and
  put the webhook into a retry loop).
- Stripe error → **502**, never guess.
- session `open` → expire, then mint a fresh one.

The UI warns that the old link stops working. This is the path that re-addresses Luca's
pending $1,500 pack without deleting and re-selling it.

## UI

- **Sell dialog** ([SellPackDialog.tsx](../../../components/admin/packs/SellPackDialog.tsx)) —
  under **Payment**, when the method is "Card (Stripe link)": a "Someone else is paying"
  checkbox revealing an email field. The link-ready screen shows `Billed to <email>` plus
  **Copy** and **Email this link**.
- **Pack row** ([ClientPackagesPanel.tsx](../../../components/admin/packs/ClientPackagesPanel.tsx)) —
  a pending Stripe pack shows the current addressee, an **Email link** button, and a
  **Change billing email** action.

## Safety

- Admin-only and audited, like every other pack mutation.
- `metadata.clientUserId` is untouched, so the **webhook still credits the trainee**. A
  payer leaking into that metadata would hand the sessions to the wrong person — a far
  worse bug than a misdirected receipt.
- `payments.user_id` comes from `pkg.client_user_id`
  ([webhook](../../../app/api/stripe/webhook/route.ts)), so revenue stays attributed to the
  trainee regardless of who paid. Bookkeeping is unaffected.
- An address equal to `COACH_EMAIL` produces a **warning, not a block** — that is the
  Stripe Link autofill bug the email pinning was originally added to prevent.

### Known, accepted side effect

The webhook feeds `session.customer_details?.email` into `resolveTrackingParams`. With a
bill-to address that lookup sees the parent's email and will not match the trainee's visit
history. The `gclid` / `fbclid` carried in session metadata still resolve, so ad
attribution survives; only the email-match fallback degrades. Acceptable for a
coach-initiated in-person sale, which is not an ad-attributed funnel.

## Testing

Extends [stripe-pack-checkout-payer.test.ts](../../../__tests__/lib/stripe-pack-checkout-payer.test.ts):

- all four resolution branches, including override-beats-payer
- a re-minted link keeps the bill-to address
- CC dropped when the bill-to address is the client's own
- change-bill-to expires the old session; refuses on a `complete` one

While in that file: one existing test is named *"still pins SOME email — never leaves it
blank to Link autofill"* but asserts `toBeUndefined()`. The assertion is correct and the
name contradicts it. Fix the name.

## Phase 2 — specced, not built

**Account-less payer holding a card.** Memberships and no-show / late-cancel fees do not
create a Checkout session per charge; they charge a **saved card on a Stripe customer tied
to a user row** (`user.stripe_customer_id` + `getDefaultPaymentMethod(billingUserId)`, see
[session-fees.ts](../../../lib/services/session-fees.ts)). A bare email has no customer and
no card, so extending "bill to" there requires a payer entity that can exist without a
user account and still hold a payment method. Open questions:

- Does an account-less payer get a Stripe customer with no user row, or a stub user with
  no login?
- How does that payer add a card — a tokenized setup link with no session behind it?
- Does `resolveBillingUserId` return a user id or a wider "payer" union? Every caller
  currently assumes a user id.

**Admin-generated program payment link.** Paid programs are bought client-side
([ClientBuyButton.tsx](../../../app/(client)/client/programs/%5Bid%5D/ClientBuyButton.tsx) →
[/api/stripe/checkout](../../../app/api/stripe/checkout/route.ts)), which requires the buyer
to be logged in as the purchaser. There is no coach-minted program link to re-address, and
`createCheckoutSession` pins no email at all — so whoever opens that page already types
their own. Adding a coach-side link is a new capability (new route, new dialog, a webhook
path granting access to a client who never initiated the purchase), not a fix.
