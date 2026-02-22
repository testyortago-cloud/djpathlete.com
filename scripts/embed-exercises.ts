/**
 * Embed all exercises using all-MiniLM-L6-v2 and store in pgvector.
 *
 * Run: npx tsx scripts/embed-exercises.ts
 *
 * First run downloads the model (~25MB) — cached locally after that.
 * Re-running is safe: overwrites existing embeddings.
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, "../.env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Build text representation for each exercise ─────────────────────────────

interface ExerciseRow {
  id: string
  name: string
  category: string[]
  difficulty: string
  muscle_group: string | null
  movement_pattern: string | null
  primary_muscles: string[]
  secondary_muscles: string[]
  equipment_required: string[]
  is_bodyweight: boolean
  is_compound: boolean
}

function exerciseToText(ex: ExerciseRow): string {
  const parts = [
    ex.name,
    ex.category.join(", "),
    ex.difficulty,
    ex.movement_pattern ?? "",
    ex.muscle_group ?? "",
    `primary: ${ex.primary_muscles.join(", ")}`,
    `secondary: ${ex.secondary_muscles.join(", ")}`,
    ex.is_compound ? "compound" : "isolation",
    ex.is_bodyweight ? "bodyweight" : "",
    ex.equipment_required.join(", "),
  ]
  return parts.filter(Boolean).join(" | ")
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[embed] Loading model (first run downloads ~25MB)...")
  const { pipeline } = await import("@huggingface/transformers")
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
  console.log("[embed] Model loaded.")

  // Fetch all active exercises
  const { data: exercises, error } = await supabase
    .from("exercises")
    .select("id, name, category, difficulty, muscle_group, movement_pattern, primary_muscles, secondary_muscles, equipment_required, is_bodyweight, is_compound")
    .eq("is_active", true)
    .order("name")

  if (error) {
    console.error("[embed] Failed to fetch exercises:", error.message)
    process.exit(1)
  }

  console.log(`[embed] Found ${exercises.length} active exercises. Embedding...`)

  let success = 0
  let failed = 0

  for (const ex of exercises as ExerciseRow[]) {
    const text = exerciseToText(ex)

    try {
      const result = await extractor(text, { pooling: "mean", normalize: true }) as { data: Float32Array }
      const embedding = Array.from(result.data)

      const { error: updateError } = await supabase
        .from("exercises")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("id", ex.id)

      if (updateError) {
        console.error(`  [FAIL] ${ex.name}: ${updateError.message}`)
        failed++
      } else {
        success++
        process.stdout.write(`\r  [${success}/${exercises.length}] ${ex.name}`)
      }
    } catch (err) {
      console.error(`\n  [FAIL] ${ex.name}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  console.log(`\n[embed] Done. ${success} embedded, ${failed} failed.`)
}

main().catch((err) => {
  console.error("[embed] Fatal error:", err)
  process.exit(1)
})
