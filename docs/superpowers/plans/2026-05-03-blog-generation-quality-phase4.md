# Blog Generation Quality — Phase 4: Internal Linking & Angle-Driven Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Work directly on `main` (no feature branch — solo dev preference).

**Goal:** Two related improvements. (1) Internal-link suggestions computed by `seo-enhance` are now actually injected into the article HTML — Claude picks an anchor phrase + section per suggestion, a splice helper wraps the first occurrence inside that section in `<a href="/blog/{slug}">`. Capped at 3 inserts per post; silent skip on hallucinated anchors. (2) Topic-suggestion route extracts a `# CONTENT ANGLE` block from the Tavily summary (Claude call producing `mainstream framing` + `DJP counter-frame`), injected into the system prompt so the generator leads with the contrarian take instead of writing generic informational content. Plus a "Keep reading" related-posts block on the public page.

**Architecture:** Three new helper modules. `spliceInternalLinks(html, inserts)` in `functions/src/lib/html-splice.ts` (pure HTML mutation, no AI). `getAnchorsForSuggestions()` in `functions/src/blog/internal-link-anchors.ts` (Claude Sonnet, Zod-validated). `extractContentAngle()` in `lib/blog/content-angle.ts` (Next.js mirror; minimal Anthropic SDK call). The `composeBlogSystemPrompt` composer accepts a new optional `contentAngle` arg and renders a `# CONTENT ANGLE` block between PROGRAMS and SEO TARGET. The handler reads `content_angle` from job input and passes it through. The seo-enhance handler runs after the link suggestions are computed: ask Claude for anchors, splice them into the post content, then update both `content` and `seo_metadata` on the same Supabase write. A new server `<RelatedPosts>` component renders top-3 link suggestions; falls back to a category-latest query when suggestions are empty.

**Tech Stack:** Firebase Functions Gen 2 (Node 22), `@anthropic-ai/sdk`, Zod, NextAuth v5, Next.js 16 App Router, Vitest, Tailwind v4, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-03-blog-generation-quality-design.md](../specs/2026-05-03-blog-generation-quality-design.md) — D6 (internal links), D7 (related posts), D14 (Tavily angle).

**Migration apply:** No migration needed — Phase 4 is pure code.

---

## File Structure

### New files (Functions side)
- `functions/src/blog/internal-link-anchors.ts` — `getAnchorsForSuggestions(targetPost, suggestions): Promise<{slug, anchor_text, section_h2}[]>`
- `functions/src/blog/__tests__/internal-link-anchors.test.ts`

### New files (Next.js side)
- `lib/blog/content-angle.ts` — `extractContentAngle({title, summary}): Promise<{ mainstream: string; counterframe: string } | null>`
- `components/marketing/blog/RelatedPosts.tsx` — server component for the "Keep reading" block

### Modified files (Functions side)
- `functions/src/lib/html-splice.ts` — `spliceInternalLinks(html, inserts)` helper
- `functions/src/lib/__tests__/html-splice.test.ts` — tests for splice
- `functions/src/blog/voice-context.ts` — `composeBlogSystemPrompt` accepts optional `contentAngle: { mainstream: string; counterframe: string }` arg; renders `# CONTENT ANGLE` block between PROGRAMS and SEO TARGET
- `functions/src/blog/__tests__/voice-context.test.ts` — tests for the new arg
- `functions/src/blog-generation.ts` — read `content_angle` from input; pass to composer
- `functions/src/__tests__/blog-generation.test.ts` — fixture update
- `functions/src/seo-enhance.ts` — after computing `suggestions`, call `getAnchorsForSuggestions` for top 3, splice into post content, write both `content` AND `seo_metadata` in the supabase update
- `functions/src/__tests__/seo-enhance.test.ts` — new test for splice integration

### Modified files (Next.js side)
- `app/api/admin/blog/generate-from-suggestion/route.ts` — `Promise.all([proposePrimaryKeyword, extractContentAngle])` then pass `content_angle` into ai_jobs input
- `__tests__/api/admin/blog/generate-from-suggestion.test.ts` — mock for content-angle
- `app/(marketing)/blog/[slug]/page.tsx` — render `<RelatedPosts post={post} />` between FAQ and bottom CTA
- `lib/db/blog-posts.ts` — add `getRelatedPostsByCategory(category, excludeId, limit)` for the fallback path

### Unchanged but referenced
- The existing `scoreInternalLinks` function in `functions/src/seo-enhance.ts` (computes the suggestions; we just consume them).
- `seo_metadata.internal_link_suggestions` column — still populated for admin visibility, not deprecated.

---

## Task 1: Add `spliceInternalLinks` to `html-splice.ts`

**Files:**
- Modify: `functions/src/lib/html-splice.ts`
- Modify: `functions/src/lib/__tests__/html-splice.test.ts`

- [ ] **Step 1: Write failing tests**

Open `functions/src/lib/__tests__/html-splice.test.ts`. Add to the imports at the top:

```ts
import { spliceInternalLinks } from "../html-splice.js"
```

(If the existing import line is `import { findQualifyingSections, spliceInlineImages, injectAnchorIds, extractH2Toc } from "../html-splice.js"`, extend it with `spliceInternalLinks`.)

At the bottom of the test file, append:

```ts
describe("spliceInternalLinks", () => {
  it("wraps the first occurrence of anchor_text inside the named section in an <a>", () => {
    const html = '<h2 id="recovery">Recovery basics</h2><p>You need rest days for recovery.</p><h2 id="loading">Progressive loading</h2><p>Add weight gradually.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "comeback-code", anchor_text: "rest days", section_h2: "Recovery basics" },
    ])
    expect(out).toContain('<a href="/blog/comeback-code">rest days</a>')
    expect(out).toContain('<h2 id="recovery">Recovery basics</h2>')
  })

  it("only wraps the FIRST occurrence in the section", () => {
    const html = '<h2>Recovery</h2><p>rest days are good. Take more rest days.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest days", section_h2: "Recovery" },
    ])
    const matches = out.match(/<a href="\/blog\/x">/g)
    expect(matches?.length).toBe(1)
  })

  it("matches case-insensitively but preserves original casing in the link text", () => {
    const html = "<h2>Section</h2><p>Use Progressive Overload daily.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "progressive overload", section_h2: "Section" },
    ])
    expect(out).toContain('<a href="/blog/x">Progressive Overload</a>')
  })

  it("skips silently when anchor_text is not found in the section", () => {
    const html = "<h2>Section</h2><p>nothing matches.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "missing phrase", section_h2: "Section" },
    ])
    expect(out).toBe(html)
  })

  it("skips silently when section_h2 is not found", () => {
    const html = "<h2>Other</h2><p>rest days here.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest days", section_h2: "Recovery basics" },
    ])
    expect(out).toBe(html)
  })

  it("does not nest links — skips when anchor_text is already inside an <a>", () => {
    const html = '<h2>Section</h2><p>Read about <a href="/external">rest days</a>.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest days", section_h2: "Section" },
    ])
    expect(out).toBe(html)
  })

  it("respects word boundaries — does not match inside larger words", () => {
    const html = "<h2>Section</h2><p>Trains hard but rest days work.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest", section_h2: "Section" },
    ])
    expect(out).toContain('<a href="/blog/x">rest</a>')
    // The "rest" inside the standalone word "rest" should be wrapped, not "Trains"
    expect(out).not.toContain('<a href="/blog/x">est</a>')
  })

  it("caps at 3 inserts even when more are provided", () => {
    const html = `<h2>A</h2><p>alpha here</p><h2>B</h2><p>beta here</p><h2>C</h2><p>gamma here</p><h2>D</h2><p>delta here</p>`
    const out = spliceInternalLinks(html, [
      { slug: "a", anchor_text: "alpha", section_h2: "A" },
      { slug: "b", anchor_text: "beta", section_h2: "B" },
      { slug: "c", anchor_text: "gamma", section_h2: "C" },
      { slug: "d", anchor_text: "delta", section_h2: "D" },
    ])
    const matches = out.match(/<a href="\/blog\//g)
    expect(matches?.length).toBe(3)
    expect(out).not.toContain('href="/blog/d"')
  })

  it("handles empty inserts list", () => {
    const html = "<h2>Section</h2><p>x</p>"
    expect(spliceInternalLinks(html, [])).toBe(html)
  })

  it("handles section text with inline tags by stripping them for matching", () => {
    const html = '<h2 id="x">Recovery <em>basics</em></h2><p>Get rest days.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "y", anchor_text: "rest days", section_h2: "Recovery basics" },
    ])
    expect(out).toContain('<a href="/blog/y">rest days</a>')
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd functions && npx vitest run src/lib/__tests__/html-splice.test.ts`
Expected: FAIL — `spliceInternalLinks` not exported.

- [ ] **Step 3: Implement in `html-splice.ts`**

Open `functions/src/lib/html-splice.ts`. After the `extractH2Toc` export (at the very end of the file), append:

```ts
// ─── spliceInternalLinks ───────────────────────────────────────────────────

const MAX_INTERNAL_LINKS_PER_POST = 3

export interface InternalLinkInsert {
  slug: string
  anchor_text: string
  section_h2: string
}

/**
 * Wraps the FIRST occurrence of `anchor_text` (case-insensitive, word-bounded)
 * inside the section identified by `section_h2` with `<a href="/blog/{slug}">`.
 *
 * Rules:
 * - Caps at MAX_INTERNAL_LINKS_PER_POST inserts; subsequent inserts are dropped.
 * - Skips silently when section_h2 is not found.
 * - Skips silently when anchor_text is not found in the section.
 * - Skips when anchor_text is already inside an <a> tag (no nesting).
 * - Matches case-insensitively but preserves the original casing in the link text.
 * - Section header text is matched after stripping inline tags (so
 *   "<h2>Recovery <em>basics</em></h2>" matches section_h2 "Recovery basics").
 */
export function spliceInternalLinks(html: string, inserts: InternalLinkInsert[]): string {
  if (inserts.length === 0) return html

  let result = html
  let applied = 0

  for (const insert of inserts) {
    if (applied >= MAX_INTERNAL_LINKS_PER_POST) break

    // Find the section bounds: from the opening h2 with matching text to the next h2 or end.
    const sectionBounds = findSectionBounds(result, insert.section_h2)
    if (!sectionBounds) continue

    const { contentStart, contentEnd } = sectionBounds
    const sectionHtml = result.slice(contentStart, contentEnd)

    // Match the anchor text with word boundaries, case-insensitively.
    const escaped = escapeRegex(insert.anchor_text)
    const matchRegex = new RegExp(`\\b${escaped}\\b`, "i")
    const match = matchRegex.exec(sectionHtml)
    if (!match) continue

    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    // Avoid nesting: skip if this match is inside an <a>...</a>.
    if (isInsideAnchor(sectionHtml, matchStart)) continue

    const matchedText = sectionHtml.slice(matchStart, matchEnd)
    const wrapped = `<a href="/blog/${insert.slug}">${matchedText}</a>`
    const newSectionHtml =
      sectionHtml.slice(0, matchStart) + wrapped + sectionHtml.slice(matchEnd)

    result = result.slice(0, contentStart) + newSectionHtml + result.slice(contentEnd)
    applied++
  }

  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface SectionBounds {
  contentStart: number // index just after the closing </h2>
  contentEnd: number   // index of the next <h2 or html.length
}

function findSectionBounds(html: string, sectionH2Text: string): SectionBounds | null {
  const target = sectionH2Text.replace(/\s+/g, " ").trim().toLowerCase()
  const h2Regex = /<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/g
  let m: RegExpExecArray | null
  while ((m = h2Regex.exec(html)) !== null) {
    const stripped = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
    if (stripped === target) {
      const contentStart = m.index + m[0].length
      const nextH2 = html.indexOf("<h2", contentStart)
      const contentEnd = nextH2 === -1 ? html.length : nextH2
      return { contentStart, contentEnd }
    }
  }
  return null
}

function isInsideAnchor(html: string, position: number): boolean {
  // Walk backwards from `position` looking for the nearest <a or </a>.
  // If we find <a first, we're inside an anchor.
  const before = html.slice(0, position).toLowerCase()
  const lastOpen = before.lastIndexOf("<a")
  const lastClose = before.lastIndexOf("</a>")
  if (lastOpen === -1) return false
  if (lastClose === -1) return true
  return lastOpen > lastClose
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `cd functions && npx vitest run src/lib/__tests__/html-splice.test.ts`
Expected: All tests pass (existing 17 + 10 new = 27).

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/html-splice.ts functions/src/lib/__tests__/html-splice.test.ts
git commit -m "feat(blog): add spliceInternalLinks helper (phase 4)"
```

---

## Task 2: Add `internal-link-anchors.ts` Claude helper

**Files:**
- Create: `functions/src/blog/internal-link-anchors.ts`
- Create: `functions/src/blog/__tests__/internal-link-anchors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/src/blog/__tests__/internal-link-anchors.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCallAgent = vi.hoisted(() => vi.fn())

vi.mock("../../ai/anthropic.js", () => ({
  callAgent: mockCallAgent,
  MODEL_SONNET: "claude-sonnet-test",
}))

import { getAnchorsForSuggestions } from "../internal-link-anchors.js"

describe("internal-link-anchors", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the Claude-proposed anchors on success", async () => {
    mockCallAgent.mockResolvedValue({
      content: {
        anchors: [
          { slug: "comeback-code", anchor_text: "rest days", section_h2: "Recovery basics" },
        ],
      },
      tokens_used: 80,
    })
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<h2>Recovery basics</h2><p>Get rest days.</p>" },
      suggestions: [{ slug: "comeback-code", title: "Comeback Code post" }],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      slug: "comeback-code",
      anchor_text: "rest days",
      section_h2: "Recovery basics",
    })
  })

  it("caps at 3 entries even when Claude returns more", async () => {
    mockCallAgent.mockResolvedValue({
      content: {
        anchors: [
          { slug: "a", anchor_text: "x", section_h2: "A" },
          { slug: "b", anchor_text: "y", section_h2: "B" },
          { slug: "c", anchor_text: "z", section_h2: "C" },
          { slug: "d", anchor_text: "w", section_h2: "D" },
        ],
      },
      tokens_used: 100,
    })
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [
        { slug: "a", title: "A" },
        { slug: "b", title: "B" },
        { slug: "c", title: "C" },
        { slug: "d", title: "D" },
      ],
    })
    expect(result).toHaveLength(3)
  })

  it("returns empty array when no suggestions provided", async () => {
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [],
    })
    expect(result).toEqual([])
    expect(mockCallAgent).not.toHaveBeenCalled()
  })

  it("returns empty array on Claude error", async () => {
    mockCallAgent.mockRejectedValue(new Error("rate limit"))
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [{ slug: "a", title: "A" }],
    })
    expect(result).toEqual([])
  })

  it("filters out anchors whose slug doesn't match a suggestion (Claude hallucination guard)", async () => {
    mockCallAgent.mockResolvedValue({
      content: {
        anchors: [
          { slug: "comeback-code", anchor_text: "rest", section_h2: "Recovery" },
          { slug: "rotational-reboot", anchor_text: "throw", section_h2: "Drills" }, // not in suggestions
        ],
      },
      tokens_used: 80,
    })
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [{ slug: "comeback-code", title: "C" }], // only one suggestion
    })
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe("comeback-code")
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd functions && npx vitest run src/blog/__tests__/internal-link-anchors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `internal-link-anchors.ts`**

Create `functions/src/blog/internal-link-anchors.ts`:

```ts
// functions/src/blog/internal-link-anchors.ts
// One Claude Sonnet call (~80 tokens out) that picks an anchor phrase + h2
// section for each internal-link suggestion. Used by seo-enhance to splice
// real <a href="/blog/{slug}"> tags into the post body.
//
// Falls back to an empty array on any error — never blocks SEO enhancement.

import { z } from "zod"
import { callAgent, MODEL_SONNET } from "../ai/anthropic.js"

const MAX_ANCHORS = 3
const CONTENT_PREVIEW_CHARS = 4000

export interface InternalLinkSuggestion {
  slug: string
  title: string
}

export interface InternalLinkAnchor {
  slug: string
  anchor_text: string
  section_h2: string
}

const anchorsSchema = z.object({
  anchors: z
    .array(
      z.object({
        slug: z.string().min(1).max(200),
        anchor_text: z.string().min(2).max(60),
        section_h2: z.string().min(2).max(200),
      }),
    )
    .max(20), // generous; we cap to 3 + filter ourselves
})

const SYSTEM_PROMPT = `You pick internal-link anchor phrases for a fitness/coaching blog post. For each related-post suggestion, choose:
1. A 2-5 word phrase from the TARGET post's body that is naturally related to the suggested post's topic. The phrase MUST appear verbatim in the body.
2. The h2 section (use the EXACT heading text) where that phrase appears.

Rules:
- Pick at most 3 suggestions total — the most natural fits.
- Anchor phrases should read naturally as link text — not "click here" or generic words like "this".
- If a suggestion can't be anchored well anywhere in the body, skip it.
- Use the exact h2 heading text as it appears in the body.

Output ONLY a JSON object: { "anchors": [ { "slug": "...", "anchor_text": "...", "section_h2": "..." }, ... ] }.`

export interface GetAnchorsInput {
  targetPost: { title: string; content: string }
  suggestions: InternalLinkSuggestion[]
}

export async function getAnchorsForSuggestions(input: GetAnchorsInput): Promise<InternalLinkAnchor[]> {
  if (input.suggestions.length === 0) return []

  const userMessage = [
    `# TARGET POST`,
    `Title: ${input.targetPost.title}`,
    "",
    `Body (first ${CONTENT_PREVIEW_CHARS} chars):`,
    input.targetPost.content.slice(0, CONTENT_PREVIEW_CHARS),
    "",
    `# SUGGESTED RELATED POSTS`,
    ...input.suggestions.map((s, i) => `${i + 1}. slug="${s.slug}" — ${s.title}`),
    "",
    "Return the JSON object now.",
  ].join("\n")

  try {
    const result = await callAgent(SYSTEM_PROMPT, userMessage, anchorsSchema, {
      model: MODEL_SONNET,
      maxTokens: 600,
    })

    // Hallucination guard: filter out anchors whose slug isn't in the suggestions.
    const allowedSlugs = new Set(input.suggestions.map((s) => s.slug))
    return result.content.anchors.filter((a) => allowedSlugs.has(a.slug)).slice(0, MAX_ANCHORS)
  } catch (err) {
    console.warn(`[internal-link-anchors] Claude call failed, returning empty array: ${(err as Error).message}`)
    return []
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/blog/__tests__/internal-link-anchors.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/internal-link-anchors.ts functions/src/blog/__tests__/internal-link-anchors.test.ts
git commit -m "feat(blog): add getAnchorsForSuggestions Claude helper (phase 4)"
```

---

## Task 3: Add `content-angle.ts` Next.js helper

**Files:**
- Create: `lib/blog/content-angle.ts`

This mirrors the `keyword-proposal` Next.js pattern from Phase 2 — Anthropic SDK directly, lazy-loaded, falls back to null on any error.

- [ ] **Step 1: Create the file**

```ts
// lib/blog/content-angle.ts
// Cheap Claude call that converts a Tavily summary into a "mainstream framing
// vs DJP counter-frame" pair. Injected into the system prompt as a #
// CONTENT ANGLE block so the generator leads with the contrarian take
// instead of writing generic informational content.
//
// Falls back to null on any error — never blocks generation. The handler
// skips the # CONTENT ANGLE block when input.content_angle is missing.

const SYSTEM_PROMPT = `You are reading a topic summary and producing a contrarian content angle for a strength & conditioning coaching blog.

Output two single-line strings:
1. "mainstream": One sentence summarizing how mainstream fitness content typically frames this topic. Be specific about what most articles claim.
2. "counterframe": One sentence stating where Darren Paul's view differs — the contrarian or under-discussed angle. Should be defensible from coaching evidence, not edgy for its own sake.

Examples:
- Topic: "Static stretching before a workout"
  → mainstream: "Most fitness blogs say static stretching warms up muscles and prevents injury."
    counterframe: "Static stretching before lifting reduces force output for up to 30 minutes — dynamic warm-ups are better."

- Topic: "Soreness as a sign of a good workout"
  → mainstream: "Articles equate post-workout soreness with effective training."
    counterframe: "Chronic soreness is a sign of insufficient recovery, not progress — repeated bouts produce less soreness even when stimulus is the same."

Output ONLY a JSON object: { "mainstream": "<sentence>", "counterframe": "<sentence>" }. Both fields must be 60-200 chars each.`

export interface ContentAngle {
  mainstream: string
  counterframe: string
}

export async function extractContentAngle(input: {
  title: string
  summary?: string
}): Promise<ContentAngle | null> {
  if (!input.title) return null

  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn("[content-angle] ANTHROPIC_API_KEY missing, returning null")
    return null
  }

  const client = new Anthropic({ apiKey })
  const userMessage = [
    `Topic title: ${input.title}`,
    input.summary ? `Topic summary: ${input.summary}` : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
    const block = response.content.find((b) => b.type === "text")
    if (!block || block.type !== "text") return null
    const match = block.text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Partial<ContentAngle>
    if (
      typeof parsed.mainstream === "string" &&
      typeof parsed.counterframe === "string" &&
      parsed.mainstream.length >= 20 &&
      parsed.counterframe.length >= 20
    ) {
      return { mainstream: parsed.mainstream, counterframe: parsed.counterframe }
    }
    return null
  } catch (err) {
    console.warn(`[content-angle] Claude call failed: ${(err as Error).message}`)
    return null
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep content-angle`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/blog/content-angle.ts
git commit -m "feat(blog): add extractContentAngle helper for Tavily counter-framing (phase 4)"
```

---

## Task 4: `composeBlogSystemPrompt` accepts `contentAngle`

**Files:**
- Modify: `functions/src/blog/voice-context.ts`
- Modify: `functions/src/blog/__tests__/voice-context.test.ts`

- [ ] **Step 1: Add new tests**

Open `functions/src/blog/__tests__/voice-context.test.ts`. Inside the existing `describe("composeBlogSystemPrompt", ...)` block, after the existing tests, append:

```ts
it("renders CONTENT ANGLE block when contentAngle is provided", () => {
  const out = composeBlogSystemPrompt({
    voiceProfile: "v",
    blogStructure: "s",
    programsBlock: "p",
    register: "casual",
    contentAngle: {
      mainstream: "Most blogs say static stretching prevents injury.",
      counterframe: "Static stretching before lifting reduces force output for up to 30 minutes.",
    },
  })
  expect(out).toContain("# CONTENT ANGLE")
  expect(out).toContain("Mainstream framing: Most blogs say static stretching")
  expect(out).toContain("DJP counter-frame: Static stretching before lifting")
})

it("omits CONTENT ANGLE when contentAngle is undefined", () => {
  const out = composeBlogSystemPrompt({
    voiceProfile: "v",
    blogStructure: "s",
    programsBlock: "p",
    register: "casual",
  })
  expect(out).not.toContain("# CONTENT ANGLE")
})

it("places CONTENT ANGLE between PROGRAMS and SEO TARGET", () => {
  const out = composeBlogSystemPrompt({
    voiceProfile: "v",
    blogStructure: "s",
    programsBlock: "p",
    register: "casual",
    seoTarget: { primary_keyword: "k", secondary_keywords: [], search_intent: null },
    contentAngle: { mainstream: "MAINSTREAM_LINE_TEXT", counterframe: "COUNTERFRAME_LINE_TEXT" },
  })
  const programsIdx = out.indexOf("PROGRAMS")
  const angleIdx = out.indexOf("# CONTENT ANGLE")
  const seoIdx = out.indexOf("# SEO TARGET")
  expect(programsIdx).toBeGreaterThan(-1)
  expect(angleIdx).toBeGreaterThan(programsIdx)
  expect(seoIdx).toBeGreaterThan(angleIdx)
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd functions && npx vitest run src/blog/__tests__/voice-context.test.ts`
Expected: 1+ failures (the CONTENT ANGLE tests fail because the feature isn't built; the omit-test passes by accident).

- [ ] **Step 3: Implement in `voice-context.ts`**

Add a new exported `ContentAngle` interface AFTER `SeoTarget` and BEFORE `BlogFewShotExample`:

```ts
export interface ContentAngle {
  mainstream: string
  counterframe: string
}
```

Extend `ComposeArgs` to add an optional `contentAngle`:

```ts
export interface ComposeArgs {
  voiceProfile: string
  blogStructure: string
  programsBlock: string
  register: Register
  seoTarget?: SeoTarget
  contentAngle?: ContentAngle
}
```

Add a helper before `composeBlogSystemPrompt`:

```ts
function formatContentAngleBlock(angle: ContentAngle | undefined): string {
  if (!angle || !angle.mainstream || !angle.counterframe) return ""
  return [
    "# CONTENT ANGLE",
    `Mainstream framing: ${angle.mainstream}`,
    `DJP counter-frame: ${angle.counterframe}`,
    "",
    "Lead the post with the counter-frame. Acknowledge the mainstream view briefly to differentiate, then prove your case.",
  ].join("\n")
}
```

Update `composeBlogSystemPrompt` to inject the angle block between PROGRAMS and SEO TARGET. Find the existing function body (after the `seoBlock` derivation):

```ts
export function composeBlogSystemPrompt(args: ComposeArgs): string {
  const registerBlock =
    args.register === "formal"
      ? "# REGISTER\nFormal. Tighten contractions. Lean on data and citations. Fewer first-person interjections."
      : "# REGISTER\nCasual. Use contractions. Conversational asides allowed. Address the reader directly. Default."

  const seoBlock = formatSeoTargetBlock(args.seoTarget)
  const angleBlock = formatContentAngleBlock(args.contentAngle)

  const sections: string[] = [
    "# VOICE",
    args.voiceProfile,
    "",
    args.programsBlock,
  ]
  if (angleBlock) {
    sections.push("", angleBlock)
  }
  if (seoBlock) {
    sections.push("", seoBlock)
  }
  sections.push("", registerBlock, "", args.blogStructure)
  return sections.join("\n")
}
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/blog/__tests__/voice-context.test.ts`
Expected: 17 tests pass (14 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog/voice-context.ts functions/src/blog/__tests__/voice-context.test.ts
git commit -m "feat(blog): composeBlogSystemPrompt accepts contentAngle arg (phase 4)"
```

---

## Task 5: Handler reads `content_angle` from input

**Files:**
- Modify: `functions/src/blog-generation.ts`

- [ ] **Step 1: Extend the input type**

Open `functions/src/blog-generation.ts`. Find the input destructure (around line 218). Extend:

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
  content_angle?: { mainstream: string; counterframe: string }
  userId: string
  references?: UserReferences
  sourceCalendarId?: string
}
```

- [ ] **Step 2: Pass to composer**

Find the existing `const systemPrompt = composeBlogSystemPrompt({ ... })` call. Add:

```ts
const systemPrompt = composeBlogSystemPrompt({
  voiceProfile: voice.voiceProfile,
  blogStructure: voice.blogStructure,
  programsBlock,
  register,
  seoTarget,
  contentAngle: input.content_angle,
})
```

- [ ] **Step 3: Update the log line to include angle presence**

Find the existing `console.log` line that includes `voice_profile_loaded=...`. Replace:

```ts
console.log(
  `[blog-generation] voice_profile_loaded=${!voice.usedFallback.voice} structure_loaded=${!voice.usedFallback.structure} few_shots=${voice.fewShots.length} register=${register} primary_keyword=${seoTarget?.primary_keyword ?? "(none)"} target_words=${targetWordCount} content_angle=${input.content_angle ? "yes" : "no"}`,
)
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npx vitest run src/__tests__/blog-generation.test.ts`
Expected: All tests pass — the new field is optional, existing fixtures continue to parse.

- [ ] **Step 5: Commit**

```bash
git add functions/src/blog-generation.ts
git commit -m "feat(blog): handler reads content_angle from input and passes to composer (phase 4)"
```

---

## Task 6: Topic-suggestion route extracts content angle (parallel with keyword)

**Files:**
- Modify: `app/api/admin/blog/generate-from-suggestion/route.ts`
- Modify: `__tests__/api/admin/blog/generate-from-suggestion.test.ts`

The existing route already calls `proposePrimaryKeyword` (~1-2s). Adding a second sequential Claude call would make the route ~3-4s. We run them in `Promise.all` to keep total latency at ~1-2s.

- [ ] **Step 1: Add the import**

Open `app/api/admin/blog/generate-from-suggestion/route.ts`. After the existing import line for `proposePrimaryKeyword`, add:

```ts
import { extractContentAngle } from "@/lib/blog/content-angle"
```

- [ ] **Step 2: Replace the sequential keyword call with parallel calls**

Find the existing block:

```ts
const proposedKeyword = await proposePrimaryKeyword({
  title: entry.title,
  summary: meta.summary,
})
console.log(`[generate-from-suggestion] Proposed keyword: "${proposedKeyword}" for "${entry.title}"`)
```

Replace with:

```ts
const [proposedKeyword, contentAngle] = await Promise.all([
  proposePrimaryKeyword({ title: entry.title, summary: meta.summary }),
  extractContentAngle({ title: entry.title, summary: meta.summary }),
])
console.log(
  `[generate-from-suggestion] keyword="${proposedKeyword}" angle=${contentAngle ? "yes" : "no"} for "${entry.title}"`,
)
```

- [ ] **Step 3: Pass `content_angle` into the ai_jobs input**

Find the `jobRef.set({...})` call. The `input:` object currently has `prompt`, `register`, `length`, `primary_keyword`, `userId`, `sourceCalendarId`, and conditional `references`. Add `content_angle`:

```ts
input: {
  prompt: promptLines,
  register: resolvedRegister,
  length,
  primary_keyword: proposedKeyword,
  ...(contentAngle ? { content_angle: contentAngle } : {}),
  userId,
  sourceCalendarId: calendarId,
  ...(referenceUrls.length ? { references: { urls: referenceUrls } } : {}),
},
```

- [ ] **Step 4: Update the route test**

Open `__tests__/api/admin/blog/generate-from-suggestion.test.ts`. Add a hoisted mock for `extractContentAngle` alongside the existing one:

```ts
const mocks = vi.hoisted(() => ({
  // ... existing mocks
  extractContentAngle: vi.fn().mockResolvedValue({
    mainstream: "Most blogs say X.",
    counterframe: "Actually Y.",
  }),
}))
```

Add a `vi.mock` call:

```ts
vi.mock("@/lib/blog/content-angle", () => ({
  extractContentAngle: mocks.extractContentAngle,
}))
```

In `beforeEach`, restore the default:

```ts
mocks.extractContentAngle.mockResolvedValue({
  mainstream: "Most blogs say X.",
  counterframe: "Actually Y.",
})
```

Update an existing assertion to expect `content_angle` in the input body:

```ts
expect(mocks.jobSet).toHaveBeenCalledWith(
  expect.objectContaining({
    input: expect.objectContaining({
      primary_keyword: "youth pitching velocity",
      content_angle: { mainstream: "Most blogs say X.", counterframe: "Actually Y." },
    }),
  }),
)
```

Add ONE new test:

```ts
it("calls both proposePrimaryKeyword and extractContentAngle once each", async () => {
  // Reuse the existing happy-path setup, then:
  mocks.auth.mockResolvedValue({ user: { id: "user-1", role: "admin" } })
  mocks.getCalendarEntryById.mockResolvedValue({
    id: "cal-1",
    entry_type: "topic_suggestion",
    title: "Topic title",
    metadata: { summary: "summary" },
  })
  const res = await POST(jsonRequest({ calendarId: "cal-1" }))
  expect(res.status).toBe(202)
  expect(mocks.proposePrimaryKeyword).toHaveBeenCalledTimes(1)
  expect(mocks.extractContentAngle).toHaveBeenCalledTimes(1)
})

it("omits content_angle from job input when extractContentAngle returns null", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-1", role: "admin" } })
  mocks.getCalendarEntryById.mockResolvedValue({
    id: "cal-1",
    entry_type: "topic_suggestion",
    title: "Topic title",
    metadata: { summary: "summary" },
  })
  mocks.extractContentAngle.mockResolvedValue(null)
  const res = await POST(jsonRequest({ calendarId: "cal-1" }))
  expect(res.status).toBe(202)
  expect(mocks.jobSet).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.not.objectContaining({ content_angle: expect.anything() }),
    }),
  )
})
```

- [ ] **Step 5: Run the route test**

Run: `npx vitest run __tests__/api/admin/blog/generate-from-suggestion.test.ts`
Expected: All tests pass (was 7, now 9).

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/blog/generate-from-suggestion/route.ts __tests__/api/admin/blog/generate-from-suggestion.test.ts
git commit -m "feat(api): topic-suggestion route extracts content angle (phase 4)"
```

---

## Task 7: `seo-enhance` calls `getAnchorsForSuggestions` and splices links

**Files:**
- Modify: `functions/src/seo-enhance.ts`
- Modify: `functions/src/__tests__/seo-enhance.test.ts`

- [ ] **Step 1: Add imports**

Open `functions/src/seo-enhance.ts`. Add:

```ts
import { getAnchorsForSuggestions } from "./blog/internal-link-anchors.js"
import { spliceInternalLinks } from "./lib/html-splice.js"
```

- [ ] **Step 2: Compute anchors + spliced content after `suggestions` is built**

Find the existing `const suggestions = scoreInternalLinks(...)` call (around line 193-208). After that block, but BEFORE the `const faqEntries = ...` line, add:

```ts
// Phase 4: ask Claude to pick a 2-5 word anchor + h2 section per suggestion,
// then splice into the post body. Capped at 3 links by both helpers.
const anchors = await getAnchorsForSuggestions({
  targetPost: {
    title: postRow.title as string,
    content: (postRow.content as string) ?? "",
  },
  suggestions: suggestions.slice(0, 5).map((s) => ({ slug: s.slug, title: s.title })),
})
const splicedContent =
  anchors.length > 0
    ? spliceInternalLinks((postRow.content as string) ?? "", anchors)
    : null
console.log(
  `[seo-enhance] internal_link_anchors=${anchors.length} content_spliced=${splicedContent !== null}`,
)
```

- [ ] **Step 3: Include `content` in the supabase update when splicing happened**

Find the existing supabase update:

```ts
const { error: updateErr } = await supabase
  .from("blog_posts")
  .update({ seo_metadata: seoMetadata })
  .eq("id", input.blog_post_id)
```

Replace with:

```ts
const updatePayload: Record<string, unknown> = { seo_metadata: seoMetadata }
if (splicedContent !== null) {
  updatePayload.content = splicedContent
}
const { error: updateErr } = await supabase
  .from("blog_posts")
  .update(updatePayload)
  .eq("id", input.blog_post_id)
```

- [ ] **Step 4: Update the result reported back in jobRef.update**

Find the existing:

```ts
result: {
  blog_post_id: input.blog_post_id,
  suggestions_count: suggestions.length,
},
```

Replace with:

```ts
result: {
  blog_post_id: input.blog_post_id,
  suggestions_count: suggestions.length,
  internal_links_spliced: anchors.length,
},
```

- [ ] **Step 5: Update tests**

Open `functions/src/__tests__/seo-enhance.test.ts`. The existing tests for `buildFaqPageJsonLd` are pure-function tests — they don't exercise `handleSeoEnhance`. So they shouldn't fail from the splice change.

If any test does exercise the full `handleSeoEnhance` flow with mocked supabase, you may need to extend the mocks for the new `getAnchorsForSuggestions` call. Use `vi.mock` to stub it out:

```ts
vi.mock("../blog/internal-link-anchors.js", () => ({
  getAnchorsForSuggestions: vi.fn().mockResolvedValue([]),
}))
```

(Read the existing test first; only add mocks if the test exercises `handleSeoEnhance`.)

- [ ] **Step 6: Run tests**

Run: `cd functions && npx vitest run src/__tests__/seo-enhance.test.ts`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add functions/src/seo-enhance.ts functions/src/__tests__/seo-enhance.test.ts
git commit -m "feat(seo): splice internal links into post body via Claude-picked anchors (phase 4)"
```

---

## Task 8: `<RelatedPosts>` component + DAL fallback query

**Files:**
- Modify: `lib/db/blog-posts.ts`
- Create: `components/marketing/blog/RelatedPosts.tsx`

- [ ] **Step 1: Add a fallback DAL query**

Open `lib/db/blog-posts.ts`. Add a new exported function (place it after `getPublishedBlogPostBySlug` or wherever fits):

```ts
export async function getRelatedPostsByCategory(args: {
  category: string
  excludeId: string
  limit?: number
}): Promise<Array<Pick<BlogPost, "id" | "title" | "slug" | "excerpt" | "category" | "cover_image_url" | "published_at">>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, category, cover_image_url, published_at")
    .eq("status", "published")
    .eq("category", args.category)
    .neq("id", args.excludeId)
    .order("published_at", { ascending: false })
    .limit(args.limit ?? 3)
  if (error) throw error
  return data as Array<
    Pick<BlogPost, "id" | "title" | "slug" | "excerpt" | "category" | "cover_image_url" | "published_at">
  >
}
```

- [ ] **Step 2: Create the `<RelatedPosts>` component**

Create `components/marketing/blog/RelatedPosts.tsx`:

```tsx
import Link from "next/link"
import NextImage from "next/image"
import type { BlogPost, SeoMetadata, SeoMetadataInternalLink } from "@/types/database"
import { getRelatedPostsByCategory } from "@/lib/db/blog-posts"

interface RelatedPostsProps {
  post: BlogPost
}

interface RelatedItem {
  title: string
  slug: string
  excerpt?: string
  cover_image_url?: string | null
}

/**
 * Renders a "Keep reading" block above the bottom CTA. Source priority:
 * 1. Top 3 entries from seo_metadata.internal_link_suggestions (computed by
 *    seo-enhance via tag-overlap scoring).
 * 2. If empty, fall back to the latest 3 published posts in the same category.
 *
 * Returns null when neither source produces ≥1 item.
 */
export async function RelatedPosts({ post }: RelatedPostsProps) {
  const items = await resolveRelatedItems(post)
  if (items.length === 0) return null

  return (
    <section className="py-16 lg:py-20 px-4 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">─ Keep reading</p>
          <h2 className="mt-1 text-2xl sm:text-3xl font-heading font-semibold text-primary">More from DJP Athlete</h2>
        </header>
        <div className="grid gap-6 md:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.slug}
              href={`/blog/${item.slug}`}
              className="group block rounded-xl border border-border bg-white overflow-hidden hover:border-foreground/30 transition-colors"
            >
              {item.cover_image_url && (
                <div className="relative aspect-[16/9] bg-surface">
                  <NextImage
                    src={item.cover_image_url}
                    alt={item.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
              )}
              <div className="p-4">
                <h3 className="font-heading text-primary text-base leading-snug group-hover:underline underline-offset-4">
                  {item.title}
                </h3>
                {item.excerpt && (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{item.excerpt}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

async function resolveRelatedItems(post: BlogPost): Promise<RelatedItem[]> {
  const seo = post.seo_metadata as SeoMetadata | null
  const suggestions = (seo?.internal_link_suggestions ?? []) as SeoMetadataInternalLink[]
  if (suggestions.length > 0) {
    return suggestions.slice(0, 3).map((s) => ({
      title: s.title,
      slug: s.slug,
    }))
  }

  // Fallback: latest 3 in the same category.
  try {
    const fallback = await getRelatedPostsByCategory({
      category: post.category,
      excludeId: post.id,
      limit: 3,
    })
    return fallback.map((p) => ({
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? undefined,
      cover_image_url: p.cover_image_url ?? undefined,
    }))
  } catch (err) {
    console.warn(`[RelatedPosts] fallback query failed: ${(err as Error).message}`)
    return []
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(RelatedPosts|blog-posts\\.ts)" | head -20`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/blog-posts.ts components/marketing/blog/RelatedPosts.tsx
git commit -m "feat(blog): add RelatedPosts component + getRelatedPostsByCategory DAL (phase 4)"
```

---

## Task 9: Wire `<RelatedPosts>` into the public blog page

**Files:**
- Modify: `app/(marketing)/blog/[slug]/page.tsx`

- [ ] **Step 1: Add the import**

At the top of the file, alongside other component imports:

```ts
import { RelatedPosts } from "@/components/marketing/blog/RelatedPosts"
```

- [ ] **Step 2: Render between FAQ and bottom CTA**

Find the existing JSX. The current order (after Phase 3) is:
1. Article body (with ToC side rail)
2. `<BlogFaqSection entries={faqEntries} />`
3. Tags section
4. Bottom CTA

Insert `<RelatedPosts post={post} />` BETWEEN the Tags section and the Bottom CTA. Or, if more visually consistent, between the FAQ section and the Tags section. Place it where it reads like a natural "before you go" block — right above the conversion CTA is best.

```tsx
{/* FAQ */}
<BlogFaqSection entries={faqEntries} />

{/* Tags */}
{post.tags && post.tags.length > 0 && (
  <section className="py-8 px-4 sm:px-8">
    {/* ... existing tags markup ... */}
  </section>
)}

{/* Related posts */}
<RelatedPosts post={post} />

{/* CTA */}
{/* ... existing CTA ... */}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "blog/\\[slug\\]" | head -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/(marketing)/blog/[slug]/page.tsx'
git commit -m "feat(blog): render RelatedPosts on public post page (phase 4)"
```

---

## Task 10: Smoke verification

- [ ] **Step 1: Run full functions suite**

Run: `cd functions && npx vitest run 2>&1 | tail -5`
Expected: All tests pass; count up by ~18 from Phase 3 (~209 total: 191 pre-Phase-4 + 10 splice + 5 anchors + 3 voice-context).

- [ ] **Step 2: Run Phase-4-relevant Next.js tests**

Run: `npx vitest run __tests__/api/admin/blog/ __tests__/components/blog-generate-dialog-from-video.test.tsx 2>&1 | tail -5`
Expected: All pass; count up by 2 from the new content-angle tests (was 15, now 17).

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^__tests__" | head -30`
Expected: no NEW errors. Pre-existing test-file errors are unrelated.

- [ ] **Step 4: Final commit if any cleanup**

Skip if everything is clean.

---

## Acceptance criteria for Phase 4

- All 9 tasks committed.
- New `blog_posts` rows from a topic-suggestion path persist `content_angle` in the ai_jobs input (not in the row itself — it's a generation-time directive).
- The `[generate-from-suggestion] keyword="..." angle=yes for "..."` log line appears for any topic with a Tavily summary.
- Posts where seo-enhance found ≥1 anchor have `<a href="/blog/...">` links rendered in the article body (verified by inspecting `content` after seo-enhance completes).
- Posts where seo-enhance returned 0 anchors render unchanged content + the latest-3-in-category fallback for the related-posts block.
- The related-posts block on the public page renders 3 cards above the bottom CTA when ≥1 candidate exists.
- Internal link inserts cap at 3 per post even if Claude returns more.
- Hallucinated anchors (Claude returns a slug not in the suggestions list) are filtered out.
- No regressions in earlier phases.

## Out of scope (deferred to Phase 5)

- `lead_magnets` table + `<InlinePostNewsletterCapture>` + context-aware bottom CTA.
- Replacing the bottom "Book Free Consultation" hardcoded CTA.

---

## Execution

Proceeding directly with subagent-driven execution on `main`. No migration this phase.
