# AI Generation Prompt Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic prompt caching to the heavy stable blocks (exercise library, skeleton, constraints, prior context) in AI program/week/day generation, surface cache-hit telemetry, and verify the change preserves every existing feature.

**Architecture:** Phase 1 adds cache-stat observability — `cache_creation_input_tokens` / `cache_read_input_tokens` flow from the Anthropic SDK through `AgentCallResult`, into `ai_generation_log`, and into orchestrator logs. Phase 2 splits the Agent 3 user message into a stable prefix (skeleton + constraints + library + prior context + coach instructions + pool note) and a variable suffix (retry feedback + dedup feedback), with an `ephemeral` `cache_control` breakpoint after the prefix — this gives cache hits on the within-week retry loop in both `orchestrator.ts` (program-gen) and `week-orchestrator.ts` (week + day gen). Phase 3 is an optional follow-up that restructures the program orchestrator to send a stable per-program exercise library so weeks 2-N hit cache from week 1's write.

**Tech Stack:** `@anthropic-ai/sdk` (raw SDK in `functions/src/ai/`), `@ai-sdk/anthropic` + `ai` (Vercel AI SDK wrapper in `lib/ai/`), Zod, Vitest, Supabase migrations via `mcp__supabase__apply_migration`.

---

## Codebase Audit (must preserve everything below)

The agent who picks up this plan inherits a production AI pipeline with many subtle behaviors. The cache changes must not regress any of these. **Read this section before touching code.**

### Current call sites where `cacheSystemPrompt: true` is already set

| File | Line | Agent | Model | Notes |
|---|---|---|---|---|
| `functions/src/ai/orchestrator.ts` | 355 | A1 Profile Analyzer | Sonnet | RAG-augmented system prompt (cache key changes when RAG hit changes) |
| `functions/src/ai/orchestrator.ts` | 468 | A2 Program Architect | Opus | |
| `functions/src/ai/orchestrator.ts` | 642 | A3 Exercise Selector | Sonnet (default) | Inside `for week` × `for attempt` retry loop |
| `functions/src/ai/week-orchestrator.ts` | 559 | Architect (week/day) | Opus | |
| `functions/src/ai/week-orchestrator.ts` | 653 | Profile Analyzer (week-scoped) | Sonnet | |
| `functions/src/ai/week-orchestrator.ts` | 814 | Exercise Selector | Sonnet (default) | Inside retry loop |
| `functions/src/ai-coach.ts` | 330 | Chat | — | Out of scope but uses same helper |
| `functions/src/chief-strategist.ts` | 153, 208 | Strategy chief | Sonnet | Out of scope |
| `functions/src/performance-critic.ts` | 62 | Outcome scorer | Sonnet | Out of scope |
| `functions/src/social-agent.ts` | 447, 459 | Social agent | Sonnet | Out of scope |
| `functions/src/social-fanout.ts` | 181, 198 | Social fanout | — | Out of scope |
| `functions/src/voice-drift-monitor.ts` | 97 | Voice drift | — | Out of scope |
| `lib/ads/ad-copy.ts` | 133 | Ad copy gen | — | Out of scope |
| `lib/ads/agent/reason.ts` | 255 | Ads reasoner | — | Out of scope |
| `lib/ads/recommendations.ts` | 351 | Ads recs | — | Out of scope |
| `lib/ads/weekly-pipeline-report.ts` | 67 | Weekly pipeline | Haiku | Out of scope |
| `lib/ads/weekly-report.ts` | 236 | Weekly report | Haiku | Out of scope |
| `lib/ai/enhance-template.ts` | 75, 99 | Template enhance | — | Out of scope |

**Rule of thumb:** This plan only changes the program/week-orchestrator call sites and the shared `callAgent` signature. All other call sites must keep compiling and behaving identically — verified by leaving the existing options surface unchanged and adding new options as optional.

### Two `callAgent` implementations (different APIs — both must be updated)

1. **`functions/src/ai/anthropic.ts`** — raw `@anthropic-ai/sdk`. Uses `client.messages.stream(...).finalMessage()` with `tool_use` structured output. Cache control shape: `cache_control: { type: "ephemeral" }` on `TextBlockParam`. This is the one program/week orchestrators use.
2. **`lib/ai/anthropic.ts`** — `@ai-sdk/anthropic` via `generateObject`. Cache control shape: `providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }` on a system message object. Not used by program/week orchestrators but exported `callAgent` is consumed by other features.

Both implementations expose the same option name (`cacheSystemPrompt`). New options must be added in both.

### Features that MUST keep working (regression checklist)

**`functions/src/ai/anthropic.ts` `callAgent`:**
- Structured output via `tool_use` (primary path) with `tool_choice: { type: "tool", name: "structured_output" }`.
- Text-fallback path with `jsonrepair` when `toToolInputSchema` returns null.
- Streaming via `client.messages.stream()` + `finalMessage()` (avoids 10-min timeout).
- `max_tokens` truncation detection — throws when `stop_reason === "max_tokens"`.
- `pRetry` with 4 retries, 5-30s backoff. `shouldRetry` covers transient (`429`/`529`/`5xx`), `SyntaxError`, and `ZodError`.
- Haiku fallback when primary model exhausts retries on a transient error (skipped if primary was already Haiku).
- Enum normalization (`normalizeEnumFields`) before Zod validation.

**`functions/src/ai/orchestrator.ts` `generateProgramSync`:**
- Generation log lifecycle: create → status `generating` → `completed` / `failed` / `cancelled`.
- Re-use of `existingLogId` from the API route (so the polling client gets the same id).
- Cancellation checks via `createCancellationChecker` between Agent 1 / 2 / 3 and between weeks.
- Job-progress updates via `createJobProgressUpdater` (`analyzing_profile`, `profile_complete`, `designing_structure`, `structure_complete`, `selecting_exercises`, `validated`, `saving_program`).
- RAG context injection (`retrieveSimilarContext` → `buildRagAugmentedPrompt`) into Agent 1 system prompt.
- Coach policy + coach instructions concatenation into user message.
- Exercise pool filter (`preferred` vs `strict`) with `applyPoolFilter` + `buildPoolNote`.
- Hard-exclusion difficulty filter (`filterByDifficultyLevel`) + earned-progression filter (`filterByProgressionPhase`) + assessment-score filter (`filterByDifficultyScore`) + joint-injury filter (`filterByInjuredJoints`).
- Per-week dedup retry loop with `verifyWeekDiversity`, `validateSkeletonAgainstAnalysis`, `validateAssignmentAgainstCeiling`, and final `dedupAssignmentsInPlace` safety net.
- Hallucinated exercise ID stripping (filter `assignments` by `exerciseIdSet`).
- Fire-and-forget `saveConversationBatch` + `embedConversationMessage` after each agent call.
- Fire-and-forget `recordUsageFromFn` after program insert.
- Program / assignment / week-access record creation with cascade.

**`functions/src/ai/week-orchestrator.ts` `generateWeekSync`:**
- Single-day mode (`target_day_of_week` 1-7) — filters skeleton to one day, validates target day was empty.
- Fill-blank-week mode (`target_week_number` ≤ current `duration_weeks`) — refuses if target week already has exercises.
- Append-new-week mode (default) — bumps `programs.duration_weeks` and `program_assignments.total_weeks`.
- Architect/Selector retry loop with cross-week (`verifyWeekAgainstExisting`) AND within-week (`verifyWithinWeekDuplicates`) dedup verification.
- Log-quality gate (`computeRpeLogQuality`) — < 50% RPE coverage skips autoregulation in the Analyzer.
- `log_quality_history` append to `programs.ai_generation_params` (non-blocking).
- `ignore_profile` mode — coach-directed runs that skip client profile.
- Exercise pool `preferred` vs `strict` semantics — preferred biases via `preferredIds` while keeping the full library; strict hard-restricts.
- `excludeIds` from prior-week dedup → passed to `semanticFilterExercises` / `scoreAndFilterExercises`.

### What is currently NOT cached and where the win lives

Agent 3 user messages are NOT cached today. Per Agent 3 call the model re-reads:
- `JSON.stringify(weekSkeletonPayload)` — ~500-1500 tokens
- `constraintsContext` — ~50-150 tokens
- `formatExerciseLibrary(thisWeekLibrary)` — ~3000-15000 tokens (the heavy block)
- `priorContext.prompt_text` — ~500-3000 tokens (grows with weeks)
- `coachInstructionsSection` — variable
- `poolNote` — small
- `feedbackSection` + `dedupFeedback` — only present on retries (≥ attempt 2)

The library + skeleton + constraints + prior context + coach instructions + pool note are **identical across the up-to-3 attempts for the same week**, so a single cache breakpoint placed just before `feedbackSection`/`dedupFeedback` gives cache reads on attempts 2 and 3. Cache write is 1.25× normal input cost; cache read is 0.1×. Even one retry recoups the write cost ~7×.

The same pattern applies to the week-orchestrator Exercise Selector (line 806) and the week-orchestrator Architect (line 555).

### Anthropic prompt-caching constraints to remember

- **Minimum 1024 input tokens** to cache (Sonnet/Opus). Smaller blocks won't cache — no error, just no hit. Library text easily clears this.
- **Up to 4 `cache_control` breakpoints** per request.
- **Ephemeral TTL: 5 minutes** sliding window. Cache write resets the timer.
- **Exact-prefix match** up to the breakpoint — a single byte difference invalidates.
- Works on system blocks, message content blocks, and tool definitions. Compatible with streaming and with `tool_choice`.
- Cache is per-model — Haiku fallback in `callAgent` writes/reads against Haiku's own cache.

---

## File Structure

**Modified files:**

- `functions/src/ai/types.ts` — extend `AgentCallResult<T>` with optional cache token counts.
- `functions/src/ai/anthropic.ts` — surface cache token counts from the SDK response; add optional `cacheUserPrefix` option that splits `userMessage` into cached prefix + uncached suffix; mirror in `streamRaw` if needed for parity.
- `lib/ai/anthropic.ts` — surface cache token counts via Vercel AI SDK; mirror `cacheUserPrefix` option.
- `lib/ai/types.ts` — mirror the `AgentCallResult<T>` extension (this is the type both implementations reuse — confirm path; if `lib/ai/types.ts` re-exports from `functions`, update once).
- `functions/src/ai/orchestrator.ts` — refactor Agent 3 user message into prefix/suffix; pass `cacheUserPrefix`; aggregate cache stats into `tokenUsage`.
- `functions/src/ai/week-orchestrator.ts` — same refactor for Exercise Selector; consider Architect.
- `lib/db/ai-generation-log.ts` — accept new cache stat fields when creating/updating logs.

**Created files:**

- `supabase/migrations/00153_ai_generation_log_cache_stats.sql` — add `cache_creation_tokens` and `cache_read_tokens` columns to `ai_generation_log`.
- `functions/src/ai/__tests__/prompt-caching.test.ts` — unit tests that assert (a) cache_control is set on the right blocks, (b) cache token counts are surfaced through `AgentCallResult`, (c) existing flow remains unchanged when the new options are not set.

**Out of scope (do NOT modify in this plan):**

- All other `callAgent` consumers (ads, social, blog, chief, etc.) — they must keep working unchanged. Verified by leaving existing options surface alone and adding new options as optional.
- `streamWithTools` / chat features — separate stream type. Unchanged unless an obvious typing impact appears.

---

## Phase 1 — Cache observability

The point of this phase is to land a non-behavioral change first that lets us measure Phase 2's impact. Without this, "did caching work?" becomes a guessing game.

### Task 1: Extend `AgentCallResult<T>` with cache token counts

**Files:**
- Modify: `functions/src/ai/types.ts:153-156`

- [ ] **Step 1: Edit the type**

```ts
export interface AgentCallResult<T> {
  content: T
  tokens_used: number
  /** Tokens written to the prompt cache on this call (1.25× normal input cost). */
  cache_creation_tokens?: number
  /** Tokens read from the prompt cache on this call (0.1× normal input cost). */
  cache_read_tokens?: number
}
```

- [ ] **Step 2: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors. Existing call sites compile because the new fields are optional.

- [ ] **Step 3: Commit**

```bash
git add functions/src/ai/types.ts
git commit -m "feat(ai-types): add optional cache token counts to AgentCallResult"
```

### Task 2: Surface cache tokens from `functions/src/ai/anthropic.ts` `callAgent`

**Files:**
- Modify: `functions/src/ai/anthropic.ts:190` (tool_use path) and `:228` (text fallback path)

The Anthropic SDK returns `response.usage` with optional `cache_creation_input_tokens` and `cache_read_input_tokens` fields when caching is involved. We need to pull them out and return them.

- [ ] **Step 1: Update the tool_use path to read cache fields**

Find this block in [functions/src/ai/anthropic.ts:188-190](functions/src/ai/anthropic.ts#L188-L190):

```ts
        parsed = toolBlock.input
        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
      } else {
```

Replace with:

```ts
        parsed = toolBlock.input
        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
        cache_creation_tokens = response.usage?.cache_creation_input_tokens ?? 0
        cache_read_tokens = response.usage?.cache_read_input_tokens ?? 0
      } else {
```

- [ ] **Step 2: Update the text fallback path to read cache fields**

Find this block in [functions/src/ai/anthropic.ts:226-229](functions/src/ai/anthropic.ts#L226-L229):

```ts
        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
      }
```

Replace with:

```ts
        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
        cache_creation_tokens = response.usage?.cache_creation_input_tokens ?? 0
        cache_read_tokens = response.usage?.cache_read_input_tokens ?? 0
      }
```

- [ ] **Step 3: Declare the variables at the top of the retry function**

Find this block in [functions/src/ai/anthropic.ts:154-157](functions/src/ai/anthropic.ts#L154-L157):

```ts
      let parsed: unknown
      let tokens_used: number
```

Replace with:

```ts
      let parsed: unknown
      let tokens_used: number
      let cache_creation_tokens = 0
      let cache_read_tokens = 0
```

- [ ] **Step 4: Return the new fields from the retry function**

Find this block in [functions/src/ai/anthropic.ts:231-234](functions/src/ai/anthropic.ts#L231-L234):

```ts
      const normalized = normalizeEnumFields(parsed)
      const validated = schema.parse(normalized)
      return { content: validated as T, tokens_used }
    },
```

Replace with:

```ts
      const normalized = normalizeEnumFields(parsed)
      const validated = schema.parse(normalized)
      return { content: validated as T, tokens_used, cache_creation_tokens, cache_read_tokens }
    },
```

- [ ] **Step 5: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/types.ts functions/src/ai/anthropic.ts
git commit -m "feat(ai-anthropic): surface cache_creation/cache_read token counts in callAgent"
```

### Task 3: Surface cache tokens from `lib/ai/anthropic.ts` `callAgent`

**Files:**
- Modify: `lib/ai/anthropic.ts:102-108`

The Vercel AI SDK exposes provider-specific metadata via `result.providerMetadata?.anthropic`. The Anthropic provider surfaces `cacheCreationInputTokens` and `cacheReadInputTokens` there.

- [ ] **Step 1: Read cache token counts from providerMetadata**

Find this block in [lib/ai/anthropic.ts:100-109](lib/ai/anthropic.ts#L100-L109):

```ts
    },
  )

  const usage = result.usage
  const tokens_used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)

  return {
    content: result.object as T,
    tokens_used,
  }
}
```

Replace with:

```ts
    },
  )

  const usage = result.usage
  const tokens_used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
  const anthropicMeta = (result.providerMetadata?.anthropic ?? {}) as {
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  const cache_creation_tokens = anthropicMeta.cacheCreationInputTokens ?? 0
  const cache_read_tokens = anthropicMeta.cacheReadInputTokens ?? 0

  return {
    content: result.object as T,
    tokens_used,
    cache_creation_tokens,
    cache_read_tokens,
  }
}
```

- [ ] **Step 2: Verify Typescript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/anthropic.ts
git commit -m "feat(ai-anthropic-sdk): surface cache token counts via Vercel AI SDK providerMetadata"
```

### Task 4: Add `cache_creation_tokens` / `cache_read_tokens` columns to `ai_generation_log`

**Files:**
- Create: `supabase/migrations/00153_ai_generation_log_cache_stats.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00153_ai_generation_log_cache_stats.sql
-- Track Anthropic prompt-cache usage per generation run.
-- cache_creation_tokens: tokens written to cache (1.25× normal input cost)
-- cache_read_tokens:     tokens read from cache (0.1× normal input cost)
-- Both are NULL for runs before this column existed.

ALTER TABLE ai_generation_log
  ADD COLUMN IF NOT EXISTS cache_creation_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_read_tokens     integer;

COMMENT ON COLUMN ai_generation_log.cache_creation_tokens IS
  'Anthropic prompt-cache write tokens accumulated across all agents in this generation. NULL for legacy rows.';
COMMENT ON COLUMN ai_generation_log.cache_read_tokens IS
  'Anthropic prompt-cache read tokens accumulated across all agents in this generation. NULL for legacy rows.';
```

- [ ] **Step 2: Apply the migration via MCP**

Use `mcp__supabase__apply_migration` with `name="00153_ai_generation_log_cache_stats"` and the SQL above.
Expected: success, no error in result.

- [ ] **Step 3: Verify columns exist**

Use `mcp__supabase__execute_sql` with:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ai_generation_log'
  AND column_name IN ('cache_creation_tokens', 'cache_read_tokens');
```

Expected: two rows, both `integer`, both `YES` for `is_nullable`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00153_ai_generation_log_cache_stats.sql
git commit -m "feat(db): add cache token columns to ai_generation_log"
```

### Task 5: Persist cache token counts to `ai_generation_log` from program orchestrator

**Files:**
- Modify: `functions/src/ai/orchestrator.ts:207` (tokenUsage shape) and `:905-921` (final log update)

- [ ] **Step 1: Extend the tokenUsage tracker**

Find this line in [functions/src/ai/orchestrator.ts:207](functions/src/ai/orchestrator.ts#L207):

```ts
  const tokenUsage = { agent1: 0, agent2: 0, agent3: 0, agent4: 0, total: 0 }
```

Replace with:

```ts
  const tokenUsage = {
    agent1: 0,
    agent2: 0,
    agent3: 0,
    agent4: 0,
    total: 0,
    cache_creation: 0,
    cache_read: 0,
  }
```

- [ ] **Step 2: Accumulate cache tokens after each agent call**

After [functions/src/ai/orchestrator.ts:369](functions/src/ai/orchestrator.ts#L369) (`tokenUsage.agent1 = agent1Result.tokens_used`), add:

```ts
    tokenUsage.cache_creation += agent1Result.cache_creation_tokens ?? 0
    tokenUsage.cache_read += agent1Result.cache_read_tokens ?? 0
```

After [functions/src/ai/orchestrator.ts:470](functions/src/ai/orchestrator.ts#L470) (`tokenUsage.agent2 = agent2Result.tokens_used`), add:

```ts
    tokenUsage.cache_creation += agent2Result.cache_creation_tokens ?? 0
    tokenUsage.cache_read += agent2Result.cache_read_tokens ?? 0
```

After [functions/src/ai/orchestrator.ts:644](functions/src/ai/orchestrator.ts#L644) (`tokenUsage.agent3 += agent3Result.tokens_used`), add:

```ts
          tokenUsage.cache_creation += agent3Result.cache_creation_tokens ?? 0
          tokenUsage.cache_read += agent3Result.cache_read_tokens ?? 0
```

- [ ] **Step 3: Write cache totals to the generation log**

Find this block in [functions/src/ai/orchestrator.ts:907-921](functions/src/ai/orchestrator.ts#L907-L921):

```ts
    await updateGenerationLog(log.id, {
      program_id: program.id,
      status: "completed",
      tokens_used: tokenUsage.total,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      output_summary: {
        program_id: program.id,
        program_name: program.name,
        exercises_assigned: assignment.assignments.length,
        validation_pass: validation.pass,
        warnings: validation.issues.filter((i) => i.type === "warning").length,
        retries,
      },
    })
```

Replace with:

```ts
    await updateGenerationLog(log.id, {
      program_id: program.id,
      status: "completed",
      tokens_used: tokenUsage.total,
      cache_creation_tokens: tokenUsage.cache_creation,
      cache_read_tokens: tokenUsage.cache_read,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      output_summary: {
        program_id: program.id,
        program_name: program.name,
        exercises_assigned: assignment.assignments.length,
        validation_pass: validation.pass,
        warnings: validation.issues.filter((i) => i.type === "warning").length,
        retries,
        cache_creation_tokens: tokenUsage.cache_creation,
        cache_read_tokens: tokenUsage.cache_read,
      },
    })
```

- [ ] **Step 4: Log cache hit rate to console at the end of the run**

Immediately after the `await updateGenerationLog(...)` block above, add:

```ts
    const cacheHitRate =
      tokenUsage.cache_read + tokenUsage.cache_creation > 0
        ? tokenUsage.cache_read / (tokenUsage.cache_read + tokenUsage.cache_creation)
        : 0
    console.log(
      `[orchestrator:sync] Cache stats — writes: ${tokenUsage.cache_creation}, reads: ${tokenUsage.cache_read}, hit rate: ${(cacheHitRate * 100).toFixed(1)}%`,
    )
```

- [ ] **Step 5: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/orchestrator.ts
git commit -m "feat(orchestrator): accumulate and persist prompt-cache token counts"
```

### Task 6: Persist cache token counts from week orchestrator

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts:332` (tokenUsage shape) and after each `callAgent` call

- [ ] **Step 1: Extend the tokenUsage tracker**

Find this line in [functions/src/ai/week-orchestrator.ts:332](functions/src/ai/week-orchestrator.ts#L332):

```ts
  const tokenUsage = { architect: 0, selector: 0, total: 0 }
```

Replace with:

```ts
  const tokenUsage = { architect: 0, selector: 0, total: 0, cache_creation: 0, cache_read: 0 }
```

- [ ] **Step 2: Accumulate cache tokens after each agent call**

After [functions/src/ai/week-orchestrator.ts:561](functions/src/ai/week-orchestrator.ts#L561) (`tokenUsage.architect = architectResult.tokens_used`), add:

```ts
  tokenUsage.cache_creation += architectResult.cache_creation_tokens ?? 0
  tokenUsage.cache_read += architectResult.cache_read_tokens ?? 0
```

After [functions/src/ai/week-orchestrator.ts:655](functions/src/ai/week-orchestrator.ts#L655) (`tokenUsage.architect += analyzerResult.tokens_used`), add:

```ts
    tokenUsage.cache_creation += analyzerResult.cache_creation_tokens ?? 0
    tokenUsage.cache_read += analyzerResult.cache_read_tokens ?? 0
```

After [functions/src/ai/week-orchestrator.ts:816](functions/src/ai/week-orchestrator.ts#L816) (`tokenUsage.selector += selectorResult.tokens_used`), add:

```ts
      tokenUsage.cache_creation += selectorResult.cache_creation_tokens ?? 0
      tokenUsage.cache_read += selectorResult.cache_read_tokens ?? 0
```

- [ ] **Step 3: Update the `WeekGenerationResult` interface**

Find [functions/src/ai/week-orchestrator.ts:75-80](functions/src/ai/week-orchestrator.ts#L75-L80):

```ts
export interface WeekGenerationResult {
  new_week_number: number
  exercises_added: number
  token_usage: { architect: number; selector: number; total: number }
  duration_ms: number
}
```

Replace with:

```ts
export interface WeekGenerationResult {
  new_week_number: number
  exercises_added: number
  token_usage: {
    architect: number
    selector: number
    total: number
    cache_creation: number
    cache_read: number
  }
  duration_ms: number
}
```

- [ ] **Step 4: Log cache hit rate at end of run**

Before the final `return { new_week_number, ... }` at [functions/src/ai/week-orchestrator.ts:967](functions/src/ai/week-orchestrator.ts#L967), add:

```ts
  const cacheHitRate =
    tokenUsage.cache_read + tokenUsage.cache_creation > 0
      ? tokenUsage.cache_read / (tokenUsage.cache_read + tokenUsage.cache_creation)
      : 0
  console.log(
    `[week-orchestrator] Cache stats — writes: ${tokenUsage.cache_creation}, reads: ${tokenUsage.cache_read}, hit rate: ${(cacheHitRate * 100).toFixed(1)}%`,
  )
```

- [ ] **Step 5: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/week-orchestrator.ts
git commit -m "feat(week-orchestrator): accumulate and log prompt-cache token counts"
```

### Task 7: Write a Phase-1 unit test asserting cache fields propagate

**Files:**
- Create: `functions/src/ai/__tests__/prompt-caching.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const streamMock = vi.hoisted(() => vi.fn())

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { stream: streamMock },
  })) as unknown as { new (): unknown } & { APIError: typeof APIError }
  ;(Anthropic as unknown as { APIError: typeof APIError }).APIError = APIError
  return { default: Anthropic, Anthropic }
})

import { callAgent } from "../anthropic.js"
import { z } from "zod"

describe("callAgent prompt-cache token surfacing", () => {
  beforeEach(() => {
    streamMock.mockReset()
  })

  it("returns cache_creation_tokens and cache_read_tokens from usage", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 4000,
          cache_read_input_tokens: 0,
        },
      }),
    })

    const schema = z.object({ ok: z.boolean() })
    const result = await callAgent("sys", "user", schema, { cacheSystemPrompt: true })

    expect(result.tokens_used).toBe(150)
    expect(result.cache_creation_tokens).toBe(4000)
    expect(result.cache_read_tokens).toBe(0)
  })

  it("treats missing cache fields as zero", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    })

    const schema = z.object({ ok: z.boolean() })
    const result = await callAgent("sys", "user", schema)

    expect(result.cache_creation_tokens).toBe(0)
    expect(result.cache_read_tokens).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test — expect it to fail if Tasks 1-2 weren't applied correctly**

Run: `cd functions && npx vitest run src/ai/__tests__/prompt-caching.test.ts`
Expected: PASS (Tasks 1-2 already implemented). If FAIL, fix the code change above before continuing.

- [ ] **Step 3: Commit**

```bash
git add functions/src/ai/__tests__/prompt-caching.test.ts
git commit -m "test(ai-anthropic): assert cache tokens propagate through callAgent"
```

### Task 8: Smoke-test Phase 1 end-to-end

- [ ] **Step 1: Deploy functions to Firebase**

Run: `firebase deploy --only functions:default:onAiJobCreated`
(Use codebase prefix per repo convention — see `CLAUDE.md` memory note about `functions:default:funcName`.)
Expected: deploy succeeds.

- [ ] **Step 2: Trigger a real program generation from the admin UI**

Open the AI Generate dialog, run a small program (2 weeks × 3 sessions). Watch the Firebase logs.
Expected: at the end of the run, you see a log line like
`[orchestrator:sync] Cache stats — writes: 12345, reads: 6789, hit rate: 35.4%`
On the very first run of a fresh function instance, writes will dominate and hit rate will be low. That is expected — system-prompt caching is already on, so any reads at all confirm the plumbing works.

- [ ] **Step 3: Verify the log row has cache columns populated**

Use `mcp__supabase__execute_sql`:

```sql
SELECT id, status, tokens_used, cache_creation_tokens, cache_read_tokens, duration_ms
FROM ai_generation_log
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `cache_creation_tokens` and `cache_read_tokens` are non-null integers.

- [ ] **Step 4: Commit a brief log of the baseline numbers (optional)**

If you want a record of pre-Phase-2 baseline, append a one-line note to a scratch file or paste into the PR description. No code change needed.

---

## Phase 2 — Cache the Agent 3 user-message prefix (the actual speed-up)

This is the change that delivers the latency win. The Exercise Selector retries 0-2 times per week with the same library/skeleton/constraints, and the program orchestrator does this for every week. Caching the stable prefix means attempts 2-3 cost ~10% of attempt 1 in input cost, and the Anthropic backend can return the cached prefix much faster.

### Task 9: Extend `callAgent` to accept a cached user prefix

**Files:**
- Modify: `functions/src/ai/anthropic.ts:130-152` and `:160-173`

The cleanest, lowest-blast-radius API: keep `userMessage: string` as the primary input, add an optional `cachedUserPrefix: string` that — when present — is sent as a separate content block with `cache_control: { type: "ephemeral" }` and is prepended to the user message at the SDK level. Default behavior unchanged.

- [ ] **Step 1: Add `cachedUserPrefix` to the options surface**

Find this block in [functions/src/ai/anthropic.ts:130-139](functions/src/ai/anthropic.ts#L130-L139):

```ts
function callAgentWithModel<T>(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    cacheSystemPrompt?: boolean
  },
): Promise<AgentCallResult<T>> {
```

Replace with:

```ts
function callAgentWithModel<T>(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    cacheSystemPrompt?: boolean
    /**
     * Optional stable prefix sent as a separately cached content block.
     * When set, the model sees: [cached prefix] + [userMessage].
     * Use for content that is identical across retries (e.g., exercise library, skeleton).
     * The block must be ≥ 1024 tokens to actually cache.
     */
    cachedUserPrefix?: string
  },
): Promise<AgentCallResult<T>> {
```

- [ ] **Step 2: Build the user content array when `cachedUserPrefix` is set**

Find this block in [functions/src/ai/anthropic.ts:158-173](functions/src/ai/anthropic.ts#L158-L173) (the tool_use path):

```ts
      if (toolSchema) {
        // ── Primary path: structured output via tool_use (streaming to avoid 10min timeout) ──
        const stream = client.messages.stream({
          model: modelId,
          max_tokens: maxTokens,
          system: systemContent,
          tools: [
            {
              name: "structured_output",
              description: "Output the structured result matching the required schema",
              input_schema: toolSchema,
            },
          ],
          tool_choice: { type: "tool" as const, name: "structured_output" },
          messages: [{ role: "user", content: userMessage }],
        })
```

Replace with:

```ts
      const userContent: Anthropic.Messages.ContentBlockParam[] | string = options?.cachedUserPrefix
        ? [
            {
              type: "text" as const,
              text: options.cachedUserPrefix,
              cache_control: { type: "ephemeral" as const },
            },
            { type: "text" as const, text: userMessage },
          ]
        : userMessage

      if (toolSchema) {
        // ── Primary path: structured output via tool_use (streaming to avoid 10min timeout) ──
        const stream = client.messages.stream({
          model: modelId,
          max_tokens: maxTokens,
          system: systemContent,
          tools: [
            {
              name: "structured_output",
              description: "Output the structured result matching the required schema",
              input_schema: toolSchema,
            },
          ],
          tool_choice: { type: "tool" as const, name: "structured_output" },
          messages: [{ role: "user", content: userContent }],
        })
```

- [ ] **Step 3: Use the same `userContent` in the text fallback path**

Find this block in [functions/src/ai/anthropic.ts:195-206](functions/src/ai/anthropic.ts#L195-L206):

```ts
        const stream = client.messages.stream({
          model: modelId,
          max_tokens: maxTokens,
          system: systemContent,
          messages: [
            {
              role: "user",
              content:
                userMessage + "\n\nYou MUST respond with valid JSON matching this schema. Output ONLY the JSON object.",
            },
          ],
        })
```

Replace with:

```ts
        const fallbackUserText =
          userMessage + "\n\nYou MUST respond with valid JSON matching this schema. Output ONLY the JSON object."
        const fallbackUserContent: Anthropic.Messages.ContentBlockParam[] | string = options?.cachedUserPrefix
          ? [
              {
                type: "text" as const,
                text: options.cachedUserPrefix,
                cache_control: { type: "ephemeral" as const },
              },
              { type: "text" as const, text: fallbackUserText },
            ]
          : fallbackUserText

        const stream = client.messages.stream({
          model: modelId,
          max_tokens: maxTokens,
          system: systemContent,
          messages: [{ role: "user", content: fallbackUserContent }],
        })
```

- [ ] **Step 4: Propagate the new option through the public `callAgent` wrapper**

Find this block in [functions/src/ai/anthropic.ts:260-282](functions/src/ai/anthropic.ts#L260-L282):

```ts
export async function callAgent<T>(
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    model?: string
    cacheSystemPrompt?: boolean
  },
): Promise<AgentCallResult<T>> {
  const modelId = options?.model ?? MODEL_SONNET

  try {
    return await callAgentWithModel(modelId, systemPrompt, userMessage, schema, options)
  } catch (error) {
    // If primary model exhausted all retries on a transient error, fall back to Haiku
    if (modelId !== MODEL_HAIKU && isTransientError(error)) {
      console.warn(`[callAgent] ${modelId} exhausted all retries — falling back to ${MODEL_HAIKU}`)
      return callAgentWithModel(MODEL_HAIKU, systemPrompt, userMessage, schema, options)
    }
    throw error
  }
}
```

Replace with:

```ts
export async function callAgent<T>(
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    model?: string
    cacheSystemPrompt?: boolean
    cachedUserPrefix?: string
  },
): Promise<AgentCallResult<T>> {
  const modelId = options?.model ?? MODEL_SONNET

  try {
    return await callAgentWithModel(modelId, systemPrompt, userMessage, schema, options)
  } catch (error) {
    // If primary model exhausted all retries on a transient error, fall back to Haiku
    if (modelId !== MODEL_HAIKU && isTransientError(error)) {
      console.warn(`[callAgent] ${modelId} exhausted all retries — falling back to ${MODEL_HAIKU}`)
      return callAgentWithModel(MODEL_HAIKU, systemPrompt, userMessage, schema, options)
    }
    throw error
  }
}
```

- [ ] **Step 5: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Add a test asserting cachedUserPrefix is sent as a separate cached block**

Append to `functions/src/ai/__tests__/prompt-caching.test.ts`:

```ts
describe("callAgent cachedUserPrefix", () => {
  beforeEach(() => {
    streamMock.mockReset()
  })

  it("sends cachedUserPrefix as a separate ephemeral content block", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    })

    const schema = z.object({ ok: z.boolean() })
    await callAgent("sys", "variable suffix", schema, {
      cachedUserPrefix: "stable library content".repeat(200),
    })

    expect(streamMock).toHaveBeenCalledOnce()
    const callArgs = streamMock.mock.calls[0][0]
    const userMsg = callArgs.messages[0]
    expect(userMsg.role).toBe("user")
    expect(Array.isArray(userMsg.content)).toBe(true)
    expect(userMsg.content[0].cache_control).toEqual({ type: "ephemeral" })
    expect(userMsg.content[0].text).toContain("stable library content")
    expect(userMsg.content[1].cache_control).toBeUndefined()
    expect(userMsg.content[1].text).toBe("variable suffix")
  })

  it("falls back to plain string when cachedUserPrefix is not set", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    })

    const schema = z.object({ ok: z.boolean() })
    await callAgent("sys", "user msg", schema)

    const callArgs = streamMock.mock.calls[0][0]
    expect(callArgs.messages[0].content).toBe("user msg")
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `cd functions && npx vitest run src/ai/__tests__/prompt-caching.test.ts`
Expected: all four tests pass.

- [ ] **Step 8: Commit**

```bash
git add functions/src/ai/anthropic.ts functions/src/ai/__tests__/prompt-caching.test.ts
git commit -m "feat(ai-anthropic): add cachedUserPrefix option for prompt-cached user content"
```

### Task 10: Refactor program-orchestrator Agent 3 user message into prefix + suffix

**Files:**
- Modify: `functions/src/ai/orchestrator.ts:634-643`

- [ ] **Step 1: Split the user message and pass `cachedUserPrefix`**

Find this block in [functions/src/ai/orchestrator.ts:634-643](functions/src/ai/orchestrator.ts#L634-L643):

```ts
        const agent3UserMessage = `Program Skeleton (Week ${weekNum} of ${skeleton.weeks.length}):\n${JSON.stringify(weekSkeletonPayload)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${thisWeekLibrary.length} exercises, pre-filtered for relevance):\n${thisWeekLibraryText}${poolNote}\n\n${priorContext.prompt_text}${coachInstructionsSection}${feedbackSection}${dedupFeedback}`

        try {
          console.log(`[orchestrator:sync] Week ${weekNum} attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
          const agent3Result: AgentCallResult<ExerciseAssignment> = await callAgent<ExerciseAssignment>(
            EXERCISE_SELECTOR_PROMPT,
            agent3UserMessage,
            exerciseAssignmentSchema,
            { cacheSystemPrompt: true },
          )
```

Replace with:

```ts
        // Stable prefix — identical across the 3 attempts for this week. Cache it.
        const agent3StablePrefix = `Program Skeleton (Week ${weekNum} of ${skeleton.weeks.length}):\n${JSON.stringify(weekSkeletonPayload)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${thisWeekLibrary.length} exercises, pre-filtered for relevance):\n${thisWeekLibraryText}${poolNote}\n\n${priorContext.prompt_text}${coachInstructionsSection}`
        // Variable suffix — only present on retries (attempt > 0).
        const agent3VariableSuffix = `${feedbackSection}${dedupFeedback}`.trim() || "Begin."

        try {
          console.log(`[orchestrator:sync] Week ${weekNum} attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
          const agent3Result: AgentCallResult<ExerciseAssignment> = await callAgent<ExerciseAssignment>(
            EXERCISE_SELECTOR_PROMPT,
            agent3VariableSuffix,
            exerciseAssignmentSchema,
            { cacheSystemPrompt: true, cachedUserPrefix: agent3StablePrefix },
          )
```

- [ ] **Step 2: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify existing orchestrator tests still pass**

Run: `cd functions && npx vitest run`
Expected: existing tests pass. If a test asserts the exact string of the Agent 3 user message, update the assertion to match the new prefix/suffix structure.

- [ ] **Step 4: Commit**

```bash
git add functions/src/ai/orchestrator.ts
git commit -m "feat(orchestrator): cache Agent 3 user-message prefix for retry hit rate"
```

### Task 11: Refactor week-orchestrator Exercise Selector user message

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts:806-815`

- [ ] **Step 1: Split the selector user message**

Find this block in [functions/src/ai/week-orchestrator.ts:803-815](functions/src/ai/week-orchestrator.ts#L803-L815):

```ts
    const coachInstructionsSection = buildCoachInstructionsSection(request.admin_instructions)
    const poolNote = buildPoolNote(poolIds, filtered.length, poolMode, poolIds?.length)

    const selectorMessage = `Program Skeleton (Week ${newWeekNumber}):\n${JSON.stringify(skeleton)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${filtered.length} exercises):\n${exerciseLibrary}\n\n${priorContext.prompt_text}${coachInstructionsSection}${poolNote}\n\nIMPORTANT: EVERY working exercise (compounds, accessories, isolations) MUST be DIFFERENT from prior weeks. Use the AVOID list above — do NOT reuse any exercise_id from that list. For compound slots, pick a DIFFERENT exercise that trains the SAME movement pattern and muscles. WARM-UP and COOL-DOWN slots may stay consistent.${feedbackSection}`

    try {
      console.log(`[week-orchestrator] Exercise selector attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
      const selectorResult = await callAgent<ExerciseAssignment>(
        EXERCISE_SELECTOR_PROMPT,
        selectorMessage,
        exerciseAssignmentSchema,
        { cacheSystemPrompt: true },
      )
```

Replace with:

```ts
    const coachInstructionsSection = buildCoachInstructionsSection(request.admin_instructions)
    const poolNote = buildPoolNote(poolIds, filtered.length, poolMode, poolIds?.length)

    // Stable prefix — identical across the 3 attempts. Cache it.
    const selectorStablePrefix = `Program Skeleton (Week ${newWeekNumber}):\n${JSON.stringify(skeleton)}\n\nConstraints:\n${constraintsContext}\n\nExercise Library (${filtered.length} exercises):\n${exerciseLibrary}\n\n${priorContext.prompt_text}${coachInstructionsSection}${poolNote}\n\nIMPORTANT: EVERY working exercise (compounds, accessories, isolations) MUST be DIFFERENT from prior weeks. Use the AVOID list above — do NOT reuse any exercise_id from that list. For compound slots, pick a DIFFERENT exercise that trains the SAME movement pattern and muscles. WARM-UP and COOL-DOWN slots may stay consistent.`
    // Variable suffix — feedback only present on retries.
    const selectorVariableSuffix = feedbackSection.trim() || "Begin."

    try {
      console.log(`[week-orchestrator] Exercise selector attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
      const selectorResult = await callAgent<ExerciseAssignment>(
        EXERCISE_SELECTOR_PROMPT,
        selectorVariableSuffix,
        exerciseAssignmentSchema,
        { cacheSystemPrompt: true, cachedUserPrefix: selectorStablePrefix },
      )
```

- [ ] **Step 2: Verify Typescript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Run existing week-orchestrator tests**

Run: `cd functions && npx vitest run src/ai/__tests__/week-orchestrator.test.ts`
Expected: all pass. The existing test stubs `callAgent` and doesn't assert on the message string, so it should be unaffected.

- [ ] **Step 4: Commit**

```bash
git add functions/src/ai/week-orchestrator.ts
git commit -m "feat(week-orchestrator): cache Exercise Selector user-message prefix"
```

### Task 12: End-to-end Phase 2 verification

- [ ] **Step 1: Deploy functions**

Run: `firebase deploy --only functions:default:onAiJobCreated`
Expected: deploy succeeds.

- [ ] **Step 2: Trigger a real program generation that forces at least one Agent 3 retry**

Generate a 4-week program for a client with constraints that make exercise selection harder (e.g., limited equipment + injuries). Watch the Firebase logs.

Expected log lines:
- Per-week retries: `[orchestrator:sync] Week N retrying...`
- Final cache stats with non-zero reads: `[orchestrator:sync] Cache stats — writes: ~X, reads: ~Y, hit rate: ~Z%` where Z is materially higher than the Phase 1 baseline.

- [ ] **Step 3: Trigger a week generation to validate the week path**

From the admin UI, "Generate next week" on an existing program. Confirm the function log shows `[week-orchestrator] Cache stats — ...` with cache reads > 0 (system prompt should hit cache from the program-gen run if within 5 minutes).

- [ ] **Step 4: Trigger a single-day generation to validate the day path**

From the admin UI, "Generate single day" on an empty day in a week. Confirm the function log shows cache stats and that the day was inserted correctly into `program_exercises`.

- [ ] **Step 5: Spot-check the generation logs in Supabase**

Use `mcp__supabase__execute_sql`:

```sql
SELECT
  id,
  duration_ms,
  tokens_used,
  cache_creation_tokens,
  cache_read_tokens,
  ROUND(100.0 * cache_read_tokens / NULLIF(cache_read_tokens + cache_creation_tokens, 0), 1) AS hit_rate_pct,
  created_at
FROM ai_generation_log
WHERE status = 'completed'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: hit_rate_pct is non-null and reasonable (≥ 30% for programs that retried, ≥ 15% for clean runs that only get system-prompt cache hits).

---

## Phase 3 — Optional follow-up: cross-week library stability for program orchestrator

**Status:** Documented for future work. Do NOT implement as part of this plan unless the user explicitly approves it after seeing Phase 2 results. It's a larger architectural change.

### Why it's separate

The program orchestrator currently calls `filterByProgressionPhase(filtered, clientDifficulty, weekNum)` inside the per-week loop at [functions/src/ai/orchestrator.ts:592](functions/src/ai/orchestrator.ts#L592), producing a different `thisWeekLibraryText` for every week. That means the Phase 2 cache breakpoint can only hit on retries within a single week, never across weeks.

### What it would change

1. Send the **full client-difficulty-filtered library once** as the cached prefix.
2. Move the "earned progression" gate from text filtering to a structured annotation appended to each week's variable suffix — e.g., `"This week (W${n}) only the following exercise IDs are unlocked: [...]. Do not use any others."`
3. The cache then hits for weeks 2, 3, …, N — saving ~50% input cost and ~30% latency on every subsequent week.

### Risks if you ever do Phase 3

- Model may ignore the textual "unlocked IDs" gate and pick a higher-tier exercise anyway. Post-hoc validation already catches this via `ceilingCheck`, but expect more validation-driven retries until prompts are tuned.
- The dedup `priorContext.prompt_text` still grows week-over-week, so it must stay in the variable suffix or the cache key invalidates anyway.
- Coach instructions must stay in the cached prefix (they're constant per program), but coach-pool note placement needs to be re-checked.

Track this as a separate plan: `docs/superpowers/plans/YYYY-MM-DD-cross-week-library-cache.md`.

---

## Self-Review Checklist (run before declaring this plan ready)

- [ ] **Spec coverage:** Every feature in the audit's "MUST keep working" list has at least one task that either touches it explicitly or is provably untouched. Specifically verified: tool_use streaming, text fallback, Haiku fallback, pRetry behavior, cancellation, RAG augmentation, exercise pool semantics, dedup retry loop, hallucinated-id stripping, single-day mode, fill-blank-week mode, log_quality_history, `ignore_profile` mode.
- [ ] **No placeholders:** All code blocks are complete and copy-pasteable. No "TODO", no "similar to above", no "add appropriate error handling".
- [ ] **Type consistency:** `AgentCallResult<T>` fields are spelled the same way in every file (`cache_creation_tokens`, `cache_read_tokens` — snake_case to match the existing `tokens_used` convention). Field names on `ai_generation_log` match the migration (`cache_creation_tokens`, `cache_read_tokens`). Vercel-SDK side uses `cacheCreationInputTokens` / `cacheReadInputTokens` only inside the SDK layer; the public `AgentCallResult` stays snake_case.
- [ ] **Non-targeted call sites are not touched.** All 17+ other `callAgent` consumers continue to work because the new `cachedUserPrefix` option is optional and unused by them.
- [ ] **Migration is idempotent** (`IF NOT EXISTS`) and adds nullable columns so existing rows aren't broken.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-ai-generation-prompt-caching.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
