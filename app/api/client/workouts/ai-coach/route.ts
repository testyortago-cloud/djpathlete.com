import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getProgress } from "@/lib/db/progress"
import { getExerciseById } from "@/lib/db/exercises"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { streamChat } from "@/lib/ai/anthropic"

export const maxDuration = 30

const requestSchema = z.object({
  exercise_id: z.string().min(1),
  current_session: z.array(z.object({
    set_number: z.number(),
    weight_kg: z.number().nullable(),
    reps: z.number(),
    rpe: z.number().nullable(),
  })).optional(),
})

const SYSTEM_PROMPT = `You are an expert strength & conditioning coach analyzing a client's exercise history.
You will receive the client's profile, exercise details, and their recent training log for a specific exercise.
When set-level data is available (set_details array), analyze per-set patterns including:
- RPE drift across sets (e.g., RPE creeping up from 7 to 9 suggests the weight is near the client's limit)
- Rep drop-off (e.g., 8,8,7,5 reps indicates fatigue — consider reducing weight on later sets)
- Weight ramping patterns (ascending sets vs straight sets)
- Intra-session consistency — are sets even, or does performance fall off?

When a "current_session" array is provided, the client is mid-workout RIGHT NOW. These are the sets they've completed so far today (not yet saved). Prioritize this data:
- Provide immediate, actionable advice for their next set
- Adjust weight/rep suggestions based on how today's session is going
- Flag if RPE is climbing too fast or reps are dropping off within this session
- Be concise — they're between sets and need quick guidance

Analyze the data and respond in exactly this format:

1. First, write your personalized coaching recommendation (2-4 sentences). Be encouraging but honest. Focus on actionable advice.

2. Then write a line containing only: ---

3. Then write a JSON object with exactly these fields:
- plateau_detected: boolean — true if the client has been stuck at the same weight/reps for 3+ sessions
- suggested_weight_kg: number or null — a specific weight recommendation for their next session (null for bodyweight exercises)
- deload_recommended: boolean — true if performance is declining or RPE has been consistently high (9-10)
- key_observations: string[] — 2-4 brief bullet points about their training patterns

If the client might benefit from an exercise substitution (e.g., plateau for 3+ sessions, or the exercise seems mismatched for their experience level), suggest 1-2 specific alternative exercises by name that target the same muscle group with different equipment or movement variation. Keep substitution suggestions brief and natural within your coaching text.

Example format:
Your bench press has been progressing well. Consider adding 2.5kg next session since your RPE has been manageable at 7-8. Focus on maintaining your current rep range before pushing heavier.
---
{"plateau_detected":false,"suggested_weight_kg":82.5,"deload_recommended":false,"key_observations":["Consistent 3x/week frequency","RPE trending 7-8 range","Steady 2.5kg increases monthly"]}`

export async function POST(request: Request) {
  try {
    const session = await auth()
    console.log("[Coach DJP] Session:", session?.user?.id ? "authenticated" : "NO SESSION")
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    console.log("[Coach DJP] Request body:", JSON.stringify(body))
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      console.error("[Coach DJP] Validation failed:", JSON.stringify(parsed.error.flatten()))
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { exercise_id, current_session } = parsed.data
    const userId = session.user.id
    console.log("[Coach DJP] Fetching data for exercise:", exercise_id, "user:", userId)

    // Fetch data in parallel
    const [history, exercise, profile] = await Promise.all([
      getProgress(userId, exercise_id),
      getExerciseById(exercise_id),
      getProfileByUserId(userId),
    ])

    console.log("[Coach DJP] Data fetched — history:", history?.length ?? 0, "exercise:", exercise?.name, "profile:", !!profile)

    if ((!history || history.length === 0) && !current_session) {
      console.log("[Coach DJP] No history and no current session, returning 400")
      return NextResponse.json(
        { error: "No training history found for this exercise. Log at least one session first." },
        { status: 400 }
      )
    }

    // Take last 20 sessions
    const recentHistory = history.slice(0, 20)

    const userMessage = JSON.stringify({
      exercise: {
        name: exercise.name,
        category: exercise.category,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
        is_bodyweight: exercise.is_bodyweight,
        is_compound: exercise.is_compound,
        movement_pattern: exercise.movement_pattern,
      },
      client_profile: profile
        ? {
            experience_level: profile.experience_level,
            goals: profile.goals,
            weight_kg: profile.weight_kg,
            training_years: profile.training_years,
            injuries: profile.injuries,
          }
        : null,
      training_history: recentHistory.map((h: Record<string, unknown>) => ({
        date: h.completed_at,
        sets: h.sets_completed,
        reps: h.reps_completed,
        weight_kg: h.weight_kg,
        rpe: h.rpe,
        notes: h.notes,
        ...(h.set_details ? { set_details: h.set_details } : {}),
      })),
      ...(current_session ? { current_session } : {}),
    })

    // Stream response via SSE (same pattern as admin AI chat)
    const stream = streamChat({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 1024,
    })

    const encoder = new TextEncoder()

    const readable = new ReadableStream({
      async start(controller) {
        try {
          stream.on("text", (text) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`)
            )
          })

          await stream.finalMessage()
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`))
          controller.close()
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Stream error"
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message })}\n\n`
            )
          )
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("[Coach DJP] Error:", error)
    return NextResponse.json(
      { error: "Failed to get Coach DJP analysis" },
      { status: 500 }
    )
  }
}
