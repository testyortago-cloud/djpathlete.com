import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { copyExercisesFromProgram } from "@/lib/db/program-exercises"

const copyFromSchema = z
  .object({
    sourceProgramId: z.string().uuid(),
    scope: z.enum(["day", "week", "program"]),
    sourceWeek: z.coerce.number().int().min(1).optional(),
    sourceDay: z.coerce.number().int().min(1).max(7).optional(),
    targetWeek: z.coerce.number().int().min(1).optional(),
    targetDay: z.coerce.number().int().min(1).max(7).optional(),
    includeWeights: z.boolean().default(false),
  })
  .refine((v) => v.scope !== "day" || (v.sourceWeek && v.sourceDay && v.targetWeek && v.targetDay), {
    message: "day scope requires sourceWeek, sourceDay, targetWeek, targetDay",
  })
  .refine((v) => v.scope !== "week" || (v.sourceWeek && v.targetWeek), {
    message: "week scope requires sourceWeek and targetWeek",
  })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id: targetProgramId } = await params
    const body = await request.json()
    const parsed = copyFromSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    if (parsed.data.sourceProgramId === targetProgramId && parsed.data.scope === "program") {
      return NextResponse.json({ error: "Cannot copy a whole program onto itself." }, { status: 400 })
    }

    const inserted = await copyExercisesFromProgram({
      sourceProgramId: parsed.data.sourceProgramId,
      targetProgramId,
      scope: parsed.data.scope,
      sourceWeek: parsed.data.sourceWeek,
      sourceDay: parsed.data.sourceDay,
      targetWeek: parsed.data.targetWeek,
      targetDay: parsed.data.targetDay,
      includeWeights: parsed.data.includeWeights,
    })

    return NextResponse.json({ inserted: inserted.length, rows: inserted }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to copy exercises."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
