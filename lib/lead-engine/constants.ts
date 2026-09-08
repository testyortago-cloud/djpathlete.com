// The one business that exists today. Every Lead Engine row carries it, so a
// second business can be added later without rewriting what is already stored.
export const SINGLETON_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

/**
 * `payments.metadata.type` values that NEVER win, amend, or reconcile a
 * pipeline card, on ANY board — a `payments` row that must never be read as
 * "this contact has a deal (open, closed, or on some other board) that
 * should move".
 *
 * Gap #C1 fix (2026-09-08, whole-branch review Critical): this used to be
 * `NON_COACHING_PAYMENT_TYPES = {"event_signup", "session_fee"}`, answering
 * "is this money moving through the business but NOT evidence of a
 * *coaching* deal". That was a fine question back when only `coaching`
 * existed, but it stopped being the right one the moment `event_signup`
 * started winning its OWN card on `camps_clinics` (Task A, same branch): the
 * old set silently dropped a camp refund before `applyPipelineEvent` ever
 * ran, leaving a refunded registration's `value_cents` on the Won card
 * forever. `event_signup` is therefore NOT a member here any more — its
 * refund must reach `applyPipelineEvent` so `resolveWonPipelineKey`
 * (lib/db/pipeline.ts) can find the camp card, exactly the machinery that
 * function exists for.
 *
 * "session_fee" is the one payment type left, still correctly excluded:
 * it is a no-show / late-cancellation PENALTY charged to an EXISTING client
 * (lib/services/session-fees.ts), real money, but never routed through
 * `applyPipelineEvent` at write time — confirmed, not assumed
 * (`grep -rn "applyPipelineEvent(" app lib` names exactly three payment-kind
 * callers: the Stripe webhook's `checkout.session.completed` handler, the
 * reconciler below, and nothing in session-fees.ts, which is not a Checkout
 * Session at all but an off-session `chargeSavedCard` call). A session-fee
 * payment therefore wins no card anywhere, so its refund must not be allowed
 * to reach `applyPipelineEvent` either — `resolveWonPipelineKey` would
 * happily find an UNRELATED Won card belonging to the same contact's real
 * deal and subtract this refund's amount from `value_cents` it never
 * contributed to in the first place.
 *
 * Two consumers, one set (still — "one set, not copies that can silently
 * drift apart" was the original design and stays true here):
 *   - The `charge.refunded` pipeline hook (app/api/stripe/webhook/route.ts):
 *     gates whether a refund reaches `applyPipelineEvent` at all.
 *   - The pipeline reconciler's payments loop (lib/automation/
 *     pipeline-reconcile.ts): gates whether a succeeded payment is even
 *     considered as evidence toward THIS PASS'S board (`DEFAULT_PIPELINE_KEY`,
 *     "coaching" — the only board it resolves an OPEN-card precondition
 *     for). Unlike the refund hook, this second use does NOT need
 *     "event_signup" in the set to stay safe: that loop's own
 *     `routedPipelineKey !== defaultPipelineKey` guard already exists
 *     specifically to catch any payment type — event_signup included —
 *     whose real board differs from the one this pass reconciles, and
 *     records an honest `failed` count with a reason naming the real board
 *     rather than a silent, mislabelled "not a deal" skip. Reconciling the
 *     camps board itself is a separate gap (C2, no board reader) and out of
 *     scope for this fix. "session_fee" DOES still need to be here for the
 *     reconciler specifically: `routeToPipeline` has no special case for it,
 *     so it falls through to `coaching` — the SAME board this pass
 *     resolves — and would sail past that guard straight into winning an
 *     existing client's genuinely open coaching card for the price of a
 *     no-show fee if it were not excluded up front.
 *
 * Deliberately a DENYLIST, not an allowlist: an unlabelled or newly-added
 * coaching payment type must still be handled, not silently skipped because
 * nobody remembered to add it to an allowlist.
 *
 * "shop_order" and "save_card" (excluded on the STRIPE WEBHOOK's own
 * `session.metadata.type`, a different value space keyed on the CHECKOUT
 * SESSION, not the payment row — see `NON_COACHING_CHECKOUT_TYPES` in
 * app/api/stripe/webhook/route.ts) do NOT need an entry here:
 * `handleShopOrderCheckout` records its sale in `shop_orders`, never
 * `payments`, and `handleSaveCardCheckout` writes no payment row at all (no
 * money moves on a card-on-file setup).
 */
export const NO_PIPELINE_CARD_PAYMENT_TYPES = new Set(["session_fee"])
