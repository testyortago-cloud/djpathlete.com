// app/api/admin/sequences/[key]/steps/route.ts — saving a sequence's whole
// step list.
//
// ADMIN-ONLY, NOT PERMISSION-TIERED. Same precedent as
// .../status/route.ts and app/api/admin/sequences/enrol/route.ts: editing
// what a sequence sends carries the same blast radius as switching it on, so
// it is not gated on the `contacts` permission that merely lets someone VIEW
// /admin/sequences.
//
// THE ROUTE VALIDATES; IT DOES NOT TRUST THE BROWSER. Body shape is checked
// by `saveStepsRequestSchema` (Zod), then `validateStepList` — the SAME pure
// function `lib/automation/sequence-tick.ts`'s own author had to get right —
// runs the business rules a database CHECK constraint cannot state in
// English: a subject line, a wait above zero, a branch predicate the tick
// actually knows, every branch arm terminating rather than falling into the
// other side.
//
// THE §4.6 STEP-REMOVAL GUARD LIVES HERE *AND* IN THE PLPGSQL, DELIBERATELY,
// AND THEY ARE NOT REDUNDANT. This 409 exists so a coach reads a sentence
// instead of a raw database error; the `RAISE` inside `save_sequence_steps`
// (migration 00256) exists so the rule cannot be bypassed by any future
// caller that skips this route. Because two guards can mask each other under
// mutation, each has its own test that disables the other — see
// __tests__/api/admin/sequences/steps-route.test.ts.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { loadSequenceForEdit, saveSequenceSteps } from "@/lib/db/sequence-admin"
import { planStepSave, validateStepList, type StepDraft } from "@/lib/lead-engine/step-list"
import { saveStepsRequestSchema } from "@/lib/validators/sequence-admin"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"

function peopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`
}

export const PUT = withAudit(
  {
    action: "sequence.steps_edited",
    category: "admin_write",
    target: async (_request, ctx) => {
      const { key } = (await ctx.params) as { key: string }
      return { type: "sequence", id: key }
    },
    // COUNTS AND THE KEY ONLY — no contact ids, no email addresses, no phone
    // numbers, matching the rule app/api/admin/sequences/enrol/route.ts
    // states for its own row. "Who was re-pointed or stopped" is already
    // answerable from `sequence_runs`, whose rows this action wrote.
    metadata: async (_request, response) => {
      const body = (await response.json().catch(() => null)) as {
        sequenceKey?: string
        stepCount?: number
        repointed?: number
        exited?: number
      } | null
      if (!body) return {}
      return {
        sequence_key: body.sequenceKey,
        step_count: body.stepCount,
        repointed: body.repointed,
        exited: body.exited,
      }
    },
  },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
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

    const { key } = (await ctx.params) as { key: string }

    const raw = await request.json().catch(() => null)
    const parsed = saveStepsRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }
    const steps: StepDraft[] = parsed.data.steps

    try {
      // 1. Load for THIS tenant. 404, not an empty screen, for a key that is
      // not this business's.
      const sequence = await loadSequenceForEdit(businessId, key)
      if (!sequence) {
        return NextResponse.json({ error: "Sequence not found." }, { status: 404 })
      }

      // 2. Business rules the browser is not trusted to have enforced.
      const problems = validateStepList(steps)
      if (problems.length > 0) {
        return NextResponse.json(
          { error: "This sequence has problems that need fixing before it can be saved.", problems },
          { status: 400 },
        )
      }

      // 3. What this save does to people partway through.
      const plan = planStepSave(sequence.steps, steps, sequence.activeRuns)

      // 4. §4.6: refuse to remove a step that has ever sent a message.
      // `steps` carries every step this save is KEEPING (a surviving old
      // step still carries its real id; a new step's id is null) — anything
      // in `sequence.steps` (the OLD list) that is not among those ids is
      // being removed by this save.
      const keptIds = new Set(steps.map((s) => s.id).filter((id): id is string => id !== null))
      const removedWithSends = sequence.steps
        .filter((old) => !keptIds.has(old.id))
        .map((old) => sequence.sentCountByStepId[old.id] ?? 0)
        .filter((count) => count > 0)
      if (removedWithSends.length > 0) {
        const total = removedWithSends.reduce((sum, n) => sum + n, 0)
        const message =
          removedWithSends.length === 1
            ? `This step has already been sent to ${peopleCount(total)}, so it cannot be removed. You can change what it says, or turn the whole sequence off.`
            : `These steps have already been sent to a total of ${peopleCount(total)}, so they cannot be removed. You can change what they say, or turn the whole sequence off.`
        return NextResponse.json({ error: message }, { status: 409 })
      }

      // 5. One atomic write. save_sequence_steps (migration 00256) enforces
      // §4.6 again on its own last line — see this file's header. A rejection
      // from there reaches this catch rather than being swallowed.
      await saveSequenceSteps(businessId, sequence.id, steps, plan)

      // 6. The plan, so the screen can say what happened to the people
      // partway through — see §4.5 of the design doc.
      return NextResponse.json({
        ok: true,
        sequenceKey: key,
        stepCount: steps.length,
        repointed: plan.repoint.length,
        exited: plan.exit.length,
        plan,
      })
    } catch (error) {
      console.error("[PUT /api/admin/sequences/:key/steps]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
