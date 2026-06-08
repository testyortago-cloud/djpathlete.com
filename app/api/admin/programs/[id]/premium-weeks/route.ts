import { NextResponse } from "next/server"
import { premiumWeeksSchema } from "@/lib/validators/premium-weeks"
import { getPremiumWeeks, setPremiumWeeks } from "@/lib/db/program-week-pricing"
import { getProgramById } from "@/lib/db/programs"
import { withAudit } from "@/lib/audit/with-audit"
import { resyncProgramWeekAccess } from "@/lib/services/assign-program"

export const GET = withAudit(
  {
    action: "program.updated",
    category: "admin_read_sensitive",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "program", id }
    },
  },
  async (_request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    const { id } = await params
    const weeks = await getPremiumWeeks(id)
    return NextResponse.json({ weeks })
  },
)

export const PUT = withAudit(
  {
    action: "program.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "program", id }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const { id } = await params
      const result = premiumWeeksSchema.safeParse(await request.json())
      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid data", details: result.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const program = await getProgramById(id)
      const maxWeek = program.duration_weeks ?? 1
      const bad = result.data.weeks.find((w) => w.week_number > maxWeek)
      if (bad) {
        return NextResponse.json(
          { error: `Week ${bad.week_number} is beyond the program's ${maxWeek} weeks.` },
          { status: 400 },
        )
      }
      const weeks = await setPremiumWeeks(id, result.data.weeks)
      await resyncProgramWeekAccess(id)
      return NextResponse.json({ weeks })
    } catch {
      return NextResponse.json({ error: "Failed to save premium weeks." }, { status: 500 })
    }
  },
)
