// Tavily client for live-web research: search + extract.
// Docs: https://docs.tavily.com/

const SEARCH_URL = "https://api.tavily.com/search"
const EXTRACT_URL = "https://api.tavily.com/extract"

export interface TavilySearchInput {
  query: string
  search_depth?: "basic" | "advanced"
  include_answer?: boolean
  include_raw_content?: boolean
  max_results?: number
  include_domains?: string[]
  exclude_domains?: string[]
  /**
   * Recency filter. Tavily accepts "day" | "week" | "month" | "year" (and the
   * single-letter forms d/w/m/y). Without one, a query with no date terms in it
   * returns the same canonical, most-cited pages every single time it runs —
   * which is exactly how the weekly topic scan kept resurfacing the same
   * force-velocity papers. Verified against docs.tavily.com 2026-09-12.
   */
  time_range?: "day" | "week" | "month" | "year"
  /** YYYY-MM-DD. Paired with end_date for an explicit window. */
  start_date?: string
  /** YYYY-MM-DD. */
  end_date?: string
  /** Return each result's publication date so callers can show/sort by vintage. */
  include_published_date?: boolean
  /**
   * Hard-drop results published outside the window rather than merely ranking
   * them lower. Leave FALSE for academic queries: indexing lag means a strict
   * filter can empty a query that would otherwise return good recent work.
   */
  filter_by_published_date?: boolean
}

export interface TavilySearchResult {
  query: string
  answer?: string
  results: Array<{
    title: string
    url: string
    content: string
    score: number
    published_date?: string
  }>
}

export interface TavilyExtractInput {
  urls: string[]
  include_images?: boolean
}

export interface TavilyExtractResult {
  results: Array<{ url: string; raw_content: string }>
  failed_results: Array<{ url: string; error: string }>
}

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY
  if (!key) {
    throw new Error("TAVILY_API_KEY environment variable is required")
  }
  return key
}

export async function tavilySearch(input: TavilySearchInput): Promise<TavilySearchResult> {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: getApiKey(),
      query: input.query,
      search_depth: input.search_depth ?? "basic",
      include_answer: input.include_answer ?? true,
      include_raw_content: input.include_raw_content ?? false,
      max_results: input.max_results ?? 5,
      include_domains: input.include_domains,
      exclude_domains: input.exclude_domains,
      time_range: input.time_range,
      start_date: input.start_date,
      end_date: input.end_date,
      include_published_date: input.include_published_date,
      filter_by_published_date: input.filter_by_published_date,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Tavily search failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TavilySearchResult
}

export async function tavilyExtract(input: TavilyExtractInput): Promise<TavilyExtractResult> {
  const response = await fetch(EXTRACT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: getApiKey(),
      urls: input.urls,
      include_images: input.include_images ?? false,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Tavily extract failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TavilyExtractResult
}
