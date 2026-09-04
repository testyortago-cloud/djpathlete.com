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
import { platformBusinessId } from "@/lib/tenancy/platform"

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
 * MULTI-BUSINESS (Task 10, fix round 1): the two source reads are NOT
 * symmetric, because the two tables are not in the same position.
 *
 * - `getBookingsForPipelineReconcile` (lib/db/bookings.ts) IS now scoped by
 *   `business_id` — `bookings` has that column (migration 00240) and this
 *   read is called once per business, inside the loop, with that business's
 *   id. This was a real cross-tenant hole before this fix, not a merely
 *   theoretical one: `findContactByIdentifiers` matches by email/phone
 *   WITHIN a business, and a shared email is the ordinary multi-tenant case
 *   (one person training with two coaches), not an edge case. An unscoped
 *   read let business B's pass see business A's booking, resolve it to B's
 *   contact via the shared email, and write a cross-tenant opportunity into
 *   B's board — proven with a probe before this fix (two businesses, one
 *   shared-email booking → `createdFromBookings: 2`, one opportunity per
 *   business). See the "does not create a cross-tenant opportunity" test
 *   below, which fails without the `.eq("business_id", …)` this read now
 *   has.
 *
 * - `getSucceededPaymentsForPipelineReconcile` (lib/db/payments.ts) is
 *   UNCHANGED and CANNOT be scoped the same way: `payments` has no
 *   `business_id` column at all today. Rather than leave the payments half
 *   exposed to the identical cross-tenant risk, it only ever runs for
 *   `platformBusinessId()` (lib/tenancy/platform.ts) — every other business
 *   in the loop gets an empty payments list and skips that half entirely.
 *   This is correct-by-construction (no business other than the platform's
 *   own can ever win a card off a payment) rather than "probably fine
 *   because the lookup is scoped" — that argument is exactly what failed
 *   for bookings above. The real fix, scoping `payments` by `business_id`,
 *   needs a migration and is out of this task.
 */
export async function runPipelineReconcile(): Promise<PipelineReconcileSummary> {
  const pipelineKey = DEFAULT_PIPELINE_KEY
  const since = new Date(Date.now() - PIPELINE_RECONCILE_WINDOW_DAYS * DAY_MS).toISOString()

  const businesses = await listBusinesses({ activeOnly: true })
  if (businesses.length === 0) {
    throw new Error("[pipeline-reconcile] no active businesses found")
  }

  // payments has no business_id column to scope by — fetched once, and
  // handed to reconcileForBusiness ONLY for the platform business (see the
  // doc comment above). bookings, by contrast, IS scoped and is fetched
  // fresh per business inside the loop below.
  const payments = await getSucceededPaymentsForPipelineReconcile(since)

  let createdFromBookings = 0
  let wonFromPayments = 0
  let failed = 0
  let scanned = 0
  const failures: Array<{ businessId: string; error: string }> = []

  for (const business of businesses) {
    try {
      const bookings = await getBookingsForPipelineReconcile(["scheduled", "completed"], since, business.id)
      const businessPayments = business.id === platformBusinessId() ? payments : []
      const result = await reconcileForBusiness(business.id, pipelineKey, since, bookings, businessPayments)
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
 * used to do directly before Task 10's business loop. `bookings` is already
 * scoped to `businessId` by the caller's `.eq("business_id", …)` read.
 * `payments` is the platform-wide list, handed in only for the platform
 * business and `[]` for every other one (see the doc comment above) — the
 * `payments.length > 0` guard below is what makes that a true no-op for a
 * non-platform business rather than merely an empty loop.
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

