// functions/src/topic-research-scan.ts
// Firebase Function: on-demand version of the weekly trending scan, scoped to
// a single admin-typed topic instead of the fixed TRENDING_QUERIES set. Writes
// candidate topics into the ai_jobs doc's `result` for the admin to preview
// and select — unlike the weekly scan, it does NOT write to content_calendar
// directly (see app/api/admin/topic-suggestions/research/commit for that step).

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch } from "./lib/tavily.js"
import { collectDiverseResults, reassignSequentialRanks, type TavilySearchResult } from "./lib/research-candidates.js"
import { EXCLUDED_DOMAINS } from "./tavily-trending-scan.js"

export interface TopicResearchInput {
  topic: string
}

const MAX_RESULTS_PER_QUERY = 8
const MAX_RESULTS_TO_RANK = 8

const TopicResearchSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      tavily_url: z.string(),
      rank: z.number(),
    }),
  ),
})

export function buildTopicResearchPrompt(topic: string, results: TavilySearchResult[]): string {
  if (results.length === 0) {
    return [
      "# REQUESTED TOPIC",
      topic,
      "",
      "# TAVILY SEARCH",
      "No search results returned for this topic.",
      "",
      "# INSTRUCTIONS",
      "Return an empty topics array.",
    ].join("\n")
  }

  const block = results
    .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`)
    .join("\n\n")

  return [
    "# REQUESTED TOPIC",
    topic,
    "",
    "# TAVILY SEARCH RESULTS",
    block,
    "",
    "# INSTRUCTIONS",
    "Extract 3-6 topic angles for a SCIENCE-BASED PERFORMANCE COACHING brand serving strength & conditioning coaches, sport science practitioners, and performance coaches — specifically about the requested topic above. Do not drift into generic adjacent categories.",
    "",
    "INCLUDE only angles that:",
    "  • Reference peer-reviewed research, a meta-analysis, an applied sport-science finding, or evidence-based coaching methodology",
    "  • Name a specific mechanism, methodology, or quantifiable outcome (e.g., RFD, HRV, ACWR, force-velocity profile, %1RM, defined protocol, % change, injury-rate delta)",
    "  • Apply directly to athletic performance — not general-population fitness, weight loss, or aesthetics",
    "",
    "EXCLUDE: generic personal-training tips, gen-pop weight loss, bodybuilding aesthetics, fitness fads, influencer opinion without cited evidence, lifestyle/wellness clickbait, supplement marketing.",
    "",
    "Do not include two topics that describe the same underlying study or finding — if multiple sources cover it, keep only the single strongest source.",
    "",
    "Write each title the way a performance coach would — specific and mechanism-aware. Rank by (1) scientific rigor of source, (2) relevance to the requested topic, (3) practical applicability for performance coaches.",
  ].join("\n")
}

const SYSTEM_PROMPT = `You are a research curator for DJP Athlete, a SCIENCE-BASED PERFORMANCE COACHING brand. Your audience is strength & conditioning coaches, sport scientists, and performance practitioners working with competitive athletes (youth through professional, plus masters returning to sport).

An admin has typed in a specific topic to research — treat it as the exact subject to investigate, not a jumping-off point for generic adjacent categories.

From the supplied search results, extract 3-6 blog topic angles on that subject that pass ALL of these gates:
  1. Anchored in peer-reviewed research, meta-analysis, applied sport-science findings, or evidence-based coaching methodology — not opinion or marketing.
  2. Names a specific mechanism, methodology, or quantifiable outcome (e.g., RFD %, HRV trend, ACWR threshold, force-velocity profile, %1RM, injury-rate delta, defined protocol).
  3. Applies to athletic performance — not general-population fitness, weight loss, or bodybuilding aesthetics.

Reject:
  • Generic personal-training tips ("5 ways to…", "best beginner workouts")
  • Gen-pop weight loss, bodybuilding aesthetics, fitness fads
  • Influencer opinion without cited evidence
  • Lifestyle / wellness clickbait, supplement marketing
  • Two angles describing the same underlying study or finding — keep only the strongest source

Output JSON: { topics: [{ title, summary, tavily_url, rank }] }.

Title each topic the way a performance coach would: specific, mechanism-aware, actionable. Rank by (1) scientific rigor of source, (2) relevance to the requested topic, (3) practical applicability for performance coaches.`

export async function handleTopicResearchScan(jobId: string): Promise<void> {
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

    const input = data.input as TopicResearchInput
    if (!input?.topic) {
      await failJob("input.topic is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const search = await tavilySearch({
      query: input.topic,
      search_depth: "advanced",
      include_answer: false,
      max_results: MAX_RESULTS_PER_QUERY,
      exclude_domains: [...EXCLUDED_DOMAINS],
    })

    const topicsFromTavily = collectDiverseResults([search], MAX_RESULTS_TO_RANK)
    const userMessage = buildTopicResearchPrompt(input.topic, topicsFromTavily)

    const result = await callAgent(SYSTEM_PROMPT, userMessage, TopicResearchSchema, {
      model: MODEL_SONNET,
    })
    const rankedTopics = reassignSequentialRanks(result.content.topics)

    await jobRef.update({
      status: "completed",
      result: { topics: rankedTopics },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown topic-research error")
  }
}
