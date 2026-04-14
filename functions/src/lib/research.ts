// ─── Research API Integration ────────────────────────────────────────────────
// Searches PubMed (primary) and Semantic Scholar (fallback) for real research
// papers to feed into the blog generation prompt as verified citations.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResearchPaper {
  pmid: string | null
  doi: string | null
  title: string
  authors: string
  journal: string
  year: string
  abstract: string
  url: string
}

export interface ResearchResult {
  papers: ResearchPaper[]
  source: "pubmed" | "semantic_scholar" | "none"
  query_used: string
  duration_ms: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

// PubMed esummary article shape
interface PubMedArticle {
  title?: string
  authors?: { name: string }[]
  fulljournalname?: string
  source?: string
  pubdate?: string
  articleids?: { idtype: string; value: string }[]
}

// Semantic Scholar paper shape
interface SemanticScholarPaper {
  title: string
  abstract?: string
  year?: number
  citationCount?: number
  externalIds?: { DOI?: string; PubMed?: string }
  url?: string
}

const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1"
const TOOL_NAME = "DJPAthlete"
const TOOL_EMAIL = "admin@darrenjpaul.com"
const MIN_PAPERS = 5
const MAX_PAPERS = 8
const FETCH_TIMEOUT_MS = 10_000
const TOTAL_TIMEOUT_MS = 45_000

// ─── Stop Words ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  // Standard English
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "must",
  "ought",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "it",
  "they",
  "them",
  "their",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "where",
  "why",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just",
  "also",
  "more",
  "most",
  "some",
  "any",
  "all",
  "each",
  "every",
  "both",
  "few",
  "many",
  "much",
  "own",
  "other",
  "no",
  "only",
  "same",
  "such",
  "into",
  "over",
  "after",
  "before",
  "between",
  "through",
  "during",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "with",
  "without",
  "at",
  "by",
  "for",
  "of",
  "about",
  "as",
  // Domain-specific filler
  "write",
  "blog",
  "post",
  "article",
  "create",
  "generate",
  "topic",
  "please",
  "discuss",
  "explain",
  "cover",
  "make",
  "help",
  "want",
  "think",
  "know",
  "like",
  "good",
  "best",
  "way",
  "ways",
  "thing",
  "things",
  "get",
  "got",
  "use",
  "using",
  "used",
  "new",
  "important",
  "really",
  "look",
  "looking",
  "based",
  "key",
  "main",
  "great",
])

// Known compound terms in fitness/sports science — keep as phrases
const COMPOUND_TERMS = new Map([
  ["progressive overload", true],
  ["strength training", true],
  ["resistance training", true],
  ["youth development", true],
  ["athletic development", true],
  ["sports science", true],
  ["muscle hypertrophy", true],
  ["power output", true],
  ["rate of force", true],
  ["range of motion", true],
  ["body composition", true],
  ["heart rate", true],
  ["blood pressure", true],
  ["mental health", true],
  ["sleep quality", true],
  ["injury prevention", true],
  ["load management", true],
  ["periodization training", true],
  ["plyometric training", true],
  ["high intensity", true],
  ["long term", true],
  ["sports performance", true],
  ["exercise science", true],
  ["physical activity", true],
  ["functional movement", true],
  ["eccentric training", true],
  ["concentric training", true],
  ["isometric training", true],
  ["aerobic capacity", true],
  ["anaerobic capacity", true],
  ["neuromuscular adaptation", true],
  ["motor learning", true],
  ["relative age", true],
  ["maturation timing", true],
])

// ─── Keyword Extraction ─────────────────────────────────────────────────────

export function extractKeywords(prompt: string): string[] {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // First, extract any compound terms found in the prompt
  const compounds: string[] = []
  let remaining = cleaned
  for (const [term] of COMPOUND_TERMS) {
    if (remaining.includes(term)) {
      compounds.push(term)
      remaining = remaining.replace(term, " ").replace(/\s+/g, " ").trim()
    }
  }

  // Then extract single significant words from what's left
  const singles = remaining.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))

  // Combine: compounds first, then singles, deduplicated
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const term of [...compounds, ...singles]) {
    if (!seen.has(term)) {
      seen.add(term)
      keywords.push(term)
    }
  }

  return keywords.slice(0, 5)
}

// ─── Fetch Helper ───────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DJPAthlete-Bot/1.0; +https://djpathlete.com)",
      },
    })
    return res
  } finally {
    clearTimeout(timeout)
  }
}

// ─── PubMed Search ──────────────────────────────────────────────────────────

async function searchPubMed(keywords: string[]): Promise<string[]> {
  // Build progressively broader queries
  const queries = [
    // Query A: All keywords AND-joined with title/abstract restriction
    keywords.map((k) => `${k}[tiab]`).join(" AND "),
    // Query B: Top 3 keywords, less restrictive
    keywords.slice(0, 3).join(" AND "),
    // Query C: Top 2 keywords, broadest
    keywords.slice(0, 2).join(" AND "),
  ]

  const allPmids: string[] = []
  const seen = new Set<string>()

  for (const query of queries) {
    const fullQuery = `${query} AND 2016:2026[dp] AND english[la]`
    const url = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&retmode=json&retmax=${MAX_PAPERS}&sort=relevance&tool=${TOOL_NAME}&email=${TOOL_EMAIL}&term=${encodeURIComponent(fullQuery)}`

    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) continue

      const data = (await res.json()) as { esearchresult?: { idlist?: string[] } }
      const ids: string[] = data?.esearchresult?.idlist ?? []

      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id)
          allPmids.push(id)
        }
      }

      if (allPmids.length >= MIN_PAPERS) break
    } catch {
      continue
    }
  }

  return allPmids.slice(0, MAX_PAPERS)
}

async function fetchPubMedDetails(pmids: string[]): Promise<ResearchPaper[]> {
  if (pmids.length === 0) return []

  const url = `${PUBMED_BASE}/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}&tool=${TOOL_NAME}&email=${TOOL_EMAIL}`

  const res = await fetchWithTimeout(url)
  if (!res.ok) return []

  const data = (await res.json()) as { result?: Record<string, PubMedArticle> }
  const result = data?.result
  if (!result) return []

  const papers: ResearchPaper[] = []

  for (const pmid of pmids) {
    const article = result[pmid]
    if (!article || !article.title) continue

    const authors = (article.authors ?? [])
      .slice(0, 3)
      .map((a: { name: string }) => a.name)
      .join(", ")
    const authorStr = (article.authors?.length ?? 0) > 3 ? `${authors}, et al.` : authors

    const doi =
      (article.articleids ?? []).find((a: { idtype: string; value: string }) => a.idtype === "doi")?.value ?? null

    papers.push({
      pmid,
      doi,
      title: article.title.replace(/\.$/, ""),
      authors: authorStr,
      journal: article.fulljournalname || article.source || "",
      year: (article.pubdate ?? "").split(" ")[0],
      abstract: "", // esummary doesn't return abstracts — metadata is sufficient
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    })
  }

  return papers
}

// ─── Semantic Scholar Fallback ──────────────────────────────────────────────

async function searchSemanticScholar(keywords: string[]): Promise<ResearchPaper[]> {
  const query = keywords.join(" ")
  const fields = "title,abstract,year,citationCount,externalIds,url"
  const url = `${SEMANTIC_SCHOLAR_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${MAX_PAPERS}&fields=${fields}&year=2016-2026`

  const res = await fetchWithTimeout(url)
  if (!res.ok) return []

  const data = (await res.json()) as { data?: SemanticScholarPaper[] }
  const results = data?.data ?? []

  // Sort by citation count (most-cited = most credible)
  const sorted = results
    .filter((p) => p.title && (p.citationCount ?? 0) > 0)
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))

  return sorted.slice(0, MAX_PAPERS).map((paper) => {
    const doi = paper.externalIds?.DOI ?? null
    const pmid = paper.externalIds?.PubMed ?? null

    return {
      pmid,
      doi,
      title: paper.title,
      authors: "",
      journal: "",
      year: paper.year?.toString() ?? "",
      abstract: paper.abstract?.slice(0, 200) ?? "",
      url: doi ? `https://doi.org/${doi}` : (paper.url ?? ""),
    }
  })
}

// ─── Format for Prompt ──────────────────────────────────────────────────────

export function formatResearchForPrompt(papers: ResearchPaper[]): string {
  if (papers.length === 0) return ""

  const entries = papers
    .map((p, i) => {
      const parts = [`[${i + 1}] "${p.title}"`]
      const meta: string[] = []
      if (p.authors) meta.push(p.authors)
      if (p.journal) meta.push(p.journal)
      if (p.year) meta.push(p.year)
      if (meta.length > 0) parts.push(`    ${meta.join(" | ")}`)
      parts.push(`    URL: ${p.url}`)
      if (p.abstract) parts.push(`    Abstract: ${p.abstract}...`)
      return parts.join("\n")
    })
    .join("\n\n")

  return `

── VERIFIED RESEARCH SOURCES ──────────────────────────────────
You MUST cite from these verified, real research papers. Use the exact URLs provided — they have been verified as live.
Do NOT invent any other research paper URLs or DOI links. You may also cite well-known organization pages (WHO fact sheets, NSCA position statements) if relevant.

${entries}

Use at least 3 of these sources as inline <a href="..."> citations in the blog post.
Include all cited sources in the "References" section at the end with their full titles as link text.
────────────────────────────────────────────────────────────────`
}

// ─── Main Export ────────────────────────────────────────────────────────────

export async function fetchResearchPapers(blogPrompt: string): Promise<ResearchResult> {
  const start = Date.now()
  const keywords = extractKeywords(blogPrompt)

  if (keywords.length === 0) {
    return { papers: [], source: "none", query_used: "", duration_ms: 0 }
  }

  const queryStr = keywords.join(", ")

  // Wrap entire research phase in a total timeout
  const timeoutPromise = new Promise<ResearchResult>((resolve) => {
    setTimeout(() => {
      console.warn("[research] Total timeout reached, proceeding without research")
      resolve({ papers: [], source: "none", query_used: queryStr, duration_ms: Date.now() - start })
    }, TOTAL_TIMEOUT_MS)
  })

  const researchPromise = (async (): Promise<ResearchResult> => {
    // Try PubMed first
    try {
      const pmids = await searchPubMed(keywords)
      if (pmids.length >= MIN_PAPERS) {
        const papers = await fetchPubMedDetails(pmids)
        if (papers.length > 0) {
          return { papers, source: "pubmed", query_used: queryStr, duration_ms: Date.now() - start }
        }
      }
    } catch (err) {
      console.warn("[research] PubMed search failed:", err)
    }

    // Fallback to Semantic Scholar
    try {
      const papers = await searchSemanticScholar(keywords)
      if (papers.length > 0) {
        return { papers, source: "semantic_scholar", query_used: queryStr, duration_ms: Date.now() - start }
      }
    } catch (err) {
      console.warn("[research] Semantic Scholar search failed:", err)
    }

    // If PubMed returned some (< MIN_PAPERS) results, use those
    try {
      const pmids = await searchPubMed(keywords)
      if (pmids.length > 0) {
        const papers = await fetchPubMedDetails(pmids)
        if (papers.length > 0) {
          return { papers, source: "pubmed", query_used: queryStr, duration_ms: Date.now() - start }
        }
      }
    } catch {
      /* already tried */
    }

    return { papers: [], source: "none", query_used: queryStr, duration_ms: Date.now() - start }
  })()

  return Promise.race([researchPromise, timeoutPromise])
}
