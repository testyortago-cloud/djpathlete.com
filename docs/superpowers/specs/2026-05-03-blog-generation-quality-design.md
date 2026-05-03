# Blog Generation Quality — Brand Voice, SEO, and Lead Capture — Design Spec

**Date:** 2026-05-03
**Status:** Draft, ready for plan-drafting
**Author audit:** see conversation transcript 2026-05-03 (17 findings across `blog-generation.ts`, `seo-enhance.ts`, `image-prompts.ts`, `app/(marketing)/blog/[slug]/page.tsx`, and the `voice_profile` / `few_shot_examples` data plane)
**Related existing specs:**
- [docs/superpowers/specs/2026-05-02-blog-pipeline-images-phase1-design.md](./2026-05-02-blog-pipeline-images-phase1-design.md)
- [docs/superpowers/specs/2026-04-21-starter-ai-automation-phase5e-voice-drift-monitor-design.md](./2026-04-21-starter-ai-automation-phase5e-voice-drift-monitor-design.md)
- [docs/superpowers/specs/2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md](./2026-04-21-starter-ai-automation-phase5f-performance-learning-loop-design.md)
- [docs/superpowers/specs/2026-04-20-starter-ai-automation-phase-4d-trending-seo-design.md](./2026-04-20-starter-ai-automation-phase-4d-trending-seo-design.md)

---

## Problem statement

The DJP Athlete blog pipeline ships content end-to-end (Tavily → topic suggestions → `blog_generation` → `blog_image_generation` → `seo_enhance` → publish), but the output today underperforms on the three goals the business actually cares about:

1. **Brand voice** — `prompt_templates.voice_profile` is seeded ([migration 00081](../../../supabase/migrations/00081_extend_prompt_templates_categories.sql)), audited weekly by `voice-drift-monitor` ([functions/src/voice-drift-monitor.ts:69-80](../../../functions/src/voice-drift-monitor.ts#L69-L80)), and edited by the coach in the admin UI — but never **read** by the generator. `prompt_templates.few_shot_examples` ([migration 00091](../../../supabase/migrations/00091_prompt_templates_few_shot.sql)) is populated weekly by `performanceLearningLoop` and likewise never read. The hardcoded system prompt at [functions/src/blog-generation.ts:9-61](../../../functions/src/blog-generation.ts#L9-L61) ignores both. Drift is detected, never prevented; learning is recorded, never applied.

2. **SEO** — content is generated **first**, then `seo-enhance` retrofits `meta_title` / `keywords` after publish ([functions/src/seo-enhance.ts:72-96](../../../functions/src/seo-enhance.ts#L72-L96)). Claude has no keyword target while writing, so the title, h1, h2s, and intro miss search-intent terms. Internal-link suggestions are computed via tag overlap ([functions/src/seo-enhance.ts:175-190](../../../functions/src/seo-enhance.ts#L175-L190)) and stored in `seo_metadata.internal_link_suggestions`, then **never rendered** by [app/(marketing)/blog/[slug]/page.tsx:144-148](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx#L144-L148). FAQ schema and PAA hooks are absent — a top-3 SEO lever in 2025–26 left on the table.

3. **Leads** — every post ends with the same hardcoded "Book Free Consultation" CTA ([app/(marketing)/blog/[slug]/page.tsx:167-191](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx#L167-L191)). No mid-content newsletter capture, no related-post block, no contextual program plug, no lead magnet. Top-of-funnel readers in research mode get a sales-call ask — the highest-friction conversion possible.

This spec consolidates the 17 specific findings from the audit into a phased rollout that starts foundational (voice/data plane) and ends with conversion polish.

---

## Goals

1. **Voice consistency** — every AI-generated blog post inherits the active `voice_profile` and is conditioned on the freshest `few_shot_examples`, so weekly drift trends down and the learning loop closes.
2. **Search performance** — every post is generated to a declared `primary_keyword` + 2–3 `secondary_keywords`, structured for readability, includes a 3–5 question FAQ section, and emits both `BlogPosting` and `FAQPage` JSON-LD.
3. **Lead capture** — every post offers (a) a mid-content newsletter capture, (b) a context-aware program plug when topically relevant, (c) related posts at the bottom — all driven by data, not hardcoded boilerplate.
4. **Internal-link execution** — link suggestions computed by `seo-enhance` are actually injected into post HTML at relevant section boundaries, not stranded in a JSON column.
5. **No regression** — existing publishing flow, drafts already in DB, and the topic-suggestion / blog-image-generation chain continue to work unchanged. New columns default to safe values.
6. **Match djpathlete conventions** — Firebase Functions for compute, `ai_jobs` doc-trigger pattern, Supabase as source of truth, Zod validators, `lib/db/` DAL, `prompt_templates` as the brand-voice surface area.

## Non-goals (explicitly deferred)

- A/B testing of CTA variants or keyword density rules. Single canonical structure ships first; experimentation later.
- Programmatic SEO (mass page generation from a keyword set). Human-in-the-loop topic suggestion remains the only entry point.
- Per-author voice profiles. One voice profile, one author (Darren Paul), for now.
- Streaming generation UI. Existing `useAiJob` polling is sufficient.
- Rich text editor changes for the new fields beyond what `BlogPostForm` already does (text inputs / textareas).
- Dynamic lead-magnet generation. Phase 5 ships a static catalog admin can edit; AI-generated lead magnets defer.
- Replacing the 4 fixed categories with a free-form taxonomy. Phase 3 adds a free-text `subcategory` field; the enum stays.
- Visual hero-image identity (LoRA fine-tune, brand color treatment). Listed as Phase 6 but considered exploratory.

---

## Existing patterns to follow

| Pattern | File / location | What we reuse |
|---|---|---|
| Voice profile data plane | `prompt_templates.category = 'voice_profile'` ([migration 00081](../../../supabase/migrations/00081_extend_prompt_templates_categories.sql)) | Read once per generation, prepend to system prompt |
| Few-shot examples | `prompt_templates.few_shot_examples` JSONB ([migration 00091](../../../supabase/migrations/00091_prompt_templates_few_shot.sql)) | Inject as user/assistant turns before the real user message |
| Job-trigger via Firestore | `ai_jobs/{jobId}` doc create ([functions/src/index.ts](../../../functions/src/index.ts)) | No new types — extend existing `blog_generation` and `seo_enhance` handlers |
| Claude wrapper | [functions/src/ai/anthropic.ts](../../../functions/src/ai/anthropic.ts) (`callAgent`, `MODEL_SONNET`) | Reuse for all phases; the Zod schema is what changes |
| HTML splice helper | [functions/src/lib/html-splice.ts](../../../functions/src/lib/html-splice.ts) (`spliceInlineImages`, `findQualifyingSections`) | Extend with `spliceInternalLinks` and `injectAnchorIds` |
| Public post renderer | [app/(marketing)/blog/[slug]/page.tsx](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx) | Add inline newsletter CTA, related-posts block, FAQPage JSON-LD |
| JsonLd component | [components/shared/JsonLd.tsx](../../../components/shared/JsonLd.tsx) | Reuse for `FAQPage` second emission |
| Newsletter signup | existing newsletter system | Phase 5 adds an inline component that hits the same subscribe endpoint |
| Migration numbering | `00094_*.sql` is current latest (per Phase 1 spec) | Start at `00095_*` |

---

## Decisions

### D1. Voice profile + few-shots load on every generation

The blog-generation handler queries `prompt_templates` once at the top of the run for both rows:

```ts
// functions/src/blog-generation.ts (new helper)
async function loadVoiceContext(supabase): Promise<{ voiceProfile: string; fewShots: FewShotExample[] }> {
  const { data: rows } = await supabase
    .from("prompt_templates")
    .select("category, prompt, few_shot_examples")
    .in("category", ["voice_profile", "blog_generation"])
  // voice_profile.prompt → string prepended to system prompt
  // blog_generation.few_shot_examples → array of { input, output }
  // ...
}
```

The few-shot rows are appended to the Anthropic call as alternating user/assistant turns *before* the real user message. The hardcoded system prompt at [blog-generation.ts:9-61](../../../functions/src/blog-generation.ts#L9-L61) becomes the **fallback** when no voice_profile row exists, and gets shortened to a structural skeleton (output schema, length, HTML rules). Tone/voice/persona moves entirely to the editable `voice_profile` row.

**Migration 00095**: seed the `voice_profile` row with a stronger default than the existing seed (Darren-voice paragraph drafted offline by the coach), and add a new `prompt_templates` row for `category='blog_generation'` containing the structural rules currently hardcoded.

### D2. Tone enum collapses to a single voice + register knob

The `tone: "professional" | "conversational" | "motivational"` enum at [BlogGenerateDialog.tsx:32-36](../../../components/admin/blog/BlogGenerateDialog.tsx#L32-L36) and `/api/admin/blog/generate` is replaced by:

- Voice = always Darren Paul (loaded from `voice_profile`).
- A new `register: "formal" | "casual"` enum. Default `casual`. Old `tone` values map: `professional → formal`, `conversational → casual`, `motivational → casual` (motivational becomes a section-level instruction, not a global tone — see D3).

The Zod schema in [/api/admin/blog/generate/route.ts:24-47](../../../app/api/admin/blog/generate/route.ts#L24-L47) accepts both `tone` (deprecated, mapped) and `register` for one release, then `tone` is removed.

### D3. SEO becomes first-class input, not a post-publish bolt-on

New required field on the generation request:

```ts
{
  primary_keyword: string,           // required, 2-6 words
  secondary_keywords?: string[],     // optional, 0-5 items
  search_intent?: "informational" | "commercial" | "transactional",  // optional, defaults to informational
  target_word_count?: number,        // optional, used to override length preset
}
```

Topic suggestions ([functions/src/tavily-trending-scan.ts](../../../functions/src/tavily-trending-scan.ts)) are extended to **propose** a `primary_keyword` from the topic title using a small Claude call (or simple noun-phrase extraction as fallback). The admin can override before clicking "Generate draft."

The blog-generation system prompt gains a `# SEO TARGET` block:

```
# SEO TARGET
Primary keyword: <kw>
Secondary keywords: <list>
Search intent: <intent>

Rules:
- Primary keyword MUST appear in: title (within first 60 chars), h1, first 100 words of intro, exactly one h2, and the conclusion.
- Secondary keywords distributed across body sections, no stuffing.
- Title formula: pick one of {numbered list, how-to, vs/comparison, year-stamped, contrarian-take} based on intent.
- Title length: 50-60 chars (NOT the current 200-char ceiling).
- Excerpt length: 140-180 chars and MUST include the primary keyword.
```

`blog_posts` gains:
- `primary_keyword TEXT` (nullable for legacy posts; required for new posts via the API validator).
- `secondary_keywords TEXT[]` defaulted to `'{}'`.

### D4. Length verification with one re-prompt

After the first generation pass, if `wordCount(content)` is more than 25% under `target_word_count`, the handler runs a second Claude call:

> "The draft below is too short ({n} words, target {target}). Expand sections {h2 list} with deeper coaching detail, additional examples, or sub-points. Do not change title, slug, or other structural fields. Output the same JSON shape."

Only one re-prompt; further drift is logged and accepted. Schnapps off the corner case where Claude returns 600 words on a 1500-word target.

### D5. FAQ section in body + FAQPage JSON-LD

The blog-generation Zod schema gains:

```ts
faq: z.array(z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(800),
})).min(3).max(5),
```

The FAQ array is rendered into the post HTML as `<section class="djp-faq">` with `<h2>Frequently Asked Questions</h2>` and a list of `<details><summary>` blocks (no JS needed for native expand/collapse).

`seo-enhance` ([functions/src/seo-enhance.ts:192-208](../../../functions/src/seo-enhance.ts#L192-L208)) emits a second JSON-LD `FAQPage` document alongside `BlogPosting`. Both are stored under `seo_metadata.json_ld` as an array (the public renderer at [app/(marketing)/blog/[slug]/page.tsx:89-94](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx#L89-L94) already supports stored JSON-LD; extend `JsonLd` to render an array).

### D6. Internal links injected into post HTML

The link suggestions computed at [seo-enhance.ts:175-190](../../../functions/src/seo-enhance.ts#L175-L190) are now also **inserted** into the post content via a new helper:

```ts
// functions/src/lib/html-splice.ts
export function spliceInternalLinks(
  html: string,
  suggestions: { slug: string; title: string; anchor_text: string; section_h2: string }[],
): string
```

Mechanism:
1. After `BlogPosting` JSON-LD is generated, `seo-enhance` runs an additional small Claude call: "For each suggestion, pick a 2-5 word anchor phrase from the *target* post's body that matches the *suggested* post's topic, and the h2 section it should be inserted under." Output: `[{ slug, anchor_text, section_h2 }]`.
2. The splice helper does a literal string replacement on the **first** occurrence of `anchor_text` inside the named section, wrapping it in `<a href="/blog/{slug}">`.
3. Cap: 3 internal links per post. If the helper can't find the anchor (Claude hallucinated), skip silently and log.

The `seo_metadata.internal_link_suggestions` column is kept for admin visibility but is no longer the only output path.

### D7. Related-posts block on the public renderer

[app/(marketing)/blog/[slug]/page.tsx](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx) gains a "Keep reading" section between the article body and the bottom CTA. It renders the top 3 of `seo_metadata.internal_link_suggestions` if present; falls back to "latest 3 in the same category" otherwise. Pure read; no new data.

### D8. Inline newsletter capture component

A new `<InlinePostNewsletterCapture />` client component renders after the **first** h2 in the post (server-side splice via the renderer; no AI involvement). Server-side splice is preferred over client-side DOM insertion to avoid CLS.

The component posts to the existing newsletter subscribe endpoint, with `source = "blog_inline"` for analytics differentiation.

UI: tight 2-line copy ("Liked this? Get the next one in your inbox."), email input, submit, success state. Matches the existing site's visual language (no new design system).

If the post already has fewer than 2 h2s, the inline capture is skipped.

### D9. Context-aware program CTA at the bottom

The hardcoded "Book Free Consultation" CTA at [app/(marketing)/blog/[slug]/page.tsx:167-191](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx#L167-L191) is replaced by a data-driven version:

- A small `programs` catalog (TS const or JSON file in `lib/blog/program-catalog.ts`) maps `tags[]` and `category` to a program (e.g., tags including `recovery|comeback|return-to-sport` → Comeback Code; tags including `rotational|pitching|golf|tennis` → Rotational Reboot; default → consultation).
- The renderer matches the post's `tags` against the catalog and renders the most-specific match. Generic consultation CTA only when nothing matches.
- The system prompt for blog generation also gets the catalog injected and is instructed: "if the topic is contextually relevant to {Comeback Code | Rotational Reboot}, mention the program by name once in the body." The prompt does **not** ask Claude to insert a link — link insertion stays in the splice layer for predictability.

### D10. Lead-magnet hook (Phase 5, gated)

A `lead_magnets` Supabase table:

```sql
CREATE TABLE lead_magnets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  asset_url text NOT NULL,
  category blog_category,
  tags text[] DEFAULT '{}',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

Renderer logic mirrors D9: best-match by tags + category; render an inline "Free download:" block under the post's intro if a match exists, else skip.

Coach-managed via a new admin page `/admin/lead-magnets` (CRUD only; no AI). This is the only phase that introduces a new admin surface.

### D11. Readability rules baked into the prompt

The system prompt gains a `# STRUCTURE` block:

```
- Max 3 sentences per <p>.
- Insert one h2 every 200-300 words.
- Use one bulleted or ordered list every 2 sections.
- One blockquote with a coach-voice take in the second half of the post.
- One short anecdote ("with athletes I've worked with...") if the topic allows; never invent specific names.
```

### D12. Anchor-id injection + auto table-of-contents

A new helper `injectAnchorIds(html: string)` adds `id="<slug>"` to every `<h2>` (slugified from the heading text). The public renderer reads the post's `<h2>` list (server-side parse) and renders a sticky-side `<TableOfContents />` component for posts longer than 800 words. ToC is hidden on mobile, sticky on lg+.

### D13. Author JSON-LD upgrade

[app/(marketing)/blog/[slug]/page.tsx:75-79](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx#L75-L79) is extended:

```ts
author: {
  "@type": "Person",
  name: "Darren J Paul",
  url: "https://djpathlete.com/about",
  jobTitle: "Strength & Conditioning Coach",
  image: "https://djpathlete.com/images/darren-headshot.jpg",
  sameAs: [
    "https://www.instagram.com/<...>",
    "https://www.linkedin.com/in/<...>",
    "https://www.youtube.com/@<...>",
  ],
}
```

Profile URLs live in a single `lib/brand/author.ts` constant so they're not duplicated across files.

### D14. Tavily summary becomes an angle, not just a snippet

The current join at [generate-from-suggestion/route.ts:46-48](../../../app/api/admin/blog/generate-from-suggestion/route.ts#L46-L48) is `[entry.title, meta.summary].filter(Boolean).join("\n\n")`. We add a small Claude call (or a simple template) to convert the Tavily summary into a `# CONTENT ANGLE` block:

```
# CONTENT ANGLE
Mainstream framing: <one line summarizing how competitors are covering this>
DJP counter-frame: <one line on the coach's POV / where competitors are wrong or shallow>
```

The blog generator is then instructed to lead with the counter-frame, citing the mainstream view to differentiate. This is the single biggest "scream the brand" lever.

If the small call fails or returns nothing useful, fall back to today's behavior — never blocks generation.

### D15. Hero image visual identity (Phase 6, exploratory)

Out of scope for the main rollout. Captured for the record:

- A `BRAND_TREATMENT` constant fed into the hero `image-prompts.ts` ([functions/src/ai/image-prompts.ts:18-42](../../../functions/src/ai/image-prompts.ts#L18-L42)) system prompt: "natural daylight, slightly desaturated, behind-the-scenes coaching aesthetic, shallow depth of field." This is the cheapest version. A LoRA fine-tune of a fal flux model on DJP photography would be the premium version; deferred indefinitely until volume justifies.

---

## Data model changes

### Migration `00095_blog_generation_quality.sql`

```sql
-- D3: SEO targets on blog_posts
ALTER TABLE blog_posts
  ADD COLUMN primary_keyword text,
  ADD COLUMN secondary_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN search_intent text CHECK (search_intent IN ('informational','commercial','transactional')),
  ADD COLUMN faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN subcategory text;

CREATE INDEX idx_blog_posts_primary_keyword ON blog_posts(primary_keyword);

-- D1: blog_generation row in prompt_templates so structural rules live in DB
INSERT INTO prompt_templates (name, category, scope, description, prompt)
VALUES (
  'DJP Athlete — Blog Generation Structure',
  'blog_generation',
  'global',
  'Output schema, length presets, HTML rules. Edit register independently in voice_profile row.',
  '<seeded structural prompt>'
);
```

### Migration `00096_lead_magnets.sql` (Phase 5 only)

```sql
CREATE TABLE lead_magnets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  asset_url text NOT NULL,
  category blog_category,
  tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_magnets_active_tags ON lead_magnets(active, tags);
ALTER TABLE lead_magnets ENABLE ROW LEVEL SECURITY;
-- public read for active rows (rendered on public blog), service-role write
```

### Schema additions

- [lib/validators/blog-post.ts](../../../lib/validators/blog-post.ts): add `primary_keyword`, `secondary_keywords`, `search_intent`, `faq`, `subcategory`. `primary_keyword` required only on insert via the AI route (legacy posts grandfathered).
- [types/database.ts](../../../types/database.ts): add fields to `BlogPost` interface and a `FaqEntry` type.

---

## Phased rollout

The 17 audit findings map cleanly to 6 phases. Each phase ships independently and is gated on the previous phase's metrics check.

### Phase 1 — Brand voice consolidation

**Issues addressed**: 1 (voice profile not loaded), 6 (tone enums), 11 (DJP product mentions in body)

- Migration 00095 (the `prompt_templates` blog_generation row + `subcategory` column).
- `loadVoiceContext()` helper in [functions/src/blog-generation.ts](../../../functions/src/blog-generation.ts).
- `register` enum replaces `tone` (deprecated alias kept for one release).
- Program catalog in [lib/blog/program-catalog.ts](../../../lib/blog/program-catalog.ts) injected into the system prompt.
- Voice-drift monitor unchanged — but its findings should now trend down. Add a Phase 1 verification step: rerun the monitor manually 7 days post-deploy, expect ≥30% reduction in flag rate.

**Effort**: 1 day. **Risk**: low (pure prompt + prompt-loading change). **Rollback**: revert handler + DB row.

### Phase 2 — SEO-first generation

**Issues addressed**: 2 (SEO bolt-on), 7 (vague title), 8 (excerpt range), 9 (length verification), 10 (length blind to SERP), 12 (readability rules)

- Migration 00095 columns (`primary_keyword`, `secondary_keywords`, `search_intent`).
- BlogGenerateDialog gains a "Primary keyword" required field and a "Secondary keywords" tag input.
- Topic-suggestion route auto-proposes a `primary_keyword` so the one-click "Generate draft" path is unaffected.
- Blog-generation system prompt extended with the `# SEO TARGET` and `# STRUCTURE` blocks.
- Length verifier runs after first pass, single re-prompt.
- Title length tightened (50-60 chars), excerpt tightened (140-180), both validated server-side.

**Effort**: 2 days. **Risk**: medium — UI change is admin-only but the Zod schema changes need a migration sweep. **Rollback**: feature-flag the SEO TARGET block, fall back to old prompt if flag off.

### Phase 3 — FAQ + structured data + ToC

**Issues addressed**: 5 (FAQ + PAA schema), 13 (ToC), 14 (categories cap — `subcategory`), 15 (Author JSON-LD)

- `faq` column in `blog_posts` (migration 00095).
- Generator emits `faq[]`; renderer splices a `<section class="djp-faq">` after the article body.
- `seo-enhance` emits `FAQPage` JSON-LD alongside `BlogPosting`.
- `injectAnchorIds()` in [functions/src/lib/html-splice.ts](../../../functions/src/lib/html-splice.ts).
- `<TableOfContents />` component, sticky on lg+, hidden on mobile.
- Author JSON-LD upgrade in [app/(marketing)/blog/[slug]/page.tsx](../../../app/(marketing)/blog/%5Bslug%5D/page.tsx).
- BlogPostForm gains a `subcategory` text field.

**Effort**: 2 days. **Risk**: low. **Rollback**: per-feature.

### Phase 4 — Internal linking & angle-driven generation

**Issues addressed**: 3 (links computed not inserted), 17 (Tavily angle)

- `spliceInternalLinks()` in `html-splice.ts`.
- Extra Claude call in `seo-enhance` to pick anchor + section.
- Angle-extraction call in `generate-from-suggestion` → `# CONTENT ANGLE` block in the system prompt.
- Related-posts block on the public renderer.

**Effort**: 1.5 days. **Risk**: medium — the anchor-text Claude call can hallucinate; cap at 3 links and skip silently on miss. **Rollback**: stop calling the splice helper; suggestions return to JSON-only state.

### Phase 5 — Lead capture in posts

**Issues addressed**: 4 (one generic CTA), 16 (no lead magnet)

- Migration 00096 (`lead_magnets` table).
- `<InlinePostNewsletterCapture />` after first h2.
- Context-aware bottom CTA (program catalog match → program-specific copy + button).
- Lead-magnet match block under the intro when a tag-match exists.
- New admin page `/admin/lead-magnets` for CRUD.

**Effort**: 2.5 days (includes the new admin page). **Risk**: low. **Rollback**: render the original generic CTA + skip the inline blocks.

### Phase 6 — Visual identity (exploratory)

**Issues addressed**: 11 (hero image identity)

- Add `BRAND_TREATMENT` constant to image-prompts system prompt.
- Document the LoRA fine-tune option for future evaluation.

**Effort**: 0.5 days for the prompt change. LoRA evaluation gets its own spec if/when pursued.

---

## Acceptance criteria

| Phase | Criterion | How to verify |
|---|---|---|
| 1 | Voice profile is loaded in every blog_generation run | Log line `[blog-generation] voice_profile_loaded=true|false`; assert true in 100% of runs over 7 days |
| 1 | Drift flags drop ≥30% week-over-week | `voice_drift_flags` row count for 7-day window before vs. after |
| 2 | Primary keyword present in title within first 60 chars | Server-side validator in `blog-generation.ts` rejects + re-prompts if missing |
| 2 | Average word count for `length=long` posts ≥1300 | Aggregate query on `blog_posts` published after deploy |
| 3 | FAQPage JSON-LD validates in [Schema.org validator](https://validator.schema.org/) for 100% of new posts | Smoke test on 3 freshly published posts |
| 3 | h2s have anchor ids | DOM check on a published post |
| 4 | Internal links rendered in body — at least 1 per post when ≥1 published candidate exists | Crawl `/blog/<slug>` and count `<a href="/blog/...">` in `<article>` |
| 5 | Inline newsletter capture submits to subscribe endpoint with `source=blog_inline` | Network tab check + analytics row with that source |
| 5 | Bottom CTA is context-aware (Comeback Code on a recovery post, etc.) | Spot-check 5 posts across categories |

---

## Open questions

1. **Voice-profile content authority** — who edits the seed `voice_profile` text? Suggest: coach drafts in markdown offline → admin pastes into the `prompt_templates` UI. Out of scope for this spec.
2. **Lead magnet asset hosting** — Supabase Storage bucket (consistent with blog-images) or external host (S3/Cloudflare)? Suggest Supabase for simplicity.
3. **Newsletter inline capture conversion target** — what's "good"? Industry baseline 2-5% on inline; we need a Phase 5 success threshold before optimizing.
4. **Internal link anchor extraction call cost** — adds one Claude Sonnet call per post to seo-enhance. ~$0.01 per post. Acceptable, but flag for cost-tracking.
5. **Phase 2 backward compat** — old posts have `primary_keyword = NULL`. Should we run a backfill job to auto-derive from existing posts? Cheap (one Claude call per post) and improves internal-link quality. Suggest: opt-in admin-triggered backfill, not part of the migration.
6. **Mobile ToC behavior** — hidden entirely, or collapsed at the top of the article? Suggest: collapsed `<details>` "On this page" block on mobile, sticky side-rail on desktop.
7. **Voice-profile A/B testing** — out of scope for now, but the data plane supports versioned `prompt_templates` rows. Future Phase 7 spec if needed.

---

## Out-of-scope follow-ups (for a future spec)

- Programmatic SEO (mass topical pages from a keyword list).
- Content refresh job — re-generate posts older than 12 months whose primary_keyword still trends.
- Per-author voice profiles when DJP onboards guest writers.
- AI-generated lead magnets (PDF generation from post content).
- Server-side rendered "you may also like" personalization based on visitor history.
- Programmatic outbound link quality auditing (extending the existing `validateUrls`).

---

## File-by-file change preview

| File | Phase | Change |
|---|---|---|
| `supabase/migrations/00095_blog_generation_quality.sql` | 1+2+3 | New columns + voice/blog_generation seeds |
| `supabase/migrations/00096_lead_magnets.sql` | 5 | New table + RLS |
| `functions/src/blog-generation.ts` | 1, 2 | Load voice context, inject SEO target, length verifier, FAQ in schema |
| `functions/src/seo-enhance.ts` | 3, 4 | Emit FAQPage JSON-LD, anchor-extraction call, store as JSON-LD array |
| `functions/src/lib/html-splice.ts` | 3, 4 | `spliceInternalLinks`, `injectAnchorIds`, `spliceFaqSection` |
| `functions/src/ai/image-prompts.ts` | 6 | `BRAND_TREATMENT` constant |
| `app/api/admin/blog/generate/route.ts` | 2 | Validator: primary_keyword, secondary_keywords, search_intent |
| `app/api/admin/blog/generate-from-suggestion/route.ts` | 2, 4 | Auto-propose keyword, angle-extraction call |
| `app/(marketing)/blog/[slug]/page.tsx` | 3, 4, 5 | FAQPage JsonLd, ToC, related posts, inline newsletter, context CTA, author upgrade |
| `components/admin/blog/BlogGenerateDialog.tsx` | 1, 2 | Replace tone with register, add keyword inputs |
| `components/admin/blog/BlogPostForm.tsx` | 2, 3 | New fields: primary_keyword, secondary_keywords, faq editor, subcategory |
| `components/marketing/blog/InlinePostNewsletterCapture.tsx` | 5 | New |
| `components/marketing/blog/TableOfContents.tsx` | 3 | New |
| `components/marketing/blog/RelatedPosts.tsx` | 4 | New |
| `components/marketing/blog/ContextualCta.tsx` | 5 | New |
| `lib/blog/program-catalog.ts` | 1, 5 | New |
| `lib/brand/author.ts` | 3 | New |
| `lib/validators/blog-post.ts` | 2, 3 | Schema additions |
| `types/database.ts` | 2, 3, 5 | BlogPost + FaqEntry + LeadMagnet types |
| `app/(admin)/admin/lead-magnets/page.tsx` | 5 | New admin CRUD |

---

## Recommended starting point

Phase 1 (voice consolidation) is foundational and the lowest-risk pure win — it makes the existing weekly drift monitor and learning loop start paying back the cost of running them. Recommend kicking off with a Phase 1 implementation plan next.
