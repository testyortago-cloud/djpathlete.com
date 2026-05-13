# SEO Agent — Phase 3 (Internal-link Sweep Primitive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Build the manually-invokable `internal_link_sweep` primitive — a new `ai_jobs` type plus its Firebase handler that, given a TARGET blog post, identifies older candidate posts via tag-overlap scoring, asks Claude per-candidate "is there a natural anchor in this body to link to the target?", and splices up to 2 successful link insertions across the candidate set. Plus a "Sweep inbound links" button on the admin edit page. No automation in this phase — the Phase 4 SEO agent will consume the primitive as a tool.

**Architecture:** Complementary to the existing `seo-enhance.ts` which inserts OUTBOUND links from a new post to existing posts. This phase does the OPPOSITE direction: given an existing post you want more traffic to, push INBOUND links from older posts into it. Reuses the `scoreInternalLinks` tag-overlap heuristic (duplicated server-side in the Next.js API route since it's a small pure function and crossing the workspace boundary into `functions/` is awkward). Adds one new utility `spliceFirstAnchor` to `functions/src/lib/html-splice.ts` that does body-wide first-occurrence wrapping (parallel to the existing `spliceInternalLinks` which is `<h2>`-section-scoped). The handler iterates candidates, asks Claude once per candidate, splices on success, stops after 2 successful insertions.

**Tech Stack:** Same as Phase 1-2 — Next.js 16 App Router (Route Handlers + Server Components), Firebase Functions v2 (`onDocumentCreated`), Anthropic Claude via `lib/ai/anthropic.ts`, Vitest, TypeScript strict.

**Spec:** [docs/superpowers/specs/2026-05-13-seo-agent-design.md](../specs/2026-05-13-seo-agent-design.md) — section "queue_internal_link_sweep → new `internal_link_sweep` ai_job".

**Phase 1-2 reference:** Phase 1 shipped the GSC substrate. Phase 2 shipped the `blog_refresh` primitive following the same primitive-plus-button pattern this phase mirrors.

**Verification:** The `spliceFirstAnchor` utility gets vitest coverage (pure function, easy to test). The handler test covers happy path + skip-on-null-anchor + stop-after-2-successes. The API route gets standard auth/validation/enqueue tests. Manual smoke after deploy.

**Out of scope for this phase:**
- Phase 4 (SEO agent)
- Phase 5 (outcome tracker)
- Multi-target sweeps (one target per job)
- Manual candidate picker UI (API picks via tag-overlap automatically; the Phase 4 agent will pass explicit candidates)
- Cache revalidation of candidate post pages (the existing publish flow does revalidation; sweep edits are picked up on next ISR cycle, or the admin can manually refresh `/blog`)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `functions/src/lib/html-splice.ts` | Modify | Add `spliceFirstAnchor(html, slug, anchor)` — wraps the FIRST occurrence of `anchor` in the WHOLE body (not section-scoped), respects existing `<a>` boundaries |
| `functions/src/__tests__/html-splice-first-anchor.test.ts` | Create | Vitest coverage for the new helper |
| `functions/src/internal-link-sweep.ts` | Create | The handler: load target + candidates, iterate, Claude-per-candidate, splice up to 2 |
| `functions/src/__tests__/internal-link-sweep.test.ts` | Create | Handler test with mocked Claude + Supabase |
| `functions/src/index.ts` | Modify | Add `internalLinkSweep` Firestore trigger after `blogRefresh` |
| `lib/blog/internal-link-scoring.ts` | Create | Tag-overlap scoring helper (duplicated from `functions/src/seo-enhance.ts` to avoid cross-workspace import) |
| `__tests__/lib/blog/internal-link-scoring.test.ts` | Create | Vitest for the scoring function |
| `app/api/admin/blog/[id]/sweep-links/route.ts` | Create | POST handler: admin auth, fetch candidates via SQL + score, enqueue Firestore ai_job |
| `__tests__/api/admin/blog/sweep-links.test.ts` | Create | Auth + candidate selection + enqueue shape |
| `components/admin/blog/SweepInboundLinksButton.tsx` | Create | Client component: button + fetch + toast |
| `components/admin/blog/BlogPostForm.tsx` | Modify | Mount the new button in the same top action row as `RefreshPostButton` (next to it) |

---

## Task 1: `spliceFirstAnchor` helper

A small, pure body-edit utility. Wraps the first occurrence of `anchor` (case-insensitive, word-bounded) in the WHOLE body with `<a href="/blog/{slug}">`. Respects "not inside existing `<a>`" — same defensive rule as `spliceInternalLinks`.

**Files:**
- Modify: `functions/src/lib/html-splice.ts`
- Create: `functions/src/__tests__/html-splice-first-anchor.test.ts`

### Step 1: Write the failing test

Create `functions/src/__tests__/html-splice-first-anchor.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { spliceFirstAnchor } from "../lib/html-splice.js"

describe("spliceFirstAnchor", () => {
  it("wraps the first case-insensitive occurrence with a link to /blog/{slug}", () => {
    const html = "<p>The deadlift is a foundational lift. Anyone serious about strength should master the deadlift.</p>"
    const out = spliceFirstAnchor(html, "deadlift-tips", "deadlift")
    // Only the FIRST occurrence wrapped:
    expect(out).toBe(
      "<p>The <a href=\"/blog/deadlift-tips\">deadlift</a> is a foundational lift. Anyone serious about strength should master the deadlift.</p>",
    )
  })

  it("matches with word boundaries — does not splice inside other words", () => {
    const html = "<p>Sprinting and sprinklers both start with sprint.</p>"
    const out = spliceFirstAnchor(html, "sprint-training", "sprint")
    // Should match the standalone 'sprint' at the end, NOT 'Sprinting' or 'sprinklers'.
    expect(out).toContain('<a href="/blog/sprint-training">sprint</a>')
    expect(out).not.toContain("<a href=\"/blog/sprint-training\">Sprinting")
    expect(out).not.toContain("<a href=\"/blog/sprint-training\">sprinklers")
  })

  it("preserves the original casing of the anchor", () => {
    const html = "<p>Squats build leg strength.</p>"
    const out = spliceFirstAnchor(html, "squat-guide", "squats")
    expect(out).toContain('<a href="/blog/squat-guide">Squats</a>')
  })

  it("returns the html unchanged when anchor is not found", () => {
    const html = "<p>No mention of the target word here.</p>"
    const out = spliceFirstAnchor(html, "some-slug", "deadlift")
    expect(out).toBe(html)
  })

  it("skips when the only occurrence is already inside an <a> tag", () => {
    const html = '<p>Already linked: <a href="/other">deadlift</a>. Just one mention.</p>'
    const out = spliceFirstAnchor(html, "deadlift-tips", "deadlift")
    expect(out).toBe(html)
  })

  it("splices the second occurrence when the first is already inside an <a>", () => {
    const html = '<p>Linked: <a href="/other">deadlift</a>. Now an unlinked mention of deadlift here.</p>'
    const out = spliceFirstAnchor(html, "deadlift-tips", "deadlift")
    expect(out).toContain('<a href="/other">deadlift</a>')
    expect(out).toContain('<a href="/blog/deadlift-tips">deadlift</a>')
  })

  it("escapes regex special characters in the anchor", () => {
    const html = "<p>This is the 5x5 program in action.</p>"
    // "5x5" has no special chars, but verify multi-word + char-safe input:
    const out = spliceFirstAnchor(html, "five-by-five", "5x5 program")
    expect(out).toContain('<a href="/blog/five-by-five">5x5 program</a>')
  })

  it("returns the html unchanged when anchor is empty", () => {
    const html = "<p>Content.</p>"
    expect(spliceFirstAnchor(html, "any", "")).toBe(html)
    expect(spliceFirstAnchor(html, "any", "   ")).toBe(html)
  })
})
```

### Step 2: Run, verify it fails

```
cd functions && npm run test -- src/__tests__/html-splice-first-anchor.test.ts && cd ..
```

Expected: FAIL — `spliceFirstAnchor` is not exported.

### Step 3: Implement the helper

Open `functions/src/lib/html-splice.ts`. After the existing `spliceInternalLinks` block (around line 214, after the `escapeRegex` helper but reusing it), add:

```ts
// ─── spliceFirstAnchor ─────────────────────────────────────────────────────
// Body-wide first-occurrence link splice. Used by internal_link_sweep (Phase 3)
// where we want to insert a single inbound link anywhere in the candidate's
// body — not scoped to a specific <h2> section like spliceInternalLinks.

/**
 * Wraps the FIRST occurrence of `anchor` (case-insensitive, word-bounded) in
 * `html` with `<a href="/blog/{slug}">`. Skips occurrences that are already
 * inside an existing `<a>` tag.
 *
 * Returns the html unchanged when:
 * - anchor is empty or whitespace-only
 * - anchor is not found
 * - the only occurrence(s) are all inside existing <a> tags
 */
export function spliceFirstAnchor(html: string, slug: string, anchor: string): string {
  const trimmed = anchor.trim()
  if (!trimmed) return html

  const escaped = escapeRegex(trimmed)
  const regex = new RegExp(`\\b${escaped}\\b`, "gi")

  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const matchStart = match.index
    if (isInsideAnchor(html, matchStart)) continue

    const matchEnd = matchStart + match[0].length
    const matchedText = html.slice(matchStart, matchEnd)
    const wrapped = `<a href="/blog/${slug}">${matchedText}</a>`
    return html.slice(0, matchStart) + wrapped + html.slice(matchEnd)
  }

  return html
}
```

**Note:** `escapeRegex` and `isInsideAnchor` already exist in this file (private functions used by `spliceInternalLinks`). The new function reuses them directly — no need to expose them as exports.

### Step 4: Run the test, verify it passes

```
cd functions && npm run test -- src/__tests__/html-splice-first-anchor.test.ts && cd ..
```

Expected: PASS, 8 tests.

### Step 5: Type-check the functions build

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 6: Commit

```bash
git add functions/src/lib/html-splice.ts functions/src/__tests__/html-splice-first-anchor.test.ts
git commit -m "feat(seo-agent): spliceFirstAnchor — body-wide first-occurrence link splice"
```

---

## Task 2: Internal-link scoring helper (Next.js side)

The API route in Task 4 needs to score candidates by tag-overlap. The same function exists in `functions/src/seo-enhance.ts` but importing across the workspace boundary is awkward. Duplicate the small (~15 lines) function in `lib/blog/internal-link-scoring.ts`.

**Files:**
- Create: `lib/blog/internal-link-scoring.ts`
- Create: `__tests__/lib/blog/internal-link-scoring.test.ts`

### Step 1: Write the failing test

Create `__tests__/lib/blog/internal-link-scoring.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { scoreInternalLinks } from "@/lib/blog/internal-link-scoring"

describe("scoreInternalLinks", () => {
  const target = {
    id: "tgt",
    title: "Target",
    slug: "target",
    tags: ["deadlift", "strength", "form"],
    category: "Performance",
  }

  it("scores candidates by shared tags * 2 + category match", () => {
    const candidates = [
      // 2 shared tags + same category = 5
      { id: "a", title: "A", slug: "a", tags: ["deadlift", "strength"], category: "Performance" },
      // 1 shared tag + different category = 2
      { id: "b", title: "B", slug: "b", tags: ["deadlift", "recovery"], category: "Recovery" },
      // 0 shared, same category = 1
      { id: "c", title: "C", slug: "c", tags: ["mobility"], category: "Performance" },
      // 0 shared, different category = 0 (excluded by score < 1)
      { id: "d", title: "D", slug: "d", tags: ["unrelated"], category: "Recovery" },
    ]
    const out = scoreInternalLinks(target, candidates)
    expect(out.map((s) => s.blog_post_id)).toEqual(["a", "b", "c"])
    expect(out[0].overlap_score).toBe(5)
    expect(out[1].overlap_score).toBe(2)
    expect(out[2].overlap_score).toBe(1)
  })

  it("excludes the target itself from results", () => {
    const out = scoreInternalLinks(target, [
      { id: "tgt", title: "Target", slug: "target", tags: ["deadlift", "strength", "form"], category: "Performance" },
      { id: "x", title: "X", slug: "x", tags: ["deadlift"], category: "Performance" },
    ])
    expect(out.map((s) => s.blog_post_id)).toEqual(["x"])
  })

  it("caps results at 5", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      slug: `c${i}`,
      tags: ["deadlift"],
      category: "Performance",
    }))
    expect(scoreInternalLinks(target, candidates)).toHaveLength(5)
  })

  it("returns the reason field populated", () => {
    const out = scoreInternalLinks(target, [
      { id: "a", title: "A", slug: "a", tags: ["deadlift", "form"], category: "Performance" },
    ])
    expect(out[0].reason).toContain("Shares tags: deadlift, form")
    expect(out[0].reason).toContain("same category")
  })

  it("handles candidates with null tags or category gracefully", () => {
    const out = scoreInternalLinks(target, [
      { id: "a", title: "A", slug: "a", tags: [], category: null },
    ])
    expect(out).toEqual([])
  })
})
```

### Step 2: Run, verify it fails

```
npm run test:run -- __tests__/lib/blog/internal-link-scoring.test.ts
```

Expected: FAIL — module not found.

### Step 3: Implement

Create `lib/blog/internal-link-scoring.ts`:

```ts
// lib/blog/internal-link-scoring.ts
// Tag-overlap heuristic for ranking blog posts as link candidates.
// Mirrors the function of the same name in functions/src/seo-enhance.ts —
// duplicated here because crossing the workspace boundary into functions/
// from the Next.js app is awkward and the function is small + pure.

export interface BlogSummary {
  id: string
  title: string
  slug: string
  tags: string[]
  category: string | null
}

export interface InternalLinkScore {
  blog_post_id: string
  title: string
  slug: string
  overlap_score: number
  reason: string
}

/**
 * Scores candidates by overlap with target. Score = (shared tags * 2) +
 * (1 if same category, 0 otherwise). Returns top 5 with score >= 1, sorted
 * descending. The target itself is always excluded.
 */
export function scoreInternalLinks(target: BlogSummary, candidates: BlogSummary[]): InternalLinkScore[] {
  const targetTags = new Set(target.tags ?? [])
  const results: InternalLinkScore[] = []

  for (const c of candidates) {
    if (c.id === target.id) continue
    const shared = (c.tags ?? []).filter((t) => targetTags.has(t))
    const tagScore = shared.length * 2
    const categoryMatch = target.category && target.category === c.category ? 1 : 0
    const score = tagScore + categoryMatch
    if (score < 1) continue

    const parts: string[] = []
    if (shared.length > 0) parts.push(`Shares tags: ${shared.join(", ")}`)
    if (categoryMatch) parts.push("same category")
    results.push({
      blog_post_id: c.id,
      title: c.title,
      slug: c.slug,
      overlap_score: score,
      reason: parts.join(" · "),
    })
  }

  results.sort((a, b) => b.overlap_score - a.overlap_score)
  return results.slice(0, 5)
}
```

### Step 4: Run the test, verify it passes

```
npm run test:run -- __tests__/lib/blog/internal-link-scoring.test.ts
```

Expected: PASS, 5 tests.

### Step 5: Commit

```bash
git add lib/blog/internal-link-scoring.ts __tests__/lib/blog/internal-link-scoring.test.ts
git commit -m "feat(seo-agent): scoreInternalLinks helper (Next.js side, duplicated from functions/)"
```

---

## Task 3: `handleInternalLinkSweep` Firebase handler

The Firebase handler. Loads the target post, iterates candidate posts (passed in by the API route), asks Claude per-candidate for a natural anchor, splices on success, stops after 2 successful insertions.

**Files:**
- Create: `functions/src/internal-link-sweep.ts`
- Create: `functions/src/__tests__/internal-link-sweep.test.ts`

### Step 1: Write the test

Create `functions/src/__tests__/internal-link-sweep.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const supabaseFromMock = vi.fn()
const callAgentMock = vi.fn()
const jobRefGet = vi.fn()
const jobRefUpdate = vi.fn()

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({ from: supabaseFromMock }),
}))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_SONNET: "claude-sonnet-4-6",
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: jobRefGet, update: jobRefUpdate }) }),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  supabaseFromMock.mockReset()
  callAgentMock.mockReset()
  jobRefGet.mockReset()
  jobRefUpdate.mockReset()
})

// Helper: build a stub supabase factory that returns the right shape per call.
// `posts` is keyed by blog_posts id and represents the rows in the DB.
// `updates` collects the .update() payloads keyed by post id.
function buildSupabaseStub(
  posts: Record<string, { id: string; slug: string; title: string; content: string }>,
  updates: Array<{ id: string; content: string }>,
) {
  return (table: string) => {
    if (table === "blog_posts") {
      return {
        select: () => ({
          eq: (_col: string, value: string) => ({
            single: () =>
              Promise.resolve({
                data: posts[value] ?? null,
                error: posts[value] ? null : { message: "no row" },
              }),
          }),
          in: (_col: string, ids: string[]) => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: ids.map((id) => posts[id]).filter(Boolean),
                  error: null,
                }),
            }),
          }),
        }),
        update: (payload: { content: string }) => ({
          eq: (_col: string, value: string) => {
            updates.push({ id: value, content: payload.content })
            return Promise.resolve({ error: null })
          },
        }),
      }
    }
    if (table === "ai_generation_log") {
      return { insert: () => Promise.resolve({ error: null }) }
    }
    return {}
  }
}

describe("handleInternalLinkSweep", () => {
  it("happy path: 3 candidates, 2 successful insertions, stops after 2", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "target-id",
          candidateAnchorPostIds: ["c1", "c2", "c3"],
          userId: "admin-uuid",
        },
      }),
    })
    jobRefGet.mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) })

    const posts = {
      "target-id": { id: "target-id", slug: "deadlift-tips", title: "Deadlift tips", content: "" },
      c1: { id: "c1", slug: "form-101", title: "Form 101", content: "<p>Bracing matters when you deadlift.</p>" },
      c2: { id: "c2", slug: "warmup", title: "Warmup", content: "<p>Warm up before any heavy deadlift.</p>" },
      c3: { id: "c3", slug: "recovery", title: "Recovery", content: "<p>No mention of the target word.</p>" },
    }
    const updates: Array<{ id: string; content: string }> = []
    supabaseFromMock.mockImplementation(buildSupabaseStub(posts, updates))

    // Claude returns valid anchors for c1 and c2 but stops being called after 2 successes.
    callAgentMock
      .mockResolvedValueOnce({ content: { anchor: "deadlift", reason: "ok" }, tokens_used: 10 })
      .mockResolvedValueOnce({ content: { anchor: "deadlift", reason: "ok" }, tokens_used: 10 })

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-1")

    expect(updates).toHaveLength(2)
    expect(updates[0].id).toBe("c1")
    expect(updates[0].content).toContain('<a href="/blog/deadlift-tips">deadlift</a>')
    expect(updates[1].id).toBe("c2")
    expect(callAgentMock).toHaveBeenCalledTimes(2)

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { insertions: number }).insertions).toBe(2)
  })

  it("skips candidates where Claude returns null anchor", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "target-id",
          candidateAnchorPostIds: ["c1", "c2"],
          userId: "admin-uuid",
        },
      }),
    })
    jobRefGet.mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) })

    const posts = {
      "target-id": { id: "target-id", slug: "deadlift-tips", title: "Deadlift tips", content: "" },
      c1: { id: "c1", slug: "form-101", title: "Form 101", content: "<p>Some content.</p>" },
      c2: { id: "c2", slug: "warmup", title: "Warmup", content: "<p>Brace before any deadlift.</p>" },
    }
    const updates: Array<{ id: string; content: string }> = []
    supabaseFromMock.mockImplementation(buildSupabaseStub(posts, updates))

    callAgentMock
      .mockResolvedValueOnce({ content: { anchor: null }, tokens_used: 5 })
      .mockResolvedValueOnce({ content: { anchor: "deadlift" }, tokens_used: 10 })

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-2")

    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe("c2")
  })

  it("skips when Claude returns an anchor that is not a substring of the candidate body", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "target-id",
          candidateAnchorPostIds: ["c1"],
          userId: "admin-uuid",
        },
      }),
    })
    jobRefGet.mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) })

    const posts = {
      "target-id": { id: "target-id", slug: "deadlift-tips", title: "Deadlift tips", content: "" },
      c1: { id: "c1", slug: "form-101", title: "Form 101", content: "<p>Squat depth matters.</p>" },
    }
    const updates: Array<{ id: string; content: string }> = []
    supabaseFromMock.mockImplementation(buildSupabaseStub(posts, updates))

    // Claude hallucinates an anchor not present in the candidate body
    callAgentMock.mockResolvedValueOnce({ content: { anchor: "deadlift bracing" }, tokens_used: 5 })

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-3")

    expect(updates).toHaveLength(0)
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { insertions: number }).insertions).toBe(0)
  })

  it("marks job failed when the target post doesn't exist", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "missing-id",
          candidateAnchorPostIds: ["c1"],
          userId: "u",
        },
      }),
    })
    supabaseFromMock.mockImplementation(buildSupabaseStub({}, []))

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-4")

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; error?: string }
    expect(finalUpdate?.status).toBe("failed")
    expect(finalUpdate?.error).toMatch(/target post not found/i)
  })

  it("bails when job is not pending", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "completed", type: "internal_link_sweep", input: {} }),
    })
    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("done-job")
    expect(callAgentMock).not.toHaveBeenCalled()
  })
})
```

### Step 2: Run, verify it fails

```
cd functions && npm run test -- src/__tests__/internal-link-sweep.test.ts && cd ..
```

Expected: FAIL — `Failed to resolve import "../internal-link-sweep.js"`.

### Step 3: Implement the handler

Create `functions/src/internal-link-sweep.ts`:

```ts
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { spliceFirstAnchor } from "./lib/html-splice.js"

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SUCCESSFUL_INSERTIONS = 2

// ─── Anchor selection schema ────────────────────────────────────────────────

const anchorResultSchema = z.object({
  anchor: z.string().nullable(),
  reason: z.string().max(500).optional(),
})

const ANCHOR_SYSTEM_PROMPT = `You are an SEO assistant for darrenjpaul.com, a strength & conditioning blog.

Given the body of an EXISTING blog post (the "host") and a TARGET post we want to link to from this host, your job is to identify ONE natural anchor phrase already present in the host body that should become a link to the target.

Hard rules:
1. The anchor MUST be a verbatim substring of the host body — NOT paraphrased, NOT translated.
2. The anchor MUST be 2-6 words. Single words are too generic; longer phrases break flow.
3. The anchor MUST appear in flowing prose. Reject anchors inside headings (<h1>-<h6>), captions, or existing links.
4. The host paragraph containing the anchor MUST be topically related to the target post — both should be discussing the same concept at that exact point.
5. If no anchor in this host fits cleanly, return null. Better to skip than force a bad link.

Output a JSON object: { anchor: string | null, reason?: string }`

function buildAnchorPrompt(args: {
  hostTitle: string
  hostBody: string
  targetTitle: string
  targetSlug: string
}): string {
  return `── TARGET POST ──
Title: ${args.targetTitle}
Slug: /blog/${args.targetSlug}

── HOST POST (you are picking an anchor from THIS body) ──
Title: ${args.hostTitle}

Body HTML:
${args.hostBody}

Pick the best natural anchor phrase from the host body that should link to the target. Return null if no clean fit.`
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleInternalLinkSweep(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    targetBlogPostId: string
    candidateAnchorPostIds: string[]
    userId: string
  }

  const startTime = Date.now()

  try {
    const supabase = getSupabase()

    // Load target post (we only need slug + title; the body isn't used for anchor selection).
    const { data: target, error: targetErr } = await supabase
      .from("blog_posts")
      .select("id, slug, title")
      .eq("id", input.targetBlogPostId)
      .single()
    if (targetErr || !target) {
      throw new Error(`target post not found: ${input.targetBlogPostId}`)
    }
    const targetPost = target as unknown as { id: string; slug: string; title: string }

    // Iterate candidates one at a time, stopping after MAX_SUCCESSFUL_INSERTIONS.
    let insertions = 0
    const attempted: Array<{ candidateId: string; outcome: "inserted" | "no_anchor" | "anchor_not_in_body" }> = []

    for (const candidateId of input.candidateAnchorPostIds) {
      if (insertions >= MAX_SUCCESSFUL_INSERTIONS) break

      // Load this candidate's content.
      const { data: candidate, error: candidateErr } = await supabase
        .from("blog_posts")
        .select("id, slug, title, content")
        .eq("id", candidateId)
        .single()
      if (candidateErr || !candidate) {
        console.warn(`[internal-link-sweep] candidate ${candidateId} not found, skipping`)
        continue
      }
      const cand = candidate as unknown as {
        id: string
        slug: string
        title: string
        content: string
      }

      // Ask Claude for an anchor.
      const userMsg = buildAnchorPrompt({
        hostTitle: cand.title,
        hostBody: cand.content,
        targetTitle: targetPost.title,
        targetSlug: targetPost.slug,
      })
      const aiResult = await callAgent(ANCHOR_SYSTEM_PROMPT, userMsg, anchorResultSchema, {
        model: MODEL_SONNET,
      })
      const anchor = aiResult.content.anchor?.trim() ?? ""
      if (!anchor) {
        attempted.push({ candidateId, outcome: "no_anchor" })
        continue
      }

      // Hallucination guard: confirm the anchor is actually a substring of the host body.
      if (!cand.content.toLowerCase().includes(anchor.toLowerCase())) {
        console.warn(
          `[internal-link-sweep] candidate ${candidateId} — Claude returned anchor "${anchor}" not in body; skipping`,
        )
        attempted.push({ candidateId, outcome: "anchor_not_in_body" })
        continue
      }

      // Splice and write back.
      const splicedContent = spliceFirstAnchor(cand.content, targetPost.slug, anchor)
      if (splicedContent === cand.content) {
        // spliceFirstAnchor returned unchanged — anchor was found but only inside existing <a>.
        attempted.push({ candidateId, outcome: "anchor_not_in_body" })
        continue
      }

      const { error: updateErr } = await supabase
        .from("blog_posts")
        .update({ content: splicedContent, updated_at: new Date().toISOString() })
        .eq("id", candidateId)
      if (updateErr) {
        console.error(`[internal-link-sweep] update failed for ${candidateId}:`, updateErr.message)
        attempted.push({ candidateId, outcome: "anchor_not_in_body" })
        continue
      }

      insertions++
      attempted.push({ candidateId, outcome: "inserted" })
      console.log(
        `[internal-link-sweep] inserted link in ${candidateId} (${cand.slug}) — anchor="${anchor}"`,
      )
    }

    // Log generation (non-fatal).
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: input.userId,
        status: "completed",
        input_params: {
          feature: "internal_link_sweep",
          targetBlogPostId: input.targetBlogPostId,
          candidates: input.candidateAnchorPostIds,
        },
        output_summary: `Sweep done — ${insertions}/${attempted.length} insertions`,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: 0,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch {
      /* non-fatal */
    }

    await jobRef.update({
      status: "completed",
      result: {
        target_blog_post_id: input.targetBlogPostId,
        target_slug: targetPost.slug,
        insertions,
        attempted,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[internal-link-sweep] Job ${jobId} failed:`, errorMessage)
    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
```

### Step 4: Run the test, verify it passes

```
cd functions && npm run test -- src/__tests__/internal-link-sweep.test.ts && cd ..
```

Expected: PASS, 5 tests.

### Step 5: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 6: Commit

```bash
git add functions/src/internal-link-sweep.ts functions/src/__tests__/internal-link-sweep.test.ts
git commit -m "feat(seo-agent): internal_link_sweep handler — Claude-per-candidate anchor splicing"
```

---

## Task 4: Register the Firebase trigger

**Files:**
- Modify: `functions/src/index.ts`

### Step 1: Add the trigger export

Open `functions/src/index.ts`. Find the existing `blogRefresh` `onDocumentCreated` block (added in Phase 2 Task 3 — Grep for `blogRefresh`). Add this new block immediately after it:

```ts
// ─── Internal Link Sweep ────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "internal_link_sweep"
// For a target post, iterates candidate posts, asks Claude per-candidate for
// a natural anchor, splices up to 2 successful inbound link insertions.

export const internalLinkSweep = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "internal_link_sweep") return

    const { handleInternalLinkSweep } = await import("./internal-link-sweep.js")
    await handleInternalLinkSweep(event.params.jobId)
  },
)
```

### Step 2: Type-check

```
cd functions && npm run build && cd ..
```

Expected: clean.

### Step 3: Commit

```bash
git add functions/src/index.ts
git commit -m "feat(seo-agent): register internalLinkSweep Firebase trigger"
```

### Step 4: Document the deploy

After Phase 3 merges, the user runs `firebase deploy --only functions:default:internalLinkSweep`. DO NOT deploy from the subagent.

---

## Task 5: API route `/api/admin/blog/[id]/sweep-links`

**Files:**
- Create: `app/api/admin/blog/[id]/sweep-links/route.ts`
- Create: `__tests__/api/admin/blog/sweep-links.test.ts`

### Step 1: Write the failing test

Create `__tests__/api/admin/blog/sweep-links.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const supabaseFromMock = vi.fn()
const jobSetMock = vi.fn()
const jobDocMock = vi.fn(() => ({ id: "new-job-id", set: jobSetMock }))
const collectionMock = vi.fn(() => ({ doc: jobDocMock }))

vi.mock("@/lib/auth", () => ({ auth: authMock }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostById: getBlogPostByIdMock }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: supabaseFromMock }),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: collectionMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  authMock.mockReset()
  getBlogPostByIdMock.mockReset()
  supabaseFromMock.mockReset()
  jobSetMock.mockReset()
  jobDocMock.mockClear()
})

async function callRoute(id: string) {
  const { POST } = await import("@/app/api/admin/blog/[id]/sweep-links/route")
  const req = new NextRequest(`https://example.test/api/admin/blog/${id}/sweep-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/blog/[id]/sweep-links", () => {
  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await callRoute("post-1")
    expect(res.status).toBe(403)
    expect(jobSetMock).not.toHaveBeenCalled()
  })

  it("returns 404 when target post is missing", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin", role: "admin" } })
    getBlogPostByIdMock.mockRejectedValueOnce(new Error("not found"))
    const res = await callRoute("missing")
    expect(res.status).toBe(404)
  })

  it("returns 409 when no candidates score >= 1", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({
      id: "post-1",
      title: "Target",
      slug: "target",
      tags: ["unique-tag-no-others-share"],
      category: "Performance",
    })
    // Candidates have NO tag overlap and DIFFERENT category → score=0 each.
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "c1", title: "C1", slug: "c1", tags: ["other"], category: "Recovery" },
                    { id: "c2", title: "C2", slug: "c2", tags: ["another"], category: "Recovery" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    }))
    const res = await callRoute("post-1")
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/no candidate/i) })
  })

  it("happy path: scores candidates, enqueues job with top 5 ids, returns 202", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-uuid", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({
      id: "target-1",
      title: "Target",
      slug: "target",
      tags: ["deadlift", "strength"],
      category: "Performance",
    })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "c1", title: "C1", slug: "c1", tags: ["deadlift", "strength"], category: "Performance" },
                    { id: "c2", title: "C2", slug: "c2", tags: ["deadlift"], category: "Recovery" },
                    { id: "c3", title: "C3", slug: "c3", tags: ["unrelated"], category: "Recovery" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    }))
    jobSetMock.mockResolvedValueOnce(undefined)

    const res = await callRoute("target-1")
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ jobId: "new-job-id", candidateCount: 2 })

    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(jobArg).toMatchObject({
      type: "internal_link_sweep",
      status: "pending",
      userId: "admin-uuid",
      triggeredBy: "manual_sweep_button",
    })
    const inp = jobArg.input as { targetBlogPostId: string; candidateAnchorPostIds: string[] }
    expect(inp.targetBlogPostId).toBe("target-1")
    // c1 (score=5) before c2 (score=2); c3 excluded.
    expect(inp.candidateAnchorPostIds).toEqual(["c1", "c2"])
  })
})
```

### Step 2: Run, verify it fails

```
npm run test:run -- __tests__/api/admin/blog/sweep-links.test.ts
```

Expected: FAIL — route not found.

### Step 3: Implement the route

Create `app/api/admin/blog/[id]/sweep-links/route.ts`:

```ts
// POST /api/admin/blog/[id]/sweep-links
// Admin-only. For the given TARGET post, computes top 5 candidate posts via
// tag-overlap scoring and enqueues an internal_link_sweep ai_job that will
// push inbound links from those candidates to the target.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { scoreInternalLinks } from "@/lib/blog/internal-link-scoring"
import type { BlogPost } from "@/types/database"

const CANDIDATE_POOL_SIZE = 50

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  let target: BlogPost
  try {
    target = (await getBlogPostById(id)) as BlogPost
  } catch {
    return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
  }

  // Fetch top N most-recently-published OTHER posts and score them.
  const supabase = createServiceRoleClient()
  const { data: candidatePool, error: fetchErr } = await supabase
    .from("blog_posts")
    .select("id, title, slug, tags, category")
    .eq("status", "published")
    .neq("id", id)
    .order("published_at", { ascending: false })
    .limit(CANDIDATE_POOL_SIZE)
  if (fetchErr) {
    return NextResponse.json({ error: `Candidate fetch failed: ${fetchErr.message}` }, { status: 500 })
  }

  type CandidateRow = { id: string; title: string; slug: string; tags: string[] | null; category: string | null }
  const candidates = (candidatePool as CandidateRow[] | null) ?? []

  const scored = scoreInternalLinks(
    {
      id: target.id,
      title: target.title,
      slug: target.slug,
      tags: target.tags ?? [],
      category: target.category ?? null,
    },
    candidates.map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      tags: c.tags ?? [],
      category: c.category,
    })),
  )

  if (scored.length === 0) {
    return NextResponse.json(
      { error: "No candidate posts with topical overlap found. Try adding more tags to this post." },
      { status: 409 },
    )
  }

  const candidateAnchorPostIds = scored.map((s) => s.blog_post_id)

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()

  await jobRef.set({
    type: "internal_link_sweep",
    status: "pending",
    input: {
      targetBlogPostId: id,
      candidateAnchorPostIds,
      userId: session.user.id,
    },
    result: null,
    error: null,
    userId: session.user.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    triggeredBy: "manual_sweep_button",
  })

  return NextResponse.json(
    {
      jobId: jobRef.id,
      status: "pending",
      candidateCount: candidateAnchorPostIds.length,
    },
    { status: 202 },
  )
}
```

### Step 4: Run the tests, confirm pass

```
npm run test:run -- __tests__/api/admin/blog/sweep-links.test.ts
```

Expected: PASS, 4 tests.

### Step 5: Commit

```bash
git add app/api/admin/blog/[id]/sweep-links/route.ts __tests__/api/admin/blog/sweep-links.test.ts
git commit -m "feat(seo-agent): /api/admin/blog/[id]/sweep-links — score + enqueue inbound sweep"
```

---

## Task 6: "Sweep inbound links" button

**Files:**
- Create: `components/admin/blog/SweepInboundLinksButton.tsx`
- Modify: `components/admin/blog/BlogPostForm.tsx`

### Step 1: Create the button component

Create `components/admin/blog/SweepInboundLinksButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Network, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface SweepInboundLinksButtonProps {
  postId: string
  postTitle: string
}

export function SweepInboundLinksButton({ postId, postTitle }: SweepInboundLinksButtonProps) {
  const [submitting, setSubmitting] = useState(false)

  async function onSweep() {
    if (
      !window.confirm(
        `Sweep older posts and insert up to 2 inbound links to "${postTitle}"? The edits will go live immediately.`,
      )
    )
      return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/blog/${postId}/sweep-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { candidateCount: number }
      toast.success(
        `Sweep queued against ${body.candidateCount} candidate post${body.candidateCount === 1 ? "" : "s"}. The AI is scanning each — check back in a minute.`,
      )
    } catch (err) {
      toast.error(`Could not start sweep: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={onSweep} disabled={submitting}>
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />}
      Sweep inbound links
    </Button>
  )
}
```

### Step 2: Mount it in BlogPostForm

Open `components/admin/blog/BlogPostForm.tsx`. Find where `RefreshPostButton` is mounted (Phase 2 placed it around lines 246-251, inside the top action bar). Add the new button immediately after it, inside the same `{post?.id && ...}` guard or as a second guarded mount right after.

Add the import alongside the other component imports:

```tsx
import { SweepInboundLinksButton } from "./SweepInboundLinksButton"
```

In the JSX, mount it next to the refresh button. Example placement (adjust to match the actual structure of the action row):

```tsx
{post?.id && (
  <>
    <RefreshPostButton postId={post.id} postTitle={post.title} refreshCount={post.refresh_count} />
    <SweepInboundLinksButton postId={post.id} postTitle={post.title} />
  </>
)}
```

Or if `RefreshPostButton` is wrapped in its own div, place `SweepInboundLinksButton` in a sibling div in the same row. Use Grep on `BlogPostForm.tsx` for `RefreshPostButton` to find the exact spot, then mount next to it. The goal is for the two buttons to appear in the same horizontal action row.

### Step 3: Verify it builds

```
npm run build
```

Expected: clean (no new TS errors).

### Step 4: Commit

```bash
git add components/admin/blog/SweepInboundLinksButton.tsx components/admin/blog/BlogPostForm.tsx
git commit -m "feat(seo-agent): Sweep inbound links button on blog edit page"
```

---

## Task 7: Final verification

**Files:** None — verification only.

### Step 1: Run all Phase 3 tests

```
npm run test:run -- __tests__/lib/blog/internal-link-scoring.test.ts __tests__/api/admin/blog/sweep-links.test.ts
```

Plus:

```
cd functions && npm run test -- src/__tests__/html-splice-first-anchor.test.ts src/__tests__/internal-link-sweep.test.ts && cd ..
```

Expected: 8 + 4 + 8 + 5 = 25 tests passing across the 4 new test files.

### Step 2: Lint

```
npm run lint
```

Expected: clean (no NEW errors in any of the new files).

### Step 3: Build both packages

```
npm run build && cd functions && npm run build && cd ..
```

Expected: both succeed.

### Step 4: User's manual deploy (after Phase 3 lands on main)

```bash
firebase deploy --only functions:default:internalLinkSweep
```

DO NOT run from the subagent.

### Step 5: User's manual E2E smoke (after deploy)

1. Open `/admin/blog`, pick a recently-published post that has good tags.
2. Click "Edit" → "Sweep inbound links". Confirm the dialog.
3. Toast says "Sweep queued against N candidate post(s)..."
4. Wait ~60s. Inspect the candidate posts via SQL:
   ```sql
   SELECT slug, updated_at
   FROM blog_posts
   WHERE status = 'published'
   ORDER BY updated_at DESC
   LIMIT 5;
   ```
   You should see up to 2 candidates with `updated_at` recently bumped.
5. Open one of them in `/admin/blog/[id]/edit` and look for the new `<a href="/blog/<target-slug>">` link in the body.
6. Visit the live post URL and confirm the link renders.

---

## Notes for the executor

- **Solo-dev workflow:** commit directly to `main`. No branches, no PRs.
- **Firebase deploys** use the `default:` codebase prefix: `firebase deploy --only functions:default:internalLinkSweep`.
- **Always-LIVE writes** (not draft mode). Internal links are additive — they don't change the substance of the candidate posts. The risk of a bad link is much lower than the risk of a bad regeneration. If a sweep produces a poor link, the coach can edit it out manually.
- **The 2-insertion cap is a hard stop**, not a quota. Once we hit 2 successful insertions, we don't ask Claude about remaining candidates (saves tokens).
- **Hallucination guard.** Claude is asked to return a verbatim substring; we verify before splicing. If the anchor doesn't exist in the body, we skip and log.
- **Anchor scoring is single-source on the Next.js side.** The Phase 4 SEO agent will pass explicit candidate ids (server-side scoring won't run for those calls), so duplicating the scoring helper across the workspace boundary is acceptable. If a future Phase 5 refactor pulls the scorer into a shared package, both files can be reduced to imports — track as a follow-up.
- **No cache revalidation** of edited candidate pages. The Next.js side runs ISR; pages will pick up the new HTML on the next regeneration cycle. If immediate freshness is required, manual `revalidatePath` calls can be added later.

## Known follow-ups (track for Phase 3.5 or beyond)

- **Cache revalidation** of candidate post pages after a sweep edits them. Currently relies on ISR.
- **Cooldown / dedup** when the Phase 4 SEO agent auto-queues sweeps — avoid re-sweeping the same target post repeatedly.
- **Score-tie tiebreaker.** Currently when two candidates tie on score, order is determined by the SQL fetch order (most-recently-published wins). Acceptable for now.
- **Shared scoring helper.** `scoreInternalLinks` is duplicated between `functions/src/seo-enhance.ts` and `lib/blog/internal-link-scoring.ts`. Extract to a shared package if/when the project grows multi-workspace shared utilities.
