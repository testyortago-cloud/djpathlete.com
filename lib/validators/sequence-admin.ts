// lib/validators/sequence-admin.ts — request shapes for the two sequence
// editor routes: PATCH .../status and PUT .../steps.
//
// SHAPE ONLY. Business rules — a subject line, a wait above zero, a branch
// predicate the tick actually knows — are `validateStepList`'s job
// (lib/lead-engine/step-list.ts), which the tick shares, so they are not
// re-implemented here. This file exists so a malformed body fails as a clean
// 400 instead of a TypeError thrown from inside a pure function that assumed
// its input already matched `StepDraft`.

import { z } from "zod"

/** Mirrors `StepKind` in lib/automation/sequence-tick.ts. */
export const STEP_KINDS = ["email", "sms", "wait", "branch", "tag", "stage", "alert", "stop"] as const

/** Mirrors `BranchCondition` in lib/automation/sequence-tick.ts exactly. */
const branchConditionSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("has_phone") }),
    z.object({ kind: z.literal("has_user") }),
    z.object({ kind: z.literal("has_consent"), channel: z.enum(["email", "sms"]) }),
    z.object({ kind: z.literal("source_is"), value: z.string() }),
  ])
  .nullable()

/** Mirrors `StepDraft` in lib/lead-engine/step-list.ts, field for field. */
export const stepDraftSchema = z.object({
  // `null` for a step that does not exist in the database yet — see
  // step-list.ts's own header. Deliberately NOT constrained to uuid format:
  // planStepSave and the RPC are what decide whether an id refers to a real
  // row of THIS sequence and THIS tenant, not this shape check.
  id: z.string().min(1).nullable(),
  kind: z.enum(STEP_KINDS),
  wait_minutes: z.number().int().nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  branch_condition: branchConditionSchema,
  // Array indices into the SAME request's `steps`, not database ids — see
  // step-list.ts's header: "the array index is the position". Any integer is
  // syntactically legal here; `validateStepList`'s `stepGraphEdges` is what
  // drops one that falls outside the list.
  on_true_position: z.number().int().nullable(),
  on_false_position: z.number().int().nullable(),
  config: z.record(z.string(), z.unknown()),
})

export const saveStepsRequestSchema = z.object({
  steps: z.array(stepDraftSchema),
})

export const setSequenceStatusRequestSchema = z.object({
  on: z.boolean(),
})
