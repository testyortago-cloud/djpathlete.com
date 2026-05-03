# Blog Generation Quality — Phase 1: Brand Voice Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop hardcoding the blog-generation system prompt. Load brand voice from `prompt_templates.voice_profile` and structural rules from a new `prompt_templates.blog_generation` row on every run. Replace the 3-value `tone` enum with a 2-value `register` knob (formal/casual) so coach-edited voice in the DB drives output instead of being overridden by frontend presets. Inject a DJP program catalog so Claude mentions the right program when topically relevant.

**Architecture:** Two seams. (1) A new `loadVoiceContext()` helper queries `prompt_templates` for the active `voice_profile` and `blog_generation` rows, parses `few_shot_examples` defensively, and falls back to a minimal hardcoded skeleton if both rows are missing. The helper is called once at the top of `handleBlogGeneration` and produces a single composed system prompt string. (2) The 3-value `tone` enum is replaced by a 2-value `register` enum at the API and UI surface; a deprecated alias keeps old `tone` values working for one release. A small `program-catalog.ts` module is injected as a `# DJP PROGRAMS` block in the system prompt so the model can reference Comeback Code / Rotational Reboot when contextually relevant.

**Tech Stack:** Firebase Functions Gen 2 (Node 22), `@anthropic-ai/sdk`, `@supabase/supabase-js`, Zod, NextAuth v5, Next.js 16 App Router, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-03-blog-generation-quality-design.md](../specs/2026-05-03-blog-generation-quality-design.md) — D1 (voice context), D2 (register knob), D9 (program catalog only the prompt-injection portion; rendering deferred to Phase 5).

---

## File Structure

### New files (Functions side)
- `functions/src/blog/voice-context.ts` — `loadVoiceContext(supabase)` and `composeBlogSystemPrompt(parts)`
- `functions/src/blog/program-catalog.ts` — `PROGRAMS` array + `formatProgramsForPrompt()`
- `functions/src/blog/__tests__/voice-context.test.ts`
- `functions/src/blog/__tests__/program-catalog.test.ts`

### New files (Next.js side)
- `supabase/migrations/00108_blog_generation_prompt_template.sql` — seed `blog_generation` row in `prompt_templates`

### Modified files
- `functions/src/blog-generation.ts` — call `loadVoiceContext`, switch on `register` instead of `tone`, inject program catalog, shrink the hardcoded fallback to a structural skeleton
- `functions/src/__tests__/blog-generation.test.ts` — update fixtures: mock `prompt_templates.select`, accept `register` in input
- `app/api/admin/blog/generate/route.ts` — accept `register`, deprecated `tone` alias maps to register
- `app/api/admin/blog/generate-from-suggestion/route.ts` — accept `register` (default `casual`)
- `components/admin/blog/BlogGenerateDialog.tsx` — replace 3-button tone bar with 2-button register bar; default casual

### Unchanged but referenced
- `functions/src/voice-drift-monitor.ts` — already reads `prompt_templates.voice_profile`; serves as reference for the same query pattern
- `supabase/migrations/00081_extend_prompt_templates_categories.sql` — original seed of `voice_profile` row; we reuse the existing row, do not duplicate it

---

## Task 1: Migration — seed `blog_generation` prompt_templates row

**Files:**
- Create: `supabase/migrations/00108_blog_generation_prompt_template.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/00108_blog_generation_prompt_template.sql
-- Phase 1 of blog-generation-quality rollout.
-- Adds the blog_generation prompt_templates row that holds OUTPUT/STRUCTURE
-- rules for the blog generator. Voice/persona stays in the existing
-- voice_profile row from migration 00081.

INSERT INTO prompt_templates (name, category, scope, description, prompt)
VALUES (
  'DJP Athlete — Blog Generation Structure',
  'blog_generation',
  'global',
  'Output schema, HTML rules, length presets, and sourcing requirements for AI-generated blog posts. Voice/tone is loaded separately from the voice_profile row.',
  $prompt$# OUTPUT SCHEMA
You must output a JSON object with these fields ONLY:
- title: 50-60 chars, SEO-friendly, primary keyword in first half (when supplied)
- slug: URL-friendly lowercase with hyphens, max 200 chars
- excerpt: 140-180 chars, includes primary keyword if supplied
- content: Full HTML body (rules below)
- category: One of "Performance" | "Recovery" | "Coaching" | "Youth Development"
- tags: 3-5 lowercase keyword tags
- meta_description: 140-150 chars (hard cap 160)

# HTML RULES — content field
Allowed tags ONLY: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">
- No <h1> (the title field is rendered as h1 by the template)
- No <br>, no inline styles, no class attrs, no <div> wrappers
- Each paragraph in its own <p>
- Max 3 sentences per <p>
- Insert one <h2> every 200-300 words
- One bulleted or ordered list every 2 sections
- One blockquote with a coach-voice take in the second half

# LENGTH PRESETS
- short:  ~500 words, 3-4 h2 sections
- medium: ~1000 words, 5-6 h2 sections
- long:   ~1500 words, 7-8 h2 sections

# SOURCING (mandatory)
- The author may provide their own research material (crawled web pages, notes, uploaded documents). When present, these are PRIMARY sources — cite from them first.
- Auto-discovered research papers, when present, supplement primary sources.
- You MUST cite from provided sources using their EXACT URLs.
- Do NOT invent, guess, or fabricate any DOI links, PubMed URLs, or research paper URLs that were not provided to you.
- You MAY ALSO cite well-known organization pages you are confident exist (WHO, NSCA, ACSM).
- Include 3-4 inline <a href="..."> source references per post, placed naturally where claims are made.
- Link text describes what the source says — never just an organization name or "click here".
- Always end with a "References" or "Further Reading" h2 listing the cited papers/sources by full title.
- All URLs are validated post-generation. Any link returning 404 is removed.

Output ONLY the JSON object, no preamble.$prompt$
);
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push`
Expected: migration applies, one new row in `prompt_templates`.

- [ ] **Step 3: Verify the row**

Run:
```sql
SELECT name, category, scope, length(prompt) AS prompt_len
FROM prompt_templates
WHERE category = 'blog_generation';
```
Expected: one row, `prompt_len` between 1500 and 2500.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00108_blog_generation_prompt_template.sql
git commit -m "feat(blog): seed blog_generation prompt_templates row (phase 1)"
```

---

## Task 2: Create `program-catalog.ts` (functions side)

**Files:**
- Create: `functions/src/blog/program-catalog.ts`
- Test: `functions/src/blog/__tests__/program-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/blog/__tests__/program-catalog.test.ts
import { describe, it, expect } from "vitest"
import { findRelevantProgram, formatProgramsForPrompt, PROGRAMS } from "../program-catalog.js"

describe("program-catalog", () => {
  it("PROGRAMS is non-empty and every entry has the required fields", () => {
    expect(PROGRAMS.length).toBeGreaterThan(0)
    for (const p of PROGRAMS) {
      expect(p.slug).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.url).toMatch(/^https:\/\//)
      expect(p.pitch).toBeTruthy()
      expect(p.match_tags.length).toBeGreaterThan(0)
      expect(p.match_keywords.length).toBeGreaterThan(0)
    }
  })

  it("findRelevantProgram returns Comeback Code for a recovery-tagged post", () => {
    const result = findRelevantProgram({
      tags: ["recovery", "youth-athletes"],
      title: "Recovery strategies after competition",
    })
    expect(result?.slug).toBe("comeback-code")
  })

  it("findRelevantProgram returns Rotational Reboot for a pitching-tagged post", () => {
    const result = findRelevantProgram({
      tags: ["pitching", "throwing"],
      title: "Velocity training",
    })
    expect(result?.slug).toBe("rotational-reboot")
  })

  it("findRelevantProgram matches on keyword text when tags miss", () => {
    const result = findRelevantProgram({
      tags: [],
      title: "Improving golf swing rotational power",
    })
    expect(result?.slug).toBe("rotational-reboot")
  })

  it("findRelevantProgram returns null when nothing matches", () => {
    const result = findRelevantProgram({
      tags: ["nutrition"],
      title: "Hydration basics",
    })
    expect(result).toBeNull()
  })

  it("formatProgramsForPrompt includes every program name and url", () => {
    const out = formatProgramsForPrompt()
    for (const p of PROGRAMS) {
      expect(out).toContain(p.name)
      expect(out).toContain(p.url)
    }
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run functions/src/blog/__tests__/program-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `program-catalog.ts`**

```ts
// functions/src/blog/program-catalog.ts
// Static catalog of DJP coaching programs. Used by blog-generation to inject
// "DJP PROGRAMS" context into the system prompt, and (Phase 5) by the public
// renderer to pick a context-aware bottom CTA.
//
// Keep in sync with the public-side equivalent if/when it lands in lib/.

export interface DjpProgram {
  slug: string
  name: string
  url: string
  pitch: string
  /** Lowercase tag substrings that trigger this program. Matched against post.tags. */
  match_tags: string[]
  /** Lowercase phrases matched against title + excerpt + primary_keyword. */
  match_keywords: string[]
}

export const PROGRAMS: DjpProgram[] = [
  {
    slug: "comeback-code",
    name: "Comeback Code",
    url: "https://djpathlete.com/programs/comeback-code",
    pitch: "Structured return-to-performance program for athletes coming back from injury, layoff, or chronic limitation.",
    match_tags: [
      "recovery",
      "rehab",
      "rehabilitation",
      "return-to-sport",
      "injury",
      "comeback",
      "post-surgery",
    ],
    match_keywords: [
      "return to sport",
      "post-injury",
      "post-surgery",
      "comeback",
      "rehab",
      "rehabilitation",
      "deload",
      "recovery program",
    ],
  },
  {
    slug: "rotational-reboot",
    name: "Rotational Reboot",
    url: "https://djpathlete.com/programs/rotational-reboot",
    pitch: "Rotational power and movement program for pitchers, golfers, throwers, and racquet-sport athletes.",
    match_tags: [
      "rotational",
      "pitching",
      "throwing",
      "golf",
      "tennis",
      "baseball",
      "softball",
      "racquet",
    ],
    match_keywords: [
      "rotational power",
      "throwing velocity",
      "pitching velocity",
      "pitch",
      "golf swing",
      "tennis serve",
      "racquet",
      "bat speed",
    ],
  },
]

export interface FindProgramInput {
  tags?: string[]
  title?: string
  excerpt?: string
  primary_keyword?: string
}

export function findRelevantProgram(input: FindProgramInput): DjpProgram | null {
  const tagSet = new Set((input.tags ?? []).map((t) => t.toLowerCase()))
  const text = [input.title, input.excerpt, input.primary_keyword].filter(Boolean).join(" ").toLowerCase()
  for (const p of PROGRAMS) {
    if (p.match_tags.some((t) => tagSet.has(t))) return p
    if (p.match_keywords.some((k) => text.includes(k))) return p
  }
  return null
}

export function formatProgramsForPrompt(): string {
  const lines = PROGRAMS.map(
    (p) =>
      `- ${p.name} (${p.url})\n  ${p.pitch}\n  Mention when topic relates to: ${p.match_keywords.slice(0, 4).join(", ")}`,
  )
  return [
    "# DJP PROGRAMS",
    "If the post topic is contextually relevant to one of the following programs, mention the program by name once in the body. Do not insert a hyperlink — link insertion happens in a later step. If nothing is relevant, do not mention any program.",
    "",
    ...lines,
  ].join("\n")
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run functions/src/blog/__tests__/program-catalog.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/program-catalog.ts functions/src/blog/__tests__/program-catalog.test.ts
git commit -m "feat(blog): add program-catalog with Comeback Code + Rotational Reboot (phase 1)"
```

---

## Task 3: Create `voice-context.ts` (functions side)

**Files:**
- Create: `functions/src/blog/voice-context.ts`
- Test: `functions/src/blog/__tests__/voice-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/blog/__tests__/voice-context.test.ts
import { describe, it, expect, vi } from "vitest"
import {
  loadVoiceContext,
  composeBlogSystemPrompt,
  parseBlogFewShots,
  FALLBACK_VOICE_PROFILE,
  FALLBACK_BLOG_STRUCTURE,
} from "../voice-context.js"

function mkSupabase(rows: unknown) {
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as Parameters<typeof loadVoiceContext>[0]
}

describe("voice-context", () => {
  describe("parseBlogFewShots", () => {
    it("returns [] for non-array input", () => {
      expect(parseBlogFewShots(null)).toEqual([])
      expect(parseBlogFewShots("foo")).toEqual([])
      expect(parseBlogFewShots({})).toEqual([])
    })

    it("filters out entries missing title or excerpt", () => {
      const out = parseBlogFewShots([
        { title: "ok", excerpt: "ok" },
        { title: "ok" },
        null,
        { caption: "social shape" },
      ])
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe("ok")
    })

    it("preserves prompt and content_excerpt when present", () => {
      const out = parseBlogFewShots([
        { title: "t", excerpt: "e", prompt: "p", content_excerpt: "c" },
      ])
      expect(out[0]).toEqual({ title: "t", excerpt: "e", prompt: "p", content_excerpt: "c" })
    })
  })

  describe("loadVoiceContext", () => {
    it("returns the voice and structure prompts when both rows exist", async () => {
      const supabase = mkSupabase([
        { category: "voice_profile", prompt: "My voice", few_shot_examples: [] },
        { category: "blog_generation", prompt: "My structure", few_shot_examples: [] },
      ])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe("My voice")
      expect(ctx.blogStructure).toBe("My structure")
      expect(ctx.fewShots).toEqual([])
      expect(ctx.usedFallback).toEqual({ voice: false, structure: false })
    })

    it("falls back when voice_profile is missing", async () => {
      const supabase = mkSupabase([
        { category: "blog_generation", prompt: "My structure", few_shot_examples: [] },
      ])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe(FALLBACK_VOICE_PROFILE)
      expect(ctx.blogStructure).toBe("My structure")
      expect(ctx.usedFallback.voice).toBe(true)
      expect(ctx.usedFallback.structure).toBe(false)
    })

    it("falls back when blog_generation is missing", async () => {
      const supabase = mkSupabase([
        { category: "voice_profile", prompt: "My voice", few_shot_examples: [] },
      ])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe("My voice")
      expect(ctx.blogStructure).toBe(FALLBACK_BLOG_STRUCTURE)
      expect(ctx.usedFallback.structure).toBe(true)
    })

    it("falls back on both when no rows exist", async () => {
      const supabase = mkSupabase([])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe(FALLBACK_VOICE_PROFILE)
      expect(ctx.blogStructure).toBe(FALLBACK_BLOG_STRUCTURE)
    })

    it("falls back on supabase error", async () => {
      const errSupabase = {
        from: () => ({
          select: () => ({
            in: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      } as unknown as Parameters<typeof loadVoiceContext>[0]
      const ctx = await loadVoiceContext(errSupabase)
      expect(ctx.voiceProfile).toBe(FALLBACK_VOICE_PROFILE)
      expect(ctx.blogStructure).toBe(FALLBACK_BLOG_STRUCTURE)
      expect(ctx.usedFallback).toEqual({ voice: true, structure: true })
    })
  })

  describe("composeBlogSystemPrompt", () => {
    it("includes all four sections in order", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "VOICE",
        blogStructure: "STRUCTURE",
        programsBlock: "PROGRAMS",
        register: "casual",
      })
      const voiceIdx = out.indexOf("VOICE")
      const programsIdx = out.indexOf("PROGRAMS")
      const structureIdx = out.indexOf("STRUCTURE")
      const registerIdx = out.indexOf("REGISTER")
      expect(voiceIdx).toBeGreaterThan(-1)
      expect(programsIdx).toBeGreaterThan(voiceIdx)
      expect(registerIdx).toBeGreaterThan(programsIdx)
      expect(structureIdx).toBeGreaterThan(registerIdx)
    })

    it("emits the casual directive when register=casual", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "casual",
      })
      expect(out.toLowerCase()).toContain("casual")
    })

    it("emits the formal directive when register=formal", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "formal",
      })
      expect(out.toLowerCase()).toContain("formal")
    })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run functions/src/blog/__tests__/voice-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `voice-context.ts`**

```ts
// functions/src/blog/voice-context.ts
// Loads brand voice + blog structure prompts from prompt_templates.
// Falls back to in-code skeletons if rows are missing or DB call fails.
//
// Pattern mirrors functions/src/voice-drift-monitor.ts but loads two rows
// (voice_profile + blog_generation) in a single round-trip.

import type { SupabaseClient } from "@supabase/supabase-js"

export type Register = "formal" | "casual"

export interface BlogFewShotExample {
  prompt?: string
  title: string
  excerpt: string
  content_excerpt?: string
}

export interface VoiceContext {
  voiceProfile: string
  blogStructure: string
  fewShots: BlogFewShotExample[]
  usedFallback: { voice: boolean; structure: boolean }
}

export interface ComposeArgs {
  voiceProfile: string
  blogStructure: string
  programsBlock: string
  register: Register
}

// ─── Fallbacks ──────────────────────────────────────────────────────────────
// Used only when the DB rows are missing. Coach should edit the live rows
// rather than these constants.

export const FALLBACK_VOICE_PROFILE = `You are Darren Paul, a strength & conditioning coach with 20+ years of experience working with athletes at every level. You write the way you coach: direct, evidence-based, and unwilling to traffic in fads.

Voice traits:
- Speak in second person ("you").
- Reference training principles by name (specificity, progressive overload, supercompensation).
- One contrarian take per post.
- Numbers > adjectives. "3x bodyweight squats" beats "very strong squats".
- No empty hype words: "amazing", "incredible", "game-changer", "the secret to". Cut them.`

export const FALLBACK_BLOG_STRUCTURE = `# OUTPUT SCHEMA
Output a JSON object: { title, slug, excerpt, content (HTML), category, tags, meta_description }.

# HTML RULES
Allowed tags: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">.
No <h1>, no inline styles, no <br>.

# LENGTH
short ~500 words, medium ~1000, long ~1500. Categories: Performance | Recovery | Coaching | Youth Development.

# SOURCING
Cite 3-4 inline <a> references using ONLY URLs you were given. Never fabricate DOI/PubMed URLs. End with a References section.

Output ONLY the JSON object, no preamble.`

// ─── Few-shot parser ────────────────────────────────────────────────────────
// The few_shot_examples column is shared across categories. social_caption
// rows have a different shape — we filter to entries that look like blog
// examples (have title + excerpt).

export function parseBlogFewShots(raw: unknown): BlogFewShotExample[] {
  if (!Array.isArray(raw)) return []
  const result: BlogFewShotExample[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (typeof row.title !== "string" || typeof row.excerpt !== "string") continue
    result.push({
      title: row.title,
      excerpt: row.excerpt,
      prompt: typeof row.prompt === "string" ? row.prompt : undefined,
      content_excerpt: typeof row.content_excerpt === "string" ? row.content_excerpt : undefined,
    })
  }
  return result
}

// ─── DB load ────────────────────────────────────────────────────────────────

interface PromptTemplateRow {
  category: string
  prompt: unknown
  few_shot_examples: unknown
}

export async function loadVoiceContext(supabase: SupabaseClient): Promise<VoiceContext> {
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("category, prompt, few_shot_examples")
    .in("category", ["voice_profile", "blog_generation"])

  if (error || !data) {
    if (error) console.warn(`[voice-context] prompt_templates fetch failed: ${error.message}`)
    return {
      voiceProfile: FALLBACK_VOICE_PROFILE,
      blogStructure: FALLBACK_BLOG_STRUCTURE,
      fewShots: [],
      usedFallback: { voice: true, structure: true },
    }
  }

  const rows = data as PromptTemplateRow[]
  const voiceRow = rows.find((r) => r.category === "voice_profile")
  const structureRow = rows.find((r) => r.category === "blog_generation")

  const voiceProfile =
    voiceRow && typeof voiceRow.prompt === "string" && voiceRow.prompt.length > 0
      ? voiceRow.prompt
      : FALLBACK_VOICE_PROFILE
  const blogStructure =
    structureRow && typeof structureRow.prompt === "string" && structureRow.prompt.length > 0
      ? structureRow.prompt
      : FALLBACK_BLOG_STRUCTURE

  // Few-shots come from the blog_generation row only.
  const fewShots = parseBlogFewShots(structureRow?.few_shot_examples)

  return {
    voiceProfile,
    blogStructure,
    fewShots,
    usedFallback: {
      voice: voiceProfile === FALLBACK_VOICE_PROFILE,
      structure: blogStructure === FALLBACK_BLOG_STRUCTURE,
    },
  }
}

// ─── System prompt composer ─────────────────────────────────────────────────

export function composeBlogSystemPrompt(args: ComposeArgs): string {
  const registerBlock =
    args.register === "formal"
      ? "# REGISTER\nFormal. Tighten contractions. Lean on data and citations. Fewer first-person interjections."
      : "# REGISTER\nCasual. Use contractions. Conversational asides allowed. Address the reader directly. Default."

  return [
    "# VOICE",
    args.voiceProfile,
    "",
    args.programsBlock,
    "",
    registerBlock,
    "",
    args.blogStructure,
  ].join("\n")
}

// ─── Few-shot formatter for user message ────────────────────────────────────
// Few-shots are appended to the user message (not to system prompt) so they
// show up as context, not as instructions. callAgent doesn't accept extra
// turns, so this is the simplest path that doesn't require touching the
// Anthropic wrapper.

export function formatFewShotsForUserMessage(examples: BlogFewShotExample[]): string {
  if (examples.length === 0) return ""
  const lines: string[] = ["", "# REFERENCE EXAMPLES (output style only — do not copy content)"]
  examples.slice(0, 3).forEach((ex, idx) => {
    lines.push("")
    lines.push(`[Example ${idx + 1}]`)
    if (ex.prompt) lines.push(`Original prompt: ${ex.prompt}`)
    lines.push(`Title: ${ex.title}`)
    lines.push(`Excerpt: ${ex.excerpt}`)
    if (ex.content_excerpt) {
      lines.push(`Content sample: ${ex.content_excerpt.slice(0, 500)}`)
    }
  })
  return lines.join("\n")
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run functions/src/blog/__tests__/voice-context.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/voice-context.ts functions/src/blog/__tests__/voice-context.test.ts
git commit -m "feat(blog): add voice-context loader for prompt_templates (phase 1)"
```

---

## Task 4: Refactor `blog-generation.ts` to use voice context + register + program catalog

**Files:**
- Modify: `functions/src/blog-generation.ts`
- Modify: `functions/src/__tests__/blog-generation.test.ts`

- [ ] **Step 1: Update the existing test fixtures to match the new input shape**

Open [functions/src/__tests__/blog-generation.test.ts](../../../functions/src/__tests__/blog-generation.test.ts).

Add these imports at the top of the mocks:

```ts
const { mockCallAgent, mockGetFirestore, mockGetSupabase, mockFetchResearchPapers, mockLoadVoiceContext } = vi.hoisted(() => {
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
  }
})

vi.mock("../blog/voice-context.js", () => ({
  loadVoiceContext: mockLoadVoiceContext,
  composeBlogSystemPrompt: vi.fn(() => "COMPOSED_PROMPT"),
  formatFewShotsForUserMessage: vi.fn(() => ""),
}))
```

Update every fixture that supplied `tone:` to also supply (or instead supply) `register:`. The deprecation alias still works, but tests should exercise the new shape:

```ts
input: {
  prompt: "Test prompt",
  register: "casual",            // was tone: "professional"
  length: "medium",
  userId: "user-1",
  sourceCalendarId: "cal-1",
},
```

Add a new test asserting that `loadVoiceContext` is called once per run and that `composeBlogSystemPrompt` receives the loaded values:

```ts
it("loads voice context and uses it as the system prompt", async () => {
  // setup as in the existing happy-path test, then:
  await handleBlogGeneration("job-1")
  expect(mockLoadVoiceContext).toHaveBeenCalledTimes(1)
  expect(mockCallAgent).toHaveBeenCalledWith(
    "COMPOSED_PROMPT",
    expect.any(String),
    expect.anything(),
    expect.anything(),
  )
})
```

- [ ] **Step 2: Run the updated tests and confirm they fail (or partially fail)**

Run: `npx vitest run functions/src/__tests__/blog-generation.test.ts`
Expected: FAIL — handler still references the hardcoded prompt and `input.tone`.

- [ ] **Step 3: Refactor `blog-generation.ts`**

Replace the `BLOG_GENERATION_PROMPT` constant block ([functions/src/blog-generation.ts:9-61](../../../functions/src/blog-generation.ts#L9-L61)) and the prompt assembly inside `handleBlogGeneration` with calls to the new helpers. Full code below.

```ts
// functions/src/blog-generation.ts
// (Top of file — imports updated)

import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { fetchResearchPapers, formatResearchForPrompt } from "./lib/research.js"
import {
  loadVoiceContext,
  composeBlogSystemPrompt,
  formatFewShotsForUserMessage,
  type Register,
} from "./blog/voice-context.js"
import { formatProgramsForPrompt } from "./blog/program-catalog.js"

// (Remove the entire BLOG_GENERATION_PROMPT constant — it is now loaded from
// prompt_templates with a fallback inside voice-context.ts)
```

Inside `handleBlogGeneration`, after the firestore status flip to `processing` and BEFORE the `try` block that does AI work, change the input parsing:

```ts
const input = job.input as {
  prompt: string
  tone?: string                // deprecated alias
  register?: Register          // new
  length?: string
  userId: string
  references?: UserReferences
  sourceCalendarId?: string
}

// Map deprecated `tone` to `register` for one release.
const register: Register = ((): Register => {
  if (input.register === "formal" || input.register === "casual") return input.register
  if (input.tone === "professional") return "formal"
  return "casual"
})()
```

Then BEFORE the existing `// Step 1a: Process user-provided references...` block, load voice context and compose the system prompt:

```ts
// Step 0: Load brand voice + structural rules from prompt_templates.
const supabase = getSupabase()
const voice = await loadVoiceContext(supabase)
const programsBlock = formatProgramsForPrompt()
const systemPrompt = composeBlogSystemPrompt({
  voiceProfile: voice.voiceProfile,
  blogStructure: voice.blogStructure,
  programsBlock,
  register,
})
console.log(
  `[blog-generation] voice_profile_loaded=${!voice.usedFallback.voice} structure_loaded=${!voice.usedFallback.structure} few_shots=${voice.fewShots.length} register=${register}`,
)
```

(Note: The existing handler later calls `getSupabase()` again before the Supabase insert. Reuse the same `supabase` reference — remove that second `getSupabase()` call.)

The user message construction further down ([functions/src/blog-generation.ts:326-330](../../../functions/src/blog-generation.ts#L326-L330)) becomes:

```ts
const fewShotBlock = formatFewShotsForUserMessage(voice.fewShots)
const userMessage = `Write a blog post about: ${input.prompt}

Length: ${input.length ?? "medium"}
Current date: ${new Date().toISOString().slice(0, 10)}${userRefBlock}${researchBlock}${fewShotBlock}`
```

Note: `Tone: ...` line is removed — register is in the system prompt. The relevant program (if any) is hinted by the catalog; we don't pre-pick one for the user message.

The `callAgent` call ([functions/src/blog-generation.ts:332](../../../functions/src/blog-generation.ts#L332)) becomes:

```ts
const result = await callAgent(systemPrompt, userMessage, blogResultSchema, { model: MODEL_SONNET })
```

(Same signature; only the first argument source changed.)

- [ ] **Step 4: Run all blog-generation tests and confirm they pass**

Run: `npx vitest run functions/src/__tests__/blog-generation.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full functions test suite to catch regressions**

Run: `cd functions && npx vitest run`
Expected: All tests pass. Pre-existing failures unrelated to blog-generation should remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add functions/src/blog-generation.ts functions/src/__tests__/blog-generation.test.ts
git commit -m "refactor(blog): load voice + structure from prompt_templates, add register knob (phase 1)"
```

---

## Task 5: Update API route validators — accept `register`, deprecated `tone` alias

**Files:**
- Modify: `app/api/admin/blog/generate/route.ts`
- Modify: `app/api/admin/blog/generate-from-suggestion/route.ts`

- [ ] **Step 1: Update `/api/admin/blog/generate` validator**

Open [app/api/admin/blog/generate/route.ts](../../../app/api/admin/blog/generate/route.ts).

Replace the `tone` field in `blogGenerateSchema` ([line 24-47](../../../app/api/admin/blog/generate/route.ts#L24-L47)):

```ts
const blogGenerateSchema = z.object({
  prompt: z
    .string()
    .min(10, "Describe the blog post in at least 10 characters")
    .max(2000, "Prompt must be under 2000 characters"),
  // `tone` is deprecated — kept for one release. Maps to register at handler time.
  tone: z.enum(["professional", "conversational", "motivational"]).optional(),
  register: z.enum(["formal", "casual"]).optional(),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
  references: z
    .object({
      urls: z.array(z.string().url()).max(5).optional().default([]),
      notes: z.string().max(10_000).optional().default(""),
      file_contents: z
        .array(
          z.object({
            name: z.string(),
            content: z.string().max(50_000),
          }),
        )
        .max(3)
        .optional()
        .default([]),
    })
    .optional(),
})
```

Replace the destructure + `jobRef.set({...})` call ([line 76-90](../../../app/api/admin/blog/generate/route.ts#L76-L90)) so both fields are persisted:

```ts
const { prompt, tone, register, length, references } = parsed.data

// Resolve register (new field wins over deprecated tone).
const resolvedRegister: "formal" | "casual" =
  register ?? (tone === "professional" ? "formal" : "casual")
if (tone && !register) {
  console.warn(`[/api/admin/blog/generate] deprecated 'tone' used (${tone}) — mapped to register=${resolvedRegister}`)
}

const db = getAdminFirestore()
const jobRef = db.collection("ai_jobs").doc()

await jobRef.set({
  type: "blog_generation",
  status: "pending",
  input: {
    prompt,
    register: resolvedRegister,
    length,
    userId,
    ...(references ? { references } : {}),
  },
  result: null,
  error: null,
  userId,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})
```

- [ ] **Step 2: Update `/api/admin/blog/generate-from-suggestion` validator**

Open [app/api/admin/blog/generate-from-suggestion/route.ts](../../../app/api/admin/blog/generate-from-suggestion/route.ts).

Replace the `requestSchema` ([line 8-12](../../../app/api/admin/blog/generate-from-suggestion/route.ts#L8-L12)) and the `jobRef.set(...)` block ([line 50-67](../../../app/api/admin/blog/generate-from-suggestion/route.ts#L50-L67)):

```ts
const requestSchema = z.object({
  calendarId: z.string().uuid().or(z.string().min(1)),
  // Deprecated alias kept for one release.
  tone: z.enum(["professional", "conversational", "motivational"]).optional(),
  register: z.enum(["formal", "casual"]).optional(),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
})

// ... inside the handler, after parsed.data:
const { calendarId, tone, register, length } = parsed.data
const resolvedRegister: "formal" | "casual" =
  register ?? (tone === "professional" ? "formal" : "casual")

// ... and the jobRef.set call:
await jobRef.set({
  type: "blog_generation",
  status: "pending",
  input: {
    prompt: promptLines,
    register: resolvedRegister,
    length,
    userId,
    sourceCalendarId: calendarId,
    ...(referenceUrls.length ? { references: { urls: referenceUrls } } : {}),
  },
  result: null,
  error: null,
  userId,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})
```

- [ ] **Step 3: Run the existing route tests**

Run: `npx vitest run __tests__/api/admin/blog/generate-from-suggestion.test.ts`
Expected: PASS — the test only asserts the route returns `{ jobId }` and 202; the input shape change does not affect those assertions.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/blog/generate/route.ts app/api/admin/blog/generate-from-suggestion/route.ts
git commit -m "feat(api): accept register knob, deprecated tone alias (phase 1)"
```

---

## Task 6: Replace tone tabs with register tabs in `BlogGenerateDialog`

**Files:**
- Modify: `components/admin/blog/BlogGenerateDialog.tsx`

- [ ] **Step 1: Replace the `tones` constant and the `tone` state**

Open [components/admin/blog/BlogGenerateDialog.tsx](../../../components/admin/blog/BlogGenerateDialog.tsx).

Replace the `tones` constant ([line 32-36](../../../components/admin/blog/BlogGenerateDialog.tsx#L32-L36)):

```ts
const registers = [
  { value: "formal", label: "Formal", desc: "Tightened, citation-heavy" },
  { value: "casual", label: "Casual", desc: "Conversational, default" },
] as const
```

Replace the `tone` state ([line 55](../../../components/admin/blog/BlogGenerateDialog.tsx#L55)):

```ts
const [register, setRegister] = useState<"formal" | "casual">("casual")
```

Update `resetState()` ([line 118](../../../components/admin/blog/BlogGenerateDialog.tsx#L118)):

```ts
function resetState() {
  setMode("prompt")
  setVideos([])
  setSelectedVideoId(null)
  setPrompt("")
  setRegister("casual")  // was setTone("professional")
  setLength("medium")
  // ... rest unchanged
}
```

Update the POST body in `handleGenerate()` ([line 269-286](../../../components/admin/blog/BlogGenerateDialog.tsx#L269-L286)):

```ts
const res = await fetch("/api/admin/blog/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt,
    register,                      // was tone
    length,
    ...(hasReferences
      ? {
          references: {
            urls: urls.length > 0 ? urls : undefined,
            notes: notes.trim() || undefined,
            file_contents: refFiles.length > 0 ? refFiles : undefined,
          },
        }
      : {}),
  }),
})
```

Update the video-mode submit body ([line 698-700](../../../components/admin/blog/BlogGenerateDialog.tsx#L698-L700)):

```ts
body: JSON.stringify({ video_upload_id: selectedVideoId, register, length }),
```

(The `/api/admin/blog-posts/generate-from-video` route is separate and out of scope for this phase. The field is sent; if the route ignores it, that's acceptable Phase 1 behavior. Note this in a comment for future work.)

- [ ] **Step 2: Replace the Tone segmented control with Register**

Replace the JSX block ([line 607-627](../../../components/admin/blog/BlogGenerateDialog.tsx#L607-L627)):

```tsx
{/* Register — shared between both modes */}
<div>
  <label className="block text-sm font-semibold text-foreground mb-2">Register</label>
  <div className="grid grid-cols-2 gap-0 rounded-lg border border-border overflow-hidden">
    {registers.map((r, idx) => (
      <button
        key={r.value}
        type="button"
        onClick={() => setRegister(r.value)}
        className={cn(
          "px-3 py-2.5 text-sm font-medium transition-all",
          idx < registers.length - 1 && "border-r border-border",
          register === r.value
            ? "bg-primary/10 text-primary"
            : "bg-white text-muted-foreground hover:bg-surface hover:text-foreground",
        )}
      >
        {r.label}
        <span
          className={cn(
            "block text-[11px] font-normal mt-0.5",
            register === r.value ? "text-primary/70" : "text-muted-foreground",
          )}
        >
          {r.desc}
        </span>
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Type-check the file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep BlogGenerateDialog`
Expected: no output (no type errors in the touched file).

- [ ] **Step 4: Run the existing component tests if any**

Run: `npx vitest run __tests__/components/blog-generate-dialog-from-video.test.tsx`
Expected: PASS or unrelated failure. If the test references `tone` in a way that breaks, update its fixtures to use `register` accordingly.

- [ ] **Step 5: Commit**

```bash
git add components/admin/blog/BlogGenerateDialog.tsx
git commit -m "feat(ui): replace tone tabs with register knob (phase 1)"
```

---

## Task 7: Manual verification

**Files:** none. Smoke-test the full path.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server up on port 3050.

- [ ] **Step 2: Apply migration to the live Supabase project**

If using cloud Supabase only: open Studio → SQL editor → paste the contents of `supabase/migrations/00108_blog_generation_prompt_template.sql` and run.
Verify the row exists:

```sql
SELECT name, length(prompt) FROM prompt_templates WHERE category = 'blog_generation';
```

Expected: one row, ~1500-2500 char prompt.

- [ ] **Step 3: Trigger a blog generation from the admin UI**

Navigate to `http://localhost:3050/admin/topic-suggestions`, click "Generate draft" on a topic.

Expected:
- Redirect to `/admin/blog?just_queued=<jobId>`.
- Tracker banner walks through the two stages.
- Final post appears in the list with cover image.

- [ ] **Step 4: Inspect the Firebase Functions logs**

In another terminal (or in Firebase console):

```bash
firebase functions:log --only blogGeneration -n 30
```

Expected log line: `[blog-generation] voice_profile_loaded=true structure_loaded=true few_shots=0 register=casual`.

If `voice_profile_loaded=false`, the existing seed migration 00081 left the row with empty prompt — open Studio and paste a real Darren-voice paragraph into `prompt_templates.prompt WHERE category='voice_profile'`.

- [ ] **Step 5: Read the generated post and check for voice fingerprints**

Open the generated post in `/admin/blog/[id]/edit`. Read the body. It should:
- Address the reader as "you" (second person).
- Reference at least one named training principle.
- Mention "Comeback Code" or "Rotational Reboot" only if the topic was contextually relevant — never gratuitously.
- Avoid hype words ("amazing", "game-changer", etc.).

If the output still feels generic, the `voice_profile` row content is too short — extend it offline with the coach and update the row.

- [ ] **Step 6: Commit any test-fixture cleanup discovered during smoke**

Only if needed. Otherwise skip.

```bash
git status
# if dirty:
git add -A
git commit -m "chore(blog): test-fixture cleanup discovered in smoke (phase 1)"
```

---

## Self-review notes

This plan covers spec items D1 (voice context loading), D2 (register knob), and the prompt-injection portion of D9 (program catalog). The rendering portion of D9 — context-aware bottom CTA on the public post page — is explicitly deferred to Phase 5 because it requires the lead-magnet table and a coordinated public-renderer change.

Items intentionally **not** addressed in Phase 1, captured here so they don't drift:
- `blog-from-video.ts` also has a hardcoded prompt and would benefit from the same `loadVoiceContext` call. Left for a follow-up commit; not part of Phase 1 acceptance.
- The few-shot population pipeline for `blog_generation` (an analogue of `performanceLearningLoop` for blog post engagement) does not exist yet. Phase 1 reads `few_shot_examples` defensively so the generator works with `[]` today and will pick up future entries automatically.
- A user instruction "register='formal'" map for the deprecated `tone="conversational"` and `tone="motivational"` values — both map to `casual` in this plan, since neither maps cleanly to "formal." If after Phase 1 we find motivational-tone posts trending too data-heavy, Phase 7 can split register further.

## Acceptance for Phase 1

- All seven tasks complete and committed.
- `[blog-generation] voice_profile_loaded=true structure_loaded=true` appears in 100% of new generations after deploy.
- Drift flag rate from `voice_drift_flags` for the 7 days following deploy ≥30% lower than the 7 days prior (verify via SQL count, not eyeball).
- No regression in the topic-suggestion → draft → cover-image realtime tracker flow shipped in the previous session.

---

## Execution handoff

Plan complete and saved to [docs/superpowers/plans/2026-05-03-blog-generation-quality-phase1.md](./2026-05-03-blog-generation-quality-phase1.md).

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks here using the executing-plans skill, with checkpoints between tasks for review.

Which approach?
