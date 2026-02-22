import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getProgress } from "@/lib/db/progress"
import { getExerciseById } from "@/lib/db/exercises"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { streamChat, callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"

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

// ─── Streaming prompt: coaching advice only (no JSON) ────────────────────────

const COACHING_PROMPT = `You are an expert strength & conditioning coach analyzing a client's exercise history.
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

Write a personalized coaching recommendation (2-4 sentences). Be encouraging but honest. Focus on actionable advice.

If the client might benefit from an exercise substitution (e.g., plateau for 3+ sessions, or the exercise seems mismatched for their experience level), suggest 1-2 specific alternative exercises by name that target the same muscle group with different equipment or movement variation. Keep substitution suggestions brief and natural within your coaching text.

IMPORTANT: Write ONLY the coaching text. No JSON, no metadata, no separators, no bullet lists of observations. Just the coaching recommendation as natural sentences.`

// ─── Structured analysis schema ──────────────────────────────────────────────

const coachAnalysisSchema = z.object({
  plateau_detected: z.boolean(),
  suggested_weight_kg: z.number().nullable(),
  deload_recommended: z.boolean(),
  key_observations: z.array(z.string()).min(2).max(4),
})

const ANALYSIS_PROMPT = `You are a data analyst for a strength & conditioning coach. Given a client's exercise history and profile, output a structured assessment.

Rules:
- plateau_detected: true ONLY if the client has been stuck at the same weight/reps for 3+ consecutive sessions
- suggested_weight_kg: a specific weight for their next session (null for bodyweight exercises). Base this on their recent trends, RPE, and progressive overload principles.
- deload_recommended: true ONLY if performance is clearly declining across sessions OR RPE has been consistently 9-10
- key_observations: 2-4 brief bullet points about their training patterns (e.g., "Consistent 3x/week frequency", "RPE trending upward from 7 to 9")`

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { exercise_id, current_session } = parsed.data
    const userId = session.user.id

    // Fetch data in parallel
    const [history, exercise, profile] = await Promise.all([
      getProgress(userId, exercise_id),
      getExerciseById(exercise_id),
      getProfileByUserId(userId),
    ])

    if ((!history || history.length === 0) && !current_session) {
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

    // 1) Stream coaching text
    const streamResult = streamChat({
      system: COACHING_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 512,
    })

    const encoder = new TextEncoder()

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Stream coaching text deltas
          for await (const text of streamResult.textStream) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`)
            )
          }

          // 2) After stream completes, get structured analysis via generateObject
          //    Uses Haiku for speed + cost, with p-retry built in
          try {
            const analysisResult = await callAgent(
              ANALYSIS_PROMPT,
              userMessage,
              coachAnalysisSchema,
              { model: MODEL_HAIKU, maxTokens: 512, cacheSystemPrompt: true }
            )

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "analysis", data: analysisResult.content })}\n\n`
              )
            )
          } catch (analysisErr) {
            // Analysis failure is non-fatal — coaching text already delivered
            console.warn(
              "[Coach DJP] Analysis generation failed:",
              analysisErr instanceof Error ? analysisErr.message : analysisErr
            )
          }

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
