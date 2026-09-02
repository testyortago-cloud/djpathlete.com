// lib/db/pipeline.ts — the IO layer for the Lead Engine pipeline board.
//
// `lib/lead-engine/pipeline-move.ts` (Task 3) is the pure decision core:
// given a `MoveContext` (the board's stages, the contact's current
// opportunity, and the clock) and a `PipelineEvent`, it returns exactly one
// `MoveDecision`. This file is everything around that pure call — resolving
// the board, reading the contact's most recent opportunity, calling
// `decideMove`, and writing back whatever it decided. It imports the pure
// module's types unchanged rather than redeclaring them, and it never
// re-decides anything: every branch below is a straight write of a decision
// already made.
//
// THIS IS THE ONLY FILE THAT TALKS TO pipelines / pipeline_stages /
// opportunities / opportunity_stage_events.
//
// Spec: docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md §3-§4

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { recordAudit } from "@/lib/audit/record"
import { isPgUniqueViolation } from "@/lib/supabase-errors"
import {
  decideMove,
  stalenessOf,
  type StageRow,
  type OpportunityState,
  type PipelineEvent,
  type MoveDecision,
  type MoveTrigger,
  type Staleness,
} from "@/lib/lead-engine/pipeline-move"

/** The one board seeded today (migration 00219). A stage key, not a brand. */
export const DEFAULT_PIPELINE_KEY = "coaching"

type Row = Record<string, any>

function getClient() {
  return createServiceRoleClient()
}

/**
 * Thrown by `resolvePipeline` when the named board has not been seeded — no
 * `pipelines` row for the key, or a `pipelines` row with no stages under it.
 *
 * Mirrors `BusinessNotConfiguredError` in lib/lead-engine/email.ts: a
 * misconfigured board is a setup problem, not a transient one. A webhook
 * route that lets this propagate into a 500 buys itself an infinite retry of
 * a state no retry can fix; the caller must catch this specifically and
 * decide what "no board" means for that entry point.
 */
export class PipelineNotConfiguredError extends Error {
  readonly pipelineKey: string
  constructor(pipelineKey: string) {
    super(`pipeline not configured: no seeded board for key "${pipelineKey}"`)
    this.name = "PipelineNotConfiguredError"
    this.pipelineKey = pipelineKey
  }
}

export type BoardColumn = { stage: StageRow; cards: BoardCard[] }
export type BoardCard = {
  id: string
  contactId: string
  contactName: string | null
  enteredStageAt: string
  staleness: Staleness
  valueCents: number | null
}

/**
 * Reads a board's stages, ordered by position. Throws `PipelineNotConfiguredError`
 * when the key has no `pipelines` row, or the row has no stages — both are
 * "this board was never seeded", and the caller (not this function) decides
 * whether that is fatal for its entry point.
 */
export async function resolvePipeline(
  key: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<{ pipelineId: string; stages: StageRow[] }> {
  const supabase = getClient()

  const { data: pipelineData, error: pipelineErr } = await supabase
    .from("pipelines")
    .select("id")
    .eq("business_id", businessId)
    .eq("key", key)
  if (pipelineErr) throw pipelineErr
  const pipelineRow = ((pipelineData ?? []) as Row[])[0]
  if (!pipelineRow) throw new PipelineNotConfiguredError(key)

  const { data: stageData, error: stageErr } = await supabase
    .from("pipeline_stages")
    .select("id, key, name, position, kind, amber_after_days, red_after_days")
    .eq("business_id", businessId)
    .eq("pipeline_id", pipelineRow.id)
    .order("position", { ascending: true })
  if (stageErr) throw stageErr
  const stages = (stageData ?? []) as StageRow[]
  if (stages.length === 0) throw new PipelineNotConfiguredError(key)

  return { pipelineId: pipelineRow.id, stages }
}

/**
 * The live opportunity (open, when one exists) for a (contact, pipeline),
 * else the most recently closed one. Mapped into the `OpportunityState`
 * shape `decideMove` needs. `stages` is the board's already-loaded stage
 * list (from `resolvePipeline`) — used to resolve `stage_position`/
 * `stage_kind` in application code rather than a join, so this stays a
 * flat, single-table read.
 *
 * Returns `null` when the contact has no opportunity on this board yet. That
 * is a real answer ("no deal exists"), never a stand-in for a failed read —
 * every Supabase error here is thrown, not swallowed into `null`.
 *
 * Final review, Critical 2 — this used to be a bare `ORDER BY created_at
 * DESC LIMIT 1`, which is wrong the moment two opportunities exist for the
 * same (contact, pipeline). Migration 00220's contested-opportunity CTE in
 * `merge_contacts` closes whichever of two contested open cards is NEWER on
 * the `created_at` tie-break (`outcome_reason='merged_into_survivor'`) — so
 * after a contested merge, "most recent by created_at" deterministically
 * returns the CLOSED, merge-losing card forever, and the genuinely open
 * survivor card is never seen as `current` again. `decideMove` then either
 * closes the wrong (already-dead) card as Won, or takes the `create` branch
 * for a contact who already has an open card and throws on
 * `opportunities_one_open_per_contact_pipeline`.
 *
 * Fixed by reading every opportunity for this (contact, pipeline) — there
 * are only ever a handful, ever, per contact — and preferring the OPEN one
 * regardless of its position in created_at order; only falling back to the
 * newest CLOSED row (rows are already ordered newest-first) when the
 * contact truly has no open card. This preserves the exact semantics
 * `decideMove` expects: `current` is the live card when one exists, else
 * the most recent closed one.
 */
export async function readMostRecentOpportunity(
  contactId: string,
  pipelineId: string,
  stages: StageRow[],
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<OpportunityState | null> {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("opportunities")
    .select("id, stage_id, entered_stage_at, outcome, closed_trigger, closed_at, value_cents")
    .eq("business_id", businessId)
    .eq("pipeline_id", pipelineId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as Row[]
  const row = rows.find((r) => r.outcome == null) ?? rows[0]
  if (!row) return null

  const stage = stages.find((s) => s.id === row.stage_id)
  if (!stage) {
    throw new Error(`opportunity ${row.id} references stage ${row.stage_id}, which is not on pipeline ${pipelineId}`)
  }

  return {
    id: row.id,
    stage_id: row.stage_id,
    stage_position: stage.position,
    stage_kind: stage.kind,
    entered_stage_at: row.entered_stage_at,
    outcome: row.outcome ?? null,
    closed_trigger: row.closed_trigger ?? null,
    closed_at: row.closed_at ?? null,
    value_cents: row.value_cents ?? null,
  }
}

/**
 * The contact's most recent WON opportunity on this board — used only by the
 * refund path (spec §14), never by booking/payment events.
 *
 * Deliberately NOT the same resolution as `readMostRecentOpportunity`, which
 * prefers an OPEN card over a closed one regardless of outcome: a refund
 * must find the Won card specifically, even when a newer non-Won card
 * exists for the same contact (e.g. a re-booking after the 30-day
 * suppression window lapsed). "Most recent" is by `closed_at` — when the
 * card became Won — not `created_at`.
 *
 * Returns `null` when the contact has no Won opportunity on this board.
 * That is a real answer, not a stand-in for a failed read — every Supabase
 * error here is thrown, not swallowed.
 *
 * Stated limitation carried from the spec: a refund only ever carries a
 * `payment_intent`, not the checkout session the Won card was created from,
 * so a contact with two Won deals gets their MOST RECENT one amended, which
 * may be the wrong one. Accepted rather than solved — see spec §14.
 */
export async function readMostRecentWonOpportunity(
  contactId: string,
  pipelineId: string,
  stages: StageRow[],
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<OpportunityState | null> {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("opportunities")
    .select("id, stage_id, entered_stage_at, outcome, closed_trigger, closed_at, value_cents")
    .eq("business_id", businessId)
    .eq("pipeline_id", pipelineId)
    .eq("contact_id", contactId)
    .eq("outcome", "won")
    .order("closed_at", { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as Row[]
  const row = rows[0]
  if (!row) return null

  const stage = stages.find((s) => s.id === row.stage_id)
  if (!stage) {
    throw new Error(`opportunity ${row.id} references stage ${row.stage_id}, which is not on pipeline ${pipelineId}`)
  }

  return {
    id: row.id,
    stage_id: row.stage_id,
    stage_position: stage.position,
    stage_kind: stage.kind,
    entered_stage_at: row.entered_stage_at,
    outcome: row.outcome ?? null,
    closed_trigger: row.closed_trigger ?? null,
    closed_at: row.closed_at ?? null,
    value_cents: row.value_cents ?? null,
  }
}

/**
 * The highest `amount_refunded` (Stripe cents) this app has already recorded
 * against a given Stripe charge — read back from the `opportunity_stage_events`
 * metadata ledger. Same "read `metadata` back and derive ledger state in JS"
 * pattern as `hasMatchingStageEventMetadata` / `listReconciledSourceIds`
 * above; not a second idempotency mechanism.
 *
 * Stripe's `charge.amount_refunded` is CUMULATIVE per charge: a second,
 * later partial refund on the same charge reports the running total, not
 * just the new increment. `applyPipelineEvent` hands this baseline to
 * `decideMove`, which computes the delta still owed to the card — never
 * re-subtracting cents a prior delivery already applied. This is the
 * highest-risk part of refund handling: getting it wrong silently
 * understates revenue.
 *
 * Unbounded by design, same rationale as `hasMatchingStageEventMetadata`:
 * refunds are a rare path, so a table-wide scan costs nothing a bounded
 * window would meaningfully save.
 */
export async function highestRecordedRefundAmount(
  chargeId: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("opportunity_stage_events")
    .select("metadata")
    .eq("business_id", businessId)
  if (error) throw error

  let highest = 0
  for (const row of (data ?? []) as Row[]) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    if (metadata.stripe_charge_id === chargeId && typeof metadata.amount_refunded === "number") {
      if (metadata.amount_refunded > highest) highest = metadata.amount_refunded
    }
  }
  return highest
}

function findStage(stages: StageRow[], key: string): StageRow {
  const stage = stages.find((s) => s.key === key)
  if (!stage) throw new Error(`decideMove returned unknown stage key "${key}"`)
  return stage
}

/**
 * `decideMove`'s `refuse` decision carries only a `reason` — by design, a
 * suppressed move never got far enough to have a `toStageKey`. So the
 * `trigger` column on the stage event it still must record (spec §2.4 — a
 * refusal is visible, never silently dropped) has to come from the
 * INCOMING event, not the decision. Payment and refund events refuse as
 * `payment` (both are Stripe-driven; `opportunity_stage_events.trigger`'s
 * CHECK constraint has no separate `refund` value — see 00219), every
 * booking status refuses as `booking`.
 */
function triggerForEvent(event: PipelineEvent): MoveTrigger {
  return event.kind === "booking" ? "booking" : "payment"
}

/**
 * True when an EXISTING `opportunity_stage_events` row for this business
 * already carries at least one of the same metadata key/value pairs as
 * `metadata`. Used only by the create-with-outcome branch of
 * `applyPipelineEvent` (Important 3, final review) — the one write the
 * partial unique index cannot protect, because it inserts an opportunity
 * that is already closed (`WHERE outcome IS NULL` never applies to it).
 * Same "read `metadata` back and compare in JS" shape `listReconciledSourceIds`
 * below already established, reused rather than a second idempotency
 * mechanism. Unbounded by design: the create-with-outcome branch is a rare
 * path (a payment with literally no prior deal), so this table-wide scan
 * costs nothing a bounded window would meaningfully save.
 */
async function hasMatchingStageEventMetadata(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("opportunity_stage_events")
    .select("metadata")
    .eq("business_id", businessId)
  if (error) throw error

  return ((data ?? []) as Row[]).some((row) => {
    const existing = (row.metadata ?? {}) as Record<string, unknown>
    return Object.entries(metadata).some(([key, value]) => value !== undefined && existing[key] === value)
  })
}

/**
 * The metadata keys that can carry the id of the EXTERNAL event a card is
 * created from, in the order they are consulted. Migration 00225 puts that id
 * on `opportunities.source_event_id` under a partial unique index, so the
 * claim and the card are the same INSERT.
 *
 * Derived here, in exactly one place, so the value written to the column and
 * the value a later delivery collides against can never drift apart.
 *
 * Order, and why:
 *
 *  1. `stripe_session_id` — the only key a live webhook passes
 *     (app/api/stripe/webhook/route.ts) and the only one that can actually
 *     race, because Stripe redelivers concurrently. One checkout session is
 *     one purchase forever, which is the same reason 00208 made it
 *     `funnel_checkout_grants`' natural key.
 *  2. `booking_id`, then 3. `payment_id` — the reconciler's two keys
 *     (lib/automation/pipeline-reconcile.ts), in the order its own two loops
 *     run.
 *
 * No caller passes more than one of these, so the order is a determinism
 * guarantee rather than a live tie-break — but "whichever key the object
 * happened to enumerate first" is not a guarantee, and a duplicate Won card
 * hangs on it.
 *
 * Deliberately NOT here: `stripe_charge_id`, which refunds pass. A refund
 * takes the `amend` branch and never creates a card, and a charge id is not
 * one-shot for creation the way a session id is — claiming it would refuse a
 * later, legitimate card. Refund idempotency is `highestRecordedRefundAmount`'s
 * job and stays there.
 */
const SOURCE_EVENT_ID_KEYS = ["stripe_session_id", "booking_id", "payment_id", "quiz_attempt_id"] as const

function deriveSourceEventId(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null
  for (const key of SOURCE_EVENT_ID_KEYS) {
    const value = metadata[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

/**
 * True when a write was refused because PostgREST does not know a column the
 * payload named.
 *
 * This exists for ONE deploy: migrations and the Vercel build race on merge
 * to main, so for a few minutes this code runs against an `opportunities`
 * table that predates 00225. Unhandled, that is a Stripe webhook answering
 * 500 to every delivery — strictly worse than the race being fixed, and it
 * would trigger Stripe's own retries on top. Code-based, per the header of
 * lib/supabase-errors.ts: PGRST204 is PostgREST's schema-cache miss on a
 * write, 42703 is Postgres' own undefined_column for the versions that
 * surface it directly.
 *
 * Kept local rather than added to lib/supabase-errors.ts on purpose: it is a
 * transitional guard, and the call site below should be deleted once 00225 is
 * live everywhere — a shared export invites permanent reuse of a temporary
 * tolerance.
 */
function isMissingColumnError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false
  const code = (err as { code?: string }).code
  return code === "PGRST204" || code === "42703"
}

/**
 * Whether an opportunity row already carries this `source_event_id`.
 *
 * Called only after a 23505, to answer WHICH unique index refused the insert
 * without parsing the error message. Two can fire on this table:
 * `opportunities_source_event_uniq` (00225 — another delivery of the same
 * external event already recorded this sale) and
 * `opportunities_one_open_per_contact_pipeline` (00219 — the contact gained
 * an open card between the read and the insert). Only the first is a
 * duplicate delivery; the second is a genuine concurrency fault that must
 * keep throwing, so the reconciler counts it in `failed` and logs the row id
 * instead of silently reporting success.
 */
async function sourceEventIdIsClaimed(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  sourceEventId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("id")
    .eq("business_id", businessId)
    .eq("source_event_id", sourceEventId)
  if (error) throw error
  return ((data ?? []) as Row[]).length > 0
}

async function insertStageEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: {
    businessId: string
    opportunityId: string
    fromStageId: string | null
    toStageId: string | null
    trigger: string
    actorUserId?: string | null
    refusedReason?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from("opportunity_stage_events").insert({
    business_id: args.businessId,
    opportunity_id: args.opportunityId,
    from_stage_id: args.fromStageId,
    to_stage_id: args.toStageId,
    trigger: args.trigger,
    actor_user_id: args.actorUserId ?? null,
    refused_reason: args.refusedReason ?? null,
    metadata: args.metadata ?? {},
  })
  if (error) throw error
}

const SYSTEM_ACTOR = { id: null, email: null, role: "system" as const }

/**
 * Resolves the board, reads the contact's current opportunity, asks
 * `decideMove` what should happen, and writes exactly that. No branch below
 * makes a decision `decideMove` did not already make.
 *
 * `source` distinguishes a webhook-triggered call (`"hook"`, the default)
 * from a reconciler catch-up pass. It changes ONLY the `trigger` column
 * written to `opportunity_stage_events` — never `opportunities.closed_trigger`,
 * whose value is state-machine-significant (`decideMove` reads it to decide
 * whether a close is final) and must stay the decision's real trigger
 * regardless of who replayed it. A non-zero count of `trigger='reconciler'`
 * rows is the signal a later task watches for: it means a webhook was
 * dropped and the reconciler is the only reason the card ever moved.
 *
 * `metadata` is written verbatim onto the `opportunity_stage_events` row this
 * call produces (every branch below, including `refuse`). The reconciler
 * (Task 6) is the only caller that passes it today — it stamps
 * `{ booking_id }` / `{ payment_id }` so a later reconcile pass can tell,
 * without re-deciding anything, that this exact source row was already
 * handled and must not be replayed. A `noop` decision writes no row, so it
 * carries no metadata regardless of what was passed — there is nothing to
 * mark as handled when nothing happened.
 */
export async function applyPipelineEvent(input: {
  contactId: string
  event: PipelineEvent
  pipelineKey?: string
  source?: "hook" | "reconciler"
  businessId?: string
  metadata?: Record<string, unknown>
}): Promise<{ decision: MoveDecision; opportunityId: string | null }> {
  const businessId = input.businessId ?? SINGLETON_BUSINESS_ID
  const pipelineKey = input.pipelineKey ?? DEFAULT_PIPELINE_KEY
  const source = input.source ?? "hook"
  const supabase = getClient()

  const { pipelineId, stages } = await resolvePipeline(pipelineKey, businessId)

  const isRefund = input.event.kind === "refund"

  // Refunds resolve `current` differently from every other event: they need
  // the contact's most recent WON opportunity specifically (spec §14), not
  // whatever `readMostRecentOpportunity` would prefer (an open card, if one
  // exists, even a newer one from an unrelated re-booking).
  const current = isRefund
    ? await readMostRecentWonOpportunity(input.contactId, pipelineId, stages, businessId)
    : await readMostRecentOpportunity(input.contactId, pipelineId, stages, businessId)

  // Stripe's `charge.amount_refunded` is cumulative per charge — read back
  // how much of it this app has already applied so `decideMove` can compute
  // the delta rather than double-subtracting a prior delivery's cents (the
  // highest-risk failure mode here). Keyed on `metadata.stripe_charge_id`,
  // opt-in like the create-with-outcome duplicate check above: no charge id,
  // no baseline. Skipped entirely when there is no Won card at all
  // (`current === null`) — `decideMove` noops that case regardless of the
  // ledger, so reading it first is a query the no-op path never needed.
  let previouslyRefundedCents: number | undefined
  if (isRefund && current) {
    const chargeId = typeof input.metadata?.stripe_charge_id === "string" ? input.metadata.stripe_charge_id : null
    previouslyRefundedCents = chargeId ? await highestRecordedRefundAmount(chargeId, businessId) : 0
  }

  const now = new Date()
  const decision = decideMove({ now, stages, current, previouslyRefundedCents }, input.event)

  const writtenTrigger = (decisionTrigger: MoveTrigger): string =>
    source === "reconciler" ? "reconciler" : decisionTrigger

  switch (decision.kind) {
    case "create": {
      const toStage = findStage(stages, decision.toStageKey)

      // Final review, Important 3. The partial unique index on opportunities
      // is `WHERE outcome IS NULL`, so it does NOT constrain this branch when
      // `decision.outcome` is set (a payment arriving with no prior deal —
      // the row is inserted already closed). Stripe delivers at-least-once
      // with no event-id dedupe on this route: two concurrent
      // `checkout.session.completed` deliveries for the same contact both
      // read `current === null` above and would both reach this insert,
      // minting two Won cards for one sale. (Sequential redelivery is
      // already safe without this — the second call sees `current.outcome
      // === "won"` and decideMove resolves to `noop`.)
      //
      // Fixed by reusing the SAME source-id ledger mechanism the reconciler
      // already relies on (`listReconciledSourceIds` reads `metadata` back
      // off `opportunity_stage_events`, never a second table) rather than
      // inventing a second idempotency scheme: the caller passes a source id
      // in `metadata` (the Stripe webhook passes `{ stripe_session_id }`),
      // and if a stage event already carries that same id, this call is a
      // duplicate delivery of a sale already recorded, not a new one.
      //
      // This check is a SELECT taken before the INSERT, so it closes the
      // SEQUENTIAL redelivery case (the common one) without ever reaching an
      // error path — but it cannot close the CONCURRENT one, where both
      // deliveries read it before either has written anything. Migration
      // 00225's `source_event_id` claim on the insert below is the backstop
      // underneath it, not a replacement for it: this check also covers the
      // `close`/`amend` branches, which the column does not touch at all
      // (they update an existing row rather than creating one), and removing
      // it would change what the reconciler sees.
      if (decision.outcome && input.metadata) {
        const duplicate = await hasMatchingStageEventMetadata(supabase, businessId, input.metadata)
        if (duplicate) {
          return { decision: { kind: "noop", reason: "duplicate_source_id" }, opportunityId: null }
        }
      }

      const { data: contactData, error: contactErr } = await supabase
        .from("contacts")
        .select("first_touch_session_id")
        .eq("business_id", businessId)
        .eq("id", input.contactId)
      if (contactErr) throw contactErr
      const contactRow = ((contactData ?? []) as Row[])[0]
      if (!contactRow) throw new Error(`contact ${input.contactId} not found`)

      // Ruling C3: a `create` decision carrying an outcome (payment arrives
      // with no prior deal — an instant Won) must set outcome/closed_at/
      // closed_trigger together in THIS insert. The CHECK constraint
      // `opportunities_closed_fields_agree` rejects any insert that sets one
      // without the other two.
      const closureFields = decision.outcome
        ? { outcome: decision.outcome, closed_at: now.toISOString(), closed_trigger: decision.trigger }
        : { outcome: null, closed_at: null, closed_trigger: null }

      const opportunityRow: Row = {
        business_id: businessId,
        pipeline_id: pipelineId,
        contact_id: input.contactId,
        stage_id: toStage.id,
        entered_stage_at: now.toISOString(),
        value_cents: decision.valueCents ?? null,
        currency: decision.currency ?? "usd",
        // Copied at creation, never again — spec: first touch is a
        // property of when the deal began.
        source_session_id: contactRow.first_touch_session_id ?? null,
        ...closureFields,
      }

      // One statement is the claim AND the effect. `source_event_id` carries
      // a partial unique index (00225), so of two concurrent deliveries of
      // the same external event exactly one insert succeeds — decided by
      // Postgres, not by application timing — and a failed insert claims
      // nothing, so the sale stays retryable.
      const sourceEventId = deriveSourceEventId(input.metadata)
      const insertOpportunity = (row: Row) => supabase.from("opportunities").insert(row).select("id").single()

      let insertResult = await insertOpportunity(
        sourceEventId ? { ...opportunityRow, source_event_id: sourceEventId } : opportunityRow,
      )

      // The one deploy where this code is ahead of its migration. Retry with
      // the identical row minus the field it cannot know about — the sale
      // must land either way, and without the column there is nothing to
      // claim, so nothing was claimed.
      //
      // AND SAY SO, LOUDLY. Taking this path silently would be the worst
      // shape available here: the double-Won protection is off, the return
      // value is byte-identical to the protected path, and the only way
      // anyone finds out is by noticing duplicated revenue weeks later. It is
      // meant to last one deploy; if it is still firing after that, 00225 did
      // not reach this database and somebody has to know.
      let claimedSourceEventId = sourceEventId
      let claimDegraded = false
      if (insertResult.error && sourceEventId && isMissingColumnError(insertResult.error)) {
        claimedSourceEventId = null
        claimDegraded = true
        console.error(
          "[pipeline] opportunities.source_event_id is missing — duplicate-sale protection is OFF for this write. " +
            "Migration 00225 has not reached this database (or PostgREST's schema cache is stale).",
          { sourceEventId, contactId: input.contactId },
        )
        insertResult = await insertOpportunity(opportunityRow)
      }

      if (
        insertResult.error &&
        claimedSourceEventId &&
        isPgUniqueViolation(insertResult.error) &&
        (await sourceEventIdIsClaimed(supabase, businessId, claimedSourceEventId))
      ) {
        // The other delivery won. Same answer the pre-check above returns for
        // the sequential case, deliberately including `opportunityId: null` —
        // one duplicate delivery, one shape, whichever guard caught it.
        return { decision: { kind: "noop", reason: "duplicate_source_id" }, opportunityId: null }
      }

      if (insertResult.error) throw insertResult.error
      const opportunityId = (insertResult.data as Row).id as string

      await insertStageEvent(supabase, {
        businessId,
        opportunityId,
        fromStageId: null,
        toStageId: toStage.id,
        trigger: writtenTrigger(decision.trigger),
        // The marker is added ONLY on the degraded path, so its absence keeps
        // meaning what it means on every card written before 00225 existed.
        // A log line scrolls away; this makes "which sales were recorded while
        // the protection was off" a query somebody can actually run afterwards.
        metadata: claimDegraded ? { ...(input.metadata ?? {}), source_event_id_claimed: false } : input.metadata,
      })

      await recordAudit({
        action: "pipeline.opportunity_created",
        category: "automation",
        actor: SYSTEM_ACTOR,
        target: { type: "opportunity", id: opportunityId },
        metadata: {
          contact_id: input.contactId,
          pipeline_key: pipelineKey,
          to_stage: toStage.key,
          trigger: decision.trigger,
          source,
        },
      })

      return { decision, opportunityId }
    }

    case "advance": {
      if (!current) throw new Error("decideMove returned 'advance' with no current opportunity")
      const toStage = findStage(stages, decision.toStageKey)

      const { error: updateErr } = await supabase
        .from("opportunities")
        .update({ stage_id: toStage.id, entered_stage_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", current.id)
      if (updateErr) throw updateErr

      await insertStageEvent(supabase, {
        businessId,
        opportunityId: current.id,
        fromStageId: current.stage_id,
        toStageId: toStage.id,
        trigger: writtenTrigger(decision.trigger),
        metadata: input.metadata,
      })

      return { decision, opportunityId: current.id }
    }

    case "close": {
      if (!current) throw new Error("decideMove returned 'close' with no current opportunity")
      const toStage = findStage(stages, decision.toStageKey)

      const patch: Row = {
        outcome: decision.outcome,
        // decideMove names WHY the card closed (`payment_received`,
        // `booking_cancelled`, `booking_no_show`); this column existed for it
        // since 00219 and was never written on this path — found by the
        // Calendly acceptance run asserting a cancelled consult reads as
        // `lost / booking_cancelled` and finding `lost / null`. The refund
        // branch below already writes it; the merge function writes
        // `merged_into_survivor`. This branch was the gap.
        outcome_reason: decision.reason,
        closed_at: now.toISOString(),
        closed_trigger: decision.trigger,
        stage_id: toStage.id,
        updated_at: now.toISOString(),
      }
      if (decision.valueCents !== undefined) patch.value_cents = decision.valueCents
      if (decision.currency !== undefined) patch.currency = decision.currency

      const { error: updateErr } = await supabase.from("opportunities").update(patch).eq("id", current.id)
      if (updateErr) throw updateErr

      await insertStageEvent(supabase, {
        businessId,
        opportunityId: current.id,
        fromStageId: current.stage_id,
        toStageId: toStage.id,
        trigger: writtenTrigger(decision.trigger),
        metadata: input.metadata,
      })

      await recordAudit({
        action: decision.outcome === "won" ? "pipeline.opportunity_won" : "pipeline.opportunity_lost",
        category: "commerce",
        actor: SYSTEM_ACTOR,
        target: { type: "opportunity", id: current.id },
        metadata: {
          contact_id: input.contactId,
          pipeline_key: pipelineKey,
          reason: decision.reason,
          trigger: decision.trigger,
          source,
        },
      })

      return { decision, opportunityId: current.id }
    }

    case "amend": {
      // Spec §14 — a refund reopens nothing. Only value_cents/outcome_reason
      // change; stage_id, outcome, closed_at, closed_trigger are untouched,
      // so the card stays exactly where it is (Won).
      if (!current) throw new Error("decideMove returned 'amend' with no current opportunity")

      const { error: updateErr } = await supabase
        .from("opportunities")
        .update({
          value_cents: decision.valueCents,
          outcome_reason: decision.outcomeReason,
          updated_at: now.toISOString(),
        })
        .eq("id", current.id)
      if (updateErr) throw updateErr

      // Recorded so an amended value is never a silent edit (task
      // requirement) — from_stage_id/to_stage_id both name the Won stage
      // since no stage change happened, and this same row is what
      // `highestRecordedRefundAmount` reads back on the next delivery to
      // compute the delta.
      await insertStageEvent(supabase, {
        businessId,
        opportunityId: current.id,
        fromStageId: current.stage_id,
        toStageId: current.stage_id,
        trigger: writtenTrigger(decision.trigger),
        metadata: input.metadata,
      })

      return { decision, opportunityId: current.id }
    }

    case "refuse": {
      // A refusal with no current opportunity is not a shape decideMove
      // actually produces (every refuse branch reads `current` first), but
      // guard rather than write an orphaned event referencing nothing.
      if (!current) return { decision, opportunityId: null }

      await insertStageEvent(supabase, {
        businessId,
        opportunityId: current.id,
        fromStageId: current.stage_id,
        // No stage change happened — there is no real destination to name,
        // and the decision itself carries no toStageKey to name one from.
        toStageId: null,
        trigger: writtenTrigger(triggerForEvent(input.event)),
        refusedReason: decision.reason,
        metadata: input.metadata,
      })

      return { decision, opportunityId: current.id }
    }

    case "noop":
      return { decision, opportunityId: current?.id ?? null }
  }
}

/**
 * The reconciler's (Task 6) own idempotency ledger: every `booking_id` /
 * `payment_id` a PRIOR reconcile pass already stamped into
 * `opportunity_stage_events.metadata` for a `trigger='reconciler'` row. A
 * source id present here was already handled (created, advanced, closed, or
 * correctly refused) by an earlier pass and must not be replayed — this is
 * what keeps a suppressed-rebooking refusal from being re-written every
 * single hourly pass for as long as the source row stays inside the scan
 * window (a `noop` decision writes no row at all, so a source id that only
 * ever produced `noop` is never recorded here and stays eligible for
 * re-checking next pass — cheap extra reads, never a duplicate write).
 *
 * `sinceIso` bounds this to the SAME window the booking/payment scans use
 * (fix round 1, Finding 3) — without it this read grows without bound
 * forever, unlike every other query in the reconciler. A source id can only
 * ever need re-checking while its own source row is still inside that
 * window (once a booking/payment ages out of the scan, it's never looked at
 * again regardless of what this ledger says), so nothing outside the window
 * is ever useful here.
 *
 * Flat, single-table read scoped to this business — this repo runs one
 * pipeline, and booking/payment ids are unique system-wide, so no
 * `pipeline_id` join is needed to make the match unambiguous.
 */
export async function listReconciledSourceIds(
  sinceIso: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<{ bookingIds: Set<string>; paymentIds: Set<string> }> {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("opportunity_stage_events")
    .select("metadata")
    .eq("business_id", businessId)
    .eq("trigger", "reconciler")
    .gte("occurred_at", sinceIso)
  if (error) throw error

  const bookingIds = new Set<string>()
  const paymentIds = new Set<string>()
  for (const row of (data ?? []) as Row[]) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    if (typeof metadata.booking_id === "string") bookingIds.add(metadata.booking_id)
    if (typeof metadata.payment_id === "string") paymentIds.add(metadata.payment_id)
  }
  return { bookingIds, paymentIds }
}

/**
 * A human moving a card by hand — drag-and-drop on the board, not an
 * automated event. Sets `closed_trigger='manual'` and `closed_by_user_id`
 * when the destination stage is `won`/`lost`: spec §2.4 — a close made by a
 * PERSON is final (`decideMove` reads `closed_trigger === 'manual'`, never
 * `closed_by_user_id`, to decide that — see the schema comment in 00219).
 *
 * Moving a card back to an OPEN stage clears any prior closure fields
 * together, so a reopened card never sits in an inconsistent state that
 * violates `opportunities_closed_fields_agree`.
 *
 * Audits DUAL-LOG when the move closes the card: `pipeline.opportunity_moved`
 * (admin_write — who did it) AND `pipeline.opportunity_won`/`_lost`
 * (commerce — what happened). A reader counting won deals off the `commerce`
 * category must see a manual close exactly like an automated one, or it
 * silently undercounts every deal a human closed by hand. A non-closing move
 * (open stage to open stage, or a reopen) emits only `_moved`.
 */
export async function moveOpportunityManually(input: {
  opportunityId: string
  toStageKey: string
  actorUserId: string
  businessId?: string
}): Promise<void> {
  const businessId = input.businessId ?? SINGLETON_BUSINESS_ID
  const supabase = getClient()

  const { data: oppData, error: oppErr } = await supabase
    .from("opportunities")
    .select("id, pipeline_id, stage_id")
    .eq("business_id", businessId)
    .eq("id", input.opportunityId)
  if (oppErr) throw oppErr
  const oppRow = ((oppData ?? []) as Row[])[0]
  if (!oppRow) throw new Error(`opportunity ${input.opportunityId} not found`)

  const { data: stageData, error: stageErr } = await supabase
    .from("pipeline_stages")
    .select("id, key, name, position, kind, amber_after_days, red_after_days")
    .eq("business_id", businessId)
    .eq("pipeline_id", oppRow.pipeline_id)
    .eq("key", input.toStageKey)
  if (stageErr) throw stageErr
  const toStage = ((stageData ?? []) as StageRow[])[0]
  if (!toStage) throw new Error(`stage "${input.toStageKey}" not found on pipeline ${oppRow.pipeline_id}`)

  const now = new Date()
  const isClosing = toStage.kind === "won" || toStage.kind === "lost"

  const patch: Row = {
    stage_id: toStage.id,
    entered_stage_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
  if (isClosing) {
    patch.outcome = toStage.kind
    patch.closed_at = now.toISOString()
    patch.closed_trigger = "manual"
    patch.closed_by_user_id = input.actorUserId
  } else {
    patch.outcome = null
    patch.closed_at = null
    patch.closed_trigger = null
    patch.closed_by_user_id = null
  }

  const { error: updateErr } = await supabase.from("opportunities").update(patch).eq("id", input.opportunityId)
  if (updateErr) throw updateErr

  await insertStageEvent(supabase, {
    businessId,
    opportunityId: input.opportunityId,
    fromStageId: oppRow.stage_id,
    toStageId: toStage.id,
    trigger: "manual",
    actorUserId: input.actorUserId,
  })

  await recordAudit({
    action: "pipeline.opportunity_moved",
    category: "admin_write",
    actor: { id: input.actorUserId, role: "admin" },
    target: { type: "opportunity", id: input.opportunityId },
    metadata: { to_stage: toStage.key, closing: isClosing },
  })

  // Controller ruling (fix round 1): a manual close must dual-log. _moved is
  // admin_write and records WHO did it; _won/_lost is commerce and records
  // WHAT happened. Anything counting won deals by querying the commerce
  // category must see a manual close exactly like an automated one — an
  // audit trail that is complete only for machine-made decisions inverts the
  // point of auditing a human's actions.
  if (isClosing) {
    await recordAudit({
      action: toStage.kind === "won" ? "pipeline.opportunity_won" : "pipeline.opportunity_lost",
      category: "commerce",
      actor: { id: input.actorUserId, role: "admin" },
      target: { type: "opportunity", id: input.opportunityId },
      metadata: { to_stage: toStage.key, trigger: "manual" },
    })
  }
}

async function readContactNames(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
): Promise<Map<string, string | null>> {
  const { data, error } = await supabase.from("contacts").select("id, name").eq("business_id", businessId)
  if (error) throw error
  const map = new Map<string, string | null>()
  for (const row of (data ?? []) as Row[]) map.set(row.id, row.name ?? null)
  return map
}

/**
 * One column per stage, in position order. Staleness is computed here, at
 * read time, and never stored — `stalenessOf` is the same pure function
 * `decideMove`'s caller never had to duplicate.
 *
 * A stage of kind `open` shows only cards that are still open
 * (`outcome IS NULL`) even if their `stage_id` happens to point at it — the
 * one way that can happen is a card manually reopened onto an open stage,
 * which is also the reason `moveOpportunityManually` clears the closure
 * fields together rather than leaving a stale `outcome` behind. `won`/`lost`
 * columns show every card whose `stage_id` points at them; those stages are
 * only ever reached through a close, so their cards always carry a matching
 * outcome.
 */
export async function readBoard(
  pipelineKey?: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<BoardColumn[]> {
  const key = pipelineKey ?? DEFAULT_PIPELINE_KEY
  const supabase = getClient()

  const { pipelineId, stages } = await resolvePipeline(key, businessId)

  const { data: oppData, error: oppErr } = await supabase
    .from("opportunities")
    .select("id, contact_id, stage_id, entered_stage_at, value_cents, outcome")
    .eq("business_id", businessId)
    .eq("pipeline_id", pipelineId)
  if (oppErr) throw oppErr
  const opportunities = (oppData ?? []) as Row[]

  const nameByContact = await readContactNames(supabase, businessId)

  const now = new Date()
  const orderedStages = [...stages].sort((a, b) => a.position - b.position)

  return orderedStages.map((stage) => {
    const cards: BoardCard[] = opportunities
      .filter((row) => row.stage_id === stage.id)
      .filter((row) => (stage.kind === "open" ? row.outcome == null : true))
      .map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        contactName: nameByContact.get(row.contact_id) ?? null,
        enteredStageAt: row.entered_stage_at,
        staleness: stalenessOf(stage, row.entered_stage_at, now),
        valueCents: row.value_cents ?? null,
      }))
    return { stage, cards }
  })
}

/**
 * The four facts `grantWonOpportunity` needs about a card before it will hand
 * anyone an account: does it exist, is it won, whose is it, and did it already
 * come through checkout.
 *
 * `source_session_id` is the one that stops a double grant across the two
 * paths. A card that reached Won through Stripe was already provisioned under
 * the session's own idempotency key, and the ledger cannot see a manual grant
 * of the same deal as a duplicate — the two key on different columns by
 * design (00235). So the check has to happen before the grant, here.
 */
export async function readOpportunityForGrant(opportunityId: string): Promise<{
  id: string
  outcome: "won" | "lost" | null
  contact_id: string | null
  source_session_id: string | null
} | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, outcome, contact_id, source_session_id")
    .eq("id", opportunityId)
    .maybeSingle()
  // A read that fails is NOT "no such card". Throwing here is what stops the
  // caller treating an outage as a refusal — and, worse, a retry as a fresh
  // grant.
  if (error) throw new Error(`opportunities read failed: ${error.message}`)
  if (!data) return null
  const row = data as { id: string; outcome: "won" | "lost" | null; contact_id: string | null; source_session_id: string | null }
  return row
}

/**
 * Where to send the invite. Null email is a refusal upstream, never a guess —
 * an account nobody can be told about helps no one.
 */
export async function readContactIdentity(
  contactId: string,
): Promise<{ email: string | null; name: string | null } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("email, name")
    .eq("id", contactId)
    .maybeSingle()
  if (error) throw new Error(`contacts read failed: ${error.message}`)
  if (!data) return null
  const row = data as { email: string | null; name: string | null }
  return { email: row.email, name: row.name }
}

/**
 * The programs a coach can actually hand somebody after winning a deal.
 *
 * FILTERED ON `stripe_price_id`, NOT ON `is_active`. 68 programs are active on
 * production and only 18 carry a price; the other 50 are drafts and templates
 * that were never billable, and offering them would pad the list with things
 * nobody has ever sold.
 *
 * WHAT THIS FILTER DOES *NOT* DO — and an earlier version of this comment
 * claimed it did. It does not separate catalogue products from individual
 * athletes' plans, because on this data that distinction does not exist:
 * exactly ONE priced program ("Rotational Reboot") is public, and the other
 * seventeen are bespoke plans named after the athlete they were built for,
 * each with its own Stripe subscription or one-time price. That IS the
 * business — the coach sells bespoke plans — so a named plan in this list is
 * correct, not a leak.
 *
 * The real hazard is therefore picking the WRONG athlete's plan out of
 * eighteen similar names, which is a case for search in the picker rather than
 * for a narrower query here. Noted, not built.
 */
export async function listGrantablePrograms(): Promise<
  Array<{ id: string; name: string; price_cents: number | null }>
> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("programs")
    .select("id, name, price_cents")
    .eq("is_active", true)
    .not("stripe_price_id", "is", null)
    .order("name")
  if (error) throw new Error(`programs read failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string; name: string; price_cents: number | null }>
}
