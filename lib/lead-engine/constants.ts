// The one business that exists today. Every Lead Engine row carries it, so a
// second business can be added later without rewriting what is already stored.
export const SINGLETON_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

/**
 * `payments.metadata.type` values that are money moving through this
 * business but are NOT evidence of a coaching deal — a `payments` row that
 * must never be read as "this contact's coaching card should move".
 *
 * Originally the reconciler's own precondition (lib/automation/pipeline-reconcile.ts,
 * final review Critical 1) against replaying every succeeded payment
 * unconditionally: subscription renewals write `payments` rows with no
 * `type` key at all, and pack auto-renewals write `type: "session_pack"` —
 * neither is a checkout, and a denylist keyed on "coaching" would have to
 * enumerate both correctly or fabricate a Won card the hour the reconciler
 * is switched on. Confirmed by grepping every `createPayment(...)` call site
 * in the repo (`grep -rn "createPayment(" app lib functions`), not guessed:
 *   - "event_signup" — a ticket, not a coaching deal (recordEventSignupPayment,
 *     app/api/stripe/webhook/route.ts).
 *   - "session_fee" — a no-show / late-cancellation PENALTY charged to an
 *     existing client (lib/services/session-fees.ts). Money moved, but it is
 *     not evidence of a deal.
 *
 * Now shared by a THIRD consumer for the identical reason: the `charge.refunded`
 * pipeline hook (app/api/stripe/webhook/route.ts) resolves a contact off the
 * SAME `payments` row and must not let an event-ticket or no-show-fee refund
 * subtract from an unrelated coaching Won card's `value_cents` just because
 * the same contact happens to have one. One set, not three copies that can
 * silently drift apart.
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
export const NON_COACHING_PAYMENT_TYPES = new Set(["event_signup", "session_fee"])
