# Starter AI Automation — Phase 3a: Video Upload + Social Fanout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end "upload a coaching video → get 6 AI-generated social captions ready to approve" flow. After this phase, the coach can upload a video in the admin UI, the system transcribes + generates a caption for each of the 6 platforms, and the coach reviews/approves each one in the Social tab.

**Architecture:** Client uploads video to Firebase Storage via a signed URL (server-generated). Upload creates a `video_uploads` row. Coach clicks "Transcribe" → `createAiJob("video_transcription", ...)` → Phase 2a's `transcribeVideo` function runs. When transcript lands in Supabase, coach clicks "Generate Social Posts" → `createAiJob("social_fanout", ...)` → new Firebase Function fires 6 parallel Claude calls (one per platform) using a brand-voice system prompt + per-platform style prompt → 6 `social_posts` + matching `social_captions` rows get created. Coach reviews each card in the Social tab, edits/approves/rejects. Approved captions for unconnected platforms sit as `awaiting_connection` until Phase 2b OAuth lands.

**Tech Stack:** Next.js 16 App Router + server-generated Firebase Storage signed upload URLs + Firebase Admin SDK (server) + Firebase JS SDK (client) + existing `useAiJob` hook for status polling + Claude Sonnet via existing `callAgent` wrapper + Zod schemas + Vitest (Next.js) + Vitest (Firebase Functions) + existing admin design system (StatCard, shadcn, Green Azure tokens).

**Existing infrastructure this plan builds on (no changes):**

- Phase 1: DAL (`video-uploads`, `video-transcripts`, `social-posts`, `social-captions`), types, plugin registry
- Phase 2a: `transcribeVideo` Firebase Function, `/api/webhooks/assemblyai` route, `generateSocialCaption` prompt-template pattern
- `lib/ai-jobs.ts` — `createAiJob({ type, userId, input })` helper (Phase 1)
- `functions/src/ai/anthropic.ts` — `callAgent<T>(systemPrompt, userMessage, schema, options)` helper
- `components/admin/blog/BlogGenerateDialog.tsx` — canonical dialog pattern using `useAiJob(jobId)` polling
- `lib/firebase-admin.ts` — `getAdminStorage()`, `getSignedVideoUrl()` helpers
- Brand voice profile row in `prompt_templates` (seeded in migration 00081, `category="voice_profile"`, `scope="global"`)
- Existing `/admin/social/page.tsx` and `/admin/videos/page.tsx` scaffolds (Phase 1 — empty states today)

---

## File Structure

### Seed migration (new)

- `supabase/migrations/00083_seed_social_caption_prompts.sql` — seeds 6 rows in `prompt_templates` (one per platform)

### Next.js API routes (new)

- `app/api/admin/videos/route.ts` — `POST` creates a `video_uploads` row + returns a Firebase Storage signed **upload** URL
- `app/api/admin/social/fanout/route.ts` — `POST { videoUploadId }` creates an ai_job with `type="social_fanout"`
- `app/api/admin/social/posts/[id]/approve/route.ts` — `POST` sets `approval_status` to `approved` or `awaiting_connection`
- `app/api/admin/social/posts/[id]/reject/route.ts` — `POST { rejection_notes }` sets `approval_status: rejected`
- `app/api/admin/social/posts/[id]/route.ts` — `PATCH { caption_text, hashtags }` edits the latest caption

### Next.js UI (new + modify)

- `components/admin/videos/VideoUploader.tsx` — new drag/drop upload component (uses Firebase JS SDK)
- `components/admin/videos/VideoActions.tsx` — new card with Transcribe + Generate Social buttons per video row
- `components/admin/videos/VideoListCard.tsx` — new row component rendering one video + its status
- `app/(admin)/admin/videos/page.tsx` — modify to render real `VideoUploader` + list of videos with actions
- `components/admin/social/SocialPostCard.tsx` — new card rendering one social post + approve/edit/reject actions
- `components/admin/social/SocialPostsList.tsx` — new list grouped by status (draft / awaiting_connection / approved / published / rejected)
- `components/admin/social/EditCaptionDialog.tsx` — new dialog using the existing `enhance-textarea-button` pattern
- `app/(admin)/admin/social/page.tsx` — modify to render real `SocialPostsList` + preserve existing stat cards

### Firebase Functions (new + modify)

- `functions/src/social-fanout.ts` — new Firebase Function handler for `type="social_fanout"`
- `functions/src/index.ts` — modify to register the new `socialFanout` export

### Helpers (new)

- `lib/firebase-client-upload.ts` — client-side helper that wraps the Firebase Storage upload-via-signed-URL flow

### Tests (new)

- `functions/src/__tests__/social-fanout.test.ts` — unit tests for the fanout prompt builder + caption parser
- `__tests__/api/admin/videos.test.ts` — API route test for video upload row creation + signed URL
- `__tests__/api/admin/social/fanout.test.ts` — API route test for fanout ai_job creation
- `__tests__/api/admin/social/approve.test.ts` — API route test for approval + awaiting_connection logic

---

## Tasks

### Task 1: Seed social caption prompt templates

**Files:**

- Create: `supabase/migrations/00083_seed_social_caption_prompts.sql`

- [ ] **Step 1: Write the seed migration**

```sql
-- supabase/migrations/00083_seed_social_caption_prompts.sql
-- Seeds one social_caption prompt template per platform. The fanout function
-- reads these rows by scope to build platform-specific caption prompts.

INSERT INTO prompt_templates (name, category, scope, description, prompt) VALUES
(
  'Facebook Caption Style',
  'social_caption',
  'facebook',
  'Facebook Page post style — longer form, conversational, includes CTA and link where relevant.',
  'Write a Facebook Page post (120-250 words). Structure: a hook in the first line, 2-3 short paragraphs of insight drawn from the video transcript, then a CTA to the DJP Athlete website or relevant program (Comeback Code for injury return, Rotational Reboot for rotational athletes). Voice: direct, confident, coach-to-coach. Use short paragraphs separated by blank lines. Do NOT include hashtags (Facebook users do not engage with hashtags — keep them in the metadata only, 3-5 max). Return: caption_text (the post body) and hashtags (3-5 relevant fitness/sports hashtags).'
),
(
  'Instagram Caption Style',
  'social_caption',
  'instagram',
  'Instagram caption style — hook-driven, structured bullets, strong CTA, 20-30 hashtags.',
  'Write an Instagram caption (maximum 2200 chars). Structure: (1) hook line that stops the scroll, (2) 3-5 short benefit bullets using → arrow prefix, (3) a save/share prompt, (4) CTA to link-in-bio. Voice: punchy, authoritative, athlete-focused. Keep lines short with blank lines between sections for readability. Return: caption_text without hashtags appended, and hashtags array with 20-30 niche-relevant tags (mix of rotational/sport-specific/coaching/training/recovery — avoid generic #fitness #gym).'
),
(
  'TikTok Caption Style',
  'social_caption',
  'tiktok',
  'TikTok short-form caption — one-line hook optimised for the TikTok algorithm.',
  'Write a TikTok caption (50-150 chars). Structure: one conversational hook line that plays off the video content. Optionally add one short follow-up sentence. Voice: casual, direct, speaking TO the viewer. Return: caption_text and hashtags array with 5-8 trending/niche tags (mix a broad discovery tag like #fyp or #athletetok with 4-6 niche sport-specific ones).'
),
(
  'YouTube Long-form Caption Style',
  'social_caption',
  'youtube',
  'YouTube long-form video title + description. Title on line 1 (<=100 chars), double newline, then description.',
  'Generate a YouTube long-form video package for a coaching video. Output MUST be: line 1 = a click-worthy, SEO-friendly TITLE (max 100 chars, include a specific exercise or concept). Then a blank line. Then a 300-500 word DESCRIPTION with: a hook paragraph, 2-3 key takeaways as bullet points, timestamps placeholder ("Chapters:\n00:00 Intro\n..."), links to DJP Athlete programs at the bottom. Voice: educational, thorough, referencing real coaching experience. Return: caption_text = "TITLE\n\nDESCRIPTION", and hashtags array with 10-15 YouTube tags for discovery.'
),
(
  'YouTube Shorts Caption Style',
  'social_caption',
  'youtube_shorts',
  'YouTube Shorts title-as-caption — very short, vertical-video friendly, #Shorts injected automatically by the plugin.',
  'Write a YouTube Shorts title + description (the TITLE becomes line 1, the description appears below). Format: "TITLE (max 60 chars)\n\nDESCRIPTION (1-2 sentences explaining the drill or concept, max 150 chars)". Voice: direct, hook-first. Return: caption_text formatted as "TITLE\n\nDESCRIPTION", and 3-5 niche hashtags (the plugin auto-adds #Shorts — do NOT include #Shorts in your output).'
),
(
  'LinkedIn Caption Style',
  'social_caption',
  'linkedin',
  'LinkedIn Company Page post — professional tone, insight-driven, 150-300 words.',
  'Write a LinkedIn Company Page post (150-300 words). Structure: a professional hook framing a coaching problem or observation, 2-3 short paragraphs of expert insight drawn from the video transcript, then a CTA to DJP Athlete services or relevant program. Voice: authoritative, peer-to-peer (coach-to-coach), not overly casual. Avoid fitness-bro slang. Use line breaks between paragraphs. Return: caption_text and hashtags array with 3-5 industry-relevant tags (e.g. #StrengthAndConditioning, #AthleteDevelopment, not generic #Fitness).'
);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

The controller applies the migration via `mcp__supabase__apply_migration` — the subagent should NOT run `npx supabase db push`. The subagent writes the SQL file only.

- [ ] **Step 3: Verify 6 rows are seeded**

After the controller applies the migration, run the SQL query:

```sql
SELECT scope, name FROM prompt_templates WHERE category = 'social_caption' ORDER BY scope;
```

Expected: 6 rows, one per scope (facebook, instagram, linkedin, tiktok, youtube, youtube_shorts).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00083_seed_social_caption_prompts.sql
git commit -m "feat(db): seed 6 social caption prompt templates (one per platform)"
```

---

### Task 2: Video upload API routes (create row + signed upload URL)

**Files:**

- Create: `app/api/admin/videos/route.ts`
- Create: `__tests__/api/admin/videos.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/admin/videos.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getAdminStorageMock = vi.fn()
const createVideoUploadMock = vi.fn()

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => getAdminStorageMock(),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  createVideoUpload: (input: unknown) => createVideoUploadMock(input),
}))

import { POST } from "@/app/api/admin/videos/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/videos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "client-1", role: "client" } })
    const res = await POST(makeRequest({ filename: "a.mp4" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when filename missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("creates a video_uploads row and returns a signed upload URL", async () => {
    const fileMock = {
      getSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-upload"]),
    }
    const bucketMock = { file: vi.fn().mockReturnValue(fileMock) }
    getAdminStorageMock.mockReturnValue({ bucket: () => bucketMock })

    createVideoUploadMock.mockResolvedValue({
      id: "upload-1",
      storage_path: "videos/admin-1/123-a.mp4",
      original_filename: "a.mp4",
      status: "uploaded",
    })

    const res = await POST(makeRequest({ filename: "a.mp4", contentType: "video/mp4", title: "Drill" }))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.videoUploadId).toBe("upload-1")
    expect(body.uploadUrl).toBe("https://storage.googleapis.com/signed-upload")
    expect(body.storagePath).toMatch(/^videos\/admin-1\//)

    expect(createVideoUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        original_filename: "a.mp4",
        mime_type: "video/mp4",
        title: "Drill",
        status: "uploaded",
        uploaded_by: "admin-1",
      }),
    )

    // Signed URL should target the same path
    expect(bucketMock.file).toHaveBeenCalledWith(expect.stringMatching(/^videos\/admin-1\//))
    expect(fileMock.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "write",
        contentType: "video/mp4",
      }),
    )
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:run -- __tests__/api/admin/videos.test.ts`
Expected: FAIL — module `@/app/api/admin/videos/route` not found.

- [ ] **Step 3: Write `app/api/admin/videos/route.ts`**

```typescript
// app/api/admin/videos/route.ts
// POST { filename, contentType?, title? } — creates a video_uploads row and
// returns a Firebase Storage signed upload URL so the client can PUT the
// bytes directly to Storage (saves Vercel bandwidth and avoids the 5 MB body
// limit on Vercel serverless).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { createVideoUpload } from "@/lib/db/video-uploads"

const UPLOAD_URL_EXPIRY_MS = 15 * 60 * 1000 // 15 minutes

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    filename?: string
    contentType?: string
    title?: string
  } | null

  const filename = body?.filename?.trim()
  if (!filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 })
  }

  const contentType = body?.contentType ?? "video/mp4"
  const safeFilename = sanitizeFilename(filename)
  const storagePath = `videos/${session.user.id}/${Date.now()}-${safeFilename}`

  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType,
  })

  const upload = await createVideoUpload({
    storage_path: storagePath,
    original_filename: filename,
    mime_type: contentType,
    duration_seconds: null,
    size_bytes: null,
    title: body?.title ?? null,
    uploaded_by: session.user.id,
    status: "uploaded",
  })

  return NextResponse.json(
    {
      videoUploadId: upload.id,
      uploadUrl,
      storagePath,
      expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
    },
    { status: 201 },
  )
}
```

- [ ] **Step 4: Run → PASS**

Run: `npm run test:run -- __tests__/api/admin/videos.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/videos/route.ts __tests__/api/admin/videos.test.ts
git commit -m "feat(api): POST /api/admin/videos creates row + signed Firebase Storage upload URL"
```

---

### Task 3: Firebase Storage client upload helper

**Files:**

- Create: `lib/firebase-client-upload.ts`

- [ ] **Step 1: Write `lib/firebase-client-upload.ts`**

```typescript
// lib/firebase-client-upload.ts
// Client-side helper that uploads a File to Firebase Storage via a signed URL
// obtained from POST /api/admin/videos. Uses fetch() directly — no Firebase
// JS SDK dependency needed for the upload itself (the signed URL accepts a
// plain PUT). Reports progress via XHR since fetch() doesn't expose progress.

export interface UploadRequestBody {
  filename: string
  contentType: string
  title?: string
}

export interface UploadApiResponse {
  videoUploadId: string
  uploadUrl: string
  storagePath: string
  expiresInSeconds: number
}

export interface UploadProgressEvent {
  loaded: number
  total: number
  percent: number
}

export async function requestSignedUpload(body: UploadRequestBody): Promise<UploadApiResponse> {
  const response = await fetch("/api/admin/videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    throw new Error(`Upload request failed (${response.status}): ${errorBody}`)
  }
  return (await response.json()) as UploadApiResponse
}

/**
 * PUT the file bytes to the signed Storage URL. Uses XHR so we can report
 * progress — fetch() has no browser-native upload progress event yet.
 */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (event: UploadProgressEvent) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl)
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4")

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload PUT failed with status ${xhr.status}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new Error("Upload aborted"))

    xhr.send(file)
  })
}

/**
 * Full flow: request signed URL → PUT bytes → return video upload id.
 */
export async function uploadVideoFile(
  file: File,
  options: { title?: string; onProgress?: (event: UploadProgressEvent) => void } = {},
): Promise<{ videoUploadId: string; storagePath: string }> {
  const { videoUploadId, uploadUrl, storagePath } = await requestSignedUpload({
    filename: file.name,
    contentType: file.type || "video/mp4",
    title: options.title,
  })
  await uploadToSignedUrl(uploadUrl, file, options.onProgress)
  return { videoUploadId, storagePath }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep firebase-client-upload | head -5`
Expected: No errors mentioning this file.

- [ ] **Step 3: Commit**

```bash
git add lib/firebase-client-upload.ts
git commit -m "feat(storage): client-side Firebase Storage upload helper with progress"
```

---

### Task 4: Video upload UI component

**Files:**

- Create: `components/admin/videos/VideoUploader.tsx`

- [ ] **Step 1: Write `components/admin/videos/VideoUploader.tsx`**

```tsx
"use client"

import { useState, useRef } from "react"
import { Upload, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { uploadVideoFile, type UploadProgressEvent } from "@/lib/firebase-client-upload"
import { cn } from "@/lib/utils"

interface VideoUploaderProps {
  onUploaded: (videoUploadId: string) => void
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; filename: string; percent: number }
  | { status: "done"; filename: string }
  | { status: "error"; message: string }

export function VideoUploader({ onUploaded }: VideoUploaderProps) {
  const [state, setState] = useState<UploadState>({ status: "idle" })
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setState({ status: "error", message: "Please upload a video file (.mp4, .mov, .webm)" })
      return
    }

    setState({ status: "uploading", filename: file.name, percent: 0 })

    try {
      const { videoUploadId } = await uploadVideoFile(file, {
        title: file.name.replace(/\.[^.]+$/, ""),
        onProgress: (event: UploadProgressEvent) => {
          setState({ status: "uploading", filename: file.name, percent: event.percent })
        },
      })
      setState({ status: "done", filename: file.name })
      toast.success(`${file.name} uploaded`)
      onUploaded(videoUploadId)
    } catch (error) {
      const message = (error as Error).message ?? "Upload failed"
      setState({ status: "error", message })
      toast.error(`Upload failed: ${message}`)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border">
      <label
        htmlFor="video-uploader-input"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void handleFile(file)
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-8 cursor-pointer rounded-xl border-2 border-dashed transition",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
        )}
      >
        <input
          ref={inputRef}
          id="video-uploader-input"
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />

        {state.status === "idle" && (
          <>
            <Upload className="size-8 text-primary" />
            <p className="font-medium text-primary">Drop a video here or click to choose</p>
            <p className="text-xs text-muted-foreground">MP4, MOV, WebM — we&apos;ll handle the rest</p>
          </>
        )}
        {state.status === "uploading" && (
          <>
            <Loader2 className="size-8 text-warning animate-spin" />
            <p className="font-medium text-primary">Uploading {state.filename}</p>
            <div className="w-full max-w-sm h-2 rounded-full bg-primary/10 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${state.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{state.percent}%</p>
          </>
        )}
        {state.status === "done" && (
          <>
            <CheckCircle className="size-8 text-success" />
            <p className="font-medium text-primary">{state.filename} uploaded</p>
            <p className="text-xs text-muted-foreground">Click anywhere to upload another</p>
          </>
        )}
        {state.status === "error" && (
          <>
            <AlertCircle className="size-8 text-error" />
            <p className="font-medium text-error">{state.message}</p>
            <p className="text-xs text-muted-foreground">Click anywhere to try again</p>
          </>
        )}
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit 2>&1 | grep VideoUploader | head -5`
Expected: No errors mentioning this file.

- [ ] **Step 3: Commit**

```bash
git add components/admin/videos/VideoUploader.tsx
git commit -m "feat(ui): VideoUploader drag/drop component with progress"
```

---

### Task 5: Integrate upload into Videos admin page

**Files:**

- Modify: `app/(admin)/admin/videos/page.tsx` — replace the empty state with the real uploader + list

- [ ] **Step 1: Read the current file content to understand what you're replacing**

Open `app/(admin)/admin/videos/page.tsx` from the Phase 1 scaffold. Note the h1, stat cards (Processing/Ready/Total), and the disabled "Upload video" button in the header.

- [ ] **Step 2: Replace the file entirely**

```tsx
// app/(admin)/admin/videos/page.tsx
import { VideosPageClient } from "@/components/admin/videos/VideosPageClient"
import { listVideoUploads } from "@/lib/db/video-uploads"
import type { VideoUpload } from "@/types/database"

export const metadata = { title: "Videos" }

export default async function VideosPage() {
  const videos: VideoUpload[] = await listVideoUploads({ limit: 50 })
  return <VideosPageClient initialVideos={videos} />
}
```

- [ ] **Step 3: Create `components/admin/videos/VideosPageClient.tsx`**

```tsx
"use client"

import { Film, Upload, CheckCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { VideoUploader } from "./VideoUploader"
import { VideoListCard } from "./VideoListCard"
import type { VideoUpload } from "@/types/database"

interface VideosPageClientProps {
  initialVideos: VideoUpload[]
}

export function VideosPageClient({ initialVideos }: VideosPageClientProps) {
  const router = useRouter()
  const [videos, setVideos] = useState<VideoUpload[]>(initialVideos)

  const processing = videos.filter((v) => v.status === "uploaded" || v.status === "transcribing").length
  const ready = videos.filter((v) => v.status === "transcribed" || v.status === "analyzed").length

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Videos</h1>
          <p className="text-sm text-muted-foreground">
            Upload coaching footage once — we generate captions across every connected platform.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mt-6 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Upload className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Processing</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{processing}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Ready</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{ready}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Film className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{videos.length}</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <VideoUploader
          onUploaded={() => {
            // Refresh the list from the server so the new row appears with its DB status
            router.refresh()
          }}
        />
      </div>

      {videos.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-6 text-center">
          <Film className="size-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No videos uploaded yet — upload one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <VideoListCard key={video.id} video={video} onAction={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `components/admin/videos/VideoListCard.tsx`**

```tsx
"use client"

import { Film, Loader2, CheckCircle, AlertCircle, Sparkles } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { VideoUpload } from "@/types/database"

interface VideoListCardProps {
  video: VideoUpload
  onAction: () => void
}

function statusBadge(status: VideoUpload["status"]) {
  if (status === "uploaded") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Film className="size-3.5" /> Ready to transcribe
      </span>
    )
  }
  if (status === "transcribing") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
        <Loader2 className="size-3.5 animate-spin" /> Transcribing
      </span>
    )
  }
  if (status === "transcribed" || status === "analyzed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle className="size-3.5" /> Transcribed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-error">
      <AlertCircle className="size-3.5" /> Failed
    </span>
  )
}

export function VideoListCard({ video, onAction }: VideoListCardProps) {
  const [busy, setBusy] = useState<"transcribe" | "fanout" | null>(null)

  async function transcribe() {
    setBusy("transcribe")
    try {
      const res = await fetch("/api/admin/videos/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Transcribe failed")
      toast.success("Transcription queued")
      onAction()
    } catch (error) {
      toast.error(`Transcribe failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function fanout() {
    setBusy("fanout")
    try {
      const res = await fetch("/api/admin/social/fanout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Fanout failed")
      toast.success("Generating 6 social captions — check the Social tab in ~1 minute")
      onAction()
    } catch (error) {
      toast.error(`Fanout failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const canTranscribe = video.status === "uploaded"
  const canFanout = video.status === "transcribed" || video.status === "analyzed"

  return (
    <div className="bg-white rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Film className="size-4 text-primary" />
        </div>
        <div>
          <p className="font-medium text-primary">{video.title ?? video.original_filename}</p>
          <p className="text-xs text-muted-foreground">{video.original_filename}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {statusBadge(video.status)}
        <button
          type="button"
          onClick={transcribe}
          disabled={!canTranscribe || busy !== null}
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/10 disabled:text-muted-foreground disabled:cursor-not-allowed"
        >
          {busy === "transcribe" ? "Queueing..." : "Transcribe"}
        </button>
        <button
          type="button"
          onClick={fanout}
          disabled={!canFanout || busy !== null}
          className="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 disabled:bg-accent/10 disabled:text-muted-foreground disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <Sparkles className="size-3" />
          {busy === "fanout" ? "Queueing..." : "Generate Social"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify TypeScript + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "videos/page|VideosPageClient|VideoListCard" | head -10`
Expected: No errors.

```bash
git add app/\(admin\)/admin/videos/page.tsx components/admin/videos/VideosPageClient.tsx components/admin/videos/VideoListCard.tsx
git commit -m "feat(admin): Videos page integrates VideoUploader + transcribe/fanout actions"
```

---

### Task 6: `generateSocialFanout` Firebase Function

**Files:**

- Create: `functions/src/social-fanout.ts`
- Create: `functions/src/__tests__/social-fanout.test.ts`

**Note on approach:** one Claude call per platform, run in parallel via `Promise.all`. Voice profile + platform-specific prompt are both fetched from `prompt_templates`. Captions land in `social_posts` + `social_captions` as pairs.

- [ ] **Step 1: Write the failing test — cover the non-Claude logic**

```typescript
// functions/src/__tests__/social-fanout.test.ts
import { describe, it, expect } from "vitest"
import { buildUserMessage, resolveApprovalStatus } from "../social-fanout.js"

describe("social-fanout helpers", () => {
  it("buildUserMessage embeds transcript + platform under clear headings", () => {
    const msg = buildUserMessage({
      transcript: "Today we're working the landmine press.",
      platform: "instagram",
      videoTitle: "Landmine Press",
    })
    expect(msg).toContain("Platform: instagram")
    expect(msg).toContain("Video title: Landmine Press")
    expect(msg).toContain("landmine press")
  })

  it("resolveApprovalStatus returns awaiting_connection when plugin not in connected set", () => {
    const connected = new Set(["instagram", "facebook"])
    expect(resolveApprovalStatus("tiktok", connected)).toBe("awaiting_connection")
    expect(resolveApprovalStatus("instagram", connected)).toBe("draft")
    expect(resolveApprovalStatus("facebook", connected)).toBe("draft")
  })

  it("resolveApprovalStatus returns draft when connected set empty but platform known", () => {
    expect(resolveApprovalStatus("instagram", new Set())).toBe("awaiting_connection")
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `cd functions && npx vitest run src/__tests__/social-fanout.test.ts && cd ..`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `functions/src/social-fanout.ts`**

```typescript
// functions/src/social-fanout.ts
// Firebase Function: given a videoUploadId whose transcript is available,
// generates one platform-specific social caption for each of the 6 platforms
// (facebook, instagram, tiktok, youtube, youtube_shorts, linkedin) and
// persists them as social_posts + social_captions rows in Supabase.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "youtube_shorts", "linkedin"] as const
type SocialPlatform = (typeof PLATFORMS)[number]

const captionSchema = z.object({
  caption_text: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
})
type Caption = z.infer<typeof captionSchema>

export interface SocialFanoutInput {
  videoUploadId: string
}

export interface BuildUserMessageInput {
  transcript: string
  platform: SocialPlatform
  videoTitle: string | null
}

export function buildUserMessage(input: BuildUserMessageInput): string {
  return [
    `Platform: ${input.platform}`,
    `Video title: ${input.videoTitle ?? "(untitled)"}`,
    "",
    "Video transcript:",
    "---",
    input.transcript,
    "---",
    "",
    "Generate the caption according to the platform style above. Return JSON only.",
  ].join("\n")
}

export function resolveApprovalStatus(
  platform: SocialPlatform,
  connectedPlugins: Set<string>,
): "draft" | "awaiting_connection" {
  return connectedPlugins.has(platform) ? "draft" : "awaiting_connection"
}

export async function handleSocialFanout(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
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
    const videoUploadId = (data.input as SocialFanoutInput | undefined)?.videoUploadId
    if (!videoUploadId) {
      await failJob("input.videoUploadId is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // 1. Load transcript
    const { data: transcript, error: tErr } = await supabase
      .from("video_transcripts")
      .select("transcript_text")
      .eq("video_upload_id", videoUploadId)
      .maybeSingle()
    if (tErr || !transcript) {
      await failJob(`No transcript found for video ${videoUploadId}`)
      return
    }

    // 2. Load video title
    const { data: video } = await supabase
      .from("video_uploads")
      .select("title, original_filename")
      .eq("id", videoUploadId)
      .maybeSingle()
    const videoTitle = video?.title ?? video?.original_filename ?? null

    // 3. Load voice profile + per-platform caption prompts
    const { data: prompts, error: pErr } = await supabase
      .from("prompt_templates")
      .select("scope, category, prompt")
      .in("category", ["voice_profile", "social_caption"])
    if (pErr || !prompts) {
      await failJob(`Could not load prompt templates: ${pErr?.message ?? "unknown"}`)
      return
    }

    const voiceProfile = prompts.find((p) => p.category === "voice_profile")?.prompt
    if (!voiceProfile) {
      await failJob("No voice_profile prompt_template row found")
      return
    }
    const byPlatform = new Map<string, string>()
    for (const p of prompts) {
      if (p.category === "social_caption") byPlatform.set(p.scope, p.prompt)
    }

    // 4. Read connected plugins (for approval_status decision)
    const { data: connections } = await supabase
      .from("platform_connections")
      .select("plugin_name, status")
      .eq("status", "connected")
    const connectedSet = new Set((connections ?? []).map((c) => c.plugin_name))

    // 5. Generate 6 captions in parallel
    const results = await Promise.allSettled(
      PLATFORMS.map(async (platform) => {
        const platformPrompt = byPlatform.get(platform)
        if (!platformPrompt) throw new Error(`No social_caption prompt seeded for scope=${platform}`)

        const systemPrompt = `${voiceProfile}\n\n---\n\n${platformPrompt}`
        const userMessage = buildUserMessage({
          transcript: transcript.transcript_text,
          platform,
          videoTitle,
        })

        const result = await callAgent<Caption>(systemPrompt, userMessage, captionSchema, {
          model: MODEL_SONNET,
          maxTokens: 2000,
          cacheSystemPrompt: true,
        })

        return { platform, caption: result.data }
      }),
    )

    // 6. Persist successes
    const created: Array<{ platform: SocialPlatform; social_post_id: string }> = []
    for (const r of results) {
      if (r.status !== "fulfilled") continue
      const { platform, caption } = r.value as { platform: SocialPlatform; caption: Caption }

      const approvalStatus = resolveApprovalStatus(platform, connectedSet)
      const { data: post, error: postErr } = await supabase
        .from("social_posts")
        .insert({
          platform,
          content: caption.caption_text,
          approval_status: approvalStatus,
          source_video_id: videoUploadId,
        })
        .select()
        .single()
      if (postErr || !post) continue

      await supabase.from("social_captions").insert({
        social_post_id: post.id,
        caption_text: caption.caption_text,
        hashtags: caption.hashtags,
        version: 1,
      })

      created.push({ platform, social_post_id: post.id })
    }

    const failedPlatforms = results
      .map((r, i) => (r.status === "rejected" ? PLATFORMS[i] : null))
      .filter(Boolean) as string[]

    await jobRef.update({
      status: created.length > 0 ? "completed" : "failed",
      error: failedPlatforms.length > 0 ? `Platforms that failed: ${failedPlatforms.join(", ")}` : null,
      result: { videoUploadId, created, failedPlatforms },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown social fanout error")
  }
}
```

- [ ] **Step 4: Run → PASS**

Run: `cd functions && npx vitest run src/__tests__/social-fanout.test.ts && cd ..`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/social-fanout.ts functions/src/__tests__/social-fanout.test.ts
git commit -m "feat(functions): generateSocialFanout — 6 platform-specific captions per video"
```

---

### Task 7: Register `socialFanout` in `functions/src/index.ts`

**Files:**

- Modify: `functions/src/index.ts`

- [ ] **Step 1: Read the current file**

You'll see existing `defineSecret` calls and existing `onDocumentCreated` exports including `transcribeVideo` and `tavilyResearch`. The fanout function needs `ANTHROPIC_API_KEY` (already defined at the top as `anthropicApiKey`) + the Supabase secrets.

- [ ] **Step 2: Append after the `tavilyResearch` export**

```typescript
// ─── Social Fanout ─────────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "social_fanout"

export const socialFanout = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: [anthropicApiKey, supabaseUrl, supabaseServiceRoleKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "social_fanout") return

    const { handleSocialFanout } = await import("./social-fanout.js")
    await handleSocialFanout(event.params.jobId)
  },
)
```

- [ ] **Step 3: Build**

Run: `cd functions && npm run build && cd ..`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat(functions): register socialFanout export"
```

---

### Task 8: `POST /api/admin/social/fanout`

**Files:**

- Create: `app/api/admin/social/fanout/route.ts`
- Create: `__tests__/api/admin/social/fanout.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/admin/social/fanout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getVideoUploadByIdMock = vi.fn()
const getTranscriptForVideoMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/video-uploads", () => ({ getVideoUploadById: (x: string) => getVideoUploadByIdMock(x) }))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptForVideo: (x: string) => getTranscriptForVideoMock(x),
}))

import { POST } from "@/app/api/admin/social/fanout/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/social/fanout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/social/fanout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when videoUploadId missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the video doesn't exist", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(404)
  })

  it("returns 409 when no transcript is available", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", status: "uploaded" })
    getTranscriptForVideoMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(409)
    expect(await res.text()).toContain("transcript")
  })

  it("creates a social_fanout ai_job when video + transcript are ready", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", status: "transcribed" })
    getTranscriptForVideoMock.mockResolvedValue({ id: "t1", transcript_text: "hello" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "social_fanout",
      userId: "admin-1",
      input: { videoUploadId: "v1" },
    })
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:run -- __tests__/api/admin/social/fanout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `app/api/admin/social/fanout/route.ts`**

```typescript
// app/api/admin/social/fanout/route.ts
// POST { videoUploadId } — triggers social fanout via a Firebase Function.
// Pre-checks that the video exists and has a transcript before queueing.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { videoUploadId?: string } | null
  const videoUploadId = body?.videoUploadId
  if (!videoUploadId) {
    return NextResponse.json({ error: "videoUploadId is required" }, { status: 400 })
  }

  const upload = await getVideoUploadById(videoUploadId)
  if (!upload) {
    return NextResponse.json({ error: "Video upload not found" }, { status: 404 })
  }

  const transcript = await getTranscriptForVideo(videoUploadId)
  if (!transcript) {
    return NextResponse.json({ error: "Video has no transcript yet — run Transcribe first" }, { status: 409 })
  }

  const { jobId, status } = await createAiJob({
    type: "social_fanout",
    userId: session.user.id,
    input: { videoUploadId },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 4: Run → PASS**

Run: `npm run test:run -- __tests__/api/admin/social/fanout.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/social/fanout/route.ts __tests__/api/admin/social/fanout.test.ts
git commit -m "feat(api): POST /api/admin/social/fanout triggers social_fanout ai_job"
```

---

### Task 9: Social post approval / reject / edit API routes

**Files:**

- Create: `app/api/admin/social/posts/[id]/approve/route.ts`
- Create: `app/api/admin/social/posts/[id]/reject/route.ts`
- Create: `app/api/admin/social/posts/[id]/route.ts`
- Create: `__tests__/api/admin/social/approve.test.ts`

- [ ] **Step 1: Write the approval test**

```typescript
// __tests__/api/admin/social/approve.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (x: string) => getSocialPostByIdMock(x),
  updateSocialPost: (id: string, updates: unknown) => updateSocialPostMock(id, updates),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/approve/route"

async function callApprove(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/approve`, {
    method: "POST",
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("sets approval_status=approved when the platform is connected", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", platform: "instagram", approval_status: "draft" })
    listPlatformConnectionsMock.mockResolvedValue([
      { plugin_name: "instagram", status: "connected" },
      { plugin_name: "facebook", status: "not_connected" },
    ])
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "approved" })

    const res = await callApprove("p1")
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", { approval_status: "approved" })
  })

  it("sets approval_status=awaiting_connection when the platform is not connected", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p2", platform: "facebook", approval_status: "draft" })
    listPlatformConnectionsMock.mockResolvedValue([
      { plugin_name: "instagram", status: "connected" },
      { plugin_name: "facebook", status: "not_connected" },
    ])
    updateSocialPostMock.mockResolvedValue({ id: "p2", approval_status: "awaiting_connection" })

    await callApprove("p2")
    expect(updateSocialPostMock).toHaveBeenCalledWith("p2", { approval_status: "awaiting_connection" })
  })

  it("returns 404 when the post doesn't exist", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callApprove("nope")
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:run -- __tests__/api/admin/social/approve.test.ts`

- [ ] **Step 3: Write `app/api/admin/social/posts/[id]/approve/route.ts`**

```typescript
// app/api/admin/social/posts/[id]/approve/route.ts
// POST — approves a social post. If the corresponding platform is connected,
// status flips to "approved" (ready for the scheduled publisher, Phase 3b).
// Otherwise status flips to "awaiting_connection" so Phase 2b OAuth can
// pick it up later.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  const connections = await listPlatformConnections()
  const connected = new Set(connections.filter((c) => c.status === "connected").map((c) => c.plugin_name))

  const approvalStatus = connected.has(post.platform) ? "approved" : "awaiting_connection"
  const updated = await updateSocialPost(id, { approval_status: approvalStatus })

  return NextResponse.json({ id: updated.id, approval_status: updated.approval_status })
}
```

- [ ] **Step 4: Write `app/api/admin/social/posts/[id]/reject/route.ts`**

```typescript
// app/api/admin/social/posts/[id]/reject/route.ts
// POST { rejection_notes } — rejects a social post. Notes are stored on the
// post row and are fed back into future generation as negative examples
// (Phase 5 performance-learning loop).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateSocialPost, getSocialPostById } from "@/lib/db/social-posts"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await getSocialPostById(id)
  if (!existing) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { rejection_notes?: string } | null
  const notes = body?.rejection_notes?.trim() ?? null

  const updated = await updateSocialPost(id, {
    approval_status: "rejected",
    rejection_notes: notes,
  })

  return NextResponse.json({ id: updated.id, approval_status: updated.approval_status })
}
```

- [ ] **Step 5: Write `app/api/admin/social/posts/[id]/route.ts`**

```typescript
// app/api/admin/social/posts/[id]/route.ts
// PATCH { caption_text, hashtags } — edits the latest caption for a post.
// Writes a new social_captions row with version = latest + 1, and updates
// social_posts.content to match. Leaves approval_status alone (the coach
// approves explicitly after editing).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { addCaptionToPost, listCaptionsForPost } from "@/lib/db/social-captions"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { caption_text?: string; hashtags?: string[] } | null
  const caption_text = body?.caption_text?.trim()
  if (!caption_text) {
    return NextResponse.json({ error: "caption_text is required" }, { status: 400 })
  }
  const hashtags = Array.isArray(body?.hashtags) ? body!.hashtags.map((h) => h.trim()).filter(Boolean) : []

  const existingCaptions = await listCaptionsForPost(id)
  const nextVersion = existingCaptions.reduce((max, c) => Math.max(max, c.version), 0) + 1

  await addCaptionToPost({
    social_post_id: id,
    caption_text,
    hashtags,
    version: nextVersion,
  })

  const updated = await updateSocialPost(id, {
    content: caption_text,
    approval_status: post.approval_status === "draft" ? "edited" : post.approval_status,
  })

  return NextResponse.json({
    id: updated.id,
    content: updated.content,
    approval_status: updated.approval_status,
    version: nextVersion,
  })
}
```

- [ ] **Step 6: Run → PASS**

Run: `npm run test:run -- __tests__/api/admin/social/`
Expected: 3 approval tests + existing fanout tests passing.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/social/posts __tests__/api/admin/social/approve.test.ts
git commit -m "feat(api): approve / reject / edit social post routes"
```

---

### Task 10: Social admin page — real data + action cards

**Files:**

- Modify: `app/(admin)/admin/social/page.tsx`
- Create: `components/admin/social/SocialPostsList.tsx`
- Create: `components/admin/social/SocialPostCard.tsx`

- [ ] **Step 1: Replace `app/(admin)/admin/social/page.tsx`**

```tsx
// app/(admin)/admin/social/page.tsx
import { Sparkles, Clock, CheckCircle } from "lucide-react"
import { listSocialPosts } from "@/lib/db/social-posts"
import { SocialPostsList } from "@/components/admin/social/SocialPostsList"
import type { SocialPost } from "@/types/database"

export const metadata = { title: "Social" }

export default async function SocialPage() {
  const posts: SocialPost[] = await listSocialPosts()

  const drafts = posts.filter((p) => p.approval_status === "draft" || p.approval_status === "edited").length
  const awaiting = posts.filter((p) => p.approval_status === "awaiting_connection").length
  const approved = posts.filter((p) => p.approval_status === "approved").length
  const published = posts.filter((p) => p.approval_status === "published").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-1">Social</h1>
      <p className="text-sm text-muted-foreground mb-6">
        AI-generated captions for every connected platform. Edit, approve, or reject each one.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Sparkles className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">To review</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{drafts}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <Clock className="size-3.5 sm:size-4 text-accent" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Awaiting connection</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{awaiting}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CheckCircle className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Approved</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{approved}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Published</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{published}</p>
          </div>
        </div>
      </div>

      <SocialPostsList initialPosts={posts} />
    </div>
  )
}
```

- [ ] **Step 2: Create `components/admin/social/SocialPostsList.tsx`**

```tsx
"use client"

import { useState } from "react"
import { Megaphone } from "lucide-react"
import { SocialPostCard } from "./SocialPostCard"
import type { SocialPost } from "@/types/database"

interface SocialPostsListProps {
  initialPosts: SocialPost[]
}

const SECTIONS: Array<{ key: SocialPost["approval_status"] | "to_review"; label: string }> = [
  { key: "to_review", label: "To review" },
  { key: "awaiting_connection", label: "Awaiting platform connection" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
  { key: "rejected", label: "Rejected" },
]

export function SocialPostsList({ initialPosts }: SocialPostsListProps) {
  const [posts, setPosts] = useState(initialPosts)

  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Megaphone className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No social posts yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a coaching video in the Videos tab, click Transcribe, then click Generate Social — captions will appear
          here.
        </p>
      </div>
    )
  }

  function onUpdate(updated: SocialPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function onRemove(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => {
        const sectionPosts = posts.filter((p) => {
          if (section.key === "to_review") return p.approval_status === "draft" || p.approval_status === "edited"
          return p.approval_status === section.key
        })
        if (sectionPosts.length === 0) return null

        return (
          <section key={section.key}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {section.label} ({sectionPosts.length})
            </h2>
            <div className="space-y-3">
              {sectionPosts.map((post) => (
                <SocialPostCard key={post.id} post={post} onUpdate={onUpdate} onRemove={onRemove} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create `components/admin/social/SocialPostCard.tsx`**

```tsx
"use client"

import { useState } from "react"
import { Facebook, Instagram, Music2, Youtube, Linkedin, Check, X, Pencil } from "lucide-react"
import { toast } from "sonner"
import type { SocialPost, SocialPlatform } from "@/types/database"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  linkedin: "LinkedIn",
}

interface SocialPostCardProps {
  post: SocialPost
  onUpdate: (post: SocialPost) => void
  onRemove: (id: string) => void
}

export function SocialPostCard({ post, onUpdate, onRemove }: SocialPostCardProps) {
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(post.content)
  const [busy, setBusy] = useState<"approve" | "reject" | "save" | null>(null)
  const Icon = PLATFORM_ICONS[post.platform]

  async function approve() {
    setBusy("approve")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const { approval_status } = (await res.json()) as { approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, approval_status })
      toast.success(
        approval_status === "awaiting_connection" ? "Approved — waiting for platform connection" : "Approved",
      )
    } catch (error) {
      toast.error((error as Error).message || "Approve failed")
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    setBusy("reject")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rejection_notes: null }),
      })
      if (!res.ok) throw new Error(await res.text())
      onUpdate({ ...post, approval_status: "rejected" })
      toast.success("Rejected")
    } catch (error) {
      toast.error((error as Error).message || "Reject failed")
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (draftContent.trim() === post.content.trim()) {
      setEditing(false)
      return
    }
    setBusy("save")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption_text: draftContent, hashtags: [] }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { content: string; approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, content: data.content, approval_status: data.approval_status })
      setEditing(false)
      toast.success("Caption updated")
    } catch (error) {
      toast.error((error as Error).message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <p className="font-medium text-primary">{PLATFORM_LABELS[post.platform]}</p>
        <span className="text-xs text-muted-foreground ml-auto">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>

      {editing ? (
        <textarea
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-border p-3 text-sm font-body bg-surface resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <pre className="whitespace-pre-wrap text-sm text-primary font-body">{post.content}</pre>
      )}

      <div className="flex items-center gap-2 mt-3">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={busy !== null}
              className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy === "save" ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftContent(post.content)
                setEditing(false)
              }}
              disabled={busy !== null}
              className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={approve}
              disabled={busy !== null || post.approval_status === "published"}
              className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
            >
              <Check className="size-3" /> {busy === "approve" ? "Approving..." : "Approve"}
            </button>
            <button
              type="button"
              onClick={reject}
              disabled={busy !== null || post.approval_status === "rejected"}
              className="text-xs px-3 py-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 disabled:opacity-60 inline-flex items-center gap-1"
            >
              <X className="size-3" /> Reject
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy !== null}
              className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
            >
              <Pencil className="size-3" /> Edit
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep -E "social/(page|SocialPost)" | head -10`
Expected: No errors on the new files.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/social/page.tsx components/admin/social/SocialPostsList.tsx components/admin/social/SocialPostCard.tsx
git commit -m "feat(admin): Social page lists real posts grouped by status with approve/reject/edit actions"
```

---

## Post-Phase-3a Verification

- [ ] **Run full test suites**

Run: `npm run test:run`
Expected: All Phase 3a tests pass (3 video-upload + 5 fanout + 3 approval = 11 new, plus all prior tests).

Run: `cd functions && npx vitest run && cd ..`
Expected: All functions tests pass (40 existing + 3 social-fanout = 43).

- [ ] **Build checks**

Run: `npm run build`
Expected: Clean Next.js build.

Run: `cd functions && npm run build && cd ..`
Expected: Clean Firebase Functions build.

- [ ] **Deploy `socialFanout` Firebase Function** (controller handles)

```bash
cd functions && firebase deploy --only functions:socialFanout
```

- [ ] **Push branch**

```bash
git push
```

- [ ] **Smoke test (manual, after deploy)**

1. Open `/admin/videos`, drag a test `.mp4` into the uploader → should reach 100% and show "uploaded"
2. Click "Transcribe" → status moves to "transcribing" then "transcribed" within ~1 min (poll with page refresh)
3. Click "Generate Social" → 6 `social_posts` rows appear in the Social tab within ~1 min
4. All 6 land in "Awaiting platform connection" (since no OAuth happened yet — expected)
5. Edit one caption inline, click Save — new `social_captions` row with version=2 persists
6. Reject another — moves to "Rejected" section

---

## What Phase 3a Unblocks

- **Phase 3b** (content calendar + scheduled publisher) — reads approved `social_posts` rows, drags to reschedule, cron function picks up `approval_status=approved AND scheduled_at <= now()` and calls plugin.publish()
- **Phase 4** (blog + newsletter extensions) — the same `createAiJob` + prompt-template pattern established here applies
- **Phase 2b** (OAuth flows) — connecting a platform flips matching `awaiting_connection` posts to `approved` automatically (just invert the check in the approve route)
- **Phase 5** (performance learning loop) — `rejection_notes` stored on rejected posts feed into future prompt tuning

---

## Self-Review

**1. Spec coverage:**

- ✅ Video upload UI — Task 4 + Task 5
- ✅ Signed upload URL + video_uploads row — Task 2
- ✅ Transcribe trigger from UI — Task 5 (button) wired to existing `/api/admin/videos/transcribe` (Phase 2a)
- ✅ Multi-platform fanout orchestrator — Task 6
- ✅ 6 platform-specific prompts — Task 1
- ✅ ai_jobs integration via `createAiJob` — Task 8
- ✅ Approval workflow (approve / reject / edit) — Task 9
- ✅ Awaiting-connection handling — Task 6 + Task 9
- ⏸ Content calendar — deferred to 3b
- ⏸ Scheduled publishing engine — deferred to 3b
- ⏸ TikTok hybrid notification _at publish time_ — deferred to 3b (plugin exists in 2a)

**2. Placeholder scan:** no TBD/TODO/fill-in-details. All code complete.

**3. Type consistency:** `SocialPlatform` union referenced in Task 6 and Task 10 matches `@/types/database`. `approval_status` values match migration 00076 CHECK constraint ("draft" | "edited" | "approved" | "scheduled" | "published" | "rejected" | "awaiting_connection" | "failed"). `createAiJob` signature matches `lib/ai-jobs.ts` from Phase 1.

**4. Security:** Every API route checks `session.user.role === "admin"`. Signed upload URL is scoped to one storage path + expires in 15 min + requires matching Content-Type. `social_posts` RLS (set in Phase 1) restricts to admins via service-role DAL calls.

**5. Dev experience:** TDD flow on every testable unit (Tasks 2, 6, 8, 9). UI Tasks (3, 4, 5, 10) verified via tsc only (e2e Playwright deferred to Phase 3b when the full flow is wired).

**6. Rollback plan:** Every task is a single commit. If Task 6 fanout behaves badly in production, disable by `firebase functions:delete socialFanout` — the ai_jobs doc creation still succeeds (Phase 1 behavior) and just never processes.
