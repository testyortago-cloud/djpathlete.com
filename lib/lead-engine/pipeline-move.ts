// Pure decision core for the Lead Engine pipeline board.
//
// This module must import NOTHING but types — no `@/lib/supabase`, no DAL, no
// I/O. That purity is what lets its tests run with zero mocks, the same
// contract as lib/automation/sequence-tick.ts. The impure caller
// (lib/db/pipeline.ts) performs the writes this function describes.
//
// Spec: docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md §4

export type StageKind = "open" | "won" | "lost"
// "merge" is written by migration 00220's contested-opportunity CTE in
// merge_contacts (closed_trigger='merge' on the merge-losing card) — not
// produced by decideMove itself, but a real value this app must be able to
// read back (readMostRecentOpportunity carries closed_trigger straight
// through). Omitting it here was a type lie: the CHECK constraint on
// opportunities.closed_trigger already allows it and 00220 already writes
// it (final review, Minor).
export type MoveTrigger = "booking" | "payment" | "manual" | "reconciler" | "merge"
export type Staleness = "fresh" | "amber" | "red"

export type StageRow = {
  id: string
  key: string
  // The human-facing label ("Consult Booked"). The state machine keys on
  // `kind`, never on this or on `key` — see the schema comment in migration
  // 00219 — so a business renaming a stage changes only what gets displayed.
  name: string
  position: number
  kind: StageKind
  amber_after_days: number | null
  red_after_days: number | null
}

/** The most recent opportunity for a (contact, pipeline) — open OR closed. */
export type OpportunityState = {
  id: string
  stage_id: string
  stage_position: number
  stage_kind: StageKind
  entered_stage_at: string
  outcome: "won" | "lost" | null
  closed_trigger: MoveTrigger | null
  closed_at: string | null
  value_cents: number | null
}

export type MoveContext = {
  now: Date
  stages: StageRow[]
  current: OpportunityState | null
  /**
   * Highest `amount_refunded` (Stripe cents) the impure caller has already
   * recorded against the charge behind an incoming `refund` event — read
   * from the `opportunity_stage_events` metadata ledger. Ignored for every
   * other event kind.
   *
   * Stripe's `charge.amount_refunded` is CUMULATIVE per charge: a second,
   * later partial refund on the same charge reports the running total, not
   * just the new increment. Without this baseline, re-applying that
   * cumulative figure a second time would double-subtract cents a prior
   * delivery already took off — the highest-risk failure mode for refunds
   * (spec §14): it silently understates revenue. Defaults to 0 (no refund
   * recorded yet for this charge).
   */
  previouslyRefundedCents?: number
}

export type PipelineEvent =
  | { kind: "booking"; status: "scheduled" | "completed" | "cancelled" | "no_show"; occurredAt: Date }
  | { kind: "payment"; amountCents: number; currency: string; occurredAt: Date }
  // Spec §14: a refund reopens nothing — the card stays Won. `amountRefundedCents`
  // is Stripe's `charge.amount_refunded` verbatim (the cumulative total for the
  // charge), not an incremental delta; `decideMove` computes the delta itself
  // against `MoveContext.previouslyRefundedCents`.
  | { kind: "refund"; amountRefundedCents: number; occurredAt: Date }

export type MoveDecision =
  | { kind: "create"; toStageKey: string; trigger: MoveTrigger; outcome?: "won" | "lost"; valueCents?: number; currency?: string; reason?: string }
  | { kind: "advance"; toStageKey: string; trigger: MoveTrigger }
  | { kind: "close"; outcome: "won" | "lost"; toStageKey: string; reason: string; trigger: MoveTrigger; valueCents?: number; currency?: string }
  // No stage change — the card stays exactly where it is (Won). Only
  // value_cents/outcome_reason are amended. Spec §14.
  | { kind: "amend"; valueCents: number; outcomeReason: "refunded" | "partially_refunded"; trigger: MoveTrigger }
  | { kind: "refuse"; reason: string }
  | { kind: "noop"; reason: string }

/**
 * How long a human's Lost suppresses a brand-new card for the same contact.
 *
 * Without this, spec §2.4 has a side door: the unique index only constrains
 * OPEN opportunities, so a lead someone ruled out could book again and arrive
 * as a fresh card — back in the working set by another route. Stated default,
 * not a derived number; spec §13 lists it for confirmation.
 */
export const REBOOKING_SUPPRESSION_DAYS = 30

const DAY_MS = 86_400_000

function firstOpenStage(stages: StageRow[]): StageRow {
  const open = stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)
  if (!open.length) throw new Error("pipeline has no open stage")
  return open[0]
}

function stageOfKind(stages: StageRow[], kind: StageKind): StageRow {
  const s = stages.find((x) => x.kind === kind)
  if (!s) throw new Error(`pipeline has no ${kind} stage`)
  return s
}

/** Target stage for a booking status, or null when the status does not advance. */
function bookingTarget(stages: StageRow[], status: string): StageRow | null {
  if (status === "scheduled") return firstOpenStage(stages)
  if (status === "completed") {
    // The second open stage if configured, else the only one.
    const open = stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)
    return open[1] ?? open[0]
  }
  return null
}

export function decideMove(ctx: MoveContext, event: PipelineEvent): MoveDecision {
  const { current, stages, now } = ctx

  // A close made by a person is final. A close made by the system is a guess and
  // stays correctable — a no-show who later pays becomes Won. Note this reads
  // closed_trigger, never closed_by_user_id: see the schema comment in 00219.
  const humanClosed = current?.outcome != null && current.closed_trigger === "manual"

  if (event.kind === "payment") {
    if (humanClosed) return { kind: "refuse", reason: "human_close_is_final" }
    const won = stageOfKind(stages, "won")
    if (!current) {
      return {
        kind: "create", toStageKey: won.key, trigger: "payment",
        outcome: "won", valueCents: event.amountCents, currency: event.currency,
      }
    }
    if (current.outcome === "won") return { kind: "noop", reason: "already_won" }
    return {
      kind: "close", outcome: "won", toStageKey: won.key, reason: "payment_received",
      trigger: "payment", valueCents: event.amountCents, currency: event.currency,
    }
  }

  if (event.kind === "refund") {
    // A refund reopens nothing (spec §14) — it only ever amends a card that
    // is ALREADY Won. This is deliberately not the same "current" resolution
    // as booking/payment events: the impure caller looks up the contact's
    // most recent WON opportunity specifically, not whatever is merely most
    // recent (which could be a newer open card from a since-suppressed
    // re-booking window having lapsed).
    if (!current || current.outcome !== "won") return { kind: "noop", reason: "no_won_opportunity" }

    const alreadyRefunded = ctx.previouslyRefundedCents ?? 0
    const delta = event.amountRefundedCents - alreadyRefunded
    // Idempotency: a redelivery of the same webhook event reports the same
    // (or, if stale, a lower) cumulative amount_refunded — nothing new came
    // back since the last delivery this app already applied. Subtracting
    // again here is exactly the double-subtract bug this guard exists to
    // prevent.
    if (delta <= 0) return { kind: "noop", reason: "refund_already_applied" }

    const priorValue = current.value_cents ?? 0
    const valueCents = Math.max(0, priorValue - delta)
    const outcomeReason = valueCents === 0 ? "refunded" : "partially_refunded"
    return { kind: "amend", valueCents, outcomeReason, trigger: "payment" }
  }

  // --- booking ---
  if (event.status === "cancelled" || event.status === "no_show") {
    if (!current || current.outcome != null) return { kind: "noop", reason: "no_open_deal" }
    return {
      kind: "close", outcome: "lost", toStageKey: stageOfKind(stages, "lost").key,
      reason: event.status === "no_show" ? "booking_no_show" : "booking_cancelled",
      trigger: "booking",
    }
  }

  const target = bookingTarget(stages, event.status)
  if (!target) return { kind: "noop", reason: "booking_status_does_not_move" }

  if (!current) return { kind: "create", toStageKey: target.key, trigger: "booking" }

  if (current.outcome != null) {
    // Closed. A new booking is a new deal — unless a human recently ruled them
    // out, in which case the side door stays shut.
    if (humanClosed && current.outcome === "lost" && current.closed_at) {
      const age = now.getTime() - new Date(current.closed_at).getTime()
      if (age < REBOOKING_SUPPRESSION_DAYS * DAY_MS) {
        return { kind: "refuse", reason: "suppressed_after_manual_lost" }
      }
    }
    return { kind: "create", toStageKey: target.key, trigger: "booking" }
  }

  // Open. Forward only — a late booking.scheduled must not drag a Consulted card
  // backwards.
  if (target.position <= current.stage_position) {
    return { kind: "noop", reason: "would_move_backwards" }
  }
  return { kind: "advance", toStageKey: target.key, trigger: "booking" }
}

/**
 * Staleness is computed at read time and NEVER stored (spec §8) — a stored flag
 * is wrong the moment the clock moves and needs a job to keep true.
 */
export function stalenessOf(stage: StageRow, enteredStageAt: string, now: Date): Staleness {
  if (stage.kind !== "open") return "fresh"
  const days = Math.floor((now.getTime() - new Date(enteredStageAt).getTime()) / DAY_MS)
  if (stage.red_after_days != null && days >= stage.red_after_days) return "red"
  if (stage.amber_after_days != null && days >= stage.amber_after_days) return "amber"
  return "fresh"
}
