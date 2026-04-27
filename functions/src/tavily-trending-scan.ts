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

// Science-leaning query set: each query targets a distinct sport-science
// surface (academic freshness, methodology, monitoring, power/strength,
// LTAD, applied/elite practice) and uses precise terminology that ranks
// well against peer-reviewed and practitioner-research sources.
export const TRENDING_QUERIES: readonly string[] = [
  "peer-reviewed sport science research athletic performance 2026",
  "velocity-based training force-velocity profiling strength research",
  "athlete monitoring HRV acute chronic workload ratio research",
  "plyometrics rate of force development eccentric overload meta-analysis",
  "long-term athletic development youth LTAD coaching research",
  "applied sport science elite athlete performance preparation case study",
] as const

// Hard-filter generalist fitness, lifestyle, and clickbait sources at the
// Tavily layer so the LLM ranker sees a higher-signal candidate pool.
export const EXCLUDED_DOMAINS: readonly string[] = [
  "menshealth.com",
  "womenshealth.com",
  "healthline.com",
  "livestrong.com",
  "bodybuilding.com",
  "muscleandfitness.com",
  "shape.com",
  "popsugar.com",
  "self.com",
  "verywellfit.com",
  "eatthis.com",
  "today.com",
  "buzzfeed.com",
  "yahoo.com",
  "msn.com",
] as const

const MAX_RESULTS_PER_QUERY = 5
const MAX_RESULTS_TO_RANK = 20

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
    "Extract 5-10 topics for a SCIENCE-BASED PERFORMANCE COACHING brand serving strength & conditioning coaches, sport science practitioners, and performance coaches working with athletes (youth, collegiate, semi-pro, professional, masters returning to sport).",
    "",
    "INCLUDE only topics that:",
    "  • Reference peer-reviewed research, a meta-analysis, an applied sport-science finding, or evidence-based coaching methodology",
    "  • Name a specific mechanism, methodology, or quantifiable outcome (e.g., RFD, HRV, ACWR, force-velocity profile, %1RM, defined protocol, % change, injury-rate delta)",
    "  • Apply directly to athletic performance — not general-population fitness, weight loss, or aesthetics",
    "",
    "EXCLUDE: generic personal-training tips, gen-pop weight loss, bodybuilding aesthetics, fitness fads, influencer opinion without cited evidence, lifestyle/wellness clickbait, supplement marketing.",
    "",
    "Write each title the way a performance coach would — specific and mechanism-aware (e.g., \"Eccentric overload at 105% 1RM accelerates RFD recovery — JSCR findings for return-to-sprint windows\"). Rank 1 = strongest combination of (a) scientific rigor of source, (b) practical applicability for performance coaches, (c) novelty.",
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

const SYSTEM_PROMPT = `You are a research curator for DJP Athlete, a SCIENCE-BASED PERFORMANCE COACHING brand. Your audience is strength & conditioning coaches, sport scientists, and performance practitioners working with competitive athletes (youth through professional, plus masters returning to sport).

From the supplied search results, extract 5-10 blog topic ideas that pass ALL of these gates:
  1. Anchored in peer-reviewed research, meta-analysis, applied sport-science findings, or evidence-based coaching methodology — not opinion or marketing.
  2. Names a specific mechanism, methodology, or quantifiable outcome (e.g., RFD %, HRV trend, ACWR threshold, force-velocity profile, %1RM, injury-rate delta, defined protocol).
  3. Applies to athletic performance — not general-population fitness, weight loss, or bodybuilding aesthetics.

Reject:
  • Generic personal-training tips ("5 ways to…", "best beginner workouts")
  • Gen-pop weight loss, bodybuilding aesthetics, fitness fads
  • Influencer opinion without cited evidence
  • Lifestyle / wellness clickbait, supplement marketing

Output JSON: { topics: [{ title, summary, tavily_url, rank }] }.

Title each topic the way a performance coach would: specific, mechanism-aware, actionable. Rank by (1) scientific rigor of source, (2) practical applicability for performance coaches, (3) novelty.`

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

    const searches = await Promise.all(
      TRENDING_QUERIES.map((query) =>
        tavilySearch({
          query,
          search_depth: "advanced",
          include_answer: false,
          max_results: MAX_RESULTS_PER_QUERY,
          exclude_domains: [...EXCLUDED_DOMAINS],
        }),
      ),
    )

    const seenUrls = new Set<string>()
    const topicsFromTavily: TavilySearchResult[] = []
    for (const search of searches) {
      for (const r of search.results) {
        if (seenUrls.has(r.url)) continue
        seenUrls.add(r.url)
        topicsFromTavily.push({ title: r.title, url: r.url, content: r.content })
        if (topicsFromTavily.length >= MAX_RESULTS_TO_RANK) break
      }
      if (topicsFromTavily.length >= MAX_RESULTS_TO_RANK) break
    }

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
