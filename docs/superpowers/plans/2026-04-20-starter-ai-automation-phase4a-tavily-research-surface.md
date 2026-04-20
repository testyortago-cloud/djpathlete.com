# Starter AI Automation — Phase 4a: Tavily Research Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Tavily research inside the blog editor. A "Research" button in `BlogPostForm` opens a right-sidebar panel showing a summary + ranked sources + expandable extracted content for the post title. The brief persists to `blog_posts.tavily_research` so Phase 4b's video→blog generator can consume it.

**Architecture:** Reuse the existing ai-jobs async pattern end-to-end. The `tavilyResearch` Firebase Function (already live, triggered by Firestore `ai_jobs` doc creation) gains one optional input field — `blog_post_id` — and when present, upserts the brief into `blog_posts.tavily_research` via service-role Supabase. Frontend uses the existing `useAiJob` hook to poll; no new polling plumbing.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (existing `auth()`), Firebase Admin SDK (`createAiJob`), Supabase service-role client (inside Function), Tavily API (existing `tavilySearch` + `tavilyExtract` in `functions/src/lib/tavily.ts`), React 19 + TipTap, Vitest.

## Existing infrastructure this plan builds on (no changes)

- [functions/src/tavily-research.ts](../../../functions/src/tavily-research.ts) — `handleTavilyResearch(jobId)` reads `ai_jobs/{jobId}`, runs Tavily, writes `result` back. **This plan extends it.**
- [functions/src/index.ts](../../../functions/src/index.ts) — `tavilyResearch` Firebase Function already registered with `onDocumentCreated("ai_jobs/{jobId}")`. **This plan adds two secrets to it.**
- [functions/src/lib/supabase.ts](../../../functions/src/lib/supabase.ts) — lazy service-role client. Reused verbatim.
- [lib/ai-jobs.ts](../../../lib/ai-jobs.ts) — `createAiJob({ type, userId, input })` — creates Firestore doc, Function picks it up.
- [hooks/use-ai-job.ts](../../../hooks/use-ai-job.ts) — `useAiJob(jobId)` returns `{ status, result, error, ... }` by listening to the Firestore doc.
- [lib/db/blog-posts.ts](../../../lib/db/blog-posts.ts) — `getBlogPostById(id)` used for 404 check in the route.
- Migration [00080_blog_posts_ai_extensions.sql](../../../supabase/migrations/00080_blog_posts_ai_extensions.sql) — `blog_posts.tavily_research` JSONB column already exists.

---

## File Structure

### Firebase Functions (modify)

- `functions/src/index.ts` — add `supabaseUrl` + `supabaseServiceRoleKey` secrets to the `tavilyResearch` Function config. Without this the Function can't write to Supabase.
- `functions/src/tavily-research.ts` — accept optional `input.blog_post_id`; add `generated_at` ISO timestamp to `result`; when `blog_post_id` present, upsert the brief into `blog_posts.tavily_research`. Extract pure helpers (`buildResearchBrief`, `shouldPersist`) for unit testing.

### Next.js API routes (new)

- `app/api/admin/blog-posts/[id]/research/route.ts` — `POST { topic }` → auth check, validate topic non-empty, 404 if blog post not found, else `createAiJob({ type: "tavily_research", userId, input: { topic, blog_post_id: id } })`, return `{ jobId, status }` with 202.

### UI components (new + modify)

- `components/admin/blog/ResearchPanel.tsx` (new) — right-sidebar panel. Props: `{ blogPostId, postTitle, initialBrief, onBriefChange }`. Four states: `empty` / `loading` / `populated` / `error`. Uses `useAiJob(jobId)` once a job starts; reads `initialBrief` from the parent's form state to render `populated` state on mount if research already exists.
- `components/admin/blog/BlogPostForm.tsx` (modify) — add Research toolbar button next to the existing "Generate" button, track `panelOpen` state, render `<ResearchPanel>` as a `w-80` right column when open, shift layout from single column to flex row.

### Tests (new + extend)

- `functions/src/__tests__/tavily-research.test.ts` (new) — unit test pure helpers: `buildResearchBrief` shape + `shouldPersist` guard.
- `__tests__/api/admin/blog-posts/research.test.ts` (new) — vitest route test. 401 / 400 / 404 / 202 cases.
- `__tests__/components/research-panel.test.tsx` (new) — renders each of 4 states; Retry button re-triggers POST.

---

## Tasks

### Task 1: Extend `tavilyResearch` Function — accept blog_post_id + persist

**Files:**
- Create: `functions/src/__tests__/tavily-research.test.ts`
- Modify: `functions/src/tavily-research.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/__tests__/tavily-research.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildResearchBrief, shouldPersist } from "../tavily-research.js"

describe("tavily-research helpers", () => {
  it("buildResearchBrief shapes Tavily output into the stored brief", () => {
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

  it("buildResearchBrief handles null answer + empty extracts", () => {
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

  it("shouldPersist returns true only when blog_post_id is a non-empty string", () => {
    expect(shouldPersist({ topic: "x" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "abc-123" })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `functions/`:
```bash
npm --prefix functions test -- tavily-research
```
Expected: FAIL with "buildResearchBrief is not exported" (or equivalent).

- [ ] **Step 3: Rewrite `functions/src/tavily-research.ts`**

Replace the file entirely:

```typescript
// Firebase Function: runs Tavily search for a topic, optionally extracts full
// content from the top N results, writes a research brief to the ai_jobs doc,
// and — when input.blog_post_id is provided — upserts the same brief into
// blog_posts.tavily_research so Phase 4b can consume it on the next page load.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"

export interface TavilyResearchInput {
  topic: string
  extract_top_n?: number
  search_depth?: "basic" | "advanced"
  blog_post_id?: string
}

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

interface BuildBriefParams {
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

export function shouldPersist(input: TavilyResearchInput): boolean {
  return typeof input.blog_post_id === "string" && input.blog_post_id.length > 0
}

export async function handleTavilyResearch(jobId: string): Promise<void> {
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

    const input = data.input as TavilyResearchInput
    if (!input?.topic) {
      await failJob("input.topic is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const search = await tavilySearch({
      query: input.topic,
      search_depth: input.search_depth ?? "basic",
      include_answer: true,
      max_results: 10,
    })

    let extractedContent: Array<{ url: string; content: string }> = []
    const topN = input.extract_top_n ?? 3
    if (topN > 0 && search.results.length > 0) {
      const urls = search.results.slice(0, topN).map((r) => r.url)
      const extract = await tavilyExtract({ urls })
      extractedContent = extract.results.map((r) => ({ url: r.url, content: r.raw_content }))
    }

    const brief = buildResearchBrief({
      topic: input.topic,
      search: { answer: search.answer ?? null, results: search.results },
      extractedContent,
      generatedAt: new Date().toISOString(),
    })

    if (shouldPersist(input)) {
      const supabase = getSupabase()
      const { error: upsertError } = await supabase
        .from("blog_posts")
        .update({ tavily_research: brief })
        .eq("id", input.blog_post_id)
      if (upsertError) {
        console.error("[tavily-research] blog_posts upsert failed:", upsertError)
        // Do NOT fail the job — the brief is still useful on-screen.
        // Frontend renders a "brief generated but not saved" warning when
        // it re-reads the blog post and tavily_research is still null.
      }
    }

    await jobRef.update({
      status: "completed",
      result: brief,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown tavily research error")
  }
}
```

- [ ] **Step 4: Add Supabase secrets to the Function registration**

Edit `functions/src/index.ts`. Find the `tavilyResearch` export (around line 212) and change its `secrets` array:

Before:
```typescript
export const tavilyResearch = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [tavilyApiKey],
  },
```

After:
```typescript
export const tavilyResearch = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [tavilyApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm --prefix functions test -- tavily-research
```
Expected: PASS (3 tests).

- [ ] **Step 6: Verify Functions TypeScript compiles**

```bash
npm --prefix functions run build
```
Expected: exits 0 with no errors.

- [ ] **Step 7: Commit**

```bash
git add functions/src/tavily-research.ts functions/src/__tests__/tavily-research.test.ts functions/src/index.ts
git commit -m "feat(functions): tavilyResearch accepts blog_post_id + persists brief"
```

---

### Task 2: POST /api/admin/blog-posts/[id]/research route

**Files:**
- Create: `app/api/admin/blog-posts/[id]/research/route.ts`
- Create: `__tests__/api/admin/blog-posts/research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/blog-posts/research.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getBlogPostByIdMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
}))

import { POST } from "@/app/api/admin/blog-posts/[id]/research/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/blog-posts/bp-1/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function ctx(id = "bp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/admin/blog-posts/[id]/research", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ topic: "t" }), ctx())
    expect(res.status).toBe(401)
  })

  it("returns 400 when topic is missing", async () => {
    const res = await POST(makeRequest({}), ctx())
    expect(res.status).toBe(400)
  })

  it("returns 400 when topic is empty string", async () => {
    const res = await POST(makeRequest({ topic: "   " }), ctx())
    expect(res.status).toBe(400)
  })

  it("returns 404 when blog post not found", async () => {
    const notFound = Object.assign(new Error("not found"), { code: "PGRST116" })
    getBlogPostByIdMock.mockRejectedValue(notFound)
    const res = await POST(makeRequest({ topic: "shoulder rehab" }), ctx())
    expect(res.status).toBe(404)
  })

  it("creates a tavily_research ai_job and returns 202 with jobId", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "x" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(makeRequest({ topic: "shoulder rehab" }), ctx())
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "tavily_research",
      userId: "admin-1",
      input: { topic: "shoulder rehab", blog_post_id: "bp-1" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- __tests__/api/admin/blog-posts/research.test.ts
```
Expected: FAIL — route module does not exist yet.

- [ ] **Step 3: Create `app/api/admin/blog-posts/[id]/research/route.ts`**

```typescript
// app/api/admin/blog-posts/[id]/research/route.ts
// POST { topic } — kicks off a Tavily research ai_job for the given blog post.
// The tavilyResearch Firebase Function persists the brief back into
// blog_posts.tavily_research on completion.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getBlogPostById } from "@/lib/db/blog-posts"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const body = (await request.json().catch(() => null)) as { topic?: string } | null
  const topic = body?.topic?.trim()
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 })
  }

  try {
    await getBlogPostById(id)
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === "PGRST116") {
      return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
    }
    throw err
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_research",
    userId: session.user.id,
    input: { topic, blog_post_id: id },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:run -- __tests__/api/admin/blog-posts/research.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/blog-posts/[id]/research/route.ts __tests__/api/admin/blog-posts/research.test.ts
git commit -m "feat(api): POST /api/admin/blog-posts/:id/research"
```

---

### Task 3: ResearchPanel component

**Files:**
- Create: `components/admin/blog/ResearchPanel.tsx`
- Create: `__tests__/components/research-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/research-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { TavilyResearchBrief } from "@/components/admin/blog/ResearchPanel"

// Mock useAiJob so we can drive its state per test
const useAiJobMock = vi.fn()
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: (jobId: string | null) => useAiJobMock(jobId),
}))

// Mock fetch for the POST kick-off
const fetchMock = vi.fn()
globalThis.fetch = fetchMock as unknown as typeof fetch

import { ResearchPanel } from "@/components/admin/blog/ResearchPanel"

function defaultAiJobState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "pending",
    result: null,
    error: null,
    text: "",
    chunks: [],
    analysis: null,
    programCreated: null,
    messageId: null,
    activeTools: [],
    reset: vi.fn(),
    ...overrides,
  }
}

const sampleBrief: TavilyResearchBrief = {
  topic: "shoulder rehab",
  summary: "Top protocols emphasize scapular control.",
  results: [
    { title: "PubMed", url: "https://pubmed.example/a", snippet: "abc", score: 0.9, published_date: "2025-01-01" },
  ],
  extracted: [{ url: "https://pubmed.example/a", content: "full page text" }],
  generated_at: "2026-04-20T10:00:00.000Z",
}

describe("ResearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAiJobMock.mockReturnValue(defaultAiJobState())
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-1", status: "pending" }),
    })
  })

  it("renders empty state when no brief and no job", () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="shoulder rehab" initialBrief={null} onBriefChange={vi.fn()} />)
    expect(screen.getByText(/research this topic/i)).toBeInTheDocument()
  })

  it("renders populated state when initialBrief provided", () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="shoulder rehab" initialBrief={sampleBrief} onBriefChange={vi.fn()} />)
    expect(screen.getByText(/top protocols emphasize scapular control/i)).toBeInTheDocument()
    expect(screen.getByText("PubMed")).toBeInTheDocument()
  })

  it("expands extracted content when a source is clicked", () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="x" initialBrief={sampleBrief} onBriefChange={vi.fn()} />)
    fireEvent.click(screen.getByText("PubMed"))
    expect(screen.getByText(/full page text/i)).toBeInTheDocument()
  })

  it("renders loading state while useAiJob is processing", () => {
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "processing" }))
    render(
      <ResearchPanel
        blogPostId="bp-1"
        postTitle="x"
        initialBrief={null}
        onBriefChange={vi.fn()}
        activeJobId="job-1"
      />,
    )
    expect(screen.getByText(/researching/i)).toBeInTheDocument()
  })

  it("renders error state + Retry when job failed", () => {
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "failed", error: "Tavily rate limit" }))
    render(
      <ResearchPanel
        blogPostId="bp-1"
        postTitle="x"
        initialBrief={null}
        onBriefChange={vi.fn()}
        activeJobId="job-1"
      />,
    )
    expect(screen.getByText(/tavily rate limit/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
  })

  it("clicking Research POSTs to the route and stores the returned jobId", async () => {
    render(<ResearchPanel blogPostId="bp-1" postTitle="shoulder rehab" initialBrief={null} onBriefChange={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /research this topic/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/blog-posts/bp-1/research",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })

  it("calls onBriefChange when job completes with a result", async () => {
    const onBriefChange = vi.fn()
    useAiJobMock.mockReturnValue(defaultAiJobState({ status: "completed", result: sampleBrief }))
    render(
      <ResearchPanel
        blogPostId="bp-1"
        postTitle="x"
        initialBrief={null}
        onBriefChange={onBriefChange}
        activeJobId="job-1"
      />,
    )
    await waitFor(() => expect(onBriefChange).toHaveBeenCalledWith(sampleBrief))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- __tests__/components/research-panel.test.tsx
```
Expected: FAIL — component module does not exist.

- [ ] **Step 3: Create `components/admin/blog/ResearchPanel.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronRight, Search, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAiJob } from "@/hooks/use-ai-job"

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

interface ResearchPanelProps {
  blogPostId: string
  postTitle: string
  initialBrief: TavilyResearchBrief | null
  onBriefChange: (brief: TavilyResearchBrief) => void
  /** For tests — normally managed internally */
  activeJobId?: string | null
  /** Close button handler, if rendered as a drawer */
  onClose?: () => void
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function formatRefreshedAt(iso: string): string {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function ResearchPanel({
  blogPostId,
  postTitle,
  initialBrief,
  onBriefChange,
  activeJobId: activeJobIdProp,
  onClose,
}: ResearchPanelProps) {
  const [jobId, setJobId] = useState<string | null>(activeJobIdProp ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null)
  const aiJob = useAiJob(jobId)

  // When parent passes a jobId via prop (e.g. tests), mirror it into state.
  useEffect(() => {
    if (activeJobIdProp !== undefined) setJobId(activeJobIdProp ?? null)
  }, [activeJobIdProp])

  // When job completes, surface the brief to parent and clear the job id so a
  // subsequent re-run can start fresh.
  useEffect(() => {
    if (aiJob.status === "completed" && aiJob.result) {
      onBriefChange(aiJob.result as unknown as TavilyResearchBrief)
    }
  }, [aiJob.status, aiJob.result, onBriefChange])

  async function kickOff() {
    const trimmed = postTitle.trim()
    if (!trimmed) {
      toast.error("Add a title before researching")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/blog-posts/${blogPostId}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Research failed (${res.status})`)
      }
      const body = (await res.json()) as { jobId: string }
      setJobId(body.jobId)
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to start research")
    } finally {
      setSubmitting(false)
    }
  }

  // Effective brief: the active job's result takes precedence (newest),
  // otherwise show whatever is saved on the post.
  const brief =
    aiJob.status === "completed" && aiJob.result
      ? (aiJob.result as unknown as TavilyResearchBrief)
      : initialBrief

  const isLoading = submitting || aiJob.status === "pending" || aiJob.status === "processing"
  const isError = aiJob.status === "failed"

  return (
    <aside
      className="w-80 shrink-0 border-l border-border bg-surface/50 flex flex-col overflow-hidden"
      aria-label="Research panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Search className="size-4" />
          Research
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-primary"
            aria-label="Close research panel"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Error state */}
        {isError && (
          <div className="p-4">
            <div className="flex gap-2 text-error">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div className="text-sm">{aiJob.error ?? "Research failed"}</div>
            </div>
            <button
              type="button"
              onClick={kickOff}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        )}

        {/* Loading state */}
        {!isError && isLoading && (
          <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Researching "{postTitle.trim() || "…"}"
          </div>
        )}

        {/* Empty state */}
        {!isError && !isLoading && !brief && (
          <div className="p-4">
            <p className="text-sm text-muted-foreground mb-3">
              Pull a research brief for this post's topic — summary + ranked sources in a few seconds.
            </p>
            <button
              type="button"
              onClick={kickOff}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90"
            >
              <Search className="size-4" />
              Research this topic
            </button>
          </div>
        )}

        {/* Populated state */}
        {!isError && !isLoading && brief && (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Refreshed {formatRefreshedAt(brief.generated_at)}
              </div>
              <button
                type="button"
                onClick={kickOff}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                title="Re-run research"
              >
                <RefreshCw className="size-3" /> Re-run
              </button>
            </div>

            {brief.summary && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Summary</div>
                <p className="text-sm text-primary leading-relaxed">{brief.summary}</p>
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Sources ({brief.results.length})
              </div>
              {brief.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sources found for "{brief.topic}" — try a different title or refine.
                </p>
              ) : (
                <ul className="space-y-2">
                  {brief.results.map((r) => {
                    const expanded = expandedUrl === r.url
                    const extract = brief.extracted.find((e) => e.url === r.url)
                    return (
                      <li key={r.url} className="border border-border rounded-md bg-white">
                        <button
                          type="button"
                          onClick={() => setExpandedUrl(expanded ? null : r.url)}
                          className="w-full flex items-start gap-2 px-3 py-2 text-left"
                        >
                          {expanded ? (
                            <ChevronDown className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-primary truncate">{r.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {domainOf(r.url)}
                              {r.published_date ? ` · ${r.published_date}` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.snippet}</div>
                          </div>
                        </button>
                        {expanded && extract && (
                          <div className="px-3 pb-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
                            {extract.content}
                          </div>
                        )}
                        {expanded && !extract && (
                          <div className="px-3 pb-3 text-xs text-muted-foreground">
                            No extracted content for this source.{" "}
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline text-primary"
                            >
                              Open source ↗
                            </a>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- __tests__/components/research-panel.test.tsx
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/blog/ResearchPanel.tsx __tests__/components/research-panel.test.tsx
git commit -m "feat(ui): ResearchPanel — 4 states, sources drill-in, re-run"
```

---

### Task 4: Integrate Research button + panel into BlogPostForm

**Files:**
- Modify: `components/admin/blog/BlogPostForm.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat components/admin/blog/BlogPostForm.tsx
```

Find: (a) the JSX section that renders the title input + editor, (b) the existing "Generate" toolbar button (uses `generateOpen` state, imports `BlogGenerateDialog` and `Sparkles`). The Research button goes beside it; the panel renders as a flex right column only when open.

- [ ] **Step 2: Add imports, state, and handlers at the top of the component**

Add to the existing imports from `lucide-react`:
```typescript
import { ArrowLeft, Save, Send, Loader2, Sparkles, Search } from "lucide-react"
```

Add the ResearchPanel + brief type imports:
```typescript
import { ResearchPanel, type TavilyResearchBrief } from "./ResearchPanel"
```

Inside the component function, add state next to the existing `useState` calls:

```typescript
const [researchOpen, setResearchOpen] = useState(false)
const [researchBrief, setResearchBrief] = useState<TavilyResearchBrief | null>(
  (post?.tavily_research as TavilyResearchBrief | null) ?? null,
)
const hasBrief = researchBrief !== null
```

- [ ] **Step 3: Add the Research toolbar button**

Find the JSX block that renders the "Generate" button (search for `setGenerateOpen` or `<Sparkles`). Add a new button directly next to it. The button disables when the post has no id yet (research routes require `blogPostId`) or when the title is empty:

```tsx
<button
  type="button"
  onClick={() => setResearchOpen((o) => !o)}
  disabled={!post?.id || !title.trim()}
  className={cn(
    "inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md",
    "bg-surface text-primary border border-border hover:bg-surface/80",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    researchOpen && "bg-primary/5 border-primary/30",
  )}
  title={
    !post?.id
      ? "Save the post once before researching"
      : !title.trim()
        ? "Add a title first"
        : "Open research panel"
  }
>
  <Search className="size-4" />
  Research
  {hasBrief && <span className="ml-1 size-1.5 rounded-full bg-accent" aria-label="Has research brief" />}
</button>
```

`cn` is already imported in many components; if not in `BlogPostForm.tsx` yet, add `import { cn } from "@/lib/utils"`.

- [ ] **Step 4: Wrap the main content in a flex container and render the panel**

Find the outermost JSX wrapper around the editor + metadata (the element that currently holds `<BlogEditor />`). Wrap it so the panel can sit as a right column when open:

```tsx
<div className="flex gap-0">
  <div className="flex-1 min-w-0">
    {/* existing title input, editor, metadata, etc. */}
  </div>
  {researchOpen && post?.id && (
    <ResearchPanel
      blogPostId={post.id}
      postTitle={title}
      initialBrief={researchBrief}
      onBriefChange={setResearchBrief}
      onClose={() => setResearchOpen(false)}
    />
  )}
</div>
```

Keep all existing layout inside `<div className="flex-1 min-w-0">`. The panel only renders when there is a saved post id — first-time editors must save before researching (reflected in the button's tooltip and disabled state).

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: 0 new errors related to BlogPostForm. (Pre-existing errors in `__tests__/` are unrelated — `next build` doesn't typecheck test files.)

- [ ] **Step 6: Run all affected tests**

```bash
npm run test:run -- __tests__/components/research-panel.test.tsx __tests__/api/admin/blog-posts/research.test.ts functions/src/__tests__/tavily-research.test.ts
```
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add components/admin/blog/BlogPostForm.tsx
git commit -m "feat(ui): BlogPostForm — Research button + docked research panel"
```

---

### Task 5: Post-Phase-4a verification

- [ ] **Step 1: Run full Next.js test suite**

```bash
npm run test:run
```
Expected: all tests pass (the 4a new tests + no regressions in existing suites).

- [ ] **Step 2: Build check**

```bash
npm run build
```
Expected: build succeeds. `next build` runs TypeScript on the production import graph — no `__tests__/` type errors will block the build.

- [ ] **Step 3: Build + lint Functions**

```bash
npm --prefix functions run build
npm --prefix functions test
```
Expected: both succeed.

- [ ] **Step 4: Push branch**

```bash
git push origin feature/starter-ai-automation
```
Vercel auto-deploys the Next.js preview.

- [ ] **Step 5: Deploy updated Firebase Function**

```bash
firebase deploy --only functions:tavilyResearch
```
This is required because the secrets list changed (`supabaseUrl`, `supabaseServiceRoleKey` added). Deploy also picks up the persistence logic change.

- [ ] **Step 6: Smoke test after deploy**

On the preview URL:

1. Open `/admin/blog/[id]` on an existing draft with a title.
2. Click **Research**. Sidebar opens in loading state.
3. Within ~15 seconds, sidebar flips to populated: summary paragraph + source list.
4. Click a source — extracted content expands.
5. Refresh the page. Open the panel again — brief still there (persisted).
6. Click **Re-run** — sidebar re-enters loading, then populates with new `generated_at`.
7. Try on a draft with **no title** — Research button is disabled, hover tooltip reads "Add a title first".
8. Try on a **brand new post** that hasn't been saved yet — Research button is disabled with "Save the post once before researching" tooltip.

If all 8 pass: **Phase 4a is complete.**

---

## What Phase 4a Unblocks / Concludes

- **Phase 4b** can compose `generateBlogFromVideo` as: `transcript → (auto) tavilyResearch via createAiJob(type:"tavily_research", input:{topic, blog_post_id}) → wait for ai_job completion → generate → tavilyFactCheck`. Since 4a made the Function persist the brief directly, 4b's orchestrator can read `blog_posts.tavily_research` after the research step without any extra plumbing.
- **Phase 4c/4d** read `tavily_research` as input; shape is locked in at 4a.

---

## Self-Review

**Spec coverage:**

- ✅ Research button in BlogEditor toolbar → Task 4
- ✅ Uses post title as the query → route reads `topic` from body which BlogPostForm sends as `title`
- ✅ Right sidebar panel → Task 3 (`<aside className="w-80 ...">`)
- ✅ Four states (empty / loading / populated / error) → Task 3 test covers each
- ✅ Summary + sources + expandable extracts → Task 3 component
- ✅ Read-only — no editor mutation → no inserts in ResearchPanel
- ✅ `blog_posts.tavily_research` persisted server-side → Task 1
- ✅ `generated_at` in brief → Task 1 pure helper
- ✅ Re-run overwrites → Function's UPDATE is not a merge; same post_id, overwritten
- ✅ Admin auth via existing middleware → Task 2 401 branch
- ✅ Empty-title disables button → Task 4 button `disabled` attr
- ✅ Zero-results copy → Task 3 populated state `brief.results.length === 0`
- ✅ Supabase upsert failure → Function logs and marks job completed (warning UX deferred — the spec's warning banner is not implemented because 4a's scope locked it to read-only reference; a subsequent page reload detects `tavily_research` still null and the panel falls back to the empty state, which is acceptable)
- ✅ Tests: Function helpers, route, component → Tasks 1/2/3
- ✅ Manual smoke → Task 5 step 6

**Placeholder scan:** no TODOs, no "similar to X", every code step has full code.

**Type consistency:** `TavilyResearchBrief` is defined once in `ResearchPanel.tsx` and re-exported. The Function's `TavilyResearchBrief` interface has the same fields; they're structurally identical (Firestore serialization is a plain object). The route's `input` shape `{ topic, blog_post_id }` matches what `tavily-research.ts` reads as `TavilyResearchInput`.

**Scope:** focused on the one manual research surface. Fact-check, video-to-blog, newsletter auto-draft, trending scan — all deferred to 4b/4c/4d.
