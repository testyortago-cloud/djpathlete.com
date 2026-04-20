// functions/src/lib/research-brief.ts
// Pure helper + types for shaping Tavily output into the stored research brief.
// Shared between tavilyResearch and blogFromVideo Functions.

export interface TavilyResearchBrief {
  topic: string
  summary: string | null
  results: Array<{
    title: string
    url: string
    snippet: string
    score: number
    published_date: string | null
  }>
  extracted: Array<{ url: string; content: string }>
  generated_at: string
}

export interface BuildBriefParams {
  topic: string
  search: {
    answer: string | null
    results: Array<{
      title: string
      url: string
      content: string
      score: number
      published_date?: string | null
    }>
  }
  extractedContent: Array<{ url: string; content: string }>
  generatedAt: string
}

export function buildResearchBrief(p: BuildBriefParams): TavilyResearchBrief {
  return {
    topic: p.topic,
    summary: p.search.answer ?? null,
    results: p.search.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      published_date: r.published_date ?? null,
    })),
    extracted: p.extractedContent,
    generated_at: p.generatedAt,
  }
}
