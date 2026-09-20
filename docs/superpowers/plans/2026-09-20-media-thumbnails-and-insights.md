# Media Thumbnails + Content Studio Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner set a video's thumbnail (pick a frame or upload an image) across Content Studio and Team Media, and add an Insights tab that reports how the studio is running plus how published work performed.

**Architecture:** Custom thumbnails are written to a per-set unique Storage path and the database row is committed only after the bucket confirms the blob exists — the existing write-ahead-to-a-fixed-path flow stays untouched for auto-captures. Metrics are computed live from existing tables through one pure aggregator (`computeStudioInsights`) with no new table and no new cron; its four empty-state branches keep "not published yet" distinct from a real zero.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role DAL), Firebase Storage (signed v4 URLs), Zod, Vitest, Testing Library, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-09-20-media-thumbnails-and-insights-design.md](../specs/2026-09-20-media-thumbnails-and-insights-design.md)

## Global Constraints

- **Node 24** for every test/build command. Prefix `PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"`. `package.json` pins `engines.node: "24.x"`; the worktree default is Node 20 and vitest misreports under it.
- **Targeted tests only.** `npx vitest run <path>`. Do not run the full suite. A `tsc --noEmit` / `next build` gate is separate and runs once at the end.
- **Baseline is not green.** `tsc --noEmit` reports **238 errors / 54 files** on a clean checkout. Compare the count; do not try to reach zero. Known-red suites: `migrations/00062` ×3, `funnel-builder-initial-prompt` ×3, `coach-reachability` ×1.
- **Never hardcode hex colours.** Use semantic classes (`text-primary`, `bg-surface`, `text-muted-foreground`, `bg-accent`). Admin UI is **light-only** — do not add `dark:` variants.
- **All tables use `components/ui/data-table.tsx`** (`DataTableCard` → `DataTable` → `DataTableHeader`/`DataTableHead`/`DataTableRow`/`DataTableCell`/`DataTableEmpty`, `DataTableBadge` tones `neutral | success | warning | info | danger`). Never hand-roll a `<table>`. `DataTableEmpty` renders its own `<tr>` — do not wrap it in `DataTableRow`.
- **Do not add a `SINGLETON_BUSINESS_ID` reference.** These tables have no `business_id`; that is pre-existing and explicitly out of scope.
- **Migration number:** `00265`. `00264` is the highest on `main` as of 2026-09-20. **Two peer Claude sessions are active on this repo** — re-check `ls supabase/migrations | tail -3` immediately before merge; a collision merges clean and fails at deploy.
- **Commit messages carry no AI attribution.** No `Co-Authored-By`, no "Generated with" footer.

---

### Task 1: Migration + types

**Files:**
- Create: `supabase/migrations/00265_media_thumbnails.sql`
- Modify: `types/database.ts` (`VideoUpload` ~line 1861, `TeamVideoVersion` ~line 194)
- Test: `__tests__/db/video-uploads-thumbnail-source.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VideoUpload.thumbnail_source?: ThumbnailSource | null`, `TeamVideoVersion.thumbnail_path: string | null`, and `export type ThumbnailSource = "auto" | "frame" | "upload"`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00265_media_thumbnails.sql`:

```sql
-- supabase/migrations/00265_media_thumbnails.sql
-- Settable video thumbnails.
--
-- video_uploads.thumbnail_source records HOW the current thumbnail was chosen,
-- so the UI can label it and decide whether "Revert to auto" applies. Null on
-- every pre-existing row, which reads as "auto / unknown" and offers no revert.
--
-- team_video_versions.thumbnail_path gives the Team Media board the preview it
-- has never had. The file lives on the VERSION (team_video_versions.storage_path),
-- not the submission, so the thumbnail belongs here too.
--
-- No CHECK constraint on thumbnail_source on purpose: it is written by exactly
-- one route, which validates with Zod first, and a CHECK would sharpen the
-- one-deploy window where migration and code are out of step for no gain.

ALTER TABLE video_uploads
  ADD COLUMN thumbnail_source text;

COMMENT ON COLUMN video_uploads.thumbnail_source IS
  'How the current thumbnail was chosen: auto (1s canvas grab at upload), frame (operator picked a frame), upload (operator supplied an image). Null = auto/unknown, pre-dates the picker.';

ALTER TABLE team_video_versions
  ADD COLUMN thumbnail_path text;

COMMENT ON COLUMN team_video_versions.thumbnail_path IS
  'Firebase Storage path of a small JPG thumbnail for this cut; null until generated lazily on first view.';
```

- [ ] **Step 2: Apply the migration to dev**

Run via the Supabase MCP `apply_migration` tool (standing instruction: dev migrations are applied automatically), name `00265_media_thumbnails`.

Verify:
```sql
select column_name from information_schema.columns
where table_name='video_uploads' and column_name='thumbnail_source';
select column_name from information_schema.columns
where table_name='team_video_versions' and column_name='thumbnail_path';
```
Expected: one row each.

- [ ] **Step 3: Write the failing test**

Create `__tests__/db/video-uploads-thumbnail-source.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import type { VideoUpload, TeamVideoVersion, ThumbnailSource } from "@/types/database"

describe("thumbnail typing", () => {
  it("accepts a VideoUpload with no thumbnail_source (pre-existing rows)", () => {
    const row = {
      id: "v1",
      storage_path: "videos/a/clip.mp4",
      original_filename: "clip.mp4",
      duration_seconds: 42,
      size_bytes: 1000,
      mime_type: "video/mp4",
      title: null,
      uploaded_by: null,
      status: "uploaded",
      needs_edit: true,
      created_at: "2026-09-20T00:00:00Z",
      updated_at: "2026-09-20T00:00:00Z",
    } satisfies VideoUpload
    expect(row.id).toBe("v1")
  })

  it("accepts each ThumbnailSource value", () => {
    const sources: ThumbnailSource[] = ["auto", "frame", "upload"]
    expect(sources).toHaveLength(3)
  })

  it("allows a null thumbnail_path on a team video version", () => {
    const version = {
      id: "ver1",
      submission_id: "s1",
      version_number: 1,
      storage_path: "team/clip.mp4",
      original_filename: "clip.mp4",
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      image_count: null,
      status: "uploaded",
      uploaded_at: null,
      thumbnail_path: null,
      created_at: "2026-09-20T00:00:00Z",
    } satisfies TeamVideoVersion
    expect(version.thumbnail_path).toBeNull()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/video-uploads-thumbnail-source.test.ts
```
Expected: FAIL — `ThumbnailSource` is not exported, and `thumbnail_path` is not a known property of `TeamVideoVersion`.

- [ ] **Step 5: Add the types**

In `types/database.ts`, immediately above `export interface VideoUpload {`:

```ts
/** How a video's current thumbnail was chosen. Null on rows that pre-date the picker. */
export type ThumbnailSource = "auto" | "frame" | "upload"
```

Inside `VideoUpload`, directly after the `thumbnail_path` field:

```ts
  /**
   * How `thumbnail_path` was chosen. Null means auto/unknown — the row pre-dates
   * the picker — and the UI offers no "Revert to auto" for it. Optional on insert:
   * nullable column, no default.
   */
  thumbnail_source?: ThumbnailSource | null
```

Inside `TeamVideoVersion`, after `image_count`:

```ts
  /** Firebase Storage path of a small JPG thumbnail; null until generated lazily. */
  thumbnail_path: string | null
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/video-uploads-thumbnail-source.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 7: Check you did not break TeamVideoVersion's existing writers**

`thumbnail_path` on `TeamVideoVersion` is **required** (`string | null`, not optional), so every object literal typed as a full `TeamVideoVersion` must now supply it. Find them:

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit 2>&1 | grep -i "teamvideoversion" | head -20
```

If any insert builder breaks, make the field optional instead (`thumbnail_path?: string | null`) — a DB-defaulted/nullable column must not force every `Omit<Row, …>` insert to name it.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00265_media_thumbnails.sql types/database.ts __tests__/db/video-uploads-thumbnail-source.test.ts
git commit -m "feat(media): thumbnail_source on video_uploads, thumbnail_path on team_video_versions"
```

---

### Task 2: One frame encoder, two entry points

**Files:**
- Modify: `lib/firebase-client-thumbnail.ts`
- Test: `__tests__/lib/firebase-client-thumbnail.test.ts`

**Interfaces:**
- Consumes: Task 1's types.
- Produces: `export function captureFrameFromElement(video: HTMLVideoElement): Promise<Blob | null>` — encodes whatever frame is currently displayed, at the same 480px/q0.75 JPEG settings as the auto path. Also `export async function commitThumbnail(videoUploadId: string, blob: Blob, source: "frame" | "upload"): Promise<boolean>` and `export async function revertThumbnailToAuto(videoUploadId: string): Promise<boolean>`.

The existing file has the encode block inlined inside `captureFrame`'s `seeked` listener. Extract it so there is exactly **one** encoder — a second copy would drift from the first.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/firebase-client-thumbnail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { captureFrameFromElement, commitThumbnail, revertThumbnailToAuto } from "@/lib/firebase-client-thumbnail"

function fakeVideoElement(width = 1920, height = 1080): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height, currentTime: 12.5 } as HTMLVideoElement
}

describe("captureFrameFromElement", () => {
  let drawImage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    drawImage = vi.fn()
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return {} as HTMLElement
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/jpeg" })),
      } as unknown as HTMLCanvasElement
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it("encodes the currently displayed frame without seeking", async () => {
    const el = fakeVideoElement()
    const blob = await captureFrameFromElement(el)
    expect(blob).toBeInstanceOf(Blob)
    // It must not move the playhead — the operator chose this frame.
    expect(el.currentTime).toBe(12.5)
    expect(drawImage).toHaveBeenCalled()
  })

  it("caps width at 480 and preserves aspect ratio", async () => {
    await captureFrameFromElement(fakeVideoElement(1920, 1080))
    const [, , , w, h] = drawImage.mock.calls[0] as [unknown, number, number, number, number]
    expect(w).toBe(480)
    expect(h).toBe(270)
  })

  it("returns null when the element has no dimensions yet", async () => {
    const blob = await captureFrameFromElement(fakeVideoElement(0, 0))
    expect(blob).toBeNull()
  })
})

describe("commitThumbnail", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("requests a path, PUTs the bytes, then commits the row", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url.endsWith("/thumbnail/custom")) {
        return new Response(JSON.stringify({ uploadUrl: "https://signed/put", thumbnailPath: "videos/a.mp4.thumb-custom-1.jpg" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    }))

    const ok = await commitThumbnail("v1", new Blob(["x"]), "frame")
    expect(ok).toBe(true)
    expect(calls).toEqual([
      "POST /api/admin/videos/v1/thumbnail/custom",
      "PUT https://signed/put",
      "PUT /api/admin/videos/v1/thumbnail",
    ])
  })

  it("does NOT commit the row when the bytes fail to upload", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url.endsWith("/thumbnail/custom")) {
        return new Response(JSON.stringify({ uploadUrl: "https://signed/put", thumbnailPath: "p.jpg" }), { status: 200 })
      }
      if (url === "https://signed/put") return new Response("nope", { status: 403 })
      return new Response("{}", { status: 200 })
    }))

    const ok = await commitThumbnail("v1", new Blob(["x"]), "frame")
    expect(ok).toBe(false)
    expect(calls).not.toContain("PUT /api/admin/videos/v1/thumbnail")
  })
})

describe("revertThumbnailToAuto", () => {
  it("sends source=auto and no thumbnailPath", async () => {
    let body: unknown
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response("{}", { status: 200 })
    }))
    const ok = await revertThumbnailToAuto("v1")
    expect(ok).toBe(true)
    expect(body).toEqual({ source: "auto" })
  })

  it("returns false when the auto blob is gone (409)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "gone" }), { status: 409 })))
    expect(await revertThumbnailToAuto("v1")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/firebase-client-thumbnail.test.ts
```
Expected: FAIL — `captureFrameFromElement` / `commitThumbnail` / `revertThumbnailToAuto` are not exported.

- [ ] **Step 3: Extract the encoder and add the three functions**

In `lib/firebase-client-thumbnail.ts`, add above `captureFrame`:

```ts
/**
 * Encode the frame a <video> element is CURRENTLY showing to a JPEG Blob.
 * Does not seek — the displayed frame is the operator's choice. Returns null
 * if the element has no decoded dimensions, or the canvas is tainted (remote
 * source without CORS).
 */
export function captureFrameFromElement(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      if (!video.videoWidth || !video.videoHeight) return resolve(null)
      const ratio = video.videoHeight / video.videoWidth
      const width = Math.min(THUMB_MAX_WIDTH, video.videoWidth)
      const height = Math.round(width * ratio)
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) return resolve(null)
      ctx.drawImage(video, 0, 0, width, height)
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", THUMB_JPEG_QUALITY)
    } catch {
      resolve(null)
    }
  })
}
```

Then replace the body of `captureFrame`'s `"seeked"` listener with a delegation, so there is one encoder:

```ts
    video.addEventListener("seeked", () => {
      void captureFrameFromElement(video).then(finish)
    })
```

Append the two upload helpers:

```ts
/**
 * Set a CUSTOM thumbnail: ask for a unique path, PUT the bytes, and only then
 * ask the server to point the row at it. The row is never written before the
 * bytes land — a failed PUT must not destroy a working thumbnail.
 */
export async function commitThumbnail(
  videoUploadId: string,
  blob: Blob,
  source: "frame" | "upload",
): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/videos/${videoUploadId}/thumbnail/custom`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: blob.type || "image/jpeg" }),
    })
    if (!res.ok) return false
    const { uploadUrl, thumbnailPath } = (await res.json()) as {
      uploadUrl: string
      thumbnailPath: string
    }

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    })
    if (!put.ok) return false

    const commit = await fetch(`/api/admin/videos/${videoUploadId}/thumbnail`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thumbnailPath, source }),
    })
    return commit.ok
  } catch {
    return false
  }
}

/**
 * Point the row back at the auto-captured thumbnail. Returns false when the
 * server answers 409 — the original blob no longer exists, so there is nothing
 * to revert to and the custom one is deliberately left in place.
 */
export async function revertThumbnailToAuto(videoUploadId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/videos/${videoUploadId}/thumbnail`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "auto" }),
    })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/firebase-client-thumbnail.test.ts
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Confirm the auto path still behaves identically**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/videos/VideoUploader.test.tsx __tests__/components/admin/team-videos/StatusActions.test.tsx
```
Expected: PASS — the refactor must not change the 1s auto-grab.

- [ ] **Step 6: Commit**

```bash
git add lib/firebase-client-thumbnail.ts __tests__/lib/firebase-client-thumbnail.test.ts
git commit -m "feat(media): single frame encoder plus commit-after-upload thumbnail helpers"
```

---

### Task 3: `POST /api/admin/videos/[id]/thumbnail/custom` — hand out a path, write nothing

**Files:**
- Create: `app/api/admin/videos/[id]/thumbnail/custom/route.ts`
- Create: `lib/validators/video-thumbnail.ts`
- Test: `__tests__/api/admin/video-thumbnail-custom.test.ts`

**Interfaces:**
- Consumes: `getVideoUploadById` from `@/lib/db/video-uploads`, `getAdminStorage` from `@/lib/firebase-admin`, `canAccessAdminPath` from `@/lib/permissions/guard`.
- Produces: `customThumbnailPath(storagePath: string, now: number): string` and `isLegalCustomThumbnailPath(storagePath: string, candidate: string): boolean`, both exported from `lib/validators/video-thumbnail.ts` and reused by Task 4. Response body `{ uploadUrl: string; thumbnailPath: string; expiresInSeconds: number }`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/video-thumbnail-custom.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getVideoMock = vi.fn()
const updateMock = vi.fn()
const getSignedUrlMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: async (u: { role?: string }) => u?.role === "admin" }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoMock(...a),
  updateVideoUpload: (...a: unknown[]) => updateMock(...a),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ getSignedUrl: getSignedUrlMock }) }) }),
}))

import { POST } from "@/app/api/admin/videos/[id]/thumbnail/custom/route"

function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/videos/${id}/thumbnail/custom`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req as never, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/videos/[id]/thumbnail/custom", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    getVideoMock.mockResolvedValue({ id: "v1", storage_path: "videos/u/clip.mp4" })
    getSignedUrlMock.mockResolvedValue(["https://signed/put"])
  })

  it("401 for a non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call("v1", { contentType: "image/jpeg" })).status).toBe(401)
  })

  it("404 when the video does not exist", async () => {
    getVideoMock.mockResolvedValueOnce(null)
    expect((await call("v1", { contentType: "image/jpeg" })).status).toBe(404)
  })

  it("400 for a disallowed content type", async () => {
    expect((await call("v1", { contentType: "application/pdf" })).status).toBe(400)
  })

  it("returns a unique path derived from the video's storage_path", async () => {
    const res = await call("v1", { contentType: "image/jpeg" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toBe("https://signed/put")
    expect(body.thumbnailPath).toMatch(/^videos\/u\/clip\.mp4\.thumb-custom-\d+\.jpg$/)
  })

  it("writes NOTHING to the row — the bytes have not landed yet", async () => {
    await call("v1", { contentType: "image/jpeg" })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("never hands out the auto thumbnail's path", async () => {
    const body = await (await call("v1", { contentType: "image/jpeg" })).json()
    expect(body.thumbnailPath).not.toBe("videos/u/clip.mp4.thumb.jpg")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/admin/video-thumbnail-custom.test.ts
```
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Write the validator**

Create `lib/validators/video-thumbnail.ts`:

```ts
import { z } from "zod"

const ALLOWED_THUMBNAIL_MIME = ["image/jpeg", "image/png", "image/webp"] as const

export const customThumbnailUrlSchema = z.object({
  contentType: z.enum(ALLOWED_THUMBNAIL_MIME),
})

export const commitThumbnailSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("auto") }),
  z.object({
    source: z.enum(["frame", "upload"]),
    thumbnailPath: z.string().min(1, "thumbnailPath is required"),
  }),
])

/** Deterministic path of the auto-captured thumbnail, unchanged since 00088. */
export function autoThumbnailPath(storagePath: string): string {
  return `${storagePath}.thumb.jpg`
}

/**
 * A fresh path per set. A NEW path is what makes a changed thumbnail actually
 * appear: rewriting one path leaves the signed READ URL identical, so browsers
 * keep serving the old image from cache.
 */
export function customThumbnailPath(storagePath: string, now: number): string {
  return `${storagePath}.thumb-custom-${now}.jpg`
}

/**
 * Does `candidate` belong to THIS video? The commit route accepts a path from
 * the client, so without this a caller could point a row at any blob in the
 * bucket.
 */
export function isLegalCustomThumbnailPath(storagePath: string, candidate: string): boolean {
  return /^\d+\.jpg$/.test(candidate.slice(`${storagePath}.thumb-custom-`.length))
    && candidate.startsWith(`${storagePath}.thumb-custom-`)
}
```

- [ ] **Step 4: Write the route**

Create `app/api/admin/videos/[id]/thumbnail/custom/route.ts`:

```ts
// app/api/admin/videos/[id]/thumbnail/custom/route.ts
// POST — issue a signed upload URL for a CUSTOM thumbnail at a fresh path.
//
// Deliberately writes nothing. The sibling PUT .../thumbnail commits the row,
// but only after confirming the blob exists. The older POST .../thumbnail
// still writes ahead of the upload; that is correct for an auto-capture, where
// a failure costs a fallback icon, and wrong here, where it would destroy a
// thumbnail the operator had already set.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { customThumbnailUrlSchema, customThumbnailPath } from "@/lib/validators/video-thumbnail"

const UPLOAD_URL_EXPIRY_MS = 10 * 60 * 1000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const video = await getVideoUploadById(id)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = customThumbnailUrlSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const thumbnailPath = customThumbnailPath(video.storage_path, Date.now())
  const bucket = getAdminStorage().bucket()
  const [uploadUrl] = await bucket.file(thumbnailPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType: parsed.data.contentType,
  })

  return NextResponse.json({
    uploadUrl,
    thumbnailPath,
    expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/admin/video-thumbnail-custom.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/videos/\[id\]/thumbnail/custom/route.ts lib/validators/video-thumbnail.ts __tests__/api/admin/video-thumbnail-custom.test.ts
git commit -m "feat(media): signed-URL route for custom thumbnails that writes no row"
```

---

### Task 4: `PUT /api/admin/videos/[id]/thumbnail` — commit only what exists

**Files:**
- Modify: `app/api/admin/videos/[id]/thumbnail/route.ts` (add `PUT`; leave `POST` untouched)
- Test: `__tests__/api/admin/video-thumbnail-commit.test.ts`

**Interfaces:**
- Consumes: `commitThumbnailSchema`, `autoThumbnailPath`, `isLegalCustomThumbnailPath` from Task 3; `updateVideoUpload`.
- Produces: `PUT` returning `{ thumbnailPath, thumbnailSource }` on 200.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/video-thumbnail-commit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getVideoMock = vi.fn()
const updateMock = vi.fn()
const existsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: async (u: { role?: string }) => u?.role === "admin" }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoMock(...a),
  updateVideoUpload: (...a: unknown[]) => updateMock(...a),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({ file: () => ({ exists: existsMock, getSignedUrl: vi.fn().mockResolvedValue(["https://signed/put"]) }) }),
  }),
}))

import { PUT } from "@/app/api/admin/videos/[id]/thumbnail/route"

const STORAGE = "videos/u/clip.mp4"

function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/videos/${id}/thumbnail`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return PUT(req as never, { params: Promise.resolve({ id }) })
}

describe("PUT /api/admin/videos/[id]/thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    getVideoMock.mockResolvedValue({ id: "v1", storage_path: STORAGE })
    existsMock.mockResolvedValue([true])
    updateMock.mockResolvedValue({ id: "v1" })
  })

  it("401 for a non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call("v1", { source: "frame", thumbnailPath: `${STORAGE}.thumb-custom-1.jpg` })).status).toBe(401)
  })

  it("commits a frame thumbnail once the blob is confirmed present", async () => {
    const path = `${STORAGE}.thumb-custom-1700000000000.jpg`
    const res = await call("v1", { source: "frame", thumbnailPath: path })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith("v1", { thumbnail_path: path, thumbnail_source: "frame" })
  })

  it("409s and writes NOTHING when the blob is missing", async () => {
    existsMock.mockResolvedValue([false])
    const res = await call("v1", { source: "frame", thumbnailPath: `${STORAGE}.thumb-custom-1.jpg` })
    expect(res.status).toBe(409)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("400s on a path belonging to a different video", async () => {
    const res = await call("v1", { source: "upload", thumbnailPath: "videos/someone-else/other.mp4.thumb-custom-1.jpg" })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("400s on a traversal attempt that merely starts with the prefix", async () => {
    const res = await call("v1", { source: "upload", thumbnailPath: `${STORAGE}.thumb-custom-1.jpg/../../secrets.jpg` })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("reverts to the auto path, deriving it server-side", async () => {
    const res = await call("v1", { source: "auto" })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith("v1", {
      thumbnail_path: `${STORAGE}.thumb.jpg`,
      thumbnail_source: "auto",
    })
  })

  it("409s on revert when the auto blob no longer exists, leaving the custom one alone", async () => {
    existsMock.mockResolvedValue([false])
    const res = await call("v1", { source: "auto" })
    expect(res.status).toBe(409)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("400s when source is absent", async () => {
    expect((await call("v1", {})).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/admin/video-thumbnail-commit.test.ts
```
Expected: FAIL — `PUT` is not exported from the route.

- [ ] **Step 3: Add the PUT handler**

Append to `app/api/admin/videos/[id]/thumbnail/route.ts` (leave the existing `POST` exactly as it is):

```ts
/**
 * PUT — point the row at a thumbnail that is ALREADY in the bucket.
 *
 * Two things this must never do:
 *  - write a path the client chose without checking it belongs to this video
 *    (otherwise a row can be pointed at any blob in the bucket);
 *  - write a path whose blob is not there. A signed-URL PUT that did not throw
 *    is not proof the bytes landed, so we ask the bucket rather than the client.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const video = await getVideoUploadById(id)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = commitThumbnailSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const targetPath =
    parsed.data.source === "auto"
      ? autoThumbnailPath(video.storage_path)
      : parsed.data.thumbnailPath

  if (
    parsed.data.source !== "auto" &&
    !isLegalCustomThumbnailPath(video.storage_path, targetPath)
  ) {
    return NextResponse.json({ error: "thumbnailPath does not belong to this video" }, { status: 400 })
  }

  const bucket = getAdminStorage().bucket()
  const [exists] = await bucket.file(targetPath).exists()
  if (!exists) {
    return NextResponse.json(
      {
        error:
          parsed.data.source === "auto"
            ? "The original auto thumbnail is no longer available"
            : "Thumbnail was not uploaded",
      },
      { status: 409 },
    )
  }

  await updateVideoUpload(id, {
    thumbnail_path: targetPath,
    thumbnail_source: parsed.data.source,
  })

  return NextResponse.json({ thumbnailPath: targetPath, thumbnailSource: parsed.data.source })
}
```

Add to the import block at the top of the file:

```ts
import {
  commitThumbnailSchema,
  autoThumbnailPath,
  isLegalCustomThumbnailPath,
} from "@/lib/validators/video-thumbnail"
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/admin/video-thumbnail-commit.test.ts
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-check the two guards**

Apply each mutation, confirm a test goes red, then revert it. **Actually run them — a predicted kill is a guess.**

1. Delete the `if (!exists)` block → the 409 tests must fail.
2. Change `!isLegalCustomThumbnailPath(...)` to `false` → the wrong-video and traversal tests must fail.
3. In `isLegalCustomThumbnailPath`, drop the `/^\d+\.jpg$/` half and keep only `startsWith` → the traversal test must fail. (This is the conjunct that is easy to think redundant.)

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/videos/\[id\]/thumbnail/route.ts __tests__/api/admin/video-thumbnail-commit.test.ts
git commit -m "feat(media): commit a thumbnail only after the bucket confirms the blob"
```

---

### Task 5: The thumbnail picker on the video detail page

**Files:**
- Create: `components/admin/content-studio/detail/ThumbnailPanel.tsx`
- Modify: `components/admin/content-studio/detail/VideoDetailSidebar.tsx`
- Modify: `lib/content-studio/drawer-data.ts` (add `thumbnailUrl` to `DrawerData`)
- Modify: `components/admin/content-studio/detail/VideoDetailPage.tsx` (pass it through)
- Test: `__tests__/components/admin/content-studio/ThumbnailPanel.test.tsx`

**Interfaces:**
- Consumes: `captureFrameFromElement`, `commitThumbnail`, `revertThumbnailToAuto` (Task 2).
- Produces: `<ThumbnailPanel videoUploadId={string} videoRef={React.RefObject<HTMLVideoElement | null>} thumbnailUrl={string | null} thumbnailSource={ThumbnailSource | null | undefined} />`.

The sidebar already renders `<video src={previewUrl} controls>`. Hold a ref to it and hand the same element to the panel — that is the whole mechanism for "use this frame".

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/ThumbnailPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"

const captureMock = vi.fn()
const commitMock = vi.fn()
const revertMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("@/lib/firebase-client-thumbnail", () => ({
  captureFrameFromElement: (...a: unknown[]) => captureMock(...a),
  commitThumbnail: (...a: unknown[]) => commitMock(...a),
  revertThumbnailToAuto: (...a: unknown[]) => revertMock(...a),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

import { ThumbnailPanel } from "@/components/admin/content-studio/detail/ThumbnailPanel"

function renderPanel(overrides: Partial<React.ComponentProps<typeof ThumbnailPanel>> = {}) {
  const videoRef = createRef<HTMLVideoElement>()
  Object.defineProperty(videoRef, "current", {
    value: { videoWidth: 1920, videoHeight: 1080, currentTime: 5 },
    writable: true,
  })
  return render(
    <ThumbnailPanel
      videoUploadId="v1"
      videoRef={videoRef}
      thumbnailUrl="https://signed/thumb.jpg"
      thumbnailSource={null}
      {...overrides}
    />,
  )
}

describe("ThumbnailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captureMock.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }))
    commitMock.mockResolvedValue(true)
    revertMock.mockResolvedValue(true)
  })

  it("shows the current thumbnail", () => {
    renderPanel()
    expect(screen.getByAltText("Current video thumbnail")).toHaveAttribute("src", "https://signed/thumb.jpg")
  })

  it("captures the displayed frame and commits it as source=frame", async () => {
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /use this frame/i }))
    await waitFor(() => expect(commitMock).toHaveBeenCalledWith("v1", expect.any(Blob), "frame"))
    expect(refreshMock).toHaveBeenCalled()
  })

  it("does not refresh when the commit fails", async () => {
    commitMock.mockResolvedValue(false)
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /use this frame/i }))
    await waitFor(() => expect(commitMock).toHaveBeenCalled())
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("offers Revert only when a custom thumbnail is set", () => {
    const { unmount } = renderPanel({ thumbnailSource: "frame" })
    expect(screen.getByRole("button", { name: /revert to auto/i })).toBeInTheDocument()
    unmount()
    renderPanel({ thumbnailSource: null })
    expect(screen.queryByRole("button", { name: /revert to auto/i })).not.toBeInTheDocument()
  })

  it("says so instead of silently doing nothing when the frame cannot be read", async () => {
    captureMock.mockResolvedValue(null)
    const { toast } = await import("sonner")
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /use this frame/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(commitMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/content-studio/ThumbnailPanel.test.tsx
```
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write `ThumbnailPanel.tsx`**

```tsx
"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ImageIcon, Upload, RotateCcw } from "lucide-react"
import type { ThumbnailSource } from "@/types/database"
import {
  captureFrameFromElement,
  commitThumbnail,
  revertThumbnailToAuto,
} from "@/lib/firebase-client-thumbnail"

interface ThumbnailPanelProps {
  videoUploadId: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  thumbnailUrl: string | null
  thumbnailSource: ThumbnailSource | null | undefined
}

const SOURCE_LABEL: Record<ThumbnailSource, string> = {
  auto: "Picked automatically",
  frame: "A frame you chose",
  upload: "An image you uploaded",
}

export function ThumbnailPanel({
  videoUploadId,
  videoRef,
  thumbnailUrl,
  thumbnailSource,
}: ThumbnailPanelProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"frame" | "upload" | "revert" | null>(null)

  const isCustom = thumbnailSource === "frame" || thumbnailSource === "upload"

  async function useThisFrame() {
    const el = videoRef.current
    if (!el) {
      toast.error("The video player isn't ready yet.")
      return
    }
    setBusy("frame")
    try {
      const blob = await captureFrameFromElement(el)
      if (!blob) {
        toast.error("Couldn't read that frame. Try playing the video first, then pause on the frame you want.")
        return
      }
      if (!(await commitThumbnail(videoUploadId, blob, "frame"))) {
        toast.error("Couldn't save that thumbnail. Your old one is still in place.")
        return
      }
      toast.success("Thumbnail updated")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setBusy("upload")
    try {
      if (!(await commitThumbnail(videoUploadId, file, "upload"))) {
        toast.error("Couldn't save that image. Your old thumbnail is still in place.")
        return
      }
      toast.success("Thumbnail updated")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function revert() {
    setBusy("revert")
    try {
      if (!(await revertThumbnailToAuto(videoUploadId))) {
        toast.error("The original picture isn't available any more, so there's nothing to go back to.")
        return
      }
      toast.success("Back to the automatic thumbnail")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <div className="flex items-start gap-3">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt="Current video thumbnail"
            className="size-16 shrink-0 rounded-md object-cover ring-1 ring-border bg-muted"
          />
        ) : (
          <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-border">
            <ImageIcon className="size-6 text-primary/70" strokeWidth={1.5} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-heading text-xs font-semibold text-primary">Thumbnail</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {thumbnailSource ? SOURCE_LABEL[thumbnailSource] : "Picked automatically"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useThisFrame}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-surface/50 disabled:opacity-50"
        >
          <ImageIcon className="size-3.5" strokeWidth={1.75} />
          {busy === "frame" ? "Saving…" : "Use this frame"}
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-surface/50 disabled:opacity-50"
        >
          <Upload className="size-3.5" strokeWidth={1.75} />
          {busy === "upload" ? "Uploading…" : "Upload an image"}
        </button>

        {isCustom && (
          <button
            type="button"
            onClick={revert}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
            {busy === "revert" ? "Reverting…" : "Revert to auto"}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Pause the video on the picture you want, then choose &ldquo;Use this frame&rdquo;.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFilePicked}
        className="hidden"
      />
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/content-studio/ThumbnailPanel.test.tsx
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the sidebar**

In `VideoDetailSidebar.tsx`: add `"use client"` at the top, add `useRef`, attach the ref to the existing `<video>`, accept two new props, and render the panel under the player.

```tsx
"use client"

import { useRef } from "react"
import type { VideoUpload } from "@/types/database"
import { ThumbnailPanel } from "./ThumbnailPanel"
// …existing imports unchanged

interface VideoDetailSidebarProps {
  video: VideoUpload
  previewUrl: string | null
  thumbnailUrl?: string | null
  hasTranscript?: boolean
  splitReelEnabled?: boolean
  reelEditorEnabled?: boolean
}
```

Inside the component:

```tsx
  const videoRef = useRef<HTMLVideoElement>(null)
```

Change the `<video>` to `<video ref={videoRef} src={previewUrl} controls preload="metadata" …>` and insert directly after the closing `</div>` of the player wrapper:

```tsx
      <ThumbnailPanel
        videoUploadId={video.id}
        videoRef={videoRef}
        thumbnailUrl={thumbnailUrl ?? null}
        thumbnailSource={video.thumbnail_source}
      />
```

- [ ] **Step 6: Supply `thumbnailUrl` from the server**

In `lib/content-studio/drawer-data.ts`, add `thumbnailUrl: string | null` to the `DrawerData` interface, sign it alongside `previewUrl` in the existing `Promise.all`, and return it:

```ts
    video.thumbnail_path ? signPreviewUrl(video.thumbnail_path) : Promise.resolve(null),
```

Then pass it through in `VideoDetailPage.tsx`:

```tsx
          <VideoDetailSidebar
            video={video}
            previewUrl={data.previewUrl}
            thumbnailUrl={data.thumbnailUrl}
            …
```

- [ ] **Step 7: Verify the detail page still renders**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/app/content-studio/video-page.test.tsx __tests__/components/admin/content-studio/ThumbnailPanel.test.tsx
```
Expected: PASS. If `video-page.test.tsx` builds a `DrawerData` fixture by hand, add `thumbnailUrl: null` to it.

- [ ] **Step 8: Commit**

```bash
git add components/admin/content-studio/detail lib/content-studio/drawer-data.ts __tests__/components/admin/content-studio/ThumbnailPanel.test.tsx
git commit -m "feat(media): pick a frame or upload an image as the video thumbnail"
```

---

### Task 6: Thumbnails on the Team Media board

**Files:**
- Modify: `lib/db/team-video-submissions.ts` (add `listCurrentVersionsForSubmissions` + `listFirstImageForSubmissions`)
- Create: `lib/team-videos/thumbnails.ts`
- Modify: `app/(admin)/admin/team-media/page.tsx`
- Modify: `components/admin/team-videos/TeamVideoTable.tsx`
- Test: `__tests__/lib/team-videos/thumbnails.test.ts`

**Interfaces:**
- Consumes: `TeamVideoVersion.thumbnail_path` (Task 1).
- Produces: `signSubmissionThumbnails(submissionIds: string[]): Promise<Record<string, string>>` from `lib/team-videos/thumbnails.ts`, keyed by **submission** id.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/team-videos/thumbnails.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getSignedUrlMock = vi.fn()
const versionsMock = vi.fn()
const imagesMock = vi.fn()

vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({ bucket: () => ({ file: (p: string) => ({ getSignedUrl: () => getSignedUrlMock(p) }) }) }),
}))
vi.mock("@/lib/db/team-video-submissions", () => ({
  listCurrentVersionsForSubmissions: (...a: unknown[]) => versionsMock(...a),
  listFirstImageForSubmissions: (...a: unknown[]) => imagesMock(...a),
}))

import { signSubmissionThumbnails } from "@/lib/team-videos/thumbnails"

describe("signSubmissionThumbnails", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSignedUrlMock.mockImplementation(async (p: string) => [`https://signed/${p}`])
    imagesMock.mockResolvedValue(new Map())
  })

  it("keys the result by SUBMISSION id, not version id", async () => {
    versionsMock.mockResolvedValue(new Map([["sub1", { id: "ver1", thumbnail_path: "t/a.jpg", kind: "video" }]]))
    const out = await signSubmissionThumbnails(["sub1"])
    expect(out).toEqual({ sub1: "https://signed/t/a.jpg" })
  })

  it("skips a version with no thumbnail rather than signing null", async () => {
    versionsMock.mockResolvedValue(new Map([["sub1", { id: "ver1", thumbnail_path: null, kind: "video" }]]))
    expect(await signSubmissionThumbnails(["sub1"])).toEqual({})
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it("uses the first image for an image-set submission, not a video frame", async () => {
    versionsMock.mockResolvedValue(new Map([["sub2", { id: "ver2", thumbnail_path: null, kind: "image_set" }]]))
    imagesMock.mockResolvedValue(new Map([["sub2", "team/images/first.png"]]))
    expect(await signSubmissionThumbnails(["sub2"])).toEqual({ sub2: "https://signed/team/images/first.png" })
  })

  it("drops one unsignable path without losing the others", async () => {
    versionsMock.mockResolvedValue(
      new Map([
        ["sub1", { id: "v1", thumbnail_path: "ok.jpg", kind: "video" }],
        ["sub2", { id: "v2", thumbnail_path: "gone.jpg", kind: "video" }],
      ]),
    )
    getSignedUrlMock.mockImplementation(async (p: string) => {
      if (p === "gone.jpg") throw new Error("404")
      return [`https://signed/${p}`]
    })
    expect(await signSubmissionThumbnails(["sub1", "sub2"])).toEqual({ sub1: "https://signed/ok.jpg" })
  })

  it("returns {} for an empty id list without touching storage", async () => {
    expect(await signSubmissionThumbnails([])).toEqual({})
    expect(versionsMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/team-videos/thumbnails.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Add the two DAL reads**

Append to `lib/db/team-video-submissions.ts`:

```ts
export interface CurrentVersionThumb {
  id: string
  thumbnail_path: string | null
  kind: string | null
}

/** submissionId → its current version's id/thumbnail/kind. */
export async function listCurrentVersionsForSubmissions(
  submissionIds: string[],
): Promise<Map<string, CurrentVersionThumb>> {
  if (submissionIds.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("id, kind, current_version_id, team_video_versions!current_version_id(id, thumbnail_path)")
    .in("id", submissionIds)
  if (error) throw error
  const out = new Map<string, CurrentVersionThumb>()
  for (const row of (data ?? []) as Array<{
    id: string
    kind: string | null
    team_video_versions: { id: string; thumbnail_path: string | null } | null
  }>) {
    if (!row.team_video_versions) continue
    out.set(row.id, {
      id: row.team_video_versions.id,
      thumbnail_path: row.team_video_versions.thumbnail_path,
      kind: row.kind,
    })
  }
  return out
}

/** submissionId → storage_path of the position-0 image on its current version. */
export async function listFirstImageForSubmissions(
  submissionIds: string[],
): Promise<Map<string, string>> {
  if (submissionIds.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("id, team_submission_images!inner(storage_path, position, version_id)")
    .in("id", submissionIds)
    .eq("team_submission_images.position", 0)
  if (error) throw error
  const out = new Map<string, string>()
  for (const row of (data ?? []) as Array<{
    id: string
    team_submission_images: Array<{ storage_path: string }>
  }>) {
    const first = row.team_submission_images?.[0]
    if (first) out.set(row.id, first.storage_path)
  }
  return out
}
```

- [ ] **Step 4: Write `lib/team-videos/thumbnails.ts`**

```ts
// lib/team-videos/thumbnails.ts
// Signed READ URLs for the Team Media board, keyed by SUBMISSION id.
//
// A video submission previews its current cut's thumbnail; an image-set
// submission has no video to seek, so it previews its first image. One failed
// signature drops that row's preview and leaves every other row intact — a
// missing blob must never blank the whole board.

import { getAdminStorage } from "@/lib/firebase-admin"
import {
  listCurrentVersionsForSubmissions,
  listFirstImageForSubmissions,
} from "@/lib/db/team-video-submissions"

const SIGNED_URL_TTL_MS = 30 * 60 * 1000

export async function signSubmissionThumbnails(
  submissionIds: string[],
): Promise<Record<string, string>> {
  if (submissionIds.length === 0) return {}

  const [versions, firstImages] = await Promise.all([
    listCurrentVersionsForSubmissions(submissionIds),
    listFirstImageForSubmissions(submissionIds),
  ])

  const wanted: Array<readonly [string, string]> = []
  for (const [submissionId, version] of versions) {
    const path =
      version.kind === "image_set"
        ? firstImages.get(submissionId)
        : version.thumbnail_path
    if (path) wanted.push([submissionId, path] as const)
  }

  const bucket = getAdminStorage().bucket()
  const signed = await Promise.all(
    wanted.map(async ([submissionId, path]) => {
      try {
        const [url] = await bucket.file(path).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        })
        return [submissionId, url] as const
      } catch {
        return null
      }
    }),
  )

  const out: Record<string, string> = {}
  for (const entry of signed) {
    if (entry) out[entry[0]] = entry[1]
  }
  return out
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/team-videos/thumbnails.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 6: Render the column**

In `app/(admin)/admin/team-media/page.tsx`, fetch and pass:

```tsx
  const thumbnails = await signSubmissionThumbnails(submissions.map((s) => s.id))
  …
      <TeamVideoTable submissions={submissions} openNotes={openNotes} thumbnails={thumbnails} />
```

In `TeamVideoTable.tsx`, add `thumbnails?: Record<string, string>` to `Props`, add a leading `<DataTableHead className="w-20">Preview</DataTableHead>`, and as the first `<DataTableCell>` of each row:

```tsx
                <DataTableCell>
                  {thumbnails?.[s.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnails[s.id]}
                      alt=""
                      loading="lazy"
                      className="h-10 w-16 rounded object-cover ring-1 ring-border bg-muted"
                    />
                  ) : (
                    <span className="inline-flex h-10 w-16 items-center justify-center rounded bg-primary/10 ring-1 ring-border">
                      <Film className="size-4 text-primary/70" strokeWidth={1.5} />
                    </span>
                  )}
                </DataTableCell>
```

Import `Film` from `lucide-react`. **Bump the `colSpan` on the existing `DataTableEmpty` by one** — it renders its own `<tr>` and a stale `colSpan` makes the empty row span the wrong width.

- [ ] **Step 7: Verify the board still renders**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/team-videos __tests__/lib/db/team-video-submissions.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/team-videos/thumbnails.ts lib/db/team-video-submissions.ts "app/(admin)/admin/team-media/page.tsx" components/admin/team-videos/TeamVideoTable.tsx __tests__/lib/team-videos/thumbnails.test.ts
git commit -m "feat(media): previews on the Team Media board"
```

---

### Task 7: `computeStudioInsights` — the pure aggregator

**Files:**
- Create: `lib/content-studio/insights.ts`
- Test: `__tests__/lib/content-studio/insights.test.ts`

**Interfaces:**
- Consumes: `VideoUpload`, `SocialPost`, `SocialAnalytics`, `MediaAsset`, `TeamVideoSubmission`, `PlatformConnection` from `@/types/database`.
- Produces:

```ts
export type PerformanceState =
  | { kind: "not_published" }
  | { kind: "awaiting_sync"; publishedAt: string }
  | { kind: "not_connected"; platform: SocialPlatform }
  | { kind: "measured"; views: number; likes: number; comments: number; shares: number }

/** Named ...Summary, not VideoPerformance — Task 9 adds a COMPONENT by that name. */
export interface VideoPerformanceSummary {
  videoId: string
  state: PerformanceState
  perPost: Array<{ postId: string; platform: SocialPlatform; state: PerformanceState }>
}

export interface StudioInsightsInput {
  now: Date
  videos: VideoUpload[]
  posts: SocialPost[]
  analytics: SocialAnalytics[]
  assets: MediaAsset[]
  submissions: TeamVideoSubmission[]
  /** plugin_name of every connection whose status is 'connected'. */
  connectedPlatforms: Set<string>
  periodDays: number
}

export interface StudioInsights {
  production: {
    videosUploaded: number
    videosUploadedPrevious: number
    postsByStage: Record<string, number>
    videosBlockedByEditGate: number
    assetsByKind: Record<string, number>
    assetBytes: number
    teamSubmissionsByStatus: Record<string, number>
    oldestInStage: Array<{ stage: string; ageDays: number; label: string }>
  }
  performance: {
    videos: VideoPerformanceSummary[]
    totals: { views: number; likes: number; comments: number; shares: number }
    measuredPostCount: number
  }
}

export function computeStudioInsights(input: StudioInsightsInput): StudioInsights
```

No `Date.now()` inside — `input.now: Date` is passed in, so ages are deterministic under test.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/insights.test.ts`. The empty-state table is the point of this suite:

```ts
import { describe, it, expect } from "vitest"
import { computeStudioInsights } from "@/lib/content-studio/insights"
import type { SocialPost, SocialAnalytics, VideoUpload } from "@/types/database"

const NOW = new Date("2026-09-20T12:00:00Z")

function video(over: Partial<VideoUpload> = {}): VideoUpload {
  return {
    id: "v1", storage_path: "p.mp4", original_filename: "p.mp4", duration_seconds: 30,
    size_bytes: 1000, mime_type: "video/mp4", title: null, uploaded_by: null,
    status: "analyzed", needs_edit: false,
    created_at: "2026-09-19T12:00:00Z", updated_at: "2026-09-19T12:00:00Z", ...over,
  } as VideoUpload
}

function post(over: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "p1", platform: "instagram", content: "hi", media_url: null, post_type: "reel",
    approval_status: "draft", scheduled_at: null, published_at: null, source_video_id: "v1",
    rejection_notes: null, platform_post_id: null, created_by: null,
    created_at: "2026-09-19T12:00:00Z", updated_at: "2026-09-19T12:00:00Z", ...over,
  } as SocialPost
}

function base(over: Partial<Parameters<typeof computeStudioInsights>[0]> = {}) {
  return {
    now: NOW, videos: [], posts: [], analytics: [], assets: [], submissions: [],
    connectedPlatforms: new Set(["instagram", "youtube"]),
    periodDays: 30, ...over,
  }
}

describe("performance empty states — a zero and an absence are different answers", () => {
  it("not_published when the video has no published post", () => {
    const out = computeStudioInsights(base({ videos: [video()], posts: [post()] }))
    expect(out.performance.videos[0].state).toEqual({ kind: "not_published" })
  })

  it("awaiting_sync when published but no snapshot exists", () => {
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
    }))
    expect(out.performance.videos[0].state).toEqual({
      kind: "awaiting_sync", publishedAt: "2026-09-19T12:00:00Z",
    })
  })

  it("not_connected takes priority over awaiting_sync", () => {
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ platform: "linkedin", approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
      connectedPlatforms: new Set(["instagram"]),
    }))
    expect(out.performance.videos[0].perPost[0].state).toEqual({ kind: "not_connected", platform: "linkedin" })
  })

  it("measured — and a real zero stays a zero, not an empty state", () => {
    const analytics = [{
      id: "a1", social_post_id: "p1", platform: "instagram", platform_post_id: "abc",
      impressions: 0, engagement: 0, likes: 0, comments: 0, shares: 0, views: 0,
      extra: null, recorded_at: "2026-09-20T03:00:00Z", created_at: "2026-09-20T03:00:00Z",
    }] as SocialAnalytics[]
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
      analytics,
    }))
    expect(out.performance.videos[0].state).toEqual({
      kind: "measured", views: 0, likes: 0, comments: 0, shares: 0,
    })
  })

  it("uses the LATEST snapshot per post, never the sum", () => {
    const analytics = [
      { id: "a1", social_post_id: "p1", platform: "instagram", platform_post_id: "abc", impressions: null, engagement: null, likes: 5, comments: 0, shares: 0, views: 100, extra: null, recorded_at: "2026-09-18T03:00:00Z", created_at: "" },
      { id: "a2", social_post_id: "p1", platform: "instagram", platform_post_id: "abc", impressions: null, engagement: null, likes: 9, comments: 0, shares: 0, views: 250, extra: null, recorded_at: "2026-09-20T03:00:00Z", created_at: "" },
    ] as SocialAnalytics[]
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
      analytics,
    }))
    expect(out.performance.videos[0].state).toEqual({ kind: "measured", views: 250, likes: 9, comments: 0, shares: 0 })
    expect(out.performance.totals.views).toBe(250)
  })
})

describe("production band", () => {
  it("counts this period against the previous one", () => {
    const out = computeStudioInsights(base({
      videos: [
        video({ id: "recent", created_at: "2026-09-15T00:00:00Z" }),
        video({ id: "older", created_at: "2026-08-15T00:00:00Z" }),
      ],
      periodDays: 30,
    }))
    expect(out.production.videosUploaded).toBe(1)
    expect(out.production.videosUploadedPrevious).toBe(1)
  })

  it("counts videos held by the edit gate", () => {
    const out = computeStudioInsights(base({
      videos: [video({ id: "a", needs_edit: true }), video({ id: "b", needs_edit: false })],
    }))
    expect(out.production.videosBlockedByEditGate).toBe(1)
  })

  it("reports the oldest item per stage in whole days", () => {
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ id: "old", created_at: "2026-09-05T12:00:00Z" })],
    }))
    const draft = out.production.oldestInStage.find((s) => s.stage === "draft")
    expect(draft?.ageDays).toBe(15)
  })

  it("returns zeroes, not a crash, on entirely empty input", () => {
    const out = computeStudioInsights(base())
    expect(out.production.videosUploaded).toBe(0)
    expect(out.performance.videos).toEqual([])
    expect(out.performance.measuredPostCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/content-studio/insights.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/content-studio/insights.ts`**

Pure: no Supabase, no Firebase, no `Date.now()`. Header comment must state why the empty states are separate:

```ts
// lib/content-studio/insights.ts
// Pure aggregator for the Content Studio Insights tab. Rows in, numbers out —
// no I/O and no Date.now(), so every branch is reachable from a fixture.
//
// The four PerformanceState variants exist because production has zero
// published posts. Collapsing "nothing published", "published but not yet
// synced", "platform not connected" and "measured, genuinely zero" into a
// single 0 would make an untouched dashboard look like a failing one — and
// would keep looking fine for months after it broke.
```

Resolution order per post, which the tests pin:
1. not published → `not_published`
2. platform not in `connectedPlatforms` → `not_connected`
3. no snapshot for the post → `awaiting_sync`
4. otherwise → `measured` from the **max `recorded_at`** snapshot

A video's own state is `measured` if any post is measured (summing the measured posts); otherwise the state of its first post; `not_published` when it has none.

Full body:

```ts
function statePerPost(
  post: SocialPost,
  latest: Map<string, SocialAnalytics>,
  connected: Set<string>,
): PerformanceState {
  if (post.approval_status !== "published" || !post.published_at) {
    return { kind: "not_published" }
  }
  if (!connected.has(post.platform)) {
    return { kind: "not_connected", platform: post.platform }
  }
  const snap = latest.get(post.id)
  if (!snap) {
    return { kind: "awaiting_sync", publishedAt: post.published_at }
  }
  return {
    kind: "measured",
    views: snap.views ?? 0,
    likes: snap.likes ?? 0,
    comments: snap.comments ?? 0,
    shares: snap.shares ?? 0,
  }
}

export function computeStudioInsights(input: StudioInsightsInput): StudioInsights {
  const { now, videos, posts, analytics, assets, submissions, connectedPlatforms, periodDays } = input
  const periodMs = periodDays * 86_400_000
  const periodStart = new Date(now.getTime() - periodMs)
  const previousStart = new Date(now.getTime() - periodMs * 2)

  // Latest snapshot per post. Snapshots are cumulative totals, not deltas —
  // summing them would multiply every view count by the number of sync runs.
  const latest = new Map<string, SocialAnalytics>()
  for (const row of analytics) {
    const existing = latest.get(row.social_post_id)
    if (!existing || new Date(row.recorded_at) > new Date(existing.recorded_at)) {
      latest.set(row.social_post_id, row)
    }
  }

  const postsByVideo = new Map<string, SocialPost[]>()
  for (const p of posts) {
    if (!p.source_video_id) continue
    const list = postsByVideo.get(p.source_video_id) ?? []
    list.push(p)
    postsByVideo.set(p.source_video_id, list)
  }

  const totals = { views: 0, likes: 0, comments: 0, shares: 0 }
  let measuredPostCount = 0

  const perVideo: VideoPerformanceSummary[] = videos.map((v) => {
    const own = postsByVideo.get(v.id) ?? []
    const perPost = own.map((p) => ({
      postId: p.id,
      platform: p.platform,
      state: statePerPost(p, latest, connectedPlatforms),
    }))

    const measured = perPost.filter(
      (p): p is typeof p & { state: Extract<PerformanceState, { kind: "measured" }> } =>
        p.state.kind === "measured",
    )

    let state: PerformanceState
    if (measured.length > 0) {
      const agg = { views: 0, likes: 0, comments: 0, shares: 0 }
      for (const m of measured) {
        agg.views += m.state.views
        agg.likes += m.state.likes
        agg.comments += m.state.comments
        agg.shares += m.state.shares
      }
      state = { kind: "measured", ...agg }
      totals.views += agg.views
      totals.likes += agg.likes
      totals.comments += agg.comments
      totals.shares += agg.shares
      measuredPostCount += measured.length
    } else {
      state = perPost[0]?.state ?? { kind: "not_published" }
    }

    return { videoId: v.id, state, perPost }
  })

  const postsByStage: Record<string, number> = {}
  const oldestByStage = new Map<string, string>()
  for (const p of posts) {
    postsByStage[p.approval_status] = (postsByStage[p.approval_status] ?? 0) + 1
    const current = oldestByStage.get(p.approval_status)
    if (!current || new Date(p.created_at) < new Date(current)) {
      oldestByStage.set(p.approval_status, p.created_at)
    }
  }

  const assetsByKind: Record<string, number> = {}
  let assetBytes = 0
  for (const a of assets) {
    assetsByKind[a.kind] = (assetsByKind[a.kind] ?? 0) + 1
    assetBytes += a.bytes ?? 0
  }

  const teamSubmissionsByStatus: Record<string, number> = {}
  for (const s of submissions) {
    teamSubmissionsByStatus[s.status] = (teamSubmissionsByStatus[s.status] ?? 0) + 1
  }

  const STAGE_LABEL: Record<string, string> = {
    draft: "Drafts", edited: "Edited", approved: "Approved", scheduled: "Scheduled",
    published: "Published", rejected: "Rejected", awaiting_connection: "Waiting on a connection",
    failed: "Failed",
  }

  return {
    production: {
      videosUploaded: videos.filter((v) => new Date(v.created_at) >= periodStart).length,
      videosUploadedPrevious: videos.filter((v) => {
        const t = new Date(v.created_at)
        return t >= previousStart && t < periodStart
      }).length,
      postsByStage,
      videosBlockedByEditGate: videos.filter((v) => v.needs_edit).length,
      assetsByKind,
      assetBytes,
      teamSubmissionsByStatus,
      oldestInStage: Array.from(oldestByStage.entries())
        .map(([stage, iso]) => ({
          stage,
          ageDays: Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000),
          label: STAGE_LABEL[stage] ?? stage,
        }))
        .sort((a, b) => b.ageDays - a.ageDays),
    },
    performance: { videos: perVideo, totals, measuredPostCount },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/content-studio/insights.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutation-check the empty-state ladder**

Run each, confirm red, revert:
1. Return `{ kind: "measured", views: 0, likes: 0, comments: 0, shares: 0 }` for the not-published branch → the `not_published` test must fail.
2. Move the `not_connected` check below `awaiting_sync` → the priority test must fail.
3. Replace "latest snapshot" with a sum → the latest-snapshot test must fail.
4. Change `>=` to `>` on the period boundary → the period test must fail.

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/insights.ts __tests__/lib/content-studio/insights.test.ts
git commit -m "feat(content-studio): insights aggregator with four distinct performance states"
```

---

### Task 8: The Insights tab

**Files:**
- Create: `lib/content-studio/insights-data.ts`
- Create: `components/admin/content-studio/insights/InsightsTab.tsx`
- Create: `components/admin/content-studio/insights/StatTile.tsx`
- Modify: `components/admin/content-studio/TabSwitcher.tsx`
- Modify: `app/(admin)/admin/content/page.tsx`
- Test: `__tests__/components/admin/content-studio/InsightsTab.test.tsx`

**Interfaces:**
- Consumes: `computeStudioInsights`, `StudioInsights` (Task 7).
- Produces: `getInsightsData(): Promise<StudioInsights>`; `<InsightsTab data={StudioInsights} />`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/InsightsTab.test.tsx`:

```tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { InsightsTab } from "@/components/admin/content-studio/insights/InsightsTab"
import type { StudioInsights } from "@/lib/content-studio/insights"

function data(over: Partial<StudioInsights> = {}): StudioInsights {
  return {
    production: {
      videosUploaded: 9, videosUploadedPrevious: 4,
      postsByStage: { draft: 54, published: 0 },
      videosBlockedByEditGate: 2,
      assetsByKind: { image: 7 }, assetBytes: 1_500_000,
      teamSubmissionsByStatus: { submitted: 3 },
      oldestInStage: [{ stage: "draft", ageDays: 15, label: "Drafts" }],
    },
    performance: { videos: [], totals: { views: 0, likes: 0, comments: 0, shares: 0 }, measuredPostCount: 0 },
    ...over,
  }
}

describe("InsightsTab", () => {
  it("shows production counts that work today", () => {
    render(<InsightsTab data={data()} />)
    expect(screen.getByText("9")).toBeInTheDocument()
    expect(screen.getByText(/54/)).toBeInTheDocument()
  })

  it("says nothing is published yet instead of showing a zero view count", () => {
    render(<InsightsTab data={data()} />)
    expect(screen.getByText(/nothing has been published yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/^0 views$/i)).not.toBeInTheDocument()
  })

  it("shows real numbers once posts are measured", () => {
    render(<InsightsTab data={data({
      performance: { videos: [], totals: { views: 1234, likes: 56, comments: 7, shares: 8 }, measuredPostCount: 3 },
    })} />)
    expect(screen.getByText("1,234")).toBeInTheDocument()
    expect(screen.queryByText(/nothing has been published yet/i)).not.toBeInTheDocument()
  })

  it("flags what is stuck", () => {
    render(<InsightsTab data={data()} />)
    expect(screen.getByText(/15 days/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/content-studio/InsightsTab.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `insights-data.ts`**

```ts
// lib/content-studio/insights-data.ts
// I/O half of the Insights tab. Fetch rows, hand them to the pure aggregator.
// Deliberately NOT a snapshot table + cron: social_analytics already IS the
// time series, and with this library's size there is nothing to cache.

import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline } from "@/lib/db/social-posts"
import { listSocialAnalyticsInRange } from "@/lib/db/social-analytics"
import { listMediaAssets } from "@/lib/db/media-assets"
import { listAllSubmissions } from "@/lib/db/team-video-submissions"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { computeStudioInsights, type StudioInsights } from "./insights"

const PERIOD_DAYS = 30

export async function getInsightsData(): Promise<StudioInsights> {
  const now = new Date()
  const from = new Date(now.getTime() - PERIOD_DAYS * 2 * 86_400_000)

  const [videos, posts, analytics, assets, submissions, connections] = await Promise.all([
    listVideoUploads({ limit: 500 }),
    listSocialPostsForPipeline(),
    listSocialAnalyticsInRange(from, now),
    listMediaAssets({}),
    listAllSubmissions(),
    listPlatformConnections(),
  ])

  const connectedPlatforms = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.plugin_name),
  )

  return computeStudioInsights({
    now, videos, posts, analytics, assets, submissions,
    connectedPlatforms, periodDays: PERIOD_DAYS,
  })
}
```

Check each import's real signature before writing; adjust names to match. `listSocialPostsForPipeline` returns `PipelinePostRow[]` — if that is narrower than `SocialPost`, widen the aggregator's input type to the fields it actually reads rather than casting.

- [ ] **Step 4: Write `StatTile.tsx` and `InsightsTab.tsx`**

`StatTile` — label, value, optional delta vs previous period, no hardcoded colours:

```tsx
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl text-primary tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
```

`InsightsTab` renders two bands. The performance band branches on `measuredPostCount === 0`:

```tsx
        {data.performance.measuredPostCount === 0 ? (
          <div className="rounded-xl border border-border bg-surface/30 p-6 text-center">
            <p className="font-body text-sm text-primary">Nothing has been published yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              View and like counts appear here once your posts go live. Approve a post and schedule
              it, and the numbers arrive after the next nightly update.
            </p>
          </div>
        ) : (
          …tiles for views / likes / comments / shares, formatted with toLocaleString()
        )}
```

Copy rules: write for a non-programmer. No "sync", "pipeline", "aggregate", "impressions" without explanation. "The jobs sitting in draft the longest", not "max age by stage".

- [ ] **Step 5: Add the tab**

In `TabSwitcher.tsx`, add `{ id: "insights", label: "Insights", icon: BarChart3 }` to `TABS`, import `BarChart3` from `lucide-react`, and extend `getActiveTab`'s guard:

```ts
  if (tab === "calendar" || tab === "videos" || tab === "posts" || tab === "assets" || tab === "insights") return tab
```

In `app/(admin)/admin/content/page.tsx`, add a case **before** `const data = await getPipelineData()` so the Insights tab does not pay for pipeline data it never renders:

```tsx
  if (tab === "insights") {
    const insights = await getInsightsData()
    return <InsightsTab data={insights} />
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/content-studio/InsightsTab.test.tsx __tests__/lib/content-studio
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/content-studio/insights-data.ts components/admin/content-studio/insights components/admin/content-studio/TabSwitcher.tsx "app/(admin)/admin/content/page.tsx" __tests__/components/admin/content-studio/InsightsTab.test.tsx
git commit -m "feat(content-studio): Insights tab"
```

---

### Task 9: Performance on the video detail page

**Files:**
- Create: `components/admin/content-studio/detail/VideoPerformance.tsx`
- Modify: `components/admin/content-studio/detail/VideoDetailPage.tsx`
- Modify: `lib/content-studio/drawer-data.ts`
- Test: `__tests__/components/admin/content-studio/VideoPerformance.test.tsx`

**Interfaces:**
- Consumes: `VideoPerformanceSummary` type and `computeStudioInsights` (Task 7); `DrawerData` (Task 5).
- Produces: `<VideoPerformance performance={VideoPerformanceSummary | null} />` — the COMPONENT is `VideoPerformance`, the TYPE is `VideoPerformanceSummary`. Do not let them collide.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/VideoPerformance.test.tsx`, covering **all four** states, each asserting the message a non-programmer would read:

```tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideoPerformance } from "@/components/admin/content-studio/detail/VideoPerformance"

describe("VideoPerformance", () => {
  it("not published yet", () => {
    render(<VideoPerformance performance={{ videoId: "v1", state: { kind: "not_published" }, perPost: [] }} />)
    expect(screen.getByText(/isn't published yet/i)).toBeInTheDocument()
  })

  it("published, waiting for the first numbers", () => {
    render(<VideoPerformance performance={{
      videoId: "v1", state: { kind: "awaiting_sync", publishedAt: "2026-09-19T12:00:00Z" },
      perPost: [],
    }} />)
    expect(screen.getByText(/first numbers/i)).toBeInTheDocument()
  })

  it("names the platform that isn't connected", () => {
    render(<VideoPerformance performance={{
      videoId: "v1", state: { kind: "not_connected", platform: "linkedin" },
      perPost: [],
    }} />)
    expect(screen.getByText(/linkedin/i)).toBeInTheDocument()
  })

  it("shows a real zero as a zero", () => {
    render(<VideoPerformance performance={{
      videoId: "v1",
      state: { kind: "measured", views: 0, likes: 0, comments: 0, shares: 0 },
      perPost: [],
    }} />)
    expect(screen.getByText("0")).toBeInTheDocument()
    expect(screen.queryByText(/isn't published yet/i)).not.toBeInTheDocument()
  })

  it("renders nothing when there is no performance record at all", () => {
    const { container } = render(<VideoPerformance performance={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/content-studio/VideoPerformance.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

A `switch` on `performance.state.kind` with an explicit arm per variant. Copy, verbatim:

- `not_published` → "This video isn't published yet. Once its posts go live, you'll see how they did here."
- `awaiting_sync` → "Published {date}. The first numbers arrive overnight."
- `not_connected` → "{Platform} isn't connected, so we can't read its numbers."
- `measured` → four figures with `toLocaleString()`, labelled Views / Likes / Comments / Shares.

Give the union an exhaustiveness arm (`const _never: never = state`) — this repo has already shipped a missing-variant bug that compiled clean.

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/admin/content-studio/VideoPerformance.test.tsx
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the detail page**

Add `performance: VideoPerformanceSummary | null` to `DrawerData`, computed in `getDrawerData` by calling `computeStudioInsights` scoped to this one video and taking `performance.videos[0] ?? null`. Then in `VideoDetailPage.tsx`, between the Posts and Details sections:

```tsx
          <section aria-labelledby="performance-heading">
            <h2 id="performance-heading" className={SECTION_HEADING}>
              Performance
            </h2>
            <VideoPerformance performance={data.performance} />
          </section>
```

- [ ] **Step 6: Run the page test**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/app/content-studio/video-page.test.tsx
```
Expected: PASS. Add `performance: null` to any hand-built `DrawerData` fixture.

- [ ] **Step 7: Commit**

```bash
git add components/admin/content-studio/detail lib/content-studio/drawer-data.ts __tests__/components/admin/content-studio/VideoPerformance.test.tsx
git commit -m "feat(content-studio): per-video performance with honest empty states"
```

---

### Task 10: Whole-branch verification

- [ ] **Step 1: Type-check and compare against the baseline**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit 2>&1 | tee /tmp/tsc.txt | tail -3
grep -c "error TS" /tmp/tsc.txt
```
Expected: **238 errors / 54 files**. A *falling* count hides new errors too — diff the file list against `main`, do not just compare totals.

- [ ] **Step 2: Build**

```bash
rm -rf .next/dev
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npm run build 2>&1 | tail -20
```
Expected: exit 0. `rm -rf .next/dev` first — stale generated route types read as real type errors.

- [ ] **Step 3: Run every suite this branch touched**

```bash
PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run \
  __tests__/db/video-uploads-thumbnail-source.test.ts \
  __tests__/lib/firebase-client-thumbnail.test.ts \
  __tests__/api/admin/video-thumbnail-custom.test.ts \
  __tests__/api/admin/video-thumbnail-commit.test.ts \
  __tests__/components/admin/content-studio \
  __tests__/lib/content-studio \
  __tests__/lib/team-videos \
  __tests__/components/admin/team-videos \
  __tests__/app/content-studio \
  __tests__/api/admin/videos.test.ts \
  __tests__/api/admin/videos-mark-ready.test.ts \
  __tests__/components/admin/videos
```
Expected: all green. Run them **together** — a suite selection that omits one is how a red test hides.

- [ ] **Step 4: Re-check the migration number**

```bash
git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | tail -3
```
If `00265` is taken on `origin/main`, renumber to the next free value and re-apply to dev under the new number — Supabase keys on the version number, so editing an applied migration leaves dev stale.

- [ ] **Step 5: Confirm no AI attribution crept into any commit**

```bash
git log origin/main..HEAD --format='%B' | grep -i "co-authored-by\|generated with\|claude" || echo "clean"
```
Expected: `clean`.
