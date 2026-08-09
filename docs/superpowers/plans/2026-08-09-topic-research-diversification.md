# Topic Suggestions: diversification fix + on-demand topic research — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the weekly topic-suggestion scan from surfacing near-duplicate topics all
labeled "RANK 01", and add an on-demand form where an admin types a topic and gets
researched, pickable suggestions instead of a raw manual entry.

**Architecture:** Two shared pure-function helpers (`functions/src/lib/research-candidates.ts`)
back both the existing weekly scan (`functions/src/tavily-trending-scan.ts`, fixed in place)
and a new on-demand scan (`functions/src/topic-research-scan.ts`, new). The new scan runs
through the same `ai_jobs` Firestore-doc + Firebase-Function pattern every other Tavily call
in this codebase uses (`TAVILY_API_KEY` only exists as a Firebase Functions secret — it is
not reachable from a Vercel/Next.js route). Its result is a **preview only** — candidates
land in the `ai_jobs` doc's `result` field, not in `content_calendar` — until the admin
picks which ones to keep via a commit endpoint that reuses the same insert shape the weekly
scan already writes.

**Tech Stack:** Firebase Functions (Node 22, TypeScript, Vitest), Next.js App Router API
routes, Zod, Supabase (service-role client), Firestore (`ai_jobs`), React/TSX + Testing
Library, `string-similarity-js` (already a functions/ dependency, used elsewhere for fuzzy
exercise/client-name matching).

## Global Constraints

- Testing is **targeted** — run only the vitest file(s)/directory touched by each task, never
  the full suite (project convention, see root `CLAUDE.md`).
- `git add` **explicit file paths only** — never `-A` or `.` (this working tree has unrelated
  uncommitted files that must not be swept into these commits).
- Commit after every task passes its tests.
- No new Supabase migration is needed — both features reuse the existing `content_calendar`
  table and its `topic_suggestion` entry type.
- Firebase Functions changes are **not** deployed as part of this plan (deploy is via GHA on
  push to `main`, per this repo's existing setup) — implementation + local test verification
  only.

---

### Task 1: Shared candidate-collection helpers

**Files:**
- Create: `functions/src/lib/research-candidates.ts`
- Test: `functions/src/__tests__/research-candidates.test.ts`

**Interfaces:**
- Produces:
  - `interface TavilySearchResult { title: string; url: string; content: string }` — the
    flattened candidate shape used by both scan handlers (distinct from the raw Tavily API
    response type in `functions/src/lib/tavily.ts`, which has extra `score`/`published_date`
    fields).
  - `interface DedupableResult { title: string; url: string }`
  - `isDuplicate<T extends DedupableResult>(candidate: T, seenUrls: Set<string>, accepted: T[]): boolean`
  - `collectDiverseResults(searches: Array<{ results: Array<{ title: string; url: string; content: string }> }>, maxResults: number): TavilySearchResult[]`
  - `reassignSequentialRanks<T extends { rank: number }>(topics: T[]): T[]`

- [ ] **Step 1: Write the failing tests**

```typescript
// functions/src/__tests__/research-candidates.test.ts
import { describe, it, expect } from "vitest"
import { isDuplicate, collectDiverseResults, reassignSequentialRanks } from "../lib/research-candidates.js"

describe("isDuplicate", () => {
  it("flags an exact URL repeat regardless of title", () => {
    const seen = new Set(["https://a.example/x"])
    expect(
      isDuplicate({ title: "Totally different title", url: "https://a.example/x" }, seen, []),
    ).toBe(true)
  })

  it("flags a near-duplicate title from a different URL as already accepted", () => {
    // Real pair from the bug report screenshot — two syndicated titles for the
    // same hamstring-force-production study, scores 0.632 with string-similarity-js.
    const accepted = [
      {
        title:
          "Hamstring-Driven Horizontal Force Production in Sprint Acceleration: Why FH Output Predicts Return-to-Sprint Readiness Post-Injury",
        url: "https://journal.example/study-a",
      },
    ]
    const candidate = {
      title:
        "Hamstring Horizontal Force Production in Sprint Acceleration: Why Hip Extensor Eccentric Strength Drives Early Ground Impulse",
      url: "https://coachingblog.example/study-a-reprint",
    }
    expect(isDuplicate(candidate, new Set(), accepted)).toBe(true)
  })

  it("does not flag two genuinely distinct topics", () => {
    const accepted = [
      {
        title: "Accentuated Eccentric Loading Elevates Eccentric Braking Force in Power Athletes",
        url: "https://journal.example/study-b",
      },
    ]
    const candidate = {
      title: "Sport Psychology Readiness Screening Predicts Return-to-Sprint Confidence",
      url: "https://journal.example/study-c",
    }
    expect(isDuplicate(candidate, new Set(), accepted)).toBe(false)
  })
})

describe("collectDiverseResults", () => {
  function fakeSearch(prefix: string, count: number) {
    return {
      results: Array.from({ length: count }, (_, i) => ({
        title: `${prefix} topic ${i}`,
        url: `https://${prefix}.example/${i}`,
        content: `content ${i}`,
      })),
    }
  }

  it("round-robins across queries instead of draining the first one", () => {
    const searches = [fakeSearch("q1", 3), fakeSearch("q2", 3), fakeSearch("q3", 3)]
    const collected = collectDiverseResults(searches, 6)
    expect(collected.map((c) => c.url)).toEqual([
      "https://q1.example/0",
      "https://q2.example/0",
      "https://q3.example/0",
      "https://q1.example/1",
      "https://q2.example/1",
      "https://q3.example/1",
    ])
  })

  it("stops at maxResults", () => {
    const searches = [fakeSearch("q1", 5), fakeSearch("q2", 5)]
    expect(collectDiverseResults(searches, 3)).toHaveLength(3)
  })

  it("drops near-duplicate titles even across different queries", () => {
    // Identical title pair used in the isDuplicate tests above (verified
    // 0.632 similarity with string-similarity-js) so this test's outcome
    // rests on a measured value, not a guess.
    const searches = [
      {
        results: [
          {
            title:
              "Hamstring-Driven Horizontal Force Production in Sprint Acceleration: Why FH Output Predicts Return-to-Sprint Readiness Post-Injury",
            url: "https://a.example/1",
            content: "x",
          },
        ],
      },
      {
        results: [
          {
            title:
              "Hamstring Horizontal Force Production in Sprint Acceleration: Why Hip Extensor Eccentric Strength Drives Early Ground Impulse",
            url: "https://b.example/1",
            content: "y",
          },
        ],
      },
    ]
    expect(collectDiverseResults(searches, 10)).toHaveLength(1)
  })

  it("returns an empty array for an empty query set", () => {
    expect(collectDiverseResults([], 10)).toEqual([])
  })
})

describe("reassignSequentialRanks", () => {
  it("overwrites rank with sequential position after sorting by the input rank", () => {
    const topics = [
      { title: "c", rank: 1 },
      { title: "a", rank: 1 },
      { title: "b", rank: 2 },
    ]
    expect(reassignSequentialRanks(topics)).toEqual([
      { title: "c", rank: 1 },
      { title: "a", rank: 2 },
      { title: "b", rank: 3 },
    ])
  })

  it("does not mutate the input array", () => {
    const topics = [{ title: "a", rank: 5 }]
    reassignSequentialRanks(topics)
    expect(topics).toEqual([{ title: "a", rank: 5 }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `functions/`): `npx vitest run src/__tests__/research-candidates.test.ts`
Expected: FAIL — `../lib/research-candidates.js` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// functions/src/lib/research-candidates.ts
// Shared helpers for turning raw Tavily search results into a clean, ranked,
// deduped candidate list — used by both the weekly trending scan
// (tavily-trending-scan.ts) and the on-demand single-topic scan
// (topic-research-scan.ts). Kept dependency-free of both handlers so neither
// imports from the other.

import { stringSimilarity } from "string-similarity-js"

export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

export interface DedupableResult {
  title: string
  url: string
}

// Calibrated against the real duplicate pair that motivated this fix: two
// syndicated titles for the same hamstring-force-production study scored
// 0.632 with string-similarity-js (the same bigram-similarity library already
// used for fuzzy exercise/client-name matching elsewhere in functions/), while
// unrelated topic pairs scored 0.29-0.38. 0.55 sits cleanly between the two.
const SIMILARITY_THRESHOLD = 0.55

/**
 * True if `candidate` is an exact-URL repeat of something already seen, or a
 * near-duplicate title of a result already accepted (the same finding
 * re-published under a different URL/domain).
 */
export function isDuplicate<T extends DedupableResult>(
  candidate: T,
  seenUrls: Set<string>,
  accepted: T[],
): boolean {
  if (seenUrls.has(candidate.url)) return true
  return accepted.some((existing) => stringSimilarity(candidate.title, existing.title) >= SIMILARITY_THRESHOLD)
}

/**
 * Collects up to `maxResults` unique, non-near-duplicate candidates from
 * multiple Tavily search result sets, round-robin (one per query per pass)
 * rather than draining the first query before touching the rest. Without
 * this, a handful of overlapping queries can fill the cap before more
 * distinct queries ever contribute — silently defeating any attempt to
 * diversify the query set.
 */
export function collectDiverseResults(
  searches: Array<{ results: Array<{ title: string; url: string; content: string }> }>,
  maxResults: number,
): TavilySearchResult[] {
  const seenUrls = new Set<string>()
  const collected: TavilySearchResult[] = []
  const maxRounds = Math.max(0, ...searches.map((s) => s.results.length))

  roundLoop: for (let round = 0; round < maxRounds; round++) {
    for (const search of searches) {
      const r = search.results[round]
      if (!r) continue
      if (isDuplicate(r, seenUrls, collected)) continue
      seenUrls.add(r.url)
      collected.push({ title: r.title, url: r.url, content: r.content })
      if (collected.length >= maxResults) break roundLoop
    }
  }

  return collected
}

/**
 * Overwrites each topic's `rank` with its 1-based position after sorting by
 * the input rank. The ranking LLM assigns rank independently per topic, so
 * nothing stops it from giving two topics the same rank — this guarantees a
 * unique, sequential rank regardless of what the model returned.
 */
export function reassignSequentialRanks<T extends { rank: number }>(topics: T[]): T[] {
  return [...topics].sort((a, b) => a.rank - b.rank).map((t, i) => ({ ...t, rank: i + 1 }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `functions/`): `npx vitest run src/__tests__/research-candidates.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/research-candidates.ts functions/src/__tests__/research-candidates.test.ts
git commit -m "feat(functions): add shared dedupe/rank helpers for topic research scans"
```

---

### Task 2: Fix the weekly scan — diversify queries, use shared helpers, deterministic rank

**Files:**
- Modify: `functions/src/tavily-trending-scan.ts`
- Modify: `functions/src/__tests__/tavily-trending-scan.test.ts`

**Interfaces:**
- Consumes: `collectDiverseResults`, `reassignSequentialRanks` from `./lib/research-candidates.js` (Task 1)
- Produces: unchanged public exports (`buildRankingPrompt`, `nextMondayISO`, `TRENDING_QUERIES`,
  `EXCLUDED_DOMAINS`, `handleTavilyTrendingScan`) — `TRENDING_QUERIES` content changes, and the
  local `TavilySearchResult` interface is removed (now imported from `./lib/research-candidates.js`
  instead of declared here — nothing outside this file imported the old local one, confirmed by
  grep).

- [ ] **Step 1: Update the failing/changed test expectations**

Add these tests to `functions/src/__tests__/tavily-trending-scan.test.ts` (keep all existing
tests in the file as-is — they still pass unchanged against the new query set):

```typescript
  it("TRENDING_QUERIES drops the eccentric-overload query that caused the duplicate-topic bug and adds return-to-play, psychology, and nutrition categories", () => {
    const joined = TRENDING_QUERIES.join(" | ").toLowerCase()
    expect(joined).not.toContain("plyometrics rate of force development eccentric overload")
    expect(joined).toMatch(/return to play|injury prevention|rehabilitation/)
    expect(joined).toMatch(/psychology|mental performance|readiness/)
    expect(joined).toMatch(/nutrition|fueling/)
    expect(TRENDING_QUERIES.length).toBe(8)
  })

  it("buildRankingPrompt instructs the model not to return two topics about the same underlying study", () => {
    const prompt = buildRankingPrompt([
      { title: "Sample", url: "https://x.example", content: "x" },
    ]).toLowerCase()
    expect(prompt).toMatch(/same underlying study|same finding/)
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run (from `functions/`): `npx vitest run src/__tests__/tavily-trending-scan.test.ts`
Expected: FAIL on the two new tests (query set and prompt text unchanged so far).

- [ ] **Step 3: Update `functions/src/tavily-trending-scan.ts`**

Replace the imports and `TavilySearchResult` interface at the top of the file:

```typescript
// functions/src/tavily-trending-scan.ts
// Firebase Function: weekly Tavily trending scan, writes ranked topic
// suggestions into content_calendar.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"
import { collectDiverseResults, reassignSequentialRanks, type TavilySearchResult } from "./lib/research-candidates.js"

export type { TavilySearchResult }
```

(The `export type { TavilySearchResult }` keeps it available under this file's path in case
anything is added later that imports it from here — harmless and cheap; remove if your editor
flags it as unused, since nothing currently needs it re-exported.)

Replace the `TRENDING_QUERIES` array:

```typescript
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
] as const
```

Update the results cap (round-robin collection needs a slightly larger cap so all 8 queries get
a fair shot — see Task 1's `collectDiverseResults`):

```typescript
const MAX_RESULTS_PER_QUERY = 5
const MAX_RESULTS_TO_RANK = 24
```

In `buildRankingPrompt`, add the anti-duplication instruction (insert after the existing
`"EXCLUDE: ..."` line, before the `"Write each title..."` line):

```typescript
    "EXCLUDE: generic personal-training tips, gen-pop weight loss, bodybuilding aesthetics, fitness fads, influencer opinion without cited evidence, lifestyle/wellness clickbait, supplement marketing.",
    "",
    "Do not include two topics that describe the same underlying study or finding — if multiple sources cover it, keep only the single strongest source.",
    "",
    "Write each title the way a performance coach would — specific and mechanism-aware (e.g., \"Eccentric overload at 105% 1RM accelerates RFD recovery — JSCR findings for return-to-sprint windows\"). Rank 1 = strongest combination of (a) scientific rigor of source, (b) practical applicability for performance coaches, (c) novelty.",
```

Add the same instruction as a bullet in `SYSTEM_PROMPT`'s `Reject:` list (insert after the
`"Lifestyle / wellness clickbait, supplement marketing"` line):

```typescript
  • Lifestyle / wellness clickbait, supplement marketing
  • Two topics describing the same underlying study or finding — keep only the strongest source
```

Replace the candidate-collection block inside `handleTavilyTrendingScan` (the block that builds
`topicsFromTavily` via nested loops + `seenUrls`) with:

```typescript
    const topicsFromTavily = collectDiverseResults(searches, MAX_RESULTS_TO_RANK)
```

Replace the section after `callAgent` that builds `rows` to use deterministic ranks — change:

```typescript
    const result = await callAgent(SYSTEM_PROMPT, userMessage, TrendingSchema, {
      model: MODEL_SONNET,
    })

    const scheduledFor = nextMondayISO(new Date())
    let topicsWritten = 0

    if (result.content.topics.length > 0) {
      const supabase = getSupabase()
      const rows = result.content.topics.map((t) => ({
```

to:

```typescript
    const result = await callAgent(SYSTEM_PROMPT, userMessage, TrendingSchema, {
      model: MODEL_SONNET,
    })
    const rankedTopics = reassignSequentialRanks(result.content.topics)

    const scheduledFor = nextMondayISO(new Date())
    let topicsWritten = 0

    if (rankedTopics.length > 0) {
      const supabase = getSupabase()
      const rows = rankedTopics.map((t) => ({
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `functions/`): `npx vitest run src/__tests__/tavily-trending-scan.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Type-check the functions package**

Run (from `functions/`): `npx tsc --noEmit`
Expected: no errors. If `TavilySearchResult` is reported unused, remove the
`export type { TavilySearchResult }` re-export line added in Step 3 (nothing in this task needs
it — it was a courtesy re-export, not a requirement).

- [ ] **Step 6: Commit**

```bash
git add functions/src/tavily-trending-scan.ts functions/src/__tests__/tavily-trending-scan.test.ts
git commit -m "fix(functions): diversify weekly scan queries, dedupe near-duplicate topics, enforce unique rank"
```

---

### Task 3: Update the admin-editable query defaults to match

**Files:**
- Modify: `lib/blog/scan-queries.ts`

**Interfaces:**
- Consumes: none
- Produces: `DEFAULT_BLOG_SCAN_QUERIES` (unchanged name/shape, new content matching Task 2's
  `TRENDING_QUERIES` exactly — this file's header comment already documents it as a twin copy
  that must be kept in sync, since `functions/` cannot import from `lib/`)

There is no existing test file for this module (confirmed: no matches for `scan-queries` or
`DEFAULT_BLOG_SCAN_QUERIES` under `__tests__/`), so this task is a direct edit with no test
step — the values are exercised indirectly wherever `/admin/topic-suggestions` reads them.

- [ ] **Step 1: Update the query list**

```typescript
// Admin-editable weekly blog topic-scan queries.
// Stored in system_settings under BLOG_SCAN_QUERIES_KEY as a string[]. The
// Firebase weekly scanner (functions/src/tavily-trending-scan.ts) reads the same
// key and falls back to its own twin copy of these defaults when unset.
// IMPORTANT: keep this list identical to TRENDING_QUERIES in
// functions/src/tavily-trending-scan.ts — the two are manually kept in sync.

export const BLOG_SCAN_QUERIES_KEY = "blog_scan_queries"

export const DEFAULT_BLOG_SCAN_QUERIES: string[] = [
  "peer-reviewed sport science research athletic performance 2026",
  "velocity-based training force-velocity profiling strength research",
  "athlete monitoring HRV acute chronic workload ratio research",
  "long-term athletic development youth LTAD coaching research",
  "applied sport science elite athlete performance preparation case study",
  "return to play injury prevention rehabilitation sport science research",
  "sport psychology mental performance readiness athlete research",
  "sports nutrition fueling recovery performance research athletes",
]
```

- [ ] **Step 2: Type-check**

Run (from repo root): `npx tsc --noEmit -p tsconfig.json` (or your project's usual
`npm run build` if faster to reason about — either way, this file has no logic to unit-test,
only a type-checkable literal array)

- [ ] **Step 3: Commit**

```bash
git add lib/blog/scan-queries.ts
git commit -m "fix: mirror the diversified scan-query defaults into the admin-editable twin"
```

---

### Task 4: New Firebase Function — on-demand single-topic research scan

**Files:**
- Create: `functions/src/topic-research-scan.ts`
- Create: `functions/src/__tests__/topic-research-scan.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `lib/ai-jobs.ts`

**Interfaces:**
- Consumes: `EXCLUDED_DOMAINS` from `./tavily-trending-scan.js` (Task 2, unchanged export);
  `collectDiverseResults`, `reassignSequentialRanks`, `TavilySearchResult` from
  `./lib/research-candidates.js` (Task 1); `tavilySearch` from `./lib/tavily.js`; `callAgent`,
  `MODEL_SONNET` from `./ai/anthropic.js`.
- Produces: `buildTopicResearchPrompt(topic: string, results: TavilySearchResult[]): string`,
  `handleTopicResearchScan(jobId: string): Promise<void>`, ai_jobs doc shape on completion:
  `{ status: "completed", result: { topics: Array<{ title: string; summary: string; tavily_url: string; rank: number }> } }`
  — note this result is **not** written to `content_calendar`; Task 6's commit endpoint does
  that from the client-selected subset.

- [ ] **Step 1: Write the failing tests**

```typescript
// functions/src/__tests__/topic-research-scan.test.ts
import { describe, it, expect } from "vitest"
import { buildTopicResearchPrompt } from "../topic-research-scan.js"

describe("buildTopicResearchPrompt", () => {
  it("embeds the requested topic and Tavily results as numbered entries", () => {
    const prompt = buildTopicResearchPrompt("blood flow restriction training", [
      { title: "BFR and hypertrophy", url: "https://a.example", content: "snippet A" },
      { title: "BFR safety thresholds", url: "https://b.example", content: "snippet B" },
    ])
    expect(prompt).toContain("blood flow restriction training")
    expect(prompt).toContain("BFR and hypertrophy")
    expect(prompt).toContain("https://a.example")
    expect(prompt).toContain("snippet A")
    expect(prompt).toMatch(/3\s*[-–]\s*6\s+topics?/i)
  })

  it("handles empty search results gracefully", () => {
    const prompt = buildTopicResearchPrompt("an obscure niche topic", [])
    expect(prompt).toContain("an obscure niche topic")
    expect(prompt.toLowerCase()).toContain("no search results")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `functions/`): `npx vitest run src/__tests__/topic-research-scan.test.ts`
Expected: FAIL — `../topic-research-scan.js` does not exist.

- [ ] **Step 3: Write `functions/src/topic-research-scan.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `functions/`): `npx vitest run src/__tests__/topic-research-scan.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the Firebase Function trigger**

In `functions/src/index.ts`, add this export immediately after the existing `tavilyResearch`
export (after its closing `)` around line 580, before the `tavilyFactCheck` export):

```typescript
// ─── Topic Research Scan ──────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "topic_research_scan".
// On-demand version of the weekly trending scan, scoped to a single admin-typed
// topic. Writes candidate topics into the job result for the admin to preview
// and select — does NOT write to content_calendar directly.

export const topicResearchScan = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, tavilyApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "topic_research_scan") return

    const { handleTopicResearchScan } = await import("./topic-research-scan.js")
    await handleTopicResearchScan(event.params.jobId)
  },
)
```

- [ ] **Step 6: Add the new job type to the shared type union**

In `lib/ai-jobs.ts`, add `"topic_research_scan"` to the `AiJobType` union, next to the
existing `"tavily_trending_scan"` entry:

```typescript
  | "tavily_research"
  | "tavily_fact_check"
  | "tavily_trending_scan"
  | "topic_research_scan"
```

- [ ] **Step 7: Type-check the functions package**

Run (from `functions/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add functions/src/topic-research-scan.ts functions/src/__tests__/topic-research-scan.test.ts functions/src/index.ts lib/ai-jobs.ts
git commit -m "feat(functions): add on-demand single-topic research scan job"
```

---

### Task 5: Next.js route — kick off the research job

**Files:**
- Create: `app/api/admin/topic-suggestions/research/route.ts`
- Create: `__tests__/api/admin/topic-suggestions/research.test.ts`

**Interfaces:**
- Consumes: `createAiJob` from `@/lib/ai-jobs` (type `"topic_research_scan"`, added in Task 4);
  `auth` from `@/lib/auth`; `canAccessAdminPath` from `@/lib/permissions/guard`.
- Produces: `POST /api/admin/topic-suggestions/research` — body `{ topic: string }`, response
  `{ jobId: string, status: "pending" }` with HTTP 202 on success.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/admin/topic-suggestions/research.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createAiJob: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: mocks.createAiJob }))

import { POST } from "@/app/api/admin/topic-suggestions/research/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/topic-suggestions/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/topic-suggestions/research", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ topic: "blood flow restriction training" }))
    expect(res.status).toBe(401)
    expect(mocks.createAiJob).not.toHaveBeenCalled()
  })

  it("returns 401 for a non-admin session", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "client" } })
    const res = await POST(jsonRequest({ topic: "blood flow restriction training" }))
    expect(res.status).toBe(401)
    expect(mocks.createAiJob).not.toHaveBeenCalled()
  })

  it("returns 400 for a too-short topic", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topic: "hi" }))
    expect(res.status).toBe(400)
    expect(mocks.createAiJob).not.toHaveBeenCalled()
  })

  it("creates a topic_research_scan job and returns 202 for an admin", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topic: "blood flow restriction training" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(mocks.createAiJob).toHaveBeenCalledWith({
      type: "topic_research_scan",
      userId: "u1",
      input: { topic: "blood flow restriction training" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/admin/topic-suggestions/research.test.ts`
Expected: FAIL — route file does not exist.

- [ ] **Step 3: Write the route**

```typescript
// app/api/admin/topic-suggestions/research/route.ts
// POST { topic } — kicks off an on-demand Tavily research ai_job for a single
// admin-typed topic. The topicResearchScan Firebase Function writes candidate
// topics back into the job's `result` for preview (see the commit route for
// turning selected candidates into content_calendar rows).

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const schema = z.object({
  topic: z.string().trim().min(5, "Give the topic a few more words").max(200),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
  }

  const { jobId, status } = await createAiJob({
    type: "topic_research_scan",
    userId: session.user.id,
    input: { topic: parsed.data.topic },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/admin/topic-suggestions/research.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/topic-suggestions/research/route.ts __tests__/api/admin/topic-suggestions/research.test.ts
git commit -m "feat(api): add route to kick off on-demand topic research"
```

---

### Task 6: Commit endpoint — turn selected candidates into topic suggestions

**Files:**
- Modify: `lib/db/content-calendar.ts`
- Create: `app/api/admin/topic-suggestions/research/commit/route.ts`
- Create: `__tests__/api/admin/topic-suggestions/research-commit.test.ts`

**Interfaces:**
- Produces:
  - `interface ResearchedTopic { title: string; summary: string; tavily_url: string; rank: number }`
  - `createResearchedTopicSuggestions(topics: ResearchedTopic[], scheduledFor: string): Promise<ContentCalendarEntry[]>`
  - `POST /api/admin/topic-suggestions/research/commit` — body `{ topics: ResearchedTopic[] }`
    (1-10 items), response `{ entries: ContentCalendarEntry[] }` with HTTP 201.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/admin/topic-suggestions/research-commit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createResearchedTopicSuggestions: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/content-calendar", () => ({
  createResearchedTopicSuggestions: mocks.createResearchedTopicSuggestions,
}))

import { POST } from "@/app/api/admin/topic-suggestions/research/commit/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/topic-suggestions/research/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const sampleTopic = {
  title: "BFR training accelerates return-to-play hypertrophy",
  summary: "Low-load BFR preserves cross-sectional area during restricted loading phases.",
  tavily_url: "https://journal.example/bfr-study",
  rank: 1,
}

describe("POST /api/admin/topic-suggestions/research/commit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createResearchedTopicSuggestions.mockResolvedValue([{ id: "entry-1", ...sampleTopic }])
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ topics: [sampleTopic] }))
    expect(res.status).toBe(401)
    expect(mocks.createResearchedTopicSuggestions).not.toHaveBeenCalled()
  })

  it("returns 400 when topics is empty", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topics: [] }))
    expect(res.status).toBe(400)
    expect(mocks.createResearchedTopicSuggestions).not.toHaveBeenCalled()
  })

  it("returns 400 when a topic is missing a valid tavily_url", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topics: [{ ...sampleTopic, tavily_url: "not-a-url" }] }))
    expect(res.status).toBe(400)
    expect(mocks.createResearchedTopicSuggestions).not.toHaveBeenCalled()
  })

  it("inserts the selected topics and returns 201 for an admin", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topics: [sampleTopic] }))
    expect(res.status).toBe(201)
    expect(mocks.createResearchedTopicSuggestions).toHaveBeenCalledWith(
      [sampleTopic],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/admin/topic-suggestions/research-commit.test.ts`
Expected: FAIL — route and db function do not exist.

- [ ] **Step 3: Add the db helper**

Append to `lib/db/content-calendar.ts` (after `createManualTopicSuggestion`):

```typescript
export interface ResearchedTopic {
  title: string
  summary: string
  tavily_url: string
  rank: number
}

/**
 * Bulk-inserts admin-selected candidates from the on-demand "research a
 * topic" form. Same metadata shape the weekly Tavily scan writes, so these
 * render as ordinary topic cards in TopicSuggestionsList.
 */
export async function createResearchedTopicSuggestions(
  topics: ResearchedTopic[],
  scheduledFor: string,
): Promise<ContentCalendarEntry[]> {
  const supabase = getClient()
  const rows = topics.map((t) => ({
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
  const { data, error } = await supabase.from("content_calendar").insert(rows).select()
  if (error) throw error
  return data as ContentCalendarEntry[]
}
```

- [ ] **Step 4: Write the commit route**

```typescript
// app/api/admin/topic-suggestions/research/commit/route.ts
// POST { topics } — writes admin-selected candidates from the on-demand
// research preview into content_calendar as ordinary topic_suggestion rows.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createResearchedTopicSuggestions } from "@/lib/db/content-calendar"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const schema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        summary: z.string().trim().min(1),
        tavily_url: z.string().trim().url(),
        rank: z.number(),
      }),
    )
    .min(1, "Select at least one topic")
    .max(10, "Too many topics at once"),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const entries = await createResearchedTopicSuggestions(parsed.data.topics, today)
  return NextResponse.json({ entries }, { status: 201 })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/api/admin/topic-suggestions/research-commit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/db/content-calendar.ts app/api/admin/topic-suggestions/research/commit/route.ts __tests__/api/admin/topic-suggestions/research-commit.test.ts
git commit -m "feat(api): add commit endpoint for admin-selected researched topics"
```

---

### Task 7: UI — the "Research a topic" form

**Files:**
- Create: `components/admin/topic-suggestions/TopicResearchForm.tsx`
- Create: `__tests__/components/admin/topic-suggestions/TopicResearchForm.test.tsx`
- Modify: `components/admin/topic-suggestions/BlogTopicControls.tsx`

**Interfaces:**
- Consumes: `useAiJob` from `@/hooks/use-ai-job` (existing); `Checkbox` from
  `@/components/ui/checkbox` (existing); `Button`/`Input` from `@/components/ui/*` (existing);
  the two routes from Tasks 5 and 6.
- Produces: `<TopicResearchForm />` — no props, self-contained (mirrors how
  `BlogTopicControls` itself takes no external state for its own two existing cards).

- [ ] **Step 1: Write the failing tests**

```tsx
// __tests__/components/admin/topic-suggestions/TopicResearchForm.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const useAiJobMock = vi.fn()
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: (jobId: string | null) => useAiJobMock(jobId),
}))

const routerRefreshMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

import { TopicResearchForm } from "@/components/admin/topic-suggestions/TopicResearchForm"

function defaultAiJobState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "pending",
    result: null,
    error: null,
    text: "",
    chunks: [],
    analysis: null,
    programCreated: null,
    messageId: null,
    activeTools: [],
    reset: vi.fn(),
    ...overrides,
  }
}

describe("TopicResearchForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAiJobMock.mockReturnValue(defaultAiJobState())
  })

  it("renders the input and Research button", () => {
    render(<TopicResearchForm />)
    expect(screen.getByPlaceholderText(/e\.g\./i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /research/i })).toBeInTheDocument()
  })

  it("POSTs the typed topic and shows a loading state once a job is running", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "processing" }))

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), {
      target: { value: "blood flow restriction training" },
    })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/topic-suggestions/research",
        expect.objectContaining({ method: "POST" }),
      )
    })
    expect(await screen.findByText(/researching/i)).toBeInTheDocument()
  })

  it("renders candidates as a checked-by-default list once the job completes", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(
      defaultAiJobState({
        status: "completed",
        result: {
          topics: [
            { title: "BFR accelerates return-to-play hypertrophy", summary: "s1", tavily_url: "https://a.example/1", rank: 1 },
            { title: "BFR safety thresholds in adolescents", summary: "s2", tavily_url: "https://b.example/2", rank: 2 },
          ],
        },
      }),
    )

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), {
      target: { value: "blood flow restriction training" },
    })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    expect(await screen.findByText("BFR accelerates return-to-play hypertrophy")).toBeInTheDocument()
    expect(screen.getByText("BFR safety thresholds in adolescents")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add 2 selected/i })).toBeInTheDocument()
  })

  it("unchecking a candidate updates the Add-selected count", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(
      defaultAiJobState({
        status: "completed",
        result: {
          topics: [
            { title: "Topic A", summary: "s1", tavily_url: "https://a.example/1", rank: 1 },
            { title: "Topic B", summary: "s2", tavily_url: "https://b.example/2", rank: 2 },
          ],
        },
      }),
    )

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "some topic here" } })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))
    await screen.findByText("Topic A")

    fireEvent.click(screen.getByRole("checkbox", { name: /include "topic a"/i }))
    expect(screen.getByRole("button", { name: /add 1 selected/i })).toBeInTheDocument()
  })

  it("shows a no-results message when the job completes with zero candidates", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "completed", result: { topics: [] } }))

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "an obscure niche topic" } })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    expect(await screen.findByText(/no strong sources found/i)).toBeInTheDocument()
  })

  it("shows an error state with a retry action when the job fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "job-1", status: "pending" }) })
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "failed", error: "Tavily rate limit" }))

    render(<TopicResearchForm />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: "some topic here" } })
    fireEvent.click(screen.getByRole("button", { name: /research/i }))

    expect(await screen.findByText(/tavily rate limit/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/components/admin/topic-suggestions/TopicResearchForm.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the component**

```tsx
// components/admin/topic-suggestions/TopicResearchForm.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Search as SearchIcon, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useAiJob } from "@/hooks/use-ai-job"

interface ResearchCandidate {
  title: string
  summary: string
  tavily_url: string
  rank: number
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function TopicResearchForm() {
  const router = useRouter()
  const [topic, setTopic] = useState("")
  const [submittedTopic, setSubmittedTopic] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const aiJob = useAiJob(jobId)

  const candidates = ((aiJob.result as { topics?: ResearchCandidate[] } | null)?.topics) ?? []
  const isLoading = submitting || (jobId !== null && (aiJob.status === "pending" || aiJob.status === "processing"))
  const isError = jobId !== null && aiJob.status === "failed"
  const isDone = jobId !== null && aiJob.status === "completed"

  // Default every fresh batch of candidates to checked.
  useEffect(() => {
    if (jobId && aiJob.status === "completed") {
      const topics = (aiJob.result as { topics?: ResearchCandidate[] } | null)?.topics ?? []
      setSelected(new Set(topics.map((_, i) => i)))
    }
  }, [jobId, aiJob.status, aiJob.result])

  async function runResearch() {
    const trimmed = topic.trim()
    if (trimmed.length < 5) {
      toast.error("Give the topic a few more words")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to start research")
      setSubmittedTopic(trimmed)
      setJobId(data.jobId)
      setSelected(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start research")
    } finally {
      setSubmitting(false)
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function reset() {
    setJobId(null)
    setSubmittedTopic("")
    setTopic("")
    setSelected(new Set())
  }

  async function addSelected() {
    const chosen = candidates.filter((_, i) => selected.has(i))
    if (chosen.length === 0) {
      toast.error("Select at least one topic to add")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/admin/topic-suggestions/research/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: chosen }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to add topics")
      toast.success(`Added ${chosen.length} topic${chosen.length === 1 ? "" : "s"} — find ${chosen.length === 1 ? "it" : "them"} below.`)
      reset()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add topics")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <SearchIcon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-primary">Research a topic</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Type a subject and DJP will pull sources and suggest a few angles — pick which ones to
        add.
      </p>

      {!jobId && (
        <div className="flex gap-2">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void runResearch()
              }
            }}
            placeholder="e.g. blood flow restriction training for return-to-play"
            maxLength={200}
          />
          <Button onClick={runResearch} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : "Research"}
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Researching &ldquo;{submittedTopic}&rdquo;…
        </div>
      )}

      {isError && (
        <div className="space-y-2">
          <p className="text-sm text-error">{aiJob.error ?? "Research failed"}</p>
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        </div>
      )}

      {isDone && candidates.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No strong sources found for &ldquo;{submittedTopic}&rdquo; — try rephrasing or being
            more specific.
          </p>
          <Button size="sm" variant="outline" onClick={reset}>
            Search again
          </Button>
        </div>
      )}

      {isDone && candidates.length > 0 && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={c.tavily_url + i} className="flex items-start gap-2 rounded-md border border-border p-2">
                <Checkbox
                  checked={selected.has(i)}
                  onCheckedChange={() => toggle(i)}
                  className="mt-0.5"
                  aria-label={`Include "${c.title}"`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary">{c.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{c.summary}</p>
                  <a
                    href={c.tavily_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                    {hostFromUrl(c.tavily_url)}
                  </a>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={reset} disabled={adding}>
              Search again
            </Button>
            <Button size="sm" onClick={addSelected} disabled={adding}>
              {adding ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              Add {selected.size} selected
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/topic-suggestions/TopicResearchForm.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire it into `BlogTopicControls.tsx`**

Add the import at the top of `components/admin/topic-suggestions/BlogTopicControls.tsx`:

```typescript
import { TopicResearchForm } from "@/components/admin/topic-suggestions/TopicResearchForm"
```

Change the returned JSX from (existing, two cards in a 2-col grid):

```tsx
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      {/* Suggest your own topic */}
      <div className="rounded-xl border border-border bg-white p-4">
```

to (new research card first, "Weekly auto-scan topics" spans both columns since it's a
settings control rather than a one-off "add a topic" action):

```tsx
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <TopicResearchForm />

      {/* Suggest your own topic */}
      <div className="rounded-xl border border-border bg-white p-4">
```

And add `lg:col-span-2` to the "Weekly auto-scan topics" card's className — change:

```tsx
      {/* Weekly auto-scan topics */}
      <div className="rounded-xl border border-border bg-white p-4">
```

to:

```tsx
      {/* Weekly auto-scan topics */}
      <div className="rounded-xl border border-border bg-white p-4 lg:col-span-2">
```

- [ ] **Step 6: Manually sanity-check the page renders**

Run: `npm run build` and grep the output for `topic-suggestions` or any error mentioning
`BlogTopicControls`/`TopicResearchForm` (per project convention: use the build as the
"did I break compilation" gate, don't read the whole log).

- [ ] **Step 7: Commit**

```bash
git add components/admin/topic-suggestions/TopicResearchForm.tsx __tests__/components/admin/topic-suggestions/TopicResearchForm.test.tsx components/admin/topic-suggestions/BlogTopicControls.tsx
git commit -m "feat(admin): add on-demand topic research form to /admin/topic-suggestions"
```

---

## Post-implementation verification (not a task — run once after Task 7)

- [ ] `cd functions && npx vitest run src/__tests__/research-candidates.test.ts src/__tests__/tavily-trending-scan.test.ts src/__tests__/topic-research-scan.test.ts && npx tsc --noEmit`
- [ ] From repo root: `npx vitest run __tests__/api/admin/topic-suggestions __tests__/components/admin/topic-suggestions`
- [ ] `npm run build` (full Next.js build — this is the "did I break compilation anywhere" gate
  for the app half of this change; do not run the full Vitest suite per root `CLAUDE.md`)
- [ ] Update `JOURNAL.md` (gitignored, local-only) with a dated entry tagged
  **[Bug fix]** for Task 2/3 and **[Feature build-out]** for Tasks 4-7, per this project's
  session-start convention.
