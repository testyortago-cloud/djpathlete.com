import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { streamRaw, callAgent, MODEL_HAIKU } from "./ai/anthropic.js"
import {
  retrieveSimilarContext,
  formatRagContext,
  buildRagAugmentedPrompt,
  embedConversationMessage,
} from "./ai/rag.js"
import { getSupabase } from "./lib/supabase.js"

// ─── Prompts ──────────────────────────────────────────────────────────────────

const COACHING_PROMPT = `You are an expert strength & conditioning coach analyzing a client's exercise data.
You will receive the client's profile, exercise details, and their training context.

## Context Fields You May Receive

- **client_profile**: Demographics, experience level, goals, injuries, movement confidence, lifestyle factors
- **assessment_context**: Movement-pattern ability levels from their latest assessment (e.g., squat: intermediate, push: beginner). The "relevant_level" is the ability level specifically for the current exercise's movement pattern.
- **program**: The training program they're on, including week number, periodization type, and prescribed sets/reps/RPE/tempo targets
- **training_history**: Past sessions for THIS specific exercise (newest first)
- **related_exercise_history**: Recent sessions on similar exercises (same movement pattern). Use this to infer baseline strength when no history exists for the current exercise.
- **current_session**: Sets completed SO FAR in today's workout (the client is mid-workout NOW)

## Coaching Scenarios

### First-Ever Session (no training_history)
When no history exists for this exercise:
- Use assessment_context.relevant_level to gauge their ability for this movement pattern
- Use related_exercise_history to estimate appropriate starting weights (e.g., if they squat 60kg, they can likely leg press higher)
- Reference the program prescription (target sets/reps/RPE) and suggest starting conservatively
- Emphasize form, breathing, and finding their working weight
- If movement_confidence is "learning" or "comfortable", provide extra cues on setup and execution
- Suggest starting at 50-60% of what they might handle and ramping up across sets

### Mid-Workout (current_session provided)
The client is between sets RIGHT NOW:
- Provide immediate, actionable advice for their next set
- Adjust weight/rep suggestions based on how today's session is going
- Flag if RPE is climbing too fast or reps are dropping off
- Reference target RPE from program prescription if available
- Be concise — they need quick guidance

### Ongoing Training (training_history available)
When set-level data is available (set_details array), analyze per-set patterns including:
- RPE drift across sets
- Rep drop-off patterns
- Weight ramping patterns
- Intra-session consistency
- Whether they're hitting the program's prescribed RPE/rep targets

## Program Awareness
When program context is available:
- Frame advice relative to the program phase (e.g., "Week 2 of 8 — still building your base")
- Respect the periodization model: linear = steady progression, undulating = varied intensity, block = phase-specific focus
- Compare actual performance to prescribed targets
- If tempo is prescribed, remind them of it

## Cross-Exercise Intelligence
When related_exercise_history is available and no direct history exists:
- Use performance on related exercises to estimate appropriate starting points
- Note the relationship explicitly (e.g., "Based on your squat performance...")
- Be conservative — similar movement patterns don't mean identical strength

## Injury Awareness
If injury_details are present, proactively mention relevant modifications when the exercise could aggravate the listed areas.

If the client might benefit from an exercise substitution (e.g., plateau for 3+ sessions, or the exercise seems mismatched for their experience level), suggest 1-2 specific alternative exercises.

## Units
ALL weight values in training_history, current_session, and related_exercise_history are stored in KILOGRAMS. The client's preferred display unit is in client_profile.weight_unit (either "kg" or "lbs"). When writing coaching text, use the client's preferred unit so it feels natural to them. Convert kg to lbs by multiplying by 2.205 if they prefer lbs.

Write a personalized coaching recommendation (2-4 sentences). Be encouraging but honest. Focus on actionable advice.

IMPORTANT: Write ONLY the coaching text. No JSON, no metadata, no separators, no bullet lists of observations. Just the coaching recommendation as natural sentences.`

const coachAnalysisSchema = z.object({
  plateau_detected: z.boolean(),
  suggested_weight_kg: z.number().nullable(),
  deload_recommended: z.boolean(),
  key_observations: z.array(z.string()),
})

const ANALYSIS_PROMPT = `You are a data analyst for a strength & conditioning coach. Given a client's exercise data and profile, output a structured assessment.

Rules:
- plateau_detected: true ONLY if the client has been stuck at the same weight/reps for 3+ consecutive sessions. For first-ever sessions (no training_history), always false.
- suggested_weight_kg: the specific weight the client should use for their next set or remaining sets RIGHT NOW (null for bodyweight exercises). CRITICAL: This value MUST ALWAYS be in KILOGRAMS regardless of what unit the training data shows. If the data shows weights in lbs, convert to kg first (divide by 2.205). If the client has current_session data, base this on what they just did — if RPE was too high, suggest a lower weight; if RPE was low, suggest a small increase. If no current_session, suggest a starting weight based on their recent history, assessment levels, related exercises, and profile. This value MUST be consistent with the coaching text advice.
- deload_recommended: true ONLY if performance is clearly declining across sessions OR RPE has been consistently 9-10. For first-ever sessions, always false.
- key_observations: 2-4 brief bullet points about their training patterns. For first sessions, focus on readiness indicators from profile/assessment (e.g., "Intermediate-level squatter", "First time with this exercise").`

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleAiCoach(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)
  const chunksRef = jobRef.collection("chunks")
  let chunkIndex = 0

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "streaming", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    exercise_id: string
    current_session?: Array<{
      set_number: number
      weight_kg: number | null
      reps: number
      rpe: number | null
    }>
    program_context?: {
      programName: string
      difficulty: string
      category: string | string[]
      periodization: string | null
      splitType: string | null
      currentWeek: number
      totalWeeks: number
      prescription: {
        sets: number | null
        reps: string | null
        rpe_target: number | null
        intensity_pct: number | null
        tempo: string | null
        rest_seconds: number | null
        notes: string | null
        technique: string
        group_tag: string | null
      }
    }
    userId: string
  }

  const userId = input.userId
  const exerciseId = input.exercise_id
  const coachSessionId = `coach-${userId}-${exerciseId}-${Date.now()}`

  try {
    const supabase = getSupabase()

    // Fetch core data in parallel
    const [historyResult, exerciseResult, profileResult, assessmentResult] = await Promise.all([
      supabase
        .from("exercise_progress")
        .select("*")
        .eq("user_id", userId)
        .eq("exercise_id", exerciseId)
        .order("completed_at", { ascending: false })
        .limit(20),
      supabase.from("exercises").select("*").eq("id", exerciseId).single(),
      supabase.from("client_profiles").select("*").eq("user_id", userId).single(),
      supabase
        .from("assessment_results")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single()
        .then(
          (r) => r.data,
          () => null,
        ),
    ])

    const history = historyResult.data ?? []
    const exercise = exerciseResult.data
    if (!exercise) throw new Error("Exercise not found")
    const profile = profileResult.data
    const assessment = assessmentResult

    const isFirstSession = history.length === 0 && !input.current_session

    // Cross-exercise data for first sessions
    let relatedHistory: Array<{
      exercise_name: string
      date: unknown
      weight_kg: unknown
      reps: unknown
      rpe: unknown
      sets: unknown
    }> = []
    if (isFirstSession && exercise.movement_pattern) {
      try {
        const { data: related } = await supabase
          .from("exercise_progress")
          .select("*, exercises!inner(name, movement_pattern)")
          .eq("user_id", userId)
          .eq("exercises.movement_pattern", exercise.movement_pattern)
          .neq("exercise_id", exerciseId)
          .order("completed_at", { ascending: false })
          .limit(10)

        relatedHistory = (related ?? []).map((h: Record<string, unknown>) => ({
          exercise_name: String((h.exercises as Record<string, unknown>)?.name ?? ""),
          date: h.completed_at,
          weight_kg: h.weight_kg,
          reps: h.reps_completed,
          rpe: h.rpe,
          sets: h.sets_completed,
        }))
      } catch {
        // Non-fatal
      }
    }

    // Build client profile
    const clientProfile = profile
      ? {
          experience_level: profile.experience_level,
          goals: profile.goals,
          weight_kg: profile.weight_kg,
          height_cm: profile.height_cm || undefined,
          gender: profile.gender || undefined,
          training_years: profile.training_years,
          injuries: profile.injuries || undefined,
          injury_details: profile.injury_details?.length ? profile.injury_details : undefined,
          movement_confidence: profile.movement_confidence || undefined,
          sleep_hours: profile.sleep_hours || undefined,
          stress_level: profile.stress_level || undefined,
          occupation_activity_level: profile.occupation_activity_level || undefined,
          available_equipment: profile.available_equipment?.length ? profile.available_equipment : undefined,
          training_background: profile.training_background ? profile.training_background.slice(0, 200) : undefined,
          exercise_likes: profile.exercise_likes ? profile.exercise_likes.slice(0, 200) : undefined,
          exercise_dislikes: profile.exercise_dislikes ? profile.exercise_dislikes.slice(0, 200) : undefined,
          weight_unit: profile.weight_unit || "lbs",
        }
      : null

    // Build assessment context
    const assessmentContext = assessment
      ? {
          computed_levels: assessment.computed_levels,
          relevant_level: exercise.movement_pattern
            ? ((assessment.computed_levels as Record<string, unknown>)?.[exercise.movement_pattern] ??
              (assessment.computed_levels as Record<string, unknown>)?.overall)
            : (assessment.computed_levels as Record<string, unknown>)?.overall,
          overall_feeling: (assessment.feedback as Record<string, unknown> | null)?.overall_feeling ?? null,
          max_difficulty_score: assessment.max_difficulty_score,
        }
      : null

    // Build program context
    const programData = input.program_context
      ? {
          name: input.program_context.programName,
          difficulty: input.program_context.difficulty,
          periodization: input.program_context.periodization || undefined,
          week: `${input.program_context.currentWeek}/${input.program_context.totalWeeks}`,
          split_type: input.program_context.splitType || undefined,
          prescription: {
            target_sets: input.program_context.prescription.sets,
            target_reps: input.program_context.prescription.reps,
            target_rpe: input.program_context.prescription.rpe_target,
            intensity_pct: input.program_context.prescription.intensity_pct || undefined,
            tempo: input.program_context.prescription.tempo || undefined,
            rest_seconds: input.program_context.prescription.rest_seconds || undefined,
            technique:
              input.program_context.prescription.technique !== "standard"
                ? input.program_context.prescription.technique
                : undefined,
            coach_notes: input.program_context.prescription.notes || undefined,
          },
        }
      : undefined

    const userMessage = JSON.stringify({
      exercise: {
        name: exercise.name,
        category: exercise.category,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
        is_bodyweight: exercise.is_bodyweight,
        training_intent: exercise.training_intent,
        movement_pattern: exercise.movement_pattern,
      },
      client_profile: clientProfile,
      ...(assessmentContext ? { assessment_context: assessmentContext } : {}),
      ...(programData ? { program: programData } : {}),
      training_history: history.map((h: Record<string, unknown>) => ({
        date: h.completed_at,
        sets: h.sets_completed,
        reps: h.reps_completed,
        weight_kg: h.weight_kg,
        rpe: h.rpe,
        notes: h.notes,
        ...(h.set_details ? { set_details: h.set_details } : {}),
      })),
      ...(relatedHistory.length > 0 ? { related_exercise_history: relatedHistory } : {}),
      ...(input.current_session ? { current_session: input.current_session } : {}),
    })

    // RAG
    const exerciseSummary = `${exercise.name} ${exercise.movement_pattern ?? ""} ${exercise.muscle_group ?? ""}`
    const ragResults = await retrieveSimilarContext(exerciseSummary, "ai_coach", { threshold: 0.4, limit: 3 })
    const ragContext = formatRagContext(ragResults)
    const augmentedPrompt = ragContext ? buildRagAugmentedPrompt(COACHING_PROMPT, ragContext) : COACHING_PROMPT

    // Phase 1: Stream coaching text
    let accumulatedText = ""
    const stream = streamRaw({
      system: augmentedPrompt,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 32000,
    })

    for await (const event of stream) {
      if (event.type === "text") {
        accumulatedText += event.text
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "delta",
          data: { text: event.text },
          createdAt: FieldValue.serverTimestamp(),
        })
      }
    }

    // Phase 2: Structured analysis (Haiku for speed)
    let analysisData: Record<string, unknown> | null = null
    try {
      const analysisInput = `${userMessage}\n\n---\nCOACHING TEXT ALREADY GIVEN TO CLIENT (your suggested_weight_kg MUST match the weight advice in this text):\n${accumulatedText}`
      const analysisResult = await callAgent(ANALYSIS_PROMPT, analysisInput, coachAnalysisSchema, {
        model: MODEL_HAIKU,
        cacheSystemPrompt: true,
      })
      analysisData = analysisResult.content as unknown as Record<string, unknown>

      await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
        index: chunkIndex - 1,
        type: "analysis",
        data: analysisResult.content as unknown as Record<string, unknown>,
        createdAt: FieldValue.serverTimestamp(),
      })

      // Track weight suggestion outcome
      if (analysisResult.content.suggested_weight_kg != null) {
        try {
          await supabase.from("ai_outcome_tracking").insert({
            conversation_message_id: null,
            generation_log_id: null,
            user_id: userId,
            exercise_id: exerciseId,
            program_id: null,
            recommendation_type: "weight_suggestion",
            predicted_value: { weight_kg: analysisResult.content.suggested_weight_kg },
            actual_value: null,
            accuracy_score: null,
            outcome_positive: null,
            measured_at: null,
          })
        } catch {
          /* non-fatal */
        }
      }

      // Track deload recommendation
      if (analysisResult.content.deload_recommended) {
        try {
          await supabase.from("ai_outcome_tracking").insert({
            conversation_message_id: null,
            generation_log_id: null,
            user_id: userId,
            exercise_id: exerciseId,
            program_id: null,
            recommendation_type: "deload_recommendation",
            predicted_value: { recommended: true },
            actual_value: null,
            accuracy_score: null,
            outcome_positive: null,
            measured_at: null,
          })
        } catch {
          /* non-fatal */
        }
      }
    } catch (analysisErr) {
      console.warn(
        "[ai-coach] Analysis generation failed:",
        analysisErr instanceof Error ? analysisErr.message : analysisErr,
      )
    }

    // Save conversation history
    try {
      const { data: saved } = await supabase
        .from("ai_conversation_history")
        .insert([
          {
            user_id: userId,
            feature: "ai_coach",
            session_id: coachSessionId,
            role: "user",
            content: userMessage,
            metadata: { exercise_id: exerciseId, exercise_name: exercise.name },
            tokens_input: null,
            tokens_output: null,
            model_used: null,
          },
          {
            user_id: userId,
            feature: "ai_coach",
            session_id: coachSessionId,
            role: "assistant",
            content: accumulatedText,
            metadata: {
              exercise_id: exerciseId,
              exercise_name: exercise.name,
              ...(analysisData ? { analysis: analysisData } : {}),
            },
            tokens_input: null,
            tokens_output: null,
            model_used: MODEL_HAIKU,
          },
        ])
        .select()

      const assistantMsg = saved?.find((m: Record<string, unknown>) => m.role === "assistant")
      if (assistantMsg) {
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "message_id",
          data: { id: assistantMsg.id },
          createdAt: FieldValue.serverTimestamp(),
        })
        embedConversationMessage(assistantMsg.id).catch(() => {})
      }
    } catch {
      // Non-fatal
    }

    // Done
    await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
      index: chunkIndex - 1,
      type: "done",
      data: {},
      createdAt: FieldValue.serverTimestamp(),
    })

    await jobRef.update({
      status: "completed",
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[ai-coach] Job ${jobId} failed:`, errorMessage)

    await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
      index: chunkIndex - 1,
      type: "error",
      data: { message: errorMessage },
      createdAt: FieldValue.serverTimestamp(),
    })

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
