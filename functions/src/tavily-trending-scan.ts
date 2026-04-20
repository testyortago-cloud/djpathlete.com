// functions/src/tavily-trending-scan.ts
// Firebase Function: weekly Tavily trending scan, writes ranked topic
// suggestions into content_calendar.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"

export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

export function buildRankingPrompt(results: TavilySearchResult[]): string {
  if (results.length === 0) {
    return [
      "# TAVILY SEARCH",
      "No search results returned this week.",
      "",
      "# INSTRUCTIONS",
      "Return an empty topics array.",
    ].join("\n")
  }

  const block = results
    .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`)
    .join("\n\n")

  return [
    "# TAVILY SEARCH RESULTS",
    block,
    "",
    "# INSTRUCTIONS",
    "Extract 5-10 topics relevant to a strength & conditioning coaching audience (youth athletes, injury recovery, strength training, nutrition for performance). Skip fitness fads and low-value clickbait. Rank by relevance (1 = most relevant).",
  ].join("\n")
}

export function nextMondayISO(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, ...
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  d.setUTCDate(d.getUTCDate() + daysUntilMonday)
  return d.toISOString().slice(0, 10)
}

const TrendingSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      tavily_url: z.string(),
      rank: z.number(),
    }),
  ),
})

const SYSTEM_PROMPT = `You are a content strategist for DJP Athlete. Given a list of Tavily search results about fitness/coaching trends, extract concrete blog topic ideas a strength & conditioning coach could write about this week. Output JSON: { topics: [{ title, summary, tavily_url, rank }] }. 5-10 topics max. Skip noise.`

export async function handleTavilyTrendingScan(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const search = await tavilySearch({
      query: "fitness coaching trends this week",
      search_depth: "advanced",
      include_answer: false,
      max_results: 15,
    })

    const topicsFromTavily: TavilySearchResult[] = search.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }))

    const userMessage = buildRankingPrompt(topicsFromTavily)

    const result = await callAgent(SYSTEM_PROMPT, userMessage, TrendingSchema, {
      model: MODEL_SONNET,
    })

    const scheduledFor = nextMondayISO(new Date())
    let topicsWritten = 0

    if (result.content.topics.length > 0) {
      const supabase = getSupabase()
      const rows = result.content.topics.map((t) => ({
        entry_type: "topic_suggestion" as const,
        title: t.title.slice(0, 200),
        scheduled_for: scheduledFor,
        status: "planned" as const,
        metadata: {
          source: "tavily",
          rank: t.rank,
          tavily_url: t.tavily_url,
          summary: t.summary,
        },
      }))

      const { error: insertErr } = await supabase.from("content_calendar").insert(rows)
      if (insertErr) {
        await failJob(`content_calendar insert failed: ${insertErr.message}`)
        return
      }
      topicsWritten = rows.length
    }

    await jobRef.update({
      status: "completed",
      result: { topics_written: topicsWritten, scheduled_for: scheduledFor },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown trending-scan error")
  }
}
