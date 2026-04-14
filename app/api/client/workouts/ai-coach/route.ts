import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const requestSchema = z.object({
  exercise_id: z.string().min(1),
  current_session: z
    .array(
      z.object({
        set_number: z.number(),
        weight_kg: z.number().nullable(),
        reps: z.number(),
        rpe: z.number().nullable(),
      }),
    )
    .optional(),
  program_context: z
    .object({
      programName: z.string(),
      difficulty: z.string(),
      category: z.union([z.string(), z.array(z.string())]),
      periodization: z.string().nullable(),
      splitType: z.string().nullable(),
      currentWeek: z.number(),
      totalWeeks: z.number(),
      prescription: z.object({
        sets: z.number().nullable(),
        reps: z.string().nullable(),
        rpe_target: z.number().nullable(),
        intensity_pct: z.number().nullable(),
        tempo: z.string().nullable(),
        rest_seconds: z.number().nullable(),
        notes: z.string().nullable(),
        technique: z.string(),
        group_tag: z.string().nullable(),
      }),
    })
    .optional(),
})

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
    }

    // Create Firestore job doc
    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()

    await jobRef.set({
      type: "ai_coach",
      status: "pending",
      input: {
        ...parsed.data,
        userId: session.user.id,
      },
      result: null,
      error: null,
      userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
  } catch (error) {
    console.error("[Coach DJP] Error:", error)
    return NextResponse.json({ error: "Failed to create AI coaching job" }, { status: 500 })
  }
}
