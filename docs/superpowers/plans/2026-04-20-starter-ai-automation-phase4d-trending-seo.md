# Starter AI Automation — Phase 4d: Trending Scan + SEO Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two features. (1) Weekly Tavily trending scan via GitHub Actions cron → internal Next.js endpoint → `tavilyTrendingScan` Firebase Function → `content_calendar` topic_suggestion rows. (2) `seoEnhance` Firebase Function queued on blog publish → fills `blog_posts.seo_metadata` with meta fields + JSON-LD + tag-overlap internal link suggestions → `SeoSidebar` surfaces link suggestions in BlogEditor → marketing blog page renders stored JSON-LD with fallback.

**Architecture:** GHA cron pattern mirrors the existing `publish-due-cron.yml` (curl + bearer token). Two new Firebase Functions, one internal Next.js route, three modified files (publish route, BlogEditor integration, marketing blog JSON-LD render). No schema changes — reuses the existing `blog_posts.seo_metadata` JSONB column from migration 00080.

**Tech Stack:** GitHub Actions, Firebase Functions 2nd gen, Claude via positional `callAgent`, Tavily via `tavilySearch`/`tavilyExtract`, Supabase service-role, Vitest + @testing-library/react.

## Existing infrastructure this plan builds on (no changes)

- [.github/workflows/publish-due-cron.yml](../../../.github/workflows/publish-due-cron.yml) — template for the new trending cron workflow.
- [app/api/admin/internal/publish-due/route.ts](../../../app/api/admin/internal/publish-due/route.ts) — bearer-token auth pattern for the new endpoint.
- `INTERNAL_CRON_TOKEN` env var — reused (same token authorizes both cron endpoints).
- [supabase/migrations/00077_content_calendar.sql](../../../supabase/migrations/00077_content_calendar.sql) — `content_calendar` table with `entry_type: "topic_suggestion"` already supported.
- [supabase/migrations/00080_blog_posts_ai_extensions.sql](../../../supabase/migrations/00080_blog_posts_ai_extensions.sql) — `blog_posts.seo_metadata` JSONB column already exists.
- [functions/src/lib/tavily.ts](../../../functions/src/lib/tavily.ts), [functions/src/ai/anthropic.ts](../../../functions/src/ai/anthropic.ts), [functions/src/lib/supabase.ts](../../../functions/src/lib/supabase.ts) — reused.
- [components/shared/JsonLd.tsx](../../../components/shared/JsonLd.tsx) — existing component, unchanged.

---

## File Structure

### GitHub Actions (new)

- `.github/workflows/tavily-trending-cron.yml` — weekly cron, Monday 6 AM UTC.

### Next.js (new + modify)

- `app/api/admin/internal/tavily-trending/route.ts` — bearer-token-authed POST → `createAiJob({ type: "tavily_trending_scan" })`.
- `app/api/admin/blog/[id]/publish/route.ts` — add a second `createAiJob` for `seo_enhance` (alongside the `newsletter_from_blog` from Phase 4c). Fire-and-forget.
- `app/(marketing)/blog/[slug]/page.tsx` — read `post.seo_metadata.json_ld` if present; pass into existing `<JsonLd>`; fall back to the existing hardcoded schema.

### Types (modify)

- `types/database.ts` — add `SeoMetadata` interface (all fields optional).
- `lib/ai-jobs.ts` — add `"seo_enhance"` to `AiJobType` union (`tavily_trending_scan` already present).

### Firebase Functions (new + modify)

- `functions/src/tavily-trending-scan.ts` — `handleTavilyTrendingScan(jobId)` + pure helpers `buildRankingPrompt`, `nextMondayISO`.
- `functions/src/seo-enhance.ts` — `handleSeoEnhance(jobId)` + pure helpers `scoreInternalLinks`, `buildSeoPrompt`.
- `functions/src/index.ts` — register both new Function exports.

### UI (new + modify)

- `components/admin/blog/SeoSidebar.tsx` (new) — right-column panel listing internal link suggestions.
- `components/admin/blog/BlogEditor.tsx` (modify) — accept `seoMetadata` prop; add SEO toolbar button + conditional sidebar render.
- `components/admin/blog/BlogPostForm.tsx` (modify) — pass `post?.seo_metadata` into `BlogEditor`.

### Tests (new)

- `functions/src/__tests__/tavily-trending-scan.test.ts` (3 tests)
- `functions/src/__tests__/seo-enhance.test.ts` (4 tests)
- `__tests__/api/admin/internal/tavily-trending.test.ts` (3 tests)
- `__tests__/api/admin/blog/publish-seo.test.ts` (2 tests — extends 4c's publish coverage)
- `__tests__/components/seo-sidebar.test.tsx` (3 tests)

---

## Tasks

### Task 1: AiJobType + SeoMetadata + GitHub Actions cron

**Files:**
- Modify: `lib/ai-jobs.ts` — add `"seo_enhance"` to `AiJobType` union
- Modify: `types/database.ts` — add `SeoMetadata` interface
- Create: `.github/workflows/tavily-trending-cron.yml`

- [ ] **Step 1: Extend `AiJobType` union**

In `lib/ai-jobs.ts`, find the `AiJobType` union. Add `"seo_enhance"` in the "Starter AI Automation" section (alongside `"tavily_trending_scan"` which is already there):

```typescript
  | "seo_enhance"
```

- [ ] **Step 2: Add `SeoMetadata` interface**

In `types/database.ts`, find the `BlogPost` interface. Below it (or in a logical grouping with other content types), add:

```typescript
export interface SeoMetadataInternalLink {
  blog_post_id: string
  title: string
  slug: string
  overlap_score: number
  reason: string
}

export interface SeoMetadata {
  meta_title?: string
  meta_description?: string
  keywords?: string[]
  json_ld?: Record<string, unknown>
  internal_link_suggestions?: SeoMetadataInternalLink[]
  generated_at?: string
}
```

Do NOT change `BlogPost.seo_metadata` — it stays `Record<string, unknown>`. Callers cast to `SeoMetadata | null` at the boundary.

- [ ] **Step 3: Create the GHA workflow**

File `.github/workflows/tavily-trending-cron.yml`:

```yaml
name: Tavily Trending Scan

on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch: {}

concurrency:
  group: tavily-trending-cron
  cancel-in-progress: false

jobs:
  ping:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: POST /api/admin/internal/tavily-trending
        env:
          CRON_TRENDING_TARGET_URL: ${{ secrets.CRON_TRENDING_TARGET_URL }}
          INTERNAL_CRON_TOKEN: ${{ secrets.INTERNAL_CRON_TOKEN }}
        run: |
          if [ -z "$CRON_TRENDING_TARGET_URL" ] || [ -z "$INTERNAL_CRON_TOKEN" ]; then
            echo "::error::Missing CRON_TRENDING_TARGET_URL or INTERNAL_CRON_TOKEN repository secret"
            exit 1
          fi
          status=$(curl -sS -o response.json -w "%{http_code}" \
            -X POST "$CRON_TRENDING_TARGET_URL" \
            -H "Authorization: Bearer $INTERNAL_CRON_TOKEN" \
            -H "Content-Type: application/json" \
            --max-time 120)
          echo "HTTP $status"
          cat response.json || true
          if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
            exit 1
          fi
```

Note: `CRON_TRENDING_TARGET_URL` is a NEW repo secret the user sets to the full URL `https://<domain>/api/admin/internal/tavily-trending`. `INTERNAL_CRON_TOKEN` is shared with the existing publish-due cron.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -iE "SeoMetadata|AiJobType|seo_enhance" | head
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-jobs.ts types/database.ts .github/workflows/tavily-trending-cron.yml
git commit -m "feat(4d): AiJobType seo_enhance + SeoMetadata type + trending-scan cron workflow"
```

---

### Task 2: Internal endpoint `/api/admin/internal/tavily-trending`

**Files:**
- Create: `app/api/admin/internal/tavily-trending/route.ts`
- Create: `__tests__/api/admin/internal/tavily-trending.test.ts`

- [ ] **Step 1: Write the failing test**

File `__tests__/api/admin/internal/tavily-trending.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const createAiJobMock = vi.fn()

vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))

// Set INTERNAL_CRON_TOKEN before importing the route
process.env.INTERNAL_CRON_TOKEN = "test-token-xyz"

import { POST } from "@/app/api/admin/internal/tavily-trending/route"

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/internal/tavily-trending", {
    method: "POST",
    headers,
  })
}

describe("POST /api/admin/internal/tavily-trending", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })
  })

  it("returns 401 when Authorization header missing", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(createAiJobMock).not.toHaveBeenCalled()
  })

  it("returns 401 when bearer token is wrong", async () => {
    const res = await POST(makeRequest({ Authorization: "Bearer wrong-token" }))
    expect(res.status).toBe(401)
    expect(createAiJobMock).not.toHaveBeenCalled()
  })

  it("returns 202 and creates ai_job when bearer token matches", async () => {
    const res = await POST(makeRequest({ Authorization: "Bearer test-token-xyz" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "tavily_trending_scan",
      userId: "__cron__",
      input: {},
    })
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm run test:run -- __tests__/api/admin/internal/tavily-trending.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the route**

File `app/api/admin/internal/tavily-trending/route.ts`:

```typescript
// app/api/admin/internal/tavily-trending/route.ts
// Internal cron endpoint hit weekly by GitHub Actions.
// Guarded by INTERNAL_CRON_TOKEN (shared with publish-due cron).

import { NextRequest, NextResponse } from "next/server"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""

  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_trending_scan",
    userId: "__cron__",
    input: {},
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 4: Run → PASS**

```bash
npm run test:run -- __tests__/api/admin/internal/tavily-trending.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/internal/tavily-trending/route.ts __tests__/api/admin/internal/tavily-trending.test.ts
git commit -m "feat(api): internal cron endpoint /api/admin/internal/tavily-trending"
```

---

### Task 3: `tavilyTrendingScan` Firebase Function

**Files:**
- Create: `functions/src/tavily-trending-scan.ts`
- Create: `functions/src/__tests__/tavily-trending-scan.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing test**

File `functions/src/__tests__/tavily-trending-scan.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildRankingPrompt, nextMondayISO } from "../tavily-trending-scan.js"

describe("tavily-trending-scan helpers", () => {
  it("buildRankingPrompt embeds Tavily results as numbered entries", () => {
    const prompt = buildRankingPrompt([
      { title: "Creatine in youth athletes", url: "https://a.example", content: "snippet A" },
      { title: "Sleep debt and recovery", url: "https://b.example", content: "snippet B" },
    ])
    expect(prompt).toContain("Creatine in youth athletes")
    expect(prompt).toContain("https://a.example")
    expect(prompt).toContain("snippet A")
    expect(prompt).toContain("Sleep debt and recovery")
    expect(prompt).toMatch(/5\s*[-–]\s*10\s+topics?/i)
  })

  it("buildRankingPrompt handles empty input gracefully", () => {
    const prompt = buildRankingPrompt([])
    expect(prompt.toLowerCase()).toContain("no search results")
  })

  it("nextMondayISO returns a Monday (day-of-week = 1) in YYYY-MM-DD format", () => {
    const iso = nextMondayISO(new Date("2026-04-22T00:00:00.000Z")) // Wednesday
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const d = new Date(iso + "T00:00:00.000Z")
    expect(d.getUTCDay()).toBe(1) // Monday
    // And it should be AFTER the input date
    expect(d.getTime()).toBeGreaterThan(new Date("2026-04-22T00:00:00.000Z").getTime())
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm --prefix functions test -- tavily-trending-scan
```

- [ ] **Step 3: Create `functions/src/tavily-trending-scan.ts`**

```typescript
// functions/src/tavily-trending-scan.ts
// Firebase Function: weekly Tavily trending scan, writes ranked topic
// suggestions into content_calendar.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"

export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

export function buildRankingPrompt(results: TavilySearchResult[]): string {
  if (results.length === 0) {
    return [
      "# TAVILY SEARCH",
      "No search results returned this week.",
      "",
      "# INSTRUCTIONS",
      "Return an empty topics array.",
    ].join("\n")
  }

  const block = results
    .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`)
    .join("\n\n")

  return [
    "# TAVILY SEARCH RESULTS",
    block,
    "",
    "# INSTRUCTIONS",
    "Extract 5-10 topics relevant to a strength & conditioning coaching audience (youth athletes, injury recovery, strength training, nutrition for performance). Skip fitness fads and low-value clickbait. Rank by relevance (1 = most relevant).",
  ].join("\n")
}

export function nextMondayISO(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, ...
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  d.setUTCDate(d.getUTCDate() + daysUntilMonday)
  return d.toISOString().slice(0, 10)
}

const TrendingSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      tavily_url: z.string(),
      rank: z.number(),
    }),
  ),
})

const SYSTEM_PROMPT = `You are a content strategist for DJP Athlete. Given a list of Tavily search results about fitness/coaching trends, extract concrete blog topic ideas a strength & conditioning coach could write about this week. Output JSON: { topics: [{ title, summary, tavily_url, rank }] }. 5-10 topics max. Skip noise.`

export async function handleTavilyTrendingScan(jobId: string): Promise<void> {
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
    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const search = await tavilySearch({
      query: "fitness coaching trends this week",
      search_depth: "advanced",
      include_answer: false,
      max_results: 15,
    })

    const topicsFromTavily: TavilySearchResult[] = search.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }))

    const userMessage = buildRankingPrompt(topicsFromTavily)

    const result = await callAgent(SYSTEM_PROMPT, userMessage, TrendingSchema, {
      model: MODEL_SONNET,
    })

    const scheduledFor = nextMondayISO(new Date())
    let topicsWritten = 0

    if (result.content.topics.length > 0) {
      const supabase = getSupabase()
      const rows = result.content.topics.map((t) => ({
        entry_type: "topic_suggestion" as const,
        title: t.title.slice(0, 200),
        scheduled_for: scheduledFor,
        status: "planned" as const,
        metadata: {
          source: "tavily",
          rank: t.rank,
          tavily_url: t.tavily_url,
          summary: t.summary,
        },
      }))

      const { error: insertErr } = await supabase.from("content_calendar").insert(rows)
      if (insertErr) {
        await failJob(`content_calendar insert failed: ${insertErr.message}`)
        return
      }
      topicsWritten = rows.length
    }

    await jobRef.update({
      status: "completed",
      result: { topics_written: topicsWritten, scheduled_for: scheduledFor },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown trending-scan error")
  }
}
```

- [ ] **Step 4: Register in `functions/src/index.ts`**

After the `newsletterFromBlog` export (added in Phase 4c), add:

```typescript
// ─── Tavily Trending Scan ─────────────────────────────────────────────────────
// Triggered weekly via ai_jobs doc with type "tavily_trending_scan"

export const tavilyTrendingScan = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, tavilyApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_trending_scan") return

    const { handleTavilyTrendingScan } = await import("./tavily-trending-scan.js")
    await handleTavilyTrendingScan(event.params.jobId)
  },
)
```

- [ ] **Step 5: Run tests + build**

```bash
npm --prefix functions test -- tavily-trending-scan
npm --prefix functions run build
```

Expected: 3 tests pass, build exits 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/tavily-trending-scan.ts functions/src/__tests__/tavily-trending-scan.test.ts functions/src/index.ts
git commit -m "feat(functions): tavilyTrendingScan writes weekly topics to content_calendar"
```

---

### Task 4: `seoEnhance` Firebase Function

**Files:**
- Create: `functions/src/seo-enhance.ts`
- Create: `functions/src/__tests__/seo-enhance.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing test**

File `functions/src/__tests__/seo-enhance.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { scoreInternalLinks, buildSeoPrompt } from "../seo-enhance.js"

describe("seo-enhance helpers", () => {
  const target = {
    id: "target",
    title: "Shoulder Rehab for Overhead Athletes",
    slug: "shoulder-rehab",
    tags: ["shoulder", "rehab", "throwing"],
    category: "Recovery" as const,
  }

  it("scoreInternalLinks returns empty for zero overlap", () => {
    const result = scoreInternalLinks(target, [
      { id: "a", title: "Leg day basics", slug: "leg-day", tags: ["legs", "squat"], category: "Performance" },
    ])
    expect(result).toEqual([])
  })

  it("scoreInternalLinks scores by tag overlap (x2) + category match (+1)", () => {
    const result = scoreInternalLinks(target, [
      { id: "a", title: "Rotator cuff drills", slug: "rotator-cuff", tags: ["shoulder", "rehab"], category: "Recovery" }, // 2*2 + 1 = 5
      { id: "b", title: "Return to throwing", slug: "return-throw", tags: ["throwing"], category: "Performance" },         // 1*2 + 0 = 2
      { id: "c", title: "No overlap post", slug: "unrelated", tags: ["nutrition"], category: "Performance" },              // 0
    ])
    expect(result).toHaveLength(2)
    expect(result[0].blog_post_id).toBe("a")
    expect(result[0].overlap_score).toBe(5)
    expect(result[1].blog_post_id).toBe("b")
    expect(result[1].overlap_score).toBe(2)
    expect(result[0].reason).toMatch(/shares tags: shoulder, rehab/i)
    expect(result[0].reason).toMatch(/same category/i)
  })

  it("scoreInternalLinks caps results at 5", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: `t${i}`,
      slug: `s${i}`,
      tags: ["shoulder"],
      category: "Recovery" as const,
    }))
    const result = scoreInternalLinks(target, candidates)
    expect(result).toHaveLength(5)
  })

  it("buildSeoPrompt includes title + excerpt + tags + category + truncated content", () => {
    const prompt = buildSeoPrompt({
      title: "Shoulder Rehab",
      excerpt: "A 6-12 week framework.",
      content: "x".repeat(10000),
      tags: ["shoulder", "rehab"],
      category: "Recovery",
    })
    expect(prompt).toContain("Shoulder Rehab")
    expect(prompt).toContain("6-12 week framework")
    expect(prompt).toContain("shoulder")
    expect(prompt).toContain("Recovery")
    // Content should be truncated to ~4000 chars
    expect(prompt.length).toBeLessThan(6500)
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm --prefix functions test -- seo-enhance
```

- [ ] **Step 3: Create `functions/src/seo-enhance.ts`**

```typescript
// functions/src/seo-enhance.ts
// Firebase Function: post-publish SEO enrichment. Claude generates
// meta_title/meta_description/keywords/json_ld; tag-overlap scorer finds
// up to 5 internal link suggestions. Writes to blog_posts.seo_metadata.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

export interface SeoEnhanceInput {
  blog_post_id: string
}

interface BlogSummaryForScoring {
  id: string
  title: string
  slug: string
  tags: string[]
  category: string | null
}

export interface InternalLinkSuggestion {
  blog_post_id: string
  title: string
  slug: string
  overlap_score: number
  reason: string
}

export function scoreInternalLinks(
  target: BlogSummaryForScoring,
  candidates: BlogSummaryForScoring[],
): InternalLinkSuggestion[] {
  const targetTags = new Set(target.tags ?? [])
  const results: InternalLinkSuggestion[] = []

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

interface BuildSeoPromptParams {
  title: string
  excerpt: string
  content: string
  tags: string[]
  category: string | null
}

export function buildSeoPrompt(p: BuildSeoPromptParams): string {
  const tagLine = p.tags.length > 0 ? `Tags: ${p.tags.join(", ")}` : ""
  const catLine = p.category ? `Category: ${p.category}` : ""
  return [
    "# BLOG POST",
    `Title: ${p.title}`,
    `Excerpt: ${p.excerpt}`,
    tagLine,
    catLine,
    "",
    "# CONTENT (first 4000 chars)",
    p.content.slice(0, 4000),
    "",
    "# INSTRUCTIONS",
    "Generate SEO metadata for this post. Output a JSON object with: meta_title (<=60 chars), meta_description (<=155 chars), keywords (5-10 lowercase), json_ld (schema.org Article object with at least @context, @type, headline, description, author { @type: Person, name: 'Darren Paul' }, datePublished).",
  ]
    .filter(Boolean)
    .join("\n")
}

const SeoSchema = z.object({
  meta_title: z.string().max(200),
  meta_description: z.string().max(300),
  keywords: z.array(z.string()),
  json_ld: z.record(z.unknown()),
})

const SYSTEM_PROMPT = `You are an SEO specialist generating structured metadata for a fitness/coaching blog. Output strict JSON matching the schema. Do not fabricate facts — use only what the blog post provides.`

export async function handleSeoEnhance(jobId: string): Promise<void> {
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

    const input = data.input as SeoEnhanceInput
    if (!input?.blog_post_id) {
      await failJob("input.blog_post_id is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const supabase = getSupabase()

    const { data: postRow, error: postErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, content, tags, category, published_at")
      .eq("id", input.blog_post_id)
      .single()
    if (postErr || !postRow) {
      await failJob(`Blog post not found: ${postErr?.message ?? "missing"}`)
      return
    }

    const seoPrompt = buildSeoPrompt({
      title: postRow.title as string,
      excerpt: (postRow.excerpt as string) ?? "",
      content: (postRow.content as string) ?? "",
      tags: (postRow.tags as string[]) ?? [],
      category: (postRow.category as string | null) ?? null,
    })

    const seoResult = await callAgent(SYSTEM_PROMPT, seoPrompt, SeoSchema, { model: MODEL_SONNET })

    const { data: candidates, error: candidatesErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, tags, category")
      .eq("status", "published")
      .neq("id", input.blog_post_id)
      .order("published_at", { ascending: false })
      .limit(50)
    if (candidatesErr) {
      console.error("[seo-enhance] candidates fetch failed:", candidatesErr)
    }

    const suggestions = scoreInternalLinks(
      {
        id: postRow.id as string,
        title: postRow.title as string,
        slug: postRow.slug as string,
        tags: (postRow.tags as string[]) ?? [],
        category: (postRow.category as string | null) ?? null,
      },
      ((candidates as BlogSummaryForScoring[] | null) ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        tags: c.tags ?? [],
        category: c.category,
      })),
    )

    const seoMetadata = {
      meta_title: seoResult.content.meta_title,
      meta_description: seoResult.content.meta_description,
      keywords: seoResult.content.keywords,
      json_ld: seoResult.content.json_ld,
      internal_link_suggestions: suggestions,
      generated_at: new Date().toISOString(),
    }

    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({ seo_metadata: seoMetadata })
      .eq("id", input.blog_post_id)
    if (updateErr) {
      await failJob(`seo_metadata update failed: ${updateErr.message}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        blog_post_id: input.blog_post_id,
        suggestions_count: suggestions.length,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown seo-enhance error")
  }
}
```

- [ ] **Step 4: Register in `functions/src/index.ts`**

After the `tavilyTrendingScan` export (just added in Task 3), add:

```typescript
// ─── SEO Enhance ──────────────────────────────────────────────────────────────
// Triggered on blog publish via ai_jobs doc with type "seo_enhance"

export const seoEnhance = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "seo_enhance") return

    const { handleSeoEnhance } = await import("./seo-enhance.js")
    await handleSeoEnhance(event.params.jobId)
  },
)
```

- [ ] **Step 5: Run tests + build**

```bash
npm --prefix functions test -- seo-enhance
npm --prefix functions run build
```

Expected: 4 tests pass, build exits 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/seo-enhance.ts functions/src/__tests__/seo-enhance.test.ts functions/src/index.ts
git commit -m "feat(functions): seoEnhance fills blog seo_metadata + internal link suggestions"
```

---

### Task 5: Queue `seoEnhance` from the blog publish route

**Files:**
- Modify: `app/api/admin/blog/[id]/publish/route.ts`
- Create: `__tests__/api/admin/blog/publish-seo.test.ts`

- [ ] **Step 1: Write failing test**

File `__tests__/api/admin/blog/publish-seo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const createAiJobMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))

import { POST } from "@/app/api/admin/blog/[id]/publish/route"

function ctx(id = "bp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/admin/blog/[id]/publish — SEO queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "t", published_at: null })
    updateBlogPostMock.mockResolvedValue({ id: "bp-1", title: "t", slug: "t" })
    createAiJobMock.mockResolvedValue({ jobId: "job-x", status: "pending" })
  })

  it("queues both newsletter_from_blog and seo_enhance ai_jobs", async () => {
    await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    const calls = createAiJobMock.mock.calls.map((c) => c[0])
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "newsletter_from_blog", input: { blog_post_id: "bp-1" } }),
        expect.objectContaining({ type: "seo_enhance", input: { blog_post_id: "bp-1" } }),
      ]),
    )
  })

  it("publish returns 200 even when seo_enhance queue throws", async () => {
    createAiJobMock.mockImplementation((args: { type: string }) => {
      if (args.type === "seo_enhance") return Promise.reject(new Error("firestore down"))
      return Promise.resolve({ jobId: "n", status: "pending" })
    })
    const res = await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm run test:run -- __tests__/api/admin/blog/publish-seo.test.ts
```

Expected: only `newsletter_from_blog` is queued today, not `seo_enhance`.

- [ ] **Step 3: Modify the publish route**

In `app/api/admin/blog/[id]/publish/route.ts`, after the existing `createAiJob({ type: "newsletter_from_blog", ... })` block, add a parallel `createAiJob` for `seo_enhance`:

```typescript
// Queue SEO enrichment (parallel to newsletter_from_blog).
// Fire-and-forget: if queuing fails, publishing still succeeds.
createAiJob({
  type: "seo_enhance",
  userId: session.user.id,
  input: { blog_post_id: id },
}).catch((err) => console.error("[Blog] seo_enhance queue failed:", err))
```

The route body after change (for clarity — don't duplicate existing lines):

```typescript
    // ... existing lines: auth, getBlogPostById, updateBlogPost ...

    // Queue an AI-drafted newsletter for admin review (4c).
    createAiJob({
      type: "newsletter_from_blog",
      userId: session.user.id,
      input: { blog_post_id: id },
    }).catch((err) => console.error("[Blog] newsletter_from_blog queue failed:", err))

    // Queue SEO enrichment (4d). Parallel to newsletter, fire-and-forget.
    createAiJob({
      type: "seo_enhance",
      userId: session.user.id,
      input: { blog_post_id: id },
    }).catch((err) => console.error("[Blog] seo_enhance queue failed:", err))

    return NextResponse.json(updated)
```

- [ ] **Step 4: Run → PASS**

```bash
npm run test:run -- __tests__/api/admin/blog/publish-seo.test.ts __tests__/api/admin/blog/publish.test.ts
```

Expected: publish-seo (2) + publish (3) — all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/blog/[id]/publish/route.ts __tests__/api/admin/blog/publish-seo.test.ts
git commit -m "feat(blog): publish also queues seo_enhance ai_job"
```

---

### Task 6: `SeoSidebar` component

**Files:**
- Create: `components/admin/blog/SeoSidebar.tsx`
- Create: `__tests__/components/seo-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

File `__tests__/components/seo-sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SeoSidebar } from "@/components/admin/blog/SeoSidebar"
import type { SeoMetadata } from "@/types/database"

describe("SeoSidebar", () => {
  it("renders empty state when no seoMetadata", () => {
    render(<SeoSidebar seoMetadata={null} onClose={vi.fn()} />)
    expect(screen.getByText(/no link suggestions yet/i)).toBeInTheDocument()
  })

  it("renders empty state when internal_link_suggestions is empty", () => {
    const meta: SeoMetadata = { internal_link_suggestions: [] }
    render(<SeoSidebar seoMetadata={meta} onClose={vi.fn()} />)
    expect(screen.getByText(/no link suggestions yet/i)).toBeInTheDocument()
  })

  it("renders each suggestion with title + score + reason + open link", () => {
    const meta: SeoMetadata = {
      internal_link_suggestions: [
        {
          blog_post_id: "bp-a",
          title: "Rotator cuff drills",
          slug: "rotator-cuff",
          overlap_score: 5,
          reason: "Shares tags: shoulder, rehab · same category",
        },
        {
          blog_post_id: "bp-b",
          title: "Return to throwing",
          slug: "return-throw",
          overlap_score: 2,
          reason: "Shares tags: throwing",
        },
      ],
    }
    render(<SeoSidebar seoMetadata={meta} onClose={vi.fn()} />)
    expect(screen.getByText(/rotator cuff drills/i)).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByText(/shares tags: shoulder, rehab/i)).toBeInTheDocument()
    expect(screen.getByText(/return to throwing/i)).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run → FAIL**

```bash
npm run test:run -- __tests__/components/seo-sidebar.test.tsx
```

- [ ] **Step 3: Create `components/admin/blog/SeoSidebar.tsx`**

```tsx
"use client"

import { X, ExternalLink } from "lucide-react"
import type { SeoMetadata } from "@/types/database"

interface SeoSidebarProps {
  seoMetadata: SeoMetadata | null
  onClose: () => void
}

export function SeoSidebar({ seoMetadata, onClose }: SeoSidebarProps) {
  const suggestions = seoMetadata?.internal_link_suggestions ?? []

  return (
    <aside
      className="w-80 shrink-0 border-l border-border bg-surface/50 flex flex-col overflow-hidden"
      aria-label="SEO sidebar"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-primary">Internal links</div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-primary"
          aria-label="Close SEO sidebar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No link suggestions yet — publish the post to generate.
          </p>
        ) : (
          suggestions.map((s) => (
            <div key={s.blog_post_id} className="border border-border rounded-md bg-card p-3 text-sm">
              <div className="flex items-start gap-2 justify-between">
                <div className="font-medium text-primary flex-1 truncate">{s.title}</div>
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  {s.overlap_score}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>
              <a
                href={`/admin/blog/${s.blog_post_id}/edit`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="size-3" />
                Open
              </a>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run → PASS**

```bash
npm run test:run -- __tests__/components/seo-sidebar.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/admin/blog/SeoSidebar.tsx __tests__/components/seo-sidebar.test.tsx
git commit -m "feat(ui): SeoSidebar shows internal link suggestions"
```

---

### Task 7: BlogEditor integration (SEO button + sidebar) + marketing page JSON-LD override

**Files:**
- Modify: `components/admin/blog/BlogEditor.tsx`
- Modify: `components/admin/blog/BlogPostForm.tsx`
- Modify: `app/(marketing)/blog/[slug]/page.tsx`

- [ ] **Step 1: Extend `BlogEditor`**

Add imports:

```typescript
import { Link2 } from "lucide-react"
import { SeoSidebar } from "./SeoSidebar"
import type { SeoMetadata } from "@/types/database"
```

Extend `BlogEditorProps`:

```typescript
seoMetadata?: SeoMetadata | null
```

Add state (alongside the existing `sidebarOpen` for fact-check):

```typescript
const [seoSidebarOpen, setSeoSidebarOpen] = useState(false)
```

In the toolbar (wherever the editor's icon buttons live — look at the existing TipTap toolbar with `Bold`/`Italic`/etc.), add a button that toggles the SEO sidebar. It should be disabled when there are no suggestions:

```tsx
<button
  type="button"
  onClick={() => setSeoSidebarOpen((o) => !o)}
  disabled={!seoMetadata?.internal_link_suggestions?.length}
  title={
    seoMetadata?.internal_link_suggestions?.length
      ? "Toggle SEO link suggestions"
      : "Publish the post to generate link suggestions"
  }
  className={cn(
    "p-2 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed",
    seoSidebarOpen && "bg-primary/5",
  )}
  aria-label="SEO link suggestions"
>
  <Link2 className="size-4" />
</button>
```

If the BlogEditor's current layout has the editor in a single column without the fact-check sidebar wrap (from Phase 4b Task 8), that's fine — the fact-check sidebar is a flex right column that renders conditionally. Add the SEO sidebar as an ADDITIONAL conditional right column inside the same flex container. Specifically, find the block added in Phase 4b:

```tsx
<div className="flex flex-col lg:flex-row gap-3">
  <div className="flex-1 min-w-0">
    {/* editor */}
  </div>
  {sidebarOpen && <FactCheckSidebar ... />}
  {seoSidebarOpen && <SeoSidebar seoMetadata={seoMetadata ?? null} onClose={() => setSeoSidebarOpen(false)} />}
</div>
```

Both sidebars can be open simultaneously (they're separate flex children).

- [ ] **Step 2: Pass prop from `BlogPostForm`**

In `components/admin/blog/BlogPostForm.tsx`, add import:

```typescript
import type { SeoMetadata } from "@/types/database"
```

Update the `<BlogEditor>` call:

```tsx
<BlogEditor
  content={content}
  onChange={setContent}
  factCheckStatus={(post?.fact_check_status as FactCheckStatus | null) ?? null}
  factCheckDetails={(post?.fact_check_details as FactCheckDetails | null) ?? null}
  seoMetadata={(post?.seo_metadata as SeoMetadata | null) ?? null}
/>
```

- [ ] **Step 3: Marketing blog page — prefer stored JSON-LD**

In `app/(marketing)/blog/[slug]/page.tsx`, find the `<JsonLd data={blogPostSchema} />` render (around line 91). Before that render, compute:

```tsx
const storedJsonLd = (post.seo_metadata as { json_ld?: Record<string, unknown> } | null)?.json_ld
const jsonLdData = storedJsonLd && Object.keys(storedJsonLd).length > 0 ? storedJsonLd : blogPostSchema
```

Then replace the render:

```tsx
<JsonLd data={jsonLdData} />
```

The existing `blogPostSchema` variable (hardcoded above the render) remains — it's the fallback.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -iE "BlogEditor|BlogPostForm|SeoSidebar|seo_metadata|JsonLd|blog.slug" | head -20
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
npm run test:run -- __tests__/components/seo-sidebar.test.tsx __tests__/components/fact-check-banner.test.tsx __tests__/components/fact-check-sidebar.test.tsx
```

Expected: 3 + 5 + 3 = 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/admin/blog/BlogEditor.tsx components/admin/blog/BlogPostForm.tsx app/\(marketing\)/blog/\[slug\]/page.tsx
git commit -m "feat(ui): BlogEditor SEO sidebar + marketing blog renders stored JSON-LD"
```

---

### Task 8: Post-Phase-4d verification

- [ ] **Step 1:** `npm run test:run` — confirm all Phase 4d new tests pass. Pre-existing baseline failures unchanged. Report any NEW failures.

- [ ] **Step 2:** `npm run build` — confirm success.

- [ ] **Step 3:** `npm --prefix functions run build && npm --prefix functions test` — both must succeed (54 + 7 = 61 tests expected).

- [ ] **Step 4:** `git push origin feature/starter-ai-automation`.

- [ ] **Step 5 (controller handles):** Firebase deploy:
  ```bash
  firebase deploy --only functions:tavilyTrendingScan,functions:seoEnhance
  ```

- [ ] **Step 6 (controller handles):** GitHub repo secrets setup — ensure `INTERNAL_CRON_TOKEN` exists (shared with publish-due cron). Add `CRON_TRENDING_TARGET_URL` pointing to `https://<deploy-url>/api/admin/internal/tavily-trending`.

- [ ] **Step 7 (user handles):** Manual smoke test:
  1. Trigger `.github/workflows/tavily-trending-cron.yml` via Actions → Run workflow. Wait ~90s. Check admin calendar (`/admin/calendar`) — new topic_suggestion entries for next Monday.
  2. Publish an existing draft blog post. Both `newsletter_from_blog` and `seo_enhance` ai_jobs fire. Within ~60s, the draft's `seo_metadata` populates.
  3. Reload the draft's edit page. SEO toolbar button (Link2 icon) should activate — click toggles sidebar showing up to 5 link suggestions.
  4. Visit the marketing blog detail page. View source. `<script type="application/ld+json">` should render the Claude-generated schema (not the hardcoded fallback) when `seo_metadata.json_ld` is populated.

---

## What Phase 4d Concludes

Phase 4 is complete. All four content-extension systems (4a manual Research surface, 4b video-to-blog pipeline, 4c blog-to-newsletter auto-draft, 4d trending scan + SEO) are live on `feature/starter-ai-automation`. Phase 5 (analytics tabs, Daily Pulse, Weekly Report) consumes the artifacts 4a-d produce.

---

## Self-Review

**Spec coverage:**
- ✅ Weekly trending scan → Tasks 1-3
- ✅ SEO enhance on publish → Tasks 4-5
- ✅ Internal linking algorithm → Task 4 (pure helper, unit-tested)
- ✅ BlogEditor sidebar → Task 7
- ✅ Marketing blog JSON-LD render → Task 7
- ✅ Cron pattern mirrors publish-due-cron.yml → Task 1 step 3
- ✅ Tests: 3 + 4 + 3 + 2 + 3 = 15 new tests + 3 helpers (21 assertions)

**Placeholder scan:** no TODOs or "similar to X" references. Full code in every step.

**Type consistency:** `SeoMetadata` defined once in `types/database.ts`; used by SeoSidebar component test import, BlogPostForm prop drill, and marketing blog page cast. `InternalLinkSuggestion` alias lives in same file.

**Handoff notes:**
- Migration is a no-op for Phase 4d (reuses existing `seo_metadata` column). No `apply_migration` call needed.
- GitHub Actions adds a NEW repo secret `CRON_TRENDING_TARGET_URL`. Publish-due cron's `CRON_TARGET_URL` stays separate — different endpoints.
- `INTERNAL_CRON_TOKEN` is SHARED between both crons; they validate against the same env var.
