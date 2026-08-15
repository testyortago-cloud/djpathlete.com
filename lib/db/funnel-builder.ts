// lib/db/funnel-builder.ts — DAL for the conversational page builder (00203).
//
// `lib/db/funnels.ts` owns the funnel, its steps, and PUBLISHED versions. This
// file owns the DRAFT and the turn log beside it: `funnel_step_turns` plus the
// `funnel_steps.doc_revision` counter. Same conventions as its sibling — a
// local `getClient()` on the service-role client, rows cast here because the
// `Database` generic is dropped repo-wide, and a thrown Error on any PostgREST
// error.
//
// A TURN IS NOT A VERSION. `funnel_step_versions` records what visitors were
// served; a turn records what the owner TRIED. A turn that failed to compile
// has no version row to write, and `getPublishedStep(..., {includeUnpublished:
// true})` would happily start serving un-reviewed AI drafts to anyone holding
// a preview link. That is why 00203 adds a table instead of reusing that one.
//
// ---------------------------------------------------------------------------
// THE OPTIMISTIC LOCK IS THE LOAD-BEARING PART OF THIS FILE.
// ---------------------------------------------------------------------------
// Two admin tabs open on the same page is not a hypothetical — it is the
// normal way someone works on a funnel while looking at the live one. Without
// a lock, tab B's build silently overwrites tab A's, and neither owner is told
// anything: the document is a FULL SNAPSHOT per turn, so a lost update is not
// a merge conflict, it is a page silently reverting several turns.
//
// The check is therefore PART OF THE WRITE, never a read-then-write:
//
//     .update({ doc_revision: expected + 1, ... })
//     .eq("id", stepId)
//     .eq("doc_revision", expected)      <-- compare-and-swap, one statement
//
// Zero rows updated means somebody else moved first, and the caller gets
// `{ok: false, reason: "stale_revision", currentRevision}` to turn into a 409
// so the client re-syncs. Deliberately NOT the `publishStep` pattern at
// `lib/db/funnels.ts:223-231`, which computes its next number by reading the
// max and then inserting: that races against its own UNIQUE constraint on
// rapid iteration, and the governing plan names it as a reason not to reuse
// `funnel_step_versions` for turns. Do not copy it here.
//
// `UNIQUE (step_id, revision)` on `funnel_step_turns` is the second half of
// the same guarantee: even if the compare-and-swap were somehow bypassed, two
// turns can never claim the same revision number.
//
// APPEND-ONLY, ALWAYS. `revertToRevision` does not delete or rewind anything —
// it copies an old document forward and appends a NEW head turn with
// `source: 'revert'`. Undo is itself undoable and history stays linear, which
// matters because the chat transcript is the owner's only view of what
// happened.

import { createServiceRoleClient } from "@/lib/supabase"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"

function getClient() {
  return createServiceRoleClient()
}

// ---------------------------------------------------------------------------
// Row types
//
// Declared HERE rather than in `types/database.ts` where `Funnel` /
// `FunnelStep` / `FunnelStepVersion` live. That is a deliberate, narrow
// deviation from convention forced by Stage 1.7's scope, not a new pattern to
// follow: these should move next to their siblings the next time that file is
// open. `FunnelStep` likewise does not yet declare the `doc_revision` column
// 00203 adds, which is why `getDraft` reads and returns it through its own
// row shape below instead of through `getStep()`.
// ---------------------------------------------------------------------------

export type TurnRole = "user" | "assistant"

/**
 * Where the turn came from. `ai` is a model call, `inspector` is a direct
 * property edit made in the UI without the model, `revert` is the head turn
 * `revertToRevision` appends.
 *
 * `review` is the AI review stage (`lib/funnels/sections/review/`), which runs
 * AFTER an `ai` turn has already committed and appends its improvements
 * separately. Kept distinct from `ai` deliberately: "Go back to here" has to be
 * able to undo the polish without also throwing away the draft it polished, and
 * the transcript has to be able to say which of the two changed what.
 *
 * Constrained in the database by `funnel_step_turns_source_check` — widening
 * this union without the matching migration writes a row Postgres rejects.
 * (00209 is the one that added `review`.)
 */
export type TurnSource = "ai" | "inspector" | "revert" | "review"

export type TurnStatus = "complete" | "failed"

export type TurnCompileStatus = "ok" | "warnings" | "failed"

export interface FunnelStepTurn {
  id: string
  step_id: string
  revision: number
  parent_revision: number | null
  role: TurnRole
  source: TurnSource
  status: TurnStatus
  message: string
  ops: unknown
  /** FULL SectionDoc after this turn — NOT a diff. Null on user turns/failures. */
  doc: unknown | null
  compile_status: TurnCompileStatus | null
  compile_problems: unknown
  unresolved: unknown
  model: string | null
  tokens_input: number | null
  tokens_output: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  latency_ms: number | null
  error_message: string | null
  blocked: boolean
  created_by: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// getDraft
// ---------------------------------------------------------------------------

export interface StepDraft {
  /** The stored document, when `project_data` holds a valid `SectionDoc`. */
  doc: SectionDoc | null
  /**
   * TRUE when `project_data` holds SOMETHING that is not a valid `SectionDoc`
   * — legacy GrapesJS editor state from before 00203, or corruption.
   *
   * THIS FLAG EXISTS BECAUSE COLLAPSING IT INTO `doc: null` IS SILENT DATA
   * LOSS. "Never built" and "holds a page I cannot read" look identical to a
   * caller that only sees null, and the natural response to the first — start
   * a fresh document and write it — destroys the owner's existing page in the
   * second. A route MUST branch on this and refuse rather than overwrite.
   */
  docInvalid: boolean
  /** `funnel_steps.doc_revision`. Pass this back as `expectedRevision`. */
  revision: number
}

/**
 * The current draft document and its revision. Returns `null` when the STEP
 * itself does not exist — distinct from a step that exists with no document,
 * which is `{doc: null, docInvalid: false, revision: 0}`.
 */
export async function getDraft(stepId: string): Promise<StepDraft | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_steps")
    .select("project_data, doc_revision")
    .eq("id", stepId)
    .maybeSingle()
  if (error) throw new Error(`getDraft: ${error.message}`)
  if (!data) return null

  const row = data as { project_data: unknown; doc_revision: number | null }
  const revision = row.doc_revision ?? 0

  if (row.project_data === null || row.project_data === undefined) {
    return { doc: null, docInvalid: false, revision }
  }

  // Parsed rather than cast. `project_data` is `jsonb` and typed `unknown`
  // end-to-end, so a cast alone would be a promise nothing checks — and this
  // is the boundary where a legacy GrapesJS blob and a real document are
  // indistinguishable by shape alone.
  //
  // The parse RESULT is discarded and the stored value returned, matching
  // `doc.ts` and `apply.ts`: `safeParse` rebuilds its entire output tree, and
  // `SectionDoc` is a hand-written interface (`Section.props` is
  // `Record<string, unknown>`, which Zod widens to `unknown`), so the rebuilt
  // copy is both a different object graph and a worse type. Validate, then
  // cast — the repo's DAL convention, and here it also means the document a
  // caller edits is byte-identical to the one in the column.
  const parsed = sectionDocSchema.safeParse(row.project_data)
  if (!parsed.success) return { doc: null, docInvalid: true, revision }
  return { doc: row.project_data as SectionDoc, docInvalid: false, revision }
}

// ---------------------------------------------------------------------------
// appendTurn
// ---------------------------------------------------------------------------

export interface AppendTurnInput {
  stepId: string
  /**
   * The revision the caller believes is current, from `getDraft`. The write
   * only lands if the row still carries it. REQUIRED — an optional lock is
   * not a lock, it is a default that every caller silently opts out of.
   */
  expectedRevision: number
  role: TurnRole
  source?: TurnSource
  status?: TurnStatus
  /** Prose only: the owner's message, or the reply + change receipt. */
  message?: string
  /** The ops the model emitted, kept for debugging "why did it do that". */
  ops?: unknown
  /**
   * The FULL document after applying ops. When present it is validated and
   * written to `funnel_steps.project_data`; when omitted the draft is left
   * exactly as it was and only the revision moves — which is what a user turn
   * and a failed turn both want.
   */
  doc?: SectionDoc | null
  compileStatus?: TurnCompileStatus | null
  compileProblems?: unknown
  /** `ResolveResult.unresolved`. Non-empty means publish is blocked. */
  unresolved?: unknown
  model?: string | null
  tokensInput?: number | null
  tokensOutput?: number | null
  cacheReadTokens?: number | null
  cacheCreationTokens?: number | null
  latencyMs?: number | null
  errorMessage?: string | null
  /** TRUE when the assistant declined the request. Stage 4 tripwire metric. */
  blocked?: boolean
  createdBy?: string | null
}

export type AppendTurnResult =
  | { ok: true; turn: FunnelStepTurn; revision: number }
  /** Somebody else wrote first. The route turns this into a 409. */
  | { ok: false; reason: "stale_revision"; currentRevision: number }
  | { ok: false; reason: "not_found" }

/** Reads just the revision, for reporting what a stale caller should re-sync to. */
async function readRevision(stepId: string): Promise<number | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_steps")
    .select("doc_revision")
    .eq("id", stepId)
    .maybeSingle()
  if (error) throw new Error(`readRevision: ${error.message}`)
  if (!data) return null
  return (data as { doc_revision: number | null }).doc_revision ?? 0
}

/**
 * Appends one turn and moves the step to the next revision, atomically enough
 * that a concurrent writer loses rather than clobbers.
 *
 * ORDER MATTERS AND IS DELIBERATE: the compare-and-swap on `funnel_steps`
 * happens FIRST, the log row second. PostgREST gives us no transaction across
 * two statements, so one of the two failure windows has to be chosen:
 *
 *   - CAS first (chosen): if the turn insert then fails, the draft and its
 *     revision are consistent with each other and the TRANSCRIPT has a gap.
 *     Lossy in the log, never wrong in the state.
 *   - Insert first (rejected): if the CAS then fails as stale, an orphan turn
 *     row survives claiming a document that is not the draft — the transcript
 *     would then actively lie about what the page contains, and `listTurns`
 *     feeds both the chat and `revertToRevision`.
 *
 * A single Postgres function would close the window entirely; that is a
 * migration addition and is noted as follow-up rather than smuggled in here.
 *
 * THROWS on an invalid `doc`, and validates BEFORE the swap so a malformed
 * document can never bump the revision. That is not the same failure class as
 * a stale revision: a stale revision is two humans working at once and is
 * reported as a result, a malformed document is a caller bug.
 */
export async function appendTurn(input: AppendTurnInput): Promise<AppendTurnResult> {
  const hasDoc = input.doc !== undefined && input.doc !== null
  if (hasDoc) sectionDocSchema.parse(input.doc)

  const supabase = getClient()
  const nextRevision = input.expectedRevision + 1

  const stepUpdate: Record<string, unknown> = {
    doc_revision: nextRevision,
    updated_at: new Date().toISOString(),
  }
  // Only written when this turn produced a document. A user turn or a failed
  // turn must move the revision without touching the draft.
  if (hasDoc) stepUpdate.project_data = input.doc

  const { data: swapped, error: swapError } = await supabase
    .from("funnel_steps")
    .update(stepUpdate)
    .eq("id", input.stepId)
    .eq("doc_revision", input.expectedRevision)
    .select("doc_revision")
  if (swapError) throw new Error(`appendTurn(revision swap): ${swapError.message}`)

  if (!swapped || swapped.length === 0) {
    const currentRevision = await readRevision(input.stepId)
    if (currentRevision === null) return { ok: false, reason: "not_found" }
    return { ok: false, reason: "stale_revision", currentRevision }
  }

  const { data, error } = await supabase
    .from("funnel_step_turns")
    .insert({
      step_id: input.stepId,
      revision: nextRevision,
      parent_revision: input.expectedRevision,
      role: input.role,
      source: input.source ?? "ai",
      status: input.status ?? "complete",
      message: input.message ?? "",
      ops: input.ops ?? [],
      doc: input.doc ?? null,
      compile_status: input.compileStatus ?? null,
      compile_problems: input.compileProblems ?? [],
      unresolved: input.unresolved ?? [],
      model: input.model ?? null,
      tokens_input: input.tokensInput ?? null,
      tokens_output: input.tokensOutput ?? null,
      cache_read_tokens: input.cacheReadTokens ?? null,
      cache_creation_tokens: input.cacheCreationTokens ?? null,
      latency_ms: input.latencyMs ?? null,
      error_message: input.errorMessage ?? null,
      blocked: input.blocked ?? false,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single()
  if (error) throw new Error(`appendTurn(insert): ${error.message}`)

  return { ok: true, turn: data as FunnelStepTurn, revision: nextRevision }
}

// ---------------------------------------------------------------------------
// listTurns
// ---------------------------------------------------------------------------

/**
 * How many turns one transcript read returns. PostgREST caps an unbounded
 * `.select()` at roughly 1000 rows, and this table grows by one row per turn
 * forever, so an unbounded read is a latent bug that only appears on the
 * busiest page in the account.
 */
export const TURN_HISTORY_LIMIT = 200

/**
 * The transcript, OLDEST FIRST, capped at the most recent
 * `TURN_HISTORY_LIMIT` turns.
 *
 * The two halves of that sentence pull in opposite directions and the order of
 * operations is the whole point: the query sorts DESCENDING (which is also the
 * order the `(step_id, revision DESC)` index is built in) so `.limit()` takes
 * the NEWEST 200, and the result is reversed in memory for the caller. Sorting
 * ascending and limiting would return the OLDEST 200 — on a page with 300
 * turns the chat would silently show the first day's conversation and none of
 * today's, which reads as data loss rather than a paging bound.
 */
export async function listTurns(stepId: string): Promise<FunnelStepTurn[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_step_turns")
    .select("*")
    .eq("step_id", stepId)
    .order("revision", { ascending: false })
    .limit(TURN_HISTORY_LIMIT)
  if (error) throw new Error(`listTurns: ${error.message}`)
  return ((data ?? []) as FunnelStepTurn[]).slice().reverse()
}

/** One turn by its revision number, or null. Used by the revert path. */
export async function getTurnByRevision(
  stepId: string,
  revision: number,
): Promise<FunnelStepTurn | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_step_turns")
    .select("*")
    .eq("step_id", stepId)
    .eq("revision", revision)
    .maybeSingle()
  if (error) throw new Error(`getTurnByRevision: ${error.message}`)
  return (data as FunnelStepTurn | null) ?? null
}

// ---------------------------------------------------------------------------
// revertToRevision
// ---------------------------------------------------------------------------

export interface RevertInput {
  stepId: string
  /** The revision whose document should become the draft again. */
  toRevision: number
  createdBy?: string | null
  /** Prose for the appended head turn. A default is supplied. */
  message?: string
}

export type RevertResult =
  | { ok: true; turn: FunnelStepTurn; revision: number }
  | { ok: false; reason: "stale_revision"; currentRevision: number }
  | { ok: false; reason: "not_found" }
  /** No turn at that revision for this step. */
  | { ok: false; reason: "revision_not_found" }
  /** That turn carries no document — a user turn, or one that failed. */
  | { ok: false; reason: "revision_has_no_doc" }

/**
 * Puts an earlier turn's document back, by COPYING IT FORWARD.
 *
 * APPEND-ONLY: nothing is deleted and no counter is rewound. The old document
 * is written into `project_data`, the revision moves FORWARD, and a new head
 * turn is appended with `source: 'revert'`. So undo is itself undoable, the
 * transcript stays linear and honest about what happened, and
 * `funnel_step_turns.revision` keeps meaning "when", never "which version" —
 * two turns can hold identical documents and that is fine.
 *
 * Reverting to a turn that carries NO document is refused rather than
 * silently treated as "clear the page": user turns and failed turns both have
 * `doc IS NULL`, they are both visible in the chat, and both are plausible
 * things for a click to land on.
 *
 * The current revision is read and then compare-and-swapped, so a concurrent
 * write between the two produces `stale_revision` rather than a lost update.
 * A caller-supplied `expectedRevision` would remove the read; it is left out
 * because a revert is a click on a specific turn in a transcript the client
 * may have been holding for a while, and re-reading is strictly safer than
 * trusting an old number the UI never had reason to refresh.
 */
export async function revertToRevision(input: RevertInput): Promise<RevertResult> {
  const target = await getTurnByRevision(input.stepId, input.toRevision)
  if (!target) return { ok: false, reason: "revision_not_found" }
  if (target.doc === null || target.doc === undefined) {
    return { ok: false, reason: "revision_has_no_doc" }
  }

  const currentRevision = await readRevision(input.stepId)
  if (currentRevision === null) return { ok: false, reason: "not_found" }

  const parsed = sectionDocSchema.safeParse(target.doc)
  if (!parsed.success) {
    // A stored document that no longer satisfies the schema is not something
    // to write back into the draft — the registry may have tightened since it
    // was saved. Loud, because silently reverting to a document the renderer
    // will reject is worse than refusing.
    throw new Error(
      `revertToRevision: turn ${input.toRevision} holds a document that is no longer a valid SectionDoc`,
    )
  }

  const result = await appendTurn({
    stepId: input.stepId,
    expectedRevision: currentRevision,
    role: "assistant",
    source: "revert",
    status: "complete",
    message: input.message ?? `Restored the page as it was at step ${input.toRevision}.`,
    // The STORED document, not `parsed.data` — same reasoning as `getDraft`.
    doc: target.doc as SectionDoc,
    // Carried forward so the chat can still say "this can't be published
    // because ..." for the restored document without recompiling it.
    //
    // *** THESE THREE ARE A STALE DISPLAY CACHE, NOT A VERDICT. ***
    // They were computed against the catalogue AS IT WAS at `toRevision`. If a
    // referenced program/pack/event has been deleted since, the restored head
    // turn claims `unresolved: []` and the chat will tell the owner the page is
    // publishable when it is not. The lie is cosmetic ONLY because something
    // else re-derives the verdict from the live document at publish time —
    // `gateSectionDoc` in
    // `app/api/admin/funnels/steps/[stepId]/publish/route.ts`, which runs
    // `publishGate(resolveDoc(doc, await loadCatalogues()))` before it writes
    // anything and never reads this column.
    //
    // WHEN THIS COMMENT WAS FIRST WRITTEN THAT WAS NOT TRUE. It said the same
    // thing in the present tense — "the publish gate IS
    // publishGate(resolveDoc(...))" — and the publish route implemented no gate
    // at all, so what is described here as "cosmetic, confined to the
    // transcript" was in fact the only check anywhere and it was a stale one.
    // Hence the file path above: this claim is safe to depend on exactly as
    // long as that function exists, and naming it is what makes that
    // checkable rather than assumed.
    //
    // STAGE 1.9 MUST RE-RESOLVE AFTER A REVERT rather than trust these: call
    // `resolveDoc` on the restored doc against a freshly loaded catalogue and
    // write THAT `unresolved`. The moment anything starts deriving publishable
    // from the stored column, this line becomes a live bug.
    compileStatus: target.compile_status,
    compileProblems: target.compile_problems ?? [],
    unresolved: target.unresolved ?? [],
    createdBy: input.createdBy ?? null,
  })

  if (!result.ok) return result
  return { ok: true, turn: result.turn, revision: result.revision }
}
