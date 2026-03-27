/**
 * Batch-backfill exercises with enhanced metadata (sport_tags, plane_of_motion, joints_loaded, aliases)
 *
 * Run: npx tsx scripts/backfill-exercise-metadata.ts
 * Dry run: npx tsx scripts/backfill-exercise-metadata.ts --dry-run
 * Force all: npx tsx scripts/backfill-exercise-metadata.ts --force (re-generate even if already has data)
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

// ─── Valid enum values ───────────────────────────────────────────────────────

const PLANES_OF_MOTION = ["sagittal", "frontal", "transverse"] as const

const JOINT_NAMES = [
  "ankle", "knee", "hip", "lumbar_spine", "thoracic_spine",
  "shoulder", "elbow", "wrist",
] as const

const JOINT_LOAD_LEVELS = ["low", "moderate", "high"] as const

const SPORT_TAG_OPTIONS = [
  "tennis", "golf", "baseball", "softball", "soccer", "basketball",
  "football", "lacrosse", "hockey", "swimming", "track_field",
  "volleyball", "rugby", "cricket", "pickleball", "running",
  "cycling", "martial_arts", "wrestling", "rowing", "general_athletics",
] as const

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an exercise science expert specializing in sports performance. Given exercise information, predict the following enhanced metadata fields. Be accurate and consistent.

Available values for each field:
- sport_tags: array of sports this exercise has high biomechanical transfer to. Options: ${SPORT_TAG_OPTIONS.join(", ")}. Include 0-5 sports with genuine high transfer.
- plane_of_motion: ${PLANES_OF_MOTION.join(", ")} (array — exercises can operate in multiple planes)
- joints_loaded: array of objects with "joint" and "load" fields:
  - joint options: ${JOINT_NAMES.join(", ")}
  - load options: ${JOINT_LOAD_LEVELS.join(", ")}
  - Only include joints that are meaningfully loaded (skip negligible involvement)
- aliases: common alternative names for this exercise (e.g. "RDL" for Romanian Deadlift). Include 0-4 aliases.

Rules:
- sport_tags: tag based on genuine biomechanical transfer, not loose connections:
  - Rotational exercises → tennis, golf, baseball, cricket
  - Single-leg/lateral movements → soccer, basketball, lacrosse, tennis
  - Overhead movements → volleyball, swimming, tennis
  - Power/explosive → track_field, football, rugby
  - Sprinting/agility → soccer, basketball, football, track_field
  - General compound exercises like squats, deadlifts → general_athletics (most athletes benefit)
  - Do NOT tag every exercise with every sport — be selective
- plane_of_motion: sagittal = forward/backward (squats, lunges, curls), frontal = side to side (lateral raises, lateral lunges), transverse = rotational (woodchops, Russian twists). Many exercises are multi-plane.
- joints_loaded: "high" = primary load-bearing under significant force (knee in squats, shoulder in overhead press), "moderate" = meaningful but not primary (wrist in bench press, ankle in squats), "low" = stabilization role only
- aliases: include common abbreviations (RDL, BB, DB), alternative names (Stiff-Leg Deadlift for Romanian Deadlift), and shortened names. Do NOT include the original exercise name as an alias.`

// ─── Tool schema for structured output ──────────────────────────────────────

const metadataTool: Anthropic.Tool = {
  name: "set_extended_metadata",
  description: "Set the enhanced metadata for an exercise (sport tags, planes, joints, aliases)",
  input_schema: {
    type: "object" as const,
    properties: {
      sport_tags: {
        type: "array",
        items: { type: "string", enum: [...SPORT_TAG_OPTIONS] },
        description: "Sports this exercise has high biomechanical transfer to",
      },
      plane_of_motion: {
        type: "array",
        items: { type: "string", enum: [...PLANES_OF_MOTION] },
        description: "Movement planes used by this exercise",
      },
      joints_loaded: {
        type: "array",
        items: {
          type: "object",
          properties: {
            joint: { type: "string", enum: [...JOINT_NAMES] },
            load: { type: "string", enum: [...JOINT_LOAD_LEVELS] },
          },
          required: ["joint", "load"],
        },
        description: "Which joints are stressed and how heavily",
      },
      aliases: {
        type: "array",
        items: { type: "string" },
        description: "Common alternative names for this exercise",
      },
    },
    required: ["sport_tags", "plane_of_motion", "joints_loaded", "aliases"],
  },
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExerciseRow {
  id: string
  name: string
  category: string[]
  difficulty: string
  description: string | null
  equipment: string | null
  instructions: string | null
  muscle_group: string | null
  movement_pattern: string | null
  primary_muscles: string[]
  secondary_muscles: string[]
  training_intent: string[]
  sport_tags: string[]
}

interface AIMetadata {
  sport_tags: string[]
  plane_of_motion: string[]
  joints_loaded: { joint: string; load: string }[]
  aliases: string[]
}

interface BackfillResult {
  exerciseId: string
  exerciseName: string
  success: boolean
  tokensUsed: number
  error?: string
}

// ─── Build user message ─────────────────────────────────────────────────────

function buildUserMessage(exercise: ExerciseRow): string {
  const parts = [`Exercise: ${exercise.name}`]
  parts.push(`Category: ${exercise.category.join(", ")}`)
  if (exercise.difficulty) parts.push(`Difficulty: ${exercise.difficulty}`)
  if (exercise.description) parts.push(`Description: ${exercise.description}`)
  if (exercise.equipment) parts.push(`Equipment: ${exercise.equipment}`)
  if (exercise.muscle_group) parts.push(`Muscle group: ${exercise.muscle_group}`)
  if (exercise.movement_pattern) parts.push(`Movement pattern: ${exercise.movement_pattern}`)
  if (exercise.primary_muscles?.length > 0) parts.push(`Primary muscles: ${exercise.primary_muscles.join(", ")}`)
  if (exercise.secondary_muscles?.length > 0) parts.push(`Secondary muscles: ${exercise.secondary_muscles.join(", ")}`)
  if (exercise.training_intent?.length > 0) parts.push(`Training intent: ${exercise.training_intent.join(", ")}`)
  if (exercise.instructions) parts.push(`Instructions: ${exercise.instructions.slice(0, 500)}`)
  return parts.join("\n")
}

// ─── Call Anthropic API ─────────────────────────────────────────────────────

async function callWithRetry(userMessage: string): Promise<Anthropic.Message> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        tools: [metadataTool],
        tool_choice: { type: "tool", name: "set_extended_metadata" },
      })
    } catch (err: unknown) {
      const isRateLimit = err instanceof Anthropic.APIError && err.status === 429
      if (isRateLimit && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 2000
        console.log(`  Rate limited, retrying in ${delay / 1000}s...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
  throw new Error("Unreachable")
}

// ─── Process single exercise ────────────────────────────────────────────────

async function backfillExercise(exercise: ExerciseRow): Promise<BackfillResult> {
  const userMessage = buildUserMessage(exercise)

  try {
    const response = await callWithRetry(userMessage)

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    )

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

    // Validate values
    const validPlanes = new Set(PLANES_OF_MOTION)
    const validJoints = new Set(JOINT_NAMES)
    const validLoads = new Set(JOINT_LOAD_LEVELS)

    const cleanPlanes = (metadata.plane_of_motion ?? []).filter(
      (p) => validPlanes.has(p as typeof PLANES_OF_MOTION[number])
    )
    const cleanJoints = (metadata.joints_loaded ?? []).filter(
      (jl) => validJoints.has(jl.joint as typeof JOINT_NAMES[number]) && validLoads.has(jl.load as typeof JOINT_LOAD_LEVELS[number])
    )
    const cleanSportTags = (metadata.sport_tags ?? []).filter(
      (s) => typeof s === "string" && s.length > 0
    )
    const cleanAliases = (metadata.aliases ?? []).filter(
      (a) => typeof a === "string" && a.length > 0 && a.length <= 100
    )

    if (DRY_RUN) {
      console.log(`  [dry-run] ${exercise.name}: sports=[${cleanSportTags.join(",")}] planes=[${cleanPlanes.join(",")}] joints=${cleanJoints.length} aliases=[${cleanAliases.join(",")}]`)
    } else {
      const { error: updateError } = await supabase
        .from("exercises")
        .update({
          sport_tags: cleanSportTags,
          plane_of_motion: cleanPlanes,
          joints_loaded: cleanJoints,
          aliases: cleanAliases,
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

    return { exerciseId: exercise.id, exerciseName: exercise.name, success: true, tokensUsed }
  } catch (err) {
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      success: false,
      tokensUsed: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

// ─── Concurrency limiter ────────────────────────────────────────────────────

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
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

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  console.log("=== Backfill Exercise Enhanced Metadata ===")
  console.log("  Fields: sport_tags, plane_of_motion, joints_loaded, aliases")
  if (DRY_RUN) console.log("  Mode: DRY RUN (no database changes)")
  if (FORCE) console.log("  Mode: FORCE (re-generate all exercises)")
  console.log()

  // Validate env
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set")

  // Fetch exercises
  console.log("Fetching exercises from Supabase...")

  let query = supabase
    .from("exercises")
    .select("id, name, category, difficulty, description, equipment, instructions, muscle_group, movement_pattern, primary_muscles, secondary_muscles, training_intent, sport_tags")
    .eq("is_active", true)
    .order("name", { ascending: true })

  if (!FORCE) {
    // Only process exercises that haven't been backfilled yet (empty sport_tags)
    query = query.eq("sport_tags", "{}")
  }

  const { data: exercises, error: fetchError } = await query

  if (fetchError) throw new Error(`Failed to fetch exercises: ${fetchError.message}`)

  if (!exercises || exercises.length === 0) {
    console.log("No exercises need backfilling. Done.")
    return
  }

  console.log(`Found ${exercises.length} exercises to backfill.`)
  console.log(`Concurrency: ${CONCURRENCY} | Batch delay: ${BATCH_DELAY_MS}ms\n`)

  // Process in batches
  const BATCH_SIZE = CONCURRENCY
  const allResults: BackfillResult[] = []
  let processed = 0

  for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
    const batch = exercises.slice(i, i + BATCH_SIZE) as ExerciseRow[]

    const batchResults = await processWithConcurrency(batch, CONCURRENCY, backfillExercise)

    allResults.push(...batchResults)
    processed += batch.length

    if (processed % PROGRESS_INTERVAL === 0 || processed === exercises.length) {
      const succeeded = allResults.filter((r) => r.success).length
      const failed = allResults.filter((r) => !r.success).length
      console.log(`  Progress: ${processed}/${exercises.length} (${succeeded} ok, ${failed} failed)`)
    }

    if (i + BATCH_SIZE < exercises.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }

  // Summary
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
