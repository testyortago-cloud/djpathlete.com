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
// "sequence" is written by moveOpportunityBySequence (lib/db/pipeline.ts) via
// insertStageEvent — not produced by decideMove, and never as
// closed_trigger, since a sequence step may move a card but never close one
// (migration 00254). It belongs in this union anyway: this type is the
// single source of truth the opportunity_stage_events_trigger_check CHECK is
// tested against, and a value the constraint allows but this union omits is
// the same kind of drift that let 'quiz' ship silently broken.
// "inquiry" is decideMove's trigger for the `inquiry` PipelineEvent kind
// below (gap #8 phase 1.5) — migration 00258 widens the CHECK constraint to
// match, and __tests__/migrations/00258_pipeline_inquiry_trigger.test.ts
// pins the two together the same way 00254's test already does for 'quiz'
// and 'sequence'.
export type MoveTrigger = "booking" | "payment" | "manual" | "reconciler" | "merge" | "quiz" | "sequence" | "inquiry"
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
  /**
   * A completed quiz. `tier` is the tier KEY, and higher scores are better —
   * so `red` is the most urgent, not the least.
   */
  | { kind: "quiz_result"; tier: string; occurredAt: Date }
  /**
   * A person submitting an inquiry form (app/api/inquiry/route.ts). Not a
   * sale — decideMove's inquiry arm only ever opens a card in the first open
   * stage, exactly like quiz_result, and never creates one already Won or
   * Lost. `serviceType` is the submitted `service` field
   * (lib/validators/inquiry.ts's SERVICE_TYPES) — `routeToPipeline` reads it
   * to decide which board, but decideMove itself does not branch on it: by
   * the time an inquiry event reaches decideMove, which board to open the
   * card on has already been decided by the caller (spec §3.2, "however it
   * arrives").
   */
  | { kind: "inquiry"; serviceType: string | null; occurredAt: Date }

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
 * The one board seeded before pipeline boards existed (migration 00219). A
 * stage key, not a brand.
 *
 * Defined HERE rather than in lib/db/pipeline.ts (which re-exports it,
 * unchanged, for every existing importer) because
 * docs/superpowers/specs/2026-09-08-pipeline-boards-and-routing-design.md
 * §3.0 requires a pure `lib/lead-engine/pipeline-route.ts` that names this
 * exact string without redefining it — and lib/db/pipeline.ts is the impure
 * DAL, importing anything from it (even a constant) would pull in
 * `@/lib/supabase` and `@/lib/audit/record` at module load, which is exactly
 * the IO this file's own header forbids. This module already has zero
 * imports and is the one place both the impure DAL and the pure router can
 * import the same string from without either gaining a dependency it isn't
 * allowed to have.
 */
export const DEFAULT_PIPELINE_KEY = "coaching"

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

  // --- quiz_result ---
  //
  // A RED RESULT IS A DEAL; A GREEN ONE IS A NEWSLETTER SUBSCRIBER. Higher
  // scores are better, so Red and Orange are the two that mean "large or real
  // gaps, worth a conversation now". Opening a card on Green would fill the
  // board with athletes who are already well-prepared and bury the ones who
  // are not — the board is a work queue, and a work queue everyone is on is
  // a work queue nobody reads.
  if (event.kind === "quiz_result") {
    if (event.tier !== "red" && event.tier !== "orange") {
      // An unknown tier lands here too, deliberately: a renamed band should
      // stop creating cards, not guess that it might be urgent.
      return { kind: "noop", reason: "quiz_tier_not_actionable" }
    }
    if (current && current.outcome == null) {
      // A live deal is further along than a quiz result can know about. The
      // quiz never drags a Consulted card backwards or re-opens work in flight.
      return { kind: "noop", reason: "already_open" }
    }
    if (current?.outcome != null) {
      // The SAME rule as a re-booking, reused rather than restated: a human
      // who ruled this person out recently does not get overruled by a form.
      if (humanClosed && current.outcome === "lost" && current.closed_at) {
        const age = now.getTime() - new Date(current.closed_at).getTime()
        if (age < REBOOKING_SUPPRESSION_DAYS * DAY_MS) {
          return { kind: "refuse", reason: "suppressed_after_manual_lost" }
        }
      }
    }
    const firstOpen = stages
      .filter((stage) => stage.kind === "open")
      .slice()
      .sort((a, b) => a.position - b.position)[0]
    if (!firstOpen) return { kind: "noop", reason: "no_open_stage" }
    return { kind: "create", toStageKey: firstOpen.key, trigger: "quiz" }
  }

  // --- inquiry ---
  //
  // A person asking is not a sale. Unlike quiz_result, there is no tier gate
  // — every inquiry that reaches decideMove is already worth a card, because
  // the caller only sends one when someone actually submitted the form; the
  // routing DECISION (which board) already happened one layer up
  // (routeToPipeline). What decideMove owns here is the SAME two rules
  // quiz_result already owns, reused rather than restated, because both are
  // the same underlying rule: an unsolicited signal from the person
  // themselves never outranks work already in flight, and never overrules a
  // human's own recent verdict.
  if (event.kind === "inquiry") {
    if (current && current.outcome == null) {
      // A live deal is further along than a fresh inquiry can know about —
      // never drag a card already in motion backwards or re-open it.
      return { kind: "noop", reason: "already_open" }
    }
    if (current?.outcome != null) {
      // The SAME rule as a re-booking/quiz-result, reused rather than
      // restated: a human who ruled this person out recently does not get
      // overruled by a form.
      if (humanClosed && current.outcome === "lost" && current.closed_at) {
        const age = now.getTime() - new Date(current.closed_at).getTime()
        if (age < REBOOKING_SUPPRESSION_DAYS * DAY_MS) {
          return { kind: "refuse", reason: "suppressed_after_manual_lost" }
        }
      }
    }
    const firstOpen = stages
      .filter((stage) => stage.kind === "open")
      .slice()
      .sort((a, b) => a.position - b.position)[0]
    // Never a Won or Lost card — an inquiry with nowhere open to land noops
    // rather than guessing a closed stage.
    if (!firstOpen) return { kind: "noop", reason: "no_open_stage" }
    return { kind: "create", toStageKey: firstOpen.key, trigger: "inquiry" }
  }

  // --- booking ---
  //
  // EXPLICIT ON PURPOSE. Until this guard was added, `booking` was the only
  // kind left once payment/refund/quiz_result had each returned on every
  // path above it, so TypeScript narrowed `event` down to it for free and
  // nothing below ever named the kind it was handling. That was fine right
  // up until a fifth `PipelineEvent` kind was going to be added: widening the
  // union first would have let that new kind fall through to this booking
  // logic silently — `event.status` would be `undefined`, decided against
  // anyway, and shipped as a booking decision for an event that was never a
  // booking. Naming the kind here turns that into a compile error the moment
  // the union grows, at the `_exhaustive` check below, rather than a
  // behaviour bug discovered later.
  if (event.kind === "booking") {
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

  // Exhaustiveness guard. Every `PipelineEvent` kind above returns on every
  // one of its own paths, so by this point `event` can only still be typed
  // as something if a NEW kind was added to the union without its own `if
  // (event.kind === "...")` arm above — the same implicit-fall-through trap
  // the booking comment above describes. Assigning it to `never` makes that
  // a compile error at the moment the union widens, rather than a silent
  // pass through whichever arm happens to be last.
  const _exhaustive: never = event
  throw new Error(`decideMove: unhandled event kind "${(_exhaustive as PipelineEvent).kind}"`)
}

/**
 * The `contact_timeline_events.kind` values that mean THE PERSON DID
 * SOMETHING, as opposed to the engine or an admin recording something about
 * them. Read by `stalenessOf` (G27) to answer "have they gone quiet?".
 *
 * AN ALLOW-LIST, NOT A DENY-LIST, and the direction is the whole safety
 * argument. `contact_timeline_events.kind` is plain `text` with NO check
 * constraint (00214), so a new kind starts being written with no migration and
 * nothing to announce it. With a deny-list, a new ENGINE kind would silently
 * count as the person speaking and hold a genuinely stale card green for ever
 * — reintroducing exactly the bug this measures. With an allow-list, a new
 * PERSON kind is merely not counted yet, so a card goes red while they are in
 * fact talking to us: the coach chases someone who did reply, which is visible
 * and harmless. False red is recoverable; false green is the bug.
 *
 * Production's own row counts show why the split matters rather than being
 * theoretical: of 271 timeline rows, 166 are `ghl_import` and 90 are
 * `sms_repermission_candidate` — 256 rows of bookkeeping that say nothing
 * about whether anyone spoke. Only 12 are real activity.
 *
 * NEGATIVE ACTIONS COUNT. `unsubscribed` and `sms_stop_received` are a person
 * telling us to go away, which is emphatically not silence — this dot measures
 * whether they are RESPONDING, not whether they are keen. A card whose person
 * just texted STOP should not read "stalled for 30 days"; it should read as
 * recent, and go quiet on its own schedule afterwards. Whether a board ought
 * to show "said no" as its own state is a different feature (G29's editor),
 * not something to smuggle in through a staleness dot.
 *
 * BOOKINGS JOINED THIS LIST IN G22, which is the change that gave them a
 * timeline row at all. Until then no booking wrote one — neither the Calendly
 * nor the GHL webhook — so somebody who booked a consult today, whose last
 * form was 30 days ago, showed red on the stage called "Consult Booked".
 *
 * It was deliberately NOT patched around by anchoring on the card's
 * `entered_stage_at` instead (a booking advances the card, so the card moving
 * would have looked like contact). That would have reintroduced the exact bug
 * this measurement exists to remove: a coach DRAGGING a card would make a
 * silent person look fresh again, which is where "gone quiet measured stage
 * age" came from in the first place. `entered_stage_at` moves for two very
 * different reasons and only one of them is evidence of contact.
 *
 * Payments were already covered — the Stripe capture writes `entry_point`.
 */
export const CONTACT_ACTIVITY_KINDS: readonly string[] = [
  // They submitted a form, bought, abandoned a checkout, took the quiz.
  "entry_point",
  // They texted us — a reply, or one of the keywords.
  "sms_inbound",
  "sms_stop_received",
  "sms_start_received",
  "sms_help_received",
  "sms_consent_confirmed",
  // They booked time (G22 gave bookings a timeline row; G27 reserved this
  // line for it). `booking_cancelled` is deliberately NOT here: a cancel can
  // be the coach's doing as easily as theirs, and this list means "the person
  // did something", not "something happened to the booking".
  "booking_scheduled",
  // They asked the chat assistant for a human.
  "chat_escalated",
  // They clicked the unsubscribe link, or the newsletter form's own opt-out.
  "unsubscribed",
]

/**
 * Staleness is computed at read time and NEVER stored (spec §8) — a stored flag
 * is wrong the moment the clock moves and needs a job to keep true.
 *
 * THE TWO COLOURS ANSWER DIFFERENT QUESTIONS, and that is G27's whole change:
 *
 *   - AMBER is stage age: "this step is taking a while". Unchanged.
 *   - RED is silence: "we have not heard from this person". It used to be
 *     stage age too, just a bigger number of it — so a person who replied
 *     yesterday sat in a red card because nobody had dragged it across, and a
 *     person who had said nothing for six weeks looked fine because the card
 *     was moved last Tuesday. The dot is the one thing on the board telling a
 *     coach who to chase, and it was answering a question nobody asked.
 *
 * `lastActivityAt` is the most recent `CONTACT_ACTIVITY_KINDS` timeline row
 * for this contact, or null when there is none. Null falls back to
 * `enteredStageAt` — the card's own arrival is then the only moment on record,
 * and measuring silence from it is exactly the previous behaviour, which is
 * why every pre-G27 test still passes unchanged.
 *
 * The parameter is OPTIONAL so the many callers that have no timeline to hand
 * (and the pure state-machine tests) keep working; supplying nothing is the
 * same as supplying null.
 */
export function stalenessOf(
  stage: StageRow,
  enteredStageAt: string,
  now: Date,
  lastActivityAt?: string | null,
): Staleness {
  if (stage.kind !== "open") return "fresh"
  const daysSince = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS)

  const stageDays = daysSince(enteredStageAt)
  const silenceDays = daysSince(lastActivityAt ?? enteredStageAt)

  if (stage.red_after_days != null && silenceDays >= stage.red_after_days) return "red"
  if (stage.amber_after_days != null && stageDays >= stage.amber_after_days) return "amber"
  return "fresh"
}
