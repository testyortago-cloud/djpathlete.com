# Blog Generation Quality — Phase 2: SEO-First Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work directly on `main` (no feature branch — solo dev).

**Goal:** Stop generating blog posts SEO-blind. Every generation request now declares a `primary_keyword`, optional `secondary_keywords[]`, and optional `search_intent`. The handler injects a `# SEO TARGET` block into the system prompt, tightens the title/excerpt length ranges, runs a single re-prompt if word count comes in too short, and persists the keyword fields on the new `blog_posts` row. Topic-suggestion route auto-proposes a primary keyword via a small Claude call so the one-click "Generate draft" path stays one click.

**Architecture:** Three new layers added to the existing pipeline. (1) A `primary_keyword TEXT` + `secondary_keywords TEXT[]` + `search_intent TEXT` column triplet on `blog_posts` (additive, all nullable/defaulted, no backfill). (2) Two new tiny modules in `functions/src/blog/`: `length-verifier.ts` (word-count check + expansion-prompt builder) and `keyword-proposal.ts` (Claude call to extract a 2-6 word noun phrase from a topic title + summary). (3) `composeBlogSystemPrompt` extended to accept an optional `seoTarget` arg and render a `# SEO TARGET` block when present. The handler reads SEO inputs, composes, calls `callAgent`, then runs the length verifier; one re-prompt if too short, otherwise proceed. API routes accept the new fields; the dialog adds a required Primary Keyword input plus optional Secondary Keywords tags and Search Intent radio.

**Tech Stack:** Firebase Functions Gen 2 (Node 22), `@anthropic-ai/sdk`, `@supabase/supabase-js`, Zod, NextAuth v5, Next.js 16 App Router, Vitest, Tailwind v4, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-03-blog-generation-quality-design.md](../specs/2026-05-03-blog-generation-quality-design.md) — D3 (SEO target), D4 (length verifier), D11 (readability rules — already in `00108` row, no change here), and the title/excerpt length tightening called out in D3.

**Migration apply:** Use `mcp__supabase__apply_migration` (not `npx supabase db push` — CLI is not linked).

---

## File Structure

### New files (Functions side)
- `functions/src/blog/length-verifier.ts` — `countWords(html)`, `LENGTH_PRESETS`, `isTooShort(actual, target)`, `buildExpansionPrompt(currentDraft, target, h2List)`
- `functions/src/blog/__tests__/length-verifier.test.ts`
- `functions/src/blog/keyword-proposal.ts` — `proposePrimaryKeyword(input: { title; summary? }): Promise<string>` — Claude Sonnet call returning 2-6 word noun phrase
- `functions/src/blog/__tests__/keyword-proposal.test.ts`

### New files (Next.js side)
- `supabase/migrations/00110_blog_seo_targets.sql`

### Modified files (Functions side)
- `functions/src/blog/voice-context.ts` — `composeBlogSystemPrompt` accepts `seoTarget?: SeoTarget`; render `# SEO TARGET` block when present
- `functions/src/blog/__tests__/voice-context.test.ts` — new tests for the SEO block
- `functions/src/blog-generation.ts` — read `primary_keyword`/`secondary_keywords`/`search_intent`/`target_word_count` from input; tighten title/excerpt Zod ranges; pass `seoTarget` to composer; run length verifier; persist new columns to `blog_posts` insert
- `functions/src/__tests__/blog-generation.test.ts` — fixtures + new tests for SEO injection and length verifier branches

### Modified files (Next.js side)
- `app/api/admin/blog/generate/route.ts` — accept `primary_keyword` (required), `secondary_keywords[]` (optional), `search_intent` (optional), `target_word_count` (optional)
- `app/api/admin/blog/generate-from-suggestion/route.ts` — call `proposePrimaryKeyword()` when topic metadata has no keyword; pass through to handler input
- `__tests__/api/admin/blog/generate-from-suggestion.test.ts` — assert proposed keyword lands in jobSet input
- `lib/validators/blog-post.ts` — add `primary_keyword` (nullable string), `secondary_keywords` (string array), `search_intent` (enum), all optional on the form schema for backward compat
- `types/database.ts` — `BlogPost` interface gains the three fields
- `components/admin/blog/BlogGenerateDialog.tsx` — required Primary Keyword text input, Secondary Keywords tag input (max 5), Search Intent 3-button segmented control, submit-disabled when keyword missing
- `components/admin/blog/BlogPostForm.tsx` — display + edit the three SEO fields under a "SEO targets" collapsible section

### Unchanged but referenced
- `00108_blog_generation_prompt_template.sql` — the structural row; readability rules already live there. No update needed for Phase 2.
- `lib/db/blog-posts.ts` — DAL uses `select("*")`, so additive columns flow through automatically. Verify in Task 9 only.

---

## Task 1: Migration `00110_blog_seo_targets.sql`

**Files:**
- Create: `supabase/migrations/00110_blog_seo_targets.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/00110_blog_seo_targets.sql
-- Phase 2 of blog-generation-quality rollout.
-- Adds SEO target columns so the generator can write to a declared keyword
-- and the renderer (Phase 3+) can validate keyword density / coverage.
-- All columns are additive and nullable/defaulted — legacy posts unaffected.

ALTER TABLE blog_posts
  ADD COLUMN primary_keyword text,
  ADD COLUMN secondary_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN search_intent text
    CHECK (search_intent IN ('informational', 'commercial', 'transactional'));

CREATE INDEX idx_blog_posts_primary_keyword ON blog_posts(primary_keyword);

COMMENT ON COLUMN blog_posts.primary_keyword IS
  'Target search keyword for the post; required on AI generations after Phase 2 deploy, NULL on legacy posts.';
COMMENT ON COLUMN blog_posts.secondary_keywords IS
  'Up to 5 supporting keywords distributed across body sections.';
COMMENT ON COLUMN blog_posts.search_intent IS
  'informational | commercial | transactional. Drives title formula and CTA selection.';
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `blog_seo_targets` and the SQL above (without the comment header line — the migration tool expects pure SQL).

- [ ] **Step 3: Verify the schema**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'blog_posts'
  AND column_name IN ('primary_keyword', 'secondary_keywords', 'search_intent')
ORDER BY column_name;
```
Expected: 3 rows, `primary_keyword text YES NULL`, `secondary_keywords ARRAY NO '{}'`, `search_intent text YES NULL`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00110_blog_seo_targets.sql
git commit -m "feat(blog): add SEO target columns to blog_posts (phase 2)"
```

---

## Task 2: Update Next.js validators + types

**Files:**
- Modify: `lib/validators/blog-post.ts`
- Modify: `types/database.ts`

- [ ] **Step 1: Extend `blogPostFormSchema`**

Open `lib/validators/blog-post.ts`. After the `meta_description` field and before `inline_images`, add:

```ts
primary_keyword: z
  .string()
  .max(120, "Primary keyword must be under 120 characters")
  .nullable()
  .optional()
  .transform((v) => v || null),
secondary_keywords: z
  .array(z.string().max(120))
  .max(5, "At most 5 secondary keywords")
  .optional()
  .default([]),
search_intent: z
  .enum(["informational", "commercial", "transactional"])
  .nullable()
  .optional()
  .transform((v) => v || null),
```

The schema stays backward compatible — legacy posts without these fields parse fine.

- [ ] **Step 2: Extend `BlogPost` interface**

Open `types/database.ts`. The `BlogPost` interface starts around line 734. Inside it, after `inline_images`, add:

```ts
primary_keyword: string | null
secondary_keywords: string[]
search_intent: "informational" | "commercial" | "transactional" | null
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(blog-post|database\\.ts)" | head -20`
Expected: no new errors. Pre-existing test-file errors elsewhere in the repo are unrelated.

- [ ] **Step 4: Commit**

```bash
git add lib/validators/blog-post.ts types/database.ts
git commit -m "feat(types): add primary_keyword/secondary_keywords/search_intent to BlogPost (phase 2)"
```

---

## Task 3: Extend `composeBlogSystemPrompt` to render an SEO TARGET block

**Files:**
- Modify: `functions/src/blog/voice-context.ts`
- Modify: `functions/src/blog/__tests__/voice-context.test.ts`

- [ ] **Step 1: Add the new tests**

Open `functions/src/blog/__tests__/voice-context.test.ts`. Inside the existing `describe("composeBlogSystemPrompt", ...)` block, add three new tests:

```ts
it("renders SEO TARGET block when seoTarget is provided", () => {
  const out = composeBlogSystemPrompt({
    voiceProfile: "v",
    blogStructure: "s",
    programsBlock: "p",
    register: "casual",
    seoTarget: {
      primary_keyword: "youth pitching velocity",
      secondary_keywords: ["arm care", "long toss"],
      search_intent: "informational",
    },
  })
  expect(out).toContain("# SEO TARGET")
  expect(out).toContain("Primary keyword: youth pitching velocity")
  expect(out).toContain("Secondary keywords: arm care, long toss")
  expect(out).toContain("Search intent: informational")
})

it("omits the SEO TARGET block when seoTarget is undefined", () => {
  const out = composeBlogSystemPrompt({
    voiceProfile: "v",
    blogStructure: "s",
    programsBlock: "p",
    register: "casual",
  })
  expect(out).not.toContain("# SEO TARGET")
})

it("omits the SEO TARGET block when seoTarget has no primary_keyword", () => {
  const out = composeBlogSystemPrompt({
    voiceProfile: "v",
    blogStructure: "s",
    programsBlock: "p",
    register: "casual",
    seoTarget: { primary_keyword: "", secondary_keywords: [], search_intent: null },
  })
  expect(out).not.toContain("# SEO TARGET")
})
```

- [ ] **Step 2: Run the tests and confirm 2 fail**

Run: `cd functions && npx vitest run src/blog/__tests__/voice-context.test.ts`
Expected: First test fails (no SEO TARGET block); second test passes by accident (no SEO TARGET because feature unbuilt); third test fails (TypeScript error: seoTarget arg not in ComposeArgs).

(Don't worry if the order/specifics differ — the point is to see at least one failure proving the feature isn't built yet.)

- [ ] **Step 3: Implement in `voice-context.ts`**

Open `functions/src/blog/voice-context.ts`. Add a new exported type after `Register`:

```ts
export interface SeoTarget {
  primary_keyword: string
  secondary_keywords: string[]
  search_intent: "informational" | "commercial" | "transactional" | null
}
```

Extend `ComposeArgs`:

```ts
export interface ComposeArgs {
  voiceProfile: string
  blogStructure: string
  programsBlock: string
  register: Register
  seoTarget?: SeoTarget
}
```

Add a helper before `composeBlogSystemPrompt`:

```ts
function formatSeoTargetBlock(target: SeoTarget | undefined): string {
  if (!target || !target.primary_keyword) return ""
  const lines = [
    "# SEO TARGET",
    `Primary keyword: ${target.primary_keyword}`,
  ]
  if (target.secondary_keywords.length > 0) {
    lines.push(`Secondary keywords: ${target.secondary_keywords.join(", ")}`)
  }
  if (target.search_intent) {
    lines.push(`Search intent: ${target.search_intent}`)
  }
  lines.push("")
  lines.push("Rules:")
  lines.push("- Primary keyword MUST appear in: title (within first 60 chars), the first 100 words of intro, exactly one h2, and the conclusion.")
  lines.push("- Secondary keywords distributed across body sections — no stuffing.")
  lines.push("- Title formula: pick numbered list, how-to, vs/comparison, year-stamped, or contrarian-take based on intent.")
  lines.push("- Title length: 50-60 chars.")
  lines.push("- Excerpt length: 140-180 chars and MUST include the primary keyword.")
  return lines.join("\n")
}
```

Update `composeBlogSystemPrompt` to inject the block between PROGRAMS and REGISTER:

```ts
export function composeBlogSystemPrompt(args: ComposeArgs): string {
  const registerBlock =
    args.register === "formal"
      ? "# REGISTER\nFormal. Tighten contractions. Lean on data and citations. Fewer first-person interjections."
      : "# REGISTER\nCasual. Use contractions. Conversational asides allowed. Address the reader directly. Default."

  const seoBlock = formatSeoTargetBlock(args.seoTarget)

  const sections = [
    "# VOICE",
    args.voiceProfile,
    "",
    args.programsBlock,
  ]
  if (seoBlock) {
    sections.push("", seoBlock)
  }
  sections.push("", registerBlock, "", args.blogStructure)
  return sections.join("\n")
}
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/blog/__tests__/voice-context.test.ts`
Expected: 14 tests pass (11 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/voice-context.ts functions/src/blog/__tests__/voice-context.test.ts
git commit -m "feat(blog): composeBlogSystemPrompt accepts seoTarget arg (phase 2)"
```

---

## Task 4: Add `length-verifier.ts` helper

**Files:**
- Create: `functions/src/blog/length-verifier.ts`
- Test: `functions/src/blog/__tests__/length-verifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/src/blog/__tests__/length-verifier.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  countWords,
  LENGTH_PRESETS,
  isTooShort,
  buildExpansionPrompt,
  resolveTargetWordCount,
} from "../length-verifier.js"

describe("length-verifier", () => {
  describe("countWords", () => {
    it("counts words in plain HTML", () => {
      expect(countWords("<p>One two three four five</p>")).toBe(5)
    })

    it("strips tags before counting", () => {
      expect(countWords("<h2>Heading</h2><p>One <strong>two</strong> three</p>")).toBe(4)
    })

    it("handles multiple whitespace and newlines", () => {
      expect(countWords("<p>One\n\n  two\tthree</p>")).toBe(3)
    })

    it("returns 0 for empty input", () => {
      expect(countWords("")).toBe(0)
      expect(countWords("<p></p>")).toBe(0)
    })

    it("ignores HTML attributes", () => {
      expect(countWords('<a href="https://x.com">link text</a>')).toBe(2)
    })
  })

  describe("LENGTH_PRESETS", () => {
    it("maps short/medium/long to canonical word counts", () => {
      expect(LENGTH_PRESETS.short).toBe(500)
      expect(LENGTH_PRESETS.medium).toBe(1000)
      expect(LENGTH_PRESETS.long).toBe(1500)
    })
  })

  describe("resolveTargetWordCount", () => {
    it("returns explicit target when provided", () => {
      expect(resolveTargetWordCount({ target_word_count: 1200 })).toBe(1200)
    })

    it("falls back to length preset", () => {
      expect(resolveTargetWordCount({ length: "long" })).toBe(1500)
    })

    it("defaults to medium when neither is provided", () => {
      expect(resolveTargetWordCount({})).toBe(1000)
    })

    it("explicit target_word_count wins over length", () => {
      expect(resolveTargetWordCount({ length: "short", target_word_count: 1800 })).toBe(1800)
    })
  })

  describe("isTooShort", () => {
    it("returns true when actual is more than 25% under target", () => {
      expect(isTooShort(700, 1000)).toBe(true)  // 30% under
    })

    it("returns false when actual is within 25% of target", () => {
      expect(isTooShort(800, 1000)).toBe(false) // 20% under — accept
      expect(isTooShort(900, 1000)).toBe(false)
      expect(isTooShort(1100, 1000)).toBe(false) // over is fine
    })

    it("returns false when actual exceeds target", () => {
      expect(isTooShort(2000, 1500)).toBe(false)
    })
  })

  describe("buildExpansionPrompt", () => {
    it("includes the actual and target word counts", () => {
      const out = buildExpansionPrompt({
        currentHtml: "<p>short draft</p>",
        actualWordCount: 600,
        targetWordCount: 1500,
        h2List: ["Why this matters", "How to apply it"],
      })
      expect(out).toContain("600")
      expect(out).toContain("1500")
    })

    it("lists the section headings to expand", () => {
      const out = buildExpansionPrompt({
        currentHtml: "<p>x</p>",
        actualWordCount: 500,
        targetWordCount: 1000,
        h2List: ["Recovery basics", "When to deload"],
      })
      expect(out).toContain("Recovery basics")
      expect(out).toContain("When to deload")
    })

    it("instructs to keep title/slug/category unchanged", () => {
      const out = buildExpansionPrompt({
        currentHtml: "<p>x</p>",
        actualWordCount: 500,
        targetWordCount: 1000,
        h2List: [],
      })
      expect(out.toLowerCase()).toContain("do not change")
    })
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd functions && npx vitest run src/blog/__tests__/length-verifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `length-verifier.ts`**

Create `functions/src/blog/length-verifier.ts`:

```ts
// functions/src/blog/length-verifier.ts
// Word-count utilities for blog generation. Used by handleBlogGeneration to
// decide whether the first AI pass came in too short and a single expansion
// re-prompt should run.

export const LENGTH_PRESETS = {
  short: 500,
  medium: 1000,
  long: 1500,
} as const

export type LengthPreset = keyof typeof LENGTH_PRESETS

const SHORTFALL_THRESHOLD = 0.75 // accept anything ≥ 75% of target

/**
 * Strip HTML tags and count whitespace-separated tokens. Cheap and good
 * enough — we don't need linguistic precision, just an order-of-magnitude
 * check.
 */
export function countWords(html: string): number {
  if (!html) return 0
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return 0
  return text.split(" ").length
}

export function resolveTargetWordCount(input: {
  target_word_count?: number
  length?: string
}): number {
  if (typeof input.target_word_count === "number" && input.target_word_count > 0) {
    return input.target_word_count
  }
  const preset = input.length as LengthPreset | undefined
  if (preset && preset in LENGTH_PRESETS) return LENGTH_PRESETS[preset]
  return LENGTH_PRESETS.medium
}

export function isTooShort(actualWordCount: number, targetWordCount: number): boolean {
  if (targetWordCount <= 0) return false
  return actualWordCount / targetWordCount < SHORTFALL_THRESHOLD
}

export interface ExpansionPromptArgs {
  currentHtml: string
  actualWordCount: number
  targetWordCount: number
  h2List: string[]
}

export function buildExpansionPrompt(args: ExpansionPromptArgs): string {
  const sections =
    args.h2List.length > 0
      ? args.h2List.map((s) => `- ${s}`).join("\n")
      : "- (use the existing h2 sections in the draft)"
  return `The draft below is too short — ${args.actualWordCount} words against a ${args.targetWordCount}-word target. Expand the following sections with deeper coaching detail, an additional concrete example, or a sub-point that adds value (not filler):

${sections}

Constraints:
- Do not change the title, slug, excerpt, category, tags, or meta_description fields. Output the same JSON shape with all those fields identical to the draft.
- Only expand the content field.
- Maintain the existing voice and structural rules.

Current draft:
${args.currentHtml}`
}
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/blog/__tests__/length-verifier.test.ts`
Expected: 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/length-verifier.ts functions/src/blog/__tests__/length-verifier.test.ts
git commit -m "feat(blog): add length-verifier helper for one-shot expansion re-prompt (phase 2)"
```

---

## Task 5: Add `keyword-proposal.ts` helper

**Files:**
- Create: `functions/src/blog/keyword-proposal.ts`
- Test: `functions/src/blog/__tests__/keyword-proposal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/src/blog/__tests__/keyword-proposal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCallAgent = vi.hoisted(() => vi.fn())

vi.mock("../../ai/anthropic.js", () => ({
  callAgent: mockCallAgent,
  MODEL_SONNET: "claude-sonnet-test",
}))

import { proposePrimaryKeyword, fallbackKeywordFromTitle } from "../keyword-proposal.js"

describe("keyword-proposal", () => {
  describe("fallbackKeywordFromTitle", () => {
    it("trims and lowercases the title to a 2-6 word phrase", () => {
      expect(fallbackKeywordFromTitle("How to Improve Pitching Velocity for Youth Athletes")).toBe(
        "improve pitching velocity for youth athletes",
      )
    })

    it("strips punctuation and clamps to 6 words", () => {
      expect(fallbackKeywordFromTitle("The Coach's Guide to Comeback, Recovery, and Sleep!")).toBe(
        "coachs guide to comeback recovery and",
      )
    })

    it("removes common stopword prefixes", () => {
      expect(fallbackKeywordFromTitle("The Best Way to Throw a Slider")).toBe(
        "best way to throw a slider",
      )
      expect(fallbackKeywordFromTitle("How to Build Rotational Power")).toBe(
        "build rotational power",
      )
    })

    it("returns the input lowercased when too short for stopword stripping", () => {
      expect(fallbackKeywordFromTitle("Sprint mechanics")).toBe("sprint mechanics")
    })

    it("returns empty string for empty input", () => {
      expect(fallbackKeywordFromTitle("")).toBe("")
    })
  })

  describe("proposePrimaryKeyword", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("returns the Claude-proposed keyword on success", async () => {
      mockCallAgent.mockResolvedValue({
        content: { primary_keyword: "youth pitching velocity training" },
        tokens_used: 50,
      })
      const result = await proposePrimaryKeyword({
        title: "How young pitchers can throw harder safely",
        summary: "Recent research on long-toss programs and velocity gains.",
      })
      expect(result).toBe("youth pitching velocity training")
      expect(mockCallAgent).toHaveBeenCalledTimes(1)
    })

    it("falls back to title-derived keyword when Claude throws", async () => {
      mockCallAgent.mockRejectedValue(new Error("rate limit"))
      const result = await proposePrimaryKeyword({
        title: "How to Build Rotational Power",
      })
      expect(result).toBe("build rotational power")
      expect(mockCallAgent).toHaveBeenCalledTimes(1)
    })

    it("falls back when Claude returns empty string", async () => {
      mockCallAgent.mockResolvedValue({
        content: { primary_keyword: "" },
        tokens_used: 50,
      })
      const result = await proposePrimaryKeyword({
        title: "Sprint mechanics for soccer",
      })
      expect(result).toBe("sprint mechanics for soccer")
    })

    it("returns empty string when title is empty and Claude returns nothing", async () => {
      mockCallAgent.mockResolvedValue({
        content: { primary_keyword: "" },
        tokens_used: 50,
      })
      const result = await proposePrimaryKeyword({ title: "" })
      expect(result).toBe("")
    })
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd functions && npx vitest run src/blog/__tests__/keyword-proposal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `keyword-proposal.ts`**

Create `functions/src/blog/keyword-proposal.ts`:

```ts
// functions/src/blog/keyword-proposal.ts
// Cheap Claude call (Sonnet, ~50 tokens out) that extracts a 2-6 word
// search-intent noun phrase from a topic title + optional Tavily summary.
// Falls back to a deterministic title-stripping function on any error.

import { z } from "zod"
import { callAgent, MODEL_SONNET } from "../ai/anthropic.js"

const SYSTEM_PROMPT = `You extract the primary search keyword from a blog topic. Return a 2-6 word noun phrase that someone would type into Google to find this content. Lowercase, no punctuation, no quotes. Skip stopwords like "the", "how to", "best".

Examples:
- Title: "How young pitchers can throw harder safely" → "youth pitching velocity"
- Title: "The 6-week return-to-play protocol after ACL surgery" → "acl return to play protocol"
- Title: "Why progressive overload still works in 2026" → "progressive overload training"

Output ONLY a JSON object: { "primary_keyword": "<the phrase>" }.`

const proposalSchema = z.object({
  primary_keyword: z.string().max(120),
})

const STOPWORD_PREFIXES = ["the ", "a ", "an ", "how to "]

/**
 * Title-derived fallback: strip punctuation, lowercase, drop a common
 * stopword prefix, clamp to 6 words. Deterministic — runs on any title
 * even when Claude is unavailable.
 */
export function fallbackKeywordFromTitle(title: string): string {
  if (!title) return ""
  let t = title.toLowerCase().replace(/[^\w\s]/g, "").trim()
  for (const prefix of STOPWORD_PREFIXES) {
    if (t.startsWith(prefix) && t.split(/\s+/).length > prefix.trim().split(/\s+/).length) {
      t = t.slice(prefix.length).trim()
      break
    }
  }
  return t.split(/\s+/).slice(0, 6).join(" ")
}

export interface ProposeKeywordInput {
  title: string
  summary?: string
}

export async function proposePrimaryKeyword(input: ProposeKeywordInput): Promise<string> {
  const userMessage = [
    `Title: ${input.title}`,
    input.summary ? `Summary: ${input.summary}` : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const result = await callAgent(SYSTEM_PROMPT, userMessage, proposalSchema, {
      model: MODEL_SONNET,
      maxTokens: 200,
    })
    const proposed = result.content.primary_keyword.trim()
    if (proposed.length > 0) return proposed
    return fallbackKeywordFromTitle(input.title)
  } catch (err) {
    console.warn(`[keyword-proposal] Claude call failed, falling back to title strip: ${(err as Error).message}`)
    return fallbackKeywordFromTitle(input.title)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/blog/__tests__/keyword-proposal.test.ts`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/keyword-proposal.ts functions/src/blog/__tests__/keyword-proposal.test.ts
git commit -m "feat(blog): add keyword-proposal helper for topic-suggestion auto-propose (phase 2)"
```

---

## Task 6: Refactor `blog-generation.ts` to integrate Phase 2 features

**Files:**
- Modify: `functions/src/blog-generation.ts`
- Modify: `functions/src/__tests__/blog-generation.test.ts`

This is the biggest task. The handler reads SEO inputs, passes them to the composer, calls the model, then runs the length verifier with one re-prompt if needed, then persists the new columns.

- [ ] **Step 1: Add new mocks to the test file**

Open `functions/src/__tests__/blog-generation.test.ts`. Extend the `vi.hoisted` block with two more mocks:

```ts
const {
  mockCallAgent,
  mockGetFirestore,
  mockGetSupabase,
  mockFetchResearchPapers,
  mockLoadVoiceContext,
  mockComposeBlogSystemPrompt,
  mockCountWords,
  mockIsTooShort,
} = vi.hoisted(() => {
  return {
    mockCallAgent: vi.fn(),
    mockGetFirestore: vi.fn(),
    mockGetSupabase: vi.fn(),
    mockFetchResearchPapers: vi.fn().mockResolvedValue({ papers: [], source: "none", duration_ms: 0 }),
    mockLoadVoiceContext: vi.fn().mockResolvedValue({
      voiceProfile: "TEST_VOICE",
      blogStructure: "TEST_STRUCTURE",
      fewShots: [],
      usedFallback: { voice: false, structure: false },
    }),
    mockComposeBlogSystemPrompt: vi.fn(() => "COMPOSED_PROMPT"),
    mockCountWords: vi.fn(() => 1000),
    mockIsTooShort: vi.fn(() => false),
  }
})
```

Update the `vi.mock("../blog/voice-context.js", ...)` call to use the hoisted compose mock:

```ts
vi.mock("../blog/voice-context.js", () => ({
  loadVoiceContext: mockLoadVoiceContext,
  composeBlogSystemPrompt: mockComposeBlogSystemPrompt,
  formatFewShotsForUserMessage: vi.fn(() => ""),
}))
```

Add a new mock for length-verifier:

```ts
vi.mock("../blog/length-verifier.js", () => ({
  countWords: mockCountWords,
  isTooShort: mockIsTooShort,
  resolveTargetWordCount: vi.fn(() => 1000),
  buildExpansionPrompt: vi.fn(() => "EXPANSION_PROMPT"),
  LENGTH_PRESETS: { short: 500, medium: 1000, long: 1500 },
}))
```

In `beforeEach`, restore all defaults after `vi.clearAllMocks()`:

```ts
beforeEach(() => {
  vi.clearAllMocks()
  mockLoadVoiceContext.mockResolvedValue({
    voiceProfile: "TEST_VOICE",
    blogStructure: "TEST_STRUCTURE",
    fewShots: [],
    usedFallback: { voice: false, structure: false },
  })
  mockComposeBlogSystemPrompt.mockReturnValue("COMPOSED_PROMPT")
  mockCountWords.mockReturnValue(1000)
  mockIsTooShort.mockReturnValue(false)
  // ... existing fixture setup continues here
})
```

- [ ] **Step 2: Update the existing happy-path test fixture**

Add the SEO fields to the input fixture:

```ts
input: {
  prompt: "Test prompt",
  register: "casual",
  length: "medium",
  primary_keyword: "youth pitching velocity",
  secondary_keywords: ["arm care"],
  search_intent: "informational",
  userId: "user-1",
  sourceCalendarId: "cal-1",
},
```

The blog_posts insert mock should expect the new fields too. Update the existing assertion that inspects `blogInsert` call args, OR add a new assertion (whichever is cleaner in the existing test):

```ts
expect(blogInsert).toHaveBeenCalledWith(
  expect.objectContaining({
    primary_keyword: "youth pitching velocity",
    secondary_keywords: ["arm care"],
    search_intent: "informational",
  }),
)
```

- [ ] **Step 3: Add two new tests for the length verifier branches**

Inside the existing `describe("handleBlogGeneration — insert flow", ...)` block:

```ts
it("does NOT re-prompt when first pass meets target word count", async () => {
  mockCountWords.mockReturnValue(1000)
  mockIsTooShort.mockReturnValue(false)
  mockCallAgent.mockResolvedValue({
    content: {
      title: "T",
      slug: "t",
      excerpt: "e",
      content: "<p>1000-word draft</p>",
      category: "Performance",
      tags: ["a"],
      meta_description: "m",
    },
    tokens_used: 100,
  })
  await handleBlogGeneration("job-1")
  expect(mockCallAgent).toHaveBeenCalledTimes(1)
})

it("runs ONE expansion re-prompt when first pass is too short", async () => {
  mockIsTooShort
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false) // expansion result is acceptable
  mockCountWords
    .mockReturnValueOnce(600)   // first pass: 600 words
    .mockReturnValueOnce(1100)  // expanded pass: 1100 words

  const baseDraft = {
    title: "T",
    slug: "t",
    excerpt: "e",
    content: "<p>short</p>",
    category: "Performance" as const,
    tags: ["a"],
    meta_description: "m",
  }

  mockCallAgent
    .mockResolvedValueOnce({ content: baseDraft, tokens_used: 100 })
    .mockResolvedValueOnce({
      content: { ...baseDraft, content: "<p>expanded much longer draft</p>" },
      tokens_used: 200,
    })

  await handleBlogGeneration("job-1")
  expect(mockCallAgent).toHaveBeenCalledTimes(2)
  // The second call's user message should be the expansion prompt
  expect(mockCallAgent).toHaveBeenNthCalledWith(2, "COMPOSED_PROMPT", "EXPANSION_PROMPT", expect.anything(), expect.anything())
})

it("does NOT re-prompt twice even if expansion still too short", async () => {
  mockIsTooShort.mockReturnValue(true) // both passes flagged short
  mockCountWords.mockReturnValue(700)
  mockCallAgent.mockResolvedValue({
    content: {
      title: "T",
      slug: "t",
      excerpt: "e",
      content: "<p>still short</p>",
      category: "Performance",
      tags: ["a"],
      meta_description: "m",
    },
    tokens_used: 100,
  })
  await handleBlogGeneration("job-1")
  expect(mockCallAgent).toHaveBeenCalledTimes(2) // initial + ONE expansion, no third
})
```

- [ ] **Step 3.5: Run tests and confirm failures**

Run: `cd functions && npx vitest run src/__tests__/blog-generation.test.ts`
Expected: failures for the new SEO-input persistence assertion and the length verifier tests.

- [ ] **Step 4: Update `blog-generation.ts` imports**

Open `functions/src/blog-generation.ts`. After the existing `voice-context.js` import, add:

```ts
import {
  countWords,
  isTooShort,
  resolveTargetWordCount,
  buildExpansionPrompt,
} from "./blog/length-verifier.js"
import type { SeoTarget } from "./blog/voice-context.js"
```

- [ ] **Step 5: Extend the input type and parse SEO fields**

Find the `const input = job.input as { ... }` block. Extend it:

```ts
const input = job.input as {
  prompt: string
  tone?: string
  register?: Register
  length?: string
  primary_keyword?: string
  secondary_keywords?: string[]
  search_intent?: "informational" | "commercial" | "transactional"
  target_word_count?: number
  userId: string
  references?: UserReferences
  sourceCalendarId?: string
}

// (existing register resolution stays as-is)
```

After the register resolution, add SEO target resolution:

```ts
const seoTarget: SeoTarget | undefined = input.primary_keyword
  ? {
      primary_keyword: input.primary_keyword,
      secondary_keywords: input.secondary_keywords ?? [],
      search_intent: input.search_intent ?? null,
    }
  : undefined
const targetWordCount = resolveTargetWordCount({
  target_word_count: input.target_word_count,
  length: input.length,
})
```

- [ ] **Step 6: Pass `seoTarget` to `composeBlogSystemPrompt`**

Find the call to `composeBlogSystemPrompt({ ... })` and add `seoTarget`:

```ts
const systemPrompt = composeBlogSystemPrompt({
  voiceProfile: voice.voiceProfile,
  blogStructure: voice.blogStructure,
  programsBlock,
  register,
  seoTarget,
})
```

Update the existing log line to include the keyword:

```ts
console.log(
  `[blog-generation] voice_profile_loaded=${!voice.usedFallback.voice} structure_loaded=${!voice.usedFallback.structure} few_shots=${voice.fewShots.length} register=${register} primary_keyword=${seoTarget?.primary_keyword ?? "(none)"} target_words=${targetWordCount}`,
)
```

- [ ] **Step 7: Tighten title/excerpt Zod ranges**

Find the existing `blogResultSchema`. Tighten:

```ts
const blogResultSchema = z.object({
  title: z.string().min(20).max(120),
  slug: z.string().min(3).max(200),
  excerpt: z.string().min(80).max(280),
  content: z.string(),
  category: z.enum(["Performance", "Recovery", "Coaching", "Youth Development"]),
  tags: z.array(z.string()),
  meta_description: z.string().transform(capMetaDescription),
})
```

(The Zod ranges are slightly looser than the system-prompt targets to absorb minor Claude overshoot without triggering retries. The system prompt instructs 50-60 / 140-180; the schema accepts 20-120 / 80-280. Hard-rejecting on 65-char titles wastes a full retry.)

- [ ] **Step 8: Add the length-verifier branch after the first AI call**

After the existing `const result = await callAgent(systemPrompt, userMessage, blogResultSchema, ...)` and BEFORE the cancellation check / `validateUrls` call, add:

```ts
// Length verification: if first pass is too short, run ONE expansion re-prompt.
let finalContent = result.content
let totalTokens = result.tokens_used

const initialWordCount = countWords(finalContent.content)
if (isTooShort(initialWordCount, targetWordCount)) {
  console.log(
    `[blog-generation] First pass too short (${initialWordCount}/${targetWordCount}); running one expansion re-prompt`,
  )
  // Extract h2 list for the expansion prompt
  const h2Matches = finalContent.content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)
  const h2List = Array.from(h2Matches).map((m) => m[1].replace(/<[^>]+>/g, "").trim())

  const expansionUserMessage = buildExpansionPrompt({
    currentHtml: finalContent.content,
    actualWordCount: initialWordCount,
    targetWordCount,
    h2List,
  })

  try {
    const expanded = await callAgent(systemPrompt, expansionUserMessage, blogResultSchema, { model: MODEL_SONNET })
    finalContent = expanded.content
    totalTokens += expanded.tokens_used
    const expandedWordCount = countWords(finalContent.content)
    console.log(
      `[blog-generation] After expansion: ${expandedWordCount} words (was ${initialWordCount}, target ${targetWordCount})`,
    )
  } catch (err) {
    console.warn(`[blog-generation] Expansion re-prompt failed, keeping first-pass draft: ${(err as Error).message}`)
  }
}

// (existing validateUrls call now uses finalContent.content)
const validatedContent = await validateUrls(finalContent.content)
const finalResult = { ...finalContent, content: validatedContent }
```

(Replace the existing `const validatedContent = await validateUrls(result.content.content)` line with the new flow above. Note the variable rename from `result.content` to `finalContent`.)

The downstream `ai_generation_log` insert uses `tokens_used` — switch it to `totalTokens`. The existing line:

```ts
tokens_used: result.tokens_used,
```

becomes:

```ts
tokens_used: totalTokens,
```

- [ ] **Step 9: Persist SEO fields to the blog_posts insert**

Find the existing `supabase.from("blog_posts").insert({...})` call. Add three fields:

```ts
.from("blog_posts")
.insert({
  title: finalResult.title,
  slug: finalResult.slug,
  excerpt: finalResult.excerpt,
  content: finalResult.content,
  category: finalResult.category,
  cover_image_url: null,
  status: "draft",
  tags: finalResult.tags,
  meta_description: finalResult.meta_description,
  author_id: input.userId,
  primary_keyword: seoTarget?.primary_keyword ?? null,
  secondary_keywords: seoTarget?.secondary_keywords ?? [],
  search_intent: seoTarget?.search_intent ?? null,
})
```

- [ ] **Step 10: Run tests**

Run: `cd functions && npx vitest run src/__tests__/blog-generation.test.ts`
Expected: All tests pass (existing + 3 new length-verifier tests + the SEO-input-persistence assertion).

- [ ] **Step 11: Run the full functions suite to catch regressions**

Run: `cd functions && npx vitest run`
Expected: All tests pass (was 147; will be 147 + 14 voice-context + 14 length-verifier + 9 keyword-proposal + 3 new blog-generation = ~187).

- [ ] **Step 12: Commit**

```bash
git add functions/src/blog-generation.ts functions/src/__tests__/blog-generation.test.ts
git commit -m "refactor(blog): integrate SEO target + length verifier in handler (phase 2)"
```

---

## Task 7: Update API routes

**Files:**
- Modify: `app/api/admin/blog/generate/route.ts`
- Modify: `app/api/admin/blog/generate-from-suggestion/route.ts`
- Modify: `__tests__/api/admin/blog/generate-from-suggestion.test.ts`

**Important architectural note**: `proposePrimaryKeyword` calls Claude. Calling it from a Next.js route adds latency (~1-2s). For the MVP, we keep that latency in the topic-suggestion route — admin clicks "Generate draft," waits ~2s, navigates to `/admin/blog?just_queued=...`, and the rest of the pipeline is async. Acceptable trade-off for Phase 2.

### 7.1 — `/api/admin/blog/generate/route.ts`

- [ ] **Step 1: Extend the Zod schema**

Open `app/api/admin/blog/generate/route.ts`. Extend `blogGenerateSchema` (after the existing `references` field, inside the same z.object):

```ts
primary_keyword: z.string().min(2).max(120, "Primary keyword must be under 120 characters"),
secondary_keywords: z.array(z.string().min(1).max(120)).max(5).optional().default([]),
search_intent: z.enum(["informational", "commercial", "transactional"]).optional(),
target_word_count: z.number().int().min(200).max(5000).optional(),
```

`primary_keyword` is REQUIRED on this route — the dialog must send it.

- [ ] **Step 2: Update the destructure + jobRef.set**

Find the `const { prompt, tone, register, length, references } = parsed.data` line. Extend it:

```ts
const { prompt, tone, register, length, references, primary_keyword, secondary_keywords, search_intent, target_word_count } = parsed.data
```

Update the `jobRef.set({...})` body to include the new fields in `input`:

```ts
input: {
  prompt,
  register: resolvedRegister,
  length,
  primary_keyword,
  secondary_keywords,
  ...(search_intent ? { search_intent } : {}),
  ...(target_word_count ? { target_word_count } : {}),
  userId,
  ...(references ? { references } : {}),
},
```

### 7.2 — `/api/admin/blog/generate-from-suggestion/route.ts`

- [ ] **Step 3: Add proposePrimaryKeyword import**

Wait — there's a wrinkle. `proposePrimaryKeyword` lives in `functions/src/blog/keyword-proposal.ts`. The Next.js side cannot import from `functions/src/`. We need a parallel implementation OR we need to inline a small Claude call here using the existing `lib/ai/anthropic.ts` (Next.js side).

**Decision**: Inline a minimal Claude call in the route using `lib/ai/anthropic.ts` (Next.js has its own Anthropic client wrapper). To keep DRY, we colocate a `lib/blog/keyword-proposal.ts` (Next.js mirror) that re-implements the same logic. Phase 5 will need a similar mirror for program-catalog anyway — establishing the pattern now is cheap.

Create a Next.js-side mirror: `lib/blog/keyword-proposal.ts`:

```ts
// lib/blog/keyword-proposal.ts
// Next.js-side mirror of functions/src/blog/keyword-proposal.ts.
// Both call the same Claude API with the same system prompt; we duplicate
// because functions/ and lib/ are separate TS projects that can't share
// imports. Keep the system prompt identical between the two files.

const STOPWORD_PREFIXES = ["the ", "a ", "an ", "how to "]

export function fallbackKeywordFromTitle(title: string): string {
  if (!title) return ""
  let t = title.toLowerCase().replace(/[^\w\s]/g, "").trim()
  for (const prefix of STOPWORD_PREFIXES) {
    if (t.startsWith(prefix) && t.split(/\s+/).length > prefix.trim().split(/\s+/).length) {
      t = t.slice(prefix.length).trim()
      break
    }
  }
  return t.split(/\s+/).slice(0, 6).join(" ")
}

const SYSTEM_PROMPT = `You extract the primary search keyword from a blog topic. Return a 2-6 word noun phrase that someone would type into Google to find this content. Lowercase, no punctuation, no quotes. Skip stopwords like "the", "how to", "best".

Examples:
- Title: "How young pitchers can throw harder safely" → "youth pitching velocity"
- Title: "The 6-week return-to-play protocol after ACL surgery" → "acl return to play protocol"
- Title: "Why progressive overload still works in 2026" → "progressive overload training"

Output ONLY a JSON object: { "primary_keyword": "<the phrase>" }.`

export async function proposePrimaryKeyword(input: { title: string; summary?: string }): Promise<string> {
  // Lazy-import so the route's cold path doesn't load the SDK if we don't need it.
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn("[keyword-proposal] ANTHROPIC_API_KEY missing, falling back to title strip")
    return fallbackKeywordFromTitle(input.title)
  }

  const client = new Anthropic({ apiKey })
  const userMessage = [
    `Title: ${input.title}`,
    input.summary ? `Summary: ${input.summary}` : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
    const block = response.content.find((b) => b.type === "text")
    if (!block || block.type !== "text") return fallbackKeywordFromTitle(input.title)
    const match = block.text.match(/\{[\s\S]*\}/)
    if (!match) return fallbackKeywordFromTitle(input.title)
    const parsed = JSON.parse(match[0]) as { primary_keyword?: string }
    const proposed = (parsed.primary_keyword ?? "").trim()
    if (proposed.length > 0) return proposed
    return fallbackKeywordFromTitle(input.title)
  } catch (err) {
    console.warn(`[keyword-proposal] Claude call failed, fallback: ${(err as Error).message}`)
    return fallbackKeywordFromTitle(input.title)
  }
}
```

- [ ] **Step 4: Update the topic-suggestion route**

Open `app/api/admin/blog/generate-from-suggestion/route.ts`. Add the import:

```ts
import { proposePrimaryKeyword } from "@/lib/blog/keyword-proposal"
```

Find the section where the route prepares the prompt + references and constructs the `jobRef.set` call. After deriving `promptLines` and BEFORE `jobRef.set`, propose the keyword:

```ts
const proposedKeyword = await proposePrimaryKeyword({
  title: entry.title,
  summary: meta.summary,
})
console.log(`[generate-from-suggestion] Proposed keyword: "${proposedKeyword}" for "${entry.title}"`)
```

Then in the `jobRef.set({...})` body, add the keyword to `input`:

```ts
input: {
  prompt: promptLines,
  register: resolvedRegister,
  length,
  primary_keyword: proposedKeyword,
  userId,
  sourceCalendarId: calendarId,
  ...(referenceUrls.length ? { references: { urls: referenceUrls } } : {}),
},
```

- [ ] **Step 5: Update the existing route test**

Open `__tests__/api/admin/blog/generate-from-suggestion.test.ts`. Add a mock for the keyword-proposal module:

```ts
const { mockProposePrimaryKeyword } = vi.hoisted(() => ({
  mockProposePrimaryKeyword: vi.fn().mockResolvedValue("youth pitching velocity"),
}))

vi.mock("@/lib/blog/keyword-proposal", () => ({
  proposePrimaryKeyword: mockProposePrimaryKeyword,
}))
```

Add to `beforeEach`:

```ts
mockProposePrimaryKeyword.mockResolvedValue("youth pitching velocity")
```

Update the existing assertion that inspects `mocks.jobSet` body to expect `primary_keyword: "youth pitching velocity"` in the input.

Add ONE new test:

```ts
it("calls proposePrimaryKeyword once per request", async () => {
  // ... reuse the happy-path setup
  const res = await POST(jsonRequest({ calendarId: "cal-1" }))
  expect(res.status).toBe(202)
  expect(mockProposePrimaryKeyword).toHaveBeenCalledTimes(1)
  expect(mockProposePrimaryKeyword).toHaveBeenCalledWith({
    title: expect.any(String),
    summary: expect.any(String),
  })
})
```

- [ ] **Step 6: Run the route test**

Run: `npx vitest run __tests__/api/admin/blog/generate-from-suggestion.test.ts`
Expected: 7 tests pass (6 existing + 1 new).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/blog/generate/route.ts app/api/admin/blog/generate-from-suggestion/route.ts lib/blog/keyword-proposal.ts __tests__/api/admin/blog/generate-from-suggestion.test.ts
git commit -m "feat(api): accept SEO targets, auto-propose primary_keyword for topic suggestions (phase 2)"
```

---

## Task 8: Update `BlogGenerateDialog` UI

**Files:**
- Modify: `components/admin/blog/BlogGenerateDialog.tsx`

- [ ] **Step 1: Read the current state of the file**

Open `components/admin/blog/BlogGenerateDialog.tsx`. Locate the existing state hooks (around line 50-65) and the form layout (around line 415+).

- [ ] **Step 2: Add new state and constants**

Near the top of the component, after the `register` state, add:

```ts
const [primaryKeyword, setPrimaryKeyword] = useState("")
const [secondaryKeywords, setSecondaryKeywords] = useState<string[]>([])
const [secondaryKeywordInput, setSecondaryKeywordInput] = useState("")
const [searchIntent, setSearchIntent] = useState<"informational" | "commercial" | "transactional">("informational")
```

Near the `registers` constant, add:

```ts
const intents = [
  { value: "informational", label: "Informational" },
  { value: "commercial", label: "Commercial" },
  { value: "transactional", label: "Transactional" },
] as const
```

- [ ] **Step 3: Update `resetState()` to reset the new fields**

Inside `resetState()`, add:

```ts
setPrimaryKeyword("")
setSecondaryKeywords([])
setSecondaryKeywordInput("")
setSearchIntent("informational")
```

- [ ] **Step 4: Add a tag-input handler for secondary keywords**

Below the existing `handleAddUrl` function, add:

```ts
function handleAddSecondaryKeyword() {
  const trimmed = secondaryKeywordInput.trim().toLowerCase()
  if (!trimmed) return
  if (secondaryKeywords.length >= 5) {
    toast.error("Maximum 5 secondary keywords")
    return
  }
  if (secondaryKeywords.includes(trimmed)) {
    toast.error("Already added")
    return
  }
  setSecondaryKeywords((prev) => [...prev, trimmed])
  setSecondaryKeywordInput("")
}
```

- [ ] **Step 5: Update the POST body in `handleGenerate()`**

Find the `body: JSON.stringify({ prompt, register, length, ... })` block and add the SEO fields:

```ts
body: JSON.stringify({
  prompt,
  register,
  length,
  primary_keyword: primaryKeyword.trim(),
  secondary_keywords: secondaryKeywords,
  search_intent: searchIntent,
  ...(hasReferences ? { references: { ... } } : {}),
}),
```

Update the disabled-condition on the Generate button (around line 728). Find:

```ts
disabled={prompt.length < 10 || submitting}
```

Change to:

```ts
disabled={prompt.length < 10 || primaryKeyword.trim().length < 2 || submitting}
```

- [ ] **Step 6: Add the SEO targets UI block**

Find the JSX where the prompt textarea ends and the References collapsible begins (around line 433). BETWEEN them, insert a new "SEO targets" section:

```tsx
{/* SEO targets */}
<div className="space-y-3 border border-border rounded-lg p-3 bg-surface/30">
  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">SEO targets</p>

  {/* Primary keyword (required) */}
  <div>
    <label className="block text-xs font-medium text-foreground mb-1">
      Primary keyword <span className="text-red-500">*</span>
    </label>
    <input
      type="text"
      value={primaryKeyword}
      onChange={(e) => setPrimaryKeyword(e.target.value)}
      placeholder="e.g., youth pitching velocity"
      className="w-full px-2.5 py-1.5 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
    />
    <p className="text-[10px] text-muted-foreground mt-0.5">
      2-6 word noun phrase. Will be enforced in the title, intro, one h2, and the conclusion.
    </p>
  </div>

  {/* Secondary keywords */}
  <div>
    <label className="block text-xs font-medium text-foreground mb-1">
      Secondary keywords <span className="text-muted-foreground">(optional, max 5)</span>
    </label>
    <div className="flex gap-1.5">
      <input
        type="text"
        value={secondaryKeywordInput}
        onChange={(e) => setSecondaryKeywordInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            handleAddSecondaryKeyword()
          }
        }}
        placeholder="add and press Enter"
        className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
      />
      <button
        type="button"
        onClick={handleAddSecondaryKeyword}
        disabled={!secondaryKeywordInput.trim() || secondaryKeywords.length >= 5}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-surface transition-colors disabled:opacity-40"
      >
        Add
      </button>
    </div>
    {secondaryKeywords.length > 0 && (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {secondaryKeywords.map((kw, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-border text-xs"
          >
            {kw}
            <button
              type="button"
              onClick={() => setSecondaryKeywords((prev) => prev.filter((_, i) => i !== idx))}
              className="text-muted-foreground hover:text-red-500"
              aria-label={`Remove ${kw}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    )}
  </div>

  {/* Search intent */}
  <div>
    <label className="block text-xs font-medium text-foreground mb-1">Search intent</label>
    <div className="grid grid-cols-3 gap-0 rounded-md border border-border overflow-hidden">
      {intents.map((i, idx) => (
        <button
          key={i.value}
          type="button"
          onClick={() => setSearchIntent(i.value)}
          className={cn(
            "px-2 py-1.5 text-xs font-medium transition-all",
            idx < intents.length - 1 && "border-r border-border",
            searchIntent === i.value
              ? "bg-primary/10 text-primary"
              : "bg-white text-muted-foreground hover:bg-surface hover:text-foreground",
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  </div>
</div>
```

- [ ] **Step 7: Add `register` to the video-mode submit body too**

Find the video-mode submit body (around line 707, the existing line you previously updated to send `register`). Add the SEO fields:

```ts
body: JSON.stringify({
  video_upload_id: selectedVideoId,
  register,
  length,
  primary_keyword: primaryKeyword.trim(),
  secondary_keywords: secondaryKeywords,
  search_intent: searchIntent,
}),
```

Same disabled condition: video-mode "Generate from video" button should also require `primaryKeyword.trim().length >= 2`. Find the existing `disabled={!selectedVideoId}` and change to:

```ts
disabled={!selectedVideoId || primaryKeyword.trim().length < 2}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep BlogGenerateDialog`
Expected: no output.

- [ ] **Step 9: Run the existing component test**

Run: `npx vitest run __tests__/components/blog-generate-dialog-from-video.test.tsx`
Expected: pass. If a fixture sets up the dialog without typing a primary keyword, the test may need updating to either set the keyword via fireEvent or mock-set the state — investigate the failure before changing.

- [ ] **Step 10: Commit**

```bash
git add components/admin/blog/BlogGenerateDialog.tsx
```

If you had to update the test, also:
```bash
git add __tests__/components/blog-generate-dialog-from-video.test.tsx
```

```bash
git commit -m "feat(ui): add primary_keyword + secondary_keywords + search_intent to BlogGenerateDialog (phase 2)"
```

---

## Task 9: Smoke verification

**Files:** none.

- [ ] **Step 1: Verify the migration applied**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'blog_posts'
  AND column_name IN ('primary_keyword', 'secondary_keywords', 'search_intent')
ORDER BY column_name;
```
Expected: 3 rows with the right types.

- [ ] **Step 2: Run the full functions test suite**

Run: `cd functions && npx vitest run 2>&1 | tail -8`
Expected: All tests pass. Compare count to pre-Phase-2 baseline (147) — should now be ~187.

- [ ] **Step 3: Run the full Next.js test suite**

Run: `npx vitest run 2>&1 | tail -8`
Expected: All tests pass.

- [ ] **Step 4: Type-check the entire project**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^__tests__" | head -30`
Expected: no NEW errors. Pre-existing test-file errors elsewhere are unrelated.

- [ ] **Step 5: Spot-check an end-to-end keyword flow (if dev server is up)**

If the dev server is running:
1. Navigate to `/admin/topic-suggestions`, click "Generate draft" on a topic.
2. Inspect Firebase logs:
   ```
   [generate-from-suggestion] Proposed keyword: "<phrase>" for "<topic title>"
   [blog-generation] voice_profile_loaded=true structure_loaded=true few_shots=0 register=casual primary_keyword=<phrase> target_words=1000
   ```
3. Verify the new `blog_posts` row has `primary_keyword` populated:
   ```sql
   SELECT id, title, primary_keyword, secondary_keywords, search_intent
   FROM blog_posts ORDER BY created_at DESC LIMIT 1;
   ```

If dev server is down, skip Step 5 and rely on tests.

- [ ] **Step 6: Final commit (if any cleanup was needed)**

If anything was discovered during smoke that needed fixing:
```bash
git add -A
git commit -m "chore(blog): Phase 2 smoke-test cleanup"
```
Otherwise skip.

---

## Acceptance criteria for Phase 2

- All 9 tasks committed.
- `[blog-generation] ... primary_keyword=<phrase> target_words=N` log line appears on every new generation.
- New `blog_posts` row from a topic-suggestion path has `primary_keyword` populated (auto-proposed).
- New `blog_posts` row from the dialog path has `primary_keyword` populated (admin-typed).
- Length verifier triggers on first-pass shortfalls; one re-prompt; never two.
- Title length on freshly generated posts averages 50-65 chars (verified via SQL after 5+ new posts).
- No regression in Phase 1 tests (147+ functions, 11+ admin/blog API).

## Out of scope (deferred to Phase 3)

- FAQ section in body + FAQPage JSON-LD.
- Anchor-id injection + ToC.
- `subcategory` field.
- Author JSON-LD upgrade.

---

## Self-review notes

- Spec items D3, D4 fully delivered. D11 (readability) was already covered by migration 00108's structural prompt — no re-deployment needed.
- The `lib/blog/keyword-proposal.ts` mirror is intentional duplication. The two files share a system prompt; if it changes, update both. Phase 5 will introduce a similar mirror for program-catalog, establishing the pattern more broadly.
- Backward compat: legacy `blog_posts` rows have `primary_keyword = NULL`, `secondary_keywords = '{}'`, `search_intent = NULL`. The renderer will skip SEO-target-dependent UI blocks when nulls are present. The blog-generation handler skips the `# SEO TARGET` block when `seoTarget` is undefined — so old API callers (without the new fields) still work, just less effectively.
- Title/excerpt Zod ranges are loose (20-120 / 80-280). The system prompt enforces tighter ranges (50-60 / 140-180). This split intentionally avoids retry storms on minor Claude overshoot while still pressuring the right output.

---

## Execution

Proceeding directly with subagent-driven execution on `main` (no feature branch — solo dev preference).
