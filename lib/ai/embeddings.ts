import type { Exercise } from "@/types/database"
import type { CompressedExercise } from "@/lib/ai/exercise-context"

const MODEL_ID = "Xenova/all-MiniLM-L6-v2"
export const EMBEDDING_DIMS = 384

// ─── Singleton pipeline loader ───────────────────────────────────────────────

type FeatureExtractionPipeline = (
  text: string | string[],
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>

let _pipeline: FeatureExtractionPipeline | null = null
let _loading: Promise<FeatureExtractionPipeline> | null = null

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline

  if (!_loading) {
    _loading = (async () => {
      const { pipeline } = await import("@huggingface/transformers")
      const extractor = await pipeline("feature-extraction", MODEL_ID)
      _pipeline = extractor as unknown as FeatureExtractionPipeline
      return _pipeline
    })()
  }

  return _loading
}

// ─── Exercise text builder ───────────────────────────────────────────────────

export function exerciseToText(
  exercise: Exercise | CompressedExercise
): string {
  const parts = [
    exercise.name,
    exercise.category.join(", "),
    exercise.difficulty,
    exercise.movement_pattern ?? "",
    exercise.muscle_group ?? "",
    `primary: ${exercise.primary_muscles.join(", ")}`,
    `secondary: ${exercise.secondary_muscles.join(", ")}`,
    exercise.is_compound ? "compound" : "isolation",
    exercise.is_bodyweight ? "bodyweight" : "",
    exercise.equipment_required.join(", "),
  ]
  return parts.filter(Boolean).join(" | ")
}

export function slotToText(slot: {
  movement_pattern: string
  target_muscles: string[]
  role: string
}): string {
  return `${slot.role} ${slot.movement_pattern} targeting ${slot.target_muscles.join(", ")}`
}

// ─── Embed functions ─────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getEmbedder()
  const result = await extractor(text, { pooling: "mean", normalize: true })
  return Array.from(result.data)
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getEmbedder()
  const results: number[][] = []

  // Process in batches of 32 to avoid memory issues
  const BATCH_SIZE = 32
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        const result = await extractor(text, { pooling: "mean", normalize: true })
        return Array.from(result.data)
      })
    )
    results.push(...batchResults)
  }

  return results
}

export async function embedExercise(
  exercise: Exercise | CompressedExercise
): Promise<number[]> {
  return embedText(exerciseToText(exercise))
}
