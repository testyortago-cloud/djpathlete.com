# Video Edit Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin mark a video as "needs editing" at upload time and block posts backed by that video from being approved/scheduled/published until a captioned cut is rendered or it's manually marked ready.

**Architecture:** One boolean `needs_edit` on `video_uploads` (default `true`), set from a toggle in the upload dialog. A pure rule `isVideoPostable(video, hasCut) = !video.needs_edit || hasCut` plus an async guard `assertSourceVideoPostable(sourceVideoId)` enforce the gate at all four post-state chokepoints (create, approve, schedule, publish-now). Postability auto-clears off the existing captioned-cut signal, so the render-worker is untouched. A manual "Mark as ready" PATCH flips the flag.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase (service-role DAL), Vitest + Testing Library, Tailwind v4, Lucide icons, Sonner toasts.

**Spec:** [docs/superpowers/specs/2026-05-31-video-edit-gate-design.md](../specs/2026-05-31-video-edit-gate-design.md)

---

## Conventions for this plan

- **Run a single test file:** `npm run test:run -- <path>`
- **Migrations are applied via the Supabase MCP tool** `mcp__supabase__apply_migration` (the CLI is not linked). The "apply" steps below mean: call that tool with `name` and the SQL `query`. Still commit the `.sql` file to the repo for history.
- **Commit directly to `main`** (solo dev convention). Each task ends in a commit.

---

### Task 1: Add `needs_edit` column, type, and DAL support

**Files:**
- Create: `supabase/migrations/00160_video_uploads_needs_edit.sql`
- Modify: `types/database.ts` (the `VideoUpload` interface)
- Modify: `lib/db/video-uploads.ts` (the `createVideoUpload` signature)
- Test: `__tests__/db/video-uploads.test.ts`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/00160_video_uploads_needs_edit.sql`:

```sql
-- 00160_video_uploads_needs_edit.sql
-- Edit gate: a video marked needs_edit=true cannot be posted/scheduled until a
-- captioned cut is rendered (auto-clears the gate) or it is manually marked ready.
-- No backfill: existing rows take the gated default; Content Studio data is wiped
-- during testing.
alter table video_uploads
  add column needs_edit boolean not null default true;
```

- [ ] **Step 2: Apply the migration**

Call `mcp__supabase__apply_migration` with `name: "video_uploads_needs_edit"` and `query` set to the SQL above.
Expected: success, no error.

- [ ] **Step 3: Write the failing DB test**

Add this test inside the existing `describe(...)` in `__tests__/db/video-uploads.test.ts`:

```ts
  it("defaults needs_edit to true and accepts an explicit false", async () => {
    const gated = await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}d.mp4`,
      original_filename: `${TEST_TAG}d.mp4`,
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      title: null,
      uploaded_by: null,
      status: "uploaded",
    })
    expect(gated.needs_edit).toBe(true)

    const ready = await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}e.mp4`,
      original_filename: `${TEST_TAG}e.mp4`,
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      title: null,
      uploaded_by: null,
      status: "uploaded",
      needs_edit: false,
    })
    expect(ready.needs_edit).toBe(false)
  })
```

- [ ] **Step 4: Run the test to confirm it fails to type-check / fails**

Run: `npm run test:run -- __tests__/db/video-uploads.test.ts`
Expected: FAIL — `needs_edit` is not a known property on the insert type, and/or `gated.needs_edit` is `undefined`.

- [ ] **Step 5: Add `needs_edit` to the `VideoUpload` type**

In `types/database.ts`, in the `VideoUpload` interface, add the field right after `status`:

```ts
  status: VideoUploadStatus
  /**
   * Edit gate. When true the video still needs editing — posts backed by it
   * cannot be approved/scheduled/published until a captioned cut is rendered
   * (auto-clears) or it is manually marked ready. NOT NULL, defaults true.
   */
  needs_edit: boolean
```

- [ ] **Step 6: Make `createVideoUpload` accept `needs_edit` optionally**

In `lib/db/video-uploads.ts`, change the `createVideoUpload` signature so callers can omit the field (DB default applies):

```ts
export async function createVideoUpload(
  upload: Omit<VideoUpload, "id" | "created_at" | "updated_at" | "needs_edit"> & {
    needs_edit?: boolean
  },
): Promise<VideoUpload> {
  const supabase = getClient()
  const { data, error } = await supabase.from("video_uploads").insert(upload).select().single()
  if (error) throw error
  return data as VideoUpload
}
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `npm run test:run -- __tests__/db/video-uploads.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00160_video_uploads_needs_edit.sql types/database.ts lib/db/video-uploads.ts __tests__/db/video-uploads.test.ts
git commit -m "feat(content-studio): add needs_edit column to video_uploads"
```

---

### Task 2: The gate rule + async guard (`edit-gate.ts`)

**Files:**
- Create: `lib/content-studio/edit-gate.ts`
- Test: `__tests__/lib/content-studio/edit-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/edit-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const getLatestCutMock = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoUploadByIdMock(...a),
}))
vi.mock("@/lib/db/media-assets", () => ({
  getLatestCaptionedCutForVideo: (...a: unknown[]) => getLatestCutMock(...a),
}))

import { isVideoPostable, assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"

describe("isVideoPostable", () => {
  it("not postable when gated and no cut", () => {
    expect(isVideoPostable({ needs_edit: true }, false)).toBe(false)
  })
  it("postable when gated but a cut exists", () => {
    expect(isVideoPostable({ needs_edit: true }, true)).toBe(true)
  })
  it("postable when not gated and no cut", () => {
    expect(isVideoPostable({ needs_edit: false }, false)).toBe(true)
  })
  it("postable when not gated and a cut exists", () => {
    expect(isVideoPostable({ needs_edit: false }, true)).toBe(true)
  })
})

describe("assertSourceVideoPostable", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ok when sourceVideoId is null and makes no DB calls", async () => {
    expect(await assertSourceVideoPostable(null)).toEqual({ ok: true })
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })
  it("ok when the video is not found", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
  it("not ok when gated and no cut", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: true })
    getLatestCutMock.mockResolvedValue(null)
    const r = await assertSourceVideoPostable("v1")
    expect(r.ok).toBe(false)
  })
  it("ok when gated but a cut exists", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: true })
    getLatestCutMock.mockResolvedValue({ asset: { id: "a1" } })
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
  it("ok when not gated", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", needs_edit: false })
    getLatestCutMock.mockResolvedValue(null)
    expect(await assertSourceVideoPostable("v1")).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/lib/content-studio/edit-gate.test.ts`
Expected: FAIL — cannot resolve `@/lib/content-studio/edit-gate`.

- [ ] **Step 3: Write the implementation**

Create `lib/content-studio/edit-gate.ts`:

```ts
// lib/content-studio/edit-gate.ts
// The posting "edit gate" in one place. A video is postable once it is no longer
// gated: either it was never gated / has been marked ready (needs_edit === false),
// or it already has a rendered captioned cut. Postability is therefore DERIVED from
// the existing cut signal — the render-worker writes nothing extra.
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getLatestCaptionedCutForVideo } from "@/lib/db/media-assets"
import type { VideoUpload } from "@/types/database"

export function isVideoPostable(
  video: Pick<VideoUpload, "needs_edit">,
  hasCut: boolean,
): boolean {
  return video.needs_edit === false || hasCut
}

export type PostableGuardResult = { ok: true } | { ok: false; reason: string }

const GATED_REASON =
  "Source video still needs editing — render a captioned cut or mark it ready."

// Async guard for route handlers. Returns ok when the post is NOT gated:
//  - sourceVideoId null → ok (manual / image / carousel posts are never gated)
//  - video not found    → ok (let the route's own validation handle the 404)
export async function assertSourceVideoPostable(
  sourceVideoId: string | null,
): Promise<PostableGuardResult> {
  if (!sourceVideoId) return { ok: true }
  const video = await getVideoUploadById(sourceVideoId)
  if (!video) return { ok: true }
  const cut = await getLatestCaptionedCutForVideo(sourceVideoId)
  if (isVideoPostable(video, !!cut)) return { ok: true }
  return { ok: false, reason: GATED_REASON }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/lib/content-studio/edit-gate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/edit-gate.ts __tests__/lib/content-studio/edit-gate.test.ts
git commit -m "feat(content-studio): add edit-gate rule and source-video guard"
```

---

### Task 3: Thread `needsEdit` through the upload API

**Files:**
- Modify: `lib/firebase-client-upload.ts`
- Modify: `app/api/admin/videos/route.ts:36-67`
- Test: `__tests__/api/admin/videos.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe("POST /api/admin/videos", ...)` in `__tests__/api/admin/videos.test.ts`:

```ts
  it("passes needs_edit=false through to createVideoUpload", async () => {
    const fileMock = { getSignedUrl: vi.fn().mockResolvedValue(["https://signed"]) }
    getAdminStorageMock.mockReturnValue({ bucket: () => ({ file: () => fileMock }) })
    createVideoUploadMock.mockResolvedValue({ id: "u1" })

    await POST(makeRequest({ filename: "a.mp4", needsEdit: false }))
    expect(createVideoUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ needs_edit: false }),
    )
  })

  it("defaults needs_edit to true when needsEdit is omitted", async () => {
    const fileMock = { getSignedUrl: vi.fn().mockResolvedValue(["https://signed"]) }
    getAdminStorageMock.mockReturnValue({ bucket: () => ({ file: () => fileMock }) })
    createVideoUploadMock.mockResolvedValue({ id: "u1" })

    await POST(makeRequest({ filename: "a.mp4" }))
    expect(createVideoUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ needs_edit: true }),
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- __tests__/api/admin/videos.test.ts`
Expected: FAIL — `createVideoUpload` is called without `needs_edit`.

- [ ] **Step 3: Read `needsEdit` in the route and pass it on**

In `app/api/admin/videos/route.ts`, update the body type and the `createVideoUpload` call:

```ts
  const body = (await request.json().catch(() => null)) as
    | { filename?: string; contentType?: string; title?: string; needsEdit?: boolean }
    | null
```

```ts
  const upload = await createVideoUpload({
    storage_path: storagePath,
    original_filename: filename,
    mime_type: contentType,
    duration_seconds: null,
    size_bytes: null,
    title: body?.title ?? null,
    uploaded_by: session.user.id,
    status: "uploaded",
    needs_edit: body?.needsEdit ?? true,
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- __tests__/api/admin/videos.test.ts`
Expected: PASS.

- [ ] **Step 5: Forward `needsEdit` from the client uploader helper**

In `lib/firebase-client-upload.ts`, add the field to the request body type and the `uploadVideoFile` options:

```ts
export interface UploadRequestBody {
  filename: string
  contentType: string
  title?: string
  needsEdit?: boolean
}
```

```ts
export async function uploadVideoFile(
  file: File,
  options: {
    title?: string
    needsEdit?: boolean
    onProgress?: (event: UploadProgressEvent) => void
  } = {},
): Promise<{ videoUploadId: string; storagePath: string }> {
  const { videoUploadId, uploadUrl, storagePath } = await requestSignedUpload({
    filename: file.name,
    contentType: file.type || "video/mp4",
    title: options.title,
    needsEdit: options.needsEdit,
  })
  if (!videoUploadId) throw new Error("Video upload response missing videoUploadId")
  await uploadToSignedUrl(uploadUrl, file, options.onProgress)
  return { videoUploadId, storagePath }
}
```

(`requestSignedUpload` already serializes the whole body, so no change is needed there.)

- [ ] **Step 6: Commit**

```bash
git add lib/firebase-client-upload.ts app/api/admin/videos/route.ts __tests__/api/admin/videos.test.ts
git commit -m "feat(content-studio): thread needsEdit through the video upload API"
```

---

### Task 4: Upload-dialog toggle in `VideoUploader`

**Files:**
- Modify: `components/admin/videos/VideoUploader.tsx`
- Modify: `components/admin/content-studio/calendar/ManualPostDialog.tsx:280`
- Test: `__tests__/components/admin/videos/VideoUploader.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/videos/VideoUploader.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/firebase-client-upload", () => ({ uploadVideoFile: vi.fn() }))
vi.mock("@/lib/firebase-client-thumbnail", () => ({ generateAndUploadThumbnail: vi.fn() }))

import { VideoUploader } from "@/components/admin/videos/VideoUploader"

describe("VideoUploader edit-gate toggle", () => {
  it("renders the 'Needs editing' checkbox checked by default", () => {
    render(<VideoUploader onUploaded={() => {}} />)
    expect(screen.getByRole("checkbox", { name: /needs editing/i })).toBeChecked()
  })

  it("hides the toggle when showNeedsEditToggle is false", () => {
    render(<VideoUploader onUploaded={() => {}} showNeedsEditToggle={false} />)
    expect(screen.queryByRole("checkbox", { name: /needs editing/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/components/admin/videos/VideoUploader.test.tsx`
Expected: FAIL — no checkbox in the rendered output.

- [ ] **Step 3: Add the toggle and props to `VideoUploader`**

In `components/admin/videos/VideoUploader.tsx`:

Replace the props interface and the component signature:

```tsx
interface VideoUploaderProps {
  onUploaded: (videoUploadId: string) => void
  /** Initial value of the "needs editing" toggle. Default true (gated). */
  needsEditDefault?: boolean
  /** Whether to show the toggle at all. Default true. */
  showNeedsEditToggle?: boolean
}

export function VideoUploader({
  onUploaded,
  needsEditDefault = true,
  showNeedsEditToggle = true,
}: VideoUploaderProps) {
  const [state, setState] = useState<UploadState>({ status: "idle" })
  const [dragging, setDragging] = useState(false)
  const [needsEdit, setNeedsEdit] = useState(needsEditDefault)
  const inputRef = useRef<HTMLInputElement>(null)
```

In `handleFile`, pass `needsEdit` to `uploadVideoFile`:

```tsx
      const { videoUploadId } = await uploadVideoFile(file, {
        title: file.name.replace(/\.[^.]+$/, ""),
        needsEdit,
        onProgress: (event: UploadProgressEvent) => {
          setState({ status: "uploading", filename: file.name, percent: event.percent })
        },
      })
```

Add the toggle as a **sibling of the dropzone `<label>`** (so clicking it does not open the file picker). Change the outer return so the toggle sits inside the wrapper `<div>` after the dropzone label:

```tsx
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
        {/* ...existing input + state blocks stay unchanged... */}
      </label>

      {showNeedsEditToggle && (
        <label className="flex items-center gap-2 px-4 pb-4 -mt-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={needsEdit}
            onChange={(e) => setNeedsEdit(e.target.checked)}
            className="size-4 rounded border-border accent-primary"
          />
          Needs editing — gate from posting until a cut is rendered
        </label>
      )}
    </div>
  )
```

(Keep the existing `<input ref={inputRef} ... />` and the four `state.status === ...` blocks exactly as they are, inside the dropzone label.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/components/admin/videos/VideoUploader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Opt the manual-post inline uploader out of the gate**

In `components/admin/content-studio/calendar/ManualPostDialog.tsx`, line ~280, a video composed inline for a manual post is being published now, so it should not be gated:

```tsx
              <VideoUploader
                onUploaded={(id) => setSourceVideoId(id)}
                needsEditDefault={false}
                showNeedsEditToggle={false}
              />
```

- [ ] **Step 6: Commit**

```bash
git add components/admin/videos/VideoUploader.tsx components/admin/content-studio/calendar/ManualPostDialog.tsx __tests__/components/admin/videos/VideoUploader.test.tsx
git commit -m "feat(content-studio): add needs-edit toggle to the video uploader"
```

---

### Task 5: Enforce the gate on post creation (downgrade-to-draft)

**Files:**
- Modify: `app/api/admin/content-studio/posts/route.ts:168-209`
- Modify: `__tests__/api/admin/content-studio/posts-image.test.ts` (add edit-gate mock)
- Modify: `__tests__/api/admin/content-studio/posts-carousel.test.ts` (add edit-gate mock)
- Modify: `__tests__/api/admin/content-studio/posts-story.test.ts` (add edit-gate mock)
- Test: `__tests__/api/admin/content-studio/posts-edit-gate.test.ts`

- [ ] **Step 1: Write the failing gate test**

Create `__tests__/api/admin/content-studio/posts-edit-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockAttach = vi.fn()
const mockGuard = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...a: unknown[]) => mockCreate(...a),
  deleteSocialPost: (...a: unknown[]) => mockDelete(...a),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...a: unknown[]) => mockAttach(...a),
}))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: (...a: unknown[]) => mockGuard(...a),
}))

import { POST } from "@/app/api/admin/content-studio/posts/route"

function call(body: unknown) {
  const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
  return POST(req)
}

describe("POST /api/admin/content-studio/posts — edit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockGuard.mockResolvedValue({ ok: true })
  })

  it("downgrades a video post to draft when the source video is gated", async () => {
    mockGuard.mockResolvedValue({ ok: false, reason: "needs editing" })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "draft" })

    const res = await call({ platform: "instagram", caption: "hi", source_video_id: "v1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ gated: true, approval_status: "draft" })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: "draft",
        scheduled_at: null,
        source_video_id: "v1",
      }),
    )
  })

  it("keeps a video post approved when the source video is postable", async () => {
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "approved" })

    const res = await call({ platform: "instagram", caption: "hi", source_video_id: "v1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ gated: false })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved" }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/api/admin/content-studio/posts-edit-gate.test.ts`
Expected: FAIL — response has no `gated` field; gated case is still `approved`.

- [ ] **Step 3: Add the gate to the create route**

In `app/api/admin/content-studio/posts/route.ts`, add the import near the other DAL imports:

```ts
import { assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"
```

Replace the `initialStatus` block + `createSocialPost` call (currently lines ~168-189) with:

```ts
  const sourceVideoId =
    postType === "image" || postType === "carousel" ? null : body?.source_video_id ?? null

  let initialStatus: "draft" | "scheduled" | "approved" = scheduledAt
    ? "scheduled"
    : postType === "story"
      ? "draft"
      : "approved"
  let effectiveScheduledAt = scheduledAt

  // Edit gate: a post backed by a video that still needs editing can't enter
  // approved/scheduled. Downgrade it to a draft rather than publishing raw footage.
  let gated = false
  if (sourceVideoId && (initialStatus === "approved" || initialStatus === "scheduled")) {
    const guard = await assertSourceVideoPostable(sourceVideoId)
    if (!guard.ok) {
      gated = true
      initialStatus = "draft"
      effectiveScheduledAt = null
    }
  }

  const post = await createSocialPost({
    platform,
    content: caption,
    media_url: null,
    post_type: postType,
    approval_status: initialStatus,
    scheduled_at: effectiveScheduledAt,
    source_video_id: sourceVideoId,
    created_by: session.user.id,
  })
```

Update the final success response (currently line ~209) to include `gated`:

```ts
  return NextResponse.json({ id: post.id, approval_status: post.approval_status, gated })
```

- [ ] **Step 4: Run the gate test to verify it passes**

Run: `npm run test:run -- __tests__/api/admin/content-studio/posts-edit-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep the existing create-route tests isolated from the DB**

The real guard calls Supabase. The existing create-route tests create video/story posts but don't mock the guard. Add this mock block to **each** of `__tests__/api/admin/content-studio/posts-image.test.ts`, `posts-carousel.test.ts`, and `posts-story.test.ts`, alongside their other `vi.mock(...)` calls:

```ts
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: async () => ({ ok: true }),
}))
```

- [ ] **Step 6: Run the create-route test suite to verify nothing regressed**

Run: `npm run test:run -- __tests__/api/admin/content-studio`
Expected: PASS (image, carousel, story, edit-gate all green).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/content-studio/posts/route.ts __tests__/api/admin/content-studio/posts-edit-gate.test.ts __tests__/api/admin/content-studio/posts-image.test.ts __tests__/api/admin/content-studio/posts-carousel.test.ts __tests__/api/admin/content-studio/posts-story.test.ts
git commit -m "feat(content-studio): gate post creation on source-video edit state"
```

---

### Task 6: Enforce the gate on the approve transition (status route)

**Files:**
- Modify: `app/api/admin/content-studio/posts/[id]/status/route.ts:53-65`
- Test: `__tests__/api/content-studio/posts-status.test.ts`

- [ ] **Step 1: Add the edit-gate mock + a failing gated test**

In `__tests__/api/content-studio/posts-status.test.ts`, add the guard mock near the other mocks:

```ts
const mockGuard = vi.fn()
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: (...args: unknown[]) => mockGuard(...args),
}))
```

In the `beforeEach`, reset it to ok by default (so the existing `needs_review → approved` test still passes):

```ts
  beforeEach(() => {
    mockGetPost.mockReset()
    mockUpdatePost.mockReset()
    mockGuard.mockReset()
    mockGuard.mockResolvedValue({ ok: true })
  })
```

Add the new test:

```ts
  it("blocks approve (409) when the source video still needs editing", async () => {
    mockGetPost.mockResolvedValueOnce(basePost) // source_video_id: "v1"
    mockGuard.mockResolvedValueOnce({ ok: false, reason: "still needs editing" })
    const res = await POST(req({ targetColumn: "approved" }) as never, {
      params: Promise.resolve({ id: "p1" }),
    })
    expect(res.status).toBe(409)
    expect(mockUpdatePost).not.toHaveBeenCalled()
  })

  it("still allows moving a gated post back to needs_review", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    mockUpdatePost.mockResolvedValueOnce({ ...basePost, approval_status: "draft" })
    mockGuard.mockResolvedValueOnce({ ok: false, reason: "still needs editing" })
    const res = await POST(req({ targetColumn: "needs_review" }) as never, {
      params: Promise.resolve({ id: "p1" }),
    })
    expect(res.status).toBe(200)
  })
```

- [ ] **Step 2: Run the tests to verify the gated test fails**

Run: `npm run test:run -- __tests__/api/content-studio/posts-status.test.ts`
Expected: FAIL — approve currently returns 200 even when gated.

- [ ] **Step 3: Add the guard to the approve transition**

In `app/api/admin/content-studio/posts/[id]/status/route.ts`, add the import:

```ts
import { assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"
```

After the 404 check (`if (!post) ...`) and before `const nextStatus = columnToStatus(target)`, insert:

```ts
  // Edit gate: approving a post means it can be scheduled/published next, so it
  // must clear the gate first. Moving back to needs_review/failed stays open.
  if (target === "approved") {
    const guard = await assertSourceVideoPostable(post.source_video_id ?? null)
    if (!guard.ok) {
      return NextResponse.json({ error: guard.reason }, { status: 409 })
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- __tests__/api/content-studio/posts-status.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/content-studio/posts/[id]/status/route.ts __tests__/api/content-studio/posts-status.test.ts
git commit -m "feat(content-studio): gate the approve transition on edit state"
```

---

### Task 7: Enforce the gate on schedule + publish-now

**Files:**
- Modify: `app/api/admin/social/posts/[id]/schedule/route.ts:62-73`
- Modify: `app/api/admin/social/posts/[id]/publish-now/route.ts:31-42`
- Test: `__tests__/api/admin/social/schedule.test.ts`
- Test: `__tests__/api/admin/social/publish-now.test.ts`

- [ ] **Step 1: Add the edit-gate mock + failing test to schedule.test.ts**

In `__tests__/api/admin/social/schedule.test.ts`, add the guard mock near the others:

```ts
const guardMock = vi.fn()
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: (...a: unknown[]) => guardMock(...a),
}))
```

In `beforeEach`, default it to ok:

```ts
    guardMock.mockResolvedValue({ ok: true })
```

Add the test:

```ts
  it("returns 409 when the source video still needs editing", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      source_video_id: "v1",
    })
    guardMock.mockResolvedValue({ ok: false, reason: "needs editing" })
    const res = await callSchedule("p1", { scheduled_at: futureIso(60) })
    expect(res.status).toBe(409)
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Add the edit-gate mock + failing test to publish-now.test.ts**

In `__tests__/api/admin/social/publish-now.test.ts`, add the guard mock near the others:

```ts
const guardMock = vi.fn()
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: (...a: unknown[]) => guardMock(...a),
}))
```

In `beforeEach`, default it to ok:

```ts
    guardMock.mockResolvedValue({ ok: true })
```

Add the test:

```ts
  it("returns 409 when the source video still needs editing", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      post_type: "video",
      source_video_id: "v1",
    })
    guardMock.mockResolvedValue({ ok: false, reason: "needs editing" })
    const res = await call("p1")
    expect(res.status).toBe(409)
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run both test files to verify the new tests fail**

Run: `npm run test:run -- __tests__/api/admin/social/schedule.test.ts __tests__/api/admin/social/publish-now.test.ts`
Expected: FAIL — both currently reach `updateSocialPost` / 200.

- [ ] **Step 4: Add the guard to the schedule route**

In `app/api/admin/social/posts/[id]/schedule/route.ts`, add the import:

```ts
import { assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"
```

Immediately after the `SCHEDULABLE_STATUSES` block (after its closing `}`, before `const connections = ...`), insert:

```ts
  const gate = await assertSourceVideoPostable(post.source_video_id ?? null)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: 409 })
  }
```

- [ ] **Step 5: Add the guard to the publish-now route**

In `app/api/admin/social/posts/[id]/publish-now/route.ts`, add the import:

```ts
import { assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"
```

Immediately after the `PUBLISHABLE_STATUSES` block (before the `if (post.post_type !== "story")` connection check), insert:

```ts
  const gate = await assertSourceVideoPostable(post.source_video_id ?? null)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: 409 })
  }
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `npm run test:run -- __tests__/api/admin/social/schedule.test.ts __tests__/api/admin/social/publish-now.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/social/posts/[id]/schedule/route.ts app/api/admin/social/posts/[id]/publish-now/route.ts __tests__/api/admin/social/schedule.test.ts __tests__/api/admin/social/publish-now.test.ts
git commit -m "feat(content-studio): gate schedule and publish-now on edit state"
```

---

### Task 8: Manual override endpoint (`PATCH /api/admin/videos/[id]`)

**Files:**
- Create: `app/api/admin/videos/[id]/route.ts`
- Test: `__tests__/api/admin/videos-mark-ready.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/videos-mark-ready.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/video-uploads", () => ({
  updateVideoUpload: (...a: unknown[]) => updateMock(...a),
}))

import { PATCH } from "@/app/api/admin/videos/[id]/route"

function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/videos/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return PATCH(req as never, { params: Promise.resolve({ id }) })
}

describe("PATCH /api/admin/videos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
  })

  it("401 for non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call("v1", { needs_edit: false })).status).toBe(401)
  })

  it("400 when needs_edit is missing or not a boolean", async () => {
    expect((await call("v1", {})).status).toBe(400)
  })

  it("marks a video ready", async () => {
    updateMock.mockResolvedValue({ id: "v1", needs_edit: false })
    const res = await call("v1", { needs_edit: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "v1", needs_edit: false })
    expect(updateMock).toHaveBeenCalledWith("v1", { needs_edit: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/api/admin/videos-mark-ready.test.ts`
Expected: FAIL — cannot resolve `@/app/api/admin/videos/[id]/route`.

- [ ] **Step 3: Write the route**

Create `app/api/admin/videos/[id]/route.ts`:

```ts
// app/api/admin/videos/[id]/route.ts
// PATCH { needs_edit: boolean } — manual override for the edit gate. Admin-only.
// Used by the "Mark as ready" action in the video drawer.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateVideoUpload } from "@/lib/db/video-uploads"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { needs_edit?: boolean } | null
  if (typeof body?.needs_edit !== "boolean") {
    return NextResponse.json({ error: "needs_edit (boolean) is required" }, { status: 400 })
  }

  const { id } = await params
  const updated = await updateVideoUpload(id, { needs_edit: body.needs_edit })
  return NextResponse.json({ id: updated.id, needs_edit: updated.needs_edit })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/api/admin/videos-mark-ready.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/videos/[id]/route.ts __tests__/api/admin/videos-mark-ready.test.ts
git commit -m "feat(content-studio): add mark-as-ready PATCH for the edit gate"
```

---

### Task 9: "Mark as ready" button in the video drawer

**Files:**
- Create: `components/admin/content-studio/drawer/MarkReadyButton.tsx`
- Modify: `components/admin/content-studio/drawer/DrawerVideoHeader.tsx:1-3,70-72`
- Test: `__tests__/components/admin/content-studio/drawer/MarkReadyButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/drawer/MarkReadyButton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { MarkReadyButton } from "@/components/admin/content-studio/drawer/MarkReadyButton"

describe("MarkReadyButton", () => {
  it("renders the button when the video still needs editing", () => {
    render(<MarkReadyButton videoUploadId="v1" needsEdit />)
    expect(screen.getByRole("button", { name: /mark as ready/i })).toBeInTheDocument()
  })

  it("renders nothing when the video is already ready", () => {
    const { container } = render(<MarkReadyButton videoUploadId="v1" needsEdit={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/drawer/MarkReadyButton.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

Create `components/admin/content-studio/drawer/MarkReadyButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

interface MarkReadyButtonProps {
  videoUploadId: string
  needsEdit: boolean
}

export function MarkReadyButton({ videoUploadId, needsEdit }: MarkReadyButtonProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Once the video is postable there is nothing to override.
  if (!needsEdit) return null

  async function markReady() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/videos/${videoUploadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ needs_edit: false }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? "Request failed"
        throw new Error(msg)
      }
      toast.success("Marked as ready — this video can now be posted")
      router.refresh()
    } catch (e) {
      toast.error(`Couldn't mark ready: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      onClick={markReady}
      disabled={saving}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted disabled:opacity-60"
    >
      {saving ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="size-3.5" />
      )}
      Mark as ready
    </button>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/drawer/MarkReadyButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the button into the drawer header**

In `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`, add the import next to the others:

```tsx
import { MarkReadyButton } from "./MarkReadyButton"
```

In the actions row (currently the `<div className="mt-4 flex flex-wrap gap-2">` containing `GenerateQuoteCardsButton`), add the button:

```tsx
        <div className="mt-4 flex flex-wrap gap-2">
          <GenerateQuoteCardsButton videoUploadId={video.id} hasTranscript={hasTranscript} />
          <MarkReadyButton videoUploadId={video.id} needsEdit={video.needs_edit} />
        </div>
```

- [ ] **Step 6: Run the test once more to confirm nothing broke**

Run: `npm run test:run -- __tests__/components/admin/content-studio/drawer/MarkReadyButton.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/admin/content-studio/drawer/MarkReadyButton.tsx components/admin/content-studio/drawer/DrawerVideoHeader.tsx __tests__/components/admin/content-studio/drawer/MarkReadyButton.test.tsx
git commit -m "feat(content-studio): mark-as-ready button in the video drawer"
```

---

### Task 10: "Needs edit" badge on the pipeline `VideoCard`

**Files:**
- Modify: `components/admin/content-studio/pipeline/VideoCard.tsx:2,98-113`
- Test: `__tests__/components/admin/content-studio/pipeline/VideoCard-needs-edit.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/VideoCard-needs-edit.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "11111111-1111-1111-1111-111111111111",
  storage_path: "videos/x.mp4",
  original_filename: "x.mp4",
  duration_seconds: 30,
  size_bytes: null,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "uploaded",
  needs_edit: true,
  created_at: "2026-05-31T00:00:00Z",
  updated_at: "2026-05-31T00:00:00Z",
}

describe("VideoCard — needs-edit badge", () => {
  it("shows 'Needs edit' when gated and not cut", () => {
    render(<VideoCard video={video} counts={null} hasCut={false} />)
    expect(screen.getByText(/needs edit/i)).toBeInTheDocument()
  })

  it("hides 'Needs edit' when the video has a cut", () => {
    render(<VideoCard video={video} counts={null} hasCut />)
    expect(screen.queryByText(/needs edit/i)).toBeNull()
  })

  it("hides 'Needs edit' when the video is not gated", () => {
    render(<VideoCard video={{ ...video, needs_edit: false }} counts={null} hasCut={false} />)
    expect(screen.queryByText(/needs edit/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/pipeline/VideoCard-needs-edit.test.tsx`
Expected: FAIL — no "Needs edit" text rendered.

- [ ] **Step 3: Add the badge to `VideoCard`**

In `components/admin/content-studio/pipeline/VideoCard.tsx`, add `Scissors` to the lucide import:

```tsx
import { Film, AlertCircle, Clock, Loader2, CheckCircle, Clapperboard, Scissors } from "lucide-react"
```

In the badge row (the `<div className="inline-flex items-center gap-2">` that holds the Cut badge + duration), add the "Needs edit" badge before the `hasCut` block:

```tsx
        <div className="inline-flex items-center gap-2">
          {video.needs_edit && !hasCut && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10"
              title="This video still needs editing before it can be posted"
            >
              <Scissors className="size-3" /> Needs edit
            </span>
          )}
          {hasCut && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-foreground px-1.5 py-0.5 rounded bg-accent/15"
              title="This video has a rendered captioned cut"
            >
              <Clapperboard className="size-3" /> Cut
            </span>
          )}
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <Clock className="size-3" /> {formatDuration(video.duration_seconds)}
          </span>
        </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/pipeline/VideoCard-needs-edit.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the existing VideoCard tests to confirm no regression**

Run: `npm run test:run -- __tests__/components/admin/content-studio/pipeline`
Expected: PASS (VideoCard, VideoCard-cut, VideoCard-needs-edit, PipelineBoard, etc.).

- [ ] **Step 6: Commit**

```bash
git add components/admin/content-studio/pipeline/VideoCard.tsx __tests__/components/admin/content-studio/pipeline/VideoCard-needs-edit.test.tsx
git commit -m "feat(content-studio): needs-edit badge on the pipeline video card"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — no regressions across DB, API, and component tests.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke (optional, dev server)**

Run: `npm run dev` (port 3050). Upload a video with the toggle **on** → its pipeline card shows "Needs edit". Create a video post for it → it lands in draft (`gated: true`). Render a captioned cut (or click "Mark as ready" in the drawer) → the card shows "Cut" / the badge clears, and scheduling/publishing the post now succeeds.

---

## Self-review notes

- **Spec coverage:** data model (Task 1), gate rule + guard (Task 2), upload toggle + threading (Tasks 3-4), four enforcement chokepoints — create/approve/schedule/publish-now (Tasks 5-7), manual override endpoint + UI (Tasks 8-9), needs-edit badge (Task 10). All spec sections map to a task.
- **No backfill:** Task 1's migration relies on the column default; there is no `update` statement — matches the spec.
- **Type consistency:** `needs_edit: boolean` (Task 1) is used identically in `isVideoPostable`/`assertSourceVideoPostable` (Task 2), the routes (Tasks 5-8), and the components (Tasks 4, 9, 10). The guard return shape `{ ok: true } | { ok: false; reason }` is consumed the same way in every route. `needsEdit` (camelCase) is the API/transport name; `needs_edit` (snake_case) is the DB/row name — kept distinct on purpose at the `POST /api/admin/videos` boundary.
- **Test isolation:** existing create/approve/schedule/publish-now test files get the `@/lib/content-studio/edit-gate` mock so the real guard never reaches Supabase in unit tests.
