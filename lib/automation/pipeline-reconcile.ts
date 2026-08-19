// lib/automation/pipeline-reconcile.ts — the IO shell that repairs pipeline
// board completeness when a webhook writes its row (booking/payment) but
// throws before it ever calls applyPipelineEvent. Both webhooks
// (app/api/webhooks/ghl-booking/route.ts, app/api/stripe/webhook/route.ts)
// wrap that call in a try/catch specifically so a hook failure never fails
// the underlying webhook response — the accepted cost is a card that
// silently never appears, and the only symptom is a deal missing from a
// board nobody audits.
//
// This scans a bounded recent window and replays the same two kinds of
// event the webhooks send, through the SAME decideMove state machine
// (lib/lead-engine/pipeline-move.ts) via applyPipelineEvent
// (lib/db/pipeline.ts). This file invents no movement rule of its own —
// every write here is a write applyPipelineEvent decided to make.
//
// Spec: docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md §6

import { getBookingsForPipelineReconcile } from "@/lib/db/bookings"
import { getSucceededPaymentsForPipelineReconcile } from "@/lib/db/payments"
import { findContactByIdentifiers } from "@/lib/db/contacts"
import { applyPipelineEvent, listReconciledSourceIds, DEFAULT_PIPELINE_KEY } from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

/**
 * Fix round 1, Finding 2. `payments` covers every product this business
 * sells, not just coaching consults — replaying every `succeeded` row
 * unconditionally would spawn a phantom Won card for anyone who ever paid
 * for anything (decideMove creates a brand-new Won deal when a payment
 * arrives for a contact with no opportunity at all — see §2.1). This is
 * every `payments.metadata.type` this codebase's `createPayment` call sites
 * write that is NOT a coaching sale, confirmed by reading every
 * `createPayment(...)` call in the repo (`grep -rn "createPayment(" app lib
 * functions`), not guessed:
 *   - "event_signup" — a ticket, not a coaching deal (recordEventSignupPayment,
 *     app/api/stripe/webhook/route.ts).
 *   - "session_fee" — a no-show / late-cancellation PENALTY charged to an
 *     existing client (lib/services/session-fees.ts). Money moved, but it is
 *     not evidence of a deal — replaying it unconditionally would create a
 *     phantom Won card valued at a $25-50 fee for a contact who may never
 *     have had a real opportunity at all.
 *
 * "shop_order" and "save_card" (excluded on the STRIPE WEBHOOK's own
 * `session.metadata.type` in app/api/stripe/webhook/route.ts, a different
 * value space keyed on the CHECKOUT SESSION, not the payment row) do NOT
 * need an entry here: `handleShopOrderCheckout` records its sale in
 * `shop_orders`, never `payments`, and `handleSaveCardCheckout` writes no
 * payment row at all (no money moves on a card-on-file setup). Confirmed by
 * grepping both handlers for `createPayment`/`.from("payments")` — neither
 * appears. If either of those write paths ever changes to insert into
 * `payments`, add its type here.
 *
 * Every other `payments.metadata.type` this repo writes ("session_pack",
 * or no `type` key at all — program purchases, subscription renewals, week
 * access, funnel purchases) is a real coaching sale and is replayed
 * unconditionally, exactly like the booking loop below: an explicit
 * exclusion list, not an inclusion list, so a new coaching payment type that
 * forgets to set an exclusion tag still wins its card rather than silently
 * going missing.
 */
const NON_COACHING_PAYMENT_TYPES = new Set(["event_signup", "session_fee"])

/**
 * How far back the reconciler looks for bookings/payments to repair. Named
 * per the "no bare literal scan windows" constraint — a bug fix that widens
 * or narrows the net changes one number, not a search-and-replace.
 */
export const PIPELINE_RECONCILE_WINDOW_DAYS = 30

const DAY_MS = 86_400_000

export type PipelineReconcileSummary = {
  createdFromBookings: number
  wonFromPayments: number
  scanned: number
}

/**
 * Scans the last `PIPELINE_RECONCILE_WINDOW_DAYS` for two repair cases and
 * fixes them, both replayed through `applyPipelineEvent` UNCONDITIONALLY
 * (fix round 1, Finding 2 — bookings and payments are now handled the same
 * way): decideMove alone decides create / advance / refuse / noop / close
 * for every row, including the human-close suppression guard
 * (`REBOOKING_SUPPRESSION_DAYS` in lib/lead-engine/pipeline-move.ts) —
 * reusing it here, rather than re-deriving "does this contact already have
 * a card" as a local filter, is what lets a suppressed rebooking correctly
 * stay refused instead of silently resurrecting a deal a human closed.
 *
 * 1. Bookings (`scheduled`/`completed`).
 * 2. Payments (`succeeded`), EXCLUDING `NON_COACHING_PAYMENT_TYPES` — the
 *    one place this file makes its own eligibility decision, and it is a
 *    data-scoping decision (which rows are this board's business at all —
 *    see that constant's comment), never a movement rule. Everything else
 *    succeeded pays for is replayed unconditionally, so a dropped webhook
 *    for a genuine coaching sale with no prior booking (previously
 *    unrepairable — the old "must already have an open card" filter closed
 *    exactly this hole) now gets a Won card the same way a brand-new
 *    checkout would.
 *
 * Idempotency: every write is tagged with `{ booking_id }` / `{ payment_id }`
 * in `opportunity_stage_events.metadata` (via `applyPipelineEvent`'s
 * `metadata` input), and `listReconciledSourceIds` reads that ledger back
 * before this pass touches anything. A source id already present there is
 * skipped outright — this is what stops a suppressed-rebooking refusal (or
 * any other non-`noop` decision) from being re-written every single hourly
 * pass for as long as the source row stays inside the scan window. The
 * partial unique index on open opportunities is the backstop underneath
 * this, not the primary mechanism — see the reconciler test file for the
 * mutation that proves the metadata check is load-bearing, not redundant.
 * That ledger read is itself bounded to the same window (fix round 1,
 * Finding 3) — see `listReconciledSourceIds`'s own doc comment.
 */
export async function runPipelineReconcile(): Promise<PipelineReconcileSummary> {
  const businessId = SINGLETON_BUSINESS_ID
  const pipelineKey = DEFAULT_PIPELINE_KEY
  const since = new Date(Date.now() - PIPELINE_RECONCILE_WINDOW_DAYS * DAY_MS).toISOString()

  const [bookings, payments, processed] = await Promise.all([
    getBookingsForPipelineReconcile(["scheduled", "completed"], since),
    getSucceededPaymentsForPipelineReconcile(since),
    listReconciledSourceIds(since, businessId),
  ])

  let createdFromBookings = 0
  let wonFromPayments = 0

  for (const booking of bookings) {
    if (!booking.id || processed.bookingIds.has(booking.id)) continue

    const contactId = await findContactByIdentifiers({
      email: booking.contact_email,
      phone: booking.contact_phone,
      businessId,
    })
    if (!contactId) continue

    const { decision } = await applyPipelineEvent({
      contactId,
      pipelineKey,
      businessId,
      source: "reconciler",
      event: {
        kind: "booking",
        status: booking.status as "scheduled" | "completed",
        occurredAt: new Date(booking.created_at),
      },
      metadata: { booking_id: booking.id },
    })
    if (decision.kind === "create") createdFromBookings += 1
  }

  for (const payment of payments) {
    if (!payment.id || processed.paymentIds.has(payment.id)) continue

    const paymentType = payment.metadata?.type
    if (typeof paymentType === "string" && NON_COACHING_PAYMENT_TYPES.has(paymentType)) continue

    const contactId = await findContactByIdentifiers({ userId: payment.user_id, businessId })
    if (!contactId) continue

    const { decision } = await applyPipelineEvent({
      contactId,
      pipelineKey,
      businessId,
      source: "reconciler",
      event: {
        kind: "payment",
        amountCents: payment.amount_cents,
        currency: payment.currency,
        occurredAt: new Date(payment.created_at),
      },
      metadata: { payment_id: payment.id },
    })
    // Covers both repair shapes: an OPEN card closing to Won (`close`), and a
    // brand-new card created straight into Won because the contact had no
    // opportunity at all (`create` — the hole Finding 2 closed). Narrowed by
    // `kind` first — "advance"/"refuse"/"noop" carry no `outcome` field at
    // all, so `decision.outcome` is not valid on the union without this.
    if ((decision.kind === "create" || decision.kind === "close") && decision.outcome === "won") {
      wonFromPayments += 1
    }
  }

  return { createdFromBookings, wonFromPayments, scanned: bookings.length + payments.length }
}
