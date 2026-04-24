# Content Studio Multimedia — Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship single-image posting for Instagram and Facebook via the existing content-studio pipeline. Admins can upload a photo, attach a caption, and publish/schedule it exactly like a video post — no plugin code changes required.

**Architecture:** Reuse the Firebase Storage signed-upload pattern used for videos. Add a `media_assets`-first upload route that creates the asset row, returns a signed PUT URL, and lets the client upload the bytes directly. The `ManualPostDialog` grows a Video/Photo picker; choosing Photo swaps in an `ImageUploader`. The create-post API route accepts `postType` + `mediaAssetId`, creates the post, and calls `attachMedia` — the Phase 0 mirror trigger populates `social_posts.media_url` automatically. `resolve-media-url.ts` gains a Firebase-path branch so image posts get a signed READ URL at publish time the same way videos do. Both the Instagram and Facebook plugins already branch on URL extension and need zero changes.

**Tech Stack:** Next.js 16 App Router, Firebase Storage (not Supabase Storage — see spec §2), Supabase PostgreSQL, Zod validators, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-04-24-content-studio-multimedia-phase1-design.md](../specs/2026-04-24-content-studio-multimedia-phase1-design.md)

---

## File structure

**Create:**
- `lib/validators/media-asset.ts` — Zod schemas for upload-url payload + patch payload + create-post payload extension
- `app/api/admin/media-assets/upload-url/route.ts` — POST route: issues signed Firebase PUT URL + creates `media_assets` row
- `app/api/admin/media-assets/[id]/route.ts` — PATCH route: updates width/height/mime_type/bytes after upload
- `components/admin/content-studio/upload/ImageUploader.tsx` — client component parallel to `VideoUploader`
- `lib/content-studio/post-type-support.ts` — pure function mapping `(platform, postType) → boolean` used by the API route and by UI hiding
- `__tests__/lib/validators/media-asset.test.ts`
- `__tests__/lib/content-studio/post-type-support.test.ts`
- `__tests__/api/admin/media-assets/upload-url.test.ts`
- `__tests__/api/admin/media-assets/patch.test.ts`
- `__tests__/api/admin/content-studio/posts-image.test.ts` — dedicated test for the image path

**Modify:**
- `lib/firebase-client-upload.ts` — add `uploadImageFile(file, options)` and rename/add-export the inner helpers so both video and image share the signed-PUT plumbing
- `lib/content-studio/feature-flag.ts` — add `isContentStudioMultimediaEnabled()`
- `lib/social/resolve-media-url.ts` — detect non-http `media_url` values, treat them as Firebase storage paths, return signed READ URL
- `app/api/admin/content-studio/posts/route.ts` — accept `postType`, `mediaAssetId`; validate via `post-type-support.ts`; call `attachMedia` on the image path; feature-flag gate
- `components/admin/content-studio/calendar/ManualPostDialog.tsx` — add content-type picker + image uploader slot (feature-flag gated)
- `components/admin/content-studio/pipeline/PostCard.tsx` — small content-type badge (image|video)
- `components/admin/content-studio/pipeline/VideoCard.tsx` — same badge
- `components/admin/content-studio/calendar/PostChip.tsx` — same badge

---

## Task 1: Zod validators for the image flow

**Files:**
- Create: `lib/validators/media-asset.ts`
- Create: `__tests__/lib/validators/media-asset.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/validators/media-asset.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  mediaAssetUploadUrlSchema,
  mediaAssetPatchSchema,
} from "@/lib/validators/media-asset"

describe("mediaAssetUploadUrlSchema", () => {
  it("accepts a valid image/jpeg upload request", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "squat.jpg",
      contentType: "image/jpeg",
    })
    expect(result.success).toBe(true)
  })

  it("rejects non-image mime types", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "squat.mp4",
      contentType: "video/mp4",
    })
    expect(result.success).toBe(false)
  })

  it("rejects filenames that don't look like images", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "squat.mp4",
      contentType: "image/jpeg",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty filename", () => {
    const result = mediaAssetUploadUrlSchema.safeParse({
      filename: "",
      contentType: "image/jpeg",
    })
    expect(result.success).toBe(false)
  })
})

describe("mediaAssetPatchSchema", () => {
  it("accepts partial dimension metadata", () => {
    const result = mediaAssetPatchSchema.safeParse({
      width: 1080,
      height: 1080,
      bytes: 123456,
    })
    expect(result.success).toBe(true)
  })

  it("accepts an empty patch (all fields optional)", () => {
    const result = mediaAssetPatchSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("rejects negative bytes", () => {
    const result = mediaAssetPatchSchema.safeParse({ bytes: -1 })
    expect(result.success).toBe(false)
  })
})
```

Run: `npm run test:run -- __tests__/lib/validators/media-asset.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement the validators**

Create `lib/validators/media-asset.ts`:

```ts
import { z } from "zod"

const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i

export const mediaAssetUploadUrlSchema = z.object({
  filename: z
    .string()
    .min(1, "filename is required")
    .max(200, "filename too long")
    .refine((v) => IMAGE_EXTENSIONS.test(v), "filename must end in .jpg, .jpeg, .png, or .webp"),
  contentType: z.enum(ALLOWED_IMAGE_MIME),
})

export type MediaAssetUploadUrlPayload = z.infer<typeof mediaAssetUploadUrlSchema>

export const mediaAssetPatchSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  mime_type: z.string().min(1).optional(),
})

export type MediaAssetPatchPayload = z.infer<typeof mediaAssetPatchSchema>
```

Run: `npm run test:run -- __tests__/lib/validators/media-asset.test.ts`
Expected: 7/7 pass.

- [ ] **Step 3: Commit**

```bash
git add lib/validators/media-asset.ts __tests__/lib/validators/media-asset.test.ts
git commit -m "feat(content-studio): zod validators for media asset upload flow"
```

---

## Task 2: `(platform, postType)` support matrix

**Files:**
- Create: `lib/content-studio/post-type-support.ts`
- Create: `__tests__/lib/content-studio/post-type-support.test.ts`

Encapsulates which post types each platform accepts in Phase 1a. Used by the API route and (eventually) by UI hiding.

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/content-studio/post-type-support.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"

describe("isPlatformPostTypeSupported", () => {
  it("accepts instagram + video (existing)", () => {
    expect(isPlatformPostTypeSupported("instagram", "video")).toBe(true)
  })

  it("accepts instagram + image (new in Phase 1a)", () => {
    expect(isPlatformPostTypeSupported("instagram", "image")).toBe(true)
  })

  it("rejects instagram + text (IG requires media)", () => {
    expect(isPlatformPostTypeSupported("instagram", "text")).toBe(false)
  })

  it("accepts facebook + image (new in Phase 1a)", () => {
    expect(isPlatformPostTypeSupported("facebook", "image")).toBe(true)
  })

  it("accepts facebook + text", () => {
    expect(isPlatformPostTypeSupported("facebook", "text")).toBe(true)
  })

  it("rejects linkedin + image (deferred to Phase 1c)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "image")).toBe(false)
  })

  it("accepts linkedin + video (existing)", () => {
    expect(isPlatformPostTypeSupported("linkedin", "video")).toBe(true)
  })

  it("rejects tiktok + image (deferred to Phase 1d)", () => {
    expect(isPlatformPostTypeSupported("tiktok", "image")).toBe(false)
  })

  it("rejects youtube + image (not applicable)", () => {
    expect(isPlatformPostTypeSupported("youtube", "image")).toBe(false)
  })

  it("rejects carousel and story for all platforms in Phase 1a", () => {
    expect(isPlatformPostTypeSupported("instagram", "carousel")).toBe(false)
    expect(isPlatformPostTypeSupported("instagram", "story")).toBe(false)
  })
})
```

Run: `npm run test:run -- __tests__/lib/content-studio/post-type-support.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement the helper**

Create `lib/content-studio/post-type-support.ts`:

```ts
import type { SocialPlatform, PostType } from "@/types/database"

// Phase 1a support matrix. Update when later sub-phases land:
//   Phase 1c → linkedin.image = true
//   Phase 1d → tiktok.image = true
//   Phase 2  → instagram.carousel, facebook.carousel, linkedin.carousel, tiktok.carousel = true
//   Phase 3  → instagram.story, facebook.story = true
const SUPPORT: Record<SocialPlatform, Partial<Record<PostType, boolean>>> = {
  instagram: { video: true, image: true },
  facebook: { video: true, image: true, text: true },
  linkedin: { video: true, text: true },
  tiktok: { video: true },
  youtube: { video: true },
  youtube_shorts: { video: true },
}

export function isPlatformPostTypeSupported(
  platform: SocialPlatform,
  postType: PostType,
): boolean {
  return SUPPORT[platform]?.[postType] === true
}
```

Run: `npm run test:run -- __tests__/lib/content-studio/post-type-support.test.ts`
Expected: 10/10 pass.

- [ ] **Step 3: Commit**

```bash
git add lib/content-studio/post-type-support.ts __tests__/lib/content-studio/post-type-support.test.ts
git commit -m "feat(content-studio): platform/post-type support matrix"
```

---

## Task 3: Feature flag

**Files:**
- Modify: `lib/content-studio/feature-flag.ts`

- [ ] **Step 1: Read the existing file**

Read `lib/content-studio/feature-flag.ts`. It currently exports `isContentStudioEnabled()`.

- [ ] **Step 2: Add the new flag**

Append to the file:

```ts
/**
 * Phase 1a+ multimedia gate. When true, the studio surfaces image (and later
 * carousel, story) post flows. Off by default — flip the env var in staging,
 * dogfood the image path, then enable in prod.
 */
export function isContentStudioMultimediaEnabled(): boolean {
  return process.env.CS_MULTIMEDIA_ENABLED === "true"
}
```

No dedicated test — the existing flag has no test either and the function is trivial.

- [ ] **Step 3: Commit**

```bash
git add lib/content-studio/feature-flag.ts
git commit -m "feat(content-studio): add CS_MULTIMEDIA_ENABLED feature flag"
```

---

## Task 4: Firebase client upload helper — add `uploadImageFile`

**Files:**
- Modify: `lib/firebase-client-upload.ts`

The existing helper hard-codes `/api/admin/videos` as the upload-URL endpoint. Refactor to make the endpoint configurable, then add a thin `uploadImageFile` wrapper.

- [ ] **Step 1: Refactor `requestSignedUpload` to take an endpoint**

Find:
```ts
export async function requestSignedUpload(body: UploadRequestBody): Promise<UploadApiResponse> {
  const response = await fetch("/api/admin/videos", {
```

Replace with:
```ts
export async function requestSignedUpload(
  body: UploadRequestBody,
  endpoint: string = "/api/admin/videos",
): Promise<UploadApiResponse> {
  const response = await fetch(endpoint, {
```

The existing `uploadVideoFile` uses the default, so no breakage.

- [ ] **Step 2: Widen `UploadApiResponse` to support the new endpoint's field names**

The image upload route returns `{mediaAssetId, uploadUrl, storagePath, expiresInSeconds}` — different id field. Replace the type:

```ts
export interface UploadApiResponse {
  uploadUrl: string
  storagePath: string
  expiresInSeconds: number
  videoUploadId?: string
  mediaAssetId?: string
}
```

- [ ] **Step 3: Add `uploadImageFile`**

Append to the file:

```ts
/**
 * Full flow for an image asset: request signed URL from the media-assets route,
 * PUT the bytes, return the new media_asset id + storage path.
 */
export async function uploadImageFile(
  file: File,
  options: { onProgress?: (event: UploadProgressEvent) => void } = {},
): Promise<{ mediaAssetId: string; storagePath: string }> {
  const { mediaAssetId, uploadUrl, storagePath } = await requestSignedUpload(
    {
      filename: file.name,
      contentType: file.type || "image/jpeg",
    },
    "/api/admin/media-assets/upload-url",
  )
  if (!mediaAssetId) throw new Error("Image upload response missing mediaAssetId")
  await uploadToSignedUrl(uploadUrl, file, options.onProgress)
  return { mediaAssetId, storagePath }
}
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm run test:run -- __tests__/lib/firebase-client-upload.test.ts 2>/dev/null || true`
If no such test exists, verify the project still type-checks: `npx tsc --noEmit | grep firebase-client-upload`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/firebase-client-upload.ts
git commit -m "feat(content-studio): uploadImageFile helper + configurable upload endpoint"
```

---

## Task 5: Upload-URL API route for images

**Files:**
- Create: `app/api/admin/media-assets/upload-url/route.ts`
- Create: `__tests__/api/admin/media-assets/upload-url.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/api/admin/media-assets/upload-url.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockGetSignedUrl = vi.fn()
const mockCreateMediaAsset = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({ getSignedUrl: mockGetSignedUrl }),
    }),
  }),
}))
vi.mock("@/lib/db/media-assets", () => ({
  createMediaAsset: (...args: unknown[]) => mockCreateMediaAsset(...args),
}))

describe("POST /api/admin/media-assets/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/put"])
    mockCreateMediaAsset.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "asset-123",
      ...input,
    }))
  })

  async function call(body: unknown, opts?: { role?: "admin" | "client" | null }) {
    const { POST } = await import("@/app/api/admin/media-assets/upload-url/route")
    mockAuth.mockResolvedValue(
      opts?.role === null
        ? null
        : { user: { id: "user-1", role: opts?.role ?? "admin" } },
    )
    const req = new NextRequest("http://localhost/api/admin/media-assets/upload-url", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return POST(req)
  }

  it("returns 401 for non-admin sessions", async () => {
    const res = await call({ filename: "x.jpg", contentType: "image/jpeg" }, { role: "client" })
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid payload (non-image)", async () => {
    const res = await call({ filename: "x.mp4", contentType: "video/mp4" })
    expect(res.status).toBe(400)
  })

  it("issues signed URL + creates media_asset row for a valid request", async () => {
    const res = await call({ filename: "photo.jpg", contentType: "image/jpeg" })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      mediaAssetId: "asset-123",
      uploadUrl: "https://signed.example/put",
      storagePath: expect.stringMatching(/^images\/user-1\/\d+-photo\.jpg$/),
    })
    expect(mockCreateMediaAsset).toHaveBeenCalledOnce()
    const call0 = mockCreateMediaAsset.mock.calls[0][0] as Record<string, unknown>
    expect(call0.kind).toBe("image")
    expect(call0.mime_type).toBe("image/jpeg")
    expect(call0.created_by).toBe("user-1")
  })
})
```

Run: `npm run test:run -- __tests__/api/admin/media-assets/upload-url.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 2: Create the route**

Create `app/api/admin/media-assets/upload-url/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { createMediaAsset } from "@/lib/db/media-assets"
import { mediaAssetUploadUrlSchema } from "@/lib/validators/media-asset"

const UPLOAD_URL_EXPIRY_MS = 15 * 60 * 1000

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = mediaAssetUploadUrlSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const { filename, contentType } = parsed.data
  const safeFilename = sanitizeFilename(filename)
  const storagePath = `images/${session.user.id}/${Date.now()}-${safeFilename}`

  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType,
  })

  const asset = await createMediaAsset({
    kind: "image",
    storage_path: storagePath,
    public_url: storagePath, // resolve-media-url treats non-http values as Firebase paths
    mime_type: contentType,
    bytes: 0,
    width: null,
    height: null,
    duration_ms: null,
    derived_from_video_id: null,
    ai_alt_text: null,
    ai_analysis: null,
    created_by: session.user.id,
  })

  return NextResponse.json(
    {
      mediaAssetId: asset.id,
      uploadUrl,
      storagePath,
      expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
    },
    { status: 201 },
  )
}
```

Run: `npm run test:run -- __tests__/api/admin/media-assets/upload-url.test.ts`
Expected: 3/3 pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/media-assets/upload-url/route.ts __tests__/api/admin/media-assets/upload-url.test.ts
git commit -m "feat(content-studio): POST /api/admin/media-assets/upload-url"
```

---

## Task 6: PATCH route for asset dimension backfill

**Files:**
- Create: `app/api/admin/media-assets/[id]/route.ts`
- Create: `__tests__/api/admin/media-assets/patch.test.ts`

Client can optionally populate width/height/bytes after successful upload. If the PATCH fails, the asset still works — dimensions stay null until Phase 1b's vision AI job fills them in.

- [ ] **Step 1: Write failing test**

Create `__tests__/api/admin/media-assets/patch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/media-assets", () => ({
  getMediaAssetById: vi.fn(),
}))

// Tracked separately so assertions can inspect.
const { getMediaAssetById } = await import("@/lib/db/media-assets") as { getMediaAssetById: ReturnType<typeof vi.fn> }

// Supabase update mock: the DAL currently doesn't have an updateMediaAsset
// function, so the route calls the Supabase client directly — mock that via the
// lib/supabase module.
const mockUpdate = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: mockUpdate,
    }),
  }),
}))

describe("PATCH /api/admin/media-assets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getMediaAssetById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "asset-1", kind: "image" })
    mockUpdate.mockReturnValue({
      eq: () => ({ error: null }),
    })
  })

  async function call(id: string, body: unknown, role: "admin" | "client" = "admin") {
    const { PATCH } = await import("@/app/api/admin/media-assets/[id]/route")
    mockAuth.mockResolvedValue({ user: { id: "user-1", role } })
    const req = new NextRequest(`http://localhost/api/admin/media-assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return PATCH(req, { params: Promise.resolve({ id }) })
  }

  it("returns 401 for non-admin", async () => {
    const res = await call("asset-1", { width: 100 }, "client")
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid payload (negative bytes)", async () => {
    const res = await call("asset-1", { bytes: -1 })
    expect(res.status).toBe(400)
  })

  it("returns 404 when asset not found", async () => {
    ;(getMediaAssetById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await call("asset-404", { width: 100, height: 100 })
    expect(res.status).toBe(404)
  })

  it("updates dimensions on valid payload", async () => {
    const res = await call("asset-1", { width: 1080, height: 1080, bytes: 54321 })
    expect(res.status).toBe(200)
  })
})
```

Run: `npm run test:run -- __tests__/api/admin/media-assets/patch.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 2: Create the route**

Create `app/api/admin/media-assets/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getMediaAssetById } from "@/lib/db/media-assets"
import { createServiceRoleClient } from "@/lib/supabase"
import { mediaAssetPatchSchema } from "@/lib/validators/media-asset"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = mediaAssetPatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const existing = await getMediaAssetById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from("media_assets")
    .update(parsed.data)
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
```

Run: `npm run test:run -- __tests__/api/admin/media-assets/patch.test.ts`
Expected: 4/4 pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/media-assets/[id]/route.ts __tests__/api/admin/media-assets/patch.test.ts
git commit -m "feat(content-studio): PATCH /api/admin/media-assets/[id] for dimension backfill"
```

---

## Task 7: `resolve-media-url.ts` — Firebase-path branch

**Files:**
- Modify: `lib/social/resolve-media-url.ts`
- Create: `__tests__/lib/social/resolve-media-url.test.ts` (extend if it exists — check first)

The current resolver returns `input.media_url` directly when there's no `source_video_id`. For image posts, `media_url` is a Firebase storage path (not an http URL) because the mirror trigger copied it from `media_assets.public_url` which is stored as a path. The resolver must sign it.

- [ ] **Step 1: Check for existing test file**

Run: `ls __tests__/lib/social/resolve-media-url.test.ts 2>/dev/null`
If it exists, you'll extend it. If not, you'll create it.

- [ ] **Step 2: Write failing test** (create or extend)

The test file (create if missing):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetSignedUrl = vi.fn()

vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({ getSignedUrl: mockGetSignedUrl }),
    }),
  }),
}))

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: vi.fn(async () => ({ storage_path: "videos/u/1.mp4" })),
}))

describe("resolveMediaUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/read"])
  })

  it("returns null for text-only posts", async () => {
    const { resolveMediaUrl } = await import("@/lib/social/resolve-media-url")
    const url = await resolveMediaUrl({ source_video_id: null, media_url: null })
    expect(url).toBeNull()
  })

  it("returns http media_url unchanged", async () => {
    const { resolveMediaUrl } = await import("@/lib/social/resolve-media-url")
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "https://external.example/img.jpg",
    })
    expect(url).toBe("https://external.example/img.jpg")
  })

  it("signs a Firebase storage path stored in media_url", async () => {
    const { resolveMediaUrl } = await import("@/lib/social/resolve-media-url")
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "images/user-1/1712345678-photo.jpg",
    })
    expect(url).toBe("https://signed.example/read")
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
  })

  it("prefers source_video_id when both set", async () => {
    const { resolveMediaUrl } = await import("@/lib/social/resolve-media-url")
    const url = await resolveMediaUrl({
      source_video_id: "video-1",
      media_url: "images/whatever.jpg",
    })
    expect(url).toBe("https://signed.example/read")
  })
})
```

Run: `npm run test:run -- __tests__/lib/social/resolve-media-url.test.ts`
Expected: "signs a Firebase storage path" FAILS — current resolver returns the string as-is.

- [ ] **Step 3: Extend the resolver**

Replace `lib/social/resolve-media-url.ts` with:

```ts
// lib/social/resolve-media-url.ts
// Given a social_posts row's source_video_id + media_url, returns the best
// media URL to pass to the plugin.publish() call. Priority:
//   1. If source_video_id is set and the video exists in Firebase Storage,
//      generate a 1-hour signed READ URL.
//   2. If media_url is set:
//        a) if it looks like an http(s) URL, return it verbatim
//        b) otherwise treat it as a Firebase storage path and sign it
//      (b) covers image posts where the mirror trigger copied media_assets.public_url
//      (which stores the Firebase path, not a real URL) into social_posts.media_url.
//   3. Return null for text-only posts.

import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getAdminStorage } from "@/lib/firebase-admin"

const SIGNED_URL_TTL_MS = 60 * 60 * 1000
const HTTP_URL = /^https?:\/\//i

export interface ResolveMediaUrlInput {
  source_video_id: string | null
  media_url: string | null
}

async function signStoragePath(path: string): Promise<string | null> {
  try {
    const bucket = getAdminStorage().bucket()
    const file = bucket.file(path)
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    })
    return url
  } catch {
    return null
  }
}

export async function resolveMediaUrl(input: ResolveMediaUrlInput): Promise<string | null> {
  if (input.source_video_id) {
    const upload = await getVideoUploadById(input.source_video_id).catch(() => null)
    if (upload?.storage_path) {
      const url = await signStoragePath(upload.storage_path)
      if (url) return url
    }
  }

  if (input.media_url) {
    if (HTTP_URL.test(input.media_url)) return input.media_url
    return await signStoragePath(input.media_url)
  }

  return null
}
```

Run: `npm run test:run -- __tests__/lib/social/resolve-media-url.test.ts`
Expected: 4/4 pass.

- [ ] **Step 4: Commit**

```bash
git add lib/social/resolve-media-url.ts __tests__/lib/social/resolve-media-url.test.ts
git commit -m "feat(content-studio): resolve-media-url signs Firebase paths in media_url"
```

---

## Task 8: Create-post API route — accept `postType` + `mediaAssetId`

**Files:**
- Modify: `app/api/admin/content-studio/posts/route.ts`
- Create: `__tests__/api/admin/content-studio/posts-image.test.ts`

- [ ] **Step 1: Write failing tests for the image path**

Create `__tests__/api/admin/content-studio/posts-image.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockAttach = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => mockCreate(...args),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...args: unknown[]) => mockAttach(...args),
}))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))

describe("POST /api/admin/content-studio/posts — image path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "approved" })
    mockAttach.mockResolvedValue(undefined)
  })

  async function call(body: unknown) {
    const { POST } = await import("@/app/api/admin/content-studio/posts/route")
    const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return POST(req)
  }

  it("creates an image post and attaches the asset", async () => {
    const res = await call({
      platform: "instagram",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "instagram",
        post_type: "image",
        content: "hello",
        media_url: null,
        source_video_id: null,
      }),
    )
    expect(mockAttach).toHaveBeenCalledWith("post-1", "asset-1", 0)
  })

  it("rejects image post without mediaAssetId", async () => {
    const res = await call({
      platform: "instagram",
      caption: "hello",
      postType: "image",
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects image post on linkedin (deferred to Phase 1c)", async () => {
    const res = await call({
      platform: "linkedin",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(400)
  })

  it("rejects image post on tiktok (deferred to Phase 1d)", async () => {
    const res = await call({
      platform: "tiktok",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(400)
  })

  it("still accepts video posts without postType (back-compat)", async () => {
    const res = await call({
      platform: "instagram",
      caption: "hello",
      source_video_id: "video-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ source_video_id: "video-1" }),
    )
    expect(mockAttach).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/content-studio/posts — multimedia flag off", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    vi.doMock("@/lib/content-studio/feature-flag", () => ({
      isContentStudioMultimediaEnabled: () => false,
    }))
    vi.resetModules()
  })

  it("rejects postType=image when the flag is off", async () => {
    const { POST } = await import("@/app/api/admin/content-studio/posts/route")
    const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
      method: "POST",
      body: JSON.stringify({
        platform: "instagram",
        caption: "hi",
        postType: "image",
        mediaAssetId: "a-1",
      }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

Run: `npm run test:run -- __tests__/api/admin/content-studio/posts-image.test.ts`
Expected: FAIL — new payload fields not handled yet.

- [ ] **Step 2: Update the route**

Replace `app/api/admin/content-studio/posts/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"
import { isContentStudioMultimediaEnabled } from "@/lib/content-studio/feature-flag"
import type { SocialPlatform, PostType } from "@/types/database"

const VALID_PLATFORMS: readonly SocialPlatform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "youtube_shorts",
  "linkedin",
]

const VALID_POST_TYPES: readonly PostType[] = ["video", "image", "carousel", "story", "text"]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    platform?: string
    caption?: string
    scheduled_at?: string | null
    source_video_id?: string | null
    postType?: string
    mediaAssetId?: string | null
  } | null

  const platform = body?.platform as SocialPlatform | undefined
  const caption = (body?.caption ?? "").trim()

  if (!platform || !(VALID_PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json({ error: "platform must be one of " + VALID_PLATFORMS.join(", ") }, { status: 400 })
  }

  const postType = (body?.postType ?? "video") as PostType
  if (!(VALID_POST_TYPES as readonly string[]).includes(postType)) {
    return NextResponse.json({ error: "postType is invalid" }, { status: 400 })
  }

  // Multimedia feature gate: only postType=video is allowed when the flag is off.
  if (postType !== "video" && !isContentStudioMultimediaEnabled()) {
    return NextResponse.json(
      { error: "Multimedia posts are disabled. Set CS_MULTIMEDIA_ENABLED=true." },
      { status: 400 },
    )
  }

  if (!isPlatformPostTypeSupported(platform, postType)) {
    return NextResponse.json(
      { error: `${platform} does not support ${postType} posts` },
      { status: 400 },
    )
  }

  if (postType === "image" && !body?.mediaAssetId) {
    return NextResponse.json({ error: "mediaAssetId is required for image posts" }, { status: 400 })
  }

  let scheduledAt: string | null = null
  if (body?.scheduled_at) {
    const d = new Date(body.scheduled_at)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "scheduled_at is not a valid datetime" }, { status: 400 })
    }
    if (d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 })
    }
    scheduledAt = d.toISOString()
  }

  const post = await createSocialPost({
    platform,
    content: caption,
    media_url: null,
    post_type: postType,
    approval_status: scheduledAt ? "scheduled" : "approved",
    scheduled_at: scheduledAt,
    source_video_id: body?.source_video_id ?? null,
    created_by: session.user.id,
  })

  if (postType === "image" && body?.mediaAssetId) {
    await attachMedia(post.id, body.mediaAssetId, 0)
  }

  return NextResponse.json({ id: post.id, approval_status: post.approval_status })
}
```

Run: `npm run test:run -- __tests__/api/admin/content-studio/posts-image.test.ts`
Expected: all tests pass.

Also re-run the existing posts test to confirm no regression:
```
npm run test:run -- __tests__/api/content-studio/manual-post.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/content-studio/posts/route.ts __tests__/api/admin/content-studio/posts-image.test.ts
git commit -m "feat(content-studio): POST posts accepts postType + mediaAssetId for images"
```

---

## Task 9: ImageUploader component

**Files:**
- Create: `components/admin/content-studio/upload/ImageUploader.tsx`
- Create: `__tests__/components/admin/content-studio/upload/ImageUploader.test.tsx`

- [ ] **Step 1: Read existing `VideoUploader` for style reference**

Read `components/admin/videos/VideoUploader.tsx`. Match its styling conventions (drag-drop area, progress bar, error state, Tailwind classes).

- [ ] **Step 2: Write failing test**

Create `__tests__/components/admin/content-studio/upload/ImageUploader.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/firebase-client-upload", () => ({
  uploadImageFile: vi.fn(async () => ({
    mediaAssetId: "asset-1",
    storagePath: "images/u/1-photo.jpg",
  })),
}))

describe("ImageUploader", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders file input accepting image mime types", async () => {
    const { ImageUploader } = await import("@/components/admin/content-studio/upload/ImageUploader")
    render(<ImageUploader onUploaded={() => {}} />)
    const input = screen.getByLabelText(/photo/i, { selector: 'input[type="file"]' })
    expect(input).toHaveAttribute("accept", expect.stringContaining("image/"))
  })

  it("calls onUploaded with mediaAssetId on success", async () => {
    const { ImageUploader } = await import("@/components/admin/content-studio/upload/ImageUploader")
    const onUploaded = vi.fn()
    render(<ImageUploader onUploaded={onUploaded} />)

    const file = new File([new Uint8Array([0])], "photo.jpg", { type: "image/jpeg" })
    const input = screen.getByLabelText(/photo/i, { selector: 'input[type="file"]' }) as HTMLInputElement
    Object.defineProperty(input, "files", { value: [file] })
    fireEvent.change(input)

    // Upload runs async; wait for callback.
    await new Promise((r) => setTimeout(r, 10))
    expect(onUploaded).toHaveBeenCalledWith({
      mediaAssetId: "asset-1",
      storagePath: "images/u/1-photo.jpg",
    })
  })

  it("rejects non-image files client-side", async () => {
    const { ImageUploader } = await import("@/components/admin/content-studio/upload/ImageUploader")
    const onUploaded = vi.fn()
    render(<ImageUploader onUploaded={onUploaded} />)

    const file = new File([new Uint8Array([0])], "video.mp4", { type: "video/mp4" })
    const input = screen.getByLabelText(/photo/i, { selector: 'input[type="file"]' }) as HTMLInputElement
    Object.defineProperty(input, "files", { value: [file] })
    fireEvent.change(input)

    await new Promise((r) => setTimeout(r, 10))
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByText(/must be an image/i)).toBeInTheDocument()
  })
})
```

Run: `npm run test:run -- __tests__/components/admin/content-studio/upload/ImageUploader.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `components/admin/content-studio/upload/ImageUploader.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Upload, X } from "lucide-react"
import { uploadImageFile } from "@/lib/firebase-client-upload"

const MAX_BYTES = 8 * 1024 * 1024

export interface ImageUploadedEvent {
  mediaAssetId: string
  storagePath: string
}

interface ImageUploaderProps {
  onUploaded: (event: ImageUploadedEvent) => void
}

export function ImageUploader({ onUploaded }: ImageUploaderProps) {
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    if (!file.type.startsWith("image/")) {
      setError("File must be an image (JPG, PNG, WebP).")
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Image exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit.`)
      return
    }
    setFileName(file.name)
    setPercent(0)
    try {
      const result = await uploadImageFile(file, {
        onProgress: (e) => setPercent(e.percent),
      })
      setPercent(100)
      onUploaded(result)
    } catch (err) {
      setError((err as Error).message || "Upload failed")
      setPercent(null)
    }
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <Upload className="size-4" />
        <span className="text-sm">Photo</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onChange}
        />
      </label>
      {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
      {percent !== null ? (
        <div className="h-1 w-full bg-muted rounded overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-error">
          <X className="size-3" /> {error}
        </p>
      ) : null}
    </div>
  )
}
```

Run: `npm run test:run -- __tests__/components/admin/content-studio/upload/ImageUploader.test.tsx`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git add components/admin/content-studio/upload/ImageUploader.tsx __tests__/components/admin/content-studio/upload/ImageUploader.test.tsx
git commit -m "feat(content-studio): ImageUploader component"
```

---

## Task 10: `ManualPostDialog` — add content-type picker + image path

**Files:**
- Modify: `components/admin/content-studio/calendar/ManualPostDialog.tsx`
- Modify: `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx` (exists — extend)

- [ ] **Step 1: Read existing test and component**

Read both files to match style and existing assertions.

- [ ] **Step 2: Extend the component**

Replace `components/admin/content-studio/calendar/ManualPostDialog.tsx` with:

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SocialPlatform, PostType } from "@/types/database"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"
import { ImageUploader } from "@/components/admin/content-studio/upload/ImageUploader"

interface ManualPostDialogProps {
  dayKey: string
  onClose: () => void
  onCreated: (postId: string) => void
  multimediaEnabled?: boolean
}

const PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "facebook", "youtube", "youtube_shorts", "linkedin"]

export function ManualPostDialog({ dayKey, onClose, onCreated, multimediaEnabled = false }: ManualPostDialogProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("instagram")
  const [postType, setPostType] = useState<PostType>("video")
  const [caption, setCaption] = useState("")
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit =
    !busy &&
    isPlatformPostTypeSupported(platform, postType) &&
    (postType !== "image" || mediaAssetId !== null)

  async function submit() {
    setBusy(true)
    try {
      const day = new Date(`${dayKey}T00:00:00Z`)
      const scheduled_at = defaultPublishTimeForPlatform(platform, day).toISOString()
      const res = await fetch("/api/admin/content-studio/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform,
          caption,
          scheduled_at,
          postType,
          mediaAssetId: postType === "image" ? mediaAssetId : undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Create failed")
      const data = (await res.json()) as { id: string }
      toast.success("Manual post scheduled")
      onCreated(data.id)
    } catch (err) {
      toast.error((err as Error).message || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded-lg bg-white border border-border shadow-lg p-4 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading text-sm text-primary mb-3">New manual post — {dayKey}</h3>

        {multimediaEnabled ? (
          <label className="block text-xs text-muted-foreground mb-3">
            Post type
            <select
              aria-label="Post type"
              value={postType}
              onChange={(e) => {
                setPostType(e.target.value as PostType)
                setMediaAssetId(null)
              }}
              className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
            >
              <option value="video">Video</option>
              <option value="image">Photo</option>
            </select>
          </label>
        ) : null}

        <label className="block text-xs text-muted-foreground mb-3">
          Platform
          <select
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
            className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {postType === "image" && multimediaEnabled ? (
          <div className="mb-3">
            <ImageUploader onUploaded={(e) => setMediaAssetId(e.mediaAssetId)} />
            {!isPlatformPostTypeSupported(platform, "image") ? (
              <p className="mt-2 text-xs text-error">
                {platform} does not support image posts yet.
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="block text-xs text-muted-foreground mb-3">
          Caption
          <textarea
            aria-label="Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note: the `multimediaEnabled` prop defaults to `false`, so every existing caller (which doesn't pass it) gets the old video-only UX. This keeps the test suite green; new callers from the calendar container pass `multimediaEnabled={isContentStudioMultimediaEnabled()}`.

- [ ] **Step 3: Update the existing ManualPostDialog test to cover the new surface**

Append to `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx`:

```ts
  it("hides the post-type picker when multimediaEnabled is false", () => {
    render(<ManualPostDialog dayKey="2026-05-01" onClose={() => {}} onCreated={() => {}} />)
    expect(screen.queryByLabelText(/post type/i)).not.toBeInTheDocument()
  })

  it("shows the post-type picker when multimediaEnabled is true", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    expect(screen.getByLabelText(/post type/i)).toBeInTheDocument()
  })
```

Run: `npm run test:run -- __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx`
Expected: all tests pass (old + new).

- [ ] **Step 4: Commit**

```bash
git add components/admin/content-studio/calendar/ManualPostDialog.tsx __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx
git commit -m "feat(content-studio): ManualPostDialog image path (feature-flagged)"
```

---

## Task 11: Thread the multimedia flag to the dialog

**Files:**
- Grep: `grep -rn "ManualPostDialog" components app --include='*.tsx'` — find the caller(s). Expected: `components/admin/content-studio/calendar/CalendarContainer.tsx` or similar.
- Modify: the caller component to pass `multimediaEnabled={isContentStudioMultimediaEnabled()}`

- [ ] **Step 1: Find the caller**

Run: `grep -rn "ManualPostDialog" components app --include='*.tsx'`
Identify the file that renders `<ManualPostDialog />`.

- [ ] **Step 2: Pass the flag from server component**

Since `isContentStudioMultimediaEnabled()` reads `process.env`, it must be called from a server component (or a route). The pattern in the codebase is:
- A server component at the page level reads the flag and passes it as a prop down through the tree.

Open the page that mounts the studio calendar: likely `app/(admin)/admin/content/page.tsx`. Read `isContentStudioEnabled()` usage and mirror it for the new flag. Add `multimediaEnabled` as a prop that flows to whatever component ultimately renders `ManualPostDialog`.

If the flag-threading is more than one component deep, use React context: add a `ContentStudioFlagsContext` with `{multimediaEnabled: boolean}` at the shell level. Choose the simplest form that works.

- [ ] **Step 3: Verify no regressions**

Run: `npm run test:run -- __tests__/components/admin/content-studio`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add <changed-files>
git commit -m "feat(content-studio): thread multimedia flag to ManualPostDialog caller"
```

---

## Task 12: Content-type badges (pipeline + calendar)

**Files:**
- Modify: `components/admin/content-studio/pipeline/PostCard.tsx`
- Modify: `components/admin/content-studio/pipeline/VideoCard.tsx`
- Modify: `components/admin/content-studio/calendar/PostChip.tsx`
- Create: `components/admin/content-studio/shared/PostTypeBadge.tsx` (shared badge to avoid duplication)
- Create: `__tests__/components/admin/content-studio/shared/PostTypeBadge.test.tsx`

- [ ] **Step 1: Write failing test for the shared badge**

Create `__tests__/components/admin/content-studio/shared/PostTypeBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { PostTypeBadge } from "@/components/admin/content-studio/shared/PostTypeBadge"

describe("PostTypeBadge", () => {
  it("renders 'Video' for video", () => {
    render(<PostTypeBadge postType="video" />)
    expect(screen.getByText(/video/i)).toBeInTheDocument()
  })

  it("renders 'Photo' for image", () => {
    render(<PostTypeBadge postType="image" />)
    expect(screen.getByText(/photo/i)).toBeInTheDocument()
  })

  it("renders nothing for unknown post_type (future-proof fallback)", () => {
    // @ts-expect-error intentional bad input
    const { container } = render(<PostTypeBadge postType="alien" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

Run: `npm run test:run -- __tests__/components/admin/content-studio/shared/PostTypeBadge.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement the badge**

Create `components/admin/content-studio/shared/PostTypeBadge.tsx`:

```tsx
import { Film, Image as ImageIcon } from "lucide-react"
import type { PostType } from "@/types/database"

interface PostTypeBadgeProps {
  postType: PostType
  className?: string
}

export function PostTypeBadge({ postType, className = "" }: PostTypeBadgeProps) {
  const base = "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent"
  if (postType === "image") {
    return (
      <span className={`${base} ${className}`.trim()}>
        <ImageIcon className="size-3" /> Photo
      </span>
    )
  }
  if (postType === "video") {
    return (
      <span className={`${base} ${className}`.trim()}>
        <Film className="size-3" /> Video
      </span>
    )
  }
  return null
}
```

Run: `npm run test:run -- __tests__/components/admin/content-studio/shared/PostTypeBadge.test.tsx`
Expected: 3/3 pass.

- [ ] **Step 3: Wire it into PostCard, VideoCard, PostChip**

For each of the three files, import `PostTypeBadge` and render it near the title/handle area. Exact placement should match existing accent-tag patterns — look at how each file already renders its meta row.

Example for `PostCard.tsx`: find the section that renders the post title / platform icon, and add `<PostTypeBadge postType={post.post_type} />` alongside existing badges.

After each file:
- Run its existing test: `npm run test:run -- <test-path>`
- Expect tests still pass (they shouldn't break since they don't assert on absence of this badge)

- [ ] **Step 4: Commit**

```bash
git add components/admin/content-studio/shared/PostTypeBadge.tsx \
        components/admin/content-studio/pipeline/PostCard.tsx \
        components/admin/content-studio/pipeline/VideoCard.tsx \
        components/admin/content-studio/calendar/PostChip.tsx \
        __tests__/components/admin/content-studio/shared/PostTypeBadge.test.tsx
git commit -m "feat(content-studio): content-type badge on pipeline cards and calendar chips"
```

---

## Task 13: Final sweep

- [ ] **Step 1: Run full suite**

```
npm run test:run
```

Expected: the pre-existing 32 unrelated failures still fail (NextRequest typing, eslint v9 config, etc.); no new failures from Phase 1a changes.

- [ ] **Step 2: Run tsc**

```
npx tsc --noEmit | grep -E "(app/api/admin/media-assets|lib/validators/media-asset|lib/content-studio/post-type-support|components/admin/content-studio/upload|components/admin/content-studio/shared/PostTypeBadge)" | head -20
```

Expected: no errors in Phase 1a files.

- [ ] **Step 3: Manual smoke on localhost (optional but recommended)**

- Run `npm run dev` on port 3050.
- Log in as admin, go to `/admin/content`.
- Enable the feature flag locally by setting `CS_MULTIMEDIA_ENABLED=true` in `.env.local` and restart.
- Open the calendar, click a day to open `ManualPostDialog`, pick Post type = Photo, upload a photo, pick platform = Instagram, enter caption, Create.
- Verify a post appears in the pipeline with the Photo badge.
- (Do not publish to real Instagram unless you have a sandbox or are OK with a test post.)

---

## Self-review

**Spec coverage:**
- Upload UI + endpoints — Tasks 4, 5, 6, 9.
- Asset DAL wiring — Tasks 5, 6, 8 (reuses Phase 0 DAL; no new DAL file).
- ManualPostDialog extension — Tasks 10, 11.
- API route updates — Task 8.
- Platform support matrix — Task 2, consumed in Task 8.
- resolve-media-url extension — Task 7.
- Feature flag — Task 3.
- Content-type badges — Task 12.
- Plugin changes — not required per spec (§5.4 pre-flight audit).

**Placeholder scan:** no "TBD", "TODO", or hand-wavy steps. Every step shows code or command.

**Type consistency:**
- `PostType` import used consistently everywhere.
- `isPlatformPostTypeSupported` signature matches across Task 2 (definition) and Task 8 (usage).
- `MediaAssetUploadUrlPayload` typed via `z.infer`.
- `ImageUploadedEvent` exported from the component for future reuse.

**Scope check:** single-session shippable — 13 tasks, all touching the image path end-to-end. No plugin code changes. No DB migration. Behind a feature flag so safe to merge without enabling.
