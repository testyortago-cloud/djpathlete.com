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
import {
  applyPipelineEvent,
  resolvePipeline,
  readMostRecentOpportunity,
  listReconciledSourceIds,
  DEFAULT_PIPELINE_KEY,
} from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

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
 * fixes them:
 *
 * 1. Bookings (`scheduled`/`completed`) — replayed through
 *    `applyPipelineEvent` exactly like the ghl-booking webhook would,
 *    unconditionally. No local eligibility rule beyond "not already
 *    handled" (the metadata check below): decideMove alone decides create /
 *    advance / refuse / noop for every row, including the human-close
 *    suppression guard (`REBOOKING_SUPPRESSION_DAYS` in
 *    lib/lead-engine/pipeline-move.ts) — reusing it here, rather than
 *    re-deriving "does this contact already have a card" as a local filter,
 *    is what lets a suppressed rebooking correctly stay refused instead of
 *    silently resurrecting a deal a human closed.
 *
 * 2. Payments (`succeeded`) — NOT replayed unconditionally. `payments`
 *    covers every product this business sells (program purchases,
 *    session-credit top-ups, subscription renewals), not just coaching
 *    consults, so most rows have nothing to do with this board. Replaying
 *    every one through decideMove would spawn a phantom Won card for every
 *    contact who ever paid for anything. So this path pre-checks "does the
 *    contact currently have an OPEN card" before ever calling
 *    applyPipelineEvent — the one place this file makes its own eligibility
 *    decision, and it is a data-scoping decision (which rows are this
 *    board's business at all), never a movement rule.
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
 */
export async function runPipelineReconcile(): Promise<PipelineReconcileSummary> {
  const businessId = SINGLETON_BUSINESS_ID
  const pipelineKey = DEFAULT_PIPELINE_KEY
  const since = new Date(Date.now() - PIPELINE_RECONCILE_WINDOW_DAYS * DAY_MS).toISOString()

  const [bookings, payments, processed] = await Promise.all([
    getBookingsForPipelineReconcile(["scheduled", "completed"], since),
    getSucceededPaymentsForPipelineReconcile(since),
    listReconciledSourceIds(businessId),
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

  if (payments.length > 0) {
    const { pipelineId, stages } = await resolvePipeline(pipelineKey, businessId)

    for (const payment of payments) {
      if (!payment.id || processed.paymentIds.has(payment.id)) continue

      const contactId = await findContactByIdentifiers({ userId: payment.user_id, businessId })
      if (!contactId) continue

      const current = await readMostRecentOpportunity(contactId, pipelineId, stages, businessId)
      if (!current || current.outcome !== null) continue // not mid-pipeline — out of scope, see header

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
      if (decision.kind === "close" && decision.outcome === "won") wonFromPayments += 1
    }
  }

  return { createdFromBookings, wonFromPayments, scanned: bookings.length + payments.length }
}
