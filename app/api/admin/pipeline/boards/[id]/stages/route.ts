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
        ...(submittedCount !== undefined ? { label: `${submittedCount} stage(s) submitted` } : {}),
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

    try {
      // Existence + tenant-scoping check — see the header comment for why
      // this route cannot rely on `savePipelineStages` alone to notice a
      // nonexistent or foreign-tenant board.
      const { stages: existingStages } = await readStagesForEdit(id, businessId)
      if (existingStages.length === 0) {
        throw new PipelineBoardNotFoundError(id)
      }

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
        return NextResponse.json({ error: "This stage list could not be saved.", problems: result.problems }, { status: 400 })
      }

      return NextResponse.json({ ok: true, stageCount: parsed.data.stages.length })
    } catch (err) {
      // `PipelineBoardNotFoundError` covers BOTH a nonexistent id and a
      // foreign tenant's board — same status, same message, on purpose (see
      // the header comment, and app/api/admin/pipeline/boards/[id]/route.ts's
      // own comment on the same equivalence). Every other DAL refusal
      // (`save_pipeline_stages failed: …`) is a readable Error and surfaces
      // as 400, not 500.
      if (err instanceof PipelineBoardNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 })
      }
      const message = err instanceof Error ? err.message : "Failed to save stages"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  },
)
