// lib/db/sequence-admin.ts — the data access layer behind the sequence editor
// screen: loading one sequence for editing, flipping its on/off switch, and
// writing back a whole step list atomically.
//
// Deliberately separate from lib/db/sequences.ts (the ENGINE's IO — claiming
// runs, recording sends, advancing positions, on the tick's hot path) and from
// lib/db/sequence-reporting.ts (the read-only report behind the list/detail
// screens). This file is the one place a HUMAN EDIT reaches the database, and
// its one write (`saveSequenceSteps`) goes through the plpgsql function added
// by migration 00256 rather than a sequence of separate statements — see that
// migration's header for why a half-applied multi-statement save is not an
// acceptable failure mode here.
//
// EVERY READ AND EVERY WRITE CARRIES `.eq("business_id", businessId)`. A
// reader with no tenant predicate is a leak with a fuse in it.

import { createServiceRoleClient } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/db/paginate"
import type { StepDraft, SavedStep, RunPointer, StepSavePlan } from "@/lib/lead-engine/step-list"
import type { StepKind, BranchCondition } from "@/lib/automation/sequence-tick"

function getClient() {
  return createServiceRoleClient()
}

export type SequenceForEdit = {
  id: string
  key: string
  name: string
  status: string
  /**
   * id + position only, matching `SavedStep` in lib/lead-engine/step-list.ts.
   * This is the "old" side `planStepSave` needs — kept separate from `drafts`
   * because `planStepSave` only ever wants identity and position, never the
   * editable content.
   */
  steps: SavedStep[]
  /**
   * The full editable shape, ordered by position — the array index IS the
   * position, per step-list.ts's own header, so there is deliberately no
   * `position` field on an individual draft.
   */
  drafts: StepDraft[]
  /**
   * Keyed by step id. A step with zero sends is simply ABSENT rather than
   * present with 0 — `undefined > 0` is `false`, which is what the route's
   * removal guard (§4.6 of the design doc) relies on.
   */
  sentCountByStepId: Record<string, number>
  activeRuns: RunPointer[]
}

type SequenceStepRow = {
  id: string
  position: number
  kind: StepKind
  wait_minutes: number | null
  subject: string | null
  body: string | null
  branch_condition: BranchCondition | null
  on_true_position: number | null
  on_false_position: number | null
  config: Record<string, unknown>
}

/**
 * Everything the step editor needs for one sequence, or `null` when the key
 * does not belong to this tenant — a 404, not an empty screen, so a coach who
 * mistypes a key or reaches for another business's sequence is told the
 * truth rather than shown nothing.
 */
export async function loadSequenceForEdit(businessId: string, key: string): Promise<SequenceForEdit | null> {
  const supabase = getClient()

  const { data: sequenceRow, error: sequenceErr } = await supabase
    .from("sequences")
    .select("id, key, name, status")
    .eq("key", key)
    .eq("business_id", businessId)
    .maybeSingle()
  if (sequenceErr) throw sequenceErr
  if (!sequenceRow) return null
  const sequence = sequenceRow as { id: string; key: string; name: string; status: string }

  // Not paginated: a sequence is a handful of steps — eight is the longest in
  // production per §9 of the design doc — the same reasoning
  // lib/db/sequence-reporting.ts's `sequenceDetail` already applies to this
  // exact table.
  const { data: stepRows, error: stepsErr } = await supabase
    .from("sequence_steps")
    .select(
      "id, position, kind, wait_minutes, subject, body, branch_condition, on_true_position, on_false_position, config",
    )
    .eq("sequence_id", sequence.id)
    .eq("business_id", businessId)
    .order("position", { ascending: true })
  if (stepsErr) throw stepsErr
  const steps = (stepRows ?? []) as SequenceStepRow[]

  const savedSteps: SavedStep[] = steps.map((s) => ({ id: s.id, position: s.position }))
  const drafts: StepDraft[] = steps.map((s) => ({
    id: s.id,
    kind: s.kind,
    wait_minutes: s.wait_minutes,
    subject: s.subject,
    body: s.body,
    branch_condition: s.branch_condition,
    on_true_position: s.on_true_position,
    on_false_position: s.on_false_position,
    config: s.config,
  }))

  const stepIds = steps.map((s) => s.id)
  const sentCountByStepId: Record<string, number> = {}
  if (stepIds.length > 0) {
    // Grouped by hand, for the same reason lib/db/sequence-reporting.ts's
    // report is: PostgREST cannot GROUP BY. Paginated with `fetchAllRows`
    // because a step that has been live for a while can carry more messages
    // than PostgREST's silent ~1000-row cap — the failure there is wrong
    // numbers, not an error, which for this guard means a step that HAS been
    // sent reading as safe to delete.
    type MessageRow = { step_id: string }
    const messageRows = await fetchAllRows<MessageRow>(
      (from, to) =>
        supabase
          .from("sequence_messages")
          .select("step_id")
          .eq("business_id", businessId)
          .in("step_id", stepIds)
          .order("id", { ascending: true })
          .range(from, to) as never,
    )
    for (const row of messageRows) {
      sentCountByStepId[row.step_id] = (sentCountByStepId[row.step_id] ?? 0) + 1
    }
  }

  type RunRow = { id: string; current_position: number }
  const runRows = await fetchAllRows<RunRow>(
    (from, to) =>
      supabase
        .from("sequence_runs")
        .select("id, current_position")
        .eq("business_id", businessId)
        .eq("sequence_id", sequence.id)
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to) as never,
  )

  return {
    id: sequence.id,
    key: sequence.key,
    name: sequence.name,
    status: sequence.status,
    steps: savedSteps,
    drafts,
    sentCountByStepId,
    activeRuns: runRows,
  }
}

/**
 * Flips a sequence's on/off switch. Returns `null` — never throws — when the
 * key does not belong to this tenant, so the route can answer 404 instead of
 * a 500 that reads like a database outage.
 *
 * Returns the status the sequence had A MOMENT AGO (`from`), for the caller to
 * report what changed — by the time this function returns, the current status
 * is already `status`.
 */
export async function setSequenceStatus(
  businessId: string,
  key: string,
  status: "active" | "paused",
): Promise<{ id: string; from: string } | null> {
  const supabase = getClient()

  const { data: existing, error: readErr } = await supabase
    .from("sequences")
    .select("id, status")
    .eq("key", key)
    .eq("business_id", businessId)
    .maybeSingle()
  if (readErr) throw readErr
  if (!existing) return null
  const row = existing as { id: string; status: string }

  const { error: updateErr } = await supabase
    .from("sequences")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("business_id", businessId)
  if (updateErr) throw updateErr

  return { id: row.id, from: row.status }
}

/**
 * Writes a whole step list atomically via the `save_sequence_steps` plpgsql
 * function (migration 00256). ONE rpc call — see that migration's header for
 * why a multi-statement client-side save is not safe here.
 *
 * TRANSLATES `plan` into the RPC's shapes; it does NOT pass it through
 * unchanged. `StepSavePlan.repoint` carries `{ runId, from, to }` — `from` is
 * for the UI summary the caller builds, and SQL has no use for it, so only
 * `run_id`/`to_position` cross this boundary. `StepSavePlan.exit` carries
 * `{ runId, from }` and the RPC wants a plain `uuid[]`, so only the ids cross.
 * Renaming the SQL parameters to camelCase instead would break this
 * database's snake_case convention, so the mapping happens here rather than
 * there. `p_steps` needs no mapping: `StepDraft`'s fields already match, field
 * for field, what migration 00256's header says each element of `p_steps`
 * must look like.
 */
export async function saveSequenceSteps(
  businessId: string,
  sequenceId: string,
  steps: StepDraft[],
  plan: StepSavePlan,
): Promise<void> {
  const supabase = getClient()

  const { error } = await supabase.rpc("save_sequence_steps", {
    p_business_id: businessId,
    p_sequence_id: sequenceId,
    p_steps: steps,
    p_repoint: plan.repoint.map((r) => ({ run_id: r.runId, to_position: r.to })),
    p_exit_run_ids: plan.exit.map((e) => e.runId),
  })
  // NOT swallowed. The plpgsql function's own §4.6 refusal (RAISE EXCEPTION on
  // a step that has already sent a message) reaches the caller as a real
  // error here — the route's own 409 pre-check exists to make that a readable
  // sentence in the ordinary case, not to be the only thing standing between
  // a bypass and a destroyed send history.
  if (error) throw error
}
