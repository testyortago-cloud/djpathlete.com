# Team Image Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the editor → admin team-video review pipeline to also accept 1–10 photo submissions (single image or carousel), and on approval push them into Content Studio with platform-aware Claude vision draft captions.

**Architecture:** Three independent phases. Phase A lands schema + storage helpers + DAL (no UI). Phase B lands editor photo dialog + admin image-set review surface behind a feature flag. Phase C lands send-to-Studio image_set branch + a new `image_caption_generation` AI job handler. Each phase produces a working, committable slice and reuses existing primitives (`team_video_*` tables, Firebase bucket, `media_assets`, `social_post_media`, `ai_jobs`).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres), Firebase Storage (team-videos bucket), Anthropic `claude-sonnet-4-6` vision, Vitest + Testing Library, Playwright. Existing patterns: service-role DAL files in `lib/db/`, Zod validators in `lib/validators/`, AI jobs via `createAiJob()` (Firestore-backed).

**Spec:** [docs/superpowers/specs/2026-05-14-team-image-submissions-design.md](../specs/2026-05-14-team-image-submissions-design.md)

---

## File Structure

### Phase A — Schema, storage, DAL

- **Create:** `supabase/migrations/00125_team_submission_images.sql` — new table, trigger, column alterations
- **Create:** `lib/db/team-submission-images.ts` — DAL for the image rows
- **Modify:** `lib/db/team-video-submissions.ts` — `createSubmission` gains `kind`
- **Modify:** `lib/db/team-video-versions.ts` — `createVersion` accepts nullable file fields for image-set versions
- **Modify:** `lib/storage/team-videos.ts` — `buildImagePath`, `createImageUploadUrls`, `copyImageToMediaAssetsBucket`
- **Modify:** `types/database.ts` — `TeamSubmissionImage`, `TeamVideoSubmissionKind`, kind/image_count on existing types
- **Modify:** `lib/validators/team-video.ts` — `createPhotoSubmissionSchema`, `createPhotoVersionSchema`
- **Test:** `__tests__/db/team-submission-images.test.ts`, `__tests__/lib/storage/team-videos-images.test.ts`, `__tests__/lib/validators/team-video-photo.test.ts`

### Phase B — Editor + admin UI

- **Create:** `app/api/editor/submissions/photos/route.ts` — POST photo submission
- **Create:** `app/api/editor/submissions/[id]/photo-versions/route.ts` — POST photo revision
- **Modify:** `app/api/editor/submissions/[id]/finalize/route.ts` — verify photo PUTs before flipping status
- **Create:** `components/editor/PhotoSubmitDialog.tsx` — drag-drop multi-image picker
- **Create:** `components/editor/PhotoRevisionUploadZone.tsx` — revision upload for image_set submissions
- **Create:** `components/admin/team-videos/ImageSetViewer.tsx` — carousel viewer + thumbnail strip
- **Modify:** `components/admin/team-videos/ReviewSurface.tsx` — switch on `submission.kind`
- **Modify:** `components/admin/team-videos/CommentEditor.tsx` — image-index pin button when `kind='image_set'`
- **Modify:** `components/shared/CommentThread.tsx` — render "Image N" pill on image_index annotations
- **Modify:** `app/(editor)/editor/dashboard/page.tsx` — "New submission" menu (Video / Photos)
- **Modify:** `components/admin/team-videos/TeamVideoTable.tsx` — kind badge
- **Modify:** `app/(admin)/admin/team-videos/[id]/page.tsx` — load images for image_set submissions
- **Create:** `lib/team-images/feature-flag.ts` — `isTeamImagesEnabled()`
- **Test:** Route, component, and E2E tests under `__tests__/`

### Phase C — Send-to-Studio + caption job

- **Modify:** `app/api/admin/team-videos/[id]/send-to-content-studio/route.ts` — branch on kind
- **Modify:** `lib/ai-jobs.ts` — add `image_caption_generation` to `AiJobType`
- **Modify:** `lib/storage/team-videos.ts` — `copyImageToMediaAssetsBucket` (lives here per Phase A list)
- **Create:** `functions/src/image-caption-generation.ts` — Anthropic vision handler
- **Create:** `functions/src/lib/image-caption-prompts.ts` — per-platform prompt builders
- **Modify:** `functions/src/index.ts` — register `imageCaptionGeneration` function
- **Modify:** `functions/src/lib/social-connections.ts` (or equivalent) — `listEnabledPlatformsForUser` if not already present
- **Test:** Route tests, prompt snapshot tests, handler unit tests, Playwright happy path

---

## Phase A — Schema, Storage, DAL

### Task A1: Database migration

**Files:**
- Create: `supabase/migrations/00125_team_submission_images.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 00125_team_submission_images.sql
-- Extends the team-video submission pipeline to also carry image-set
-- submissions (1-10 photos per version). Adds a kind discriminator to
-- submissions, relaxes file-field constraints on versions, and creates a
-- per-image join table with a trigger-maintained count.

-- 1. Submission kind discriminator.
ALTER TABLE public.team_video_submissions
  ADD COLUMN kind text NOT NULL DEFAULT 'video'
    CHECK (kind IN ('video', 'image_set'));

CREATE INDEX idx_team_video_submissions_kind
  ON public.team_video_submissions(kind);

-- 2. Relax version columns so image_set versions can omit file-level fields.
--    Existing video rows already have non-null values and stay that way.
ALTER TABLE public.team_video_versions
  ALTER COLUMN mime_type DROP NOT NULL,
  ALTER COLUMN size_bytes DROP NOT NULL,
  ALTER COLUMN original_filename DROP NOT NULL,
  ALTER COLUMN storage_path DROP NOT NULL,
  ADD COLUMN image_count int
    CHECK (image_count IS NULL OR (image_count >= 1 AND image_count <= 10));

-- 3. Per-image rows for image_set versions.
CREATE TABLE public.team_submission_images (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         uuid NOT NULL REFERENCES public.team_video_versions(id) ON DELETE CASCADE,
  position           int  NOT NULL CHECK (position >= 0 AND position <= 9),
  storage_path       text NOT NULL,
  original_filename  text NOT NULL,
  mime_type          text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  width              int,
  height             int,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, position)
);

CREATE INDEX idx_team_submission_images_version
  ON public.team_submission_images(version_id);

-- 4. Trigger keeps team_video_versions.image_count = COUNT(*) of images for
--    that version. Runs AFTER so the version row is always consistent post-commit.
CREATE OR REPLACE FUNCTION public.sync_team_version_image_count()
RETURNS trigger AS $$
DECLARE
  target_version uuid;
BEGIN
  target_version := COALESCE(NEW.version_id, OLD.version_id);
  IF target_version IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.team_video_versions
     SET image_count = (
       SELECT COUNT(*) FROM public.team_submission_images
        WHERE version_id = target_version
     )
   WHERE id = target_version;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_submission_images_count
  AFTER INSERT OR UPDATE OR DELETE ON public.team_submission_images
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_version_image_count();

-- 5. RLS — service-role bypasses, admin policy for completeness (same pattern
--    as 00115_team_video_tables.sql).
ALTER TABLE public.team_submission_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all team_submission_images"
  ON public.team_submission_images FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `team_submission_images` and the SQL from Step 1. Do not run `supabase db push` — the CLI is not linked in this project.

- [ ] **Step 3: Verify schema landed**

Use `mcp__supabase__list_tables` and confirm `team_submission_images` exists and `team_video_submissions.kind` + `team_video_versions.image_count` columns are present.

- [ ] **Step 4: Commit**

```
git add supabase/migrations/00125_team_submission_images.sql
git commit -m "feat(db): team_submission_images table + kind/image_count columns"
```

---

### Task A2: TypeScript types

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Add new types and extend existing ones**

In `types/database.ts`, right after the existing `TeamVideoVersionStatus` declaration:

```ts
export type TeamVideoSubmissionKind = "video" | "image_set"
```

Update `TeamVideoSubmission`:

```ts
export interface TeamVideoSubmission {
  id: string
  title: string
  description: string | null
  submitted_by: string
  status: TeamVideoSubmissionStatus
  kind: TeamVideoSubmissionKind
  current_version_id: string | null
  approved_at: string | null
  approved_by: string | null
  locked_at: string | null
  created_at: string
  updated_at: string
}
```

Update `TeamVideoVersion`:

```ts
export interface TeamVideoVersion {
  id: string
  submission_id: string
  version_number: number
  storage_path: string | null
  original_filename: string | null
  duration_seconds: number | null
  size_bytes: number | null
  mime_type: string | null
  image_count: number | null
  status: TeamVideoVersionStatus
  uploaded_at: string | null
  created_at: string
}
```

Add the new `TeamSubmissionImage` interface after `TeamVideoVersion`:

```ts
export interface TeamSubmissionImage {
  id: string
  version_id: string
  position: number
  storage_path: string
  original_filename: string
  mime_type: "image/jpeg" | "image/png" | "image/webp"
  size_bytes: number
  width: number | null
  height: number | null
  created_at: string
}
```

- [ ] **Step 2: Run type check to confirm no callers broke**

Run: `npx tsc --noEmit`
Expected: zero errors. (We relaxed `storage_path`/`original_filename`/`mime_type`/`size_bytes` to nullable on `TeamVideoVersion` — callers that read these without a null check will be flagged; if any are, fix the call sites with the appropriate guard. Typical fix: `version.storage_path ?? ""` for paths used only when present, or an early return when null indicates an image_set version.)

- [ ] **Step 3: Commit**

```
git add types/database.ts
git commit -m "types: add kind/image_count + TeamSubmissionImage interface"
```

---

### Task A3: Zod validators

**Files:**
- Modify: `lib/validators/team-video.ts`
- Test: `__tests__/lib/validators/team-video-photo.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/validators/team-video-photo.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  createPhotoSubmissionSchema,
  createPhotoVersionSchema,
} from "@/lib/validators/team-video"

const okImage = {
  filename: "shot.jpg",
  mimeType: "image/jpeg" as const,
  sizeBytes: 1024,
  position: 0,
}

describe("createPhotoSubmissionSchema", () => {
  it("accepts 1 image", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "Coaching shot",
      images: [okImage],
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts 10 images", () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ ...okImage, position: i }))
    const parsed = createPhotoSubmissionSchema.safeParse({ title: "Carousel", images })
    expect(parsed.success).toBe(true)
  })

  it("rejects 0 images", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({ title: "T", images: [] })
    expect(parsed.success).toBe(false)
  })

  it("rejects 11 images", () => {
    const images = Array.from({ length: 11 }, (_, i) => ({ ...okImage, position: i }))
    const parsed = createPhotoSubmissionSchema.safeParse({ title: "T", images })
    expect(parsed.success).toBe(false)
  })

  it("rejects duplicate positions", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [okImage, { ...okImage, position: 0, filename: "b.jpg" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects non-contiguous positions starting at 1", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [{ ...okImage, position: 1 }],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects unsupported mime types", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [{ ...okImage, mimeType: "image/gif" as unknown as "image/jpeg" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects file > 8 MB", () => {
    const parsed = createPhotoSubmissionSchema.safeParse({
      title: "T",
      images: [{ ...okImage, sizeBytes: 8_388_609 }],
    })
    expect(parsed.success).toBe(false)
  })
})

describe("createPhotoVersionSchema", () => {
  it("accepts a valid revision payload", () => {
    const parsed = createPhotoVersionSchema.safeParse({ images: [okImage] })
    expect(parsed.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-video-photo`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Implement the schemas**

In `lib/validators/team-video.ts`, after the existing `createVersionSchema` block, add:

```ts
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB per image (IG ceiling)
const MAX_IMAGES_PER_SUBMISSION = 10

const imageSpecSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_IMAGE_MIME, { message: "Unsupported image format" }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_IMAGE_BYTES, "Image exceeds 8 MB limit"),
  position: z.number().int().min(0).max(MAX_IMAGES_PER_SUBMISSION - 1),
})

const imagesArraySchema = z
  .array(imageSpecSchema)
  .min(1, "At least one image is required")
  .max(MAX_IMAGES_PER_SUBMISSION, `At most ${MAX_IMAGES_PER_SUBMISSION} images allowed`)
  .superRefine((images, ctx) => {
    const positions = images.map((i) => i.position).sort((a, b) => a - b)
    const unique = new Set(positions)
    if (unique.size !== positions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image positions must be unique",
      })
    }
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `image positions must be contiguous starting at 0 (got ${positions.join(",")})`,
        })
        return
      }
    }
  })

export const createPhotoSubmissionSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  images: imagesArraySchema,
})

export type CreatePhotoSubmissionInput = z.infer<typeof createPhotoSubmissionSchema>

export const createPhotoVersionSchema = z.object({
  images: imagesArraySchema,
})

export type CreatePhotoVersionInput = z.infer<typeof createPhotoVersionSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-video-photo`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```
git add lib/validators/team-video.ts __tests__/lib/validators/team-video-photo.test.ts
git commit -m "feat(validators): photo submission + revision Zod schemas"
```

---

### Task A4: Storage helpers

**Files:**
- Modify: `lib/storage/team-videos.ts`
- Test: `__tests__/lib/storage/team-videos-images.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/storage/team-videos-images.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildImagePath } from "@/lib/storage/team-videos"

describe("buildImagePath", () => {
  it("prefixes position and sanitizes the filename", () => {
    const path = buildImagePath("sub-1", 2, 3, "My Photo  (final).jpg")
    expect(path).toBe("team-videos/sub-1/v2/3_My_Photo_final_.jpg")
  })

  it("caps the filename at 120 chars", () => {
    const long = "a".repeat(200) + ".jpg"
    const path = buildImagePath("sub-1", 1, 0, long)
    expect(path.startsWith("team-videos/sub-1/v1/0_")).toBe(true)
    // 0_ prefix (2) + 120 cap of sanitized filename
    expect(path.slice("team-videos/sub-1/v1/".length).length).toBe(2 + 120)
  })

  it("uses position-prefixed filename so order is visible in storage", () => {
    const a = buildImagePath("sub-1", 1, 0, "x.jpg")
    const b = buildImagePath("sub-1", 1, 1, "x.jpg")
    expect(a).toContain("/v1/0_x.jpg")
    expect(b).toContain("/v1/1_x.jpg")
  })
})

vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: vi.fn(),
}))

describe("createImageUploadUrls", () => {
  beforeEach(() => vi.resetModules())

  it("returns a signed URL per image", async () => {
    const getSignedUrl = vi.fn().mockResolvedValue(["https://signed.example/upload"])
    const file = vi.fn().mockReturnValue({ getSignedUrl })
    const bucket = vi.fn().mockReturnValue({ file })
    const { getAdminStorage } = await import("@/lib/firebase-admin")
    ;(getAdminStorage as ReturnType<typeof vi.fn>).mockReturnValue({ bucket })

    const { createImageUploadUrls } = await import("@/lib/storage/team-videos")
    const urls = await createImageUploadUrls([
      { storagePath: "p1", contentType: "image/jpeg" },
      { storagePath: "p2", contentType: "image/png" },
    ])

    expect(urls).toHaveLength(2)
    expect(urls[0].uploadUrl).toBe("https://signed.example/upload")
    expect(urls[0].storagePath).toBe("p1")
    expect(urls[0].expiresInSeconds).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-videos-images`
Expected: FAIL — `buildImagePath` / `createImageUploadUrls` not exported.

- [ ] **Step 3: Implement the helpers**

In `lib/storage/team-videos.ts`, after the existing `buildVersionPath` function, add:

```ts
/** Build the storage path for one image in an image_set version. */
export function buildImagePath(
  submissionId: string,
  versionNumber: number,
  position: number,
  filename: string,
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  return `${TEAM_VIDEO_PATH_PREFIX}/${submissionId}/v${versionNumber}/${position}_${safe}`
}

export interface ImageUploadSpec {
  storagePath: string
  contentType: string
}

export interface SignedImageUpload {
  storagePath: string
  uploadUrl: string
  expiresInSeconds: number
}

/**
 * Create N parallel Firebase v4 signed PUT URLs, one per image. Each upload is
 * independently signed; callers fire them in parallel from the browser.
 */
export async function createImageUploadUrls(
  images: ImageUploadSpec[],
): Promise<SignedImageUpload[]> {
  const bucket = getAdminStorage().bucket()
  return Promise.all(
    images.map(async (img) => {
      const file = bucket.file(img.storagePath)
      const [uploadUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + TEAM_VIDEO_UPLOAD_URL_TTL_MS,
        contentType: img.contentType,
      })
      return {
        storagePath: img.storagePath,
        uploadUrl,
        expiresInSeconds: Math.floor(TEAM_VIDEO_UPLOAD_URL_TTL_MS / 1000),
      }
    }),
  )
}

/**
 * Confirms a file exists in the team-videos bucket. Used by finalize to verify
 * every image actually got PUT before flipping submission status.
 */
export async function imageStorageObjectExists(storagePath: string): Promise<boolean> {
  const bucket = getAdminStorage().bucket()
  const [exists] = await bucket.file(storagePath).exists()
  return exists
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-videos-images`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```
git add lib/storage/team-videos.ts __tests__/lib/storage/team-videos-images.test.ts
git commit -m "feat(storage): photo upload path builder + signed URLs + existence check"
```

---

### Task A5: DAL — team-submission-images

**Files:**
- Create: `lib/db/team-submission-images.ts`
- Test: `__tests__/db/team-submission-images.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/db/team-submission-images.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from "@/lib/supabase"

beforeEach(() => vi.resetAllMocks())

function mockChain<T>(returnValue: { data: T; error: null } | { data: null; error: Error }) {
  const fn = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue(returnValue) }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(returnValue),
    }),
  })
  ;(createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: fn })
  return fn
}

describe("team-submission-images DAL", () => {
  it("createImagesForVersion inserts each image", async () => {
    const inserted = [
      { id: "i1", version_id: "v1", position: 0 },
      { id: "i2", version_id: "v1", position: 1 },
    ]
    mockChain({ data: inserted, error: null })

    const { createImagesForVersion } = await import("@/lib/db/team-submission-images")
    const rows = await createImagesForVersion("v1", [
      { position: 0, storagePath: "p0", originalFilename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000 },
      { position: 1, storagePath: "p1", originalFilename: "b.jpg", mimeType: "image/jpeg", sizeBytes: 1000 },
    ])
    expect(rows).toEqual(inserted)
  })

  it("listImagesForVersion returns rows ordered by position", async () => {
    const rows = [{ id: "i1", position: 0 }, { id: "i2", position: 1 }]
    mockChain({ data: rows, error: null })
    const { listImagesForVersion } = await import("@/lib/db/team-submission-images")
    expect(await listImagesForVersion("v1")).toEqual(rows)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-submission-images`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/team-submission-images.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamSubmissionImage } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface CreateImageInput {
  position: number
  storagePath: string
  originalFilename: string
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  sizeBytes: number
  width?: number | null
  height?: number | null
}

export async function createImagesForVersion(
  versionId: string,
  images: CreateImageInput[],
): Promise<TeamSubmissionImage[]> {
  const supabase = getClient()
  const rows = images.map((img) => ({
    version_id: versionId,
    position: img.position,
    storage_path: img.storagePath,
    original_filename: img.originalFilename,
    mime_type: img.mimeType,
    size_bytes: img.sizeBytes,
    width: img.width ?? null,
    height: img.height ?? null,
  }))
  const { data, error } = await supabase
    .from("team_submission_images")
    .insert(rows)
    .select()
  if (error) throw error
  return (data ?? []) as TeamSubmissionImage[]
}

export async function listImagesForVersion(
  versionId: string,
): Promise<TeamSubmissionImage[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_submission_images")
    .select("*")
    .eq("version_id", versionId)
    .order("position", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamSubmissionImage[]
}

export async function deleteImagesForVersion(versionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_submission_images")
    .delete()
    .eq("version_id", versionId)
  if (error) throw error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-submission-images`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/db/team-submission-images.ts __tests__/db/team-submission-images.test.ts
git commit -m "feat(db): team-submission-images DAL"
```

---

### Task A6: Submission + version DAL — accept kind/image_set

**Files:**
- Modify: `lib/db/team-video-submissions.ts`
- Modify: `lib/db/team-video-versions.ts`

- [ ] **Step 1: Extend createSubmission**

In `lib/db/team-video-submissions.ts`, change the signature and insert payload:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type {
  TeamVideoSubmission,
  TeamVideoSubmissionKind,
  TeamVideoSubmissionStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSubmission(input: {
  title: string
  description?: string | null
  submittedBy: string
  kind?: TeamVideoSubmissionKind
}): Promise<TeamVideoSubmission> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .insert({
      title: input.title,
      description: input.description ?? null,
      submitted_by: input.submittedBy,
      kind: input.kind ?? "video",
      status: "draft" as TeamVideoSubmissionStatus,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoSubmission
}
```

- [ ] **Step 2: Extend createVersion**

In `lib/db/team-video-versions.ts`, change the signature so file fields are optional (for image_set versions):

```ts
export async function createVersion(input: {
  submissionId: string
  versionNumber: number
  storagePath?: string | null
  originalFilename?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
}): Promise<TeamVideoVersion> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .insert({
      submission_id: input.submissionId,
      version_number: input.versionNumber,
      storage_path: input.storagePath ?? null,
      original_filename: input.originalFilename ?? null,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      status: "pending",
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoVersion
}
```

- [ ] **Step 3: Run the existing test suite to confirm nothing regressed**

Run: `npm run test:run -- team-video`
Expected: existing tests still PASS. Video submissions now omit `kind` (defaults to 'video' DB-side and 'video' in DAL), so existing call sites work unchanged.

- [ ] **Step 4: Commit**

```
git add lib/db/team-video-submissions.ts lib/db/team-video-versions.ts
git commit -m "feat(db): accept kind + nullable file fields for image_set versions"
```

---

### Task A7: Asset copy helper (team-videos → media-assets bucket)

**Files:**
- Modify: `lib/storage/team-videos.ts`

- [ ] **Step 1: Locate the media-assets bucket configuration**

Read `lib/storage/team-videos-config.ts` and then grep for `media-assets` storage helpers:

Run: `npm run test:run -- media-assets`
Read any helper that creates / reads files in the media-assets bucket (likely under `lib/storage/` or `lib/content-studio/`). Use the same `getAdminStorage().bucket()` pattern.

If no separate bucket helper exists, the project uses the default Firebase bucket with a `media-assets/` path prefix. In that case, "copy" means `bucket.file(src).copy(bucket.file(dst))` where `dst` is `media-assets/<submissionId>/<position>_<filename>`.

- [ ] **Step 2: Implement copyImageToMediaAssetsBucket**

Append to `lib/storage/team-videos.ts`:

```ts
const MEDIA_ASSETS_PATH_PREFIX = "media-assets"

/**
 * Copies a team-submission image into the media-assets path so the asset has
 * its own retention lifecycle separate from the editor pipeline. Returns the
 * new storage path and a public-style URL the media_assets row stores.
 *
 * Implementation: a server-side bucket-to-bucket copy. The source object stays
 * in team-videos for the audit trail.
 */
export async function copyImageToMediaAssetsBucket(input: {
  sourceStoragePath: string
  submissionId: string
  position: number
  originalFilename: string
}): Promise<{ storagePath: string; publicUrl: string }> {
  const bucket = getAdminStorage().bucket()
  const safe = input.originalFilename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  const destPath = `${MEDIA_ASSETS_PATH_PREFIX}/${input.submissionId}/${input.position}_${safe}`
  await bucket.file(input.sourceStoragePath).copy(bucket.file(destPath))
  // Build a signed read URL with a long TTL. The media_assets DAL stores this
  // verbatim in public_url. (Long TTL matches the existing video pattern.)
  const [publicUrl] = await bucket.file(destPath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
  })
  return { storagePath: destPath, publicUrl }
}
```

- [ ] **Step 3: Spot-check by reading the existing media_assets upload flow**

Open `app/api/admin/media-assets/route.ts` and confirm the bucket/path conventions match. If the existing route writes to a different bucket or prefix, update `MEDIA_ASSETS_PATH_PREFIX` and the URL builder to match. Phase C tests will catch a mismatch — but matching at write time is cheaper.

- [ ] **Step 4: Commit**

```
git add lib/storage/team-videos.ts
git commit -m "feat(storage): copy submission image into media-assets bucket"
```

---

### Task A8: Phase A verification

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all existing tests still pass; new Phase A tests pass.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Manual schema sanity**

Use `mcp__supabase__execute_sql` to confirm:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('team_video_submissions', 'team_video_versions', 'team_submission_images')
ORDER BY table_name, ordinal_position;
```

Expected: `team_video_submissions.kind` text NOT NULL, `team_video_versions.image_count` int NULL, `team_video_versions.storage_path` text NULL, `team_submission_images` exists with 9 expected columns.

Phase A done.

---

## Phase B — Editor + Admin UI

### Task B1: Feature flag

**Files:**
- Create: `lib/team-images/feature-flag.ts`
- Test: `__tests__/lib/team-images/feature-flag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/team-images/feature-flag.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

const originalEnv = process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED

afterEach(() => {
  process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED = originalEnv
})

describe("isTeamImagesEnabled", () => {
  it("returns true when env var is 'true'", () => {
    process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED = "true"
    expect(isTeamImagesEnabled()).toBe(true)
  })
  it("returns false when env var is missing", () => {
    delete process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED
    expect(isTeamImagesEnabled()).toBe(false)
  })
  it("returns false when env var is 'false'", () => {
    process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED = "false"
    expect(isTeamImagesEnabled()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- team-images/feature-flag`
Expected: FAIL.

- [ ] **Step 3: Implement the flag**

Create `lib/team-images/feature-flag.ts`:

```ts
/**
 * Phase B gate for editor photo submissions and admin image-set review.
 * Off by default; flip in preview, dogfood, then enable in prod.
 */
export function isTeamImagesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TEAM_IMAGES_ENABLED === "true"
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- team-images/feature-flag`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/team-images/feature-flag.ts __tests__/lib/team-images/feature-flag.test.ts
git commit -m "feat: team-images feature flag"
```

---

### Task B2: POST /api/editor/submissions/photos

**Files:**
- Create: `app/api/editor/submissions/photos/route.ts`
- Test: `__tests__/api/editor/submissions-photos.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/editor/submissions-photos.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  createSubmission: vi.fn(),
  setCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  createVersion: vi.fn(),
  nextVersionNumber: vi.fn(),
}))
vi.mock("@/lib/db/team-submission-images", () => ({
  createImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/storage/team-videos", () => ({
  buildImagePath: vi.fn((sub, ver, pos, name) => `team-videos/${sub}/v${ver}/${pos}_${name}`),
  createImageUploadUrls: vi.fn(),
}))
vi.mock("@/lib/team-images/feature-flag", () => ({
  isTeamImagesEnabled: vi.fn(() => true),
}))

import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { createImageUploadUrls } from "@/lib/storage/team-videos"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"
import { POST } from "@/app/api/editor/submissions/photos/route"

beforeEach(() => vi.clearAllMocks())

function req(body: unknown) {
  return new Request("http://localhost/api/editor/submissions/photos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/editor/submissions/photos", () => {
  it("401 unauthenticated", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(req({ title: "T", images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }))
    expect(res.status).toBe(401)
  })

  it("403 non-editor non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ title: "T", images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }))
    expect(res.status).toBe(403)
  })

  it("400 when feature flag disabled", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(isTeamImagesEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const res = await POST(req({ title: "T", images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }))
    expect(res.status).toBe(400)
  })

  it("400 invalid input", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    const res = await POST(req({ title: "T", images: [] }))
    expect(res.status).toBe(400)
  })

  it("creates submission, version, image rows, and returns signed PUTs", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(createSubmission as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1", kind: "image_set" })
    ;(nextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(createVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "img1", position: 0 }])
    ;(createImageUploadUrls as ReturnType<typeof vi.fn>).mockResolvedValue([
      { storagePath: "team-videos/sub1/v1/0_a.jpg", uploadUrl: "https://put.example", expiresInSeconds: 900 },
    ])
    const res = await POST(req({
      title: "Carousel",
      images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }],
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.submission.id).toBe("sub1")
    expect(json.version.id).toBe("v1")
    expect(json.uploads).toHaveLength(1)
    expect(json.uploads[0].position).toBe(0)
    expect(setCurrentVersion).toHaveBeenCalledWith("sub1", "v1")
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- submissions-photos`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

Create `app/api/editor/submissions/photos/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { buildImagePath, createImageUploadUrls } from "@/lib/storage/team-videos"
import { createPhotoSubmissionSchema } from "@/lib/validators/team-video"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!isTeamImagesEnabled()) {
    return NextResponse.json(
      { error: "Photo submissions are disabled. Set NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true." },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createPhotoSubmissionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const submission = await createSubmission({
    title: parsed.data.title,
    description: parsed.data.description,
    submittedBy: session.user.id,
    kind: "image_set",
  })

  const versionNumber = await nextVersionNumber(submission.id)
  const folderPrefix = `team-videos/${submission.id}/v${versionNumber}/`

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath: folderPrefix,
    originalFilename: null,
    mimeType: null,
    sizeBytes: null,
  })

  await setCurrentVersion(submission.id, version.id)

  const imageInputs = parsed.data.images.map((img) => ({
    position: img.position,
    storagePath: buildImagePath(submission.id, versionNumber, img.position, img.filename),
    originalFilename: img.filename,
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
  }))

  await createImagesForVersion(version.id, imageInputs)

  const uploads = await createImageUploadUrls(
    imageInputs.map((i) => ({ storagePath: i.storagePath, contentType: i.mimeType })),
  )

  return NextResponse.json(
    {
      submission,
      version,
      uploads: uploads.map((u, idx) => ({
        position: imageInputs[idx].position,
        uploadUrl: u.uploadUrl,
        storagePath: u.storagePath,
        expiresInSeconds: u.expiresInSeconds,
      })),
    },
    { status: 201 },
  )
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- submissions-photos`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add app/api/editor/submissions/photos/route.ts __tests__/api/editor/submissions-photos.test.ts
git commit -m "feat(api): editor photo submission endpoint"
```

---

### Task B3: POST /api/editor/submissions/[id]/photo-versions (revision)

**Files:**
- Create: `app/api/editor/submissions/[id]/photo-versions/route.ts`
- Test: `__tests__/api/editor/photo-versions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/editor/photo-versions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  createVersion: vi.fn(),
  nextVersionNumber: vi.fn(),
}))
vi.mock("@/lib/db/team-submission-images", () => ({
  createImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/storage/team-videos", () => ({
  buildImagePath: vi.fn((sub, ver, pos, name) => `team-videos/${sub}/v${ver}/${pos}_${name}`),
  createImageUploadUrls: vi.fn(),
}))
vi.mock("@/lib/team-images/feature-flag", () => ({ isTeamImagesEnabled: vi.fn(() => true) }))

import { auth } from "@/lib/auth"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { createImageUploadUrls } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/[id]/photo-versions/route"

beforeEach(() => vi.clearAllMocks())
const params = Promise.resolve({ id: "sub1" })

function req(body: unknown) {
  return new Request("http://localhost/api/editor/submissions/sub1/photo-versions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST photo-versions", () => {
  it("403 editor on someone else's submission", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u2", kind: "image_set", status: "revision_requested",
    })
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(403)
  })

  it("409 wrong kind", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "video", status: "revision_requested",
    })
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(409)
  })

  it("409 wrong status", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "approved",
    })
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(409)
  })

  it("happy path creates v2 with new images", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "revision_requested",
    })
    ;(nextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(2)
    ;(createVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v2" })
    ;(createImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "img1" }])
    ;(createImageUploadUrls as ReturnType<typeof vi.fn>).mockResolvedValue([
      { storagePath: "team-videos/sub1/v2/0_a.jpg", uploadUrl: "https://put", expiresInSeconds: 900 },
    ])
    const res = await POST(req({ images: [{ filename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000, position: 0 }] }), { params })
    expect(res.status).toBe(201)
    expect(setCurrentVersion).toHaveBeenCalledWith("sub1", "v2")
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- photo-versions`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `app/api/editor/submissions/[id]/photo-versions/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { buildImagePath, createImageUploadUrls } from "@/lib/storage/team-videos"
import { createPhotoVersionSchema } from "@/lib/validators/team-video"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!isTeamImagesEnabled()) {
    return NextResponse.json(
      { error: "Photo submissions are disabled." },
      { status: 400 },
    )
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (submission.kind !== "image_set") {
    return NextResponse.json({ error: "Submission is not a photo set" }, { status: 409 })
  }
  if (submission.status !== "revision_requested" && submission.status !== "draft") {
    return NextResponse.json(
      { error: "Cannot upload a new version in current state" },
      { status: 409 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createPhotoVersionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const versionNumber = await nextVersionNumber(submission.id)
  const folderPrefix = `team-videos/${submission.id}/v${versionNumber}/`

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath: folderPrefix,
  })
  await setCurrentVersion(submission.id, version.id)

  const imageInputs = parsed.data.images.map((img) => ({
    position: img.position,
    storagePath: buildImagePath(submission.id, versionNumber, img.position, img.filename),
    originalFilename: img.filename,
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
  }))
  await createImagesForVersion(version.id, imageInputs)

  const uploads = await createImageUploadUrls(
    imageInputs.map((i) => ({ storagePath: i.storagePath, contentType: i.mimeType })),
  )

  return NextResponse.json(
    {
      version,
      uploads: uploads.map((u, idx) => ({
        position: imageInputs[idx].position,
        uploadUrl: u.uploadUrl,
        storagePath: u.storagePath,
        expiresInSeconds: u.expiresInSeconds,
      })),
    },
    { status: 201 },
  )
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- photo-versions`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add app/api/editor/submissions/[id]/photo-versions/route.ts __tests__/api/editor/photo-versions.test.ts
git commit -m "feat(api): editor photo revision endpoint"
```

---

### Task B4: Finalize route — verify image PUTs landed

**Files:**
- Modify: `app/api/editor/submissions/[id]/finalize/route.ts`
- Test: `__tests__/api/editor/finalize-photos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/editor/finalize-photos.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setSubmissionStatus: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  finalizeVersion: vi.fn(),
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-submission-images", () => ({
  listImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/storage/team-videos", () => ({
  imageStorageObjectExists: vi.fn(),
}))
vi.mock("@/lib/email", () => ({ sendVideoUploadedEmail: vi.fn() }))
vi.mock("@/lib/url", () => ({ getBaseUrl: () => "http://localhost" }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => ({ data: [] }) }) }) })) }))

import { auth } from "@/lib/auth"
import { getSubmissionById, setSubmissionStatus } from "@/lib/db/team-video-submissions"
import { finalizeVersion, getCurrentVersion } from "@/lib/db/team-video-versions"
import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { imageStorageObjectExists } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/[id]/finalize/route"

beforeEach(() => vi.clearAllMocks())
const params = Promise.resolve({ id: "sub1" })
const req = () => new Request("http://localhost/api/editor/submissions/sub1/finalize", { method: "POST" })

describe("finalize for image_set", () => {
  it("409 when any image is missing from storage", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "draft", title: "T",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1", status: "pending" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "i1", storage_path: "p0", position: 0 },
      { id: "i2", storage_path: "p1", position: 1 },
    ])
    ;(imageStorageObjectExists as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const res = await POST(req(), { params })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.missingPositions).toEqual([1])
    expect(setSubmissionStatus).not.toHaveBeenCalled()
  })

  it("happy path flips submission to submitted when all images present", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "editor" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", submitted_by: "u1", kind: "image_set", status: "draft", title: "T",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1", status: "pending" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "i1", storage_path: "p0", position: 0 },
    ])
    ;(imageStorageObjectExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)

    const res = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(finalizeVersion).toHaveBeenCalledWith("v1")
    expect(setSubmissionStatus).toHaveBeenCalledWith("sub1", "submitted")
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- finalize-photos`
Expected: FAIL — the existing finalize route doesn't handle image_set.

- [ ] **Step 3: Add the image_set branch to the finalize route**

Modify `app/api/editor/submissions/[id]/finalize/route.ts`. After the existing `if (!version)` / `if (version.status === "uploaded")` checks and before `await finalizeVersion(version.id)`, insert:

```ts
  // For image_set submissions, verify every storage object actually landed
  // before flipping status. A missing object means a PUT failed; the client
  // should retry that specific position.
  if (submission.kind === "image_set") {
    const { listImagesForVersion } = await import("@/lib/db/team-submission-images")
    const { imageStorageObjectExists } = await import("@/lib/storage/team-videos")
    const images = await listImagesForVersion(version.id)
    const checks = await Promise.all(
      images.map(async (img) => ({
        position: img.position,
        exists: await imageStorageObjectExists(img.storage_path),
      })),
    )
    const missingPositions = checks.filter((c) => !c.exists).map((c) => c.position)
    if (missingPositions.length > 0) {
      return NextResponse.json(
        {
          error: "Some images failed to upload. Retry the missing positions.",
          missingPositions,
        },
        { status: 409 },
      )
    }
  }
```

(Use dynamic `await import(...)` so the existing video tests don't have to mock the new modules. Or hoist the imports to the top — pick whichever fits the codebase style; the existing finalize route uses top-level imports, so prefer that.)

If hoisting, move both imports to the top of the file alongside the existing ones.

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- finalize`
Expected: PASS (both new image_set tests and the existing video finalize tests).

- [ ] **Step 5: Commit**

```
git add app/api/editor/submissions/[id]/finalize/route.ts __tests__/api/editor/finalize-photos.test.ts
git commit -m "feat(api): finalize verifies image_set uploads landed"
```

---

### Task B5: PhotoSubmitDialog component

**Files:**
- Create: `components/editor/PhotoSubmitDialog.tsx`
- Test: `__tests__/components/editor/PhotoSubmitDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/editor/PhotoSubmitDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PhotoSubmitDialog } from "@/components/editor/PhotoSubmitDialog"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/firebase-client-upload", () => ({
  uploadToSignedUrl: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn() as unknown as typeof fetch
})

function fileOf(name: string, type = "image/jpeg", size = 1000) {
  return new File([new ArrayBuffer(size)], name, { type })
}

describe("PhotoSubmitDialog", () => {
  it("rejects > 10 files", async () => {
    render(<PhotoSubmitDialog open onClose={() => {}} />)
    const input = screen.getByLabelText(/Add photos/i) as HTMLInputElement
    const files = Array.from({ length: 11 }, (_, i) => fileOf(`p${i}.jpg`))
    fireEvent.change(input, { target: { files } })
    expect(await screen.findByText(/up to 10/i)).toBeInTheDocument()
  })

  it("rejects unsupported mime types", async () => {
    render(<PhotoSubmitDialog open onClose={() => {}} />)
    const input = screen.getByLabelText(/Add photos/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [fileOf("p.heic", "image/heic")] } })
    expect(await screen.findByText(/Unsupported/i)).toBeInTheDocument()
  })

  it("submits, uploads each file in parallel, finalizes", async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      // POST /api/editor/submissions/photos
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          submission: { id: "sub1" },
          version: { id: "v1" },
          uploads: [
            { position: 0, uploadUrl: "https://p0", storagePath: "team-videos/sub1/v1/0_a.jpg", expiresInSeconds: 900 },
            { position: 1, uploadUrl: "https://p1", storagePath: "team-videos/sub1/v1/1_b.jpg", expiresInSeconds: 900 },
          ],
        }),
      })
      // POST /api/editor/submissions/sub1/finalize
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })

    render(<PhotoSubmitDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: "Test set" } })
    fireEvent.change(screen.getByLabelText(/Add photos/i), {
      target: { files: [fileOf("a.jpg"), fileOf("b.jpg")] },
    })
    fireEvent.click(screen.getByRole("button", { name: /Submit/i }))

    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/editor/submissions/photos",
      )
    })
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
        "/api/editor/submissions/sub1/finalize",
      )
    })
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- PhotoSubmitDialog`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

Create `components/editor/PhotoSubmitDialog.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Image as ImageIcon, X, Upload, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { uploadToSignedUrl } from "@/lib/firebase-client-upload"

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const ACCEPT = ALLOWED_MIME.join(",")
const MAX_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 10

interface Props {
  open: boolean
  onClose: () => void
}

interface SelectedImage {
  file: File
  previewUrl: string
}

export function PhotoSubmitDialog({ open, onClose }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [images, setImages] = useState<SelectedImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  function addFiles(files: FileList | null) {
    if (!files) return
    setError(null)
    const incoming = Array.from(files)
    if (images.length + incoming.length > MAX_IMAGES) {
      setError(`You can attach up to ${MAX_IMAGES} photos.`)
      return
    }
    for (const f of incoming) {
      if (!(ALLOWED_MIME as readonly string[]).includes(f.type)) {
        setError(`Unsupported format: ${f.name}. Allowed: JPEG, PNG, WebP.`)
        return
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is too large (max 8 MB).`)
        return
      }
    }
    const added = incoming.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setImages([...images, ...added])
  }

  function removeAt(index: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return
    setImages((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function submit() {
    setError(null)
    if (!title.trim()) {
      setError("Title is required.")
      return
    }
    if (images.length === 0) {
      setError("Add at least one photo.")
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        images: images.map((img, position) => ({
          filename: img.file.name,
          mimeType: img.file.type,
          sizeBytes: img.file.size,
          position,
        })),
      }
      const res = await fetch("/api/editor/submissions/photos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? "Submission failed")
      }
      const { submission, uploads } = await res.json() as {
        submission: { id: string }
        uploads: Array<{ position: number; uploadUrl: string }>
      }

      const byPos = new Map(uploads.map((u) => [u.position, u.uploadUrl]))
      await Promise.all(
        images.map((img, position) => {
          const url = byPos.get(position)
          if (!url) throw new Error(`Missing upload URL for position ${position}`)
          return uploadToSignedUrl(url, img.file, () => {})
        }),
      )

      const finRes = await fetch(`/api/editor/submissions/${submission.id}/finalize`, {
        method: "POST",
      })
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }

      toast.success("Photo set submitted")
      images.forEach((i) => URL.revokeObjectURL(i.previewUrl))
      setImages([])
      setTitle("")
      setDescription("")
      onClose()
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed"
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-md bg-card border shadow-lg max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-heading text-lg text-primary">Submit photo set</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground" htmlFor="ps-title">
              Title
            </label>
            <Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coaching shot, behind-the-scenes…" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground" htmlFor="ps-desc">
              Description (optional)
            </label>
            <Textarea id="ps-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="ps-files"
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm font-medium hover:bg-muted/40"
            >
              <ImageIcon className="size-4" /> Add photos
            </label>
            <input
              ref={fileRef}
              id="ps-files"
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
              aria-label="Add photos"
            />
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Up to {MAX_IMAGES} · JPEG · PNG · WebP · max 8 MB each
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-2">
              <AlertTriangle className="size-4 text-error shrink-0 mt-0.5" />
              <p className="text-xs text-error">{error}</p>
            </div>
          )}

          {images.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img, idx) => (
                <li key={img.previewUrl} className="relative rounded-md border bg-muted/20">
                  <img src={img.previewUrl} alt={img.file.name} className="aspect-square w-full rounded-md object-cover" />
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" type="button" onClick={() => move(idx, idx - 1)} aria-label="Move left">←</Button>
                      <Button size="sm" variant="ghost" type="button" onClick={() => move(idx, idx + 1)} aria-label="Move right">→</Button>
                      <Button size="sm" variant="ghost" type="button" onClick={() => removeAt(idx)} aria-label="Remove">
                        <X className="size-3" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            <Upload className="mr-1.5 size-4" />
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- PhotoSubmitDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add components/editor/PhotoSubmitDialog.tsx __tests__/components/editor/PhotoSubmitDialog.test.tsx
git commit -m "feat(editor): photo submission dialog"
```

---

### Task B6: Editor dashboard — "New submission" menu

**Files:**
- Modify: `app/(editor)/editor/dashboard/page.tsx`

- [ ] **Step 1: Add a client-side wrapper that shows the dialog**

This page is a server component. The "New submission" affordance needs to become a small client island that owns the dialog state. Create `components/editor/NewSubmissionMenu.tsx`:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, FileVideo, Image as ImageIcon, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhotoSubmitDialog } from "@/components/editor/PhotoSubmitDialog"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

export function NewSubmissionMenu() {
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const photosEnabled = isTeamImagesEnabled()

  if (!photosEnabled) {
    return (
      <Button asChild size="sm" variant="secondary" className="bg-accent text-accent-foreground hover:bg-accent/90">
        <Link href="/editor/upload">
          <Upload className="mr-1.5 size-4" />
          Start upload
        </Link>
      </Button>
    )
  }

  return (
    <>
      <div className="relative">
        <Button
          size="sm"
          variant="secondary"
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => setOpen((v) => !v)}
        >
          <Upload className="mr-1.5 size-4" />
          New submission
          <ChevronDown className="ml-1 size-4" />
        </Button>
        {open && (
          <div className="absolute right-0 mt-2 w-56 rounded-md border bg-card shadow-md z-50">
            <Link
              href="/editor/upload"
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40"
              onClick={() => setOpen(false)}
            >
              <FileVideo className="size-4" /> Video
            </Link>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 text-left"
              onClick={() => {
                setOpen(false)
                setDialogOpen(true)
              }}
            >
              <ImageIcon className="size-4" /> Photos
            </button>
          </div>
        )}
      </div>
      <PhotoSubmitDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}
```

- [ ] **Step 2: Wire it into the dashboard**

In `app/(editor)/editor/dashboard/page.tsx`, replace the existing `<Button asChild size="sm" variant="secondary" …><Link href="/editor/upload">…Start upload</Link></Button>` block inside the `UploadCard` component with `<NewSubmissionMenu />`. Add `import { NewSubmissionMenu } from "@/components/editor/NewSubmissionMenu"` at the top.

- [ ] **Step 3: Verify visually**

Run: `npm run dev` (port 3050). Log in as an editor. With `NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true` in `.env.local`, confirm the new menu appears. With the flag off, the original "Start upload" button appears unchanged.

- [ ] **Step 4: Commit**

```
git add components/editor/NewSubmissionMenu.tsx app/(editor)/editor/dashboard/page.tsx
git commit -m "feat(editor): New submission menu gated by team-images flag"
```

---

### Task B7: ImageSetViewer component

**Files:**
- Create: `components/admin/team-videos/ImageSetViewer.tsx`
- Test: `__tests__/components/admin/team-videos/ImageSetViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/team-videos/ImageSetViewer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ImageSetViewer } from "@/components/admin/team-videos/ImageSetViewer"

const images = [
  { id: "i1", position: 0, signedUrl: "https://a", originalFilename: "a.jpg" },
  { id: "i2", position: 1, signedUrl: "https://b", originalFilename: "b.jpg" },
  { id: "i3", position: 2, signedUrl: "https://c", originalFilename: "c.jpg" },
]

describe("ImageSetViewer", () => {
  it("renders the first image by default", () => {
    render(<ImageSetViewer images={images} activeIndex={0} onActiveIndexChange={() => {}} />)
    expect(screen.getByRole("img", { name: /a.jpg/i })).toHaveAttribute("src", "https://a")
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument()
  })

  it("calls onActiveIndexChange when arrow keys are pressed", () => {
    const handler = vi.fn()
    render(<ImageSetViewer images={images} activeIndex={0} onActiveIndexChange={handler} />)
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(handler).toHaveBeenCalledWith(1)
  })

  it("clicking a thumbnail jumps to that image", () => {
    const handler = vi.fn()
    render(<ImageSetViewer images={images} activeIndex={0} onActiveIndexChange={handler} />)
    fireEvent.click(screen.getByRole("button", { name: /Go to image 3/i }))
    expect(handler).toHaveBeenCalledWith(2)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- ImageSetViewer`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

Create `components/admin/team-videos/ImageSetViewer.tsx`:

```tsx
"use client"

import { useEffect } from "react"

export interface ViewerImage {
  id: string
  position: number
  signedUrl: string
  originalFilename: string
}

interface Props {
  images: ViewerImage[]
  activeIndex: number
  onActiveIndexChange: (next: number) => void
}

export function ImageSetViewer({ images, activeIndex, onActiveIndexChange }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        if (activeIndex < images.length - 1) onActiveIndexChange(activeIndex + 1)
      } else if (e.key === "ArrowLeft") {
        if (activeIndex > 0) onActiveIndexChange(activeIndex - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeIndex, images.length, onActiveIndexChange])

  if (images.length === 0) {
    return (
      <div className="aspect-video rounded-md border bg-muted/30 grid place-items-center text-sm text-muted-foreground">
        No images on this version.
      </div>
    )
  }

  const active = images[activeIndex] ?? images[0]

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-black">
        <img
          src={active.signedUrl}
          alt={active.originalFilename}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
        />
        <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-mono tracking-wide text-white">
          {activeIndex + 1} of {images.length}
        </div>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img, idx) => (
          <li key={img.id}>
            <button
              type="button"
              onClick={() => onActiveIndexChange(idx)}
              aria-label={`Go to image ${idx + 1}`}
              className={`size-16 shrink-0 overflow-hidden rounded-md border transition ${
                idx === activeIndex ? "border-accent ring-2 ring-accent" : "border-border opacity-80 hover:opacity-100"
              }`}
            >
              <img src={img.signedUrl} alt="" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- ImageSetViewer`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add components/admin/team-videos/ImageSetViewer.tsx __tests__/components/admin/team-videos/ImageSetViewer.test.tsx
git commit -m "feat(admin): ImageSetViewer for photo submissions"
```

---

### Task B8: ReviewSurface — switch by submission.kind

**Files:**
- Modify: `components/admin/team-videos/ReviewSurface.tsx`
- Modify: `app/(admin)/admin/team-videos/[id]/page.tsx`

- [ ] **Step 1: Load images server-side for image_set submissions**

In `app/(admin)/admin/team-videos/[id]/page.tsx`, after the existing logic that loads `submission`, `version`, `comments`, and `versions`, add a branch that fetches images and signs URLs:

```ts
import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { createReadUrl } from "@/lib/storage/team-videos"

// ... after loading version and versions:

let imageSetImages: Array<{
  id: string
  position: number
  signedUrl: string
  originalFilename: string
}> = []

if (submission.kind === "image_set" && version) {
  const rows = await listImagesForVersion(version.id)
  imageSetImages = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      position: row.position,
      signedUrl: await createReadUrl(row.storage_path),
      originalFilename: row.original_filename,
    })),
  )
}
```

Pass `imageSetImages` into `<ReviewSurface ...>`.

- [ ] **Step 2: Add the kind branch to ReviewSurface**

In `components/admin/team-videos/ReviewSurface.tsx`:

1. Add `imageSetImages` to `Props`:
   ```ts
   imageSetImages?: Array<{
     id: string
     position: number
     signedUrl: string
     originalFilename: string
   }>
   ```
2. Import `ImageSetViewer` and add state for the active image index:
   ```tsx
   import { ImageSetViewer, type ViewerImage } from "./ImageSetViewer"
   const [activeImageIndex, setActiveImageIndex] = useState(0)
   ```
3. Replace the existing `<TeamVideoPlayer ...>` block with:
   ```tsx
   {submission.kind === "image_set" ? (
     <ImageSetViewer
       images={(imageSetImages ?? []) as ViewerImage[]}
       activeIndex={activeImageIndex}
       onActiveIndexChange={setActiveImageIndex}
     />
   ) : (
     <TeamVideoPlayer
       ref={playerRef}
       url={selectedSignedUrl ?? ""}
       onTimeUpdate={setCurrentTime}
       annotations={mergedView}
     />
   )}
   ```
4. Skip the `DrawingCanvas` and `DrawingToolbar` blocks when `submission.kind === "image_set"`:
   ```tsx
   {submission.kind !== "image_set" && drawingMode && (
     <DrawingCanvas ... />
   )}
   ```
   Wrap each drawing-related child the same way.

- [ ] **Step 3: Pass activeImageIndex to CommentEditor**

`CommentEditor` is the component that creates a comment. Pass:

```tsx
<CommentEditor
  submission={submission}
  version={version}
  currentTime={currentTime}
  currentImageIndex={activeImageIndex}
  ...
/>
```

(The actual prop wiring depends on the existing `CommentEditor` API — read it before this step. The minimum change: pass `currentImageIndex` so CommentEditor can write an `image_index` annotation when `submission.kind === "image_set"`.)

- [ ] **Step 4: Run all team-videos component tests**

Run: `npm run test:run -- team-videos`
Expected: existing tests still PASS. The new branch is additive; the video path is unchanged.

- [ ] **Step 5: Commit**

```
git add components/admin/team-videos/ReviewSurface.tsx app/(admin)/admin/team-videos/[id]/page.tsx
git commit -m "feat(admin): ReviewSurface renders ImageSetViewer for image_set submissions"
```

---

### Task B9: CommentEditor — image_index annotation

**Files:**
- Modify: `components/admin/team-videos/CommentEditor.tsx`
- Modify: `lib/validators/team-video.ts`

- [ ] **Step 1: Extend the annotation schema to allow image_index kind**

In `lib/validators/team-video.ts`, replace the current `drawingJsonSchema` export usage in `createCommentSchema` with a discriminated union. After `drawingJsonSchema`:

```ts
export const imageIndexAnnotationSchema = z.object({
  kind: z.literal("image_index"),
  index: z.number().int().min(0).max(9),
})

export const annotationSchema = z.union([drawingJsonSchema, imageIndexAnnotationSchema])
export type AnnotationInput = z.infer<typeof annotationSchema>
```

Then update `createCommentSchema` to use `annotationSchema` in place of `drawingJsonSchema.optional()`:

```ts
export const createCommentSchema = z
  .object({
    timecodeSeconds: z.number().min(0).nullable(),
    commentText: z.string().trim().min(1, "Comment cannot be empty").max(2000),
    annotation: annotationSchema.optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) => {
      // Drawing annotations require a timecode; image_index annotations don't.
      if (!d.annotation) return true
      if ("kind" in d.annotation && d.annotation.kind === "image_index") return true
      return d.timecodeSeconds != null
    },
    { message: "drawing annotation requires a timecode", path: ["annotation"] },
  )
  .refine(
    (d) => !d.parentId || !d.annotation,
    {
      message: "replies cannot carry their own annotation",
      path: ["annotation"],
    },
  )
```

- [ ] **Step 2: Update CommentEditor to send image_index annotations**

In `components/admin/team-videos/CommentEditor.tsx` (read the file first to find the relevant section):

- Accept `currentImageIndex: number | null` as a prop.
- When `submission.kind === "image_set"`, replace the "Pin to current frame" button with a "Pin to current image" button that toggles `useImagePin`.
- On submit, when `useImagePin` is true, include `annotation: { kind: "image_index", index: currentImageIndex }`.

- [ ] **Step 3: Write a test for the image_index annotation submit**

Add to `__tests__/components/admin/team-videos/CommentEditor.test.tsx` (file may need to be created):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CommentEditor } from "@/components/admin/team-videos/CommentEditor"

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
})

const submission = { id: "sub1", kind: "image_set" } as never
const version = { id: "v1" } as never

describe("CommentEditor (image_set)", () => {
  it("sends annotation.kind=image_index when pinning to current image", async () => {
    render(<CommentEditor submission={submission} version={version} currentTime={0} currentImageIndex={2} />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Crop is too tight" } })
    fireEvent.click(screen.getByRole("button", { name: /Pin to current image/i }))
    fireEvent.click(screen.getByRole("button", { name: /Post comment/i }))

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const body = JSON.parse(calls[0][1].body)
      expect(body.annotation).toEqual({ kind: "image_index", index: 2 })
    })
  })
})
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- CommentEditor`
Expected: PASS (existing video tests still pass; new image_index test passes).

- [ ] **Step 5: Commit**

```
git add lib/validators/team-video.ts components/admin/team-videos/CommentEditor.tsx __tests__/components/admin/team-videos/CommentEditor.test.tsx
git commit -m "feat(admin): image_index annotation for photo-set comments"
```

---

### Task B10: CommentThread renders "Image N" pill

**Files:**
- Modify: `components/shared/CommentThread.tsx`

- [ ] **Step 1: Read the file and find the annotation-rendering block**

Open `components/shared/CommentThread.tsx`. Locate where the existing video pin annotation is rendered (likely a small `<button>` showing a timecode like "0:24"). The pattern is what to follow.

- [ ] **Step 2: Branch on annotation kind**

Where the annotation pill is rendered, add:

```tsx
{annotation && "kind" in annotation && annotation.kind === "image_index" ? (
  <button
    type="button"
    onClick={() => onJumpToImage?.(annotation.index)}
    className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-accent"
  >
    Image {annotation.index + 1}
  </button>
) : (
  /* existing timecode pill */
)}
```

Add `onJumpToImage?: (index: number) => void` to the component's prop type. Threading this prop in from `ReviewSurface` to `CommentThread` enables clicking the pill to jump the viewer:

In `ReviewSurface.tsx`, when rendering `CommentThread` for an image_set submission, pass `onJumpToImage={(idx) => setActiveImageIndex(idx)}`.

- [ ] **Step 3: Add a snapshot test**

Add to `__tests__/components/admin/team-videos/CommentThread.test.tsx` (create or extend):

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CommentThread } from "@/components/shared/CommentThread"

describe("CommentThread image_index pill", () => {
  it("renders 'Image N' pill and calls onJumpToImage on click", () => {
    const onJump = vi.fn()
    render(
      <CommentThread
        comments={[
          {
            id: "c1",
            author_id: "u1",
            comment_text: "Crop too tight",
            created_at: new Date().toISOString(),
            status: "open",
            timecode_seconds: null,
            annotation: { kind: "image_index", index: 2 },
            version_id: "v1",
            parent_id: null,
          } as never,
        ]}
        onJumpToImage={onJump}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Image 3/i }))
    expect(onJump).toHaveBeenCalledWith(2)
  })
})
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- CommentThread`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add components/shared/CommentThread.tsx __tests__/components/admin/team-videos/CommentThread.test.tsx components/admin/team-videos/ReviewSurface.tsx
git commit -m "feat(comments): Image N pill jumps viewer for image_index annotations"
```

---

### Task B11: PhotoRevisionUploadZone

**Files:**
- Create: `components/editor/PhotoRevisionUploadZone.tsx`

- [ ] **Step 1: Mirror RevisionUploadZone for photos**

This is a small variation of `PhotoSubmitDialog` that hits `/photo-versions` instead of `/photos` and shows the same revision banner as `RevisionUploadZone`. Rather than re-test the entire dialog, refactor: extract the shared file-picking + parallel-upload core into a tiny hook `useParallelPhotoUpload`, and have both `PhotoSubmitDialog` and `PhotoRevisionUploadZone` consume it.

Pragmatically: copy `PhotoSubmitDialog`'s structure, drop the title/description fields, drop the dialog chrome, and switch the create-submission `fetch` to a create-photo-version `fetch` against `/api/editor/submissions/${submissionId}/photo-versions`. Show the same revision banner as the existing `RevisionUploadZone`.

Create `components/editor/PhotoRevisionUploadZone.tsx` following this pattern. Keep it under 200 lines.

- [ ] **Step 2: Render PhotoRevisionUploadZone in EditorVideoView for image_set submissions**

In `components/editor/EditorVideoView.tsx`, when `submission.kind === "image_set"` and `submission.status === "revision_requested"`, render `<PhotoRevisionUploadZone submissionId={submission.id} />` in place of the existing video `<RevisionUploadZone>`. Reuse the same conditional rendering pattern that already exists in that file.

- [ ] **Step 3: Smoke-test by running dev**

Run: `npm run dev` (port 3050). As editor: submit a photo set, have an admin request revision, then upload a revision via the new zone. Confirm the submission flips back to `submitted` after finalize.

- [ ] **Step 4: Commit**

```
git add components/editor/PhotoRevisionUploadZone.tsx components/editor/EditorVideoView.tsx
git commit -m "feat(editor): photo revision upload zone"
```

---

### Task B12: TeamVideoTable kind badge

**Files:**
- Modify: `components/admin/team-videos/TeamVideoTable.tsx`

- [ ] **Step 1: Render kind pill in the title cell**

In the row where the title is shown, after the title text, add:

```tsx
<span className={`ml-2 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
  submission.kind === "image_set"
    ? "bg-accent/10 text-accent"
    : "bg-primary/10 text-primary"
}`}>
  {submission.kind === "image_set" ? "Photos" : "Video"}
</span>
```

- [ ] **Step 2: Visual smoke**

Run: `npm run dev`. As admin, open `/admin/team-videos`. Confirm the new badge renders on both video and image_set rows.

- [ ] **Step 3: Commit**

```
git add components/admin/team-videos/TeamVideoTable.tsx
git commit -m "feat(admin): kind badge on team-videos list"
```

---

### Task B13: Phase B verification

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all tests PASS.

- [ ] **Step 2: Manual end-to-end smoke**

With `NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true`:
1. Editor logs in, picks "New submission → Photos", uploads 3 JPEGs, submits.
2. Admin opens the submission, browses images with arrow keys, posts a comment pinned to image 2, requests revision.
3. Editor uploads a revision (4 photos), submits.
4. Admin approves.

Submission row should show "Photos" badge throughout. Comments thread should render an "Image 2" pill that, when clicked, jumps the viewer.

Phase B done.

---

## Phase C — Send-to-Studio + Caption Job

### Task C1: AiJobType + Firebase function registration

**Files:**
- Modify: `lib/ai-jobs.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Add the new job type**

In `lib/ai-jobs.ts`, extend `AiJobType`:

```ts
export type AiJobType =
  | "program_generation"
  | "program_chat"
  | "week_generation"
  | "blog_generation"
  | "newsletter_generation"
  | "newsletter_send"
  | "admin_chat"
  | "ai_coach"
  | "social_fanout"
  | "video_transcription"
  | "video_vision"
  | "image_vision"
  | "image_caption_generation"
  | "tavily_research"
  | "tavily_fact_check"
  | "tavily_trending_scan"
  | "blog_from_video"
  | "newsletter_from_blog"
  | "seo_enhance"
  | "enhance_caption"
```

- [ ] **Step 2: Register the Firebase function**

In `functions/src/index.ts`, near the existing `imageVision` export:

```ts
export const imageCaptionGeneration = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "1GiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, anthropicApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "image_caption_generation") return

    const { handleImageCaptionGeneration } = await import("./image-caption-generation.js")
    await handleImageCaptionGeneration(event.params.jobId)
  },
)
```

- [ ] **Step 3: Commit (handler not yet implemented; will be next task)**

```
git add lib/ai-jobs.ts functions/src/index.ts
git commit -m "feat: register image_caption_generation Firebase function"
```

---

### Task C2: Image caption prompt builders

**Files:**
- Create: `functions/src/lib/image-caption-prompts.ts`
- Test: `functions/src/lib/__tests__/image-caption-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/lib/__tests__/image-caption-prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildCaptionPrompt, type CaptionPlatform } from "../image-caption-prompts.js"

describe("buildCaptionPrompt", () => {
  it("includes platform-specific instructions for instagram", () => {
    const p = buildCaptionPrompt("instagram", 1)
    expect(p).toMatch(/hashtags/i)
    expect(p).toMatch(/instagram/i)
  })

  it("includes carousel guidance when imageCount > 1", () => {
    const p = buildCaptionPrompt("instagram", 4)
    expect(p).toMatch(/swipe|sequence|progression/i)
  })

  it("includes no-hashtag rule for facebook", () => {
    const p = buildCaptionPrompt("facebook", 1)
    expect(p).toMatch(/no hashtags|without hashtags/i)
  })

  it("includes hook-first for tiktok", () => {
    const p = buildCaptionPrompt("tiktok", 1)
    expect(p).toMatch(/hook/i)
  })

  it("includes professional/longer-form for linkedin", () => {
    const p = buildCaptionPrompt("linkedin", 1)
    expect(p).toMatch(/professional|story|sentences/i)
  })

  it("requires JSON output in every platform's prompt", () => {
    const platforms: CaptionPlatform[] = ["instagram", "facebook", "tiktok", "linkedin"]
    for (const p of platforms) {
      expect(buildCaptionPrompt(p, 1)).toMatch(/JSON object/i)
    }
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run from project root: `npm run test:run -- image-caption-prompts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the prompt builder**

Create `functions/src/lib/image-caption-prompts.ts`:

```ts
export type CaptionPlatform = "instagram" | "facebook" | "tiktok" | "linkedin"

const BASE_SYSTEM = `You are writing social-media captions for Darren Paul, a performance/coaching brand. Tone is direct, motivational, no medical claims, no fabricated personal records, no specific numbers unless the user provided them.`

const PLATFORM_RULES: Record<CaptionPlatform, string> = {
  instagram: `Platform: Instagram.
- Hook: one tight opener line.
- Body: 2-4 short lines.
- Hashtags: 5-10, lowercase, single-word, no punctuation.
- Max caption length: 2200 chars; aim for ~600.`,
  facebook: `Platform: Facebook.
- Conversational, 2-3 sentences.
- Write WITHOUT hashtags (no hashtags whatsoever).
- End with a question or a soft CTA.
- Max caption length: 5000 chars; aim for ~400.`,
  tiktok: `Platform: TikTok.
- Hook-first: the first line must be ≤ 60 chars and grab attention.
- Body: 1-2 short follow-up lines.
- Hashtags: 3-5, lowercase, single-word.
- Max caption length: 2200 chars; aim for ~300.`,
  linkedin: `Platform: LinkedIn.
- Professional tone with story arc.
- 3-6 sentences, paragraph breaks welcome.
- Hashtags: 0-3, PascalCase or lowercase, single-word.
- Max caption length: 3000 chars; aim for ~800.`,
}

const CAROUSEL_NOTE = `These images form a sequence. Reference the progression — e.g., "swipe to see…", "from setup to finish", or "frame by frame". Do not describe each image; capture the arc.`

const SINGLE_NOTE = `One image. Write a caption rooted in what's visible.`

const OUTPUT_RULE = `Return ONLY a JSON object:
{ "caption": "<the caption>", "hashtags": ["<tag1>", "<tag2>", ...], "cta": "<optional short CTA or null>" }
Rules:
- hashtags lowercase, single-word, no '#'.
- caption must not exceed the platform max.
- No preamble. No markdown fence. JSON only.`

export function buildCaptionPrompt(platform: CaptionPlatform, imageCount: number): string {
  const seq = imageCount > 1 ? CAROUSEL_NOTE : SINGLE_NOTE
  return [BASE_SYSTEM, PLATFORM_RULES[platform], seq, OUTPUT_RULE].join("\n\n")
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- image-caption-prompts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add functions/src/lib/image-caption-prompts.ts functions/src/lib/__tests__/image-caption-prompts.test.ts
git commit -m "feat(functions): per-platform image caption prompt builders"
```

---

### Task C3: Image caption generation handler

**Files:**
- Create: `functions/src/image-caption-generation.ts`
- Test: `functions/src/__tests__/image-caption-generation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/__tests__/image-caption-generation.test.ts`. Pattern off the existing `image-vision.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdate = vi.fn()
const mockGet = vi.fn()
const mockDoc = vi.fn(() => ({ update: mockUpdate, get: mockGet }))
const mockCollection = vi.fn(() => ({ doc: mockDoc }))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "ts" },
  getFirestore: () => ({ collection: mockCollection }),
}))

const mockFile = { download: vi.fn() }
const mockBucket = { file: () => mockFile }
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({ bucket: () => mockBucket }),
}))

const mockSupabaseSelect = vi.fn()
const mockSupabaseUpdate = vi.fn()
vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ in: mockSupabaseSelect }),
      }),
      update: () => ({ eq: mockSupabaseUpdate }),
    }),
  }),
}))

const mockCreateMessage = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreateMessage }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "sk-test"
})

import { handleImageCaptionGeneration } from "../image-caption-generation.js"

describe("handleImageCaptionGeneration", () => {
  it("writes caption + hashtags to social_posts on success", async () => {
    mockGet.mockResolvedValueOnce({
      data: () => ({
        type: "image_caption_generation",
        input: { socialPostId: "post1", platform: "instagram", mediaAssetIds: ["a1"] },
      }),
    })
    mockSupabaseSelect.mockResolvedValueOnce({
      data: [{ id: "a1", storage_path: "p", mime_type: "image/jpeg" }],
      error: null,
    })
    mockFile.download.mockResolvedValueOnce([Buffer.from("img")])
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"caption":"Hook line\\n\\nBody.","hashtags":["squat","reps"],"cta":null}' }],
    })

    await handleImageCaptionGeneration("job1")

    // Find the supabase.from('social_posts').update() call
    expect(mockSupabaseUpdate).toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }))
  })

  it("fails the job when input.socialPostId is missing", async () => {
    mockGet.mockResolvedValueOnce({
      data: () => ({ type: "image_caption_generation", input: { platform: "instagram", mediaAssetIds: ["a1"] } }),
    })
    await handleImageCaptionGeneration("job1")
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }))
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test:run -- image-caption-generation`
Expected: FAIL.

- [ ] **Step 3: Implement the handler**

Create `functions/src/image-caption-generation.ts`:

```ts
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabase } from "./lib/supabase.js"
import {
  buildCaptionPrompt,
  type CaptionPlatform,
} from "./lib/image-caption-prompts.js"

const MODEL = "claude-sonnet-4-6"
const MAX_TOKENS = 800

const PLATFORM_MAX: Record<CaptionPlatform, number> = {
  instagram: 2200,
  facebook: 5000,
  tiktok: 2200,
  linkedin: 3000,
}

const HASHTAG_RE = /^[a-z0-9_]{1,30}$/

interface JobInput {
  socialPostId?: string
  platform?: CaptionPlatform
  mediaAssetIds?: string[]
  force?: boolean
}

interface ParsedCaption {
  caption: string
  hashtags: string[]
  cta: string | null
}

function safeParse(raw: string): ParsedCaption | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(cleaned) as Partial<ParsedCaption>
    if (typeof parsed.caption !== "string") return null
    return {
      caption: parsed.caption,
      hashtags: Array.isArray(parsed.hashtags)
        ? parsed.hashtags.filter((x): x is string => typeof x === "string" && HASHTAG_RE.test(x))
        : [],
      cta: typeof parsed.cta === "string" ? parsed.cta : null,
    }
  } catch {
    return null
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + "…"
}

export async function handleImageCaptionGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function fail(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) return await fail("ai_jobs doc disappeared")

    const input = (data.input ?? {}) as JobInput
    const { socialPostId, platform, mediaAssetIds } = input
    if (!socialPostId) return await fail("input.socialPostId is required")
    if (!platform) return await fail("input.platform is required")
    if (!mediaAssetIds || mediaAssetIds.length === 0)
      return await fail("input.mediaAssetIds must be non-empty")

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const { data: assets, error } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type")
      .eq("kind", "image")
      .in("id", mediaAssetIds)
    if (error || !assets || assets.length === 0)
      return await fail(`media_assets not found for ${mediaAssetIds.join(",")}`)

    // Preserve mediaAssetIds order in the prompt.
    const byId = new Map(assets.map((a) => [a.id as string, a]))
    const ordered = mediaAssetIds.map((id) => byId.get(id)).filter(Boolean) as Array<{
      id: string
      storage_path: string
      mime_type: string
    }>

    const bucket = getStorage().bucket()
    const imageBlocks = await Promise.all(
      ordered.map(async (a) => {
        const [buf] = await bucket.file(a.storage_path).download()
        const mt = (a.mime_type as "image/jpeg" | "image/png" | "image/webp") ?? "image/jpeg"
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mt,
            data: buf.toString("base64"),
          },
        }
      }),
    )

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const client = new Anthropic({ apiKey })

    const system = buildCaptionPrompt(platform, ordered.length)
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: "Write the caption per the system instructions." },
          ],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : ""
    const parsed = safeParse(raw)
    if (!parsed) return await fail("Could not parse caption JSON from model")

    const caption = truncate(parsed.caption.trim(), PLATFORM_MAX[platform])
    const hashtagsLine = parsed.hashtags.length > 0
      ? "\n\n" + parsed.hashtags.map((h) => `#${h}`).join(" ")
      : ""
    const fullCaption = truncate(caption + hashtagsLine, PLATFORM_MAX[platform])

    const { error: updateErr } = await supabase
      .from("social_posts")
      .update({
        content: fullCaption,
        metadata: {
          image_caption_job_id: jobId,
          image_caption_hashtags: parsed.hashtags,
          image_caption_cta: parsed.cta,
          ai_generated_at: new Date().toISOString(),
        },
      })
      .eq("id", socialPostId)
    if (updateErr) return await fail(`Failed to write caption to social_posts: ${updateErr.message}`)

    await jobRef.update({
      status: "completed",
      result: { socialPostId, captionLength: fullCaption.length, hashtagCount: parsed.hashtags.length },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await fail((err as Error).message ?? "Unknown image-caption error")
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm run test:run -- image-caption-generation`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add functions/src/image-caption-generation.ts functions/src/__tests__/image-caption-generation.test.ts
git commit -m "feat(functions): image_caption_generation handler"
```

---

### Task C4: Map platform plugin → social platform for connection check

**Files:**
- No new file required — reuse `lib/db/platform-connections.ts` `listPlatformConnections()`

Background: this codebase is a single-admin app. Platform credentials live in `platform_connections` keyed by `plugin_name` (Instagram, Facebook, etc.), accessed via `listPlatformConnections()` in `lib/db/platform-connections.ts`. The plugin-name → `SocialPlatform` mapping is straightforward but needs to be explicit because plugin names and social platform values aren't always identical strings.

- [ ] **Step 1: Find the existing mapping (or add one)**

Run: `Grep` for `PlatformPluginName` and `SocialPlatform` to confirm whether a converter (e.g., `pluginNameToPlatform`) already exists. The `lib/social/plugins/` directory typically owns this.

If a converter exists, use it directly in Task C5. No code change needed here.

If no converter exists, add one to `lib/social/platform-mapping.ts`:

```ts
import type { PlatformPluginName, SocialPlatform } from "@/types/database"

const MAP: Record<PlatformPluginName, SocialPlatform | null> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
  youtube_shorts: "youtube_shorts",
}

export function pluginNameToPlatform(name: PlatformPluginName): SocialPlatform | null {
  return MAP[name] ?? null
}
```

Adjust the keys to match the actual `PlatformPluginName` union in `types/database.ts`.

- [ ] **Step 2: Commit only if a new file was added**

```
git add lib/social/platform-mapping.ts
git commit -m "feat: plugin name → SocialPlatform mapping"
```

---

### Task C5: send-to-content-studio — image_set branch

**Files:**
- Modify: `app/api/admin/team-videos/[id]/send-to-content-studio/route.ts`
- Test: `__tests__/api/admin/team-videos/send-to-content-studio.test.ts`

- [ ] **Step 1: Extend the test file with image_set cases**

Append to `__tests__/api/admin/team-videos/send-to-content-studio.test.ts`:

```ts
// --- image_set branch -------------------------------------------------

vi.mock("@/lib/db/team-submission-images", () => ({
  listImagesForVersion: vi.fn(),
}))
vi.mock("@/lib/db/media-assets", () => ({
  createMediaAsset: vi.fn(),
}))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: vi.fn(),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: vi.fn(),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: vi.fn(),
}))
vi.mock("@/lib/storage/team-videos", async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    copyImageToMediaAssetsBucket: vi.fn(),
  }
})
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: vi.fn() }))

import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { createMediaAsset } from "@/lib/db/media-assets"
import { createSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { copyImageToMediaAssetsBucket } from "@/lib/storage/team-videos"
import { createAiJob } from "@/lib/ai-jobs"

describe("send-to-content-studio image_set branch", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates media_assets + per-platform draft posts + caption jobs", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "admin1", role: "admin" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "Coaching", kind: "image_set",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "img1", position: 0, storage_path: "team-videos/sub1/v1/0_a.jpg", original_filename: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 1080, height: 1080 },
      { id: "img2", position: 1, storage_path: "team-videos/sub1/v1/1_b.jpg", original_filename: "b.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 1080, height: 1080 },
    ])
    ;(copyImageToMediaAssetsBucket as ReturnType<typeof vi.fn>).mockImplementation(async ({ position }) => ({
      storagePath: `media-assets/sub1/${position}_x.jpg`,
      publicUrl: `https://signed/${position}`,
    }))
    ;(createMediaAsset as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "ma1" })
      .mockResolvedValueOnce({ id: "ma2" })
    ;(listPlatformConnections as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin_name: "instagram" }, { plugin_name: "facebook" },
    ])
    ;(createSocialPost as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "post-ig" })
      .mockResolvedValueOnce({ id: "post-fb" })
    ;(createAiJob as ReturnType<typeof vi.fn>).mockResolvedValue({ jobId: "j1", status: "pending" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.kind).toBe("image_set")
    expect(json.mediaAssetIds).toEqual(["ma1", "ma2"])
    expect(json.socialPostIds).toEqual(["post-ig", "post-fb"])

    // Carousel post type because 2 images
    expect(createSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "instagram", post_type: "carousel", approval_status: "draft" }),
    )
    // 2 assets × 2 platforms = 4 attachments
    expect(attachMedia).toHaveBeenCalledTimes(4)
    // One caption job per platform
    expect(createAiJob).toHaveBeenCalledTimes(2)
    expect(createAiJob).toHaveBeenCalledWith(expect.objectContaining({
      type: "image_caption_generation",
      input: expect.objectContaining({ platform: "instagram", mediaAssetIds: ["ma1", "ma2"] }),
    }))
    expect(lockSubmission).toHaveBeenCalledWith("sub1")
  })

  it("skips platforms that don't support carousel", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "admin1", role: "admin" } })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "T", kind: "image_set",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listImagesForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "img1", position: 0, storage_path: "p0", original_filename: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000 },
      { id: "img2", position: 1, storage_path: "p1", original_filename: "b.jpg", mime_type: "image/jpeg", size_bytes: 1000 },
    ])
    ;(copyImageToMediaAssetsBucket as ReturnType<typeof vi.fn>).mockResolvedValue({ storagePath: "x", publicUrl: "u" })
    ;(createMediaAsset as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ma" })
    // YouTube doesn't support image at all (per post-type-support.ts matrix).
    ;(listPlatformConnections as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin_name: "instagram" }, { plugin_name: "youtube" },
    ])
    ;(createSocialPost as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "post-ig" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.socialPostIds).toEqual(["post-ig"])
  })
})
```

- [ ] **Step 2: Implement the branch**

In `app/api/admin/team-videos/[id]/send-to-content-studio/route.ts`, branch on `submission.kind`. Replace the body of the POST handler with:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { createAiJob } from "@/lib/ai-jobs"
import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { createMediaAsset } from "@/lib/db/media-assets"
import { createSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { copyImageToMediaAssetsBucket } from "@/lib/storage/team-videos"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"
import { pluginNameToPlatform } from "@/lib/social/platform-mapping"
import type { PostType, SocialPlatform } from "@/types/database"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  if (submission.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved submissions can be sent to Content Studio" },
      { status: 409 },
    )
  }
  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No current version" }, { status: 409 })

  if (submission.kind === "image_set") {
    return await sendImageSet(submission, version, session.user.id)
  }
  return await sendVideo(submission, version, session.user.id)
}

async function sendVideo(submission: any, version: any, adminId: string) {
  const videoUpload = await createVideoUpload({
    storage_path: version.storage_path,
    original_filename: version.original_filename,
    duration_seconds: version.duration_seconds,
    size_bytes: version.size_bytes,
    mime_type: version.mime_type,
    title: submission.title,
    uploaded_by: adminId,
    status: "uploaded",
  })
  await lockSubmission(submission.id)
  try {
    await createAiJob({
      type: "video_transcription",
      userId: adminId,
      input: { videoUploadId: videoUpload.id },
    })
  } catch (err) {
    console.error(
      `[send-to-content-studio] Failed to auto-queue transcription: ${(err as Error).message}`,
    )
  }
  return NextResponse.json({ kind: "video", videoUpload }, { status: 201 })
}

async function sendImageSet(submission: any, version: any, adminId: string) {
  const images = await listImagesForVersion(version.id)
  if (images.length === 0) {
    return NextResponse.json({ error: "Image set has no images" }, { status: 409 })
  }

  // 1. Copy each image into the media-assets bucket and create asset rows.
  const assets = await Promise.all(
    images.map(async (img) => {
      const { storagePath, publicUrl } = await copyImageToMediaAssetsBucket({
        sourceStoragePath: img.storage_path,
        submissionId: submission.id,
        position: img.position,
        originalFilename: img.original_filename,
      })
      const asset = await createMediaAsset({
        kind: "image",
        storage_path: storagePath,
        public_url: publicUrl,
        mime_type: img.mime_type,
        bytes: img.size_bytes,
        width: img.width,
        height: img.height,
        duration_ms: null,
        derived_from_video_id: null,
        ai_alt_text: null,
        ai_analysis: null,
        created_by: adminId,
      })
      return { mediaAssetId: asset.id, position: img.position }
    }),
  )
  const orderedAssetIds = assets
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((a) => a.mediaAssetId)

  const postType: PostType = orderedAssetIds.length >= 2 ? "carousel" : "image"

  // 2. For each connected, compatible platform create one draft post.
  const connections = await listPlatformConnections()
  const compatible = connections
    .map((c) => pluginNameToPlatform(c.plugin_name))
    .filter((p): p is SocialPlatform => p !== null && isPlatformPostTypeSupported(p, postType))
  const socialPostIds: string[] = []
  for (const platform of compatible) {
    const post = await createSocialPost({
      platform,
      content: "",
      approval_status: "draft",
      post_type: postType,
      scheduled_at: null,
      source_video_id: null,
      media_url: null,
      created_by: adminId,
    } as Parameters<typeof createSocialPost>[0])
    for (let i = 0; i < orderedAssetIds.length; i++) {
      await attachMedia(post.id, orderedAssetIds[i], i)
    }
    socialPostIds.push(post.id)

    // 3. Queue a caption-generation job per (post, platform).
    try {
      await createAiJob({
        type: "image_caption_generation",
        userId: adminId,
        input: {
          socialPostId: post.id,
          platform,
          mediaAssetIds: orderedAssetIds,
        },
      })
    } catch (err) {
      console.error(
        `[send-to-content-studio] Failed to queue caption job for post ${post.id}: ${(err as Error).message}`,
      )
    }
  }

  await lockSubmission(submission.id)

  return NextResponse.json(
    {
      kind: "image_set",
      mediaAssetIds: orderedAssetIds,
      socialPostIds,
    },
    { status: 201 },
  )
}
```

A note on `createSocialPost`: the existing DAL signature in `lib/db/social-posts.ts` takes an `Omit<SocialPost, ...>` shape. The cast `as Parameters<typeof createSocialPost>[0]` is a pragmatic bridge — if the codebase has stronger typed factories, prefer those. Read `lib/db/social-posts.ts` first and match the call signature exactly.

- [ ] **Step 3: Run test to confirm pass**

Run: `npm run test:run -- send-to-content-studio`
Expected: PASS (existing video tests still pass; new image_set tests pass).

- [ ] **Step 4: Commit**

```
git add app/api/admin/team-videos/[id]/send-to-content-studio/route.ts __tests__/api/admin/team-videos/send-to-content-studio.test.ts
git commit -m "feat(api): send-to-content-studio image_set branch + caption jobs"
```

---

### Task C6: Playwright E2E

**Files:**
- Create: `__tests__/e2e/team-image-submissions.spec.ts`

- [ ] **Step 1: Write the spec mirroring team-video-flow.spec.ts**

Create `__tests__/e2e/team-image-submissions.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const EDITOR_EMAIL = process.env.E2E_EDITOR_EMAIL
const EDITOR_PASSWORD = process.env.E2E_EDITOR_PASSWORD
const FIXTURES = [
  join(process.cwd(), "__tests__/fixtures/sample-1.jpg"),
  join(process.cwd(), "__tests__/fixtures/sample-2.jpg"),
  join(process.cwd(), "__tests__/fixtures/sample-3.jpg"),
]

test.describe("Team image submissions", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !EDITOR_EMAIL || !EDITOR_PASSWORD || FIXTURES.some((f) => !existsSync(f)),
    "Requires E2E_*_EMAIL/PASSWORD env + __tests__/fixtures/sample-1..3.jpg + NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true",
  )

  let submissionId: string

  test.afterAll(async () => {
    if (!submissionId) return
    const supabase = createServiceRoleClient()
    await supabase.from("team_video_submissions").delete().eq("id", submissionId)
  })

  test("editor submits photo set → admin reviews → approves → sends to Studio", async ({ browser }) => {
    // EDITOR: open dashboard, pick "New submission → Photos"
    const editorCtx = await browser.newContext()
    const editorPage = await editorCtx.newPage()
    await editorPage.goto("/login")
    await editorPage.getByLabel(/email/i).fill(EDITOR_EMAIL!)
    await editorPage.getByLabel(/password/i).fill(EDITOR_PASSWORD!)
    await editorPage.getByRole("button", { name: /log in/i }).click()
    await editorPage.waitForURL("**/editor/**")

    await editorPage.getByRole("button", { name: /New submission/i }).click()
    await editorPage.getByRole("button", { name: /Photos/i }).click()

    const title = `E2E photo set ${Date.now()}`
    await editorPage.getByLabel(/^Title$/i).fill(title)
    await editorPage.getByLabel(/Add photos/i).setInputFiles(FIXTURES)
    await editorPage.getByRole("button", { name: /^Submit$/i }).click()
    await expect(editorPage.getByText(/Photo set submitted/i)).toBeVisible({ timeout: 30000 })

    // Find the submission id from the DB so we can clean up after.
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("team_video_submissions")
      .select("id")
      .eq("title", title)
      .maybeSingle()
    submissionId = (data as { id: string } | null)?.id ?? ""
    expect(submissionId).toBeTruthy()

    // ADMIN: open the submission, comment on image 2, approve, send to studio.
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto("/login")
    await adminPage.getByLabel(/email/i).fill(ADMIN_EMAIL!)
    await adminPage.getByLabel(/password/i).fill(ADMIN_PASSWORD!)
    await adminPage.getByRole("button", { name: /log in/i }).click()
    await adminPage.waitForURL("**/admin/**")

    await adminPage.goto(`/admin/team-videos/${submissionId}`)
    await expect(adminPage.getByText(/1 of 3/i)).toBeVisible()
    await adminPage.keyboard.press("ArrowRight")
    await expect(adminPage.getByText(/2 of 3/i)).toBeVisible()

    await adminPage.getByPlaceholder(/Add a comment/i).fill("E2E pin")
    await adminPage.getByRole("button", { name: /Pin to current image/i }).click()
    await adminPage.getByRole("button", { name: /Post comment/i }).click()
    await expect(adminPage.getByRole("button", { name: /Image 2/i })).toBeVisible()

    await adminPage.getByRole("button", { name: /^Approve$/i }).click()
    await adminPage.getByRole("button", { name: /Send to Content Studio/i }).click()
    await expect(adminPage.getByText(/Sent to Content Studio/i)).toBeVisible({ timeout: 30000 })
  })
})
```

- [ ] **Step 2: Add fixture images**

The existing `team-video-flow.spec.ts` reads fixtures from `__tests__/fixtures/`. Add three small JPEGs there: `sample-1.jpg`, `sample-2.jpg`, `sample-3.jpg`. Use any test images < 100 KB each.

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e -- team-image-submissions`
Expected: PASS.

- [ ] **Step 4: Commit**

```
git add __tests__/e2e/team-image-submissions.spec.ts __tests__/fixtures/sample-*.jpg
git commit -m "test(e2e): team image submission happy path"
```

---

### Task C7: Phase C verification

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all tests PASS.

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: all e2e PASS.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Functions build check**

Run: `cd functions && npm run build`
Expected: zero errors.

- [ ] **Step 5: Manual smoke against a real Anthropic key**

With `ANTHROPIC_API_KEY` set in `functions/.env.local` (or via Firebase secret), trigger one real send-to-studio with a 2-image submission. Confirm:
- 2 (or more) draft posts appear in Content Studio under the correct platforms
- Each post's `media_url` is the position-0 image
- After a minute, each post's `content` populates with a platform-appropriate caption
- `media_assets` rows have nullable `ai_alt_text` (image_vision is a separate job, not chained here yet — out of scope)

- [ ] **Step 6: Commit any test fixture or environment doc updates**

```
git add .env.example
git commit -m "docs: NEXT_PUBLIC_TEAM_IMAGES_ENABLED env var"
```

(If `.env.example` doesn't exist or doesn't list this var, add it.)

Phase C done. Feature is shippable behind `NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true`.

---

## Rollout checklist

- [ ] Migration `00125_team_submission_images.sql` applied to prod via Supabase MCP
- [ ] `NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true` in preview env; UI dogfooded for ≥ 1 real submission
- [ ] Anthropic budget verified < $0.50/submission for a 4-image carousel
- [ ] Firebase function `imageCaptionGeneration` deployed (`firebase deploy --only functions:imageCaptionGeneration`)
- [ ] Flip `NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true` in production

---

## Self-review notes

Coverage map (spec section → tasks):
- **§4.1 Data model** → A1, A2
- **§4.2 Storage layout** → A4, A7
- **§4.3 Editor flow** → B2, B3, B4, B5, B6, B11
- **§4.4 Admin review** → B7, B8, B9, B10, B12
- **§4.5 Send to Studio** → C5
- **§4.6 Vision captioning** → C2, C3
- **§4.7 Interfaces** → A5, A6, C1, C4
- **§5 Feature flag** → B1
- **§6 Testing** → tests embedded in every task
- **§9 Rollout** → final checklist
