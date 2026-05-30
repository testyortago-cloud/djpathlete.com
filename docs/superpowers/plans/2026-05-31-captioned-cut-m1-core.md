# Captioned Cut — Milestone 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate Captioned Cut" action to the Content Studio video drawer that renders a 9:16 word-pop–captioned MP4 from a video's existing speech transcript, stores it in Firebase Storage, and creates draft video posts.

**Architecture:** A Next.js create-route validates + guards + queues a Firestore `ai_jobs` doc of new type `video_caption_render`. A tiny Firebase `onDocumentCreated` trigger atomically claims the job and launches a Cloud Run **Job** (`@google-cloud/run` `runJob`). The Cloud Run container (a new `render-worker/` root) fetches AssemblyAI word timestamps, renders the caption overlay with Remotion (headless Chromium), uploads the MP4 to Firebase Storage, writes a `media_assets` row + one draft `social_post` per video-capable connected platform, and flips the job doc to `completed`/`failed`. The drawer polls the job via the existing `useAiJob` hook.

**Tech Stack:** Next.js 16 (App Router), Supabase (service-role DAL), Firebase (Firestore `ai_jobs`, Storage, Cloud Run Job), Remotion (`@remotion/bundle` + `@remotion/renderer`), AssemblyAI v2, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-31-captioned-cut-design.md`

---

## File Structure

**New files:**
- `lib/content-studio/caption-paging.ts` — pure: `TranscriptWord[]` → timed `CaptionPage[]` (≤3 words/page). Canonical copy; unit-tested.
- `lib/validators/captioned-cut.ts` — Zod schema for the create-route payload.
- `lib/feature-flag-catalog.ts` — declares `feature_captioned_cut_enabled` so the existing toggle-cron route + automation page can surface it.
- `app/api/admin/content-studio/captioned-cut/route.ts` — create-job route (auth, flag gate, validate, transcript guard, in-flight guard, `createAiJob`).
- `components/admin/content-studio/drawer/GenerateCaptionedCutButton.tsx` — drawer button + `useAiJob` polling.
- `functions/src/caption-render-trigger.ts` — trigger handler: atomic claim + Cloud Run `runJob`.
- `render-worker/package.json`, `render-worker/tsconfig.json`, `render-worker/Dockerfile`, `render-worker/.dockerignore` — worker root.
- `render-worker/src/index.ts` — worker entrypoint (orchestrates render → upload → DB → job update).
- `render-worker/src/remotion/Root.tsx`, `render-worker/src/remotion/CaptionedCut.tsx`, `render-worker/src/remotion/index.ts` — Remotion composition.
- `render-worker/src/lib/caption-paging.ts` — twin copy of the pure pager (functions/worker cannot import `lib/`).
- `render-worker/src/lib/assemblyai-words.ts` — fetch `words[]` from AssemblyAI.
- `render-worker/src/lib/color.ts` — oklch→sRGB-hex for the accent.
- Test files mirroring each testable unit under `__tests__/`.

**Modified files:**
- `lib/ai-jobs.ts` — add `video_caption_render` to `AiJobType`; add `findInFlightCaptionRender()`.
- `app/api/admin/automation/toggle-cron/route.ts` — allow feature-flag keys, not just cron keys.
- `app/(admin)/admin/automation/page.tsx` — render a "Features" section with the new toggle.
- `lib/db/video-transcripts.ts` — add `getSpeechTranscriptForVideo()`.
- `components/admin/content-studio/drawer/DrawerVideoHeader.tsx` — mount the new button; thread a `captionedCutEnabled` prop.
- `components/admin/content-studio/drawer/DrawerContent.tsx` + `lib/content-studio/drawer-data.ts` + `app/(admin)/admin/content/[videoId]/page.tsx` — thread `captionedCutEnabled` from server to the header.
- `functions/src/index.ts` — register the `captionRender` trigger.
- `functions/package.json` — add `@google-cloud/run`.

---

## Task 1: Pure caption-paging function

**Files:**
- Create: `lib/content-studio/caption-paging.ts`
- Test: `__tests__/lib/content-studio/caption-paging.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/content-studio/caption-paging.test.ts
import { describe, it, expect } from "vitest"
import { pageCaptions, type TranscriptWord } from "@/lib/content-studio/caption-paging"

const w = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end })

describe("pageCaptions", () => {
  it("returns [] for empty input", () => {
    expect(pageCaptions([])).toEqual([])
  })

  it("puts a single word on one page with its own timing", () => {
    const pages = pageCaptions([w("go", 100, 400)])
    expect(pages).toHaveLength(1)
    expect(pages[0].text).toBe("go")
    expect(pages[0].startMs).toBe(100)
    expect(pages[0].endMs).toBe(400)
    expect(pages[0].words).toEqual([{ text: "go", startMs: 100, endMs: 400 }])
  })

  it("chunks into <=3-word pages by default (7 words -> 3/3/1)", () => {
    const words = [
      w("a", 0, 100), w("b", 100, 200), w("c", 200, 300),
      w("d", 300, 400), w("e", 400, 500), w("f", 500, 600),
      w("g", 600, 700),
    ]
    const pages = pageCaptions(words)
    expect(pages.map((p) => p.text)).toEqual(["a b c", "d e f", "g"])
    expect(pages[0].startMs).toBe(0)
    expect(pages[0].endMs).toBe(300)
    expect(pages[2].startMs).toBe(600)
    expect(pages[2].endMs).toBe(700)
  })

  it("honors a custom maxWordsPerPage", () => {
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 200, 300)]
    expect(pageCaptions(words, { maxWordsPerPage: 2 }).map((p) => p.text)).toEqual(["a b", "c"])
  })

  it("skips empty/whitespace words", () => {
    const pages = pageCaptions([w("a", 0, 100), w("  ", 100, 200), w("b", 200, 300)])
    expect(pages.map((p) => p.text)).toEqual(["a b"])
  })

  it("clamps a word whose end precedes its start", () => {
    const pages = pageCaptions([w("x", 500, 200)])
    expect(pages[0].startMs).toBe(500)
    expect(pages[0].endMs).toBe(500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/content-studio/caption-paging.test.ts`
Expected: FAIL — `pageCaptions` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/content-studio/caption-paging.ts
// Pure: AssemblyAI word list -> timed caption "pages" (<=N words each) for the
// word-pop overlay. No I/O. Twin-copied into render-worker/src/lib so the
// Cloud Run worker can use it without importing lib/ (see CLAUDE.md boundary).

export interface TranscriptWord {
  text: string
  start: number // ms
  end: number // ms
}

export interface CaptionPageWord {
  text: string
  startMs: number
  endMs: number
}

export interface CaptionPage {
  text: string
  words: CaptionPageWord[]
  startMs: number
  endMs: number
}

const DEFAULT_MAX_WORDS_PER_PAGE = 3

export function pageCaptions(
  words: TranscriptWord[],
  opts: { maxWordsPerPage?: number } = {},
): CaptionPage[] {
  const maxWords = Math.max(1, opts.maxWordsPerPage ?? DEFAULT_MAX_WORDS_PER_PAGE)

  const clean = words
    .filter((w) => typeof w.text === "string" && w.text.trim().length > 0)
    .map<CaptionPageWord>((w) => ({
      text: w.text.trim(),
      startMs: w.start,
      endMs: Math.max(w.start, w.end), // clamp inverted ranges
    }))

  const pages: CaptionPage[] = []
  for (let i = 0; i < clean.length; i += maxWords) {
    const group = clean.slice(i, i + maxWords)
    pages.push({
      text: group.map((g) => g.text).join(" "),
      words: group,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
    })
  }
  return pages
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/content-studio/caption-paging.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/caption-paging.ts __tests__/lib/content-studio/caption-paging.test.ts
git commit -m "feat(captioned-cut): pure caption-paging function"
```

---

## Task 2: Add job type + in-flight lookup to ai-jobs

**Files:**
- Modify: `lib/ai-jobs.ts`
- Test: `__tests__/lib/ai-jobs-caption-render.test.ts`

- [ ] **Step 1: Add the job type literal**

In `lib/ai-jobs.ts`, add `video_caption_render` to the `AiJobType` union (after `video_vision` on line 26):

```typescript
  | "video_transcription"
  | "video_vision"
  | "video_caption_render"
  | "image_vision"
```

- [ ] **Step 2: Add the in-flight lookup helper**

Append to `lib/ai-jobs.ts` (after `createAiJob`):

```typescript
/**
 * Returns the id of an existing captioned-cut render job for this video that is
 * still pending/processing, or null. Used by the create-route to avoid
 * double-queuing on a rapid second click. Requires a Firestore composite index
 * on (type ASC, input.videoUploadId ASC, status ASC) — Firestore prints a
 * one-click "create index" link the first time this query runs.
 */
export async function findInFlightCaptionRender(videoUploadId: string): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "video_caption_render")
    .where("input.videoUploadId", "==", videoUploadId)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0].id
}
```

- [ ] **Step 3: Write a type-level test**

```typescript
// __tests__/lib/ai-jobs-caption-render.test.ts
import { describe, it, expect } from "vitest"
import type { AiJobType } from "@/lib/ai-jobs"

describe("AiJobType includes video_caption_render", () => {
  it("accepts the literal", () => {
    const t: AiJobType = "video_caption_render"
    expect(t).toBe("video_caption_render")
  })
})
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm run test:run -- __tests__/lib/ai-jobs-caption-render.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no new errors from `lib/ai-jobs.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-jobs.ts __tests__/lib/ai-jobs-caption-render.test.ts
git commit -m "feat(captioned-cut): video_caption_render job type + in-flight lookup"
```

---

## Task 3: Speech-transcript guard DAL helper

**Files:**
- Modify: `lib/db/video-transcripts.ts`
- Test: `__tests__/db/video-transcripts-speech.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/db/video-transcripts-speech.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { saveTranscript, getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createServiceRoleClient } from "@/lib/supabase"

const TAG = "__TEST_SPEECH_TX__"

describe("getSpeechTranscriptForVideo", () => {
  const supabase = createServiceRoleClient()
  const cleanup = () =>
    supabase.from("video_uploads").delete().like("original_filename", `${TAG}%`)
  beforeEach(cleanup)
  afterAll(cleanup)

  async function makeVideo(suffix: string) {
    return createVideoUpload({
      storage_path: `videos/${TAG}${suffix}.mp4`,
      original_filename: `${TAG}${suffix}.mp4`,
      duration_seconds: 30,
      size_bytes: 1024,
      mime_type: "video/mp4",
      title: null,
      uploaded_by: null,
      status: "transcribed",
    })
  }

  it("returns a speech transcript with an assemblyai id", async () => {
    const v = await makeVideo("a")
    await saveTranscript({
      video_upload_id: v.id,
      transcript_text: "hello athletes welcome back",
      language: "en",
      assemblyai_job_id: "aa_speech_1",
      analysis: null,
      source: "speech",
    })
    const t = await getSpeechTranscriptForVideo(v.id)
    expect(t?.assemblyai_job_id).toBe("aa_speech_1")
    expect(t?.source).toBe("speech")
  })

  it("returns null when only a vision transcript exists", async () => {
    const v = await makeVideo("b")
    await saveTranscript({
      video_upload_id: v.id,
      transcript_text: "a person performing a lift",
      language: "en",
      assemblyai_job_id: null,
      analysis: null,
      source: "vision",
    })
    expect(await getSpeechTranscriptForVideo(v.id)).toBeNull()
  })

  it("returns null when no transcript exists", async () => {
    const v = await makeVideo("c")
    expect(await getSpeechTranscriptForVideo(v.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/db/video-transcripts-speech.test.ts`
Expected: FAIL — `getSpeechTranscriptForVideo` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `lib/db/video-transcripts.ts`:

```typescript
/**
 * The captioned-cut guard: the most recent SPEECH transcript (with a non-null
 * AssemblyAI id) for a video, or null. Vision-fallback rows (source='vision',
 * no word timings) are deliberately excluded — captions need word-level timing.
 */
export async function getSpeechTranscriptForVideo(
  videoUploadId: string,
): Promise<VideoTranscript | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_transcripts")
    .select("*")
    .eq("video_upload_id", videoUploadId)
    .eq("source", "speech")
    .not("assemblyai_job_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as VideoTranscript | null) ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/db/video-transcripts-speech.test.ts`
Expected: PASS (3 tests). (Requires Supabase env — same as the existing `__tests__/db/video-uploads.test.ts`.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/video-transcripts.ts __tests__/db/video-transcripts-speech.test.ts
git commit -m "feat(captioned-cut): speech-only transcript guard helper"
```

---

## Task 4: Create-route Zod validator

**Files:**
- Create: `lib/validators/captioned-cut.ts`
- Test: `__tests__/validators/captioned-cut.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/validators/captioned-cut.test.ts
import { describe, it, expect } from "vitest"
import { captionedCutRequestSchema } from "@/lib/validators/captioned-cut"

const UUID = "11111111-1111-1111-1111-111111111111"

describe("captionedCutRequestSchema", () => {
  it("accepts videoUploadId alone", () => {
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: UUID }).success).toBe(true)
  })
  it("accepts submissionId alone", () => {
    expect(captionedCutRequestSchema.safeParse({ submissionId: UUID }).success).toBe(true)
  })
  it("rejects both at once", () => {
    expect(
      captionedCutRequestSchema.safeParse({ videoUploadId: UUID, submissionId: UUID }).success,
    ).toBe(false)
  })
  it("rejects neither", () => {
    expect(captionedCutRequestSchema.safeParse({}).success).toBe(false)
  })
  it("rejects a non-uuid", () => {
    expect(captionedCutRequestSchema.safeParse({ videoUploadId: "nope" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/validators/captioned-cut.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

```typescript
// lib/validators/captioned-cut.ts
import { z } from "zod"

/**
 * Create-route payload. Exactly one of videoUploadId (Content Studio drawer
 * path) or submissionId (team-review path, Milestone 2) must be present.
 */
export const captionedCutRequestSchema = z
  .object({
    videoUploadId: z.string().uuid().optional(),
    submissionId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.videoUploadId) !== Boolean(d.submissionId), {
    message: "Provide exactly one of videoUploadId or submissionId",
  })

export type CaptionedCutRequest = z.infer<typeof captionedCutRequestSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/validators/captioned-cut.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/captioned-cut.ts __tests__/validators/captioned-cut.test.ts
git commit -m "feat(captioned-cut): create-route Zod validator"
```

---

## Task 5: Feature-flag catalog + admin toggle wiring

**Files:**
- Create: `lib/feature-flag-catalog.ts`
- Modify: `app/api/admin/automation/toggle-cron/route.ts`
- Modify: `app/(admin)/admin/automation/page.tsx`
- Test: `__tests__/lib/feature-flag-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/feature-flag-catalog.test.ts
import { describe, it, expect } from "vitest"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"

describe("feature flag catalog", () => {
  it("declares the captioned-cut flag, default off", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_captioned_cut_enabled")
    expect(flag).toBeDefined()
    expect(flag?.defaultEnabled).toBe(false)
  })
  it("recognizes a known key and rejects an unknown one", () => {
    expect(isFeatureFlagKey("feature_captioned_cut_enabled")).toBe(true)
    expect(isFeatureFlagKey("feature_bogus")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/feature-flag-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the catalog**

```typescript
// lib/feature-flag-catalog.ts
// DB-backed feature toggles (system_settings rows), distinct from CRON_CATALOG.
// Surfaced on /admin/automation and flippable via /api/admin/automation/toggle-cron.
// New flags MUST be DB-backed (never env-driven) — see project convention.

export interface FeatureFlag {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
}

export const FEATURE_FLAG_CATALOG: readonly FeatureFlag[] = [
  {
    key: "feature_captioned_cut_enabled",
    label: "Captioned video cuts",
    description:
      "Adds a 'Generate Captioned Cut' button to videos in Content Studio. Renders a vertical 9:16 clip with TikTok-style word-pop captions burned in, ready to post. Off by default.",
    defaultEnabled: false,
  },
] as const

export function isFeatureFlagKey(key: string): boolean {
  return FEATURE_FLAG_CATALOG.some((f) => f.key === key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/feature-flag-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Extend the toggle-cron allow-list**

In `app/api/admin/automation/toggle-cron/route.ts`, add the import and widen `isAllowedKey`:

```typescript
import { CRON_CATALOG } from "@/lib/cron-catalog"
import { isFeatureFlagKey } from "@/lib/feature-flag-catalog"
```

```typescript
function isAllowedKey(key: string): boolean {
  return CRON_CATALOG.some((c) => c.enabledKey === key) || isFeatureFlagKey(key)
}
```

(The route already records `feature_flag.toggled` audit for `feature_`-prefixed keys — no other change needed.)

- [ ] **Step 6: Render the toggle on the automation page**

In `app/(admin)/admin/automation/page.tsx`, add imports:

```typescript
import { FEATURE_FLAG_CATALOG } from "@/lib/feature-flag-catalog"
```

Resolve the feature states next to the cron states (after the `enabledStates` block):

```typescript
  const featureStates = await Promise.all(
    FEATURE_FLAG_CATALOG.map((f) => getSetting<boolean>(f.key, f.defaultEnabled)),
  )
```

Add this block immediately after the closing `</div>` of the "Automated tasks" card (before the "How this works" panel):

```tsx
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Clock className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Features</h2>
        </div>
        <div className="divide-y divide-border">
          {FEATURE_FLAG_CATALOG.map((flag, idx) => (
            <div key={flag.key} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-primary">{flag.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{flag.description}</p>
              </div>
              <div className="shrink-0">
                <CronEnabledToggle
                  enabledKey={flag.key}
                  initialEnabled={featureStates[idx]}
                  label={flag.label}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
```

(`CronEnabledToggle` is already imported on this page and POSTs to the same toggle-cron route — it's a generic switch, the name is historical.)

- [ ] **Step 7: Verify build + typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add lib/feature-flag-catalog.ts __tests__/lib/feature-flag-catalog.test.ts app/api/admin/automation/toggle-cron/route.ts "app/(admin)/admin/automation/page.tsx"
git commit -m "feat(captioned-cut): DB-backed feature flag + admin toggle"
```

---

## Task 6: Create-job route

**Files:**
- Create: `app/api/admin/content-studio/captioned-cut/route.ts`
- Test: `__tests__/api/captioned-cut-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/captioned-cut-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/video-uploads", () => ({ getVideoUploadById: vi.fn() }))
vi.mock("@/lib/db/video-transcripts", () => ({ getSpeechTranscriptForVideo: vi.fn() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: vi.fn(), findInFlightCaptionRender: vi.fn() }))

import { POST } from "@/app/api/admin/content-studio/captioned-cut/route"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightCaptionRender } from "@/lib/ai-jobs"

const UUID = "11111111-1111-1111-1111-111111111111"
const admin = { user: { id: "admin-1", role: "admin" } }

function req(body: unknown) {
  return new Request("http://test/api/admin/content-studio/captioned-cut", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(true) // flag on
  ;(getVideoUploadById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID })
  ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
    assemblyai_job_id: "aa_1",
    source: "speech",
  })
  ;(findInFlightCaptionRender as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(createAiJob as ReturnType<typeof vi.fn>).mockResolvedValue({ jobId: "job-1", status: "pending" })
})

describe("POST /api/admin/content-studio/captioned-cut", () => {
  it("401 for non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(401)
  })

  it("403 when the feature flag is off", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(403)
  })

  it("400 on an invalid payload (both ids)", async () => {
    expect((await POST(req({ videoUploadId: UUID, submissionId: UUID }))).status).toBe(400)
  })

  it("404 when the video is missing", async () => {
    ;(getVideoUploadById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(404)
  })

  it("422 when there is no speech transcript", async () => {
    ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(422)
  })

  it("200 + existing jobId when a render is already in flight", async () => {
    ;(findInFlightCaptionRender as ReturnType<typeof vi.fn>).mockResolvedValue("inflight-9")
    const res = await POST(req({ videoUploadId: UUID }))
    expect(res.status).toBe(200)
    expect((await res.json()).jobId).toBe("inflight-9")
    expect(createAiJob).not.toHaveBeenCalled()
  })

  it("202 + new jobId on the happy path", async () => {
    const res = await POST(req({ videoUploadId: UUID }))
    expect(res.status).toBe(202)
    expect((await res.json()).jobId).toBe("job-1")
    expect(createAiJob).toHaveBeenCalledWith({
      type: "video_caption_render",
      userId: "admin-1",
      input: { videoUploadId: UUID },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/api/captioned-cut-route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```typescript
// app/api/admin/content-studio/captioned-cut/route.ts
// Create-job route for the Captioned Cut feature. Admin-only, gated by the
// DB-backed feature_captioned_cut_enabled flag. Validates the payload, resolves
// to a video_uploads id (Milestone 1: videoUploadId only — submissionId is
// handled in Milestone 2), enforces the speech-transcript guard, dedupes against
// an in-flight render, then queues a video_caption_render ai_job.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { captionedCutRequestSchema } from "@/lib/validators/captioned-cut"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightCaptionRender } from "@/lib/ai-jobs"

export async function POST(request: NextRequest | Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const enabled = await getSetting<boolean>("feature_captioned_cut_enabled", false)
  if (!enabled) {
    return NextResponse.json({ error: "Captioned Cut is disabled." }, { status: 403 })
  }

  const parsed = captionedCutRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Milestone 1: drawer path only. submissionId is wired in Milestone 2.
  if (!parsed.data.videoUploadId) {
    return NextResponse.json(
      { error: "submissionId is not supported yet — open the video in Content Studio." },
      { status: 400 },
    )
  }
  const videoUploadId = parsed.data.videoUploadId

  const video = await getVideoUploadById(videoUploadId)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  // Transcript guard: needs a speech transcript with word timings.
  const transcript = await getSpeechTranscriptForVideo(videoUploadId)
  if (!transcript) {
    return NextResponse.json(
      { error: "No speech transcript yet — captions need a spoken-audio transcript first." },
      { status: 422 },
    )
  }

  // In-flight guard: surface the running job instead of double-queuing.
  const inFlight = await findInFlightCaptionRender(videoUploadId)
  if (inFlight) {
    return NextResponse.json({ jobId: inFlight }, { status: 200 })
  }

  const { jobId } = await createAiJob({
    type: "video_caption_render",
    userId: session.user.id,
    input: { videoUploadId },
  })
  return NextResponse.json({ jobId }, { status: 202 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/api/captioned-cut-route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/content-studio/captioned-cut/route.ts __tests__/api/captioned-cut-route.test.ts
git commit -m "feat(captioned-cut): create-job route with flag/transcript/in-flight guards"
```

---

## Task 7: Drawer button + server flag threading

**Files:**
- Create: `components/admin/content-studio/drawer/GenerateCaptionedCutButton.tsx`
- Modify: `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`
- Modify: `components/admin/content-studio/drawer/DrawerContent.tsx`
- Modify: `lib/content-studio/drawer-data.ts`
- Modify: `app/(admin)/admin/content/[videoId]/page.tsx`

- [ ] **Step 1: Add `captionedCutEnabled` to DrawerData + load it**

In `lib/content-studio/drawer-data.ts`:

Add the import at the top:

```typescript
import { getSetting } from "@/lib/db/system-settings"
```

Add the field to the `DrawerData` interface (after `highlightPostId`):

```typescript
  /** Whether the Captioned Cut feature flag is on (gates the drawer button). */
  captionedCutEnabled: boolean
```

In `getDrawerData`, fold the flag read into the existing `Promise.all` and return it. Replace the `Promise.all` + return with:

```typescript
  const [transcript, posts, previewUrl, captionedCutEnabled] = await Promise.all([
    getTranscriptForVideo(videoId),
    listSocialPostsBySourceVideo(videoId),
    signPreviewUrl(video.storage_path),
    getSetting<boolean>("feature_captioned_cut_enabled", false),
  ])

  const mediaByPost = await signMediaByPost(posts.map((p) => p.id))

  return {
    mode: "video",
    video,
    previewUrl,
    transcript,
    posts,
    mediaByPost,
    highlightPostId: null,
    captionedCutEnabled,
  }
```

In the two `getDrawerDataForPost` fallback returns (the `post-only` objects), add `captionedCutEnabled: false` so the type is satisfied:

```typescript
      mediaByPost: await signMediaByPost([post.id]),
      highlightPostId: post.id,
      captionedCutEnabled: false,
```

(Apply to both `post-only` return objects in that function. The `return { ...base, highlightPostId: post.id }` branch already carries the flag from `base`.)

- [ ] **Step 2: Build the button component**

```tsx
// components/admin/content-studio/drawer/GenerateCaptionedCutButton.tsx
"use client"

import { useState, useEffect } from "react"
import { Clapperboard } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useAiJob } from "@/hooks/use-ai-job"

interface GenerateCaptionedCutButtonProps {
  videoUploadId: string
  hasTranscript: boolean
}

export function GenerateCaptionedCutButton({
  videoUploadId,
  hasTranscript,
}: GenerateCaptionedCutButtonProps) {
  const router = useRouter()
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { status, result, error } = useAiJob(jobId)

  const running = submitting || status === "pending" || status === "processing"
  const disabled = running || !hasTranscript

  useEffect(() => {
    if (status === "completed" && result) {
      const postIds = (result.postIds as string[] | undefined) ?? []
      toast.success(
        postIds.length
          ? `Captioned cut ready — ${postIds.length} draft post${postIds.length > 1 ? "s" : ""} created`
          : "Captioned cut ready",
      )
      if (postIds[0]) router.push(`/admin/content/post/${postIds[0]}`)
      setJobId(null)
    } else if (status === "failed") {
      toast.error(error || "Captioned cut failed")
      setJobId(null)
    }
  }, [status, result, error, router])

  async function generate() {
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      setJobId(data.jobId as string)
      toast.message("Rendering captioned cut… this can take a couple of minutes.")
    } catch (err) {
      toast.error((err as Error).message || "Failed to start render")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={generate}
      disabled={disabled}
      title={
        !hasTranscript
          ? "No speech transcript — captions need spoken audio"
          : "Render a vertical 9:16 clip with word-pop captions burned in"
      }
      className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      <Clapperboard className="size-3.5" />
      {running ? "Rendering…" : "Generate Captioned Cut"}
    </button>
  )
}
```

- [ ] **Step 3: Mount it in the header**

In `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`:

Add the import:

```typescript
import { GenerateCaptionedCutButton } from "./GenerateCaptionedCutButton"
```

Extend props:

```typescript
interface DrawerVideoHeaderProps {
  video: VideoUpload
  previewUrl: string | null
  hasTranscript?: boolean
  captionedCutEnabled?: boolean
}
```

```typescript
export function DrawerVideoHeader({
  video,
  previewUrl,
  hasTranscript = false,
  captionedCutEnabled = false,
}: DrawerVideoHeaderProps) {
```

Add the button next to the existing one in the action row:

```tsx
        <div className="mt-4 flex flex-wrap gap-2">
          <GenerateQuoteCardsButton videoUploadId={video.id} hasTranscript={hasTranscript} />
          {captionedCutEnabled && (
            <GenerateCaptionedCutButton videoUploadId={video.id} hasTranscript={hasTranscript} />
          )}
        </div>
```

- [ ] **Step 4: Pass the flag through DrawerContent**

In `components/admin/content-studio/drawer/DrawerContent.tsx`, pass the new prop to `DrawerVideoHeader`:

```tsx
        <DrawerVideoHeader
          video={data.video}
          previewUrl={data.previewUrl}
          hasTranscript={Boolean(data.transcript?.transcript_text)}
          captionedCutEnabled={data.captionedCutEnabled}
        />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`app/(admin)/admin/content/[videoId]/page.tsx` already calls `getDrawerData` and passes the whole `DrawerData` through `DetailDrawer` → `DrawerContent`, so no change is needed there — the new field flows automatically.)

- [ ] **Step 6: Commit**

```bash
git add components/admin/content-studio/drawer/GenerateCaptionedCutButton.tsx components/admin/content-studio/drawer/DrawerVideoHeader.tsx components/admin/content-studio/drawer/DrawerContent.tsx lib/content-studio/drawer-data.ts
git commit -m "feat(captioned-cut): drawer button gated by feature flag"
```

---

## Task 8: Render-worker scaffold

**Files:**
- Create: `render-worker/package.json`
- Create: `render-worker/tsconfig.json`
- Create: `render-worker/.dockerignore`
- Create: `render-worker/.gitignore`

- [ ] **Step 1: package.json**

```json
{
  "name": "djp-render-worker",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "studio": "remotion studio src/remotion/index.ts"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.14.0",
    "@remotion/bundler": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "firebase-admin": "^13.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "remotion": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: .dockerignore + .gitignore**

`render-worker/.dockerignore`:

```
node_modules
dist
```

`render-worker/.gitignore`:

```
node_modules
dist
```

- [ ] **Step 4: Install + verify it resolves**

Run: `cd render-worker && npm install && npx tsc --noEmit; cd ..`
Expected: install succeeds; `tsc` reports only "no inputs" or passes (source added in later tasks). It's fine if `tsc` errors on missing `src` until Task 9-10 land.

- [ ] **Step 5: Commit**

```bash
git add render-worker/package.json render-worker/tsconfig.json render-worker/.dockerignore render-worker/.gitignore render-worker/package-lock.json
git commit -m "feat(captioned-cut): render-worker scaffold"
```

---

## Task 9: Worker twin helpers

**Files:**
- Create: `render-worker/src/lib/caption-paging.ts` (twin of `lib/content-studio/caption-paging.ts`)
- Create: `render-worker/src/lib/assemblyai-words.ts`
- Create: `render-worker/src/lib/color.ts`
- Test: `__tests__/render-worker/color.test.ts`

- [ ] **Step 1: Copy the pager verbatim**

Create `render-worker/src/lib/caption-paging.ts` with the **exact** contents of `lib/content-studio/caption-paging.ts` from Task 1 (twin-file pattern; the canonical copy under `lib/` is the unit-tested one).

- [ ] **Step 2: AssemblyAI words fetcher**

```typescript
// render-worker/src/lib/assemblyai-words.ts
import type { TranscriptWord } from "./caption-paging.js"

const BASE_URL = "https://api.assemblyai.com/v2"

interface AssemblyTranscriptResponse {
  id: string
  status: string
  words?: { text: string; start: number; end: number }[]
  error?: string
}

/**
 * Fetch word-level timestamps for a completed AssemblyAI transcript. The
 * create-route guard guarantees this id exists; a failed/empty response here is
 * a hard error (no auto-resubmit).
 */
export async function fetchTranscriptWords(transcriptId: string): Promise<TranscriptWord[]> {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) throw new Error("ASSEMBLYAI_API_KEY not set")

  const res = await fetch(`${BASE_URL}/transcript/${transcriptId}`, {
    headers: { authorization: key },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`AssemblyAI fetch failed (${res.status}): ${text}`)
  }
  const body = (await res.json()) as AssemblyTranscriptResponse
  if (!body.words || body.words.length === 0) {
    throw new Error("AssemblyAI transcript has no word timestamps")
  }
  return body.words.map((w) => ({ text: w.text, start: w.start, end: w.end }))
}
```

- [ ] **Step 3: Write the failing color test**

```typescript
// __tests__/render-worker/color.test.ts
import { describe, it, expect } from "vitest"
import { oklchToHex } from "@/render-worker/src/lib/color"

describe("oklchToHex", () => {
  it("converts an oklch string to a 6-digit hex", () => {
    const hex = oklchToHex("oklch(0.70 0.13 140)")
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it("falls back to the brand accent on an unparseable string", () => {
    expect(oklchToHex("not-a-color")).toBe("#C49B7A")
  })
})
```

> Note: this test imports from `render-worker/src` via the repo's `@/` alias (root). If `vitest.config.ts` restricts roots, add the file to its `test.include`. Verify in Step 5.

- [ ] **Step 4: Implement color conversion**

```typescript
// render-worker/src/lib/color.ts
// Convert an oklch(L C H) string to an sRGB hex. Captions are encoded to
// H.264/yuv420p, so we bake a plain hex rather than relying on the renderer's
// Chromium build supporting oklch. Falls back to the brand accent on parse fail.

const BRAND_ACCENT_HEX = "#C49B7A"

export function oklchToHex(oklch: string): string {
  const m = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/i)
  if (!m) return BRAND_ACCENT_HEX

  const L = parseFloat(m[1])
  const C = parseFloat(m[2])
  const hDeg = parseFloat(m[3])
  if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(hDeg)) return BRAND_ACCENT_HEX

  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  // OKLab -> linear sRGB (Björn Ottosson's matrices)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const mm = m_ ** 3
  const s = s_ ** 3

  const lr = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s

  const toSrgb = (c: number) => {
    const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(x * 255)))
  }
  const hex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${hex(toSrgb(lr))}${hex(toSrgb(lg))}${hex(toSrgb(lb))}`
}
```

- [ ] **Step 5: Run the color test**

Run: `npm run test:run -- __tests__/render-worker/color.test.ts`
Expected: PASS (2 tests). If module resolution fails, add `"render-worker/src/**"` is reachable via the `@/` alias (root alias already maps `@/*` → repo root, so `@/render-worker/src/lib/color` resolves). If Vitest excludes it, add `__tests__/render-worker/**` to `test.include` in `vitest.config.ts`.

- [ ] **Step 6: Commit**

```bash
git add render-worker/src/lib __tests__/render-worker/color.test.ts
git commit -m "feat(captioned-cut): worker twin helpers (paging, words, color)"
```

---

## Task 10: Remotion composition

**Files:**
- Create: `render-worker/src/remotion/CaptionedCut.tsx`
- Create: `render-worker/src/remotion/Root.tsx`
- Create: `render-worker/src/remotion/index.ts`

- [ ] **Step 1: The composition component**

```tsx
// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"

export interface CaptionedCutProps {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

const FONT = "Lexend Exa, system-ui, sans-serif"

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000

  const page = pages.find((p) => ms >= p.startMs && ms < p.endMs) ?? null

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <OffthreadVideo
        src={videoSrc}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {page && (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: "0 80px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "0 18px",
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 92,
              lineHeight: 1.1,
              textAlign: "center",
              textShadow: "0 4px 24px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)",
            }}
          >
            {page.words.map((wd, i) => {
              const active = ms >= wd.startMs && ms < wd.endMs
              return (
                <span
                  key={i}
                  style={{
                    color: active ? accentHex : "white",
                    transform: active ? "scale(1.15)" : "scale(1)",
                    transition: "transform 0.08s",
                    display: "inline-block",
                  }}
                >
                  {wd.text}
                </span>
              )
            })}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: The Root with a registered composition**

```tsx
// render-worker/src/remotion/Root.tsx
import { Composition } from "remotion"
import { CaptionedCut, type CaptionedCutProps } from "./CaptionedCut.js"

const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920

const SAMPLE: CaptionedCutProps = {
  videoSrc:
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  pages: [
    { text: "let's get", words: [
      { text: "let's", startMs: 0, endMs: 400 },
      { text: "get", startMs: 400, endMs: 800 },
    ], startMs: 0, endMs: 800 },
  ],
  accentHex: "#C49B7A",
}

export function RemotionRoot() {
  return (
    <Composition
      id="CaptionedCut"
      component={CaptionedCut}
      durationInFrames={FPS * 10}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={SAMPLE}
      // duration is overridden per-render via calculateMetadata in the worker
    />
  )
}
```

- [ ] **Step 3: The Remotion entry**

```typescript
// render-worker/src/remotion/index.ts
import { registerRoot } from "remotion"
import { RemotionRoot } from "./Root.js"

registerRoot(RemotionRoot)
```

- [ ] **Step 4: Manual visual verification (local Remotion studio)**

Run: `cd render-worker && npm run studio; cd ..`
Expected: Remotion Studio opens at `http://localhost:3000`, the `CaptionedCut` composition renders the sample video with the word "let's" then "get" popping in the accent color. Close the studio (Ctrl-C) when satisfied.

- [ ] **Step 5: Commit**

```bash
git add render-worker/src/remotion
git commit -m "feat(captioned-cut): Remotion word-pop composition"
```

---

## Task 11: Worker entrypoint

**Files:**
- Create: `render-worker/src/index.ts`

- [ ] **Step 1: Implement the orchestrator**

```typescript
// render-worker/src/index.ts
// Cloud Run Job entrypoint. Inputs via env: AI_JOB_ID, VIDEO_UPLOAD_ID.
// Steps mirror the spec: load -> words -> sign -> page -> render -> upload ->
// media_asset + draft posts -> flip ai_job. Any throw -> ai_job failed.

import { createClient } from "@supabase/supabase-js"
import { initializeApp, cert } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { bundle } from "@remotion/bundler"
import { selectComposition, renderMedia, getVideoMetadata } from "@remotion/renderer"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { pageCaptions } from "./lib/caption-paging.js"
import { fetchTranscriptWords } from "./lib/assemblyai-words.js"
import { oklchToHex } from "./lib/color.js"

const MAX_CAPTION_CLIP_SECONDS = 180
const FPS = 30

// Deterministic brand accent palette (mirror of lib/content-studio/video-accent.ts)
const PALETTE = [
  "oklch(0.68 0.12 180)", "oklch(0.72 0.11 45)", "oklch(0.62 0.14 260)",
  "oklch(0.70 0.13 140)", "oklch(0.66 0.16 25)", "oklch(0.74 0.10 85)",
  "oklch(0.64 0.12 320)", "oklch(0.70 0.11 215)",
]
function accentForVideo(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const VIDEO_PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "youtube_shorts"] as const
const PLUGIN_TO_PLATFORM: Record<string, string | null> = {
  instagram: "instagram", facebook: "facebook", linkedin: "linkedin",
  tiktok: "tiktok", youtube: "youtube", youtube_shorts: "youtube_shorts",
  google_ads: null, gmail: null,
}

function fbApp() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "{}")
  return initializeApp({
    credential: cert(sa),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  })
}

async function main() {
  const aiJobId = process.env.AI_JOB_ID
  const videoUploadId = process.env.VIDEO_UPLOAD_ID
  if (!aiJobId || !videoUploadId) throw new Error("AI_JOB_ID and VIDEO_UPLOAD_ID required")

  const app = fbApp()
  const firestore = getFirestore(app)
  const bucket = getStorage(app).bucket()
  const jobRef = firestore.collection("ai_jobs").doc(aiJobId)

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  try {
    // 1. Load video + speech transcript
    const { data: video, error: vErr } = await supabase
      .from("video_uploads").select("*").eq("id", videoUploadId).single()
    if (vErr || !video) throw new Error(`video_uploads ${videoUploadId} not found`)

    const { data: tx, error: tErr } = await supabase
      .from("video_transcripts").select("*")
      .eq("video_upload_id", videoUploadId).eq("source", "speech")
      .not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (tErr || !tx?.assemblyai_job_id) throw new Error("no speech transcript with an AssemblyAI id")

    // 2. Word timestamps
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)

    // 3. Sign source URL (7-day default is plenty for a <5min render)
    const [signedUrl] = await bucket.file(video.storage_path).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })

    // Probe real duration and enforce the cap (don't trust duration_seconds)
    const meta = await getVideoMetadata(signedUrl)
    if (meta.durationInSeconds > MAX_CAPTION_CLIP_SECONDS) {
      throw new Error(`clip is ${Math.round(meta.durationInSeconds)}s — exceeds the ${MAX_CAPTION_CLIP_SECONDS}s cap`)
    }

    // 4. Page captions
    const pages = pageCaptions(words)

    // 5. Render
    const entry = path.join(process.cwd(), "dist", "remotion", "index.js")
    const serveUrl = await bundle({ entryPoint: entry })
    const durationInFrames = Math.max(1, Math.ceil(meta.durationInSeconds * FPS))
    const inputProps = { videoSrc: signedUrl, pages, accentHex: oklchToHex(accentForVideo(videoUploadId)) }
    const comp = await selectComposition({ serveUrl, id: "CaptionedCut", inputProps })
    const outPath = path.join(os.tmpdir(), `captioned-${aiJobId}.mp4`)
    await renderMedia({
      composition: { ...comp, durationInFrames, fps: FPS, width: 1080, height: 1920 },
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
    })

    // 6. Upload
    const userId = (video.uploaded_by as string | null) ?? "system"
    const storagePath = `videos/${userId}/${Date.now()}-captioned-cut.mp4`
    await bucket.upload(outPath, { destination: storagePath, contentType: "video/mp4" })
    const bytes = fs.statSync(outPath).size

    // 7. media_asset
    const { data: asset, error: aErr } = await supabase.from("media_assets").insert({
      kind: "video",
      storage_path: storagePath,
      public_url: storagePath, // signed on read
      mime_type: "video/mp4",
      bytes,
      width: 1080,
      height: 1920,
      duration_ms: Math.round(meta.durationInSeconds * 1000),
      derived_from_video_id: videoUploadId,
      ai_alt_text: null,
      ai_analysis: { origin: "captioned_cut" },
      created_by: video.uploaded_by ?? null,
    }).select().single()
    if (aErr || !asset) throw new Error(`media_asset insert failed: ${aErr?.message}`)

    // 8. One draft post per video-capable connected platform
    const { data: connections } = await supabase.rpc("fn_list_platform_connections")
    const platforms = ((connections ?? []) as { plugin_name: string }[])
      .map((c) => PLUGIN_TO_PLATFORM[c.plugin_name])
      .filter((p): p is string => p !== null && (VIDEO_PLATFORMS as readonly string[]).includes(p))

    const postIds: string[] = []
    for (const platform of platforms) {
      const { data: post, error: pErr } = await supabase.from("social_posts").insert({
        platform,
        content: "",
        media_url: null,
        post_type: "video",
        approval_status: "draft",
        scheduled_at: null,
        source_video_id: videoUploadId,
        created_by: video.uploaded_by ?? null,
      }).select().single()
      if (pErr || !post) throw new Error(`social_post insert failed: ${pErr?.message}`)
      const { error: mErr } = await supabase.from("social_post_media").insert({
        social_post_id: post.id, media_asset_id: asset.id, position: 0,
      })
      if (mErr) throw new Error(`attach media failed: ${mErr.message}`)
      postIds.push(post.id)
    }

    // 9. Complete
    await jobRef.update({
      status: "completed",
      result: { assetId: asset.id, postIds },
      updatedAt: FieldValue.serverTimestamp(),
    })
    process.exit(0)
  } catch (err) {
    await jobRef.update({
      status: "failed",
      error: (err as Error).message ?? "render failed",
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    console.error("[render-worker]", err)
    process.exit(1)
  }
}

void main()
```

- [ ] **Step 2: Build the worker**

Run: `cd render-worker && npm run build; cd ..`
Expected: `tsc` compiles `src` → `dist` with no errors.

- [ ] **Step 3: Commit**

```bash
git add render-worker/src/index.ts
git commit -m "feat(captioned-cut): Cloud Run worker entrypoint"
```

---

## Task 12: Worker Dockerfile

**Files:**
- Create: `render-worker/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# render-worker/Dockerfile
FROM node:22-bookworm-slim

# Chromium runtime deps for Remotion's headless render + Lexend Exa font.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 ca-certificates \
    fontconfig curl unzip \
  && rm -rf /var/lib/apt/lists/*

# Install Lexend Exa (OFL) so burned-in captions match the brand heading font.
RUN mkdir -p /usr/share/fonts/truetype/lexendexa \
  && curl -sL "https://github.com/google/fonts/raw/main/ofl/lexendexa/LexendExa%5Bwght%5D.ttf" \
     -o /usr/share/fonts/truetype/lexendexa/LexendExa.ttf \
  && fc-cache -f

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remotion downloads its own Chromium ("chrome headless shell") on first use;
# pre-fetch at build time so the job starts fast.
RUN npx remotion browser ensure

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the image locally to verify it assembles**

Run: `cd render-worker && docker build -t captioned-cut-render:local .; cd ..`
Expected: image builds successfully through all layers (font fetch + `remotion browser ensure` succeed). If Docker isn't available locally, defer this to Task 14's Cloud Build step and note it.

- [ ] **Step 3: Commit**

```bash
git add render-worker/Dockerfile
git commit -m "feat(captioned-cut): render-worker Dockerfile (Chromium + Lexend Exa)"
```

---

## Task 13: Trigger function

**Files:**
- Create: `functions/src/caption-render-trigger.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/package.json`

- [ ] **Step 1: Add the Cloud Run client dependency**

In `functions/package.json`, add to `dependencies`:

```json
    "@google-cloud/run": "^1.4.0"
```

Run: `cd functions && npm install; cd ..`
Expected: installs `@google-cloud/run`.

- [ ] **Step 2: Implement the trigger handler**

```typescript
// functions/src/caption-render-trigger.ts
// Handles ai_jobs docs of type "video_caption_render". Atomically claims the
// job (pending -> processing) to absorb at-least-once re-delivery, then launches
// the captioned-cut Cloud Run Job. The Job itself flips the doc to
// completed/failed when it finishes.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { JobsClient } from "@google-cloud/run"

const REGION = "us-central1"
const RENDER_JOB = "captioned-cut-render"

export async function handleCaptionRenderTrigger(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef)
    const data = snap.data()
    if (!data || data.status !== "pending") return false
    tx.update(jobRef, { status: "processing", updatedAt: FieldValue.serverTimestamp() })
    return true
  })
  if (!claimed) return // duplicate delivery — already claimed

  const data = (await jobRef.get()).data()!
  const videoUploadId = (data.input as { videoUploadId?: string })?.videoUploadId
  if (!videoUploadId) {
    await jobRef.update({
      status: "failed",
      error: "input.videoUploadId is required",
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }

  try {
    const project = process.env.GCLOUD_PROJECT
    if (!project) throw new Error("GCLOUD_PROJECT not set")
    const client = new JobsClient()
    await client.runJob({
      name: `projects/${project}/locations/${REGION}/jobs/${RENDER_JOB}`,
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "AI_JOB_ID", value: jobId },
              { name: "VIDEO_UPLOAD_ID", value: videoUploadId },
            ],
          },
        ],
      },
    })
    // Do not await completion; the Job updates the doc when done.
  } catch (err) {
    await jobRef.update({
      status: "failed",
      error: `Failed to launch render job: ${(err as Error).message}`,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
```

- [ ] **Step 3: Register the trigger in index.ts**

In `functions/src/index.ts`, add after the existing video-related triggers (anywhere among the `onDocumentCreated` blocks):

```typescript
// ─── Captioned Cut Render ────────────────────────────────────────────────────
// Triggered when an ai_jobs doc is created with type "video_caption_render".
// Claims the job and launches the captioned-cut Cloud Run Job.
export const captionRender = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "video_caption_render") return
    const { handleCaptionRenderTrigger } = await import("./caption-render-trigger.js")
    await handleCaptionRenderTrigger(event.params.jobId)
  },
)
```

- [ ] **Step 4: Build functions to verify it compiles**

Run: `cd functions && npm run build; cd ..`
Expected: TypeScript compiles with no errors (produces `functions/dist`).

- [ ] **Step 5: Commit**

```bash
git add functions/src/caption-render-trigger.ts functions/src/index.ts functions/package.json functions/package-lock.json
git commit -m "feat(captioned-cut): Firebase trigger launches Cloud Run render job"
```

---

## Task 14: Deploy + end-to-end verification (runbook)

**Files:** none (operational). Run these once; they're not committed code.

- [ ] **Step 1: Create the render service account + grant Storage/Secret access**

```bash
gcloud iam service-accounts create captioned-cut-render \
  --display-name="Captioned Cut render worker"
# Project + bucket access for the worker (adjust PROJECT_ID / BUCKET):
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:captioned-cut-render@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud storage buckets add-iam-policy-binding gs://BUCKET \
  --member="serviceAccount:captioned-cut-render@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

- [ ] **Step 2: Deploy the Cloud Run Job from source**

```bash
cd render-worker
gcloud run jobs deploy captioned-cut-render \
  --source . \
  --region us-central1 \
  --service-account captioned-cut-render@PROJECT_ID.iam.gserviceaccount.com \
  --memory 4Gi --cpu 2 --task-timeout 900s --max-retries 1 \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest,FIREBASE_SERVICE_ACCOUNT_KEY=FIREBASE_SERVICE_ACCOUNT_KEY:latest" \
  --set-env-vars "FIREBASE_STORAGE_BUCKET=YOUR_BUCKET.appspot.com"
cd ..
```

Expected: job `captioned-cut-render` created in `us-central1`.

- [ ] **Step 2b: Smoke-test the worker directly (no trigger)**

Pick a `video_uploads` id that has a speech transcript and a queued ai_job, then:

```bash
gcloud run jobs execute captioned-cut-render --region us-central1 \
  --update-env-vars "AI_JOB_ID=<existing-job-id>,VIDEO_UPLOAD_ID=<video-id>"
gcloud run jobs executions list --job captioned-cut-render --region us-central1
```

Expected: execution succeeds; an MP4 appears under `videos/<user>/...-captioned-cut.mp4` and the ai_job doc flips to `completed`.

- [ ] **Step 3: Grant the functions SA permission to run the job**

```bash
# FUNCTIONS_SA is the functions runtime SA, usually PROJECT_ID@appspot.gserviceaccount.com
gcloud run jobs add-iam-policy-binding captioned-cut-render --region us-central1 \
  --member="serviceAccount:FUNCTIONS_SA" --role="roles/run.developer"
gcloud iam service-accounts add-iam-policy-binding \
  captioned-cut-render@PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:FUNCTIONS_SA" --role="roles/iam.serviceAccountUser"
```

- [ ] **Step 4: Deploy the trigger function**

```bash
firebase deploy --only functions:default:captionRender
```

Expected: `captionRender` deploys (codebase-prefixed form per project convention).

- [ ] **Step 5: Turn the flag on and run the full flow**

1. Visit `/admin/automation`, flip **Captioned video cuts** on.
2. Open a transcribed video in Content Studio (`/admin/content` → a video with a speech transcript).
3. Click **Generate Captioned Cut**. Expect the toast "Rendering captioned cut…", the button shows "Rendering…", and within a couple of minutes it redirects to the draft post with the captioned MP4 attached.
4. If the first run errors with a Firestore "create index" link (from `findInFlightCaptionRender`), click it to create the composite index, wait for it to build, and retry.

Expected: a draft `social_post` per connected video platform, each with the captioned cut at position 0.

- [ ] **Step 6: Run the full local test suite + typecheck**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 7: Final commit (any doc/config tweaks from the runbook)**

```bash
git add -A
git commit -m "chore(captioned-cut): M1 deploy config + verification notes"
```

---

## Self-Review Notes (author)

- **Spec coverage:** flag (T5), job type (T2), transcript guard incl. vision-fallback 422 (T3/T6), in-flight idempotency + 200 reuse (T2/T6), atomic claim (T13), per-platform drafts (T11), Cloud Run jobs.run + IAM/secrets (T13/T14), font + center-crop + oklch→hex (T9/T10/T12), 180s probe cap (T11), drawer button gated by flag (T7). Covered.
- **Out of scope here (Milestone 2 plan):** `source_submission_id` migration, `resolveVideoUploadForSubmission`, the team-review `StatusActions` button. The route already returns a clear 400 for `submissionId` until M2 lands.
- **Type consistency:** `findInFlightCaptionRender`, `getSpeechTranscriptForVideo`, `captionedCutRequestSchema`, `pageCaptions`/`CaptionPage`, `result.{assetId,postIds}` are used identically across route, worker, button, and trigger.
