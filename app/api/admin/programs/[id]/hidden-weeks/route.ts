import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { getProgramById, updateProgram } from "@/lib/db/programs"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { setWeekHidden } from "@/lib/programs/week-visibility"

const bodySchema = z.object({ weekNumber: z.number().int().min(1), hidden: z.boolean() })

/**
 * Hide or show one week on the program itself: for every client on it, including
 * clients given it later. Works with no client assigned. A client's own "Show now"
 * (program_week_access.visibility = 'shown') still opens the week for that client.
 */
export const POST = withAudit(
  {
    action: "program.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "program", id }
    },
  },
  async (request, context) => {
    try {
      const session = await auth()
      if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
        return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
      }

      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 })
      const { weekNumber, hidden } = parsed.data

      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const program = await getProgramById(id)
      if (weekNumber > program.duration_weeks) {
        return NextResponse.json({ error: `This program has ${program.duration_weeks} weeks.` }, { status: 400 })
      }

      // ponytail: read-modify-write. Two coaches toggling different weeks in the same instant can lose
      // one toggle; move to an array_append/array_remove RPC if that ever happens.
      const updated = await updateProgram(id, {
        hidden_weeks: setWeekHidden(program.hidden_weeks ?? [], weekNumber, hidden),
      })
      return NextResponse.json({ hidden_weeks: updated.hidden_weeks ?? [] })
    } catch {
      return NextResponse.json({ error: "Couldn't change this week. Please try again." }, { status: 500 })
    }
  },
)
