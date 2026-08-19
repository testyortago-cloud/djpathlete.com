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
    .select("id, stage_id, entered_stage_at, outcome, closed_trigger, closed_at")
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
  }
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
 * INCOMING event, not the decision. Payment events refuse as `payment`,
 * every booking status refuses as `booking`.
 */
function triggerForEvent(event: PipelineEvent): MoveTrigger {
  return event.kind === "payment" ? "payment" : "booking"
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
  const current = await readMostRecentOpportunity(input.contactId, pipelineId, stages, businessId)

  const now = new Date()
  const decision = decideMove({ now, stages, current }, input.event)

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

      const { data: inserted, error: insertErr } = await supabase
        .from("opportunities")
        .insert({
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
        })
        .select("id")
        .single()
      if (insertErr) throw insertErr
      const opportunityId = (inserted as Row).id as string

      await insertStageEvent(supabase, {
        businessId,
        opportunityId,
        fromStageId: null,
        toStageId: toStage.id,
        trigger: writtenTrigger(decision.trigger),
        metadata: input.metadata,
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
