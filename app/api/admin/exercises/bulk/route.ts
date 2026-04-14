import { NextResponse } from "next/server"
import { z } from "zod"
import { bulkUpdateExercises, bulkDeleteExercises } from "@/lib/db/exercises"

const bulkActionSchema = z.object({
  action: z.enum(["delete", "activate", "deactivate"]),
  ids: z.array(z.string().uuid()).min(1, "At least one ID is required"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = bulkActionSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
    }

    const { action, ids } = parsed.data

    switch (action) {
      case "delete":
        await bulkDeleteExercises(ids)
        break
      case "activate":
        await bulkUpdateExercises(ids, { is_active: true })
        break
      case "deactivate":
        await bulkUpdateExercises(ids, { is_active: false })
        break
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch {
    return NextResponse.json({ error: "Failed to perform bulk action" }, { status: 500 })
  }
}
