import { NextResponse } from "next/server"
import { exerciseFormSchema } from "@/lib/validators/exercise"
import { updateExercise, deleteExercise } from "@/lib/db/exercises"
import { withAudit } from "@/lib/audit/with-audit"

export const PATCH = withAudit(
  {
    action: "exercise.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "exercise", id }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const { id } = await params
      const body = await request.json()
      const result = exerciseFormSchema.safeParse(body)

      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid form data", details: result.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const exercise = await updateExercise(id, result.data)
      return NextResponse.json(exercise)
    } catch {
      return NextResponse.json({ error: "Failed to update exercise. Please try again." }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  {
    action: "exercise.deleted",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "exercise", id }
    },
  },
  async (_request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const { id } = await params
      await deleteExercise(id)
      return NextResponse.json({ success: true })
    } catch {
      return NextResponse.json({ error: "Failed to delete exercise. Please try again." }, { status: 500 })
    }
  },
)
