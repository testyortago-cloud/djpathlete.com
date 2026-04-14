import { embedText } from "./embeddings.js"
import { getSupabase } from "../lib/supabase.js"
import type { AiFeature } from "./types.js"

// ─── Embed a conversation message (async, fire-and-forget) ──────────────────

export async function embedConversationMessage(messageId: string): Promise<void> {
  const supabase = getSupabase()
  const { data: message } = await supabase.from("ai_conversation_history").select("*").eq("id", messageId).single()

  if (!message || message.role !== "assistant") return

  const metadataSummary = buildMetadataSummary(message.feature, message.metadata ?? {})
  const textToEmbed =
    `Feature: ${message.feature}${metadataSummary ? ` | ${metadataSummary}` : ""}\n${message.content}`.slice(0, 2000)

  const embedding = await embedText(textToEmbed)
  await supabase
    .from("ai_conversation_history")
    .update({ embedding: JSON.stringify(embedding) })
    .eq("id", messageId)
}

function buildMetadataSummary(feature: string, metadata: Record<string, unknown>): string {
  const parts: string[] = []
  if (metadata.exercise_name) parts.push(`Exercise: ${metadata.exercise_name}`)
  if (metadata.model) parts.push(`Model: ${metadata.model}`)
  if (metadata.step) parts.push(`Step: ${metadata.step}`)
  if (metadata.client_id) parts.push(`Client: ${metadata.client_id}`)
  if (feature === "ai_coach" && metadata.analysis) {
    const analysis = metadata.analysis as Record<string, unknown>
    if (analysis.plateau_detected) parts.push("Plateau detected")
    if (analysis.deload_recommended) parts.push("Deload recommended")
  }
  return parts.join(" | ")
}

// ─── Retrieve similar context ───────────────────────────────────────────────

export interface RagContext {
  id: string
  content: string
  feature: string
  metadata: Record<string, unknown>
  similarity: number
  avgRating: number | null
}

export async function retrieveSimilarContext(
  query: string,
  feature: AiFeature,
  opts?: { excludeSession?: string; threshold?: number; limit?: number; timeoutMs?: number },
): Promise<RagContext[]> {
  const timeoutMs = opts?.timeoutMs ?? 2000
  try {
    const results = await Promise.race([
      doRetrieval(query, feature, opts),
      new Promise<RagContext[]>((_, reject) =>
        setTimeout(() => reject(new Error("RAG retrieval timed out")), timeoutMs),
      ),
    ])
    return results
  } catch {
    return []
  }
}

async function doRetrieval(
  query: string,
  feature: AiFeature,
  opts?: { excludeSession?: string; threshold?: number; limit?: number },
): Promise<RagContext[]> {
  const supabase = getSupabase()
  const queryEmbedding = await embedText(query)

  const { data: matches } = await supabase.rpc("match_ai_conversations", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_feature: feature,
    match_threshold: opts?.threshold ?? 0.4,
    match_count: opts?.limit ?? 5,
    exclude_session: opts?.excludeSession ?? null,
  })

  if (!matches?.length) return []

  const enriched = await Promise.all(
    (
      matches as Array<{
        id: string
        content: string
        feature: string
        metadata: Record<string, unknown>
        similarity: number
      }>
    ).map(async (match) => {
      let avgRating: number | null = null
      try {
        const { data: feedback } = await supabase
          .from("ai_feedback")
          .select("accuracy_rating, relevance_rating, helpfulness_rating")
          .eq("conversation_message_id", match.id)
        if (feedback?.length) {
          const ratings = feedback
            .flatMap((f: Record<string, unknown>) => [f.accuracy_rating, f.relevance_rating, f.helpfulness_rating])
            .filter((r): r is number => r != null)
          if (ratings.length > 0) avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length
        }
      } catch {
        /* non-fatal */
      }

      return {
        id: match.id,
        content: match.content,
        feature: match.feature,
        metadata: match.metadata,
        similarity: match.similarity,
        avgRating,
      }
    }),
  )

  return enriched.filter((r) => r.avgRating === null || r.avgRating >= 2.0)
}

// ─── Format RAG context ────────────────────────────────────────────────────

export function formatRagContext(results: RagContext[]): string {
  if (results.length === 0) return ""
  const sections = results.map((result, idx) => {
    const metaSummary = buildMetadataSummary(result.feature, result.metadata)
    const ratingStr = result.avgRating ? ` (quality: ${result.avgRating.toFixed(1)}/5)` : ""
    const truncatedContent = result.content.length > 800 ? result.content.slice(0, 800) + "..." : result.content
    return `### Scenario ${idx + 1}${ratingStr}\nContext: ${result.feature}${metaSummary ? ` | ${metaSummary}` : ""}\nResponse: ${truncatedContent}`
  })
  return `## Similar Past Scenarios\n\nThe following are relevant past AI responses. Use them as reference to maintain consistency and quality, but adapt to the current situation.\n\n${sections.join("\n\n")}`
}

export function buildRagAugmentedPrompt(basePrompt: string, ragContext: string): string {
  if (!ragContext) return basePrompt
  return `${basePrompt}\n\n${ragContext}`
}
