// functions/src/tavily-trending-scan.ts
// Firebase Function: weekly Tavily trending scan, writes ranked topic
// suggestions into content_calendar.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"
import {
  collectDiverseResults,
  dropCovered,
  reassignSequentialRanks,
  type TavilySearchResult,
} from "./lib/research-candidates.js"
import { capPerTheme, themeLabel, themeOf } from "./lib/topic-themes.js"

export type { TavilySearchResult }

// Science-leaning query set: each query targets a distinct sport-science
// surface (academic freshness, methodology, monitoring, power/strength,
// LTAD, applied/elite practice, return-to-play, psychology, nutrition) and
// uses precise terminology that ranks well against peer-reviewed and
// practitioner-research sources.
//
// The original set had two queries in the same narrow eccentric/force-velocity
// mechanism niche ("velocity-based training force-velocity profiling..." and
// "plyometrics rate of force development eccentric overload meta-analysis") —
// Tavily returned the same handful of frequently-cited/re-published studies
// for both, which is what produced 3 near-duplicate "RANK 01" topics in one
// week's brief. The second of those two is dropped here in favor of three
// categories the old set didn't cover at all.
export const TRENDING_QUERIES: readonly string[] = [
  "peer-reviewed sport science research athletic performance 2026",
  "velocity-based training force-velocity profiling strength research",
  "athlete monitoring HRV acute chronic workload ratio research",
  "long-term athletic development youth LTAD coaching research",
  "applied sport science elite athlete performance preparation case study",
  "return to play injury prevention rehabilitation sport science research",
  "sport psychology mental performance readiness athlete research",
  "sports nutrition fueling recovery performance research athletes",
  "change of direction agility deceleration braking sport performance research",
  "sprint acceleration speed mechanics development research",
  "energy system conditioning aerobic capacity team-sport athlete research",
  "resistance training periodization programming strength athletes research",
  "athlete sleep recovery intervention performance research",
  "female athlete performance training menstrual cycle research",
  "masters athlete ageing performance training research",
  "coaching practice skill acquisition motor learning sport research",
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
const MAX_RESULTS_TO_RANK = 24

// ─── Diversification knobs ───────────────────────────────────────────────────
// Every value here exists to break a specific observed failure, not as a
// general-purpose tuning surface. See topic-themes.ts for the full history.

/**
 * How far back the scan is willing to look. Without a recency filter Tavily
 * answers an evergreen query with its all-time best pages, so the brief was a
 * stable ranking of the same canonical papers rather than a look at what is
 * new. A rolling window also rotates the pool on its own as the weeks advance.
 */
const FRESHNESS_TIME_RANGE = "year" as const

/**
 * Most candidates any single theme may contribute to the ranking pool. Three
 * is deliberately generous — the point is to stop eight force-velocity papers
 * crowding out every other query, not to ration a theme that genuinely had a
 * big week.
 */
const MAX_CANDIDATES_PER_THEME = 3

/**
 * How many weeks of previously-suggested topics and already-written posts the
 * scan refuses to repeat. Eight weeks covers the observed repeat distance: the
 * 2026-09-14 rank 1 was a near-verbatim restatement of the 2026-08-24 rank 1,
 * three weeks apart.
 */
const COVERAGE_LOOKBACK_WEEKS = 8

/**
 * Cap on how many past titles are fed to the ranking prompt. The DB filter is
 * the real guard; this list is a hint to the model and does not need to be
 * exhaustive.
 */
const MAX_COVERED_TITLES_IN_PROMPT = 40

// Admin-editable override: read the scan queries from system_settings
// (key "blog_scan_queries", set via /admin/topic-suggestions). Falls back to the
// TRENDING_QUERIES defaults when unset/empty/malformed.
async function getScanQueries(): Promise<string[]> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase.from("system_settings").select("value").eq("key", "blog_scan_queries").maybeSingle()
    const value = data?.value
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.trim())) {
      return value as string[]
    }
  } catch {
    // fall through to defaults
  }
  return [...TRENDING_QUERIES]
}

/**
 * Renders the "already covered" guard rail. Returns "" when there is nothing to
 * avoid, so the prompt shape is unchanged on a first-ever run.
 */
export function buildCoveredBlock(coveredTitles: string[]): string {
  if (coveredTitles.length === 0) return ""
  const list = coveredTitles
    .slice(0, MAX_COVERED_TITLES_IN_PROMPT)
    .map((t) => `  - ${t}`)
    .join("\n")
  return [
    "# ALREADY COVERED — DO NOT PROPOSE THESE AGAIN",
    "This brand has already published or queued the following. Treat each as spent:",
    list,
    "",
    "A topic is a repeat if it rests on the SAME underlying finding, even when the",
    "title, the cited source and the framing are different. Restating a covered",
    "finding from a new angle is a repeat. Skip it and use one of the other",
    "candidates instead.",
    "",
  ].join("\n")
}

export function buildRankingPrompt(results: TavilySearchResult[], coveredTitles: string[] = []): string {
  if (results.length === 0) {
    return [
      "# TAVILY SEARCH",
      "No search results returned this week.",
      "",
      "# INSTRUCTIONS",
      "Return an empty topics array.",
    ].join("\n")
  }

  // Labelling each candidate with its theme lets the model see the spread it is
  // working with; asking for breadth without showing the distribution just gets
  // agreement rather than behaviour.
  const block = results
    .map((r, i) => {
      const meta = [themeLabel(themeOf(r.title)), r.published_date ? `published ${r.published_date}` : null]
        .filter(Boolean)
        .join(" · ")
      return `${i + 1}. ${r.title}\n   URL: ${r.url}\n   [${meta}]\n   ${r.content}`
    })
    .join("\n\n")

  return [
    "# TAVILY SEARCH RESULTS",
    block,
    "",
    buildCoveredBlock(coveredTitles),
    "# INSTRUCTIONS",
    "Extract 5-10 topics for a SCIENCE-BASED PERFORMANCE COACHING brand serving strength & conditioning coaches, sport science practitioners, and performance coaches working with athletes (youth, collegiate, semi-pro, professional, masters returning to sport).",
    "",
    "INCLUDE only topics that:",
    "  • Reference peer-reviewed research, a meta-analysis, an applied sport-science finding, or evidence-based coaching methodology",
    "  • Name a specific mechanism, methodology, or quantifiable outcome — a defined protocol, a measured % change, an injury-rate delta, a threshold a coach could act on",
    "  • Apply directly to athletic performance — not general-population fitness, weight loss, or aesthetics",
    "",
    "EXCLUDE: generic personal-training tips, gen-pop weight loss, bodybuilding aesthetics, fitness fads, influencer opinion without cited evidence, lifestyle/wellness clickbait, supplement marketing.",
    "",
    "SPREAD THE BRIEF ACROSS DIFFERENT THEMES. Each candidate above is tagged with its theme. No more than TWO of your chosen topics may share a theme, and you should cover at least four different themes when the candidate pool allows it. A brief where half the topics are variations on one mechanism is a failed brief, however strong each individual paper is.",
    "",
    "Do not include two topics that describe the same underlying study or finding — if multiple sources cover it, keep only the single strongest source.",
    "",
    "Write each title the way a performance coach would — specific and mechanism-aware, naming the finding and who it applies to. Rank 1 = strongest combination of (a) scientific rigor of source, (b) practical applicability for performance coaches, (c) novelty — and where two topics are close, prefer the one whose theme is NOT already represented higher in your list.",
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
  2. Names a specific mechanism, methodology, or quantifiable outcome — a defined protocol, a measured % change, a threshold, an injury-rate delta. Something a coach could act on this week.
  3. Applies to athletic performance — not general-population fitness, weight loss, or bodybuilding aesthetics.

Reject:
  • Generic personal-training tips ("5 ways to…", "best beginner workouts")
  • Gen-pop weight loss, bodybuilding aesthetics, fitness fads
  • Influencer opinion without cited evidence
  • Lifestyle / wellness clickbait, supplement marketing
  • Two topics describing the same underlying study or finding — keep only the strongest source

BREADTH IS A HARD REQUIREMENT, NOT A PREFERENCE. Each candidate is tagged with its theme. At most TWO chosen topics may share a theme, and you should span at least four themes whenever the pool allows. Several excellent papers about the same mechanism are ONE topic's worth of brief — pick the best of them and move on. A brief is judged on what a reader learns across the whole list, not on the peak rigour of any single row.

Some candidates are flagged as already covered. Those findings are spent: a fresh angle on a covered finding is still a repeat.

Output JSON: { topics: [{ title, summary, tavily_url, rank }] }.

Title each topic the way a performance coach would: specific, mechanism-aware, actionable. Rank by (1) scientific rigor of source, (2) practical applicability for performance coaches, (3) novelty — breaking ties toward a theme not already used higher in the list.`

/**
 * Titles this brand has already suggested or published inside the lookback
 * window — the memory the scan was missing. Reads BOTH tables on purpose:
 * content_calendar catches a topic that was proposed and never written, and
 * blog_posts catches one that was written from a manual or on-demand path the
 * calendar never saw.
 *
 * Fails OPEN (returns []) rather than aborting the scan: a brief that repeats
 * itself is a bad week, but a brief that never runs is a broken product. The
 * caller logs the degraded read so a silent permanent failure still surfaces.
 */
export async function loadCoveredTitles(
  supabase: ReturnType<typeof getSupabase>,
  now: Date,
): Promise<{ titles: string[]; degraded: boolean }> {
  const since = new Date(now.getTime() - COVERAGE_LOOKBACK_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const titles: string[] = []
  let degraded = false

  const [calendar, posts] = await Promise.all([
    supabase
      .from("content_calendar")
      .select("title")
      .eq("entry_type", "topic_suggestion")
      .gte("scheduled_for", since)
      .limit(400),
    supabase.from("blog_posts").select("title").gte("created_at", since).limit(400),
  ])

  if (calendar.error) {
    console.warn(`[tavily-trending-scan] covered-topics read failed: ${calendar.error.message}`)
    degraded = true
  } else {
    for (const row of calendar.data ?? []) {
      const t = (row as { title?: string }).title
      if (t) titles.push(t)
    }
  }

  if (posts.error) {
    console.warn(`[tavily-trending-scan] covered-posts read failed: ${posts.error.message}`)
    degraded = true
  } else {
    for (const row of posts.data ?? []) {
      const t = (row as { title?: string }).title
      if (t) titles.push(t)
    }
  }

  return { titles, degraded }
}

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

    const scanQueries = await getScanQueries()
    const searches = await Promise.all(
      scanQueries.map((query) =>
        tavilySearch({
          query,
          search_depth: "advanced",
          include_answer: false,
          max_results: MAX_RESULTS_PER_QUERY,
          exclude_domains: [...EXCLUDED_DOMAINS],
          time_range: FRESHNESS_TIME_RANGE,
          include_published_date: true,
          // Deliberately NOT filter_by_published_date: peer-reviewed work is
          // indexed late and unevenly, and a hard drop empties good queries.
          // time_range biases the ranking; that is the effect we want.
        }),
      ),
    )

    const supabaseForCoverage = getSupabase()
    const { titles: coveredTitles, degraded: coverageDegraded } = await loadCoveredTitles(
      supabaseForCoverage,
      new Date(),
    )

    // Order matters. Collect round-robin across queries first (so no single
    // query fills the cap), then drop anything already covered, then cap per
    // theme LAST — capping before the coverage drop would spend a theme's
    // three slots on papers that are about to be discarded anyway.
    const collected = collectDiverseResults(searches, MAX_RESULTS_TO_RANK)
    const uncovered = dropCovered(collected, coveredTitles, (r) => r.title)
    const topicsFromTavily = capPerTheme(uncovered, MAX_CANDIDATES_PER_THEME, (r) => r.title)

    console.log(
      `[tavily-trending-scan] candidates: ${collected.length} collected → ${uncovered.length} uncovered → ` +
        `${topicsFromTavily.length} after per-theme cap; ${coveredTitles.length} covered titles` +
        `${coverageDegraded ? " (COVERAGE READ DEGRADED)" : ""}`,
    )

    const userMessage = buildRankingPrompt(topicsFromTavily, coveredTitles)

    const result = await callAgent(SYSTEM_PROMPT, userMessage, TrendingSchema, {
      model: MODEL_SONNET,
    })
    const rankedTopics = reassignSequentialRanks(result.content.topics)

    const scheduledFor = nextMondayISO(new Date())
    let topicsWritten = 0

    if (rankedTopics.length > 0) {
      const supabase = getSupabase()

      // A retried or manually re-triggered scan for the same target week must
      // replace its own prior output, not pile a second full rank-1..N batch
      // on top of it — that's what produced heavy rank collisions in the UI
      // (grouped by week, sorted by rank: 5 separate reruns meant 5 different
      // "rank 1"s, 5 different "rank 2"s, ... all merged into one list).
      // Scoped to this scan's own rows (source: "tavily") so manually-added
      // and on-demand-researched topics for the same week are untouched.
      const { error: deleteErr } = await supabase
        .from("content_calendar")
        .delete()
        .eq("entry_type", "topic_suggestion")
        .eq("scheduled_for", scheduledFor)
        .eq("metadata->>source", "tavily")
      if (deleteErr) {
        await failJob(`content_calendar delete-prior-batch failed: ${deleteErr.message}`)
        return
      }

      const rows = rankedTopics.map((t) => ({
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
