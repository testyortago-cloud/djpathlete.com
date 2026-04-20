// Firebase Function: runs Tavily search for a topic, optionally extracts full
// content from the top N results, and writes a research brief to the ai_jobs
// doc so the caller (typically a blog generation flow) can consume it.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"

export interface TavilyResearchInput {
  topic: string
  extract_top_n?: number
  search_depth?: "basic" | "advanced"
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

    await jobRef.update({
      status: "completed",
      result: {
        topic: input.topic,
        summary: search.answer ?? null,
        results: search.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          score: r.score,
          published_date: r.published_date ?? null,
        })),
        extracted: extractedContent,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown tavily research error")
  }
}
