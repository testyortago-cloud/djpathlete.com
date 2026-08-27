// Add and list exercise blocks. A block is a standing instruction that the AI
// must never program an exercise — studio-wide, or for one client.
//
// Blocks affect AI SELECTION ONLY. This route never touches the exercise
// library and never touches programs already built: an exercise blocked today
// stays in every day already generated, and stays manually pickable.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  createExerciseBlock,
  listStudioBlocks,
  listClientBlocks,
  countUsableInPattern,
} from "@/lib/db/exercise-blocks"
import { getExerciseById } from "@/lib/db/exercises"

const createSchema = z.object({
  exercise_id: z.string().uuid(),
  client_id: z.string().uuid().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
})

export const POST = withAudit(
  {
    action: "exercise_block.added",
    category: "admin_write",
    // Reads the ORIGINAL (still-unconsumed) request — the handler parses a
    // CLONE, so this is the first real read whichever branch the handler takes,
    // including the 401/403 paths.
    target: async (request) => {
      const body = (await request.json().catch(() => null)) as { exercise_id?: unknown } | null
      return typeof body?.exercise_id === "string" ? { type: "exercise", id: body.exercise_id } : undefined
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const parsed = createSchema.safeParse(await request.clone().json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "exercise_id is required" }, { status: 400 })
    }

    const clientId = parsed.data.client_id ?? null
    // Idempotent: the block button is one click and a double press must not
    // read as an error, so an existing block comes back rather than conflicting.
    const block = await createExerciseBlock({
      coachId: session.user.id,
      clientId,
      exerciseId: parsed.data.exercise_id,
      reason: parsed.data.reason ?? null,
      createdBy: session.user.id,
    })

    // Recomputed AFTER the write so the answer reflects the moment of writing,
    // not the moment the dialog opened. Zero means this block just emptied the
    // movement pattern and the coach needs to know before they walk away.
    const exercise = await getExerciseById(parsed.data.exercise_id)
    const movementPattern = (exercise as { movement_pattern?: string | null } | null)?.movement_pattern ?? null
    const remainingInPattern = movementPattern
      ? await countUsableInPattern(session.user.id, clientId, movementPattern, parsed.data.exercise_id)
      : null

    return NextResponse.json({ block, remainingInPattern, movementPattern })
  },
)

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const clientId = new URL(request.url).searchParams.get("client_id")
  const blocks = clientId
    ? await listClientBlocks(session.user.id, clientId)
    : await listStudioBlocks(session.user.id)
  return NextResponse.json({ blocks })
}
