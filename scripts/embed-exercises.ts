/**
 * Re-embeds EVERY stored vector with the current embedder (lib/ai/embeddings.ts —
 * OpenRouter, openai/text-embedding-3-small at 384 dimensions):
 *
 *   exercises.embedding              — every exercise (match_exercises searches these)
 *   ai_conversation_history.embedding — every row that already has one (RAG)
 *   ai_program_feedback.embedding     — every row that already has one
 *
 * Run it whenever the embedding model or size changes: vectors from two models are not
 * comparable, so a search that embeds its query with the new model against rows stored
 * by the old one returns noise. Each row's text comes from the SAME builder its writer
 * uses (exerciseToText, conversationEmbeddingText, programFeedbackEmbeddingText).
 *
 *   npx tsx scripts/embed-exercises.ts                       # dev clone (.env.local)
 *   npx tsx scripts/embed-exercises.ts --env .env.prod --yes # production — writes vectors
 *
 * Re-running is safe: it overwrites. Cost on 2026-10-01: ~2,600 rows, well under a cent.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const envFile = args.includes("--env") ? args[args.indexOf("--env") + 1] : ".env.local"
dotenv.config({ path: resolve(__dirname, "..", envFile) })

const DEV_CLONE_REF = "anjvztjiokcgiyhobknq"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.OPENROUTER_API_KEY) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OPENROUTER_API_KEY in ${envFile}`)
  process.exit(1)
}
if (!SUPABASE_URL.includes(DEV_CLONE_REF) && !args.includes("--yes")) {
  console.error(`Refusing: ${SUPABASE_URL} is not the dev clone. Pass --yes to write production vectors.`)
  process.exit(1)
}

// PostgREST answers at most 1000 rows per request, silently. Page explicitly.
const PAGE = 500

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  onlyEmbedded: boolean,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + PAGE - 1)
    if (onlyEmbedded) q = q.not("embedding", "is", null)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return rows
  }
}

async function reembed<T extends { id: string }>(
  supabase: SupabaseClient,
  table: string,
  rows: T[],
  toText: (row: T) => string,
  embedTexts: (texts: string[]) => Promise<number[][]>,
): Promise<void> {
  let done = 0
  let failed = 0
  const BATCH = 96
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const vectors = await embedTexts(batch.map(toText))
    await Promise.all(
      batch.map(async (row, k) => {
        const { error } = await supabase
          .from(table)
          .update({ embedding: JSON.stringify(vectors[k]) })
          .eq("id", row.id)
        if (error) {
          failed++
          console.error(`\n  [FAIL] ${table} ${row.id}: ${error.message}`)
        } else done++
      }),
    )
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`)
  }
  console.log(`\n  ${table}: ${done} re-embedded, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

async function main() {
  const { exerciseToText, embedTexts } = await import("../lib/ai/embeddings")
  const { programFeedbackEmbeddingText } = await import("../lib/ai/program-feedback")
  const { conversationEmbeddingText } = await import("../functions/src/ai/rag")
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  console.log(`[embed] target: ${SUPABASE_URL}`)

  const exercises = await fetchAll<Parameters<typeof exerciseToText>[0] & { id: string }>(
    supabase,
    "exercises",
    "id, name, category, difficulty, muscle_group, movement_pattern, primary_muscles, secondary_muscles, equipment_required, is_bodyweight, training_intent, sport_tags, plane_of_motion",
    false,
  )
  await reembed(supabase, "exercises", exercises, exerciseToText, embedTexts)

  const conversations = await fetchAll<{
    id: string
    feature: string
    metadata: Record<string, unknown> | null
    content: string
  }>(supabase, "ai_conversation_history", "id, feature, metadata, content", true)
  await reembed(supabase, "ai_conversation_history", conversations, conversationEmbeddingText, embedTexts)

  const feedback = await fetchAll<Parameters<typeof programFeedbackEmbeddingText>[0]>(
    supabase,
    "ai_program_feedback",
    "*",
    true,
  )
  await reembed(supabase, "ai_program_feedback", feedback, programFeedbackEmbeddingText, embedTexts)
}

main().catch((err) => {
  console.error("[embed] Fatal error:", err instanceof Error ? err.message : err)
  process.exit(1)
})
