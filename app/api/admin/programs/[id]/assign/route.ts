import { NextResponse } from "next/server"
import { assignmentSchema } from "@/lib/validators/assignment"
import { assignProgram } from "@/lib/services/assign-program"
import { withAudit } from "@/lib/audit/with-audit"

export const POST = withAudit(
  {
    action: "assignment.created",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "program", id }
    },
    metadata: async (_req, res) => {
      try {
        const clone = res.clone()
        const body = (await clone.json()) as { assigned?: number; skipped?: number; errors?: string[] }
        return {
          assigned: body.assigned ?? 0,
          skipped: body.skipped ?? 0,
          error_count: body.errors?.length ?? 0,
        }
      } catch {
        return {}
      }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const { id } = await params
      const body = await request.json()
      const result = assignmentSchema.safeParse(body)

      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid form data", details: result.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const { user_ids, start_date, notes, complimentary } = result.data

      let assigned = 0
      let skipped = 0
      const errors: string[] = []

      for (const userId of user_ids) {
        try {
          const { skipped: wasSkipped } = await assignProgram({
            programId: id,
            userId,
            startDate: start_date,
            notes: notes ?? null,
            complimentary,
          })
          if (wasSkipped) skipped++
          else assigned++
        } catch (err) {
          errors.push(`Failed to assign to user ${userId}`)
          console.error(`[assign] Error for user ${userId}:`, err)
        }
      }

      return NextResponse.json({ assigned, skipped, errors }, { status: 201 })
    } catch {
      return NextResponse.json({ error: "Failed to assign program. Please try again." }, { status: 500 })
    }
  },
)
