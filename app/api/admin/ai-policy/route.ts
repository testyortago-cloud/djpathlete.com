import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCoachPolicy, upsertCoachPolicy } from "@/lib/db/coach-ai-policy"
import { z } from "zod"

const TECHNIQUES = [
  "straight_set",
  "superset",
  "dropset",
  "giant_set",
  "circuit",
  "rest_pause",
  "amrap",
  "cluster_set",
  "complex",
  "emom",
  "wave_loading",
] as const

const policyInputSchema = z.object({
  disallowed_techniques: z.array(z.enum(TECHNIQUES)),
  preferred_techniques: z.array(z.enum(TECHNIQUES)),
  technique_progression_enabled: z.boolean(),
  programming_notes: z.string().max(4000),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const policy = await getCoachPolicy(session.user.id)
  return NextResponse.json({ policy })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  const parsed = policyInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }
  const updated = await upsertCoachPolicy(session.user.id, parsed.data)
  return NextResponse.json({ policy: updated })
}
