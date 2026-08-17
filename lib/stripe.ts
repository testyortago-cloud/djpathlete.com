import Stripe from "stripe"
import type { Program, PaymentType, BillingInterval, Event, EventSignup } from "@/types/database"
import { updateUser, getUserById } from "@/lib/db/users"
import { resolveBillingUserId } from "@/lib/services/billing-payer"
import { cardOnFileEnabled } from "@/lib/packs/flags"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-01-28.clover" })

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ??
    "https://darrenjpaul.com"
  )
}

// ─── Shared tracking params type ─────────────────────────────────────────────

interface CheckoutTrackingParams {
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  fbclid?: string | null
}

function buildTrackingMetadata(tracking?: CheckoutTrackingParams): Record<string, string> {
  if (!tracking) return {}
  return {
    gclid:  tracking.gclid  ?? "",
    gbraid: tracking.gbraid ?? "",
    wbraid: tracking.wbraid ?? "",
    fbclid: tracking.fbclid ?? "",
  }
}

// ─── Existing: One-time checkout (unchanged) ─────────────────────────────────

export async function createCheckoutSession(
  program: Program,
  userId: string,
  returnUrl?: string,
  tracking?: CheckoutTrackingParams,
) {
  const baseUrl = getBaseUrl()
  const successUrl = `${baseUrl}${returnUrl ?? "/programs/success"}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/client/programs/${program.id}`

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: program.name,
            description: program.description ?? undefined,
          },
          unit_amount: program.price_cents!,
        },
        quantity: 1,
      },
    ],
    metadata: {
      programId: program.id,
      userId,
      ...buildTrackingMetadata(tracking),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })

  return session
}

export function verifyWebhookSignature(body: string, signature: string) {
  return stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
}

// ─── New: Product & Price management ─────────────────────────────────────────

export async function createStripeProductAndPrice(opts: {
  name: string
  description: string | null
  priceCents: number
  paymentType: PaymentType
  billingInterval: BillingInterval | null
  programId: string
}) {
  const product = await stripe.products.create({
    name: opts.name,
    description: opts.description ?? undefined,
    metadata: { programId: opts.programId },
  })

  const priceData: Stripe.PriceCreateParams = {
    product: product.id,
    unit_amount: opts.priceCents,
    currency: "usd",
  }

  if (opts.paymentType === "subscription" && opts.billingInterval) {
    priceData.recurring = { interval: opts.billingInterval }
  }

  const price = await stripe.prices.create(priceData)

  return { productId: product.id, priceId: price.id }
}

export async function updateStripeProduct(productId: string, name: string, description: string | null) {
  await stripe.products.update(productId, {
    name,
    description: description ?? undefined,
  })
}

export async function archiveAndCreateNewPrice(opts: {
  productId: string
  oldPriceId: string
  priceCents: number
  paymentType: PaymentType
  billingInterval: BillingInterval | null
}) {
  // Archive the old price (can't delete prices in Stripe)
  await stripe.prices.update(opts.oldPriceId, { active: false })

  const priceData: Stripe.PriceCreateParams = {
    product: opts.productId,
    unit_amount: opts.priceCents,
    currency: "usd",
  }

  if (opts.paymentType === "subscription" && opts.billingInterval) {
    priceData.recurring = { interval: opts.billingInterval }
  }

  const price = await stripe.prices.create(priceData)
  return price.id
}

// ─── New: Customer management ────────────────────────────────────────────────

export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const user = await getUserById(userId)

  // Trust our own fresh DB read over the caller's argument. Some callers
  // (e.g. app/api/stripe/checkout/route.ts) pass session.user.email straight
  // from the NextAuth JWT, which can be up to 24h stale under this repo's
  // session lifetime. Pushing THAT to Stripe below could revert an email
  // change a more recent save-card or pack checkout had already synced
  // correctly. `user` is fetched fresh right above regardless of branch, so
  // it's always at least as current as the caller's value — use it instead.
  const currentEmail = user.email || email

  if (user.stripe_customer_id) {
    // Reconcile: a Stripe Customer is created once and never touched again by
    // default. If the user changes their email in-app afterward, nothing
    // pushes that change to Stripe — the Customer object (and therefore every
    // receipt addressed via `customer` instead of a bare customer_email)
    // silently keeps the OLD email forever. Same wrong-inbox property the
    // original customer_email fix eliminated, just relocated to a field
    // nothing was watching. This retrieves Stripe's actual copy and only
    // writes when it's genuinely stale. Best-effort: a Stripe hiccup must
    // never block the sale.
    try {
      const customer = await stripe.customers.retrieve(user.stripe_customer_id)
      // Narrow via `in` rather than an `as boolean` cast — the cast defeats
      // TypeScript's aliased-condition narrowing, so `customer` stays typed
      // as Customer | DeletedCustomer and `customer.email` doesn't compile
      // (DeletedCustomer has no `email`).
      if (!("deleted" in customer) && customer.email !== currentEmail) {
        await stripe.customers.update(user.stripe_customer_id, { email: currentEmail })
      }
    } catch (err) {
      console.error("[getOrCreateStripeCustomer] could not reconcile customer email:", err)
    }
    return user.stripe_customer_id
  }

  const customer = await stripe.customers.create({
    email: currentEmail,
    metadata: { userId },
  })

  await updateUser(userId, { stripe_customer_id: customer.id })

  return customer.id
}

// ─── New: Subscription checkout ──────────────────────────────────────────────

export async function createSubscriptionCheckoutSession(
  program: Program,
  customerId: string,
  userId: string,
  returnUrl?: string,
  tracking?: CheckoutTrackingParams,
) {
  const baseUrl = getBaseUrl()
  const successUrl = `${baseUrl}${returnUrl ?? "/programs/success"}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/client/programs/${program.id}`

  if (!program.stripe_price_id) {
    throw new Error("Program does not have a Stripe price configured")
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: program.stripe_price_id,
        quantity: 1,
      },
    ],
    metadata: {
      programId: program.id,
      userId,
      ...buildTrackingMetadata(tracking),
    },
    subscription_data: {
      metadata: {
        programId: program.id,
        userId,
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })

  return session
}

// ─── Per-week checkout ──────────────────────────────────────────────────────

export async function createWeekCheckoutSession(opts: {
  programName: string
  weekNumber: number
  priceCents: number
  userId: string
  assignmentId: string
  weekAccessId: string
  returnUrl?: string
  tracking?: CheckoutTrackingParams
}) {
  const baseUrl = getBaseUrl()
  const successUrl = `${baseUrl}${opts.returnUrl ?? "/client/workouts"}?week_paid=${opts.weekNumber}`
  const cancelUrl = `${baseUrl}/client/workouts`

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${opts.programName} — Week ${opts.weekNumber}`,
            description: `Week ${opts.weekNumber} access`,
          },
          unit_amount: opts.priceCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: "week_access",
      weekAccessId: opts.weekAccessId,
      assignmentId: opts.assignmentId,
      weekNumber: String(opts.weekNumber),
      userId: opts.userId,
      ...buildTrackingMetadata(opts.tracking),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })

  return session
}

// ─── New: Billing portal ─────────────────────────────────────────────────────

export async function createBillingPortalSession(customerId: string, returnUrl: string) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session
}

// ─── Event sync (Phase 3) ────────────────────────────────────────────────────

/**
 * Idempotent sync of an Event to a Stripe Product + Price.
 * - If event has no stripe_product_id, creates a new Product + Price.
 * - If event has stripe_product_id but the Product is missing/archived in Stripe,
 *   creates a fresh Product + Price.
 * - If event has stripe_product_id but no stripe_price_id, creates a Price under
 *   the existing Product.
 * - If event has both ids, returns existing ids without calling Stripe.
 *
 * Caller is responsible for persisting the returned ids on the event row.
 */
export async function syncEventToStripe(event: Event): Promise<{ productId: string; priceId: string }> {
  if (event.price_cents == null || event.price_cents <= 0) {
    throw new Error("Cannot sync event without a positive price_cents")
  }

  let productId = event.stripe_product_id
  let needFreshProduct = !productId

  if (productId) {
    try {
      const product = await stripe.products.retrieve(productId)
      if (!product.active) needFreshProduct = true
    } catch {
      // Product missing entirely → create fresh.
      needFreshProduct = true
    }
  }

  if (needFreshProduct) {
    const product = await stripe.products.create({
      name: event.title,
      description: event.summary || undefined,
      metadata: { eventId: event.id, type: "event" },
    })
    productId = product.id
  }

  // Reuse existing price when product was already valid AND a price id is on file.
  if (event.stripe_price_id && !needFreshProduct) {
    return { productId: productId!, priceId: event.stripe_price_id }
  }

  const price = await stripe.prices.create({
    product: productId!,
    unit_amount: event.price_cents,
    currency: "usd",
  })

  return { productId: productId!, priceId: price.id }
}

/**
 * Create a guest-friendly Stripe Checkout Session for a paid event signup
 * (clinic or camp).
 * - mode: "payment" (one-shot, no subscription)
 * - customer_email pre-fills the parent's address
 * - metadata.type = "event_signup" so the webhook dispatcher routes to our handler
 */
export async function createEventCheckoutSession(opts: {
  event: Event
  signup: EventSignup
  parentEmail: string
  baseUrl: string
  tracking?: CheckoutTrackingParams
  /**
   * Where Stripe returns the visitor.
   *
   * OPTIONAL, DEFAULTING TO THE EVENT'S OWN PAGES, so the caller that existed
   * before these two parameters behaves exactly as it did. A funnel supplies its
   * own pages: a funnel-born checkout that returned here would land the parent on
   * the event's success page, and the funnel's own Confirmation step — the page
   * its owner wrote for precisely this moment — would never be seen.
   */
  successUrl?: string
  cancelUrl?: string
}): Promise<Stripe.Checkout.Session> {
  if (!opts.event.stripe_price_id) {
    throw new Error("Cannot create checkout: event has no stripe_price_id")
  }
  const segment = opts.event.type === "clinic" ? "clinics" : "camps"
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{ price: opts.event.stripe_price_id, quantity: 1 }],
    customer_email: opts.parentEmail,
    metadata: {
      type: "event_signup",
      event_signup_id: opts.signup.id,
      event_id: opts.event.id,
      ...buildTrackingMetadata(opts.tracking),
    },
    success_url:
      opts.successUrl ?? `${opts.baseUrl}/${segment}/${opts.event.slug}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: opts.cancelUrl ?? `${opts.baseUrl}/${segment}/${opts.event.slug}?checkout=cancelled`,
  })
}

/**
 * Resolves the actual payment intent id from a checkout session.
 * For one-time/payment sessions, returns session.payment_intent directly.
 * For subscription sessions, session.payment_intent is null — the initial
 * charge lives on the auto-created invoice, so we fetch the subscription's
 * latest_invoice and pull the payment_intent from there.
 *
 * Returns null if no payment_intent can be resolved (e.g., trial subscription
 * with no immediate charge, free session, etc.).
 */
export async function resolveSessionPaymentIntent(
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  if (session.payment_intent) {
    return typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id
  }

  if (session.mode === "subscription" && session.subscription) {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id
    try {
      const sub = await stripe.subscriptions.retrieve(subId, {
        expand: ["latest_invoice.payments", "latest_invoice.payment_intent"],
      })
      const invoice = sub.latest_invoice
      if (invoice && typeof invoice !== "string") {
        // Stripe's newer invoice shape nests the PI under invoice.payments.data[0].payment.payment_intent.
        // Older shape exposes it as invoice.payment_intent. Check both.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inv = invoice as any
        const nested =
          inv.payments?.data?.[0]?.payment?.payment_intent ??
          inv.payments?.data?.[0]?.payment_intent
        if (nested) return typeof nested === "string" ? nested : nested.id
        const legacy = inv.payment_intent
        if (legacy) return typeof legacy === "string" ? legacy : legacy.id
      }
    } catch {
      return null
    }
  }

  return null
}

// ─── Session pack checkout ───────────────────────────────────────────────────

/**
 * Checkout Session for an in-person session pack. metadata.type = "session_pack"
 * routes it to handleSessionPackCheckout in the webhook. Uses a pre-made Stripe
 * price when available, else inline price_data.
 */
export async function createPackCheckoutSession(opts: {
  clientUserId: string
  name: string
  sessionType: string
  credits: number
  priceCents: number
  validityDays: number | null
  productId: string | null
  stripePriceId?: string | null
  /** Explicit addressee (e.g. a parent with no account). Beats the household payer. */
  billToEmail?: string | null
  /** Consent captured on the checkout checkbox — carried into Stripe metadata so the webhook can arm the pack. */
  autoRenew?: boolean
  returnUrl?: string
  cancelUrl?: string
}): Promise<Stripe.Checkout.Session> {
  const baseUrl = getBaseUrl()
  const successUrl = `${baseUrl}${opts.returnUrl ?? `/admin/clients/${opts.clientUserId}`}?pack=purchased`
  const cancelUrl = opts.cancelUrl
    ? `${baseUrl}${opts.cancelUrl}?pack=cancelled`
    : `${baseUrl}/admin/clients/${opts.clientUserId}?pack=cancelled`

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = opts.stripePriceId
    ? [{ price: opts.stripePriceId, quantity: 1 }]
    : [
        {
          price_data: {
            currency: "usd",
            product_data: { name: opts.name },
            unit_amount: opts.priceCents,
          },
          quantity: 1,
        },
      ]

  // Pin checkout to the PAYER's email/customer so the payment page is
  // addressed to whoever actually pays — without pinning, Stripe Link
  // autofills whichever account lives in the browser that opens the link
  // (the coach's own card/email when he previews it).
  //
  // Addressee precedence: explicit per-pack override (billToEmail) →
  // household payer → the client themselves. The pack is still FOR the
  // trainee — metadata.clientUserId below is unchanged and is what the
  // webhook credits. Only the addressee (and now, card capture) changes.
  //
  // Addressee + card capture. Stripe rejects `customer` and `customer_email`
  // together, so this is a branch, not a merge:
  //
  //   explicit billToEmail  → customer_email, NO card saved. The payer has no
  //                           users row, and saving their card against the
  //                           trainee's user_id would assert a card belongs to
  //                           someone who does not own it — which
  //                           getDefaultPaymentMethod would then charge for
  //                           unrelated fees. They keep using payment links.
  //   otherwise             → resolve the household payer (or the client) and
  //                           attach their customer. `setup_future_usage` is
  //                           gated on `opts.autoRenew` too, not just having a
  //                           customer: a client who leaves the checkbox
  //                           unchecked has declined card saving, and packs
  //                           are shareable payment links, so attaching a
  //                           customer alone (needed for the addressee fix)
  //                           must not silently opt anyone into having their
  //                           card promoted to the payer's default.
  //
  // Do not collapse this back into customer_email-for-everyone: that pinning
  // exists because a parent once opened a link and found the athlete's email
  // locked in (Stripe makes a provided customer_email read-only), so the
  // receipt landed in the wrong inbox. Reintroducing it now would be worse —
  // the saved card would also attach to the wrong person and auto-renewal
  // would charge them.
  let customerEmail: string | undefined
  let customerId: string | undefined
  // Stamped into metadata below so the webhook can save the card against
  // THIS identity directly instead of re-resolving resolveBillingUserId on
  // its own — re-resolving is a TOCTOU (the household-payer link can change
  // between checkout creation and webhook delivery) and resolveBillingUserId
  // fails OPEN to self on any lookup error, which would silently re-home a
  // stranger's card under the trainee's user_id.
  let resolvedBillingUserId: string | undefined
  if (opts.billToEmail) {
    customerEmail = opts.billToEmail
  } else {
    let billingUserId: string | undefined
    let payer: { email: string | null } | null = null
    try {
      billingUserId = await resolveBillingUserId(opts.clientUserId)
      payer = await getUserById(billingUserId)
      resolvedBillingUserId = billingUserId
    } catch {
      // Non-fatal — checkout still works, just without a pinned addressee.
    }
    if (billingUserId && payer?.email) {
      try {
        customerId = await getOrCreateStripeCustomer(billingUserId, payer.email)
      } catch {
        // Customer creation/lookup failed specifically (not the payer lookup
        // above) — we DO know the payer's email at this point, so fall back
        // to pinning it directly rather than leaving the checkout page fully
        // unaddressed, which would re-expose the Stripe Link autofill hazard
        // this whole mechanism exists to avoid.
        customerEmail = payer.email
      }
    }
  }

  // I5: card_on_file_enabled is the spec's documented kill switch for card
  // CAPTURE — separate from pack_auto_renew_enabled, which only gates the
  // later CHARGE. Before this, `opts.autoRenew` alone controlled
  // setup_future_usage, so there was no way to stop new cards from attaching
  // without also touching the auto-renew flag. Behaviourally a no-op today
  // (card_on_file_enabled defaults true in production) — this is insurance
  // for if cards ever start attaching to the wrong customers.
  const captureCard = opts.autoRenew && (await cardOnFileEnabled())

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    ...(customerId ? { customer: customerId } : {}),
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    ...(customerId && captureCard ? { payment_intent_data: { setup_future_usage: "off_session" as const } } : {}),
    metadata: {
      type: "session_pack",
      clientUserId: opts.clientUserId,
      productId: opts.productId ?? "",
      credits: String(opts.credits),
      validityDays: opts.validityDays == null ? "" : String(opts.validityDays),
      sessionType: opts.sessionType,
      priceCents: String(opts.priceCents),
      autoRenew: opts.autoRenew ? "true" : "false",
      billingUserId: resolvedBillingUserId ?? "",
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })
}

// ─── Card-on-file: save a card via hosted setup-mode Checkout ────────────────

/** Hosted setup Checkout to collect + save a card for later off-session charges. */
export async function createSetupCheckoutSession(opts: {
  customerId: string
  userId: string
  returnUrl?: string
  cancelUrl?: string
}): Promise<Stripe.Checkout.Session> {
  const baseUrl = getBaseUrl()
  return stripe.checkout.sessions.create({
    mode: "setup",
    // Setup mode has no line items to infer currency from, so Stripe requires it explicitly.
    currency: "usd",
    customer: opts.customerId,
    metadata: { type: "save_card", userId: opts.userId },
    success_url: `${baseUrl}${opts.returnUrl ?? `/admin/clients/${opts.userId}`}?card=saved`,
    cancel_url: `${baseUrl}${opts.cancelUrl ?? `/admin/clients/${opts.userId}`}?card=cancelled`,
  })
}

/** Resolve the saved card (payment-method id + display bits) from a completed setup session. */
export async function retrieveSetupCard(session: Stripe.Checkout.Session): Promise<{
  paymentMethodId: string
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
} | null> {
  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id
  if (!setupIntentId) return null
  const si = await stripe.setupIntents.retrieve(setupIntentId)
  const pmId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id
  if (!pmId) return null
  const pm = await stripe.paymentMethods.retrieve(pmId)
  return {
    paymentMethodId: pmId,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
  }
}

/**
 * Charge a saved card OFF-SESSION for an ad-hoc amount (no-show / late-cancel
 * fees). Real money — only ever called from the fee service, guarded by flag +
 * configured amount + a saved default card. Returns a typed failure instead of
 * throwing on a decline.
 */
export async function chargeSavedCard(opts: {
  customerId: string
  paymentMethodId: string
  amountCents: number
  description: string
  idempotencyKey: string
}): Promise<{ ok: true; paymentIntentId: string } | { ok: false; reason: "declined" | "error"; message: string }> {
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: opts.amountCents,
        currency: "usd",
        customer: opts.customerId,
        payment_method: opts.paymentMethodId,
        off_session: true,
        confirm: true,
        description: opts.description,
      },
      { idempotencyKey: opts.idempotencyKey },
    )
    return { ok: true, paymentIntentId: pi.id }
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string }
    const declined = e.type === "StripeCardError" || e.code === "card_declined"
    return { ok: false, reason: declined ? "declined" : "error", message: e.message ?? "charge failed" }
  }
}

// ─── Session membership: recurring "auto-withdrawal" subscription ────────────

/** Subscription-mode Checkout for an in-person membership plan. metadata.type =
 *  "session_membership" (on both the session and the subscription) routes the
 *  webhook to client_memberships. Uses a pre-made price when present, else an
 *  inline recurring price. */
export async function createMembershipCheckoutSession(opts: {
  customerId: string
  userId: string
  plan: { id: string; name: string; price_cents: number; billing_interval: "week" | "month"; stripe_price_id?: string | null }
  returnUrl?: string
  cancelUrl?: string
}): Promise<Stripe.Checkout.Session> {
  const baseUrl = getBaseUrl()
  const meta = { type: "session_membership", planId: opts.plan.id, userId: opts.userId }
  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = opts.plan.stripe_price_id
    ? [{ price: opts.plan.stripe_price_id, quantity: 1 }]
    : [
        {
          price_data: {
            currency: "usd",
            product_data: { name: opts.plan.name },
            unit_amount: opts.plan.price_cents,
            recurring: { interval: opts.plan.billing_interval },
          },
          quantity: 1,
        },
      ]
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: opts.customerId,
    line_items,
    metadata: meta,
    subscription_data: { metadata: meta },
    success_url: `${baseUrl}${opts.returnUrl ?? `/admin/clients/${opts.userId}`}?membership=active`,
    cancel_url: `${baseUrl}${opts.cancelUrl ?? `/admin/clients/${opts.userId}`}?membership=cancelled`,
  })
}

/**
 * An anonymous purchase of a program from a published funnel page.
 *
 * `customer_email` IS PINNED to the address the visitor gave us, and that is
 * load-bearing rather than a convenience. The webhook finds-or-creates the
 * buyer's account BY EMAIL, so letting Stripe collect a different one would
 * grant the program to an account the buyer never sees — and would split a
 * returning customer's history across two logins, which §5.2 of the spec exists
 * to prevent. Same reasoning as the pack payment links, which pin it too.
 *
 * `metadata.type` is what routes this to its own webhook branch. WITHOUT IT the
 * session falls through to `handleOneTimeCheckout`, which — finding a programId
 * and no userId — records it as an "External Stripe checkout" and grants
 * nothing. That is a silent no-delivery, not an error.
 */
export async function createFunnelProgramCheckoutSession(opts: {
  program: Program
  buyerEmail: string
  funnelId: string
  stepId: string
  leadId: string | null
  successUrl: string
  cancelUrl: string
  tracking?: CheckoutTrackingParams
}): Promise<Stripe.Checkout.Session> {
  if (opts.program.price_cents == null || opts.program.price_cents <= 0) {
    throw new Error("Cannot create checkout: program has no price")
  }
  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: opts.program.name,
            description: opts.program.description ?? undefined,
          },
          unit_amount: opts.program.price_cents,
        },
        quantity: 1,
      },
    ],
    customer_email: opts.buyerEmail,
    metadata: {
      type: "funnel_purchase",
      productKind: "program",
      productId: opts.program.id,
      funnelId: opts.funnelId,
      stepId: opts.stepId,
      // Stripe metadata values must be strings; an absent lead is "" rather
      // than the string "null", which would later read as a real id.
      leadId: opts.leadId ?? "",
      ...buildTrackingMetadata(opts.tracking),
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  })
}
