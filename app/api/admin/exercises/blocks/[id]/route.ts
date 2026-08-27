// Remove one exercise block, putting the exercise back in front of the AI.
//
// Scoped by coach_id in the DAL, so one coach can never delete another's block
// by guessing an id.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { deleteExerciseBlock } from "@/lib/db/exercise-blocks"

export const DELETE = withAudit(
  {
    action: "exercise_block.removed",
    category: "admin_write",
    target: async (_request, context) => {
      const { id } = await context.params
      return id ? { type: "exercise_block", id } : undefined
    },
  },
  async (_request, context) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await context.params
    const removed = await deleteExerciseBlock(session.user.id, id)
    if (!removed) return NextResponse.json({ error: "Block not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  },
)
