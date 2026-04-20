# Starter AI Automation — Phase 4b: Video → Blog Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a transcribed video into a research-grounded, fact-checked blog draft in one click. New Firebase Function (`blogFromVideo`) chains: transcript read → Tavily research → Claude generation → Tavily fact-check → persist. Drafts land in `blog_posts` with a fact-check banner in the editor showing flagged claims.

**Architecture:** One Function owns the whole pipeline (in-process calls, not sub-jobs). Tavily research reuses the existing `buildResearchBrief` helper (extracted to a shared lib). Fact-check is a second new Function (`tavilyFactCheck`) that Claude-verifies generated content against the research brief; called in-process by `blogFromVideo`, and also dispatchable standalone via its own ai_jobs type. Schema: new JSONB column `blog_posts.fact_check_details`.

**Tech Stack:** Firebase Functions (2nd gen, `onDocumentCreated`), Supabase service-role client, Anthropic Claude via existing `callAgent()` in `functions/src/ai/anthropic.ts`, Tavily via existing `tavilySearch`/`tavilyExtract`, Vitest + @testing-library/react.

## Existing infrastructure this plan builds on (no changes)

- [functions/src/blog-generation.ts](../../../functions/src/blog-generation.ts) — reference pattern for structured Claude generation in Functions. DO NOT modify; we write a sibling Function.
- [functions/src/ai/anthropic.ts](../../../functions/src/ai/anthropic.ts) — `callAgent()` wrapper. Reused.
- [functions/src/lib/tavily.ts](../../../functions/src/lib/tavily.ts) — `tavilySearch`, `tavilyExtract`. Reused.
- [functions/src/lib/supabase.ts](../../../functions/src/lib/supabase.ts) — service-role client. Reused.
- [functions/src/tavily-research.ts](../../../functions/src/tavily-research.ts) — holds `buildResearchBrief` today; Task 2 extracts it to `functions/src/lib/research-brief.ts` without behavior change.
- [lib/ai-jobs.ts](../../../lib/ai-jobs.ts) — `blog_from_video` and `tavily_fact_check` already in the `AiJobType` union.
- [lib/db/video-uploads.ts](../../../lib/db/video-uploads.ts), [lib/db/video-transcripts.ts](../../../lib/db/video-transcripts.ts) — existing DALs.
- [lib/db/blog-posts.ts](../../../lib/db/blog-posts.ts) — reused; one new helper added in Task 5.
- [components/admin/blog/BlogGenerateDialog.tsx](../../../components/admin/blog/BlogGenerateDialog.tsx) — modified in Task 7.
- [components/admin/blog/BlogEditor.tsx](../../../components/admin/blog/BlogEditor.tsx) — modified in Task 8.
- Phase 4a's `ResearchPanel` — unchanged; `blog_posts.tavily_research` will be populated by `blogFromVideo` via the extracted `buildResearchBrief`, and 4a's panel will auto-render it with no code changes.

---

## File Structure

### Supabase migration (new)

- `supabase/migrations/00084_blog_posts_fact_check_details.sql` — adds `fact_check_details jsonb` column + partial index on `fact_check_status in ('flagged', 'failed')`.

### Shared Function lib (new + move)

- `functions/src/lib/research-brief.ts` — holds the pure helper `buildResearchBrief` + exported types `TavilyResearchBrief`, `BuildBriefParams`. Extracted verbatim from `tavily-research.ts`.
- `functions/src/tavily-research.ts` — re-exports `buildResearchBrief` and `TavilyResearchBrief` for backward compatibility (keeps Phase 4a tests working without edits).

### Firebase Functions (new)

- `functions/src/tavily-fact-check.ts` — `handleTavilyFactCheck(jobId)` orchestrator + pure helpers `buildFactCheckPrompt(content, brief, maxClaims)`, `classifyStatus(flaggedCount)`.
- `functions/src/blog-from-video.ts` — `handleBlogFromVideo(jobId)` orchestrator + pure helpers `deriveResearchTopic(videoTitle, transcript)`, `buildBlogUserMessage(transcript, brief, tone, length)`.

### Firebase Functions index (modify)

- `functions/src/index.ts` — register two new `onDocumentCreated` exports: `tavilyFactCheck` (type `tavily_fact_check`) with secrets `[anthropicApiKey, supabaseUrl, supabaseServiceRoleKey]`, and `blogFromVideo` (type `blog_from_video`) with secrets `[anthropicApiKey, tavilyApiKey, supabaseUrl, supabaseServiceRoleKey]`.

### Types (modify)

- `types/database.ts` — add `fact_check_details: Record<string, unknown> | null` field to the `BlogPost` type.

### Next.js API route (new)

- `app/api/admin/blog-posts/generate-from-video/route.ts` — POST that creates a placeholder draft `blog_posts` row + an ai_job.

### Next.js DAL (modify)

- `lib/db/blog-posts.ts` — add `createDraftForVideo({ authorId, videoUploadId })` helper returning `{ id }`.

### UI components (new + modify)

- `components/admin/blog/FactCheckBanner.tsx` (new) — top-of-editor banner, 3 states (hidden / flagged-amber / failed-red), click toggles open state.
- `components/admin/blog/FactCheckSidebar.tsx` (new) — right-column list of flagged claims; read-only.
- `components/admin/blog/BlogGenerateDialog.tsx` (modify) — add "From prompt" / "From video" tabs. "From video" shows a video picker (dropdown) + tone/length; submit calls the new route.
- `components/admin/blog/BlogEditor.tsx` (modify) — accept optional `factCheckStatus`, `factCheckDetails` props; render banner + sidebar.
- `components/admin/blog/BlogPostForm.tsx` (modify) — pass `post.fact_check_status` + `post.fact_check_details` into `BlogEditor`.

### Tests (new)

- `functions/src/__tests__/research-brief.test.ts` — relocated from `tavily-research.test.ts` tests that cover `buildResearchBrief` (keep `shouldPersist` in the old file).
- `functions/src/__tests__/tavily-fact-check.test.ts` — 3 pure-helper tests.
- `functions/src/__tests__/blog-from-video.test.ts` — 2 pure-helper tests.
- `__tests__/api/admin/blog-posts/generate-from-video.test.ts` — 5 route tests.
- `__tests__/components/fact-check-banner.test.tsx` — 4 state tests.
- `__tests__/components/fact-check-sidebar.test.tsx` — 3 render tests.
- `__tests__/components/blog-generate-dialog-from-video.test.tsx` — 3 integration tests.

---

## Tasks

### Task 1: Migration `00084` + BlogPost type update

**Files:**
- Create: `supabase/migrations/00084_blog_posts_fact_check_details.sql`
- Modify: `types/database.ts` — add `fact_check_details` field to `BlogPost` interface

- [ ] **Step 1: Create the migration**

File `supabase/migrations/00084_blog_posts_fact_check_details.sql`:

```sql
-- supabase/migrations/00084_blog_posts_fact_check_details.sql
-- Phase 4b — fact-check result details (flagged claims) stored alongside the
-- coarser fact_check_status enum added in migration 00080.

ALTER TABLE blog_posts
  ADD COLUMN fact_check_details jsonb;

CREATE INDEX idx_blog_posts_flagged_posts
  ON blog_posts(fact_check_status)
  WHERE fact_check_status IN ('flagged', 'failed');
```

- [ ] **Step 2: Apply migration via Supabase MCP**

The controller (you, or a follow-up pass) applies via Supabase MCP `apply_migration`. The subagent does NOT apply — it only writes the file and updates the type. Leave a comment in the commit to run the migration.

- [ ] **Step 3: Add `fact_check_details` to BlogPost type**

In `types/database.ts`, find the `BlogPost` interface (it has `tavily_research`, `fact_check_status`, `source_video_id`). After `fact_check_status`, add:

```typescript
fact_check_details: Record<string, unknown> | null
```

Preserve existing field order and comments.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors related to `BlogPost`. Pre-existing errors in `__tests__/` are unrelated.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00084_blog_posts_fact_check_details.sql types/database.ts
git commit -m "feat(blog): add fact_check_details jsonb column (migration 00084)"
```

---

### Task 2: Extract `buildResearchBrief` into shared lib

Refactor-only task. Keeps Phase 4a tests working unchanged via re-exports.

**Files:**
- Create: `functions/src/lib/research-brief.ts`
- Create: `functions/src/__tests__/research-brief.test.ts` (tests moved from tavily-research.test.ts)
- Modify: `functions/src/tavily-research.ts` (remove the helper + type; import + re-export from the new lib)
- Modify: `functions/src/__tests__/tavily-research.test.ts` (leave only the `shouldPersist` test)

- [ ] **Step 1: Create `functions/src/lib/research-brief.ts`**

```typescript
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
```

- [ ] **Step 2: Create the moved test file**

File `functions/src/__tests__/research-brief.test.ts` — same 2 tests for `buildResearchBrief` but imported from new path:

```typescript
import { describe, it, expect } from "vitest"
import { buildResearchBrief } from "../lib/research-brief.js"

describe("buildResearchBrief", () => {
  it("shapes Tavily output into the stored brief", () => {
    const brief = buildResearchBrief({
      topic: "shoulder rehab",
      search: {
        answer: "Top shoulder-rehab protocols mention...",
        results: [
          { title: "PubMed", url: "https://pubmed.example/a", content: "abc", score: 0.9, published_date: "2025-01-01" },
          { title: "JOSPT", url: "https://jospt.example/b", content: "def", score: 0.8, published_date: null },
        ],
      },
      extractedContent: [
        { url: "https://pubmed.example/a", content: "full page text" },
      ],
      generatedAt: "2026-04-20T10:00:00.000Z",
    })

    expect(brief.topic).toBe("shoulder rehab")
    expect(brief.summary).toBe("Top shoulder-rehab protocols mention...")
    expect(brief.results).toHaveLength(2)
    expect(brief.results[0]).toEqual({
      title: "PubMed",
      url: "https://pubmed.example/a",
      snippet: "abc",
      score: 0.9,
      published_date: "2025-01-01",
    })
    expect(brief.extracted).toEqual([{ url: "https://pubmed.example/a", content: "full page text" }])
    expect(brief.generated_at).toBe("2026-04-20T10:00:00.000Z")
  })

  it("handles null answer + empty extracts", () => {
    const brief = buildResearchBrief({
      topic: "x",
      search: { answer: null, results: [] },
      extractedContent: [],
      generatedAt: "2026-04-20T10:00:00.000Z",
    })
    expect(brief.summary).toBeNull()
    expect(brief.results).toEqual([])
    expect(brief.extracted).toEqual([])
  })
})
```

- [ ] **Step 3: Strip the helper from `functions/src/tavily-research.ts` + re-export**

The current file (post-4a) has `buildResearchBrief`, `shouldPersist`, and the two interfaces plus the orchestrator. Replace the top portion so it imports + re-exports:

```typescript
// functions/src/tavily-research.ts
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"
import { buildResearchBrief, type TavilyResearchBrief } from "./lib/research-brief.js"

// Re-export so downstream consumers (ResearchPanel test types, etc.) still work.
export { buildResearchBrief }
export type { TavilyResearchBrief }

export interface TavilyResearchInput {
  topic: string
  extract_top_n?: number
  search_depth?: "basic" | "advanced"
  blog_post_id?: string
}

export function shouldPersist(input: TavilyResearchInput): boolean {
  return typeof input.blog_post_id === "string" && input.blog_post_id.length > 0
}

export async function handleTavilyResearch(jobId: string): Promise<void> {
  // (unchanged — identical body to post-4a version)
```

DO NOT change `handleTavilyResearch`'s body. Leave the rest of the file untouched.

- [ ] **Step 4: Trim `functions/src/__tests__/tavily-research.test.ts`**

Remove the two `buildResearchBrief` tests. Keep ONLY the `shouldPersist` test. The imports should now be just `shouldPersist`:

```typescript
import { describe, it, expect } from "vitest"
import { shouldPersist } from "../tavily-research.js"

describe("tavily-research helpers", () => {
  it("shouldPersist returns true only when blog_post_id is a non-empty string", () => {
    expect(shouldPersist({ topic: "x" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "abc-123" })).toBe(true)
  })
})
```

- [ ] **Step 5: Run all Function tests**

```bash
npm --prefix functions test
```

Expected: 46 tests still pass (1 fewer in tavily-research, 2 more in research-brief — net same). If any regress, stop and investigate.

- [ ] **Step 6: Verify build**

```bash
npm --prefix functions run build
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add functions/src/lib/research-brief.ts functions/src/__tests__/research-brief.test.ts functions/src/tavily-research.ts functions/src/__tests__/tavily-research.test.ts
git commit -m "refactor(functions): extract buildResearchBrief into shared lib"
```

---

### Task 3: `tavilyFactCheck` Firebase Function

**Files:**
- Create: `functions/src/tavily-fact-check.ts`
- Create: `functions/src/__tests__/tavily-fact-check.test.ts`
- Modify: `functions/src/index.ts` (register new Function export)

- [ ] **Step 1: Write the failing test**

File `functions/src/__tests__/tavily-fact-check.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  buildFactCheckPrompt,
  classifyStatus,
  type FactCheckFlaggedClaim,
} from "../tavily-fact-check.js"

describe("tavily-fact-check helpers", () => {
  it("buildFactCheckPrompt embeds content + brief URLs under clear headings", () => {
    const prompt = buildFactCheckPrompt({
      content: "<p>Shoulder rehab takes 6 weeks.</p>",
      brief: {
        topic: "shoulder rehab",
        summary: "6-12 week timeline common",
        results: [
          { title: "PubMed", url: "https://pubmed.example/a", snippet: "s", score: 0.9, published_date: null },
        ],
        extracted: [{ url: "https://pubmed.example/a", content: "typical timeline is 8-12 weeks" }],
        generated_at: "2026-04-20T10:00:00.000Z",
      },
      maxClaims: 10,
    })
    expect(prompt).toContain("CONTENT TO FACT-CHECK")
    expect(prompt).toContain("Shoulder rehab takes 6 weeks.")
    expect(prompt).toContain("RESEARCH BRIEF")
    expect(prompt).toContain("https://pubmed.example/a")
    expect(prompt).toContain("typical timeline is 8-12 weeks")
    expect(prompt).toMatch(/max(imum)?\s+\d+\s+claims?/i)
  })

  it("classifyStatus returns 'passed' for empty, 'flagged' for 1-5, 'failed' for 6+", () => {
    expect(classifyStatus(0)).toBe("passed")
    expect(classifyStatus(1)).toBe("flagged")
    expect(classifyStatus(5)).toBe("flagged")
    expect(classifyStatus(6)).toBe("failed")
    expect(classifyStatus(99)).toBe("failed")
  })

  it("FactCheckFlaggedClaim shape: verdict is 'unverifiable' or 'contradicted' only", () => {
    const flagged: FactCheckFlaggedClaim = {
      claim: "x",
      span_start: null,
      span_end: null,
      source_urls_checked: [],
      verdict: "unverifiable",
      notes: "no matching source",
    }
    expect(flagged.verdict).toBe("unverifiable")
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm --prefix functions test -- tavily-fact-check
```

Expected: module not found.

- [ ] **Step 3: Create `functions/src/tavily-fact-check.ts`**

```typescript
// functions/src/tavily-fact-check.ts
// Firebase Function: verifies generated blog content against a research brief.
// Called standalone via type "tavily_fact_check" OR in-process from
// handleBlogFromVideo. Returns a list of flagged (unverifiable/contradicted)
// claims and a coarse fact_check_status.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import type { TavilyResearchBrief } from "./lib/research-brief.js"

export type FactCheckStatus = "passed" | "flagged" | "failed"

export interface FactCheckFlaggedClaim {
  claim: string
  span_start: number | null
  span_end: number | null
  source_urls_checked: string[]
  verdict: "unverifiable" | "contradicted"
  notes: string
}

export interface FactCheckDetails {
  flagged_claims: FactCheckFlaggedClaim[]
  generated_at: string
  model: string
}

export interface TavilyFactCheckInput {
  content: string
  brief: TavilyResearchBrief
  blog_post_id?: string
  max_claims?: number
}

export interface TavilyFactCheckResult {
  fact_check_status: FactCheckStatus
  details: FactCheckDetails
}

interface BuildPromptParams {
  content: string
  brief: TavilyResearchBrief
  maxClaims: number
}

export function buildFactCheckPrompt({ content, brief, maxClaims }: BuildPromptParams): string {
  const extractsSection = brief.extracted
    .map((e) => `SOURCE ${e.url}:\n${e.content.slice(0, 4000)}`)
    .join("\n\n")
  const resultsSection = brief.results
    .map((r) => `- ${r.title} (${r.url}) — ${r.snippet}`)
    .join("\n")

  return [
    "# CONTENT TO FACT-CHECK",
    content,
    "",
    "# RESEARCH BRIEF",
    `Topic: ${brief.topic}`,
    brief.summary ? `Summary: ${brief.summary}` : "",
    "",
    "## Sources",
    resultsSection,
    "",
    "## Extracted source content",
    extractsSection,
    "",
    "# INSTRUCTIONS",
    `Identify claims in the content that cannot be verified against the research brief above. Return a JSON array of flagged claims, max ${maxClaims} claims. Include only claims you can confidently mark as "unverifiable" (no supporting source) or "contradicted" (a source explicitly disagrees). Skip claims that are verified — do NOT include them.`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function classifyStatus(flaggedCount: number): FactCheckStatus {
  if (flaggedCount === 0) return "passed"
  if (flaggedCount <= 5) return "flagged"
  return "failed"
}

const FactCheckResponseSchema = z.object({
  flagged_claims: z.array(
    z.object({
      claim: z.string(),
      span_start: z.number().nullable(),
      span_end: z.number().nullable(),
      source_urls_checked: z.array(z.string()),
      verdict: z.enum(["unverifiable", "contradicted"]),
      notes: z.string(),
    }),
  ),
})

export async function runFactCheck(
  input: TavilyFactCheckInput,
): Promise<TavilyFactCheckResult> {
  const maxClaims = input.max_claims ?? 10
  const prompt = buildFactCheckPrompt({ content: input.content, brief: input.brief, maxClaims })

  const { data } = await callAgent({
    model: MODEL_SONNET,
    systemPrompt:
      "You are a rigorous fact-checker. Respond with a JSON object matching the schema the user requests. Do not fabricate sources.",
    userMessage: prompt,
    schema: FactCheckResponseSchema,
  })

  const flagged = data.flagged_claims.slice(0, maxClaims)
  const status = classifyStatus(flagged.length)

  return {
    fact_check_status: status,
    details: {
      flagged_claims: flagged,
      generated_at: new Date().toISOString(),
      model: MODEL_SONNET,
    },
  }
}

export async function handleTavilyFactCheck(jobId: string): Promise<void> {
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

    const input = data.input as TavilyFactCheckInput
    if (!input?.content || !input?.brief) {
      await failJob("input.content and input.brief are required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const result = await runFactCheck(input)

    if (input.blog_post_id) {
      const supabase = getSupabase()
      const { error: updateError } = await supabase
        .from("blog_posts")
        .update({
          fact_check_status: result.fact_check_status,
          fact_check_details: result.details,
        })
        .eq("id", input.blog_post_id)
      if (updateError) {
        console.error("[tavily-fact-check] blog_posts update failed:", updateError)
      }
    }

    await jobRef.update({
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown tavily-fact-check error")
  }
}
```

- [ ] **Step 4: Register the Function in `functions/src/index.ts`**

After the `tavilyResearch` export block (around line 227), add:

```typescript
// ─── Tavily Fact Check ────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "tavily_fact_check"

export const tavilyFactCheck = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 180,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_fact_check") return

    const { handleTavilyFactCheck } = await import("./tavily-fact-check.js")
    await handleTavilyFactCheck(event.params.jobId)
  },
)
```

- [ ] **Step 5: Run tests**

```bash
npm --prefix functions test -- tavily-fact-check
```

Expected: 3 tests pass.

- [ ] **Step 6: Build**

```bash
npm --prefix functions run build
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add functions/src/tavily-fact-check.ts functions/src/__tests__/tavily-fact-check.test.ts functions/src/index.ts
git commit -m "feat(functions): tavilyFactCheck verifies blog content against research brief"
```

---

### Task 4: `blogFromVideo` Firebase Function

**Files:**
- Create: `functions/src/blog-from-video.ts`
- Create: `functions/src/__tests__/blog-from-video.test.ts`
- Modify: `functions/src/index.ts` (register new Function export)

- [ ] **Step 1: Write the failing test**

File `functions/src/__tests__/blog-from-video.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { deriveResearchTopic, buildBlogUserMessage } from "../blog-from-video.js"

describe("blog-from-video helpers", () => {
  it("deriveResearchTopic prefers video title + uses transcript excerpt when short", () => {
    const topic = deriveResearchTopic({
      videoTitle: "Shoulder Rehab for Overhead Athletes",
      transcript: "Today we're working on rotator cuff mobility.",
    })
    expect(topic).toContain("Shoulder Rehab")
    expect(topic.length).toBeLessThanOrEqual(400)
  })

  it("deriveResearchTopic falls back to transcript when title is blank", () => {
    const topic = deriveResearchTopic({
      videoTitle: "",
      transcript: "Today we're working on scapular stabilization drills for throwing athletes.",
    })
    expect(topic.toLowerCase()).toContain("scapular")
  })

  it("buildBlogUserMessage embeds transcript + brief summary + tone + length under clear headings", () => {
    const msg = buildBlogUserMessage({
      transcript: "Scapular stabilization matters for overhead athletes.",
      brief: {
        topic: "shoulder rehab",
        summary: "Evidence supports progressive loading",
        results: [],
        extracted: [],
        generated_at: "2026-04-20T10:00:00.000Z",
      },
      tone: "professional",
      length: "medium",
      videoTitle: "Shoulder Rehab",
    })
    expect(msg).toContain("VIDEO TRANSCRIPT")
    expect(msg).toContain("Scapular stabilization")
    expect(msg).toContain("RESEARCH")
    expect(msg).toContain("Evidence supports progressive loading")
    expect(msg).toMatch(/tone.*professional/i)
    expect(msg).toMatch(/length.*medium/i)
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm --prefix functions test -- blog-from-video
```

Expected: module not found.

- [ ] **Step 3: Create `functions/src/blog-from-video.ts`**

```typescript
// functions/src/blog-from-video.ts
// Firebase Function: turn a transcribed video into a research-grounded,
// fact-checked blog draft. Owns the full pipeline in-process.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"
import { buildResearchBrief, type TavilyResearchBrief } from "./lib/research-brief.js"
import { runFactCheck } from "./tavily-fact-check.js"

export interface BlogFromVideoInput {
  video_upload_id: string
  blog_post_id: string
  tone: "professional" | "conversational" | "motivational"
  length: "short" | "medium" | "long"
}

interface DeriveTopicParams {
  videoTitle: string
  transcript: string
}

export function deriveResearchTopic({ videoTitle, transcript }: DeriveTopicParams): string {
  const title = videoTitle.trim()
  const excerpt = transcript.slice(0, 400).trim()
  if (title && excerpt) {
    return `${title} — ${excerpt}`.slice(0, 400)
  }
  return (title || excerpt).slice(0, 400)
}

interface BuildMessageParams {
  transcript: string
  brief: TavilyResearchBrief
  tone: string
  length: string
  videoTitle: string
}

export function buildBlogUserMessage({
  transcript,
  brief,
  tone,
  length,
  videoTitle,
}: BuildMessageParams): string {
  const sources = brief.results
    .slice(0, 5)
    .map((r) => `- ${r.title} (${r.url})`)
    .join("\n")

  return [
    `# VIDEO TITLE`,
    videoTitle,
    "",
    `# VIDEO TRANSCRIPT`,
    transcript,
    "",
    `# RESEARCH`,
    brief.summary ? `Summary: ${brief.summary}` : "(no summary available)",
    sources ? `\nSources:\n${sources}` : "",
    "",
    `# INSTRUCTIONS`,
    `Write a blog post. Tone: ${tone}. Length: ${length}. Use the video as the primary input and cite research URLs above where relevant. Output as the structured JSON schema the system prompt describes.`,
  ].join("\n")
}

const BlogGenerationSchema = z.object({
  title: z.string().max(200),
  slug: z.string().max(200),
  excerpt: z.string().min(10).max(500),
  content: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  meta_description: z.string().max(160),
})

export async function handleBlogFromVideo(jobId: string): Promise<void> {
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

    const input = data.input as BlogFromVideoInput
    if (!input?.video_upload_id || !input?.blog_post_id) {
      await failJob("input.video_upload_id and input.blog_post_id are required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const supabase = getSupabase()

    // 1. Read transcript + video
    const { data: videoRow, error: videoErr } = await supabase
      .from("video_uploads")
      .select("id, title")
      .eq("id", input.video_upload_id)
      .single()
    if (videoErr || !videoRow) {
      await failJob(`Video not found: ${videoErr?.message ?? "missing"}`)
      return
    }
    const { data: transcriptRow, error: trErr } = await supabase
      .from("video_transcripts")
      .select("transcript_text")
      .eq("video_upload_id", input.video_upload_id)
      .maybeSingle()
    if (trErr || !transcriptRow?.transcript_text) {
      await failJob("Video has no transcript")
      return
    }
    const transcript = transcriptRow.transcript_text as string
    const videoTitle = (videoRow.title as string) ?? ""

    // 2. Tavily research (best-effort; failure doesn't block generation)
    let brief: TavilyResearchBrief | null = null
    try {
      const topic = deriveResearchTopic({ videoTitle, transcript })
      const search = await tavilySearch({
        query: topic,
        search_depth: "basic",
        include_answer: true,
        max_results: 10,
      })
      let extracted: Array<{ url: string; content: string }> = []
      if (search.results.length > 0) {
        const urls = search.results.slice(0, 3).map((r) => r.url)
        const ext = await tavilyExtract({ urls })
        extracted = ext.results.map((r) => ({ url: r.url, content: r.raw_content }))
      }
      brief = buildResearchBrief({
        topic,
        search: { answer: search.answer ?? null, results: search.results },
        extractedContent: extracted,
        generatedAt: new Date().toISOString(),
      })
      await supabase.from("blog_posts").update({ tavily_research: brief }).eq("id", input.blog_post_id)
    } catch (err) {
      console.error("[blog-from-video] Tavily research failed:", err)
    }

    // 3. Claude generation
    const { data: generated } = await callAgent({
      model: MODEL_SONNET,
      systemPrompt: BLOG_SYSTEM_PROMPT,
      userMessage: buildBlogUserMessage({
        transcript,
        brief: brief ?? emptyBrief(deriveResearchTopic({ videoTitle, transcript })),
        tone: input.tone,
        length: input.length,
        videoTitle,
      }),
      schema: BlogGenerationSchema,
    })

    await supabase
      .from("blog_posts")
      .update({
        title: generated.title,
        slug: generated.slug,
        excerpt: generated.excerpt,
        content: generated.content,
        category: generated.category,
        tags: generated.tags,
        meta_description: generated.meta_description,
      })
      .eq("id", input.blog_post_id)

    // 4. Fact-check (skipped if research failed)
    let factCheckStatus: "pending" | "passed" | "flagged" | "failed" = "pending"
    if (brief) {
      try {
        const fc = await runFactCheck({
          content: generated.content,
          brief,
          blog_post_id: input.blog_post_id,
        })
        factCheckStatus = fc.fact_check_status
      } catch (err) {
        console.error("[blog-from-video] Fact-check failed:", err)
        factCheckStatus = "failed"
        await supabase
          .from("blog_posts")
          .update({ fact_check_status: "failed" })
          .eq("id", input.blog_post_id)
      }
    } else {
      await supabase.from("blog_posts").update({ fact_check_status: "pending" }).eq("id", input.blog_post_id)
    }

    await jobRef.update({
      status: "completed",
      result: {
        blog_post_id: input.blog_post_id,
        fact_check_status: factCheckStatus,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown blog-from-video error")
  }
}

function emptyBrief(topic: string): TavilyResearchBrief {
  return {
    topic,
    summary: null,
    results: [],
    extracted: [],
    generated_at: new Date().toISOString(),
  }
}

const BLOG_SYSTEM_PROMPT = `You are an expert content writer for DJP Athlete, a fitness coaching platform run by Darren Paul, a strength & conditioning coach. Write an evidence-based, practical, engaging blog post from a video transcript and research brief.

You must output a JSON object with: title (max 200), slug (lowercase, hyphens only, max 200), excerpt (10-500), content (semantic HTML using only h2/h3/p/ul/ol/li/blockquote/strong/em/u/a), category ("Performance" | "Recovery" | "Coaching" | "Youth Development"), tags (3-5 lowercase keywords), meta_description (max 160).

Use inline <a href="..."> source references where the research brief provides URLs. Never fabricate URLs. Do not use <h1> (the title serves that purpose).`
```

- [ ] **Step 4: Register the Function in `functions/src/index.ts`**

After the `tavilyFactCheck` export block, add:

```typescript
// ─── Blog From Video ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "blog_from_video"

export const blogFromVideo = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, tavilyApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "blog_from_video") return

    const { handleBlogFromVideo } = await import("./blog-from-video.js")
    await handleBlogFromVideo(event.params.jobId)
  },
)
```

- [ ] **Step 5: Run tests + build**

```bash
npm --prefix functions test -- blog-from-video
npm --prefix functions run build
```

Expected: 3 tests pass, build exits 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/blog-from-video.ts functions/src/__tests__/blog-from-video.test.ts functions/src/index.ts
git commit -m "feat(functions): blogFromVideo orchestrates transcript->research->generate->fact-check"
```

---

### Task 5: Next.js API route `/api/admin/blog-posts/generate-from-video`

**Files:**
- Create: `app/api/admin/blog-posts/generate-from-video/route.ts`
- Create: `__tests__/api/admin/blog-posts/generate-from-video.test.ts`
- Modify: `lib/db/blog-posts.ts` (add `createDraftForVideo` helper)

- [ ] **Step 1: Add the DAL helper**

In `lib/db/blog-posts.ts`, add after `getBlogPostById`:

```typescript
export async function createDraftForVideo(params: {
  authorId: string
  videoUploadId: string
}): Promise<{ id: string }> {
  const supabase = getClient()
  const now = Date.now()
  const { data, error } = await supabase
    .from("blog_posts")
    .insert({
      title: "Generating from video…",
      slug: `generating-${now}`,
      content: "",
      excerpt: "",
      category: "Performance",
      tags: [],
      author_id: params.authorId,
      source_video_id: params.videoUploadId,
      status: "draft",
    })
    .select("id")
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id }
}
```

- [ ] **Step 2: Write the failing test**

File `__tests__/api/admin/blog-posts/generate-from-video.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getVideoUploadByIdMock = vi.fn()
const getTranscriptForVideoMock = vi.fn()
const createDraftForVideoMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (x: string) => getVideoUploadByIdMock(x),
}))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptForVideo: (x: string) => getTranscriptForVideoMock(x),
}))
vi.mock("@/lib/db/blog-posts", () => ({
  createDraftForVideo: (x: unknown) => createDraftForVideoMock(x),
}))

import { POST } from "@/app/api/admin/blog-posts/generate-from-video/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/blog-posts/generate-from-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/blog-posts/generate-from-video", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ video_upload_id: "v1" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when video_upload_id is missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when video does not exist", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ video_upload_id: "v1" }))
    expect(res.status).toBe(404)
  })

  it("returns 409 when transcript is missing", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", title: "t" })
    getTranscriptForVideoMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ video_upload_id: "v1" }))
    expect(res.status).toBe(409)
  })

  it("creates draft + ai_job and returns 202", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", title: "t" })
    getTranscriptForVideoMock.mockResolvedValue({ transcript_text: "hello" })
    createDraftForVideoMock.mockResolvedValue({ id: "bp-99" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(
      makeRequest({ video_upload_id: "v1", tone: "professional", length: "medium" }),
    )
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.blog_post_id).toBe("bp-99")

    expect(createDraftForVideoMock).toHaveBeenCalledWith({
      authorId: "admin-1",
      videoUploadId: "v1",
    })
    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "blog_from_video",
      userId: "admin-1",
      input: {
        video_upload_id: "v1",
        blog_post_id: "bp-99",
        tone: "professional",
        length: "medium",
      },
    })
  })
})
```

- [ ] **Step 3: Run → FAIL**

```bash
npm run test:run -- __tests__/api/admin/blog-posts/generate-from-video.test.ts
```

Expected: module not found.

- [ ] **Step 4: Create `app/api/admin/blog-posts/generate-from-video/route.ts`**

```typescript
// app/api/admin/blog-posts/generate-from-video/route.ts
// POST { video_upload_id, tone?, length? } — creates a placeholder blog draft +
// fires a blog_from_video ai_job. The Firebase Function fills in the draft.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createDraftForVideo } from "@/lib/db/blog-posts"

const ALLOWED_TONES = ["professional", "conversational", "motivational"] as const
const ALLOWED_LENGTHS = ["short", "medium", "long"] as const
type Tone = (typeof ALLOWED_TONES)[number]
type Length = (typeof ALLOWED_LENGTHS)[number]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    video_upload_id?: string
    tone?: string
    length?: string
  } | null
  const videoUploadId = body?.video_upload_id
  if (!videoUploadId) {
    return NextResponse.json({ error: "video_upload_id is required" }, { status: 400 })
  }
  const tone: Tone = (ALLOWED_TONES as readonly string[]).includes(body?.tone ?? "")
    ? (body!.tone as Tone)
    : "professional"
  const length: Length = (ALLOWED_LENGTHS as readonly string[]).includes(body?.length ?? "")
    ? (body!.length as Length)
    : "medium"

  const upload = await getVideoUploadById(videoUploadId)
  if (!upload) {
    return NextResponse.json({ error: "Video upload not found" }, { status: 404 })
  }

  const transcript = await getTranscriptForVideo(videoUploadId)
  if (!transcript) {
    return NextResponse.json(
      { error: "Video has no transcript yet — run Transcribe first" },
      { status: 409 },
    )
  }

  const draft = await createDraftForVideo({
    authorId: session.user.id,
    videoUploadId,
  })

  const { jobId, status } = await createAiJob({
    type: "blog_from_video",
    userId: session.user.id,
    input: {
      video_upload_id: videoUploadId,
      blog_post_id: draft.id,
      tone,
      length,
    },
  })

  return NextResponse.json({ jobId, status, blog_post_id: draft.id }, { status: 202 })
}
```

- [ ] **Step 5: Run → PASS**

```bash
npm run test:run -- __tests__/api/admin/blog-posts/generate-from-video.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/blog-posts/generate-from-video/route.ts __tests__/api/admin/blog-posts/generate-from-video.test.ts lib/db/blog-posts.ts
git commit -m "feat(api): POST /api/admin/blog-posts/generate-from-video"
```

---

### Task 6: `FactCheckBanner` + `FactCheckSidebar` components

**Files:**
- Create: `components/admin/blog/FactCheckBanner.tsx`
- Create: `components/admin/blog/FactCheckSidebar.tsx`
- Create: `__tests__/components/fact-check-banner.test.tsx`
- Create: `__tests__/components/fact-check-sidebar.test.tsx`

- [ ] **Step 1: Write failing tests (banner)**

File `__tests__/components/fact-check-banner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FactCheckBanner } from "@/components/admin/blog/FactCheckBanner"

describe("FactCheckBanner", () => {
  it("renders nothing for status=passed", () => {
    const { container } = render(<FactCheckBanner status="passed" flaggedCount={0} open={false} onToggle={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for status=pending", () => {
    const { container } = render(<FactCheckBanner status="pending" flaggedCount={0} open={false} onToggle={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders amber flagged banner with count", () => {
    render(<FactCheckBanner status="flagged" flaggedCount={3} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/3 claims flagged/i)).toBeInTheDocument()
  })

  it("renders red failed banner", () => {
    render(<FactCheckBanner status="failed" flaggedCount={7} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/fact-check failed/i)).toBeInTheDocument()
  })

  it("clicking the banner toggles open", () => {
    const onToggle = vi.fn()
    render(<FactCheckBanner status="flagged" flaggedCount={2} open={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onToggle).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write failing tests (sidebar)**

File `__tests__/components/fact-check-sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FactCheckSidebar, type FactCheckFlaggedClaim } from "@/components/admin/blog/FactCheckSidebar"

const claim1: FactCheckFlaggedClaim = {
  claim: "Shoulder rehab takes 6 weeks.",
  span_start: null,
  span_end: null,
  source_urls_checked: ["https://pubmed.example/a"],
  verdict: "contradicted",
  notes: "Source says typical timeline is 8-12 weeks.",
}

const claim2: FactCheckFlaggedClaim = {
  claim: "Everyone needs 10k steps a day.",
  span_start: null,
  span_end: null,
  source_urls_checked: [],
  verdict: "unverifiable",
  notes: "No source for the exact 10k figure.",
}

describe("FactCheckSidebar", () => {
  it("renders one row per flagged claim with verdict + notes + source links", () => {
    render(<FactCheckSidebar claims={[claim1, claim2]} onClose={vi.fn()} />)
    expect(screen.getByText(/shoulder rehab takes 6 weeks/i)).toBeInTheDocument()
    expect(screen.getByText(/contradicted/i)).toBeInTheDocument()
    expect(screen.getByText(/8-12 weeks/i)).toBeInTheDocument()
    expect(screen.getByText(/unverifiable/i)).toBeInTheDocument()
    expect(screen.getByText("pubmed.example")).toBeInTheDocument()
  })

  it("renders empty state when no claims", () => {
    render(<FactCheckSidebar claims={[]} onClose={vi.fn()} />)
    expect(screen.getByText(/no flagged claims/i)).toBeInTheDocument()
  })

  it("Dismiss strikes through claim locally", () => {
    render(<FactCheckSidebar claims={[claim1]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }))
    const claimText = screen.getByText(/shoulder rehab takes 6 weeks/i)
    expect(claimText.className).toMatch(/line-through/)
  })
})
```

- [ ] **Step 3: Run → FAIL**

```bash
npm run test:run -- __tests__/components/fact-check-banner.test.tsx __tests__/components/fact-check-sidebar.test.tsx
```

Expected: module not found.

- [ ] **Step 4: Create `components/admin/blog/FactCheckBanner.tsx`**

```tsx
"use client"

import { AlertTriangle, AlertOctagon, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type FactCheckStatus = "pending" | "passed" | "flagged" | "failed"

interface FactCheckBannerProps {
  status: FactCheckStatus
  flaggedCount: number
  open: boolean
  onToggle: () => void
}

export function FactCheckBanner({ status, flaggedCount, open, onToggle }: FactCheckBannerProps) {
  if (status === "passed" || status === "pending") return null

  const isFailed = status === "failed"
  const Icon = isFailed ? AlertOctagon : AlertTriangle

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border",
        isFailed
          ? "bg-error/10 border-error/30 text-error"
          : "bg-warning/10 border-warning/30 text-warning",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 text-left">
        {isFailed
          ? "Fact-check failed — manual review recommended"
          : `${flaggedCount} claim${flaggedCount === 1 ? "" : "s"} flagged — review before publishing`}
      </span>
      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  )
}
```

- [ ] **Step 5: Create `components/admin/blog/FactCheckSidebar.tsx`**

```tsx
"use client"

import { useState } from "react"
import { X, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

export interface FactCheckFlaggedClaim {
  claim: string
  span_start: number | null
  span_end: number | null
  source_urls_checked: string[]
  verdict: "unverifiable" | "contradicted"
  notes: string
}

interface FactCheckSidebarProps {
  claims: FactCheckFlaggedClaim[]
  onClose: () => void
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function FactCheckSidebar({ claims, onClose }: FactCheckSidebarProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  return (
    <aside
      className="w-80 shrink-0 border-l border-border bg-surface/50 flex flex-col overflow-hidden"
      aria-label="Fact-check sidebar"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-primary">Flagged claims</div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-primary"
          aria-label="Close fact-check sidebar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flagged claims.</p>
        ) : (
          claims.map((c, i) => {
            const isDismissed = dismissed.has(i)
            return (
              <div
                key={i}
                className={cn(
                  "border border-border rounded-md bg-card p-3 text-sm",
                  isDismissed && "opacity-60",
                )}
              >
                <blockquote className={cn("italic text-primary", isDismissed && "line-through")}>
                  {c.claim}
                </blockquote>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full font-medium",
                      c.verdict === "contradicted"
                        ? "bg-error/10 text-error"
                        : "bg-warning/10 text-warning",
                    )}
                  >
                    {c.verdict}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{c.notes}</p>
                {c.source_urls_checked.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {c.source_urls_checked.map((u) => (
                      <li key={u} className="text-xs">
                        <a
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          {domainOf(u)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {!isDismissed && (
                  <button
                    type="button"
                    onClick={() => setDismissed((s) => new Set(s).add(i))}
                    className="mt-2 text-xs text-muted-foreground hover:text-primary"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: Run → PASS**

```bash
npm run test:run -- __tests__/components/fact-check-banner.test.tsx __tests__/components/fact-check-sidebar.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/admin/blog/FactCheckBanner.tsx components/admin/blog/FactCheckSidebar.tsx __tests__/components/fact-check-banner.test.tsx __tests__/components/fact-check-sidebar.test.tsx
git commit -m "feat(ui): FactCheckBanner + FactCheckSidebar for flagged claims"
```

---

### Task 7: BlogGenerateDialog — "From video" tab

**Files:**
- Modify: `components/admin/blog/BlogGenerateDialog.tsx`
- Create: `__tests__/components/blog-generate-dialog-from-video.test.tsx`

- [ ] **Step 1: Write failing test**

File `__tests__/components/blog-generate-dialog-from-video.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({
    status: "pending", result: null, error: null, text: "", chunks: [],
    analysis: null, programCreated: null, messageId: null, activeTools: [], reset: vi.fn(),
  }),
}))

import { BlogGenerateDialog } from "@/components/admin/blog/BlogGenerateDialog"

describe("BlogGenerateDialog — From video tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/admin/videos?status=transcribed") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            videos: [{ id: "v1", title: "Shoulder Rehab", created_at: "2026-04-01" }],
          }),
        })
      }
      if (url === "/api/admin/blog-posts/generate-from-video") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ jobId: "job-1", blog_post_id: "bp-9" }),
        })
      }
      return Promise.reject(new Error("unexpected url " + url))
    })
  })

  it("renders tabs and defaults to From prompt", () => {
    render(<BlogGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /from prompt/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /from video/i })).toBeInTheDocument()
  })

  it("switching to From video fetches transcribed videos and shows picker", async () => {
    render(<BlogGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from video/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/videos?status=transcribed")
    })
    expect(await screen.findByText(/shoulder rehab/i)).toBeInTheDocument()
  })

  it("submitting From video POSTs to /generate-from-video", async () => {
    render(<BlogGenerateDialog open={true} onOpenChange={vi.fn()} onGenerated={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /from video/i }))
    await screen.findByText(/shoulder rehab/i)
    fireEvent.click(screen.getByText(/shoulder rehab/i))
    fireEvent.click(screen.getByRole("button", { name: /generate from video/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/blog-posts/generate-from-video",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm run test:run -- __tests__/components/blog-generate-dialog-from-video.test.tsx
```

Expected: FAIL — tabs / video picker UI doesn't exist yet.

- [ ] **Step 3: Add tabs + From-video mode to `BlogGenerateDialog.tsx`**

Read the current file first. Find:
- The dialog `<DialogContent>` wrapping the whole form
- The state for the prompt/tone/length
- The submit handler

Add at the top of the component:

```typescript
const [mode, setMode] = useState<"prompt" | "video">("prompt")
const [videos, setVideos] = useState<Array<{ id: string; title: string; created_at: string }>>([])
const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
const router = useRouter()  // only if not already imported

useEffect(() => {
  if (mode !== "video" || !open) return
  let cancelled = false
  fetch("/api/admin/videos?status=transcribed")
    .then((r) => r.json())
    .then((body: { videos: Array<{ id: string; title: string; created_at: string }> }) => {
      if (!cancelled) setVideos(body.videos)
    })
    .catch(() => undefined)
  return () => {
    cancelled = true
  }
}, [mode, open])
```

Near the top of the dialog body (inside `<DialogContent>`), add the tab strip — use two simple buttons styled as tabs:

```tsx
<div className="flex border-b border-border mb-4">
  <button
    type="button"
    role="tab"
    onClick={() => setMode("prompt")}
    className={cn(
      "px-4 py-2 text-sm font-medium border-b-2",
      mode === "prompt" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
    )}
  >
    From prompt
  </button>
  <button
    type="button"
    role="tab"
    onClick={() => setMode("video")}
    className={cn(
      "px-4 py-2 text-sm font-medium border-b-2",
      mode === "video" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
    )}
  >
    From video
  </button>
</div>
```

Gate the existing form body with `{mode === "prompt" && (...)}` and add a new branch:

```tsx
{mode === "video" && (
  <div className="space-y-4">
    <div>
      <label className="text-sm font-medium">Pick a transcribed video</label>
      <ul className="mt-2 border border-border rounded-md divide-y divide-border max-h-60 overflow-y-auto">
        {videos.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">No transcribed videos yet.</li>
        )}
        {videos.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setSelectedVideoId(v.id)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-surface/50",
                selectedVideoId === v.id && "bg-primary/5",
              )}
            >
              <div className="font-medium text-primary">{v.title}</div>
              <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>

    {/* Reuse existing tone/length controls here — pull them out of the prompt mode block if needed */}

    <button
      type="button"
      disabled={!selectedVideoId}
      onClick={async () => {
        if (!selectedVideoId) return
        const res = await fetch("/api/admin/blog-posts/generate-from-video", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ video_upload_id: selectedVideoId, tone, length }),
        })
        if (res.ok) {
          const body = (await res.json()) as { jobId: string; blog_post_id: string }
          onOpenChange(false)
          router.push(`/admin/blog/${body.blog_post_id}/edit`)
        }
      }}
      className={cn(
        "w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-white font-medium",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      Generate from video
    </button>
  </div>
)}
```

Tone + length controls remain unchanged and visible in both tabs (they live above or between the tab-gated content — lift them out of the prompt-only branch if needed).

- [ ] **Step 4: Ensure `/api/admin/videos?status=transcribed` exists**

Check `app/api/admin/videos/route.ts`. If a `GET` handler with status-filter support doesn't exist, add it — but scope is narrow: just return `{ videos: VideoUpload[] }` filtered by `status`. This is a small additive change. If the route doesn't exist at all, **escalate as BLOCKED** — the plan presumes it does.

- [ ] **Step 5: Run → PASS**

```bash
npm run test:run -- __tests__/components/blog-generate-dialog-from-video.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/admin/blog/BlogGenerateDialog.tsx __tests__/components/blog-generate-dialog-from-video.test.tsx app/api/admin/videos/route.ts
git commit -m "feat(ui): BlogGenerateDialog — From video tab + video picker"
```

---

### Task 8: BlogEditor integration — banner + sidebar

**Files:**
- Modify: `components/admin/blog/BlogEditor.tsx`
- Modify: `components/admin/blog/BlogPostForm.tsx`

- [ ] **Step 1: Read both files**

Understand current `BlogEditor` props + how `BlogPostForm` uses it.

- [ ] **Step 2: Extend `BlogEditor` to accept fact-check props**

Add to `BlogEditorProps`:

```typescript
factCheckStatus?: "pending" | "passed" | "flagged" | "failed" | null
factCheckDetails?: {
  flagged_claims?: Array<{
    claim: string
    span_start: number | null
    span_end: number | null
    source_urls_checked: string[]
    verdict: "unverifiable" | "contradicted"
    notes: string
  }>
} | null
```

At the top of the component body, add state:

```typescript
const [sidebarOpen, setSidebarOpen] = useState(false)
const factCheckStatus = props.factCheckStatus ?? "pending"
const flaggedClaims = props.factCheckDetails?.flagged_claims ?? []
```

Wrap the editor + banner + sidebar so the whole thing is a flex column with the banner above, editor + optional sidebar in a flex row below. Use the same pattern Task 4 of 4a established in `BlogPostForm`:

```tsx
return (
  <div className="flex flex-col gap-3">
    <FactCheckBanner
      status={factCheckStatus}
      flaggedCount={flaggedClaims.length}
      open={sidebarOpen}
      onToggle={() => setSidebarOpen((o) => !o)}
    />
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="flex-1 min-w-0">
        {/* existing editor JSX here */}
      </div>
      {sidebarOpen && (
        <FactCheckSidebar claims={flaggedClaims} onClose={() => setSidebarOpen(false)} />
      )}
    </div>
  </div>
)
```

Import `FactCheckBanner`, `FactCheckSidebar` at the top of the file.

- [ ] **Step 3: Pass props from `BlogPostForm.tsx`**

Find the `<BlogEditor ... />` render in `BlogPostForm.tsx` and add:

```tsx
<BlogEditor
  content={content}
  onChange={setContent}
  factCheckStatus={post?.fact_check_status ?? null}
  factCheckDetails={post?.fact_check_details as FactCheckDetails | null}
/>
```

Where `FactCheckDetails` is imported from `./FactCheckSidebar` (export the type from there):

In `FactCheckSidebar.tsx`, add `export` to the type:
```typescript
export interface FactCheckDetails {
  flagged_claims: FactCheckFlaggedClaim[]
  generated_at?: string
  model?: string
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "BlogEditor|BlogPostForm|FactCheck" | head
```

Expected: no errors related to these files.

- [ ] **Step 5: Run all tests**

```bash
npm run test:run -- __tests__/components/fact-check-banner.test.tsx __tests__/components/fact-check-sidebar.test.tsx __tests__/components/blog-generate-dialog-from-video.test.tsx __tests__/components/research-panel.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/admin/blog/BlogEditor.tsx components/admin/blog/BlogPostForm.tsx components/admin/blog/FactCheckSidebar.tsx
git commit -m "feat(ui): BlogEditor renders fact-check banner + sidebar"
```

---

### Task 9: Post-Phase-4b verification

- [ ] **Step 1: Full Next.js test suite**

```bash
npm run test:run
```

Expected: Phase 4b's new tests all pass. Pre-existing failures (21 from before) are unchanged. If new failures appear in files Phase 4b didn't touch, stop and investigate.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Functions build + tests**

```bash
npm --prefix functions run build
npm --prefix functions test
```

Expected: build 0; tests all pass (46 + new ones).

- [ ] **Step 4: Apply migration 00084 via Supabase MCP**

Controller applies. Verify with `list_migrations` afterward.

- [ ] **Step 5: Push branch**

```bash
git push origin feature/starter-ai-automation
```

- [ ] **Step 6: Deploy new Firebase Functions**

```bash
firebase deploy --only functions:tavilyFactCheck,functions:blogFromVideo
```

- [ ] **Step 7: Smoke test**

1. Upload + transcribe a real video (existing flow).
2. Open `/admin/blog`, click "New post with AI".
3. Click "From video" tab. Pick the transcribed video. Submit.
4. Confirm redirect to `/admin/blog/[id]/edit`. Page should load with draft title "Generating from video…" and empty content.
5. Watch `ai_jobs/{jobId}` in Firestore — status should transition pending → processing → completed within ~60s.
6. Refresh the editor page. Confirm title/slug/content/tags/category/excerpt all populated; research brief visible via the Research panel (Phase 4a).
7. If any claims flagged: banner shows at top with count; clicking expands sidebar with claims + source URLs.
8. Re-run by picking a different video → creates a new draft row (does NOT overwrite).

---

## What Phase 4b Unblocks / Concludes

- **Phase 4c** can hook into `blog_posts` publish events and auto-draft newsletters from the fully-populated post (title, content, fact-check status).
- **Phase 4d** reads `fact_check_details` + `tavily_research` + `source_video_id` for SEO enrichment (schema.org `videoObject` pointer if sourced from video; inline citation markup from verified claims).

---

## Self-Review

**Spec coverage:**

- ✅ `generateBlogFromVideo` Function orchestrator → Task 4
- ✅ `tavilyFactCheck` Function → Task 3
- ✅ Migration for `fact_check_details` → Task 1
- ✅ Shared `buildResearchBrief` extraction → Task 2
- ✅ Route + DAL helper → Task 5
- ✅ Banner + sidebar components → Task 6
- ✅ BlogGenerateDialog "From video" tab → Task 7
- ✅ BlogEditor integration → Task 8
- ✅ Tests: Function helpers, route, component → Tasks 3/4/5/6/7
- ✅ Manual smoke → Task 9 step 7

**Placeholder scan:** no TODOs, no "similar to X", every code step has full code or explicit merge instructions.

**Type consistency:** `FactCheckFlaggedClaim` is defined in `tavily-fact-check.ts` (Function side) and `FactCheckSidebar.tsx` (UI side) with identical shape. `FactCheckDetails` is the wrapper. `TavilyResearchBrief` lives in `functions/src/lib/research-brief.ts` (single source of truth after Task 2) and is used by Function orchestrators + ResearchPanel UI (Phase 4a re-exports for compat).

**Dependency knowns:**
- Task 7's video picker assumes `GET /api/admin/videos?status=transcribed`. If that doesn't exist, Task 7 Step 4 adds it (narrow, additive). If it's already there with a different shape, adapt the parser in the dialog — don't change the route.
- Task 8 assumes `FactCheckDetails` type is exportable from `FactCheckSidebar.tsx`. The export is added in Task 8 Step 3.
- The migration (Task 1 Step 2) is applied by the controller, not the subagent.
