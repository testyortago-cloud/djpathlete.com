/**
 * Batch-enrich exercises with AI metadata (movement_pattern, primary_muscles, etc.)
 *
 * Run: npx tsx scripts/enrich-ai-metadata.ts
 * Dry run: npx tsx scripts/enrich-ai-metadata.ts --dry-run
 * Force all: npx tsx scripts/enrich-ai-metadata.ts --force (re-enrich even if already has metadata)
 */

import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, "../.env.local") })

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ─── Anthropic client ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// ─── CLI flags ────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run")
const FORCE = process.argv.includes("--force")
const CONCURRENCY = 2
const BATCH_DELAY_MS = 3000
const PROGRESS_INTERVAL = 25
const MAX_RETRIES = 3

// ─── Valid enum values (mirrored from lib/validators/exercise.ts) ─────────────

const MOVEMENT_PATTERNS = [
  "push",
  "pull",
  "squat",
  "hinge",
  "lunge",
  "carry",
  "rotation",
  "isometric",
  "locomotion",
] as const

const FORCE_TYPES = ["push", "pull", "static", "dynamic"] as const

const LATERALITY_OPTIONS = ["bilateral", "unilateral", "alternating"] as const

const MUSCLE_OPTIONS = [
  "chest",
  "upper_back",
  "lats",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "core",
  "obliques",
  "lower_back",
  "glutes",
  "quadriceps",
  "hamstrings",
  "calves",
  "hip_flexors",
  "adductors",
  "abductors",
  "traps",
  "neck",
] as const

const EQUIPMENT_OPTIONS = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable_machine",
  "smith_machine",
  "resistance_band",
  "pull_up_bar",
  "bench",
  "squat_rack",
  "leg_press",
  "leg_curl_machine",
  "lat_pulldown_machine",
  "rowing_machine",
  "treadmill",
  "bike",
  "box",
  "plyo_box",
  "medicine_ball",
  "stability_ball",
  "foam_roller",
  "trx",
  "landmine",
  "sled",
  "battle_ropes",
  "agility_ladder",
  "cones",
  "yoga_mat",
  "gliders",
  "wall",
  "weight_plate",
  "short_barbell",
] as const

// ─── System prompt (same as API route) ────────────────────────────────────────

const SYSTEM_PROMPT = `You are an exercise science expert. Given basic exercise information, predict the detailed metadata fields. Be accurate and consistent with standard exercise classification.

Available values for each field:
- movement_pattern: ${MOVEMENT_PATTERNS.join(", ")}
- force_type: ${FORCE_TYPES.join(", ")}
- laterality: ${LATERALITY_OPTIONS.join(", ")}
- primary_muscles / secondary_muscles: ${MUSCLE_OPTIONS.join(", ")}
- equipment_required: ${EQUIPMENT_OPTIONS.join(", ")}
- difficulty_score: 1-10 scale (1-2 foundational, 3-4 beginner, 5-6 intermediate, 7-8 advanced, 9-10 elite)

Rules:
- primary_muscles: select 1-3 muscles that are the PRIMARY movers
- secondary_muscles: select 0-3 muscles that ASSIST (must not overlap with primary_muscles)
- equipment_required: only list equipment that is ESSENTIAL (not optional accessories)
- If the exercise name implies the movement pattern (e.g. "squat" -> squat, "bench press" -> push), use that
- For cardio exercises like running/cycling, use "locomotion" as movement_pattern and "dynamic" as force_type
- For stretches/mobility, use null for movement_pattern and "static" for force_type
- For isometric holds (planks, wall sits), use "isometric" as movement_pattern and "static" as force_type`

// ─── Tool schema for structured output ────────────────────────────────────────

const metadataTool: Anthropic.Tool = {
  name: "set_exercise_metadata",
  description: "Set the AI-predicted metadata for an exercise",
  input_schema: {
    type: "object" as const,
    properties: {
      movement_pattern: {
        type: "string",
        enum: [...MOVEMENT_PATTERNS],
      },
      force_type: {
        type: "string",
        enum: [...FORCE_TYPES],
      },
      laterality: {
        type: "string",
        enum: [...LATERALITY_OPTIONS],
      },
      primary_muscles: {
        type: "array",
        items: { type: "string", enum: [...MUSCLE_OPTIONS] },
      },
      secondary_muscles: {
        type: "array",
        items: { type: "string", enum: [...MUSCLE_OPTIONS] },
      },
      equipment_required: {
        type: "array",
        items: { type: "string", enum: [...EQUIPMENT_OPTIONS] },
      },
      difficulty_score: {
        type: "integer",
        minimum: 1,
        maximum: 10,
      },
    },
    required: [
      "movement_pattern",
      "force_type",
      "laterality",
      "primary_muscles",
      "secondary_muscles",
      "equipment_required",
      "difficulty_score",
    ],
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseRow {
  id: string
  name: string
  category: string[]
  difficulty: string
  description: string | null
  equipment: string | null
  instructions: string | null
  muscle_group: string | null
  training_intent: string[]
}

interface AIMetadata {
  movement_pattern: string
  force_type: string
  laterality: string
  primary_muscles: string[]
  secondary_muscles: string[]
  equipment_required: string[]
  difficulty_score: number
}

interface EnrichResult {
  exerciseId: string
  exerciseName: string
  success: boolean
  tokensUsed: number
  error?: string
}

// ─── Build user message ───────────────────────────────────────────────────────

function buildUserMessage(exercise: ExerciseRow): string {
  const parts = [`Exercise: ${exercise.name}`]
  parts.push(`Category: ${exercise.category.join(", ")}`)

  if (exercise.difficulty) parts.push(`Difficulty: ${exercise.difficulty}`)
  if (exercise.description) parts.push(`Description: ${exercise.description}`)
  if (exercise.equipment) parts.push(`Equipment: ${exercise.equipment}`)
  if (exercise.instructions) parts.push(`Instructions: ${exercise.instructions}`)
  if (exercise.muscle_group) parts.push(`Muscle group: ${exercise.muscle_group}`)
  if (exercise.training_intent?.length > 0) {
    parts.push(`Training intent: ${exercise.training_intent.join(", ")}`)
  }

  return parts.join("\n")
}

// ─── Call Anthropic API ───────────────────────────────────────────────────────

async function callWithRetry(userMessage: string): Promise<Anthropic.Message> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        tools: [metadataTool],
        tool_choice: { type: "tool", name: "set_exercise_metadata" },
      })
    } catch (err: unknown) {
      const isRateLimit = err instanceof Anthropic.APIError && err.status === 429
      if (isRateLimit && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 2000 // 4s, 8s, 16s
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
  throw new Error("Unreachable")
}

async function enrichExercise(exercise: ExerciseRow): Promise<EnrichResult> {
  const userMessage = buildUserMessage(exercise)

  try {
    const response = await callWithRetry(userMessage)

    // Extract tool use result
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

    if (!toolUse?.input) {
      return {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        success: false,
        tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
        error: "No tool_use block in response",
      }
    }

    const metadata = toolUse.input as AIMetadata
    const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)

    // Validate movement_pattern against allowed values (DB CHECK constraint)
    const validMovementPatterns = new Set(MOVEMENT_PATTERNS)
    const movementPattern =
      metadata.movement_pattern &&
      validMovementPatterns.has(metadata.movement_pattern as (typeof MOVEMENT_PATTERNS)[number])
        ? metadata.movement_pattern
        : null

    const validForceTypes = new Set(FORCE_TYPES)
    const forceType =
      metadata.force_type && validForceTypes.has(metadata.force_type as (typeof FORCE_TYPES)[number])
        ? metadata.force_type
        : null

    const validLaterality = new Set(LATERALITY_OPTIONS)
    const laterality =
      metadata.laterality && validLaterality.has(metadata.laterality as (typeof LATERALITY_OPTIONS)[number])
        ? metadata.laterality
        : null

    // Update Supabase (skip training_intent and is_bodyweight — those are authoritative from spreadsheet)
    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from("exercises")
        .update({
          movement_pattern: movementPattern,
          force_type: forceType,
          laterality: laterality,
          primary_muscles: metadata.primary_muscles,
          secondary_muscles: metadata.secondary_muscles,
          equipment_required: metadata.equipment_required,
          difficulty_score: metadata.difficulty_score,
        })
        .eq("id", exercise.id)

      if (updateError) {
        return {
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          success: false,
          tokensUsed,
          error: `Supabase update failed: ${updateError.message}`,
        }
      }
    }

    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      success: true,
      tokensUsed,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      success: false,
      tokensUsed: 0,
      error: message,
    }
  }
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++
      results[currentIndex] = await fn(items[currentIndex])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  console.log("=== Enrich AI Metadata ===")
  if (DRY_RUN) console.log("  Mode: DRY RUN (no database changes)")
  if (FORCE) console.log("  Mode: FORCE (re-enrich all exercises)")
  console.log()

  // Validate env
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set")
  }

  // Fetch exercises
  console.log("Fetching exercises from Supabase...")

  let query = supabase
    .from("exercises")
    .select("id, name, category, difficulty, description, equipment, instructions, muscle_group, training_intent")
    .eq("is_active", true)
    .order("name", { ascending: true })

  if (!FORCE) {
    query = query.is("movement_pattern", null)
  }

  const { data: exercises, error: fetchError } = await query

  if (fetchError) {
    throw new Error(`Failed to fetch exercises: ${fetchError.message}`)
  }

  if (!exercises || exercises.length === 0) {
    console.log("No exercises need enrichment. Done.")
    return
  }

  console.log(`Found ${exercises.length} exercises to enrich.`)
  console.log(`Concurrency: ${CONCURRENCY} | Batch delay: ${BATCH_DELAY_MS}ms\n`)

  // Process in batches for rate limiting
  const BATCH_SIZE = CONCURRENCY
  const allResults: EnrichResult[] = []
  let processed = 0

  for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
    const batch = exercises.slice(i, i + BATCH_SIZE) as ExerciseRow[]

    const batchResults = await processWithConcurrency(batch, CONCURRENCY, enrichExercise)

    allResults.push(...batchResults)
    processed += batch.length

    // Progress logging
    if (processed % PROGRESS_INTERVAL === 0 || processed === exercises.length) {
      const succeeded = allResults.filter((r) => r.success).length
      const failed = allResults.filter((r) => !r.success).length
      console.log(`  Progress: ${processed}/${exercises.length} (${succeeded} ok, ${failed} failed)`)
    }

    // Rate limiting delay between batches
    if (i + BATCH_SIZE < exercises.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const succeeded = allResults.filter((r) => r.success)
  const failed = allResults.filter((r) => !r.success)
  const totalTokens = allResults.reduce((sum, r) => sum + r.tokensUsed, 0)

  console.log("\n=== Summary ===")
  console.log(`  Total exercises processed: ${allResults.length}`)
  console.log(`  Succeeded: ${succeeded.length}`)
  console.log(`  Failed:    ${failed.length}`)
  console.log(`  Total API tokens used: ${totalTokens.toLocaleString()}`)
  console.log(`  Time elapsed: ${elapsed}s`)

  if (DRY_RUN) {
    console.log("\n  (DRY RUN - no database changes were made)")
    // Print a few sample results
    const samples = succeeded.slice(0, 3)
    if (samples.length > 0) {
      console.log("\n  Sample results would have been written to DB.")
    }
  }

  if (failed.length > 0) {
    console.log("\n=== Failed Exercises ===")
    for (const f of failed) {
      console.log(`  - ${f.exerciseName}: ${f.error}`)
    }
  }

  console.log("\nDone.")
}

main().catch((err) => {
  console.error("\nFatal error:", err)
  process.exit(1)
})
