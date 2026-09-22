// app/api/admin/pipeline/boards/[id]/stages/route.ts — the whole-list save of
// a pipeline board's stage list. Body:
// { stages: StageDraft[]; destinations?: Record<string, string> }. Same
// template as app/api/admin/pipeline/boards/[id]/route.ts (Task 4): withAudit,
// auth() -> 401, canAccessAdminPath -> 403, resolveAdminTenantForRequest with
// the NoAccessibleBusinessError -> 403 branch, a readable DAL Error -> 400.
//
// `stages`' array ORDER is the position — lib/db/pipeline.ts's
// `savePipelineStages` doc comment says so outright (`p_stages`' order is
// read `WITH ORDINALITY` by the SQL side), so this route never accepts or
// forwards a `position` field. A submitted `position` is rejected outright
// (`.strict()` below) rather than silently stripped by Zod's default
// unknown-key behaviour — a client sending it almost certainly believes it
// controls ordering, and tolerating it in silence would ship that belief
// straight into a bug the first time array order and a stale `position`
// disagreed.
//
// `savePipelineStages` and `readStagesForEdit` (lib/db/pipeline.ts, Task 3)
// are NOT modified by this route. Notably, `savePipelineStages` itself never
// notices a nonexistent or foreign-tenant `pipelineId` — the `readStagesForEdit`
// read it does internally is scoped to (id, businessId) and just comes back
// empty, and `validateStageList` (pure, no IO) runs BEFORE that read, so an
// internally-valid submitted list would sail straight through both checks
// and only fail, opaquely, on the RPC's foreign-key constraint. This route
// closes that gap itself with its OWN `readStagesForEdit` call, before ever
// reaching `savePipelineStages`: every real board is seeded with both a Won
// and a Lost stage (`createPipelineBoard`) and `validateStageList` refuses
// any save that would leave a board without either, so an EMPTY stage list
// read back for (id, businessId) can only mean one thing — there is no such
// board for THIS tenant, whether the id never existed or belongs to another
// one. Thrown as the exact same `PipelineBoardNotFoundError` Task 4's PATCH
// route surfaces as 404, with the exact same message, so neither response can
// be used to learn which board ids exist on other tenants (see that route's
// header for the full argument). Yes, this means a real save reads the stage
// list twice (once here, once inside `savePipelineStages`) — an accepted,
// documented inefficiency rather than a hidden one, in the same spirit as the
// "not atomic" writes already called out elsewhere in lib/db/pipeline.ts.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { PipelineBoardNotFoundError, readStagesForEdit, savePipelineStages } from "@/lib/db/pipeline"
// The two length caps live in the PURE module, not here: the editor screen
// (components/admin/pipeline-settings.tsx) is a client component and cannot
// import this route, so a copy of the numbers over there would be a second
// home for them — and a box that accepts what this route refuses is a 400 a
// coach cannot act on. Same numbers, same messages, one definition.
import { MAX_STAGE_KEY_LENGTH, MAX_STAGE_NAME_LENGTH } from "@/lib/lead-engine/stage-list"
// Type-only, so the closed audit taxonomy is checked at compile time — a
// slug that is not a row in `AUDIT_ACTIONS` stops the build instead of
// writing a row the log viewer cannot name. Same convention as
// app/api/ask/route.ts and lib/lead-engine/chat/escalate.ts.
import type { AuditAction } from "@/lib/audit/actions"

const STAGES_SAVED_AUDIT_ACTION: AuditAction = "pipeline.stages_saved"

/**
 * The internal channel the handler hands the BEFORE/AFTER stage lists to the
 * `metadata` callback on. Nothing else can carry them: this route's `target`
 * resolver reads the ORIGINAL request (see its comment), `withAudit` runs
 * that resolver BEFORE `metadata`, and a request body can only be read once —
 * so by the time `metadata` runs there is no request left to parse, and the
 * "before" was never in the request anyway. It is read out of the database by
 * the pre-check below.
 *
 * `x-audit-` prefix is load-bearing: `stripAuditHeaders` (lib/audit/with-audit.ts)
 * deletes every header with it AFTER `metadata` has read them, so this never
 * reaches the browser. Same channel app/api/admin/sms/send/route.ts uses for
 * `x-audit-consent-override`.
 *
 * URI-ENCODED, not raw JSON. A stage `key` is submitted by the client and
 * `Headers.set` throws on a value outside latin-1 — one emoji in a key would
 * turn a successful save into a 500. `encodeURIComponent` makes any string
 * safe, and the callback decodes it.
 */
const AUDIT_STAGE_CHANGE_HEADER = "x-audit-stage-change"

/**
 * How many stage keys go into one list on the audit row.
 *
 * `scrubMetadata` (lib/audit/scrub.ts) does not truncate an over-large
 * metadata bag — it THROWS THE WHOLE THING AWAY and keeps a 1KB sample. A
 * stage key can be 100 characters (MAX_STAGE_KEY_LENGTH), so a board with
 * enough of them could push four lists past 8KB and lose every field,
 * including the small ones that matter most. 40 per list keeps the worst case
 * around 4KB while being far more stages than a real board has; anything past
 * it is recorded as a count instead of silently dropped.
 */
const MAX_AUDIT_KEYS = 40

function capKeys(keys: string[]): { keys: string[]; omitted?: number } {
  if (keys.length <= MAX_AUDIT_KEYS) return { keys }
  return { keys: keys.slice(0, MAX_AUDIT_KEYS), omitted: keys.length - MAX_AUDIT_KEYS }
}

/**
 * What this save DID, in stage KEYS — the thing `pipeline.stages_saved` was
 * missing entirely (whole-branch review, Important 5).
 *
 * Spec §2.3 collapsed the old design's five per-stage audit slugs into this
 * one with the argument that "one save is one audit row … the metadata
 * carries the before/after stage list". No metadata callback was ever
 * written, so what an investigator actually got was a board id and
 * `"5 stage(s) submitted"` — for THE destructive operation in this feature,
 * the one that deletes stages and relocates real cards.
 *
 * KEYS, NOT NAMES. A key is immutable once created (invariant 4) and a name
 * is the thing a coach edits, often in the very save being recorded — so a
 * row built from names could describe a stage nobody can find afterwards.
 * `added` carries the new stages' keys because a brand-new stage has no id
 * yet; everything else is matched on id and reported by key.
 */
function describeStageChange(
  existing: Array<{ id: string; key: string }>,
  submitted: Array<{ id: string | null; key: string }>,
  destinations: Record<string, string>,
  cardCountByStageId: Map<string, number>,
): Record<string, unknown> {
  const keyById = new Map(existing.map((s) => [s.id, s.key]))
  const submittedIds = new Set(submitted.map((s) => s.id).filter((id): id is string => id !== null))

  const before = existing.map((s) => s.key)
  const after = submitted.map((s) => s.key)
  const removed = existing.filter((s) => !submittedIds.has(s.id)).map((s) => s.key)
  const added = submitted.filter((s) => s.id === null).map((s) => s.key)

  // Only the moves the save will actually perform: a destination named for a
  // stage that is staying, or for one holding no cards, produces no move —
  // `planStageSave` ignores both, and an audit row claiming a move that did
  // not happen is worse than one claiming none.
  const movedCards = Object.entries(destinations)
    .filter(([from]) => !submittedIds.has(from) && (cardCountByStageId.get(from) ?? 0) > 0)
    .map(([from, to]) => ({
      from: keyById.get(from) ?? from,
      to: keyById.get(to) ?? to,
      cards: cardCountByStageId.get(from) ?? 0,
    }))

  const b = capKeys(before)
  const a = capKeys(after)
  const r = capKeys(removed)
  const ad = capKeys(added)

  return {
    stages_before: b.keys,
    stages_after: a.keys,
    stages_removed: r.keys,
    stages_added: ad.keys,
    moved_cards: movedCards.slice(0, MAX_AUDIT_KEYS),
    ...(b.omitted || a.omitted || r.omitted || ad.omitted || movedCards.length > MAX_AUDIT_KEYS
      ? { lists_truncated: true }
      : {}),
  }
}

/**
 * "3 stages submitted", never "3 stage(s) submitted" (controller ruling R16,
 * applied again here by the whole-branch review). This label is printed on
 * /admin/audit-logs, a screen a coach reads — the same argument that took
 * `card(s)` out of `strandedStageProblems`.
 */
function stagesSubmittedLabel(count: number): string {
  return `${count} ${count === 1 ? "stage" : "stages"} submitted`
}

const StageDraftSchema = z
  .object({
    id: z.string().nullable(),
    key: z.string().trim().max(MAX_STAGE_KEY_LENGTH, `Stage key must be ${MAX_STAGE_KEY_LENGTH} characters or fewer.`),
    name: z
      .string()
      .trim()
      .max(MAX_STAGE_NAME_LENGTH, `Stage name must be ${MAX_STAGE_NAME_LENGTH} characters or fewer.`),
    kind: z.enum(["open", "won", "lost"]),
    amberAfterDays: z.number().int().nullable(),
    redAfterDays: z.number().int().nullable(),
  })
  // Rejects a `position` field (or any other extra key) outright — see the
  // header comment above for why this is a deliberate refusal, not an
  // oversight. Zod's default behaviour on a plain z.object() is to STRIP
  // unknown keys and answer 200, which is exactly the "silently appears to
  // work" trap this repo has been burned by before.
  .strict()

const SaveStagesSchema = z.object({
  stages: z.array(StageDraftSchema),
  destinations: z.record(z.string(), z.string()).optional(),
})

export const PUT = withAudit(
  {
    action: STAGES_SAVED_AUDIT_ACTION,
    category: "admin_write",
    // Reads the ORIGINAL request UNCONDITIONALLY — the handler below always
    // parses `request.clone()`, so the body here is still fresh no matter
    // which branch the handler took (401/403/400/404/200; `withAudit` only
    // ever calls this AFTER the handler has already returned). Reversed —
    // the handler reading the original and this reading a clone of an
    // already-consumed stream — `request.json()` here throws on every save
    // attempt, `resolveTarget` (lib/audit/with-audit.ts) degrades that to no
    // target at all rather than losing the whole audit row, and the label
    // below silently vanishes from every stages_saved row, success or not.
    target: async (request, ctx) => {
      const { id } = await ctx.params
      const requestBody = (await request.json().catch(() => null)) as { stages?: unknown[] } | null
      const submittedCount = Array.isArray(requestBody?.stages) ? requestBody.stages.length : undefined
      return {
        type: "pipeline_board",
        id,
        ...(submittedCount !== undefined ? { label: stagesSubmittedLabel(submittedCount) } : {}),
      }
    },
    // WHAT CHANGED, not merely which board. See `describeStageChange` above
    // for why this row needs it more than any other in this directory, and
    // `AUDIT_STAGE_CHANGE_HEADER` for why it arrives on a header rather than
    // by re-reading the request.
    metadata: async (_request, response) => {
      const raw = response.headers.get(AUDIT_STAGE_CHANGE_HEADER)
      if (!raw) return {}
      try {
        return JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>
      } catch {
        return {}
      }
    },
  },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!(await canAccessAdminPath(session.user, request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    const { id } = await ctx.params

    // A CLONE — the `target` resolver above reads the ORIGINAL after this
    // handler returns; reading it here directly would leave nothing for it.
    const body = await request.clone().json().catch(() => null)
    const parsed = SaveStagesSchema.safeParse(body)
    if (!parsed.success) {
      // Repo trap: a bare "Invalid request body" hides WHICH field failed —
      // a `.max()` rejects the whole payload with a message that reads like
      // every other field failed too. Name the field explicitly.
      const issue = parsed.error.issues[0]
      return NextResponse.json(
        {
          error: issue?.message ?? "Invalid request body.",
          ...(issue && issue.path.length > 0 ? { field: issue.path.join(".") } : {}),
        },
        { status: 400 },
      )
    }

    // Set once the board's CURRENT stage list is known, and stamped onto
    // every response produced after that point — the refusals included. An
    // audit row for a save that was REFUSED is worth exactly as much as one
    // for a save that landed: it says what somebody tried to do.
    let changeHeader: string | null = null
    const stamped = (response: NextResponse) => {
      if (changeHeader) response.headers.set(AUDIT_STAGE_CHANGE_HEADER, changeHeader)
      return response
    }

    try {
      // Existence + tenant-scoping check — see the header comment for why
      // this route cannot rely on `savePipelineStages` alone to notice a
      // nonexistent or foreign-tenant board.
      const { stages: existingStages, cardCountByStageId } = await readStagesForEdit(id, businessId)
      if (existingStages.length === 0) {
        throw new PipelineBoardNotFoundError(id)
      }

      changeHeader = encodeURIComponent(
        JSON.stringify(
          describeStageChange(existingStages, parsed.data.stages, parsed.data.destinations ?? {}, cardCountByStageId),
        ),
      )

      const result = await savePipelineStages({
        pipelineId: id,
        businessId,
        stages: parsed.data.stages,
        destinations: parsed.data.destinations ?? {},
      })

      if (!result.ok) {
        // The problems array survives to the client INTACT — StageProblem's
        // `index`/`message` shape is what Task 7's editor renders a specific
        // row's error (or a board-level one, at `index: null`) from. Flattening
        // this to a string here would throw that structure away for good.
        return stamped(
          NextResponse.json({ error: "This stage list could not be saved.", problems: result.problems }, { status: 400 }),
        )
      }

      return stamped(NextResponse.json({ ok: true, stageCount: parsed.data.stages.length }))
    } catch (err) {
      // `PipelineBoardNotFoundError` covers BOTH a nonexistent id and a
      // foreign tenant's board — same status, same message, on purpose (see
      // the header comment, and app/api/admin/pipeline/boards/[id]/route.ts's
      // own comment on the same equivalence). Every other DAL refusal
      // (`save_pipeline_stages failed: …`) is a readable Error and surfaces
      // as 400, not 500.
      if (err instanceof PipelineBoardNotFoundError) {
        return stamped(NextResponse.json({ error: err.message }, { status: 404 }))
      }
      const message = err instanceof Error ? err.message : "Failed to save stages"
      return stamped(NextResponse.json({ error: message }, { status: 400 }))
    }
  },
)
