// lib/funnels/checkout/flag.ts — the one name for the anonymous-checkout gate.
//
// A LEAF WITH NO IMPORTS, AND THAT IS THE WHOLE POINT. This constant is needed
// by both `app/api/funnels/checkout/route.ts` and the Stripe webhook, and the
// first version had the webhook import it FROM the route. That compiles, and it
// drags the entire route module — Stripe's SDK, the Supabase client, the funnel
// and program DALs — into the webhook's module graph. It showed up as five
// unrelated Stripe webhook tests timing out the moment this one joined them,
// because those files mock what the WEBHOOK needs and had no reason to mock a
// route they had never heard of.
//
// A route file should export handlers and Next's own config, nothing else.
export const FUNNEL_CHECKOUT_FLAG = "funnel_anonymous_checkout_enabled"

/**
 * DEFAULT FALSE, always passed explicitly at every call site so the default
 * cannot drift between the route and the webhook. This is money AND mass email:
 * it stays off until it is deliberately switched on.
 */
export const FUNNEL_CHECKOUT_DEFAULT = false
