// Firebase Function: runs Tavily search for a topic, optionally extracts full
// content from the top N results, writes a research brief to the ai_jobs doc,
// and — when input.blog_post_id is provided — upserts the same brief into
// blog_posts.tavily_research so Phase 4b can consume it on the next page load.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"
import { buildResearchBrief, type TavilyResearchBrief } from "./lib/research-brief.js"

// Re-export so downstream consumers (ResearchPanel test types, etc.) still work.
export { buildResearchBrief }
export type { TavilyResearchBrief }

export interface TavilyResearchInput {
  topic: string
  extract_top_n?: number
  search_depth?: "basic" | "advanced"
  blog_post_id?: string
}

export function shouldPersist(input: TavilyResearchInput): boolean {
  return typeof input.blog_post_id === "string" && input.blog_post_id.length > 0
}

export async function handleTavilyResearch(jobId: string): Promise<void> {
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
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }

    const input = data.input as TavilyResearchInput
    if (!input?.topic) {
      await failJob("input.topic is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const search = await tavilySearch({
      query: input.topic,
      search_depth: input.search_depth ?? "basic",
      include_answer: true,
      max_results: 10,
    })

    let extractedContent: Array<{ url: string; content: string }> = []
    const topN = input.extract_top_n ?? 3
    if (topN > 0 && search.results.length > 0) {
      const urls = search.results.slice(0, topN).map((r) => r.url)
      const extract = await tavilyExtract({ urls })
      extractedContent = extract.results.map((r) => ({ url: r.url, content: r.raw_content }))
    }

    const brief = buildResearchBrief({
      topic: input.topic,
      search: { answer: search.answer ?? null, results: search.results },
      extractedContent,
      generatedAt: new Date().toISOString(),
    })

    if (shouldPersist(input)) {
      const supabase = getSupabase()
      const { error: upsertError } = await supabase
        .from("blog_posts")
        .update({ tavily_research: brief })
        .eq("id", input.blog_post_id)
      if (upsertError) {
        console.error("[tavily-research] blog_posts upsert failed:", upsertError)
        // Do NOT fail the job — the brief is still useful on-screen.
      }
    }

    await jobRef.update({
      status: "completed",
      result: brief,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown tavily research error")
  }
}
