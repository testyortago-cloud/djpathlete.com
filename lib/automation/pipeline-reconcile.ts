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
import { listBusinesses } from "@/lib/db/businesses"
import {
  applyPipelineEvent,
  resolvePipeline,
  readMostRecentOpportunity,
  listReconciledSourceIds,
  DEFAULT_PIPELINE_KEY,
} from "@/lib/db/pipeline"
import { NON_COACHING_PAYMENT_TYPES } from "@/lib/lead-engine/constants"

// Final review, Critical 1 — REVERTS the "replay every succeeded payment
// unconditionally" ruling a prior fix round made. That ruling contradicted
// spec §6 case 2 ("payments... whose contact has an OPEN opportunity → win
// it") and, worse, `decideMove` creates a brand-new WON card when a payment
// arrives for a contact with no opportunity at all. Subscription renewals
// write `payments` rows with no `type` key at all
// (app/api/stripe/webhook/route.ts's handleInvoicePaymentSucceeded) and pack
// auto-renewals write `type: "session_pack"` (lib/services/pack-renewal.ts)
// — NEITHER is a checkout, neither goes through applyPipelineEvent at write
// time, and neither was ever excluded by NON_COACHING_PAYMENT_TYPES. The
// hour the reconciler is switched on, every existing coaching client who
// renewed in the scan window gets a fabricated Won card, valued at one
// renewal, dated today.
//
// The real backstop is the precondition restored below (a payment may only
// WIN a card that already exists and is OPEN — never create one).
// NON_COACHING_PAYMENT_TYPES (lib/lead-engine/constants.ts — shared with the
// charge.refunded pipeline hook, which has the identical problem on the
// refund side) stays as defense-in-depth for the one case the precondition
// alone does NOT cover: a contact who legitimately has an open card and then
// pays a fee or buys a ticket that is not evidence the deal closed.

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
  /**
   * Final review, Important 1: rows that threw (a unique violation, a
   * missing contact, `PipelineNotConfiguredError`, etc.) and were skipped
   * rather than aborting the pass. A non-zero count here is itself a bug
   * signal for the automation-health watchdog — same spirit as a non-zero
   * `trigger='reconciler'` count meaning "a webhook was dropped": it means
   * this pass did not fully repair the board and someone should look at the
   * logged row id.
   */
  failed: number
  /** How many active businesses this tick iterated. */
  businesses: number
  /**
   * Task 10 (multi-coach ops): businesses whose reconcile pass itself threw
   * (e.g. `resolvePipeline` finding no configured board for that business) —
   * isolated here so one business's outage can't take the whole tick down.
   * Only present when non-empty. The route (app/api/admin/internal/
   * pipeline-reconcile/route.ts) reads this to decide the cron_runs status:
   * ONE row per tick, marked `failed` when this is non-empty, naming the
   * businesses. See lastSuccessPerCron (lib/db/cron-runs.ts) — it reads the
   * single most recent SUCCESSFUL row per cron_name, so a row per business
   * would let one succeeding business mask another failing every tick.
   */
  failures?: Array<{ businessId: string; error: string }>
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
 * 2. Payments (`succeeded`) — NOT replayed unconditionally (final review,
 *    Critical 1). `payments` covers every product this business sells
 *    (program purchases, session-credit top-ups, subscription renewals),
 *    not just coaching consults, so most rows have nothing to do with this
 *    board. Replaying every one through decideMove would spawn a phantom
 *    Won card for every contact who ever paid for anything — including
 *    renewals from clients who already converted. So this path pre-checks
 *    "does the contact currently have an OPEN card" before ever calling
 *    applyPipelineEvent, per spec §6 case 2 — the one place this file makes
 *    its own eligibility decision, and it is a data-scoping decision (which
 *    rows are this board's business at all), never a movement rule.
 *
 *    Residual gap, stated plainly rather than left for someone to guess at:
 *    a dropped payment webhook for a FIRST coaching sale with no prior
 *    booking is NOT reconcilable by this pass — the contact has no open
 *    card for the precondition to find, and the reconciler must not invent
 *    one from a bare payment (that is exactly the fabrication Critical 1
 *    closed). That case has no board signal at all other than "the deal is
 *    missing" and must be entered by hand.
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
 * That ledger read is itself bounded to the same window — see
 * `listReconciledSourceIds`'s own doc comment.
 *
 * Fault isolation (final review, Important 1): each row is wrapped in its
 * own try/catch. `applyPipelineEvent` throws on a unique violation, a
 * missing contact, or `PipelineNotConfiguredError` — before this, a single
 * poisoned row aborted the ENTIRE pass, silently repairing nothing for the
 * rest of the 30-day window on every hourly run until someone noticed. A
 * failed row is counted and logged with its source id, never rethrown.
 *
 * MULTI-BUSINESS (Task 10): `getBookingsForPipelineReconcile` and
 * `getSucceededPaymentsForPipelineReconcile` (lib/db/bookings.ts,
 * lib/db/payments.ts) are NOT filtered by business_id — a sweep finding
 * carried forward rather than fixed here (out of this task's file list; the
 * `bookings` table has a `business_id` column but `payments` does not have
 * one at all today, so scoping one and not the other would be half a fix).
 * Every business below reconciles against the SAME platform-wide bookings
 * and payments lists; per-business correctness comes entirely from
 * `findContactByIdentifiers` / `listReconciledSourceIds` being scoped, not
 * from this read being scoped. Fetched once, outside the loop, rather than
 * once per business, to at least avoid N redundant network round-trips.
 * With today's single active business this is exactly the prior behavior;
 * with more than one it means every business re-scans every other
 * business's candidate rows (wasted work, not a correctness bug — a
 * booking/payment belonging to a different business fails
 * `findContactByIdentifiers`'s business-scoped lookup and is skipped).
 */
export async function runPipelineReconcile(): Promise<PipelineReconcileSummary> {
  const pipelineKey = DEFAULT_PIPELINE_KEY
  const since = new Date(Date.now() - PIPELINE_RECONCILE_WINDOW_DAYS * DAY_MS).toISOString()

  const businesses = await listBusinesses({ activeOnly: true })
  if (businesses.length === 0) {
    throw new Error("[pipeline-reconcile] no active businesses found")
  }

  const [bookings, payments] = await Promise.all([
    getBookingsForPipelineReconcile(["scheduled", "completed"], since),
    getSucceededPaymentsForPipelineReconcile(since),
  ])

  let createdFromBookings = 0
  let wonFromPayments = 0
  let failed = 0
  let scanned = 0
  const failures: Array<{ businessId: string; error: string }> = []

  for (const business of businesses) {
    try {
      const result = await reconcileForBusiness(business.id, pipelineKey, since, bookings, payments)
      createdFromBookings += result.createdFromBookings
      wonFromPayments += result.wonFromPayments
      failed += result.failed
      scanned += result.scanned
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ businessId: business.id, error: message })
      console.error(`[pipeline-reconcile] business ${business.id} failed:`, message)
    }
  }

  const summary: PipelineReconcileSummary = {
    createdFromBookings,
    wonFromPayments,
    scanned,
    failed,
    businesses: businesses.length,
  }
  if (failures.length > 0) summary.failures = failures
  return summary
}

/**
 * The per-business reconcile pass — every line of what `runPipelineReconcile`
 * used to do directly before Task 10's business loop. `bookings` and
 * `payments` are the platform-wide candidate lists fetched once by the
 * caller (see the doc comment above); everything else here is scoped to
 * `businessId`.
 */
async function reconcileForBusiness(
  businessId: string,
  pipelineKey: string,
  since: string,
  bookings: Awaited<ReturnType<typeof getBookingsForPipelineReconcile>>,
  payments: Awaited<ReturnType<typeof getSucceededPaymentsForPipelineReconcile>>,
): Promise<Omit<PipelineReconcileSummary, "businesses" | "failures">> {
  const processed = await listReconciledSourceIds(since, businessId)

  let createdFromBookings = 0
  let wonFromPayments = 0
  let failed = 0

  for (const booking of bookings) {
    if (!booking.id || processed.bookingIds.has(booking.id)) continue

    try {
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
    } catch (err) {
      failed += 1
      console.error(`[pipeline-reconcile] booking ${booking.id} failed:`, (err as Error).message)
    }
  }

  if (payments.length > 0) {
    const { pipelineId, stages } = await resolvePipeline(pipelineKey, businessId)

    for (const payment of payments) {
      if (!payment.id || processed.paymentIds.has(payment.id)) continue

      try {
        const paymentType = payment.metadata?.type
        if (typeof paymentType === "string" && NON_COACHING_PAYMENT_TYPES.has(paymentType)) continue

        const contactId = await findContactByIdentifiers({ userId: payment.user_id, businessId })
        if (!contactId) continue

        // Critical 1's restored precondition: only WIN a card that already
        // exists and is OPEN. `current === null` (no deal at all) or
        // `current.outcome !== null` (already closed, won or lost) both
        // fall outside spec §6 case 2's scope — see the residual-gap note
        // above for the first case specifically.
        const current = await readMostRecentOpportunity(contactId, pipelineId, stages, businessId)
        if (!current || current.outcome !== null) continue

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
      } catch (err) {
        failed += 1
        console.error(`[pipeline-reconcile] payment ${payment.id} failed:`, (err as Error).message)
      }
    }
  }

  return { createdFromBookings, wonFromPayments, scanned: bookings.length + payments.length, failed }
}

