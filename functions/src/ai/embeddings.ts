import type { CompressedExercise } from "./types.js"

/**
 * Text embeddings for vector search (match_exercises), RAG over past AI output
 * and program-feedback retrieval. Twin of lib/ai/embeddings.ts — functions/ cannot import lib/, so keep the two in step.
 *
 * Served by OpenRouter — openai/text-embedding-3-small, asked for 384
 * dimensions because exercises.embedding, ai_conversation_history.embedding,
 * ai_program_feedback.embedding and match_exercises are all vector(384).
 *
 * Until 2026-10-01 this downloaded Xenova/all-MiniLM-L6-v2 from the Hugging
 * Face Hub at runtime. The Hub rate-limits anonymous downloads (429), a failed
 * load stayed cached for the life of the instance, and vector search was off
 * on most generation slots every day from at least 2026-09-24. Vectors from
 * the two models are NOT comparable: after switching, every stored vector was
 * re-embedded (scripts/embed-exercises.ts). Change the model or the size again
 * and you must re-run it.
 */
const EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const EMBEDDING_DIMS = 384
const ENDPOINT = "https://openrouter.ai/api/v1/embeddings"
// Inputs per request. Well under the API's limit; keeps one bad batch small.
const BATCH_SIZE = 96
const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 15_000

// ─── Exercise text builder ───────────────────────────────────────────────────

export function exerciseToText(exercise: CompressedExercise): string {
  const parts = [
    exercise.name,
    exercise.category.join(", "),
    exercise.difficulty,
    exercise.movement_pattern ?? "",
    exercise.muscle_group ?? "",
    `primary: ${exercise.primary_muscles.join(", ")}`,
    `secondary: ${exercise.secondary_muscles.join(", ")}`,
    `Training intent: ${exercise.training_intent?.join(", ") || "build"}`,
    exercise.is_bodyweight ? "bodyweight" : "",
    exercise.equipment_required.join(", "),
    exercise.sport_tags?.length ? `sports: ${exercise.sport_tags.join(", ")}` : "",
    exercise.plane_of_motion?.length ? `planes: ${exercise.plane_of_motion.join(", ")}` : "",
  ]
  return parts.filter(Boolean).join(" | ")
}

export function slotToText(slot: { movement_pattern: string; target_muscles: string[]; role: string }): string {
  return `${slot.role} ${slot.movement_pattern} targeting ${slot.target_muscles.join(", ")}`
}

// ─── Embed functions ─────────────────────────────────────────────────────────

async function requestEmbeddings(input: string[]): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error("OPENROUTER_API_KEY is not set — cannot create embeddings")

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input, dimensions: EMBEDDING_DIMS, encoding_format: "float" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    // Rate limits and provider hiccups are worth one more try; nothing else is.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 250 * attempt))
      continue
    }
    if (!res.ok) {
      throw new Error(`OpenRouter embeddings failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      data?: Array<{ index: number; embedding: number[] }>
      error?: { message?: string }
    }
    // OpenRouter can answer 200 with an error body.
    if (!Array.isArray(body.data)) {
      throw new Error(`OpenRouter embeddings failed: ${body.error?.message ?? "no data in response"}`)
    }
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    if (vectors.length !== input.length) {
      throw new Error(`OpenRouter embeddings returned ${vectors.length} vectors for ${input.length} inputs`)
    }
    // A wrong-sized vector would be rejected by the vector(384) columns — or,
    // worse, compared against them. Refuse it here, with the reason.
    const bad = vectors.find((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMS)
    if (bad) throw new Error(`OpenRouter embeddings returned ${bad?.length} dimensions, expected ${EMBEDDING_DIMS}`)
    return vectors
  }
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await requestEmbeddings([text])
  return vector
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    results.push(...(await requestEmbeddings(texts.slice(i, i + BATCH_SIZE))))
  }
  return results
}

export async function embedExercise(exercise: CompressedExercise): Promise<number[]> {
  return embedText(exerciseToText(exercise))
}
