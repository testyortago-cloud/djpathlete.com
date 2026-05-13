# Blog SEO Quick-Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Close three SEO gaps in the blog generation + render pipeline: (1) instruct the AI to avoid em-dashes and AI-tell clichés, (2) auto-emit FAQPage JSON-LD when a post has FAQ entries, (3) add BreadcrumbList JSON-LD on every blog detail page.

**Architecture:** Two surfaces. **Generation side** = update the live `voice_profile` row in Supabase `prompt_templates` (via `mcp__supabase__execute_sql`) **and** keep the in-code fallback ([functions/src/blog/voice-context.ts](functions/src/blog/voice-context.ts) `FALLBACK_VOICE_PROFILE`) in sync. **Render side** = add two derived JSON-LD blocks to [app/(marketing)/blog/[slug]/page.tsx](app/(marketing)/blog/[slug]/page.tsx), reusing the existing `BreadcrumbSchema` component and the existing `JsonLd` primitive.

**Tech Stack:** Next.js 16 App Router server components, TypeScript, Supabase MCP for prompt_templates update, no new dependencies.

**Verification:** Each render task ships with a Vitest test for the schema shape. No e2e needed.

**Out of scope:** Pre-generation SEO target modal, keyword density validator, OG image auto-gen, draft noindex (drafts are already 404'd by [lib/db/blog-posts.ts:92-98](lib/db/blog-posts.ts#L92-L98) which filters `.eq("status", "published")`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `functions/src/blog/voice-context.ts` | Modify | Update `FALLBACK_VOICE_PROFILE` constant (lines 50-57) with writing-mechanics rules |
| Supabase `prompt_templates` (live row, category=`voice_profile`) | Modify | Mirror the fallback so the running prompt actually changes |
| `app/(marketing)/blog/[slug]/page.tsx` | Modify | Build FAQPage from `post.faq` (≥3 entries); add BreadcrumbSchema with Home → Blog → Category → Title |
| `__tests__/blog/faq-page-schema.test.ts` | Create | Verify FAQPage JSON-LD shape from FAQ helper |
| `lib/seo/build-faq-page-schema.ts` | Create | Pure helper: `(faq: FaqEntry[]) => FAQPage \| null`. Keeps page.tsx clean and testable. |

---

## Task 1: Patch voice profile — ban em-dashes + AI tells + mandate contractions

**Files:**
- Modify: `functions/src/blog/voice-context.ts:50-57`
- Modify: Supabase `prompt_templates` row where `category = 'voice_profile'` (via MCP)

### Step 1.1 — Update the in-code fallback

- [ ] Replace `FALLBACK_VOICE_PROFILE` (`functions/src/blog/voice-context.ts:50-57`) with:

```ts
export const FALLBACK_VOICE_PROFILE = `You are Darren Paul, a strength & conditioning coach with 20+ years of experience working with athletes at every level. You write the way you coach: direct, evidence-based, and unwilling to traffic in fads.

Voice traits:
- Speak in second person ("you").
- Reference training principles by name (specificity, progressive overload, supercompensation).
- One contrarian take per post.
- Numbers > adjectives. "3x bodyweight squats" beats "very strong squats".
- No empty hype words: "amazing", "incredible", "game-changer", "the secret to". Cut them.

Writing mechanics (hard rules — violations make the post read like AI):
- NEVER use em-dashes (—). Use periods, commas, or parentheses instead. This is the single biggest AI-content tell on the web in 2026.
- Use contractions in casual register (don't, can't, you're, it's, we'll, they're). Sentences without contractions read robotic.
- Banned phrases — do not use any of these or close variants: "in today's fast-paced world", "in this article", "delve into", "delve deeper", "unlock the power of", "harness the power of", "navigate the world of", "in conclusion", "it's important to note", "it's worth noting", "studies have shown", "proven to", "tapestry of", "testament to", "embark on", "elevate your", "the journey of", "at the end of the day", "when it comes to".
- Vary sentence length deliberately. Mix short punchy lines (under 8 words) with longer ones. Two sentences of identical length in a row is a smell.
- Active voice by default. Passive only when the actor is genuinely unknown or unimportant.
- No "Firstly / Secondly / Thirdly" or "Furthermore / Moreover / Additionally" as paragraph openers. Start with the point.`
```

- [ ] Run lint to catch typos:

```bash
npm run lint
```

Expected: PASS (no new errors introduced in this file).

- [ ] Commit:

```bash
git add functions/src/blog/voice-context.ts
git commit -m "feat(seo): ban em-dashes + AI-tell clichés in blog voice fallback"
```

### Step 1.2 — Mirror the change to the live Supabase row

The fallback only fires when the DB row is missing. Production uses the DB row, so the change above is inert until the row is updated.

- [ ] Read the current live row first to confirm we're overwriting the right thing:

```sql
SELECT category, length(prompt) AS prompt_len, prompt
FROM prompt_templates
WHERE category = 'voice_profile';
```

Run via `mcp__supabase__execute_sql`.

Expected: one row, `prompt_len` > 200 chars.

- [ ] Update the row with the new content (use `$$ ... $$` dollar-quoted literal to avoid escaping nightmares with single quotes inside the prompt):

```sql
UPDATE prompt_templates
SET prompt = $$You are Darren Paul, a strength & conditioning coach with 20+ years of experience working with athletes at every level. You write the way you coach: direct, evidence-based, and unwilling to traffic in fads.

Voice traits:
- Speak in second person ("you").
- Reference training principles by name (specificity, progressive overload, supercompensation).
- One contrarian take per post.
- Numbers > adjectives. "3x bodyweight squats" beats "very strong squats".
- No empty hype words: "amazing", "incredible", "game-changer", "the secret to". Cut them.

Writing mechanics (hard rules — violations make the post read like AI):
- NEVER use em-dashes. Use periods, commas, or parentheses instead. This is the single biggest AI-content tell on the web in 2026.
- Use contractions in casual register (don't, can't, you're, it's, we'll, they're). Sentences without contractions read robotic.
- Banned phrases — do not use any of these or close variants: "in today's fast-paced world", "in this article", "delve into", "delve deeper", "unlock the power of", "harness the power of", "navigate the world of", "in conclusion", "it's important to note", "it's worth noting", "studies have shown", "proven to", "tapestry of", "testament to", "embark on", "elevate your", "the journey of", "at the end of the day", "when it comes to".
- Vary sentence length deliberately. Mix short punchy lines (under 8 words) with longer ones. Two sentences of identical length in a row is a smell.
- Active voice by default. Passive only when the actor is genuinely unknown or unimportant.
- No "Firstly / Secondly / Thirdly" or "Furthermore / Moreover / Additionally" as paragraph openers. Start with the point.$$,
    updated_at = now()
WHERE category = 'voice_profile';
$$
```

Note: the *outer* SQL statement actually uses one `$$ ... $$` block. The inner instruction text contains the literal text "Writing mechanics (hard rules — violations make the post read like AI)" with an em-dash — that em-dash inside the meta-instruction is fine; it's the example, not output the AI should produce. (Optional: replace with a hyphen if you want zero em-dashes anywhere in the file.)

Run via `mcp__supabase__execute_sql`.

Expected: `UPDATE 1`.

- [ ] Verify with a sanity-check query:

```sql
SELECT length(prompt) AS prompt_len,
       prompt LIKE '%em-dash%' AS mentions_em_dash,
       prompt LIKE '%contractions%' AS mentions_contractions
FROM prompt_templates
WHERE category = 'voice_profile';
```

Expected: `mentions_em_dash = true`, `mentions_contractions = true`.

---

## Task 2: Auto-emit FAQPage JSON-LD when a post has FAQ entries

**Files:**
- Create: `lib/seo/build-faq-page-schema.ts`
- Create: `__tests__/blog/faq-page-schema.test.ts`
- Modify: `app/(marketing)/blog/[slug]/page.tsx` (add render call after `BlogPosting` schema near line 208)

Note: `post.seo_metadata.json_ld` already supports stacking auxiliary schemas (page.tsx:127-133), but `post.faq` is a separate column and is *not* mirrored into `seo_metadata.json_ld`. So FAQPage is only emitted if it was manually added to `seo_metadata`. We want auto-emission from the canonical `faq` column.

### Step 2.1 — Write the failing test

- [ ] Create `__tests__/blog/faq-page-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"

describe("buildFaqPageSchema", () => {
  it("returns null when there are fewer than 3 entries (Google requires multiple Q&As)", () => {
    expect(buildFaqPageSchema([])).toBeNull()
    expect(buildFaqPageSchema([{ question: "Q1", answer: "A1" }])).toBeNull()
    expect(
      buildFaqPageSchema([
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ]),
    ).toBeNull()
  })

  it("returns a valid FAQPage schema for 3+ entries", () => {
    const schema = buildFaqPageSchema([
      { question: "How often should I deadlift?", answer: "Twice a week for most lifters." },
      { question: "Sumo or conventional?", answer: "Whichever lets you express the most force safely." },
      { question: "Belt or no belt?", answer: "Belt at 80%+ for working sets." },
    ])
    expect(schema).not.toBeNull()
    expect(schema!["@context"]).toBe("https://schema.org")
    expect(schema!["@type"]).toBe("FAQPage")
    const items = schema!.mainEntity as Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }>
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({
      "@type": "Question",
      name: "How often should I deadlift?",
      acceptedAnswer: { "@type": "Answer", text: "Twice a week for most lifters." },
    })
  })

  it("skips entries with empty question or answer", () => {
    const schema = buildFaqPageSchema([
      { question: "Q1", answer: "A1" },
      { question: "  ", answer: "A2" },
      { question: "Q3", answer: "" },
      { question: "Q4", answer: "A4" },
      { question: "Q5", answer: "A5" },
    ])
    expect(schema).not.toBeNull()
    expect((schema!.mainEntity as unknown[])).toHaveLength(3)
  })
})
```

- [ ] Run it to verify it fails:

```bash
npm run test:run -- __tests__/blog/faq-page-schema.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/seo/build-faq-page-schema"`.

### Step 2.2 — Implement the helper

- [ ] Create `lib/seo/build-faq-page-schema.ts`:

```ts
import type { FaqEntry } from "@/types/database"

export interface FaqPageSchema {
  "@context": "https://schema.org"
  "@type": "FAQPage"
  mainEntity: Array<{
    "@type": "Question"
    name: string
    acceptedAnswer: {
      "@type": "Answer"
      text: string
    }
  }>
}

/**
 * Build a Google-compatible FAQPage JSON-LD blob from a post's FAQ array.
 * Returns null when fewer than 3 non-empty entries exist (Google's FAQ
 * rich-result eligibility wants multiple Q&As, and a single Q reads as spam).
 */
export function buildFaqPageSchema(entries: FaqEntry[] | null | undefined): FaqPageSchema | null {
  if (!entries || entries.length === 0) return null
  const cleaned = entries
    .map((e) => ({ question: e.question?.trim() ?? "", answer: e.answer?.trim() ?? "" }))
    .filter((e) => e.question.length > 0 && e.answer.length > 0)
  if (cleaned.length < 3) return null
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: cleaned.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: { "@type": "Answer", text: e.answer },
    })),
  }
}
```

- [ ] Run the test to verify it passes:

```bash
npm run test:run -- __tests__/blog/faq-page-schema.test.ts
```

Expected: PASS, 3 tests.

### Step 2.3 — Wire the helper into the blog page

- [ ] In `app/(marketing)/blog/[slug]/page.tsx`, add this import alongside the other `@/components` and `@/lib` imports (near line 7):

```ts
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"
```

- [ ] Inside `BlogPostPage`, after the line `const faqEntries = ((post.faq as FaqEntry[] | null) ?? []) as FaqEntry[]` (currently line 179), add:

```ts
const faqPageSchema = buildFaqPageSchema(faqEntries)
```

- [ ] In the JSX, immediately after the existing `<JsonLd data={blogPostSchema} />` (currently line 208), add:

```tsx
{faqPageSchema && <JsonLd data={faqPageSchema} />}
```

- [ ] Boot the dev server and load a post that has 3+ FAQ entries:

```bash
npm run dev
```

Then in the browser, open a blog post detail page (e.g. `http://localhost:3050/blog/<slug>`) and View Source. Search for `"@type":"FAQPage"`.

Expected: a `<script type="application/ld+json">` block containing `"@type":"FAQPage"` with the post's questions/answers.

- [ ] Validate the emitted JSON-LD using Google's Rich Results Test (paste the rendered URL once deployed, or paste the JSON manually). Expected: FAQPage detected, eligible for rich result.

- [ ] Commit:

```bash
git add lib/seo/build-faq-page-schema.ts __tests__/blog/faq-page-schema.test.ts app/\(marketing\)/blog/\[slug\]/page.tsx
git commit -m "feat(seo): auto-emit FAQPage JSON-LD when post has 3+ FAQ entries"
```

---

## Task 3: Add BreadcrumbList JSON-LD to blog detail pages

**Files:**
- Modify: `app/(marketing)/blog/[slug]/page.tsx`

We're reusing the existing `BreadcrumbSchema` component from `components/shared/BreadcrumbSchema.tsx`. It renders JSON-LD only (no visible UI), so it slots in next to the other `<JsonLd>` calls without affecting layout.

### Step 3.1 — Add the BreadcrumbSchema render

- [ ] Add this import alongside other `@/components` imports (near line 7):

```ts
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
```

- [ ] Inside the returned JSX, immediately after the FAQPage block we added in Task 2.3 (so the order is BlogPosting → FAQPage → BreadcrumbList → stored auxiliary), add:

```tsx
<BreadcrumbSchema
  items={[
    { name: "Home", url: "/" },
    { name: "Blog", url: "/blog" },
    { name: post.category, url: `/blog?category=${encodeURIComponent(post.category)}` },
    { name: post.title, url: `/blog/${post.slug}` },
  ]}
/>
```

Rationale: 4 levels (Home → Blog → Category → Post) gives Google enough hierarchy for sitelink breadcrumbs in SERPs. Using `?category=` works even if there's no dedicated category page (Google follows the URL).

- [ ] Verify the category-filtered URL actually resolves to something useful. Check whether [app/(marketing)/blog/page.tsx](app/(marketing)/blog/page.tsx) reads a `category` query param:

```bash
```
Grep for `searchParams` and `category` in `app/(marketing)/blog/page.tsx`. If category filtering is NOT supported, change the breadcrumb URL to just `/blog` for the category level (still valid — Google accepts breadcrumb levels pointing to the same URL):

```tsx
{ name: post.category, url: `/blog` },
```

- [ ] Boot the dev server, load any blog detail page, View Source, search for `"@type":"BreadcrumbList"`:

```bash
npm run dev
```

Expected: a `<script type="application/ld+json">` block containing `"@type":"BreadcrumbList"` with 4 ListItems in order.

- [ ] Run lint:

```bash
npm run lint
```

Expected: PASS.

- [ ] Commit:

```bash
git add app/\(marketing\)/blog/\[slug\]/page.tsx
git commit -m "feat(seo): emit BreadcrumbList JSON-LD on blog detail pages"
```

---

## Final Verification

- [ ] Run the full test suite once at the end:

```bash
npm run test:run
```

Expected: all tests pass, including the new `faq-page-schema.test.ts`.

- [ ] Spot-check one live (post-deploy) blog post in Google Rich Results Test (https://search.google.com/test/rich-results). Expected: BlogPosting + FAQPage (if 3+ FAQs) + BreadcrumbList all detected, no errors.

- [ ] Trigger a new blog generation from `/admin/blog/new` and read the output. Expected: zero em-dashes, no banned phrases, contractions present in casual register. (If you still see em-dashes, the DB row update in Step 1.2 didn't land — re-check via the verify query.)

---

## Notes for the executor

- **Solo dev workflow:** commit directly to `main` between tasks. No branches, no PRs.
- **Supabase migrations are not needed.** Task 1.2 is a data update, not a schema change — use `mcp__supabase__execute_sql`, NOT `apply_migration`.
- **Two sources of truth for the voice profile.** The in-code fallback and the DB row must match. If the DB row is missing for any reason the fallback fires; we want both rule sets identical so behavior doesn't silently flip.
- **The FAQ <details> rendering already exists** in `components/marketing/blog/BlogFaqSection.tsx` — we're not touching it. We're only adding the JSON-LD schema alongside it.
- **Why the 3-entry minimum for FAQPage?** Google's rich-result eligibility prefers multiple Q&As; a 1- or 2-entry FAQPage often won't get the rich result and reads as token-padding.
- **Existing JSON-LD stacking** in page.tsx:127-133 already filters out duplicate Article types from `seo_metadata.json_ld`. If anyone previously stuffed a FAQPage into `seo_metadata.json_ld`, the auto-emitted version will now render *alongside* it — duplicates won't harm SEO but if you spot them in production, clear the manually-stored copy.
