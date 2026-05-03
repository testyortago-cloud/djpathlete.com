# Blog Generation Quality — Phase 3: FAQ + Structured Data + ToC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Work directly on `main` (no feature branch — solo dev preference).

**Goal:** Every AI-generated blog post emits a 3–5 entry FAQ section that's rendered to HTML and emitted as `FAQPage` JSON-LD alongside the existing `BlogPosting` schema. Every `<h2>` gets an anchor id so a sticky `<TableOfContents />` can render on long posts. Author JSON-LD upgraded with `sameAs` social links + `jobTitle` + `image`. Admin can set a free-text `subcategory` to broaden topical authority without bloating the 4-value category enum.

**Architecture:** Two new schema columns (`faq jsonb default '[]'`, `subcategory text nullable`). The blog-generation Zod schema gains a `faq` array field; the handler injects anchor ids onto every `<h2>` before persisting and appends an `<section class="djp-faq">` block with native `<details>` elements (no JS needed). `seo-enhance` emits a second JSON-LD doc (`FAQPage`) when `faq` is populated; the renderer's `JsonLd` component now accepts `data` as either an object or an array of objects. A new `<TableOfContents />` reads `<h2[id]>` elements server-side via a small parse, renders sticky on lg+ and a collapsed `<details>` on mobile. `<lib/brand/author.ts>` centralizes the Person URL/sameAs/image so `BlogPosting`'s `author` block (and any future Author page) draws from one source.

**Tech Stack:** Firebase Functions Gen 2 (Node 22), `@anthropic-ai/sdk`, Zod, NextAuth v5, Next.js 16 App Router, Vitest, Tailwind v4, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-03-blog-generation-quality-design.md](../specs/2026-05-03-blog-generation-quality-design.md) — D5 (FAQ + FAQPage), D12 (anchor ids + ToC), D13 (Author JSON-LD), and the `subcategory` field from the spec's "Phase 3 columns" table.

**Migration apply:** Use `mcp__supabase__apply_migration` (CLI not linked).

---

## File Structure

### New files (Functions side)
- (none — `injectAnchorIds` and `spliceFaqSection` are added to existing `functions/src/lib/html-splice.ts`)

### New files (Next.js side)
- `supabase/migrations/00111_blog_faq_subcategory.sql` — schema columns + UPDATE the structural prompt_templates row to include FAQ
- `lib/brand/author.ts` — exported `DJP_AUTHOR_PERSON` constant for JSON-LD reuse
- `components/marketing/blog/TableOfContents.tsx` — server-rendered ToC with anchor links
- `components/marketing/blog/BlogFaqSection.tsx` — server-rendered FAQ accordion (native `<details>`)

### Modified files (Functions side)
- `functions/src/lib/html-splice.ts` — `injectAnchorIds(html)`, `extractH2Toc(html)` (helper used by renderer too)
- `functions/src/lib/__tests__/html-splice.test.ts` — tests for the two new helpers
- `functions/src/blog-generation.ts` — Zod schema gains `faq[]` + `subcategory?`; handler injects anchor ids on content before insert; persists `faq`, `subcategory`
- `functions/src/__tests__/blog-generation.test.ts` — fixtures + new test that anchor ids land on h2s
- `functions/src/seo-enhance.ts` — emit `FAQPage` JSON-LD when `faq` is populated; store under `seo_metadata.json_ld` as an array
- `functions/src/__tests__/seo-enhance.test.ts` — fixtures for FAQPage emission

### Modified files (Next.js side)
- `app/(marketing)/blog/[slug]/page.tsx` — render FAQ section after article body, pass JSON-LD as array, upgrade Author JSON-LD via `DJP_AUTHOR_PERSON`, render `<TableOfContents />` on posts >800 words
- `components/shared/JsonLd.tsx` — accept `data: object | object[]`; render multiple `<script>` tags when array
- `components/admin/blog/BlogPostForm.tsx` — `subcategory` text field (under SEO collapsible), FAQ editor (3-5 entries with question + answer textareas)
- `lib/validators/blog-post.ts` — schema additions: `faq[]` and `subcategory`
- `types/database.ts` — `BlogPost` gains `faq: FaqEntry[]` + `subcategory: string | null`; new exported `FaqEntry` interface

### Unchanged but referenced
- `00108_blog_generation_prompt_template.sql` — existing structural row gets UPDATEd in 00111
- `lib/db/blog-posts.ts` — DAL uses `select("*")`, additive columns flow through automatically

---

## Task 1: Migration `00111_blog_faq_subcategory.sql`

**Files:**
- Create: `supabase/migrations/00111_blog_faq_subcategory.sql`

- [ ] **Step 1: Create the migration file** with this exact content:

```sql
-- supabase/migrations/00111_blog_faq_subcategory.sql
-- Phase 3 of blog-generation-quality rollout.
-- (1) Adds FAQ + subcategory columns to blog_posts.
-- (2) Updates the structural blog_generation prompt_templates row to instruct
--     the model to emit a 3-5 entry faq array. Subcategory is optional and
--     not part of the AI output schema — it's a coach-facing field on the
--     edit form.

-- ─── (1) Schema additions ───────────────────────────────────────────────────

ALTER TABLE blog_posts
  ADD COLUMN faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN subcategory text;

CREATE INDEX idx_blog_posts_subcategory ON blog_posts(subcategory) WHERE subcategory IS NOT NULL;

COMMENT ON COLUMN blog_posts.faq IS
  'Array of { question, answer } pairs rendered as <details> blocks and emitted as FAQPage JSON-LD.';
COMMENT ON COLUMN blog_posts.subcategory IS
  'Free-text topical sub-classification (e.g. "Nutrition", "Mindset"). Complements the 4-value category enum without bloating it.';

-- ─── (2) Update structural prompt to include FAQ in the output schema ───────

UPDATE prompt_templates
SET prompt = $prompt$# OUTPUT SCHEMA
You must output a JSON object with these fields ONLY:
- title: 50-60 chars, SEO-friendly, primary keyword in first half (when supplied)
- slug: URL-friendly lowercase with hyphens, max 200 chars
- excerpt: 140-180 chars, includes primary keyword if supplied
- content: Full HTML body (rules below)
- category: One of "Performance" | "Recovery" | "Coaching" | "Youth Development"
- tags: 3-5 lowercase keyword tags
- meta_description: 140-150 chars (hard cap 160)
- faq: Array of 3-5 objects, each with: { question, answer }. Questions are 5-200 chars; answers are 20-800 chars. Cover real questions a reader would type into Google after reading the post. Don't repeat content already covered in the body — go deeper. The first FAQ should target the primary keyword.

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

# FAQ GUIDANCE
- 3-5 entries minimum.
- Phrase questions exactly as a reader would type them ("How long should I rest between sets?", not "Optimal rest periods").
- Answers are concise: 1-3 sentences each. Refer to the body if a fuller treatment exists there ("see the section above on...") but never copy-paste body content.
- Avoid yes/no questions unless the answer is genuinely binary; prefer "How", "When", "Why", "What" framings.
- The first FAQ entry MUST target the primary keyword (when one is supplied via SEO TARGET).

Output ONLY the JSON object, no preamble.$prompt$,
    updated_at = now()
WHERE name = 'DJP Athlete — Blog Generation Structure'
  AND category = 'blog_generation';
```

- [ ] **Step 2: Apply via MCP**

Use `mcp__supabase__apply_migration` with name `blog_faq_subcategory` and the SQL above (omit the comment header lines — pass pure SQL).

- [ ] **Step 3: Verify schema + prompt update**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'blog_posts'
  AND column_name IN ('faq', 'subcategory')
ORDER BY column_name;

SELECT length(prompt) AS prompt_len, prompt LIKE '%faq:%' AS has_faq, prompt LIKE '%# FAQ GUIDANCE%' AS has_faq_block
FROM prompt_templates
WHERE category = 'blog_generation';
```
Expected:
- 2 rows for the columns query.
- 1 row for the prompt query: `prompt_len ~3500-4000`, `has_faq=true`, `has_faq_block=true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00111_blog_faq_subcategory.sql
git commit -m "feat(blog): add faq + subcategory columns and FAQ instructions to prompt_templates (phase 3)"
```

---

## Task 2: Update Next.js validators + types

**Files:**
- Modify: `lib/validators/blog-post.ts`
- Modify: `types/database.ts`

- [ ] **Step 1: Extend `blog-post.ts` schema**

Open `lib/validators/blog-post.ts`. After the existing `inlineImageSchema` constant, add:

```ts
export const faqEntrySchema = z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(800),
})
```

Inside `blogPostFormSchema`, after `search_intent`:

```ts
faq: z.array(faqEntrySchema).max(5).optional().default([]),
subcategory: z
  .string()
  .max(80, "Subcategory must be under 80 characters")
  .nullable()
  .optional()
  .transform((v) => v || null),
```

After the `BlogPostFormData` type export, add:

```ts
export type FaqEntry = z.infer<typeof faqEntrySchema>
```

- [ ] **Step 2: Extend `BlogPost` interface**

Open `types/database.ts`. After the existing `BlogPost` interface block, add a new `FaqEntry` export ABOVE the `BlogPost` definition:

```ts
export interface FaqEntry {
  question: string
  answer: string
}
```

Inside `BlogPost` (after the `search_intent` field added in Phase 2), add:

```ts
faq: FaqEntry[]
subcategory: string | null
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(blog-post|database\\.ts)" | head -20`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/validators/blog-post.ts types/database.ts
git commit -m "feat(types): add faq + subcategory to BlogPost schema (phase 3)"
```

---

## Task 3: Add `injectAnchorIds` + `extractH2Toc` to `html-splice.ts`

**Files:**
- Modify: `functions/src/lib/html-splice.ts`
- Modify: `functions/src/lib/__tests__/html-splice.test.ts`

- [ ] **Step 1: Write failing tests**

Open `functions/src/lib/__tests__/html-splice.test.ts`. Add a new `describe` block at the bottom:

```ts
describe("injectAnchorIds", () => {
  it("adds id attributes to h2s based on slugified text", () => {
    const html = "<h2>Why Sleep Matters</h2><p>x</p><h2>How to Improve It</h2>"
    const out = injectAnchorIds(html)
    expect(out).toContain('<h2 id="why-sleep-matters">Why Sleep Matters</h2>')
    expect(out).toContain('<h2 id="how-to-improve-it">How to Improve It</h2>')
  })

  it("preserves existing attributes on h2", () => {
    const html = '<h2 class="foo">Section</h2>'
    const out = injectAnchorIds(html)
    expect(out).toContain('id="section"')
    expect(out).toContain('class="foo"')
  })

  it("does not duplicate id when one already exists", () => {
    const html = '<h2 id="custom-id">Section</h2>'
    const out = injectAnchorIds(html)
    expect(out).toBe(html)
  })

  it("strips inline tags from heading text when slugifying", () => {
    const html = "<h2>The <em>real</em> answer</h2>"
    const out = injectAnchorIds(html)
    expect(out).toContain('id="the-real-answer"')
  })

  it("dedupes ids across multiple h2s with the same heading", () => {
    const html = "<h2>FAQ</h2><p>x</p><h2>FAQ</h2>"
    const out = injectAnchorIds(html)
    expect(out).toContain('id="faq"')
    expect(out).toContain('id="faq-2"')
  })

  it("leaves h3 and other tags untouched", () => {
    const html = "<h2>A</h2><h3>B</h3>"
    const out = injectAnchorIds(html)
    expect(out).toContain('<h2 id="a">A</h2>')
    expect(out).toContain("<h3>B</h3>")
  })
})

describe("extractH2Toc", () => {
  it("returns id+text pairs in document order", () => {
    const html = '<h2 id="one">First</h2><p>x</p><h2 id="two">Second</h2>'
    expect(extractH2Toc(html)).toEqual([
      { id: "one", text: "First" },
      { id: "two", text: "Second" },
    ])
  })

  it("skips h2s without ids", () => {
    const html = '<h2 id="one">First</h2><h2>NoId</h2>'
    expect(extractH2Toc(html)).toEqual([{ id: "one", text: "First" }])
  })

  it("strips inline tags from text", () => {
    const html = '<h2 id="x">Why <strong>this</strong> works</h2>'
    expect(extractH2Toc(html)).toEqual([{ id: "x", text: "Why this works" }])
  })

  it("returns empty array when no h2s exist", () => {
    expect(extractH2Toc("<p>just paragraphs</p>")).toEqual([])
  })
})
```

Also add the imports at the top of the test file:
```ts
import { injectAnchorIds, extractH2Toc } from "../html-splice.js"
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd functions && npx vitest run src/lib/__tests__/html-splice.test.ts`
Expected: FAIL — `injectAnchorIds` and `extractH2Toc` not exported.

- [ ] **Step 3: Implement in `html-splice.ts`**

Open `functions/src/lib/html-splice.ts`. At the end of the file, add:

```ts
// ─── injectAnchorIds + extractH2Toc ────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

/**
 * Adds `id="<slug>"` to every <h2> that doesn't already have an id.
 * Slugifies the inner text. Dedupes by appending "-2", "-3", ... when
 * multiple headings would share the same slug.
 */
export function injectAnchorIds(html: string): string {
  const used = new Set<string>()
  return html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (full, attrs, inner) => {
    const existing = (attrs ?? "").match(/\sid\s*=\s*"[^"]*"/i)
    if (existing) return full

    const baseSlug = slugify(inner)
    if (!baseSlug) return full
    let slug = baseSlug
    let n = 2
    while (used.has(slug)) {
      slug = `${baseSlug}-${n++}`
    }
    used.add(slug)
    const newAttrs = attrs ? ` id="${slug}"${attrs}` : ` id="${slug}"`
    return `<h2${newAttrs}>${inner}</h2>`
  })
}

export interface TocEntry {
  id: string
  text: string
}

/**
 * Extracts an ordered list of { id, text } from h2s that already have
 * `id` attributes. Inline tags inside the heading are stripped.
 */
export function extractH2Toc(html: string): TocEntry[] {
  const result: TocEntry[] = []
  const regex = /<h2\s+([^>]*)>([\s\S]*?)<\/h2>/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    const idMatch = m[1].match(/\bid\s*=\s*"([^"]+)"/i)
    if (!idMatch) continue
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (!text) continue
    result.push({ id: idMatch[1], text })
  }
  return result
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `cd functions && npx vitest run src/lib/__tests__/html-splice.test.ts`
Expected: 10 new tests pass alongside any existing ones.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/html-splice.ts functions/src/lib/__tests__/html-splice.test.ts
git commit -m "feat(blog): add injectAnchorIds + extractH2Toc html-splice helpers (phase 3)"
```

---

## Task 4: Update `JsonLd` to accept arrays

**Files:**
- Modify: `components/shared/JsonLd.tsx`

- [ ] **Step 1: Replace the file** with:

```tsx
interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[]
}

export function JsonLd({ data }: JsonLdProps) {
  const docs = Array.isArray(data) ? data : [data]
  return (
    <>
      {docs.map((doc, idx) => (
        <script
          // eslint-disable-next-line react/no-array-index-key
          key={idx}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(doc) }}
        />
      ))}
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep JsonLd`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/shared/JsonLd.tsx
git commit -m "feat(seo): JsonLd accepts array data, renders multiple script tags (phase 3)"
```

---

## Task 5: Author constant

**Files:**
- Create: `lib/brand/author.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/brand/author.ts
// Single source of truth for the Person JSON-LD that appears on every blog
// post and (future) author page. Edit here, every consumer reflects it.
//
// Production URL is darrenjpaul.com (per project memory). Social links are
// the ones tied to the DJP Athlete brand. Update these with the actual
// canonical URLs when available.

export const DJP_AUTHOR_PERSON = {
  "@type": "Person" as const,
  name: "Darren J Paul",
  url: "https://www.darrenjpaul.com/about",
  jobTitle: "Strength & Conditioning Coach",
  image: "https://www.darrenjpaul.com/images/darren-headshot.jpg",
  sameAs: [
    "https://www.instagram.com/djpathlete",
    "https://www.linkedin.com/in/darren-paul",
    "https://www.youtube.com/@djpathlete",
  ],
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/brand/author.ts
git commit -m "feat(brand): add DJP_AUTHOR_PERSON constant for JSON-LD reuse (phase 3)"
```

---

## Task 6: Refactor `blog-generation.ts` for `faq` + anchor ids

**Files:**
- Modify: `functions/src/blog-generation.ts`
- Modify: `functions/src/__tests__/blog-generation.test.ts`

- [ ] **Step 1: Add a `faqEntrySchema` to `blogResultSchema`**

Open `functions/src/blog-generation.ts`. Just BEFORE the existing `blogResultSchema` declaration, add:

```ts
const faqEntrySchema = z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(800),
})
```

Extend the existing `blogResultSchema`. Find:
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

Replace with:
```ts
const blogResultSchema = z.object({
  title: z.string().min(20).max(120),
  slug: z.string().min(3).max(200),
  excerpt: z.string().min(80).max(280),
  content: z.string(),
  category: z.enum(["Performance", "Recovery", "Coaching", "Youth Development"]),
  tags: z.array(z.string()),
  meta_description: z.string().transform(capMetaDescription),
  faq: z.array(faqEntrySchema).max(5).optional().default([]),
})
```

(`faq` is `optional().default([])` so legacy mocked responses without faq still parse — important for backward-compat with existing tests.)

- [ ] **Step 2: Import `injectAnchorIds`**

Find the existing import lines. Add:

```ts
import { injectAnchorIds } from "./lib/html-splice.js"
```

- [ ] **Step 3: Inject anchor ids before persisting**

Find the existing `const validatedContent = await validateUrls(finalContent.content)` line (after the length-verifier branch). Right after that line, add:

```ts
const contentWithAnchors = injectAnchorIds(validatedContent)
```

Then update the next line (the spread that builds `finalResult`):

```ts
const finalResult = { ...finalContent, content: contentWithAnchors }
```

(Was `content: validatedContent`.)

- [ ] **Step 4: Persist `faq` to blog_posts**

Find the existing `.from("blog_posts").insert({ ... })` call. Add `faq` to the inserted object after `search_intent`:

```ts
faq: finalResult.faq ?? [],
```

(`subcategory` is NOT included — it's an admin-only edit field, not part of the AI output.)

- [ ] **Step 5: Update test fixtures + add new tests**

Open `functions/src/__tests__/blog-generation.test.ts`. The mocked Claude response in the existing happy-path test currently doesn't include `faq`. The new schema makes it optional with default `[]`, so existing tests should continue to pass without changes.

Add ONE new test inside the existing `describe(...)` block:

```ts
it("injects anchor ids on h2s and persists faq from the AI response", async () => {
  mockCallAgent.mockResolvedValue({
    content: {
      title: "T",
      slug: "t",
      excerpt: "e",
      content: "<h2>First Section</h2><p>x</p><h2>Second Section</h2>",
      category: "Performance",
      tags: ["a"],
      meta_description: "m",
      faq: [
        { question: "How long does it take?", answer: "It takes about 8 weeks to see results." },
        { question: "Is it safe for youth?", answer: "Yes — when supervised by a qualified coach." },
        { question: "Do I need equipment?", answer: "Bodyweight is enough for the first 4 weeks." },
      ],
    },
    tokens_used: 100,
  })
  await handleBlogGeneration("job-1")

  // Anchor ids appear in the persisted content
  expect(blogInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining('<h2 id="first-section">'),
      faq: expect.arrayContaining([
        expect.objectContaining({ question: "How long does it take?" }),
      ]),
    }),
  )
})
```

- [ ] **Step 6: Run tests**

Run: `cd functions && npx vitest run src/__tests__/blog-generation.test.ts`
Expected: All tests pass (existing + new).

- [ ] **Step 7: Run full functions suite**

Run: `cd functions && npx vitest run`
Expected: 178 + 10 (html-splice) + 1 (new blog-gen) = ~189 passing.

- [ ] **Step 8: Commit**

```bash
git add functions/src/blog-generation.ts functions/src/__tests__/blog-generation.test.ts
git commit -m "feat(blog): emit faq + inject anchor ids on h2s in handler (phase 3)"
```

---

## Task 7: Update `seo-enhance.ts` to emit `FAQPage` JSON-LD

**Files:**
- Modify: `functions/src/seo-enhance.ts`
- Modify: `functions/src/__tests__/seo-enhance.test.ts`

- [ ] **Step 1: Pull `faq` from the loaded post**

Open `functions/src/seo-enhance.ts`. Find the existing supabase select for the post (it currently selects fields including `inline_images`). Extend the select to include `faq`:

```ts
.select("id, title, slug, excerpt, content, tags, category, published_at, cover_image_url, inline_images, faq")
```

- [ ] **Step 2: Build the FAQPage JSON-LD when faq is populated**

After the existing `seoResult = await callAgent(...)` call (the one producing the `BlogPosting` JSON-LD as `seoResult.content.json_ld`), but BEFORE the `seoMetadata` object is constructed, add:

```ts
const faqEntries = (postRow.faq as Array<{ question: string; answer: string }> | null) ?? []
const faqPageJsonLd =
  faqEntries.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntries.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: f.answer,
          },
        })),
      }
    : null
```

- [ ] **Step 3: Store JSON-LD as an array under `seo_metadata.json_ld`**

Find the existing:
```ts
const seoMetadata = {
  meta_title: seoResult.content.meta_title,
  meta_description: seoResult.content.meta_description,
  keywords: seoResult.content.keywords,
  json_ld: seoResult.content.json_ld,
  internal_link_suggestions: suggestions,
  generated_at: new Date().toISOString(),
}
```

Replace with:
```ts
const jsonLdDocs: Record<string, unknown>[] = [seoResult.content.json_ld as Record<string, unknown>]
if (faqPageJsonLd) jsonLdDocs.push(faqPageJsonLd)

const seoMetadata = {
  meta_title: seoResult.content.meta_title,
  meta_description: seoResult.content.meta_description,
  keywords: seoResult.content.keywords,
  json_ld: jsonLdDocs,
  internal_link_suggestions: suggestions,
  generated_at: new Date().toISOString(),
}
```

- [ ] **Step 4: Add a test for FAQPage emission**

Open `functions/src/__tests__/seo-enhance.test.ts`. Find the existing happy-path test. Add a new test inside the same describe block:

```ts
it("emits FAQPage JSON-LD alongside BlogPosting when faq is populated", async () => {
  // The existing test setup mocks supabase.from("blog_posts").select(...).single()
  // Reuse that pattern, but include `faq` on the returned row.
  // (Adapt the mock chain to match the existing test's structure exactly —
  // the new bit is just adding `faq: [...]` to the returned blog_posts row.)
  // Assertion: the inserted seo_metadata.json_ld should be an array of length 2.
  //
  // Adapt to match the actual mock chain used by the existing tests.
  // If the test currently asserts on the supabase update call body, extend
  // the assertion:
  //
  //   expect(updateMock).toHaveBeenCalledWith({
  //     seo_metadata: expect.objectContaining({
  //       json_ld: expect.arrayContaining([
  //         expect.objectContaining({ "@type": "BlogPosting" }),
  //         expect.objectContaining({ "@type": "FAQPage" }),
  //       ]),
  //     }),
  //   })
})
```

(The exact mock-chain code will depend on the existing test's structure. Read the existing happy-path test first; the new test should mirror its setup with `faq: [...]` added to the returned post row.)

If the existing test's assertion checks `json_ld` as an object (not array), update that assertion to check for an array containing the BlogPosting object — backward-incompatible test fix because we're changing the persisted shape.

- [ ] **Step 5: Run tests**

Run: `cd functions && npx vitest run src/__tests__/seo-enhance.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add functions/src/seo-enhance.ts functions/src/__tests__/seo-enhance.test.ts
git commit -m "feat(seo): emit FAQPage JSON-LD alongside BlogPosting (phase 3)"
```

---

## Task 8: TableOfContents component

**Files:**
- Create: `components/marketing/blog/TableOfContents.tsx`

This is a server component (no `"use client"` directive). It accepts a list of `{ id, text }` entries and renders a sticky side rail on lg+ + a collapsed `<details>` block on mobile.

- [ ] **Step 1: Create the file**

```tsx
import { ListTree } from "lucide-react"

export interface TocEntry {
  id: string
  text: string
}

interface TableOfContentsProps {
  entries: TocEntry[]
}

/**
 * Renders an in-page table of contents from h2 anchor ids.
 * - On lg+: a sticky sidebar to the right of the article body.
 * - On mobile: a collapsed <details> block at the top of the article.
 *
 * Caller is responsible for only mounting this when entries.length >= 2.
 */
export function TableOfContents({ entries }: TableOfContentsProps) {
  if (entries.length < 2) return null

  return (
    <>
      {/* Mobile: collapsed details at top of article */}
      <details className="lg:hidden mb-6 rounded-lg border border-border bg-surface/40 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-primary inline-flex items-center gap-2">
          <ListTree className="size-4" />
          On this page
        </summary>
        <ul className="mt-3 space-y-1.5 text-sm">
          {entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                className="text-muted-foreground hover:text-primary hover:underline transition-colors"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ul>
      </details>

      {/* Desktop: sticky side rail */}
      <aside
        aria-label="Table of contents"
        className="hidden lg:block sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto"
      >
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent mb-3">
          ─ On this page
        </p>
        <ul className="space-y-2 text-sm">
          {entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                className="text-muted-foreground hover:text-primary transition-colors block leading-snug"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ul>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep TableOfContents`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/blog/TableOfContents.tsx
git commit -m "feat(blog): add TableOfContents component (sticky on lg+, collapsed on mobile) (phase 3)"
```

---

## Task 9: BlogFaqSection component

**Files:**
- Create: `components/marketing/blog/BlogFaqSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { FaqEntry } from "@/types/database"

interface BlogFaqSectionProps {
  entries: FaqEntry[]
}

/**
 * Renders an "FAQ" section using native <details>/<summary> for zero-JS
 * expand/collapse. Accessible by default (each <summary> is keyboard-
 * focusable and announces "expanded/collapsed" via the browser).
 *
 * Caller skips rendering when entries.length === 0.
 */
export function BlogFaqSection({ entries }: BlogFaqSectionProps) {
  if (entries.length === 0) return null

  return (
    <section className="djp-faq py-16 lg:py-20 px-4 sm:px-8 bg-surface">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-6">
          Frequently Asked Questions
        </h2>
        <ul className="space-y-3">
          {entries.map((entry, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-border bg-white"
            >
              <details className="group">
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4 p-4 sm:p-5">
                  <span className="font-heading text-primary text-base sm:text-lg leading-snug">
                    {entry.question}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-2xl text-muted-foreground leading-none transition-transform group-open:rotate-45 mt-0.5"
                  >
                    +
                  </span>
                </summary>
                <div className="px-4 pb-4 sm:px-5 sm:pb-5 text-muted-foreground leading-relaxed text-sm sm:text-base">
                  {entry.answer}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep BlogFaqSection`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/blog/BlogFaqSection.tsx
git commit -m "feat(blog): add BlogFaqSection component (phase 3)"
```

---

## Task 10: Public blog post page integration

**Files:**
- Modify: `app/(marketing)/blog/[slug]/page.tsx`

This task wires together the previous Phase 3 outputs: render the FAQ section after the article body, render the JsonLd as an array, upgrade Author JSON-LD via `DJP_AUTHOR_PERSON`, render `<TableOfContents />` when applicable.

- [ ] **Step 1: Read the current file**

Open `app/(marketing)/blog/[slug]/page.tsx`. Note the existing structure:
- `JsonLd` import + usage
- `blogPostSchema` constant (the BlogPosting object)
- `storedJsonLd` derivation
- The article body section
- The bottom CTA section

- [ ] **Step 2: Add new imports**

At the top of the file:

```ts
import { DJP_AUTHOR_PERSON } from "@/lib/brand/author"
import { TableOfContents } from "@/components/marketing/blog/TableOfContents"
import { BlogFaqSection } from "@/components/marketing/blog/BlogFaqSection"
import type { FaqEntry } from "@/types/database"
```

- [ ] **Step 3: Upgrade the inline `blogPostSchema.author` to `DJP_AUTHOR_PERSON`**

Find:
```ts
author: {
  "@type": "Person",
  name: "Darren J Paul",
  url: "https://djpathlete.com/about",
},
```

Replace with:
```ts
author: DJP_AUTHOR_PERSON,
```

- [ ] **Step 4: Update JSON-LD selection logic to handle stored array**

Find the existing:
```ts
const storedJsonLd = (post.seo_metadata as { json_ld?: Record<string, unknown> } | null)?.json_ld
const jsonLdData = storedJsonLd && Object.keys(storedJsonLd).length > 0 ? storedJsonLd : blogPostSchema
```

Replace with:
```ts
const storedJsonLd = (post.seo_metadata as { json_ld?: Record<string, unknown> | Record<string, unknown>[] } | null)
  ?.json_ld
const jsonLdData = (() => {
  if (Array.isArray(storedJsonLd) && storedJsonLd.length > 0) return storedJsonLd
  if (storedJsonLd && typeof storedJsonLd === "object" && Object.keys(storedJsonLd).length > 0) return storedJsonLd
  return blogPostSchema
})()
```

- [ ] **Step 5: Extract h2 ToC entries server-side**

The Functions handler already injected anchor ids. Read them server-side here for the ToC. Below the `jsonLdData` derivation, add:

```ts
const tocEntries: { id: string; text: string }[] = []
const h2Regex = /<h2\s+[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g
let h2Match: RegExpExecArray | null
const html = post.content as string
while ((h2Match = h2Regex.exec(html)) !== null) {
  const text = h2Match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  if (text) tocEntries.push({ id: h2Match[1], text })
}

const showToc = tocEntries.length >= 2 && (post.content as string).split(/\s+/).length >= 800
const faqEntries = ((post.faq as FaqEntry[] | null) ?? []) as FaqEntry[]
```

- [ ] **Step 6: Render `<TableOfContents />` and `<BlogFaqSection />`**

Find the existing article body section. The current layout is `<section> <div class="max-w-3xl"> <article ... /> </div> </section>`.

Update the layout to support a side rail on lg+:

```tsx
{/* Article Body + ToC */}
<section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
  <div className="max-w-5xl mx-auto lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
    {showToc ? <TableOfContents entries={tocEntries} /> : <div className="hidden lg:block" />}
    <div className="max-w-3xl mx-auto lg:mx-0">
      {showToc && <TableOfContents entries={tocEntries} />}
      <article
        className="prose prose-lg max-w-none text-muted-foreground prose-headings:font-heading prose-headings:text-primary prose-a:text-primary prose-strong:text-foreground prose-img:rounded-xl prose-h2:scroll-mt-24"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />
    </div>
  </div>
</section>
```

(Note: the `TableOfContents` component renders BOTH the sticky side rail AND the mobile `<details>` from a single mount. The mobile `<details>` is `lg:hidden` and the sticky `<aside>` is `hidden lg:block`. So mounting it once in the article column works for both. The first `<TableOfContents>` in the grid sidebar slot can render only the sticky sidebar, but since the component already gates by viewport via Tailwind, mounting it in the article column is the simplest path. Remove the duplicate render in the `<div className="max-w-3xl ..."` slot — keep ONE mount.)

Simplified rewrite:

```tsx
{/* Article Body + ToC */}
<section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
  <div className="max-w-5xl mx-auto lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
    <div className="lg:block">
      {showToc && <TableOfContents entries={tocEntries} />}
    </div>
    <div className="max-w-3xl mx-auto lg:mx-0">
      <article
        className="prose prose-lg max-w-none text-muted-foreground prose-headings:font-heading prose-headings:text-primary prose-a:text-primary prose-strong:text-foreground prose-img:rounded-xl prose-h2:scroll-mt-24"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />
    </div>
  </div>
</section>

{/* FAQ */}
<BlogFaqSection entries={faqEntries} />
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "blog/\\[slug\\]" | head -10`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add app/\(marketing\)/blog/\[slug\]/page.tsx
git commit -m "feat(blog): render FAQ + ToC + upgraded Author JSON-LD on public post page (phase 3)"
```

---

## Task 11: BlogPostForm — subcategory + FAQ editor

**Files:**
- Modify: `components/admin/blog/BlogPostForm.tsx`

The form should let admins edit the new fields on existing posts. Keep it minimal — text inputs for question + answer, max 5 entries.

- [ ] **Step 1: Read the current file**

Open `components/admin/blog/BlogPostForm.tsx`. Find:
- The form state initialization (uses post fields).
- The submit handler (POSTs to update endpoint).
- Where to insert the new fields (an existing "SEO" or similar collapsible is the natural home).

- [ ] **Step 2: Wire `faq` and `subcategory` into form state**

Add the fields to the form's defaultValues / state hook (mirroring how `primary_keyword` was added in Phase 2):

For `faq`: an array of `{ question, answer }` objects, default `post.faq ?? []`.
For `subcategory`: a string, default `post.subcategory ?? ""`.

- [ ] **Step 3: Add a `subcategory` text input**

Place it under the SEO section (or next to `primary_keyword` if a flat layout is in use):

```tsx
<div>
  <label className="block text-sm font-medium text-foreground mb-1">
    Subcategory <span className="text-muted-foreground text-xs">(optional)</span>
  </label>
  <input
    type="text"
    value={subcategory}
    onChange={(e) => setSubcategory(e.target.value)}
    placeholder="e.g., Nutrition, Mindset, Injury Prevention"
    className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
    maxLength={80}
  />
  <p className="text-xs text-muted-foreground mt-1">
    Free-text topical sub-classification. Complements the 4-value Category.
  </p>
</div>
```

- [ ] **Step 4: Add an FAQ editor**

A simple repeating form: each entry has a question input and an answer textarea, plus add/remove buttons. Cap at 5 entries.

```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <label className="block text-sm font-medium text-foreground">
      FAQ <span className="text-muted-foreground text-xs">(3-5 entries recommended)</span>
    </label>
    <button
      type="button"
      onClick={() => setFaq((prev) => [...prev, { question: "", answer: "" }])}
      disabled={faq.length >= 5}
      className="text-xs font-medium px-2 py-1 rounded-md border border-border hover:bg-surface disabled:opacity-40"
    >
      + Add entry
    </button>
  </div>
  {faq.map((entry, idx) => (
    <div key={idx} className="rounded-lg border border-border bg-white p-3 space-y-2">
      <div className="flex items-start gap-2">
        <input
          type="text"
          value={entry.question}
          onChange={(e) =>
            setFaq((prev) => prev.map((p, i) => (i === idx ? { ...p, question: e.target.value } : p)))
          }
          placeholder="Question"
          className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          maxLength={200}
        />
        <button
          type="button"
          onClick={() => setFaq((prev) => prev.filter((_, i) => i !== idx))}
          aria-label={`Remove FAQ ${idx + 1}`}
          className="text-muted-foreground hover:text-red-500 px-2 py-1.5"
        >
          ×
        </button>
      </div>
      <textarea
        value={entry.answer}
        onChange={(e) =>
          setFaq((prev) => prev.map((p, i) => (i === idx ? { ...p, answer: e.target.value } : p)))
        }
        placeholder="Answer (1-3 sentences)"
        rows={3}
        maxLength={800}
        className="w-full px-2.5 py-1.5 rounded-md border border-border bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  ))}
  {faq.length === 0 && (
    <p className="text-xs text-muted-foreground italic">No FAQ entries yet — click "+ Add entry" to start.</p>
  )}
</div>
```

- [ ] **Step 5: Include the new fields in the submit body**

Wherever the submit handler builds its POST body, add `faq` and `subcategory: subcategory.trim() || null`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep BlogPostForm`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add components/admin/blog/BlogPostForm.tsx
git commit -m "feat(admin): BlogPostForm gains subcategory + faq editor (phase 3)"
```

---

## Task 12: Smoke verification

- [ ] **Step 1: Verify schema applied**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'blog_posts' AND column_name IN ('faq', 'subcategory');
```
Expected: 2 rows.

- [ ] **Step 2: Verify the structural prompt was updated**

```sql
SELECT length(prompt), prompt LIKE '%# FAQ GUIDANCE%' AS has_faq_guidance
FROM prompt_templates WHERE category = 'blog_generation';
```
Expected: prompt length > 3500, has_faq_guidance = true.

- [ ] **Step 3: Run full functions suite**

Run: `cd functions && npx vitest run`
Expected: all tests pass; count gained ~12 (10 html-splice + 1 blog-gen + 1 seo-enhance).

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^__tests__" | head -30`
Expected: no NEW errors. Pre-existing errors in test files unrelated.

- [ ] **Step 5: Final commit if any cleanup**

```bash
git status
# if dirty:
git add -A && git commit -m "chore(blog): Phase 3 smoke cleanup"
```

---

## Acceptance criteria for Phase 3

- All 11 tasks committed.
- New `blog_posts` rows have a populated `faq` array (size 3-5).
- Server-rendered `<h2>` tags on the public post page include `id` attributes.
- Posts with `faq.length > 0` emit two JSON-LD docs in `<head>`: BlogPosting + FAQPage.
- The FAQPage validates in [Schema.org validator](https://validator.schema.org/) on a freshly published post.
- Author JSON-LD includes `sameAs`, `jobTitle`, `image` from `DJP_AUTHOR_PERSON`.
- The ToC sidebar renders on posts ≥ 800 words with at least 2 h2s; otherwise it does not render.
- BlogPostForm exposes the FAQ editor + subcategory text input.
- No regressions in earlier phases.

## Out of scope (deferred)

- Internal-link splicing in the article body (Phase 4 spec D6).
- Tavily-summary "angle" injection (Phase 4 spec D14).
- `lead_magnets` table + InlinePostNewsletterCapture + ContextualCta (Phase 5 spec D8/D9/D10).
- LoRA fine-tune for hero images (Phase 6).

---

## Execution

Proceeding directly with subagent-driven execution on `main`. Migration applied via Supabase MCP per saved memory.
