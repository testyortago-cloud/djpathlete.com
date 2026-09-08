// Pure routing decision for the Lead Engine pipeline boards: which board a
// booking, payment, refund or quiz result belongs on.
//
// PURE ON PURPOSE — no `@/lib/supabase`, no DAL, no I/O. Same discipline as
// lib/lead-engine/step-list.ts, lib/lead-engine/step-config.ts and
// lib/lead-engine/pipeline-move.ts, whose headers explain why: this module's
// tests run with zero mocks, and the impure caller (lib/db/pipeline.ts, via
// whatever assembles a RoutingSubject at each call site) is the only place
// that performs a read or a write. The only import below that is not a bare
// type is `DEFAULT_PIPELINE_KEY`, a plain string constant re-exported from
// lib/lead-engine/pipeline-move.ts — a module with zero imports of its own —
// so pulling it in gains this file no IO dependency.
//
// Spec: docs/superpowers/specs/2026-09-08-pipeline-boards-and-routing-design.md §3
//
// --- Why this isn't `routeToPipeline(event: PipelineEvent)` (spec §3.0) ---
//
// The earlier (2026-09-01) design proposed a pure function that switched on
// the bare `PipelineEvent` union. That cannot work: a `payment` event carries
// only `amountCents`, `currency` and `occurredAt` — nothing saying what was
// bought — and `event_signup` / `inquiry` are not `PipelineEvent` kinds at
// all. A function switching on that union would compile, pass a green test
// suite, and silently return the default for every input: today's behaviour
// wearing a new function's clothes. The fact this function needs to route a
// payment onto Camps & Clinics — `session.metadata?.type === "event_signup"`
// — and the fact it needs to route an inquiry onto Assessment —
// `inquiries.service_type === "assessment"` — both live only at the CALL
// SITE. So `routeToPipeline` takes a `RoutingSubject` assembled there, not
// the bare event.
//
// --- The refund decision (spec §3.1) — this is the module's real content ---
//
// `applyPipelineEvent` (lib/db/pipeline.ts) resolves ONE pipeline up front
// (`resolvePipeline(pipelineKey, businessId)`) and then reads the contact's
// current or most-recent-won card SCOPED TO THAT ONE PIPELINE
// (`readMostRecentOpportunity` / `readMostRecentWonOpportunity`, both
// `.eq("pipeline_id", pipelineId)`). A `refund` event carries only
// `amountRefundedCents` and `occurredAt` (see PipelineEvent below) — nothing
// saying which board the ORIGINAL payment landed on. Today every event lands
// on `coaching`, so the one pipeline `applyPipelineEvent` looks in is always
// the right one. The moment a second board exists, that stops being true: a
// camp payment that routed to `camps_clinics`, refunded, would have its
// refund resolved against `coaching` — find no Won card there — and take
// `decideMove`'s `{ kind: "noop", reason: "no_won_opportunity" }` branch.
// Nothing throws, nothing logs an anomaly, the coach just sees a card that
// still says it's worth the full amount. That is worse than a loud failure.
//
// Two ways to close that gap were on the table (task brief, Task 1):
//
//   (a) `routeToPipeline` refuses to answer for `event: "refund"` — the
//       return type widens to say so, and the caller (`applyPipelineEvent`)
//       must resolve the board a different way: from the opportunity that is
//       actually being amended, not from a subject re-derived at the
//       webhook.
//   (b) The refund path searches every active pipeline for the contact's
//       most recent Won card, and `routeToPipeline` never sees a refund at
//       all.
//
// CHOSEN: (a). Two independent reasons, not one:
//
//   1. (b) is not a routing decision — it is a DAL query across every
//      `pipelines` row for a business, which needs `getClient()`. There is
//      no version of it this module could implement and stay pure; writing
//      it here would just be smuggling IO into a file whose whole contract
//      is that it has none. It belongs in lib/db/pipeline.ts, which is
//      Task 3's territory (the task brief says so explicitly), not this
//      one's.
//   2. Even setting purity aside, re-deriving a refund's board from
//      `checkoutType`/`serviceType` the way a fresh payment would be routed
//      is the wrong ANSWER, not just the wrong LAYER. Spec §3.1's own
//      heading is "a refund must follow the card it refunds" — the actual
//      Won opportunity is the ground truth for which board a refund belongs
//      on, and that can diverge from what today's routing table would say
//      about the same checkout metadata: the table can change between a sale
//      and its refund, and a card can be moved by a human after it was
//      created. Guessing from metadata risks landing a refund on a board
//      that FEELS right but isn't the one holding the card — silently, same
//      as the bug this whole gap is about. A loud refusal that forces the
//      caller back to the actual opportunity is safer than a plausible
//      re-derivation.
//
// So this file draws its line at: routing what CAN be routed from a subject,
// and refusing outright what cannot, rather than guessing. Closing the gap
// for real — searching across boards, or threading the original
// opportunity's `pipeline_id` through to the refund call — is Task 3's job
// (wiring `applyPipelineEvent`'s call sites and refund branch). Until that
// lands, `event: "refund"` reaching this function is a signal that the
// caller has NOT yet been updated for a multi-board world, and the loud
// `refuse` result is meant to be impossible to miss in that caller's own
// tests — not a value that quietly compiles into "coaching" or
// "camps_clinics" and ships wrong.
//
// The test suite for this file proves the hazard within what a pure module
// CAN prove: a refund subject carrying `checkoutType: "event_signup"` — the
// same fact that would route a fresh payment to `camps_clinics`, a
// non-default board — still comes back `refuse`, never a guessed board key.
// That is as far as this module's contract runs; whether the refusal is
// actually resolved back to the right board is Task 3's to verify, against
// the real `applyPipelineEvent`.

import { DEFAULT_PIPELINE_KEY, type PipelineEvent } from "@/lib/lead-engine/pipeline-move"

export { DEFAULT_PIPELINE_KEY }

/** Camps, clinics and one-off events. Not seeded until Task 2. */
export const CAMPS_CLINICS_KEY = "camps_clinics"
/** Paid or free assessments/screens. Not seeded until Task 2. */
export const ASSESSMENT_KEY = "assessment"

export type RoutingSubject = {
  /** Which `PipelineEvent` kind this call is about. */
  event: PipelineEvent["kind"]
  /**
   * Stripe checkout `session.metadata?.type`, when this call originated from
   * a checkout. The same discriminator gap #14 reads for
   * `checkoutContactSource` (`shop_order`, `event_signup`,
   * `funnel_purchase`, `session_pack`, …).
   *
   * `undefined`, `null` and `""` are all "no signal" here and are treated
   * IDENTICALLY — unlike `parseStageConfig`'s `pipeline` field
   * (lib/lead-engine/step-config.ts), where an ABSENT `pipeline` means "use
   * the default" but an EMPTY one is a mistake worth reporting as an error.
   * That distinction exists there because a sequence step's config has
   * somewhere to report a mistake TO (`ParseResult<T>`'s `{ ok: false,
   * error }`, surfaced on `sequence_runs.last_error`). Routing has no
   * equivalent: this function's only two possible answers are "route it" or
   * "fall back to the default board", and a checkout with
   * `metadata: { type: "" }` is exactly as uninformative as one with no
   * `type` key at all. Treating "" as some third, distinct kind of checkout
   * would only mean two equally-unhelpful checkouts land on different boards
   * for a difference neither coach nor code can explain. Deliberate, not an
   * oversight — and it falls out of the implementation below for free: every
   * comparison is `=== "event_signup"` (or `=== "assessment"`), which is
   * `false` for `undefined`, `null` and `""` alike, with no special-casing
   * needed.
   */
  checkoutType?: string | null
  /**
   * `inquiries.service_type`, when this call originated from an inquiry.
   * Same absent/empty equivalence as `checkoutType`, for the same reason.
   */
  serviceType?: string | null
}

export type RoutingResult =
  | { kind: "routed"; pipelineKey: string }
  /**
   * This function declined to name a board. Today the only reason is
   * `event: "refund"` (see the module header) — the caller must resolve the
   * board from the opportunity actually being amended, not guess one from
   * this subject.
   */
  | { kind: "refuse"; reason: string }

/**
 * The routing table (spec §3.2):
 *
 * | Subject                                              | Board          |
 * |-------------------------------------------------------|---------------|
 * | `event: "booking"`                                     | `coaching`    |
 * | `event: "payment"`, `checkoutType: "event_signup"`      | `camps_clinics` |
 * | `event: "payment"`, any other/absent `checkoutType`     | `coaching`    |
 * | `event: "quiz_result"`                                  | `coaching`    |
 * | `serviceType: "assessment"` (however it arrives)        | `assessment`  |
 * | `event: "refund"`                                       | refused — see module header |
 * | anything unmatched                                      | `coaching`    |
 *
 * Programme and shop purchases are not a special case in this table — they
 * are ordinary `payment` events with a `checkoutType` this function does not
 * recognise, so they fall through to `coaching` like anything else unmatched.
 * That is correct, not a gap: spec §2.2 measured that 17 of the 23 priced
 * programmes are private subscriptions named after the athlete they were
 * built for — coaching sales, which is exactly where they land today.
 *
 * Never throws. `PipelineNotConfiguredError` (lib/db/pipeline.ts) already
 * exists for the genuinely broken case — no board seeded for a key, or a
 * seeded board with no stages. An event this table cannot place is a
 * different, softer thing: it still lands somewhere real (`coaching`), it
 * just isn't one of the special-cased boards.
 */
export function routeToPipeline(subject: RoutingSubject): RoutingResult {
  // Checked first, unconditionally, before either of the other two fields is
  // even read: a refund's checkoutType/serviceType (when a caller has them
  // to give) describe how the ORIGINAL payment would be routed today, not
  // which board the opportunity being amended actually lives on. See the
  // module header for why re-deriving one from the other is the wrong
  // answer, not just the wrong layer.
  if (subject.event === "refund") {
    return { kind: "refuse", reason: "refund_board_must_come_from_the_opportunity_being_amended" }
  }

  // "However it arrives" (spec §3.2): an assessment inquiry can generate a
  // booking, a payment, or (indirectly) a quiz result, and all three still
  // belong on the Assessment board. Checked ahead of the event-kind rules
  // below so it can override what a bare payment would otherwise get.
  if (subject.serviceType === "assessment") {
    return { kind: "routed", pipelineKey: ASSESSMENT_KEY }
  }

  if (subject.event === "payment" && subject.checkoutType === "event_signup") {
    return { kind: "routed", pipelineKey: CAMPS_CLINICS_KEY }
  }

  // Everything else — booking, quiz_result, a payment with any other or
  // absent checkoutType, and any event kind this table does not name at all
  // — is Coaching. "Keep the fallback" (spec §3.2): an unroutable event
  // lands here, it does not throw and it does not vanish.
  return { kind: "routed", pipelineKey: DEFAULT_PIPELINE_KEY }
}
