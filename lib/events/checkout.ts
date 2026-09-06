// lib/events/checkout.ts — event signup + Stripe session, for every caller.
//
// ---------------------------------------------------------------------------
// EXTRACTED SO THERE IS ONE COPY, NOT TWO.
// ---------------------------------------------------------------------------
// The capacity refusal, the waiver-evidence write and the Stripe session were the
// body of `/api/events/[id]/checkout`. A funnel's Register form now needs exactly
// the same sequence, and the two halves that would drift if it were restated are
// the LEGAL GATE and the MONEY. `prompt.ts` counts three bugs this repo has
// already shipped from restating something instead of importing it.
//
// RETURNS OUTCOMES, NEVER `Response`S, and never throws for an expected failure.
// Its two callers answer to different clients — an event page's modal and a
// funnel form — and each maps a status onto its own copy. A helper that returned
// a `NextResponse` would decide the wording for both, and a helper that threw
// would make "the camp is full" indistinguishable from a bug.
//
// WHAT IS DELIBERATELY NOT IN HERE: validation. The caller parses with
// `createEventSignupSchema` and passes the parsed value, because the caller is
// the only one that knows how to name the offending field to ITS user — a funnel
// form must say "Player's age", which is the owner's label, not "athlete_age".

import { createSignup, type SignupTracking } from "@/lib/db/event-signups"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { createEventCheckoutSession } from "@/lib/stripe"
import { createServiceRoleClient } from "@/lib/supabase"
import type { CreateSignupInput } from "@/lib/validators/event-signups"
import type { Event } from "@/types/database"

export type EventCheckoutOutcome =
  | { ok: true; sessionUrl: string; signupId: string }
  | { ok: false; status: 400 | 409 | 502; error: string }

export interface EventCheckoutArgs {
  event: Event
  /** Already parsed by `createEventSignupSchema`. See the note above. */
  input: CreateSignupInput
  ipAddress: string | null
  userAgent: string | null
  tracking?: SignupTracking
  baseUrl: string
  /**
   * Where Stripe returns the visitor. OMITTED by the event page, which wants the
   * event's own success and cancel pages; supplied by a funnel, which would
   * otherwise strand a paying visitor outside the funnel it just walked them
   * through — its Confirmation step would never be seen.
   */
  returnUrls?: { successUrl: string; cancelUrl: string }
}

/**
 * `businessId` is resolved by the CALLER — a public route resolves it once
 * via `resolvePublicTenant()` (`@/lib/tenancy/public`) and threads it in;
 * this helper does not resolve or default it itself.
 */
export async function createEventSignupCheckout(
  businessId: string,
  args: EventCheckoutArgs,
): Promise<EventCheckoutOutcome> {
  const { event, input, ipAddress, userAgent, tracking, baseUrl, returnUrls } = args

  if (!event.stripe_price_id) {
    return { ok: false, status: 400, error: "This camp is not open for booking yet." }
  }

  // BEFORE the signup is written, not after. A refusal that had already inserted
  // a row would leave a pending signup behind on every attempt, and the next
  // capacity check would count it.
  //
  // `>=` and `signup_count` (confirmed signups only) match the event route: a
  // place is reserved POST-payment by the `confirm_event_signup` RPC, and two
  // buyers racing for the last slot are resolved there, with the loser refunded
  // automatically. So this is the cheap early refusal, not the authority.
  if (event.signup_count >= event.capacity) {
    return { ok: false, status: 409, error: "This camp is full." }
  }

  // The document the visitor is agreeing to, recorded WITH the agreement. A null
  // document is still filed rather than refused — "they accepted, and there was
  // no active document" is a true record, and it is what the event page already
  // does.
  const waiverDoc = await getActiveDocument("liability_waiver")

  // `waiver_accepted` and `sms_consent` are dropped here, not carried:
  // neither has a column on `event_signups` — the waiver's evidence is the
  // fields below, and SMS consent evidence is filed separately as a
  // `contact_consents` row by whichever ROUTE this call came through (see
  // app/api/events/[id]/checkout/route.ts and
  // app/api/events/[id]/signup/route.ts). `CreateSignupDbInput` is
  // `Omit<CreateSignupInput, "waiver_accepted" | "sms_consent">` for exactly
  // that reason.
  const { waiver_accepted: _accepted, sms_consent: _smsConsent, ...signupInput } = input

  const signup = await createSignup(
    businessId,
    event.id,
    signupInput,
    "paid",
    { document_id: waiverDoc?.id ?? null, ip_address: ipAddress, user_agent: userAgent },
    tracking,
  )

  let session
  try {
    session = await createEventCheckoutSession({
      event,
      signup,
      parentEmail: input.parent_email,
      baseUrl,
      tracking,
      ...(returnUrls ?? {}),
    })
  } catch (error) {
    console.error("[events/checkout] Stripe error", error)
    return { ok: false, status: 502, error: "Payment provider unavailable, please try again" }
  }

  // Stripe types `url` as nullable. Handing back `undefined` would send the
  // visitor to the literal string "undefined".
  if (!session.url) {
    console.error("[events/checkout] Stripe returned a session with no url", session.id)
    return { ok: false, status: 502, error: "Payment provider unavailable, please try again" }
  }

  const supabase = createServiceRoleClient()
  await supabase
    .from("event_signups")
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq("id", signup.id)

  return { ok: true, sessionUrl: session.url, signupId: signup.id }
}
