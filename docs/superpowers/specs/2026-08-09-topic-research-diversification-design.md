# Topic Suggestions: diversification fix + on-demand topic research

Date: 2026-08-09
Status: Approved (Part 1 explicitly approved by owner; Part 2 finalized under standing
autonomous-mode authorization after the owner stepped away — the two open product
questions were already answered in chat before that point).

## Problem

Screenshot from the owner: the weekly `/admin/topic-suggestions` brief for "Week of Sun,
Aug 9, 2026" showed three near-identical topics back to back (all about eccentric
loading / hamstring force production in sprinting), each labeled "RANK 01". Owner's note:
"Maybe look at diversifying the search topics? First 4-5 are the same article, and we
have a lot of search terms in the category?"

Separately, the owner asked whether a form exists that lets them type a topic and have
the system research it, surfacing suggestions — as opposed to the existing "Suggest your
own topic" box, which inserts the raw typed title with no research at all.

## Part 1 — Fix the weekly scan's duplicate/rank-1 bug

Root cause, all in `functions/src/tavily-trending-scan.ts`:

1. **Query clustering.** Of `TRENDING_QUERIES` (6 defaults), two sit in the same narrow
   mechanism niche (`velocity-based training force-velocity profiling…` and
   `plyometrics rate of force development eccentric overload meta-analysis`). Tavily
   returns the same handful of frequently-cited/re-published studies for both.
2. **URL-only dedup.** `seenUrls` in `handleTavilyTrendingScan` only catches exact
   duplicate links, not the same story re-hosted on a different domain (journal vs.
   university press release vs. coaching blog) with a near-identical title.
3. **Unenforced rank.** The LLM assigns each topic's `rank` independently; nothing stops
   it from giving three different topics `rank: 1`. That's the literal repeated "RANK 01"
   badge in the UI (`TopicSuggestionsList`'s `rankLabel` just formats whatever `rank` it's
   given).

### Fix

- **Diversify `TRENDING_QUERIES`** (and the twin defaults in `lib/blog/scan-queries.ts`):
  drop the `plyometrics rate of force development eccentric overload meta-analysis` query
  (the one overlapping `velocity-based training force-velocity profiling…` and directly
  implicated in the screenshot's duplicate cluster), add three new categories not
  currently covered — return-to-play/injury prevention, sport psychology/readiness,
  nutrition/fueling for performance. Net: 8 queries spanning 8 distinct sub-domains
  (general freshness, velocity/force, monitoring/recovery, youth/LTAD, applied/elite,
  return-to-play, psychology, nutrition) instead of 6 queries spanning ~5 with two
  overlapping.
- **Round-robin candidate collection.** `handleTavilyTrendingScan` currently drains each
  query's results in order and stops once `MAX_RESULTS_TO_RANK` (20) unique URLs are
  found — so with 6 queries the first 2-3 alone could fill the cap and starve the rest.
  With 8 queries this would silently defeat the diversification fix (the 3 new categories
  might never reach the ranker at all). Fix: collect one result from each query per pass,
  round-robin, before starting a second pass — so the candidate pool always has
  proportional representation across all queries before the cap is hit. Bump
  `MAX_RESULTS_TO_RANK` from 20 to 24 (a clean multiple of 8) so each query can contribute
  up to 3 before truncation.
- **Near-duplicate collapsing.** New shared helper `functions/src/lib/dedupe-topics.ts`
  exporting `dedupeSimilarResults(results, seenUrls)`: keeps the existing exact-URL guard,
  adds a normalized-title Jaccard-similarity check (lowercase, strip punctuation/stopwords,
  compare word sets; collapse if overlap ratio > 0.6) so a re-published version of the same
  study never reaches the ranker as a second candidate. Applied during the round-robin
  collection pass. Also add one line to the ranking system prompt: don't return two topics
  about the same underlying study/finding.
- **Deterministic rank.** After `callAgent` returns ranked topics, sort by the model's
  `rank` once (stable sort), then overwrite `rank` with the topic's 1-based position in
  that sorted array before building the `content_calendar` insert rows. Guarantees unique,
  sequential ranks no matter what the model returns.

Existing tests in `functions/src/__tests__/tavily-trending-scan.test.ts` assert on
`TRENDING_QUERIES` content (categories present/absent) — these get updated for the new
query set. New tests cover `dedupeSimilarResults` directly and the rank-reassignment logic.

## Part 2 — On-demand "research a topic" form

### Decisions already made with the owner (in chat, before this doc)

- **Result flow: preview, then pick.** Research runs, a small set of candidate topics is
  shown with title/summary/source, the admin checks which to keep, only those get written
  to `content_calendar`. Nothing is auto-inserted the way the weekly scan auto-inserts.
- **Placement: additive, not a replacement.** The existing "Suggest your own topic" box
  (exact-title, no research) stays as-is for when the admin already knows what they want
  written. The new "Research a topic" box sits alongside it as a second way to add topics.

### Hard constraint that decided the architecture

`TAVILY_API_KEY` only exists as a Firebase Functions secret (see `.env.example` — it's
listed under "Firebase Functions secrets", not in the main Vercel-facing block, and
`functions/src/lib/tavily.ts` reads it from `process.env` in that runtime only). Every
existing Tavily call in this codebase — the weekly trending scan and the per-blog-post
`ResearchPanel` — goes through the same shape: a Next.js route creates an `ai_jobs`
Firestore doc, a Firebase Function (subscribed via `onDocumentCreated`) does the actual
Tavily + Claude work and writes the result back, the client polls with `useAiJob`. This
feature follows the identical pattern — there is no option to call Tavily directly from a
Vercel route.

### Data flow

```
TopicResearchForm (client)
  -> POST /api/admin/topic-suggestions/research { topic }
       -> createAiJob({ type: "topic_research_scan", input: { topic } })
       <- { jobId }
  -> useAiJob(jobId) polls ai_jobs/{jobId} (Firestore, existing hook)

Firebase Function `topicResearchScan` (onDocumentCreated, type === "topic_research_scan")
  -> handleTopicResearchScan(jobId) in functions/src/topic-research-scan.ts
       -> one tavilySearch({ query: topic, search_depth: "advanced", max_results: 8,
            exclude_domains: EXCLUDED_DOMAINS })   // EXCLUDED_DOMAINS imported from
                                                     // tavily-trending-scan.ts, not duplicated
       -> dedupeSimilarResults(...)                 // same helper as Part 1
       -> callAgent(SYSTEM_PROMPT, ..., TopicResearchSchema)  // 3-6 topics, same
                                                                // {title, summary,
                                                                // tavily_url, rank} shape
       -> job.result = { topics: [...] }            // NOT written to content_calendar —
                                                       // this is the "preview" step
       -> job.status = "completed"

TopicResearchForm renders aiJob.result.topics as a checklist (default all checked)
  -> "Add N selected" -> POST /api/admin/topic-suggestions/research/commit { topics }
       -> createResearchedTopicSuggestions(topics, today)  // lib/db/content-calendar.ts
       -> bulk insert into content_calendar, entry_type "topic_suggestion", status
          "planned", metadata { source: "tavily", rank, tavily_url, summary } — identical
          shape to what the weekly scan writes, so these render as ordinary TopicCards
  -> router.refresh() -> new topics appear in TopicSuggestionsList
```

If Tavily returns zero usable results for the typed topic, `job.result.topics` is `[]`
and the form shows "No strong sources found for that topic — try rephrasing or being more
specific," matching the existing "no sources" copy in `ResearchPanel`.

### New/changed files

- `functions/src/lib/dedupe-topics.ts` — new. `dedupeSimilarResults()`, shared by both
  scans.
- `functions/src/tavily-trending-scan.ts` — diversified queries, uses the new dedupe
  helper, deterministic rank reassignment.
- `lib/blog/scan-queries.ts` — twin query-list update.
- `functions/src/topic-research-scan.ts` — new. `handleTopicResearchScan(jobId)`, mirrors
  `tavily-trending-scan.ts`'s structure but single-query and preview-only (no Supabase
  write).
- `functions/src/index.ts` — new `topicResearchScan` export (`onDocumentCreated`,
  `timeoutSeconds: 120`, secrets `[anthropicApiKey, tavilyApiKey]` — no Supabase secrets
  needed since this handler never touches Supabase).
- `lib/ai-jobs.ts` — add `"topic_research_scan"` to `AiJobType`.
- `app/api/admin/topic-suggestions/research/route.ts` — new. POST `{ topic }` ->
  `createAiJob`, mirrors `app/api/admin/blog-posts/[id]/research/route.ts`.
- `app/api/admin/topic-suggestions/research/commit/route.ts` — new. POST
  `{ topics: Array<{title, summary, tavily_url, rank}> }`, validates with Zod, calls the
  new db helper.
- `lib/db/content-calendar.ts` — add `createResearchedTopicSuggestions()`.
- `components/admin/topic-suggestions/TopicResearchForm.tsx` — new client component:
  input + "Research" button -> loading state -> checklist of candidates (`Checkbox` from
  `components/ui/checkbox.tsx`) -> "Add N selected" / "Search again".
- `components/admin/topic-suggestions/BlogTopicControls.tsx` — render `TopicResearchForm`
  as a new grid card alongside "Suggest your own topic"; "Weekly auto-scan topics" moves
  to a full-width row below (`lg:col-span-2`) since it's a settings control, not a
  one-off "add a topic" action.

### Error handling

Mirrors `ResearchPanel`: network/validation errors on submit show a toast; a `failed`
job status shows an inline error with a "Try again" action. No partial-failure state to
handle since the commit step is a single bulk insert of admin-selected rows.

### Testing (targeted, not full suite — per project convention)

- `functions/src/__tests__/dedupe-topics.test.ts` — new, unit tests for the similarity
  threshold (near-duplicate titles collapse, genuinely distinct titles don't).
- `functions/src/__tests__/tavily-trending-scan.test.ts` — update query-content
  assertions for the new set; add a case for deterministic rank reassignment.
- `functions/src/__tests__/topic-research-scan.test.ts` — new, mirrors the trending-scan
  test's structure for the new handler's prompt-building/schema.
- `__tests__/api/admin/topic-suggestions/research.test.ts` — new, mirrors
  `__tests__/api/admin/blog/generate-from-suggestion.test.ts`'s mocking pattern
  (auth, `createAiJob`).
- `__tests__/api/admin/topic-suggestions/research-commit.test.ts` — new, validates the
  Zod schema and the db insert call.

### Out of scope (YAGNI)

- No query-expansion (asking the LLM to turn one typed topic into several search
  queries) — one Tavily search per research request is enough signal for 3-6 suggestions,
  and it matches the "preview, then pick" answer: the admin can just search again with a
  refined phrase if the first pass is thin.
- No persistence of *discarded* candidates — they were never written anywhere, so
  unchecking them is simply not inserting them. Nothing to clean up.
- No change to `ResearchPanel` (per-post research) or `tavily_research` job type — those
  are a different feature (research scoped to an existing draft's title) and already work.
