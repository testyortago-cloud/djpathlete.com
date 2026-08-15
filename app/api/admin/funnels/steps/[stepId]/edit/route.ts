// PUT /api/admin/funnels/steps/[stepId]/edit — the inspector's write path.
//
// The SECOND write into a `SectionDoc` that is not a model call, and the first
// one an owner triggers by clicking the page itself. `applyOps` was built for
// exactly this caller and says so in its own docblock:
//
//   "`rawOps` is deliberately `unknown` rather than `SectionOp[]`: this
//    function is the one place ops get validated, so it must be safe to call
//    with whatever a model (or, on the inspector path, a hand-built request
//    body with no AI involved at all) actually sent."
//
// So this route adds no validation of its own beyond the envelope. Restating
// what a legal op is would be a second, drifting copy of a grammar that already
// has an owner — the failure mode this subsystem has paid for three times.
//
// ---------------------------------------------------------------------------
// IT SHARES THE CHAT BUILDER'S LOCK, DELIBERATELY.
// ---------------------------------------------------------------------------
// Writing through `appendTurn` rather than a private update means a click and a
// chat turn take the same compare-and-swap on `funnel_steps.doc_revision`, so
// the two editors cannot silently overwrite each other. It also means the
// TRANSCRIPT stays an honest record of everything that changed the page: an
// inspector edit appends a turn with `source: "inspector"`, which the turn
// types have carried since the builder shipped precisely for this.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { getDraft, appendTurn } from "@/lib/db/funnel-builder"
import { applyOps, type DiffReceipt } from "@/lib/funnels/sections/apply"

/**
 * The envelope only. `ops` is `unknown[]` on purpose — see the header: the op
 * grammar has exactly one owner, and it is not this file.
 *
 * `.min(1)` is NOT redundant with `applyOps`, which treats an empty batch as a
 * legal no-op. That is right for a conversational AI turn ("what do you think
 * of the headline?") and wrong here: an empty batch would still advance the
 * revision through `appendTurn`, 409ing the owner's other tab for an edit that
 * changed nothing.
 */
const bodySchema = z.object({
  ops: z.array(z.unknown()).min(1),
  revision: z.number().int().min(0),
})

/**
 * The receipt, as a line for the chat.
 *
 * A turn with no message renders as a blank row in the transcript, so the
 * summary is built here rather than left to the UI to invent — the UI does not
 * have the receipt, and re-deriving one would mean replaying every op against
 * every intermediate document.
 */
function summarise(receipt: DiffReceipt): string {
  if (receipt.changed.length === 0) {
    return receipt.themeChanged ? "Changed the page theme." : "Edited this page."
  }

  const parts = receipt.changed.map((entry) => {
    const reasons = entry.reasons.filter((reason) => reason.length > 0)
    return reasons.length > 0 ? `${entry.label} — ${reasons.join(", ")}` : entry.label
  })

  return parts.join("; ")
}

export const PUT = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  // Params are left to inference: `withAudit`'s Handler types them as
  // `Promise<Record<string, string>>`, and a narrower annotation is not
  // assignable to it. Same reason as the tree route.
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { stepId } = await ctx.params
    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      )
    }

    try {
      const draft = await getDraft(stepId)
      if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 })

      // `docInvalid` and `doc: null` are refused SEPARATELY from each other in
      // the message and identically in the outcome. Collapsing "holds a page I
      // cannot read" into "has no page" is the silent data loss `StepDraft`
      // documents at length: the natural response to the second — start a
      // fresh document — destroys the owner's page in the first.
      if (draft.docInvalid) {
        return NextResponse.json(
          {
            error: "This page could not be edited.",
            problems: [
              "Its saved content is not a document this editor can read — either it is from the old " +
                "drag-and-drop editor, or it has been corrupted. Nothing has been lost; restore an " +
                "earlier version from the chat to carry on.",
            ],
          },
          { status: 422 },
        )
      }
      if (!draft.doc) {
        return NextResponse.json(
          {
            error: "This page could not be edited.",
            problems: ["This page has no content yet. Describe what you want in the chat and it will appear here."],
          },
          { status: 422 },
        )
      }

      // Transactional: any invalid op rejects the WHOLE batch and the stored
      // document is untouched. Reported as 422 with the specific problems,
      // matching the publish route's contract, so one client-side handler
      // covers both.
      const applied = applyOps(draft.doc, parsed.data.ops)
      if (!applied.ok) {
        return NextResponse.json(
          { error: "This change could not be applied.", problems: applied.errors },
          { status: 422 },
        )
      }

      const written = await appendTurn({
        stepId,
        expectedRevision: parsed.data.revision,
        role: "user",
        source: "inspector",
        status: "complete",
        message: summarise(applied.receipt),
        ops: parsed.data.ops,
        doc: applied.doc,
        createdBy: session.user.id,
      })

      if (!written.ok) {
        if (written.reason === "not_found") {
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }
        return NextResponse.json(
          {
            error: "This page changed in another tab. Reload before editing again.",
            code: "stale_revision",
            currentRevision: written.currentRevision,
          },
          { status: 409 },
        )
      }

      // The document goes back so the client can re-render from the same object
      // the server stored, rather than replaying the ops a second time against
      // its own copy and hoping the two agree.
      return NextResponse.json({
        revision: written.revision,
        doc: applied.doc,
        receipt: applied.receipt,
      })
    } catch (error) {
      console.error("[PUT /api/admin/funnels/steps/:id/edit]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
