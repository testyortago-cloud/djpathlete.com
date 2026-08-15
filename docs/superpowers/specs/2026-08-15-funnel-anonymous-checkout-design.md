# Selling from a funnel page — anonymous Stripe checkout

**Status:** design, approved in conversation 2026-08-15. **No code written.**
**Money path.** Everything here is flag-gated and off by default.

---

## 1. What happens today

A visitor clicks "Buy now" on a published funnel page and is sent to **the login
screen**. [`CheckoutIsland.tsx`](../../components/funnels/islands/CheckoutIsland.tsx)
is a routed link, not a Stripe session:

```
/login?callbackUrl=/client/programs/<id>
```

So a cold visitor from an ad must create an account, log in, find the program
and then buy. On paid traffic that is most of the conversions gone. The code
says why, and it was a fair call when written:

> *"Deliberately a routed link, not an anonymous Stripe session.
> /api/stripe/checkout requires a signed-in user, and building a logged-out
> purchase path would mean changing Stripe webhook handling for orders with no
> owning user — a money-path change that needs its own design."*

This document is that design.

## 2. Anonymous card payment is already solved here

[`app/api/events/[id]/checkout/route.ts`](../../app/api/events/[id]/checkout/route.ts)
has **no `auth()` call at all**. It already does the hard parts: honeypot,
capacity checked before charging, a Stripe session for a logged-out buyer,
post-payment confirmation through the webhook via an atomic RPC that locks the
event row, **automatic refund when two buyers race for the last slot**, and
marketing attribution carried through to the payment.

So the `CheckoutIsland` comment is out of date. What is genuinely unsolved is
not payment. It is **delivery**.

## 3. The keystone: delivery, not payment

| Product | Delivered by | Needs an account? |
|---|---|---|
| Camp / clinic / event | Turning up | No |
| One-off digital product | Email | No |
| Program | The app | **Yes** |
| Session pack | The app | **Yes**, plus billing baggage |

Programs and packs both wait on one thing — **turning an anonymous payer into a
client** — and that is the only genuinely new mechanism in this document.

## 4. A correction to the phasing I proposed in conversation

I said events would be "close to free" because their checkout route is already
anonymous. **That was wrong, and I checked before writing this rather than
after.**

`createEventSignupSchema` requires `parent_name`, `parent_email`,
`athlete_name`, `athlete_age` (6–21), optional phone/sport/notes, and
`waiver_accepted` which must be literally `true` — the server records the active
`liability_waiver` document id plus IP and user agent at insert. That is a real
multi-field form with a **legal gate**, not a payload a button can synthesise.
Wiring a one-click buy button to it would mean either inventing the athlete's
details or bypassing a liability waiver, and neither is acceptable.

Selling events from a funnel therefore means embedding that whole form as a
section — waiver text included. Medium work, not small.

**Revised order, cheapest genuinely-shippable first:**

1. **Programs** — the highest-value thing to sell, and the cleanest: Stripe
   Checkout collects name and email itself, there is no waiver, and the grant
   path already exists. It also builds the account bridge, which everything
   else then reuses.
2. **Session packs** — the bridge plus pack-specific billing (§8).
3. **Events** — the bridge is not needed, but the signup form and waiver are.
4. **Digital products** — no account and no waiver, but a new product type with
   nowhere yet to define price or the asset to deliver.

## 5. The flow

```
  Funnel page
      │  name + email
      ▼
  Lead row written  ─────────────────► leads inbox
      │                                (an abandoned checkout is still a lead)
      ▼
  POST /api/funnels/checkout   (anonymous, flag-gated)
      │  metadata: { stepId, productKind, productId, leadId }
      ▼
  Stripe Checkout  ──────► visitor pays
      │
      ▼
  webhook: checkout.session.completed
      │
      ├─ 1. find-or-create client BY EMAIL   ← find first, always
      ├─ 2. grant the product                ← through the existing gate
      └─ 3. email a set-password link        ← new accounts only
```

### 5.1 The lead is captured BEFORE Stripe

Stripe Checkout can collect the email itself, which would mean zero fields on
our page and marginally better conversion. We take name and email first anyway,
and write a lead row through the machinery the funnel already has.

The reason is that **an abandoned checkout is otherwise invisible to you**.
Stripe saw them; you did not. Capturing first turns every drop-off into someone
you can follow up, which is worth more than the fraction of a percent the extra
field costs.

### 5.2 Find before create

If the email already belongs to a client, **attach the purchase to them and
send no set-password email** — they already have a password. Creating a second
account would split one athlete's training history across two logins, and the
person most likely to hit this is a returning customer.

## 6. Three properties that are not negotiable

**Flag-gated, default off.** This is money *and* mass email, which is exactly
the bar for a flag in this repo, and new Stripe-webhook logic must be
flag-gated and resilient to a missing table regardless.

**Idempotent.** Stripe retries webhooks, sometimes days later. The grant keys
off the checkout session id and is safe to replay — granting twice means two
program assignments or a double-credited pack.

**The charged-but-not-granted path is handled explicitly.** Card succeeded,
account creation or grant failed, is the one outcome that costs a customer and
the coach's reputation at once. It alerts with the Stripe session id and the
buyer's email, and the grant is retryable. It is never a log line and never a
silent orphan payment.

## 7. Programs: grant through the gate, never around it

The payment gate runs through `assignProgram()` and `assertAssignmentPayable`.
The webhook grant **must** go through that same path rather than writing an
assignment row directly.

Writing the row directly would mean the one flow that definitely took the money
is also the one flow that skips the check designed to stop unpaid access — and
it would fail open, silently, on exactly the path where money is involved.

## 8. Session packs: last, and deliberately not auto-renewing

Packs carry three things a funnel buyer cannot satisfy:

- they can be billed to **any** email, so "who owns this pack" is a real
  question rather than an obvious one;
- purchase writes a **mirror row** into `payments`, so revenue reporting
  double-counts if the funnel path writes its own;
- **auto-renew arms at purchase**, from a consent checkbox.

An anonymous buyer cannot meaningfully consent to a recurring card charge the
way that checkbox assumes. **A funnel-bought pack is never auto-renew-armed.**
The buyer arms it later from inside the app, where they are identified and can
withdraw consent. This is a deliberate loss of revenue-per-sale in exchange for
not charging a card nobody knowingly agreed to leave on file.

## 9. Out of scope

- Changing the authenticated purchase path. It works and is tested.
- Passwordless sign-in. Considered and rejected in conversation: this app is
  NextAuth Credentials-only, so it is a larger auth change than this needs.
- Refunds and disputes beyond the automatic overbook refund that already exists
  for events.
- Selling anything the app cannot currently deliver.

## 10. What to test

| Test | Catches |
|---|---|
| Webhook replayed twice → one grant | Stripe's retries double-granting |
| Buyer's email already a client → attached, no second account, no set-password email | Splitting a customer's history in two |
| Grant fails after payment → alert raised, payment recorded, retryable | A silent orphan payment |
| Flag off → route 404s and webhook branch is inert | A money path live before it was meant to be |
| Program grant goes through `assertAssignmentPayable` | The gate being bypassed by the flow that took the money |
| Funnel-bought pack → `auto_renew` false regardless of payload | A card left on file without knowing consent |
| Abandoned checkout → lead row still present | Losing the people who nearly bought |
| Webhook with unknown/absent metadata → ignored, not guessed | Mis-granting on a session this flow did not create |
