# Team Video Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full editor video submission + admin review workflow with timecoded text comments, status transitions (draft → submitted → in_review → revision_requested / approved → locked), and manual handoff to Content Studio. On-frame drawing annotations are deferred to Plan 3.

**Architecture:** Editor uploads videos directly to Supabase Storage via signed upload URLs (no traffic through Next.js). Submissions and versions are tracked in `team_video_*` tables; comments are timecoded and admin-write-only. Darren reviews in `/admin/team-videos`, transitions status via API, and explicitly hands approved videos to Content Studio (no auto-publish). Notifications via Resend on every status transition.

**Tech Stack:** Next.js 16 App Router · Supabase Postgres + Storage · NextAuth v5 (Credentials) · Zod · React Hook Form · Resend · Vitest + Playwright · shadcn/ui · Lucide

**Spec:** [docs/superpowers/specs/2026-05-03-team-invites-and-video-review-design.md](docs/superpowers/specs/2026-05-03-team-invites-and-video-review-design.md)

**Plan 1 (foundations) is shipped:** editor role, invites, /editor shell, team-related helpers (`lib/url.ts`, `lib/supabase-errors.ts`, `lib/team-invites/status.ts`) all exist.

**Plan 3 (deferred):** Drawing annotations (react-konva canvas overlay, `team_video_annotations` table writes, drawing tools UI, ±0.5s visibility window). The annotations table IS created in Task 1 of this plan so Plan 3 only needs to add API + UI on top.

---

## File Map

**New migrations:**
- `supabase/migrations/00115_team_video_tables.sql` — submissions, versions, comments, annotations + RLS
- `supabase/migrations/00116_team_video_storage_bucket.sql` — private bucket + policies

**New types:**
- `types/database.ts` — append `TeamVideoSubmissionStatus`, `TeamVideoVersionStatus`, `TeamVideoCommentStatus`, plus interfaces `TeamVideoSubmission`, `TeamVideoVersion`, `TeamVideoComment`, `TeamVideoAnnotation`

**New DAL files:**
- `lib/db/team-video-submissions.ts`
- `lib/db/team-video-versions.ts`
- `lib/db/team-video-comments.ts`

**New helpers:**
- `lib/validators/team-video.ts` — Zod schemas
- `lib/storage/team-videos.ts` — signed upload URL + signed read URL helpers
- `lib/email.ts` (modify) — append 4 email functions
- `lib/team-videos/badge-count.ts` — count of `submitted` submissions for sidebar badge

**New API routes:**
- `app/api/editor/submissions/route.ts` — POST create
- `app/api/editor/submissions/[id]/versions/route.ts` — POST create new version (revision)
- `app/api/editor/submissions/[id]/finalize/route.ts` — POST finalize latest version
- `app/api/admin/team-videos/[id]/comments/route.ts` — POST + GET
- `app/api/admin/team-videos/[id]/comments/[commentId]/resolve/route.ts` — POST resolve
- `app/api/admin/team-videos/[id]/status/route.ts` — POST status transition
- `app/api/admin/team-videos/[id]/send-to-content-studio/route.ts` — POST handoff

**Editor portal pages:**
- `app/(editor)/editor/page.tsx` (modify, replaces placeholder) — dashboard
- `app/(editor)/editor/upload/page.tsx` — upload page (server shell)
- `app/(editor)/editor/videos/[id]/page.tsx` — read-only review viewer

**Editor portal components:**
- `components/editor/SubmissionList.tsx` — dashboard list
- `components/editor/UploadDropzone.tsx` — drag-drop + signed-URL upload
- `components/editor/EditorVideoView.tsx` — player + read-only thread

**Admin pages:**
- `app/(admin)/admin/team-videos/page.tsx` — table page
- `app/(admin)/admin/team-videos/[id]/page.tsx` — review page

**Admin components:**
- `components/admin/team-videos/TeamVideoTable.tsx`
- `components/admin/team-videos/ReviewSurface.tsx`
- `components/admin/team-videos/StatusActions.tsx`
- `components/admin/team-videos/CommentEditor.tsx`

**Shared (used by both editor + admin):**
- `components/shared/VideoPlayer.tsx` — `<video>` + custom controls + timeline + comment markers
- `components/shared/CommentThread.tsx` — comment list with resolve toggle (admin-only writes via prop)

**Sidebar navigation:**
- `components/admin/AdminSidebar.tsx` (modify) — add "Team Videos" link with badge
- `components/admin/AdminMobileSidebar.tsx` (modify) — same

**Tests:**
- `__tests__/lib/validators/team-video.test.ts`
- `__tests__/lib/db/team-video-submissions.test.ts`
- `__tests__/lib/db/team-video-versions.test.ts`
- `__tests__/lib/db/team-video-comments.test.ts`
- `__tests__/api/editor/submissions.test.ts`
- `__tests__/api/admin/team-videos/comments.test.ts`
- `__tests__/api/admin/team-videos/status.test.ts`
- `__tests__/api/admin/team-videos/send-to-content-studio.test.ts`
- `__tests__/e2e/team-video-flow.spec.ts`

---

## Task 1: Database Migration — Tables & RLS

**Files:**
- Create: `supabase/migrations/00115_team_video_tables.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/00115_team_video_tables.sql`:

```sql
-- Team video review tables. Editors submit videos, admins review with
-- timecoded comments. Annotations table is created here so Plan 3
-- (drawing layer) can plug in without a schema change.

-- 1. Submissions: parent record per "video to review"
CREATE TABLE public.team_video_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  description         text,
  submitted_by        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft','submitted','in_review',
                        'revision_requested','approved','locked'
                      )),
  current_version_id  uuid,  -- FK added after team_video_versions exists
  approved_at         timestamptz,
  approved_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  locked_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_video_submissions_status ON public.team_video_submissions(status);
CREATE INDEX idx_team_video_submissions_submitted_by ON public.team_video_submissions(submitted_by);
CREATE INDEX idx_team_video_submissions_created ON public.team_video_submissions(created_at DESC);

CREATE TRIGGER trg_team_video_submissions_updated_at
  BEFORE UPDATE ON public.team_video_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Versions: one row per upload (v1, v2, ...)
CREATE TABLE public.team_video_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL REFERENCES public.team_video_submissions(id) ON DELETE CASCADE,
  version_number      int NOT NULL,
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  duration_seconds    numeric,
  size_bytes          bigint,
  mime_type           text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','uploaded','failed'
                      )),
  uploaded_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, version_number)
);

CREATE INDEX idx_team_video_versions_submission ON public.team_video_versions(submission_id);

-- Now wire up the FK that submissions had a placeholder for
ALTER TABLE public.team_video_submissions
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id)
  REFERENCES public.team_video_versions(id)
  ON DELETE SET NULL;

-- 3. Comments: admin-write timecoded notes against a specific version
CREATE TABLE public.team_video_comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          uuid NOT NULL REFERENCES public.team_video_versions(id) ON DELETE CASCADE,
  author_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  timecode_seconds    numeric,         -- null = general comment, not pinned to a frame
  comment_text        text NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_video_comments_version ON public.team_video_comments(version_id);
CREATE INDEX idx_team_video_comments_status ON public.team_video_comments(status);

CREATE TRIGGER trg_team_video_comments_updated_at
  BEFORE UPDATE ON public.team_video_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. Annotations: drawings linked 1:N to comments. Created here for Plan 3.
CREATE TABLE public.team_video_annotations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id          uuid NOT NULL REFERENCES public.team_video_comments(id) ON DELETE CASCADE,
  drawing_json        jsonb NOT NULL,  -- { paths: [{ tool, color, width, points }] }
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_video_annotations_comment ON public.team_video_annotations(comment_id);

-- 5. RLS — service-role bypasses; admin policies for completeness.
-- Note: this codebase uses NextAuth (not Supabase Auth), so auth.uid() is
-- always NULL for app sessions. The DAL uses createServiceRoleClient() which
-- bypasses RLS. These policies exist as belt-and-suspenders for any future
-- query that uses the anon/authed client.

ALTER TABLE public.team_video_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_video_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_video_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_video_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all team_video_submissions"
  ON public.team_video_submissions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all team_video_versions"
  ON public.team_video_versions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all team_video_comments"
  ON public.team_video_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all team_video_annotations"
  ON public.team_video_annotations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] **Step 2: Apply via MCP**

Use `mcp__supabase__apply_migration` with `name: "team_video_tables"` and the SQL body.

Expected: success.

- [ ] **Step 3: Verify all four tables exist**

Use `mcp__supabase__execute_sql`:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'team_video_%'
ORDER BY table_name;
```

Expected 4 rows: `team_video_annotations`, `team_video_comments`, `team_video_submissions`, `team_video_versions`.

- [ ] **Step 4: Verify FK on current_version_id**

```sql
SELECT conname FROM pg_constraint WHERE conname = 'fk_current_version';
```

Expected: 1 row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00115_team_video_tables.sql
git commit -m "feat(db): team_video_* tables for editor video review workflow"
```

---

## Task 2: Storage Bucket

**Files:**
- Create: `supabase/migrations/00116_team_video_storage_bucket.sql`

- [ ] **Step 1: Write the bucket migration**

Create `supabase/migrations/00116_team_video_storage_bucket.sql`:

```sql
-- Private storage bucket for team video submissions.
-- Files are uploaded via signed URLs (server creates them) and read via
-- signed URLs only — never public. Service-role manages all writes.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-video-submissions',
  'team-video-submissions',
  false,                        -- private
  5368709120,                   -- 5 GB per file
  ARRAY[
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- No public-read policy: all reads happen through server-issued signed URLs.
-- No client-side write policy: all uploads happen through server-issued
-- signed upload URLs (createSignedUploadUrl). Service-role bypasses RLS.

-- Admins can read all objects (defense-in-depth; in practice signed URLs are used)
CREATE POLICY "Admins read team-video-submissions"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'team-video-submissions'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
```

- [ ] **Step 2: Apply via MCP**

Use `mcp__supabase__apply_migration` with `name: "team_video_storage_bucket"`.

Expected: success.

- [ ] **Step 3: Verify bucket exists**

```sql
SELECT id, public, file_size_limit FROM storage.buckets
WHERE id = 'team-video-submissions';
```

Expected: 1 row, `public = false`, `file_size_limit = 5368709120`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00116_team_video_storage_bucket.sql
git commit -m "feat(storage): private team-video-submissions bucket (5GB, video MIME)"
```

---

## Task 3: TypeScript Types

**Files:**
- Modify: `types/database.ts` — append types

- [ ] **Step 1: Add status enums and entity interfaces**

Append to `types/database.ts` (place near the existing `TeamInvite` types):

```ts
// ====== Team video review (Plan 2) ======

export type TeamVideoSubmissionStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "locked"

export type TeamVideoVersionStatus = "pending" | "uploaded" | "failed"

export type TeamVideoCommentStatus = "open" | "resolved"

export interface TeamVideoSubmission {
  id: string
  title: string
  description: string | null
  submitted_by: string
  status: TeamVideoSubmissionStatus
  current_version_id: string | null
  approved_at: string | null
  approved_by: string | null
  locked_at: string | null
  created_at: string
  updated_at: string
}

export interface TeamVideoVersion {
  id: string
  submission_id: string
  version_number: number
  storage_path: string
  original_filename: string
  duration_seconds: number | null
  size_bytes: number | null
  mime_type: string | null
  status: TeamVideoVersionStatus
  uploaded_at: string | null
  created_at: string
}

export interface TeamVideoComment {
  id: string
  version_id: string
  author_id: string
  timecode_seconds: number | null
  comment_text: string
  status: TeamVideoCommentStatus
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

export interface TeamVideoAnnotation {
  id: string
  comment_id: string
  drawing_json: unknown  // typed in Plan 3
  created_at: string
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): team video submission, version, comment, annotation types"
```

---

## Task 4: Validators

**Files:**
- Create: `lib/validators/team-video.ts`
- Create: `__tests__/lib/validators/team-video.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/validators/team-video.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  createSubmissionSchema,
  createVersionSchema,
  createCommentSchema,
  statusTransitionSchema,
} from "@/lib/validators/team-video"

describe("createSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    const r = createSubmissionSchema.safeParse({
      title: "Squat tutorial v1",
      description: "First cut",
      filename: "squat.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024 * 1024 * 50,
    })
    expect(r.success).toBe(true)
  })
  it("rejects empty title", () => {
    const r = createSubmissionSchema.safeParse({
      title: "",
      filename: "a.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1,
    })
    expect(r.success).toBe(false)
  })
  it("rejects unsupported mime", () => {
    const r = createSubmissionSchema.safeParse({
      title: "X",
      filename: "a.gif",
      mimeType: "image/gif",
      sizeBytes: 1,
    })
    expect(r.success).toBe(false)
  })
  it("rejects size > 5GB", () => {
    const r = createSubmissionSchema.safeParse({
      title: "X",
      filename: "big.mp4",
      mimeType: "video/mp4",
      sizeBytes: 6 * 1024 ** 3,
    })
    expect(r.success).toBe(false)
  })
})

describe("createVersionSchema", () => {
  it("accepts valid version", () => {
    const r = createVersionSchema.safeParse({
      filename: "squat-v2.mp4", mimeType: "video/mp4", sizeBytes: 1234,
    })
    expect(r.success).toBe(true)
  })
})

describe("createCommentSchema", () => {
  it("accepts a timecoded comment", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 42.5, commentText: "Tighten this cut",
    })
    expect(r.success).toBe(true)
  })
  it("accepts a general comment (null timecode)", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: null, commentText: "Overall vibe",
    })
    expect(r.success).toBe(true)
  })
  it("rejects empty text", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 0, commentText: "   ",
    })
    expect(r.success).toBe(false)
  })
  it("rejects negative timecode", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: -1, commentText: "x",
    })
    expect(r.success).toBe(false)
  })
})

describe("statusTransitionSchema", () => {
  it("accepts the three valid actions", () => {
    for (const action of ["request_revision", "approve", "reopen"]) {
      const r = statusTransitionSchema.safeParse({ action })
      expect(r.success).toBe(true)
    }
  })
  it("rejects unknown actions", () => {
    expect(statusTransitionSchema.safeParse({ action: "nuke" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- team-video`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the validators**

Create `lib/validators/team-video.ts`:

```ts
import { z } from "zod"

const ALLOWED_VIDEO_MIME = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
] as const

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024  // 5 GB

export const createSubmissionSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_VIDEO_MIME, {
    errorMap: () => ({ message: "Unsupported video format" }),
  }),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES, "File exceeds 5GB limit"),
})

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>

export const createVersionSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_VIDEO_MIME, {
    errorMap: () => ({ message: "Unsupported video format" }),
  }),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES, "File exceeds 5GB limit"),
})

export type CreateVersionInput = z.infer<typeof createVersionSchema>

export const createCommentSchema = z.object({
  timecodeSeconds: z.number().min(0).nullable(),
  commentText: z.string().trim().min(1, "Comment cannot be empty").max(2000),
})

export type CreateCommentInput = z.infer<typeof createCommentSchema>

export const statusTransitionSchema = z.object({
  action: z.enum(["request_revision", "approve", "reopen"]),
})

export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- team-video`
Expected: 9/9 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/team-video.ts __tests__/lib/validators/team-video.test.ts
git commit -m "feat(validators): team video submission, version, comment, status schemas"
```

---

## Task 5: Submissions DAL

**Files:**
- Create: `lib/db/team-video-submissions.ts`
- Create: `__tests__/lib/db/team-video-submissions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/team-video-submissions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}))

import {
  createSubmission,
  approveSubmission,
} from "@/lib/db/team-video-submissions"

beforeEach(() => vi.clearAllMocks())

describe("createSubmission", () => {
  it("inserts with status=draft and returns the row", async () => {
    const row = { id: "sub1", title: "T", submitted_by: "u1", status: "draft" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createSubmission({
      title: "T", description: "D", submittedBy: "u1",
    })
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.title).toBe("T")
    expect(args.description).toBe("D")
    expect(args.submitted_by).toBe("u1")
    expect(args.status).toBe("draft")
  })
})

describe("approveSubmission", () => {
  it("sets status=approved + approved_at + approved_by", async () => {
    updateMock.mockReturnValue({
      eq: () => Promise.resolve({ data: null, error: null }),
    })
    await approveSubmission("sub1", "admin1")
    const args = updateMock.mock.calls[0][0]
    expect(args.status).toBe("approved")
    expect(args.approved_by).toBe("admin1")
    expect(args.approved_at).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-video-submissions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/team-video-submissions.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type {
  TeamVideoSubmission,
  TeamVideoSubmissionStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSubmission(input: {
  title: string
  description?: string | null
  submittedBy: string
}): Promise<TeamVideoSubmission> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .insert({
      title: input.title,
      description: input.description ?? null,
      submitted_by: input.submittedBy,
      status: "draft" as TeamVideoSubmissionStatus,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoSubmission
}

export async function getSubmissionById(id: string): Promise<TeamVideoSubmission | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) {
    console.error("[getSubmissionById]", error)
    return null
  }
  return (data as TeamVideoSubmission | null) ?? null
}

export async function listSubmissionsForEditor(editorId: string): Promise<TeamVideoSubmission[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("*")
    .eq("submitted_by", editorId)
    .order("updated_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamVideoSubmission[]
}

export async function listAllSubmissions(): Promise<TeamVideoSubmission[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_submissions")
    .select("*")
    .order("updated_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamVideoSubmission[]
}

export async function setSubmissionStatus(
  id: string,
  status: TeamVideoSubmissionStatus,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({ status })
    .eq("id", id)
  if (error) throw error
}

export async function setCurrentVersion(
  submissionId: string,
  versionId: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({ current_version_id: versionId })
    .eq("id", submissionId)
  if (error) throw error
}

export async function approveSubmission(
  submissionId: string,
  adminId: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({
      status: "approved" as TeamVideoSubmissionStatus,
      approved_at: new Date().toISOString(),
      approved_by: adminId,
    })
    .eq("id", submissionId)
  if (error) throw error
}

export async function lockSubmission(submissionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({
      status: "locked" as TeamVideoSubmissionStatus,
      locked_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
  if (error) throw error
}

export async function reopenSubmission(submissionId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_submissions")
    .update({
      status: "revision_requested" as TeamVideoSubmissionStatus,
      approved_at: null,
      approved_by: null,
    })
    .eq("id", submissionId)
  if (error) throw error
}

export async function countSubmissionsByStatus(
  status: TeamVideoSubmissionStatus,
): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("team_video_submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", status)
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-video-submissions`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/team-video-submissions.ts __tests__/lib/db/team-video-submissions.test.ts
git commit -m "feat(db): team video submissions DAL with lifecycle helpers"
```

---

## Task 6: Versions DAL

**Files:**
- Create: `lib/db/team-video-versions.ts`
- Create: `__tests__/lib/db/team-video-versions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/team-video-versions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const updateMock = vi.fn()
const selectMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
      select: selectMock,
    }),
  }),
}))

import {
  createVersion,
  finalizeVersion,
  nextVersionNumber,
} from "@/lib/db/team-video-versions"

beforeEach(() => vi.clearAllMocks())

describe("createVersion", () => {
  it("inserts a pending version row with the given fields", async () => {
    const row = { id: "v1", submission_id: "sub1", version_number: 1, status: "pending" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createVersion({
      submissionId: "sub1",
      versionNumber: 1,
      storagePath: "sub1/v1/squat.mp4",
      originalFilename: "squat.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12345,
    })
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.submission_id).toBe("sub1")
    expect(args.version_number).toBe(1)
    expect(args.storage_path).toBe("sub1/v1/squat.mp4")
    expect(args.status).toBe("pending")
  })
})

describe("finalizeVersion", () => {
  it("flips status to uploaded and stamps uploaded_at", async () => {
    updateMock.mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) })
    await finalizeVersion("v1")
    const args = updateMock.mock.calls[0][0]
    expect(args.status).toBe("uploaded")
    expect(args.uploaded_at).toBeTruthy()
  })
})

describe("nextVersionNumber", () => {
  it("returns 1 when no versions exist yet", async () => {
    selectMock.mockReturnValue({
      eq: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    })
    expect(await nextVersionNumber("sub1")).toBe(1)
  })
  it("returns max+1 when versions exist", async () => {
    selectMock.mockReturnValue({
      eq: () => ({
        order: () => ({ limit: () => Promise.resolve({
          data: [{ version_number: 3 }],
          error: null,
        }) }),
      }),
    })
    expect(await nextVersionNumber("sub1")).toBe(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-video-versions`
Expected: FAIL.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/team-video-versions.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamVideoVersion } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createVersion(input: {
  submissionId: string
  versionNumber: number
  storagePath: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
}): Promise<TeamVideoVersion> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .insert({
      submission_id: input.submissionId,
      version_number: input.versionNumber,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      status: "pending",
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoVersion
}

export async function getVersionById(id: string): Promise<TeamVideoVersion | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) {
    console.error("[getVersionById]", error)
    return null
  }
  return (data as TeamVideoVersion | null) ?? null
}

export async function getCurrentVersion(submissionId: string): Promise<TeamVideoVersion | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[getCurrentVersion]", error)
    return null
  }
  return (data as TeamVideoVersion | null) ?? null
}

export async function listVersionsForSubmission(submissionId: string): Promise<TeamVideoVersion[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("version_number", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamVideoVersion[]
}

export async function finalizeVersion(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_versions")
    .update({
      status: "uploaded",
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw error
}

export async function nextVersionNumber(submissionId: string): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_versions")
    .select("version_number")
    .eq("submission_id", submissionId)
    .order("version_number", { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return 1
  return (data[0] as { version_number: number }).version_number + 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-video-versions`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/team-video-versions.ts __tests__/lib/db/team-video-versions.test.ts
git commit -m "feat(db): team video versions DAL"
```

---

## Task 7: Comments DAL

**Files:**
- Create: `lib/db/team-video-comments.ts`
- Create: `__tests__/lib/db/team-video-comments.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/team-video-comments.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}))

import {
  createComment,
  resolveComment,
} from "@/lib/db/team-video-comments"

beforeEach(() => vi.clearAllMocks())

describe("createComment", () => {
  it("inserts a timecoded comment with author + version", async () => {
    const row = { id: "c1", version_id: "v1", author_id: "a1" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createComment({
      versionId: "v1",
      authorId: "a1",
      timecodeSeconds: 42.5,
      commentText: "Tighten",
    })
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.version_id).toBe("v1")
    expect(args.author_id).toBe("a1")
    expect(args.timecode_seconds).toBe(42.5)
    expect(args.comment_text).toBe("Tighten")
    expect(args.status).toBe("open")
  })
  it("accepts a null timecode for general comments", async () => {
    const row = { id: "c2" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    await createComment({
      versionId: "v1", authorId: "a1", timecodeSeconds: null, commentText: "Overall",
    })
    expect(insertMock.mock.calls[0][0].timecode_seconds).toBeNull()
  })
})

describe("resolveComment", () => {
  it("sets status=resolved + resolved_at + resolved_by", async () => {
    updateMock.mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) })
    await resolveComment("c1", "a1")
    const args = updateMock.mock.calls[0][0]
    expect(args.status).toBe("resolved")
    expect(args.resolved_by).toBe("a1")
    expect(args.resolved_at).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-video-comments`
Expected: FAIL.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/team-video-comments.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamVideoComment } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createComment(input: {
  versionId: string
  authorId: string
  timecodeSeconds: number | null
  commentText: string
}): Promise<TeamVideoComment> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_comments")
    .insert({
      version_id: input.versionId,
      author_id: input.authorId,
      timecode_seconds: input.timecodeSeconds,
      comment_text: input.commentText,
      status: "open",
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoComment
}

export async function listCommentsForVersion(versionId: string): Promise<TeamVideoComment[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_comments")
    .select("*")
    .eq("version_id", versionId)
    .order("timecode_seconds", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as TeamVideoComment[]
}

export async function getCommentById(id: string): Promise<TeamVideoComment | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_comments")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) {
    console.error("[getCommentById]", error)
    return null
  }
  return (data as TeamVideoComment | null) ?? null
}

export async function resolveComment(id: string, adminId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_comments")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
    })
    .eq("id", id)
  if (error) throw error
}

export async function reopenComment(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_video_comments")
    .update({
      status: "open",
      resolved_at: null,
      resolved_by: null,
    })
    .eq("id", id)
  if (error) throw error
}

export async function countOpenCommentsForVersion(versionId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("team_video_comments")
    .select("*", { count: "exact", head: true })
    .eq("version_id", versionId)
    .eq("status", "open")
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-video-comments`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/team-video-comments.ts __tests__/lib/db/team-video-comments.test.ts
git commit -m "feat(db): team video comments DAL"
```

---

## Task 8: Storage Helpers

**Files:**
- Create: `lib/storage/team-videos.ts`

- [ ] **Step 1: Implement the storage helpers**

Create `lib/storage/team-videos.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"

const BUCKET = "team-video-submissions"

/** Build the storage path for a version: <submissionId>/v<n>/<filename> */
export function buildVersionPath(
  submissionId: string,
  versionNumber: number,
  filename: string,
): string {
  // Sanitize filename: keep alphanumerics, dot, dash, underscore.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_")
  return `${submissionId}/v${versionNumber}/${safe}`
}

/**
 * Create a signed upload URL for the editor's browser to PUT the file directly
 * to Supabase Storage. The token is single-use and expires after a short window.
 */
export async function createUploadUrl(path: string): Promise<{
  signedUrl: string
  token: string
  path: string
}> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path)
  if (error || !data) throw new Error(`Upload URL failed: ${error?.message}`)
  return { signedUrl: data.signedUrl, token: data.token, path }
}

/**
 * Create a signed read URL for streaming the video back to the browser.
 * Used by the player. Expires after the given seconds.
 */
export async function createReadUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error || !data) throw new Error(`Read URL failed: ${error?.message}`)
  return data.signedUrl
}

/**
 * Delete a video from storage. Used when a version row is hard-deleted
 * (rare — versioning normally keeps history).
 */
export async function deleteVideo(path: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 3: Smoke check (optional)**

The MCP tooling can verify the bucket exists; runtime smoke test happens via the upload page in Task 13. Skip explicit smoke check here.

- [ ] **Step 4: Commit**

```bash
git add lib/storage/team-videos.ts
git commit -m "feat(storage): signed upload/read URL helpers for team videos"
```

---

## Task 9: Editor Submissions API — Create

**Files:**
- Create: `app/api/editor/submissions/route.ts`
- Create: `__tests__/api/editor/submissions.test.ts`

The POST handler creates a submission + first version row, returns the signed upload URL. The editor's browser then PUTs the file directly to storage.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/editor/submissions.test.ts`:

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
vi.mock("@/lib/storage/team-videos", () => ({
  buildVersionPath: vi.fn((sid, n, fn) => `${sid}/v${n}/${fn}`),
  createUploadUrl: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createUploadUrl } from "@/lib/storage/team-videos"
import { POST } from "@/app/api/editor/submissions/route"

beforeEach(() => vi.clearAllMocks())

const post = (body: unknown) =>
  new Request("http://localhost/api/editor/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const validBody = {
  title: "Squat tutorial",
  description: "v1",
  filename: "squat.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1024 * 1024 * 50,
}

describe("POST /api/editor/submissions", () => {
  it("401 when not authenticated", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post(validBody))
    expect(res.status).toBe(401)
  })

  it("403 for non-editor non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await POST(post(validBody))
    expect(res.status).toBe(403)
  })

  it("400 for invalid input", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post({ ...validBody, mimeType: "image/gif" }))
    expect(res.status).toBe(400)
  })

  it("creates submission + version + returns signed URL on happy path", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "editor1", role: "editor" },
    })
    ;(createSubmission as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", title: "Squat tutorial", submitted_by: "editor1", status: "draft",
    })
    ;(nextVersionNumber as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(createVersion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "v1", submission_id: "sub1", version_number: 1, storage_path: "sub1/v1/squat.mp4",
    })
    ;(createUploadUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      signedUrl: "https://storage.example/upload",
      token: "tok-abc",
      path: "sub1/v1/squat.mp4",
    })

    const res = await POST(post(validBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.submission.id).toBe("sub1")
    expect(json.version.id).toBe("v1")
    expect(json.upload.signedUrl).toBe("https://storage.example/upload")
    expect(json.upload.token).toBe("tok-abc")
    expect(setCurrentVersion).toHaveBeenCalledWith("sub1", "v1")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- editor/submissions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/editor/submissions/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { buildVersionPath, createUploadUrl } from "@/lib/storage/team-videos"
import { createSubmissionSchema } from "@/lib/validators/team-video"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createSubmissionSchema.safeParse(body)
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
  })

  const versionNumber = await nextVersionNumber(submission.id)
  const storagePath = buildVersionPath(submission.id, versionNumber, parsed.data.filename)

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath,
    originalFilename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
  })

  await setCurrentVersion(submission.id, version.id)

  const upload = await createUploadUrl(storagePath)

  return NextResponse.json(
    {
      submission,
      version,
      upload: { signedUrl: upload.signedUrl, token: upload.token, path: upload.path },
    },
    { status: 201 },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- editor/submissions`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/editor/submissions/route.ts __tests__/api/editor/submissions.test.ts
git commit -m "feat(api): editor creates submission, gets signed upload URL"
```

---

## Task 10: Editor Submissions API — New Version + Finalize

**Files:**
- Create: `app/api/editor/submissions/[id]/versions/route.ts`
- Create: `app/api/editor/submissions/[id]/finalize/route.ts`

The versions endpoint creates a NEW version row for revisions. The finalize endpoint flips the latest version's status to `uploaded`, transitions submission status, and (in Task 22) fires the email to the admin.

- [ ] **Step 1: Implement the versions route**

Create `app/api/editor/submissions/[id]/versions/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { buildVersionPath, createUploadUrl } from "@/lib/storage/team-videos"
import { createVersionSchema } from "@/lib/validators/team-video"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  // Editors can only revise their own submissions
  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Only allowed when revision was requested or submission is still a draft
  if (submission.status !== "revision_requested" && submission.status !== "draft") {
    return NextResponse.json(
      { error: "Cannot upload a new version in current state" },
      { status: 409 },
    )
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createVersionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const versionNumber = await nextVersionNumber(submission.id)
  const storagePath = buildVersionPath(submission.id, versionNumber, parsed.data.filename)

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath,
    originalFilename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
  })

  await setCurrentVersion(submission.id, version.id)

  const upload = await createUploadUrl(storagePath)

  return NextResponse.json({ version, upload }, { status: 201 })
}
```

- [ ] **Step 2: Implement the finalize route**

Create `app/api/editor/submissions/[id]/finalize/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getSubmissionById,
  setSubmissionStatus,
} from "@/lib/db/team-video-submissions"
import {
  finalizeVersion,
  getCurrentVersion,
} from "@/lib/db/team-video-versions"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No version to finalize" }, { status: 409 })
  if (version.status === "uploaded") {
    return NextResponse.json({ error: "Version already finalized" }, { status: 409 })
  }

  await finalizeVersion(version.id)
  await setSubmissionStatus(submission.id, "submitted")

  // TODO(Task 22): send "new video uploaded" email to admin

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Smoke test**

Skip — covered by E2E in Task 24.

- [ ] **Step 4: Commit**

```bash
git add app/api/editor/submissions/[id]/versions/route.ts \
        app/api/editor/submissions/[id]/finalize/route.ts
git commit -m "feat(api): editor revision upload + finalize endpoints"
```

---

## Task 11: Shared VideoPlayer Component

**Files:**
- Create: `components/shared/VideoPlayer.tsx`

The player is used by both the editor's read-only view AND the admin's review surface. It exposes a ref so the parent can read `currentTime` and seek programmatically (admin needs this for the comment editor).

- [ ] **Step 1: Implement the component**

Create `components/shared/VideoPlayer.tsx`:

```tsx
"use client"

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react"
import { Play, Pause } from "lucide-react"
import type { TeamVideoComment } from "@/types/database"

export interface VideoPlayerHandle {
  /** Seek the player to the given timestamp (seconds) and pause. */
  seek: (timeSeconds: number) => void
  /** Get the current playback time in seconds. */
  getCurrentTime: () => number
  /** Get the total duration in seconds (0 until metadata loads). */
  getDuration: () => number
  /** Pause playback. */
  pause: () => void
}

interface Props {
  /** Signed read URL for the video file. */
  src: string
  /** Comments to render as markers on the timeline. */
  comments: TeamVideoComment[]
  /** Called when a marker is clicked. Parent typically scrolls comment thread to it. */
  onMarkerClick?: (commentId: string, timecodeSeconds: number) => void
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, comments, onMarkerClick }, ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useImperativeHandle(ref, () => ({
    seek(t) {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(t, v.duration || t))
      v.pause()
    },
    getCurrentTime() {
      return videoRef.current?.currentTime ?? 0
    },
    getDuration() {
      return videoRef.current?.duration ?? 0
    },
    pause() {
      videoRef.current?.pause()
    },
  }))

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  function onScrubberClick(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current
    if (!v || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    v.currentTime = Math.max(0, Math.min(duration * ratio, duration))
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTimeUpdate = () => setCurrentTime(v.currentTime)
    const onLoadedMeta = () => setDuration(v.duration)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener("timeupdate", onTimeUpdate)
    v.addEventListener("loadedmetadata", onLoadedMeta)
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate)
      v.removeEventListener("loadedmetadata", onLoadedMeta)
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
    }
  }, [])

  const timecodedComments = comments.filter((c) => c.timecode_seconds != null && c.status === "open")
  const progressPct = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          src={src}
          className="aspect-video w-full"
          preload="metadata"
          controls={false}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>

        <div className="relative flex-1">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Video scrubber"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(currentTime)}
            onClick={onScrubberClick}
            className="relative h-2 cursor-pointer rounded-full bg-muted"
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-primary"
              style={{ width: `${progressPct}%` }}
            />
            {timecodedComments.map((c) => {
              const left = duration ? ((c.timecode_seconds ?? 0) / duration) * 100 : 0
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const v = videoRef.current
                    if (v) v.currentTime = c.timecode_seconds ?? 0
                    onMarkerClick?.(c.id, c.timecode_seconds ?? 0)
                  }}
                  title={c.comment_text.slice(0, 60)}
                  aria-label={`Comment at ${fmtTime(c.timecode_seconds ?? 0)}`}
                  className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-accent shadow"
                  style={{ left: `${left}%` }}
                />
              )
            })}
          </div>
        </div>

        <div className="font-mono text-xs text-muted-foreground tabular-nums">
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 3: Commit**

```bash
git add components/shared/VideoPlayer.tsx
git commit -m "feat(shared): video player with custom timeline + comment markers"
```

---

## Task 12: Shared CommentThread Component

**Files:**
- Create: `components/shared/CommentThread.tsx`

Used by both editor (read-only) and admin (with resolve/reopen toggles + a "Add comment" composer). Composer is rendered conditionally based on `canWrite`.

- [ ] **Step 1: Implement the component**

Create `components/shared/CommentThread.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, RotateCw, MessageSquare } from "lucide-react"
import type { TeamVideoComment } from "@/types/database"

function fmtTime(s: number | null): string {
  if (s == null) return "General"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

interface Props {
  comments: TeamVideoComment[]
  /** When true, show resolve/reopen actions. */
  canWrite: boolean
  onResolve?: (commentId: string) => void
  onReopen?: (commentId: string) => void
  onJumpTo?: (timecodeSeconds: number) => void
}

export function CommentThread({
  comments, canWrite, onResolve, onReopen, onJumpTo,
}: Props) {
  const [showResolved, setShowResolved] = useState(false)
  const open = comments.filter((c) => c.status === "open")
  const resolved = comments.filter((c) => c.status === "resolved")

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="font-medium">{open.length} open</span>
        {resolved.length > 0 && (
          <span className="text-muted-foreground">· {resolved.length} resolved</span>
        )}
      </div>

      {open.length === 0 && resolved.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No comments yet.
        </p>
      )}

      <ul className="space-y-2">
        {open.map((c) => (
          <li
            key={c.id}
            className="rounded-md border bg-card p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => onJumpTo?.(c.timecode_seconds ?? 0)}
                  disabled={c.timecode_seconds == null}
                  className="font-mono text-xs font-medium text-primary hover:underline disabled:no-underline disabled:text-muted-foreground"
                >
                  {fmtTime(c.timecode_seconds)}
                </button>
                <p className="text-sm">{c.comment_text}</p>
              </div>
              {canWrite && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onResolve?.(c.id)}
                  aria-label="Resolve comment"
                >
                  <CheckCircle2 className="size-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {resolved.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
          {showResolved && (
            <ul className="space-y-2">
              {resolved.map((c) => (
                <li key={c.id} className="rounded-md border bg-muted/40 p-3 opacity-70">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <span className="font-mono text-xs text-muted-foreground line-through">
                        {fmtTime(c.timecode_seconds)}
                      </span>
                      <p className="text-sm line-through">{c.comment_text}</p>
                    </div>
                    {canWrite && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onReopen?.(c.id)}
                        aria-label="Reopen comment"
                      >
                        <RotateCw className="size-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 3: Commit**

```bash
git add components/shared/CommentThread.tsx
git commit -m "feat(shared): comment thread with resolve/reopen toggles"
```

---

## Task 13: Editor Upload Page

**Files:**
- Create: `app/(editor)/editor/upload/page.tsx`
- Create: `components/editor/UploadDropzone.tsx`

- [ ] **Step 1: Create the page (server shell)**

Create `app/(editor)/editor/upload/page.tsx`:

```tsx
import { UploadDropzone } from "@/components/editor/UploadDropzone"

export const metadata = { title: "Upload Video" }

export default function EditorUploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl text-primary">Upload a video</h2>
        <p className="font-body text-sm text-muted-foreground">
          Add a new video for Darren to review. After upload, status moves to
          "Awaiting Darren" automatically.
        </p>
      </div>
      <UploadDropzone />
    </div>
  )
}
```

- [ ] **Step 2: Create the dropzone component (client)**

Create `components/editor/UploadDropzone.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { UploadCloud } from "lucide-react"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const BUCKET = "team-video-submissions"

export function UploadDropzone() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [progress, setProgress] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !title.trim()) {
      toast.error("Pick a file and add a title")
      return
    }
    setSubmitting(true)
    setProgress(0)
    try {
      // 1. Create submission + get signed URL
      const createRes = await fetch("/api/editor/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      if (!createRes.ok) {
        const json = await createRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Failed to create submission")
      }
      const { submission, upload } = await createRes.json()

      // 2. Upload file directly to Supabase Storage with the signed token
      const browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      const { error: uploadErr } = await browserClient.storage
        .from(BUCKET)
        .uploadToSignedUrl(upload.path, upload.token, file, {
          contentType: file.type,
        })
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)
      setProgress(100)

      // 3. Finalize
      const finRes = await fetch(`/api/editor/submissions/${submission.id}/finalize`, {
        method: "POST",
      })
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }

      toast.success("Video submitted for review")
      router.push(`/editor/videos/${submission.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed"
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Squat tutorial v1"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Anything Darren should know about this cut?"
        />
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded-md border-2 border-dashed bg-muted/40 p-12 text-center transition hover:bg-muted/60"
      >
        <UploadCloud className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-2 font-body text-sm">
          {file ? (
            <span className="font-medium">{file.name}</span>
          ) : (
            <>
              Drag a video here or <span className="text-primary underline">browse</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          MP4, MOV, WebM, MKV — max 5 GB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {submitting && progress > 0 && (
        <div className="text-xs text-muted-foreground">
          Uploaded {progress}%
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || !file || !title.trim()}>
          {submitting ? "Submitting..." : "Submit for review"}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`. Expected: Turbopack compile clean. (TS phase may still hit the pre-existing `scripts/test-publish-fb.ts` issue — unrelated.)

- [ ] **Step 4: Commit**

```bash
git add app/(editor)/editor/upload/page.tsx components/editor/UploadDropzone.tsx
git commit -m "feat(editor): upload page with direct-to-storage signed URL flow"
```

---

## Task 14: Editor Dashboard

**Files:**
- Modify: `app/(editor)/editor/page.tsx`
- Create: `components/editor/SubmissionList.tsx`

Replace the placeholder dashboard with a real list of submissions grouped by state.

- [ ] **Step 1: Update the dashboard page**

Replace the contents of `app/(editor)/editor/page.tsx`:

```tsx
import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listSubmissionsForEditor } from "@/lib/db/team-video-submissions"
import { SubmissionList } from "@/components/editor/SubmissionList"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Editor Dashboard" }

export default async function EditorDashboard() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")

  const submissions = await listSubmissionsForEditor(session.user.id)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl text-primary">Your videos</h2>
          <p className="font-body text-sm text-muted-foreground">
            Upload, track review status, and revise based on feedback.
          </p>
        </div>
        <Button asChild>
          <Link href="/editor/upload">Upload video</Link>
        </Button>
      </header>

      <SubmissionList submissions={submissions} />
    </div>
  )
}
```

- [ ] **Step 2: Create the SubmissionList component**

Create `components/editor/SubmissionList.tsx`:

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { TeamVideoSubmission, TeamVideoSubmissionStatus } from "@/types/database"

const STATUS_LABEL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting Darren",
  in_review: "Awaiting Darren",
  revision_requested: "Needs your action",
  approved: "Approved",
  locked: "Sent to Content Studio",
}

const STATUS_PILL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-warning/10 text-warning",
  in_review: "bg-warning/10 text-warning",
  revision_requested: "bg-error/10 text-error",
  approved: "bg-success/10 text-success",
  locked: "bg-muted text-muted-foreground",
}

interface Section {
  title: string
  defaultOpen: boolean
  statuses: TeamVideoSubmissionStatus[]
}

const SECTIONS: Section[] = [
  { title: "Needs your action", defaultOpen: true, statuses: ["revision_requested"] },
  { title: "Awaiting Darren", defaultOpen: true, statuses: ["submitted", "in_review"] },
  { title: "Approved", defaultOpen: false, statuses: ["approved", "locked"] },
  { title: "Drafts", defaultOpen: false, statuses: ["draft"] },
]

export function SubmissionList({ submissions }: { submissions: TeamVideoSubmission[] }) {
  if (submissions.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center">
        <p className="font-body text-sm text-muted-foreground">
          No videos yet. Click "Upload video" to submit your first one.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const items = submissions.filter((s) => section.statuses.includes(s.status))
        if (items.length === 0) return null
        return (
          <Section key={section.title} title={section.title} defaultOpen={section.defaultOpen} count={items.length}>
            <ul className="space-y-2">
              {items.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/editor/videos/${s.id}`}
                    className="flex items-center justify-between rounded-md border bg-card p-3 hover:bg-muted/40"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Updated {new Date(s.updated_at).toLocaleDateString("en-US")}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )
      })}
    </div>
  )
}

function Section({
  title, defaultOpen, count, children,
}: { title: string; defaultOpen: boolean; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {title} <span className="text-muted-foreground">({count})</span>
      </button>
      {open && children}
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(editor)/editor/page.tsx components/editor/SubmissionList.tsx
git commit -m "feat(editor): dashboard with grouped submission sections"
```

---

## Task 15: Editor Read-Only Video Viewer

**Files:**
- Create: `app/(editor)/editor/videos/[id]/page.tsx`
- Create: `components/editor/EditorVideoView.tsx`

- [ ] **Step 1: Create the page**

Create `app/(editor)/editor/videos/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { listCommentsForVersion } from "@/lib/db/team-video-comments"
import { createReadUrl } from "@/lib/storage/team-videos"
import { EditorVideoView } from "@/components/editor/EditorVideoView"

interface Props { params: Promise<{ id: string }> }

export const metadata = { title: "Video Review" }

export default async function EditorVideoPage({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")

  const { id } = await params
  const submission = await getSubmissionById(id)
  if (!submission) notFound()

  // Editors can only view their own; admins can view all
  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    notFound()
  }

  const version = await getCurrentVersion(submission.id)
  const comments = version ? await listCommentsForVersion(version.id) : []
  const videoUrl = version && version.status === "uploaded" ? await createReadUrl(version.storage_path) : null

  return (
    <EditorVideoView
      submission={submission}
      version={version}
      comments={comments}
      videoUrl={videoUrl}
    />
  )
}
```

- [ ] **Step 2: Create the view component**

Create `components/editor/EditorVideoView.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@supabase/supabase-js"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { VideoPlayer, type VideoPlayerHandle } from "@/components/shared/VideoPlayer"
import { CommentThread } from "@/components/shared/CommentThread"
import type { TeamVideoSubmission, TeamVideoVersion, TeamVideoComment } from "@/types/database"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const BUCKET = "team-video-submissions"

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoComment[]
  videoUrl: string | null
}

export function EditorVideoView({ submission, version, comments, videoUrl }: Props) {
  const router = useRouter()
  const playerRef = useRef<VideoPlayerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const canRevise = submission.status === "revision_requested"

  async function handleRevisionUpload(file: File) {
    setUploading(true)
    try {
      const verRes = await fetch(`/api/editor/submissions/${submission.id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name, mimeType: file.type, sizeBytes: file.size,
        }),
      })
      if (!verRes.ok) {
        const json = await verRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Failed to create version")
      }
      const { upload } = await verRes.json()

      const browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      const { error: uploadErr } = await browserClient.storage
        .from(BUCKET)
        .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

      const finRes = await fetch(`/api/editor/submissions/${submission.id}/finalize`, {
        method: "POST",
      })
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }
      toast.success("New version submitted")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/editor"><ArrowLeft className="mr-1 size-4" /> Back</Link>
        </Button>
      </div>

      <header>
        <h2 className="font-heading text-2xl text-primary">{submission.title}</h2>
        {submission.description && (
          <p className="font-body text-sm text-muted-foreground">{submission.description}</p>
        )}
        {version && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Version {version.version_number} · status: {submission.status}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          {videoUrl ? (
            <VideoPlayer
              ref={playerRef}
              src={videoUrl}
              comments={comments}
              onMarkerClick={() => { /* parent could scroll thread; v1 just seeks */ }}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              No video uploaded yet.
            </div>
          )}

          {canRevise && (
            <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm font-medium text-warning">Darren requested a revision.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload a new version to address the open comments.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleRevisionUpload(f)
                }}
              />
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading..." : "Upload new version"}
              </Button>
            </div>
          )}
        </div>

        <aside>
          <CommentThread
            comments={comments}
            canWrite={false}
            onJumpTo={(t) => playerRef.current?.seek(t)}
          />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(editor)/editor/videos/[id]/page.tsx components/editor/EditorVideoView.tsx
git commit -m "feat(editor): video review viewer with player + read-only thread + revise"
```

---

## Task 16: Admin Comments API

**Files:**
- Create: `app/api/admin/team-videos/[id]/comments/route.ts`
- Create: `app/api/admin/team-videos/[id]/comments/[commentId]/resolve/route.ts`
- Create: `__tests__/api/admin/team-videos/comments.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/admin/team-videos/comments.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setSubmissionStatus: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/team-video-comments", () => ({
  createComment: vi.fn(),
  listCommentsForVersion: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { getSubmissionById, setSubmissionStatus } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createComment, listCommentsForVersion } from "@/lib/db/team-video-comments"
import { POST, GET } from "@/app/api/admin/team-videos/[id]/comments/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = (body: unknown) =>
  new Request("http://localhost/api/admin/team-videos/sub1/comments", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/admin/team-videos/[id]/comments", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post({ timecodeSeconds: 0, commentText: "x" }), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post({ timecodeSeconds: 0, commentText: "x" }), { params })
    expect(res.status).toBe(404)
  })
  it("400 on invalid input", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    const res = await POST(post({ timecodeSeconds: 0, commentText: "" }), { params })
    expect(res.status).toBe(400)
  })
  it("creates comment + transitions submitted→in_review", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "submitted",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1" })

    const res = await POST(post({ timecodeSeconds: 42, commentText: "Tighten" }), { params })
    expect(res.status).toBe(201)
    expect(createComment).toHaveBeenCalledWith({
      versionId: "v1", authorId: "admin1", timecodeSeconds: 42, commentText: "Tighten",
    })
    expect(setSubmissionStatus).toHaveBeenCalledWith("sub1", "in_review")
  })
  it("does NOT transition status when already in_review", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c2" })

    const res = await POST(post({ timecodeSeconds: 10, commentText: "Note" }), { params })
    expect(res.status).toBe(201)
    expect(setSubmissionStatus).not.toHaveBeenCalled()
  })
})

describe("GET /api/admin/team-videos/[id]/comments", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await GET(new Request("http://x"), { params })
    expect(res.status).toBe(403)
  })
  it("returns the list for admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
    ;(listCommentsForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "c1" }])
    const res = await GET(new Request("http://x"), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.comments).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-videos/comments`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the comments POST/GET route**

Create `app/api/admin/team-videos/[id]/comments/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, setSubmissionStatus } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createComment, listCommentsForVersion } from "@/lib/db/team-video-comments"
import { createCommentSchema } from "@/lib/validators/team-video"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No current version" }, { status: 409 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createCommentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const comment = await createComment({
    versionId: version.id,
    authorId: session.user.id,
    timecodeSeconds: parsed.data.timecodeSeconds,
    commentText: parsed.data.commentText,
  })

  // First comment on a "submitted" record bumps it to "in_review"
  if (submission.status === "submitted") {
    await setSubmissionStatus(submission.id, "in_review")
  }

  return NextResponse.json({ comment }, { status: 201 })
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ comments: [] })

  const comments = await listCommentsForVersion(version.id)
  return NextResponse.json({ comments })
}
```

- [ ] **Step 4: Implement the resolve route**

Create `app/api/admin/team-videos/[id]/comments/[commentId]/resolve/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCommentById, resolveComment, reopenComment } from "@/lib/db/team-video-comments"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { commentId } = await ctx.params
  const comment = await getCommentById(commentId)
  if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 })

  // Toggle: open → resolved, resolved → open. Body can override with explicit action.
  let body: { action?: "resolve" | "reopen" } = {}
  try { body = await request.json() } catch { /* empty body OK */ }
  const action = body.action ?? (comment.status === "open" ? "resolve" : "reopen")

  if (action === "resolve") await resolveComment(commentId, session.user.id)
  else await reopenComment(commentId)

  return NextResponse.json({ ok: true, action })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- team-videos/comments`
Expected: 7/7 PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/team-videos/[id]/comments \
        __tests__/api/admin/team-videos/comments.test.ts
git commit -m "feat(api): admin team-video comments + resolve toggle"
```

---

## Task 17: Admin Status Transitions API

**Files:**
- Create: `app/api/admin/team-videos/[id]/status/route.ts`
- Create: `__tests__/api/admin/team-videos/status.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/admin/team-videos/status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  setSubmissionStatus: vi.fn(),
  approveSubmission: vi.fn(),
  reopenSubmission: vi.fn(),
}))

import { auth } from "@/lib/auth"
import {
  getSubmissionById, setSubmissionStatus, approveSubmission, reopenSubmission,
} from "@/lib/db/team-video-submissions"
import { POST } from "@/app/api/admin/team-videos/[id]/status/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = (body: unknown) =>
  new Request("http://localhost/api/admin/team-videos/sub1/status", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/admin/team-videos/[id]/status", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post({ action: "approve" }), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post({ action: "approve" }), { params })
    expect(res.status).toBe(404)
  })
  it("400 on invalid action", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
    const res = await POST(post({ action: "nuke" }), { params })
    expect(res.status).toBe(400)
  })
  it("approve calls approveSubmission", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    const res = await POST(post({ action: "approve" }), { params })
    expect(res.status).toBe(200)
    expect(approveSubmission).toHaveBeenCalledWith("sub1", "admin1")
  })
  it("request_revision sets status revision_requested", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    const res = await POST(post({ action: "request_revision" }), { params })
    expect(res.status).toBe(200)
    expect(setSubmissionStatus).toHaveBeenCalledWith("sub1", "revision_requested")
  })
  it("reopen calls reopenSubmission only when approved", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved",
    })
    const res = await POST(post({ action: "reopen" }), { params })
    expect(res.status).toBe(200)
    expect(reopenSubmission).toHaveBeenCalledWith("sub1")
  })
  it("reopen on a non-approved row 409s", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review",
    })
    const res = await POST(post({ action: "reopen" }), { params })
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-videos/status`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/team-videos/[id]/status/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getSubmissionById, setSubmissionStatus, approveSubmission, reopenSubmission,
} from "@/lib/db/team-video-submissions"
import { statusTransitionSchema } from "@/lib/validators/team-video"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = statusTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }

  switch (parsed.data.action) {
    case "approve":
      if (submission.status === "locked") {
        return NextResponse.json({ error: "Submission is locked" }, { status: 409 })
      }
      await approveSubmission(submission.id, session.user.id)
      // TODO(Task 22): send "approved" email to editor
      return NextResponse.json({ ok: true })

    case "request_revision":
      if (submission.status === "approved" || submission.status === "locked") {
        return NextResponse.json(
          { error: "Cannot request revision on approved/locked submission" },
          { status: 409 },
        )
      }
      await setSubmissionStatus(submission.id, "revision_requested")
      // TODO(Task 22): send "revision requested" email to editor
      return NextResponse.json({ ok: true })

    case "reopen":
      if (submission.status !== "approved") {
        return NextResponse.json(
          { error: "Only approved submissions can be reopened" },
          { status: 409 },
        )
      }
      await reopenSubmission(submission.id)
      // TODO(Task 22): send "reopened" email to editor
      return NextResponse.json({ ok: true })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-videos/status`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/team-videos/[id]/status \
        __tests__/api/admin/team-videos/status.test.ts
git commit -m "feat(api): admin status transitions for team videos"
```

---

## Task 18: Admin Send-to-Content-Studio API

**Files:**
- Create: `app/api/admin/team-videos/[id]/send-to-content-studio/route.ts`
- Create: `__tests__/api/admin/team-videos/send-to-content-studio.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/admin/team-videos/send-to-content-studio.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  lockSubmission: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({
  getCurrentVersion: vi.fn(),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  createVideoUpload: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { POST } from "@/app/api/admin/team-videos/[id]/send-to-content-studio/route"

beforeEach(() => vi.clearAllMocks())

const params = Promise.resolve({ id: "sub1" })
const post = () =>
  new Request("http://localhost/api/admin/team-videos/sub1/send-to-content-studio", {
    method: "POST",
  })

describe("POST send-to-content-studio", () => {
  it("403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "editor" },
    })
    const res = await POST(post(), { params })
    expect(res.status).toBe(403)
  })
  it("404 if submission missing", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(post(), { params })
    expect(res.status).toBe(404)
  })
  it("409 if not approved", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "in_review", title: "T",
    })
    const res = await POST(post(), { params })
    expect(res.status).toBe(409)
  })
  it("creates video_uploads + locks submission on happy path", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin1", role: "admin" },
    })
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub1", status: "approved", title: "Squat",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "v1", storage_path: "sub1/v1/squat.mp4",
      original_filename: "squat.mp4", duration_seconds: 120,
      size_bytes: 1024, mime_type: "video/mp4",
    })
    ;(createVideoUpload as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "vu1" })

    const res = await POST(post(), { params })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.videoUpload.id).toBe("vu1")
    expect(createVideoUpload).toHaveBeenCalledWith(expect.objectContaining({
      title: "Squat",
      storage_path: "sub1/v1/squat.mp4",
      uploaded_by: "admin1",
    }))
    expect(lockSubmission).toHaveBeenCalledWith("sub1")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- send-to-content-studio`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/team-videos/[id]/send-to-content-studio/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createVideoUpload } from "@/lib/db/video-uploads"

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

  // Create the Content Studio video_uploads row using the approved version's
  // storage path. Content Studio's existing pipeline (transcribe, post compose,
  // schedule) takes over from there.
  const videoUpload = await createVideoUpload({
    storage_path: version.storage_path,
    original_filename: version.original_filename,
    duration_seconds: version.duration_seconds,
    size_bytes: version.size_bytes,
    mime_type: version.mime_type,
    title: submission.title,
    uploaded_by: session.user.id,
    status: "uploaded",
  })

  await lockSubmission(submission.id)

  return NextResponse.json({ videoUpload }, { status: 201 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- send-to-content-studio`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/team-videos/[id]/send-to-content-studio \
        __tests__/api/admin/team-videos/send-to-content-studio.test.ts
git commit -m "feat(api): send approved team video to Content Studio + lock"
```

---

## Task 19: Admin Team-Videos Table Page

**Files:**
- Create: `app/(admin)/admin/team-videos/page.tsx`
- Create: `components/admin/team-videos/TeamVideoTable.tsx`

- [ ] **Step 1: Create the page**

Create `app/(admin)/admin/team-videos/page.tsx`:

```tsx
import { requireAdmin } from "@/lib/auth-helpers"
import { listAllSubmissions } from "@/lib/db/team-video-submissions"
import { TeamVideoTable } from "@/components/admin/team-videos/TeamVideoTable"

export const metadata = { title: "Team Videos" }

export default async function TeamVideosPage() {
  await requireAdmin()
  const submissions = await listAllSubmissions()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-heading text-2xl text-primary">Team Videos</h1>
        <p className="font-body text-sm text-muted-foreground">
          Review videos submitted by your editor team.
        </p>
      </header>
      <TeamVideoTable submissions={submissions} />
    </div>
  )
}
```

- [ ] **Step 2: Create the table component (client for filter state)**

Create `components/admin/team-videos/TeamVideoTable.tsx`:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import type { TeamVideoSubmission, TeamVideoSubmissionStatus } from "@/types/database"

const ALL: TeamVideoSubmissionStatus[] = [
  "draft", "submitted", "in_review", "revision_requested", "approved", "locked",
]

const STATUS_LABEL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  revision_requested: "Revision requested",
  approved: "Approved",
  locked: "Sent to Content Studio",
}

const STATUS_PILL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-warning/10 text-warning border-warning/30",
  in_review: "bg-warning/10 text-warning border-warning/30",
  revision_requested: "bg-error/10 text-error border-error/30",
  approved: "bg-success/10 text-success border-success/30",
  locked: "bg-muted text-muted-foreground border-border",
}

export function TeamVideoTable({ submissions }: { submissions: TeamVideoSubmission[] }) {
  const [filter, setFilter] = useState<TeamVideoSubmissionStatus | "all">("all")
  const filtered = filter === "all"
    ? submissions
    : submissions.filter((s) => s.status === filter)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs ${
            filter === "all" ? "border-primary text-primary" : "text-muted-foreground"
          }`}
        >
          All ({submissions.length})
        </button>
        {ALL.map((status) => {
          const count = submissions.filter((s) => s.status === status).length
          if (count === 0) return null
          return (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === status ? "border-primary text-primary" : "text-muted-foreground"
              }`}
            >
              {STATUS_LABEL[status]} ({count})
            </button>
          )
        })}
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={3}>
                  No videos in this view.
                </td>
              </tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={`/admin/team-videos/${s.id}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_PILL[s.status]}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(s.updated_at).toLocaleDateString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/team-videos/page.tsx \
        components/admin/team-videos/TeamVideoTable.tsx
git commit -m "feat(admin): team videos table with status filters"
```

---

## Task 20: Admin Review Page

**Files:**
- Create: `app/(admin)/admin/team-videos/[id]/page.tsx`
- Create: `components/admin/team-videos/ReviewSurface.tsx`
- Create: `components/admin/team-videos/StatusActions.tsx`
- Create: `components/admin/team-videos/CommentEditor.tsx`

- [ ] **Step 1: Create the page**

Create `app/(admin)/admin/team-videos/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth-helpers"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { listCommentsForVersion } from "@/lib/db/team-video-comments"
import { createReadUrl } from "@/lib/storage/team-videos"
import { ReviewSurface } from "@/components/admin/team-videos/ReviewSurface"

interface Props { params: Promise<{ id: string }> }

export const metadata = { title: "Team Video Review" }

export default async function TeamVideoReviewPage({ params }: Props) {
  await requireAdmin()
  const { id } = await params
  const submission = await getSubmissionById(id)
  if (!submission) notFound()

  const version = await getCurrentVersion(submission.id)
  const comments = version ? await listCommentsForVersion(version.id) : []
  const videoUrl = version && version.status === "uploaded"
    ? await createReadUrl(version.storage_path)
    : null

  return (
    <ReviewSurface
      submission={submission}
      version={version}
      comments={comments}
      videoUrl={videoUrl}
    />
  )
}
```

- [ ] **Step 2: Create the StatusActions component**

Create `components/admin/team-videos/StatusActions.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { TeamVideoSubmission } from "@/types/database"

interface Props { submission: TeamVideoSubmission }

export function StatusActions({ submission }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | "request_revision" | "approve" | "reopen" | "send">(null)

  async function callStatus(action: "request_revision" | "approve" | "reopen") {
    setBusy(action)
    try {
      const res = await fetch(`/api/admin/team-videos/${submission.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Status update failed")
      }
      const labels = {
        request_revision: "Revision requested",
        approve: "Submission approved",
        reopen: "Reopened for revision",
      }
      toast.success(labels[action])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    } finally {
      setBusy(null)
    }
  }

  async function callSend() {
    setBusy("send")
    try {
      const res = await fetch(
        `/api/admin/team-videos/${submission.id}/send-to-content-studio`,
        { method: "POST" },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Handoff failed")
      }
      toast.success("Sent to Content Studio")
      router.push("/admin/content?tab=videos")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Handoff failed")
    } finally {
      setBusy(null)
    }
  }

  const canRequestRevision = submission.status === "submitted" || submission.status === "in_review"
  const canApprove = submission.status === "submitted" || submission.status === "in_review"
  const canReopen = submission.status === "approved"
  const canSend = submission.status === "approved"

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRequestRevision && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => callStatus("request_revision")}
        >
          {busy === "request_revision" ? "..." : "Request revision"}
        </Button>
      )}
      {canApprove && (
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() => callStatus("approve")}
        >
          {busy === "approve" ? "..." : "Approve"}
        </Button>
      )}
      {canReopen && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => callStatus("reopen")}
        >
          {busy === "reopen" ? "..." : "Reopen"}
        </Button>
      )}
      {canSend && (
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={callSend}
        >
          {busy === "send" ? "..." : "Send to Content Studio"}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create the CommentEditor component**

Create `components/admin/team-videos/CommentEditor.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

interface Props {
  submissionId: string
  /** Returns the current player time (seconds) when called, or null for general comment. */
  getCurrentTimecode: () => number | null
  onCreated: () => void
}

export function CommentEditor({ submissionId, getCurrentTimecode, onCreated }: Props) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [general, setGeneral] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      const timecodeSeconds = general ? null : getCurrentTimecode()
      const res = await fetch(`/api/admin/team-videos/${submissionId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timecodeSeconds, commentText: text.trim() }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Comment failed")
      }
      setText("")
      onCreated()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Comment failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border bg-card p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={general ? "General comment..." : "Comment at current time..."}
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={general}
            onChange={(e) => setGeneral(e.target.checked)}
          />
          General comment (not pinned to a frame)
        </label>
        <Button type="submit" size="sm" disabled={submitting || !text.trim()}>
          {submitting ? "Posting..." : "Add comment"}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Create the ReviewSurface component**

Create `components/admin/team-videos/ReviewSurface.tsx`:

```tsx
"use client"

import { useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { VideoPlayer, type VideoPlayerHandle } from "@/components/shared/VideoPlayer"
import { CommentThread } from "@/components/shared/CommentThread"
import { StatusActions } from "./StatusActions"
import { CommentEditor } from "./CommentEditor"
import type { TeamVideoSubmission, TeamVideoVersion, TeamVideoComment } from "@/types/database"

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoComment[]
  videoUrl: string | null
}

export function ReviewSurface({ submission, version, comments, videoUrl }: Props) {
  const router = useRouter()
  const playerRef = useRef<VideoPlayerHandle>(null)

  async function resolveComment(commentId: string) {
    const res = await fetch(
      `/api/admin/team-videos/${submission.id}/comments/${commentId}/resolve`,
      { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve" }) },
    )
    if (res.ok) { toast.success("Resolved"); router.refresh() }
    else toast.error("Failed to resolve")
  }

  async function reopenComment(commentId: string) {
    const res = await fetch(
      `/api/admin/team-videos/${submission.id}/comments/${commentId}/resolve`,
      { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reopen" }) },
    )
    if (res.ok) { toast.success("Reopened"); router.refresh() }
    else toast.error("Failed to reopen")
  }

  return (
    <div className="space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/team-videos"><ArrowLeft className="mr-1 size-4" /> Back</Link>
      </Button>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-primary">{submission.title}</h1>
          {submission.description && (
            <p className="font-body text-sm text-muted-foreground">{submission.description}</p>
          )}
          {version && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Version {version.version_number} · status: {submission.status}
            </p>
          )}
        </div>
        <StatusActions submission={submission} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {videoUrl ? (
            <VideoPlayer ref={playerRef} src={videoUrl} comments={comments} />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              {version ? "Video upload not finalized." : "No video uploaded yet."}
            </div>
          )}
          {videoUrl && (
            <CommentEditor
              submissionId={submission.id}
              getCurrentTimecode={() => playerRef.current?.getCurrentTime() ?? null}
              onCreated={() => router.refresh()}
            />
          )}
        </div>

        <aside>
          <CommentThread
            comments={comments}
            canWrite={true}
            onResolve={resolveComment}
            onReopen={reopenComment}
            onJumpTo={(t) => playerRef.current?.seek(t)}
          />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Build verify**

Run: `npm run build`. Expected: Turbopack compile clean.

- [ ] **Step 6: Commit**

```bash
git add app/(admin)/admin/team-videos/[id]/page.tsx \
        components/admin/team-videos
git commit -m "feat(admin): team video review surface (player + thread + actions)"
```

---

## Task 21: Email Functions

**Files:**
- Modify: `lib/email.ts` — append 4 functions

- [ ] **Step 1: Append email functions**

Append to `lib/email.ts` (after `sendTeamInviteEmail`):

```ts
// ===== Team video review notifications =====

export async function sendVideoUploadedEmail(params: {
  to: string
  editorName: string
  submissionTitle: string
  reviewUrl: string
}) {
  const { to, editorName, submissionTitle, reviewUrl } = params
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:48px 48px 32px;">
        <h2 style="margin:0 0 16px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50; font-weight:600;">
          New video for review
        </h2>
        <p style="margin:0 0 24px; font-family:'Lexend Deca', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#333;">
          ${editorName} just submitted <strong>${submissionTitle}</strong> for your review.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#0E3F50; border-radius:2px;">
            <a href="${reviewUrl}"
               style="display:inline-block; padding:14px 28px; font-family:'Lexend Exa', Georgia, serif; font-size:13px; color:#ffffff; text-decoration:none; letter-spacing:2px; text-transform:uppercase;">
              Open Review
            </a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, subject: `New video to review: ${submissionTitle}`,
    html: emailLayout(body),
  })
  if (error) {
    console.error("Failed to send video uploaded email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendVideoRevisionRequestedEmail(params: {
  to: string
  submissionTitle: string
  openCommentCount: number
  reviewUrl: string
}) {
  const { to, submissionTitle, openCommentCount, reviewUrl } = params
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:48px 48px 32px;">
        <h2 style="margin:0 0 16px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50; font-weight:600;">
          Darren has feedback
        </h2>
        <p style="margin:0 0 24px; font-family:'Lexend Deca', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#333;">
          Darren left ${openCommentCount} ${openCommentCount === 1 ? "comment" : "comments"} on
          <strong>${submissionTitle}</strong>. Open the review to see what to address.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#0E3F50; border-radius:2px;">
            <a href="${reviewUrl}"
               style="display:inline-block; padding:14px 28px; font-family:'Lexend Exa', Georgia, serif; font-size:13px; color:#ffffff; text-decoration:none; letter-spacing:2px; text-transform:uppercase;">
              View Feedback
            </a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, subject: `Darren has feedback on ${submissionTitle}`,
    html: emailLayout(body),
  })
  if (error) {
    console.error("Failed to send revision-requested email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendVideoApprovedEmail(params: {
  to: string
  submissionTitle: string
  reviewUrl: string
}) {
  const { to, submissionTitle, reviewUrl } = params
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:48px 48px 32px;">
        <h2 style="margin:0 0 16px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50; font-weight:600;">
          Approved
        </h2>
        <p style="margin:0 0 24px; font-family:'Lexend Deca', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#333;">
          Darren approved <strong>${submissionTitle}</strong>.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#0E3F50; border-radius:2px;">
            <a href="${reviewUrl}"
               style="display:inline-block; padding:14px 28px; font-family:'Lexend Exa', Georgia, serif; font-size:13px; color:#ffffff; text-decoration:none; letter-spacing:2px; text-transform:uppercase;">
              View Submission
            </a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, subject: `Darren approved ${submissionTitle}`,
    html: emailLayout(body),
  })
  if (error) {
    console.error("Failed to send approved email:", error)
    throw new Error("Failed to send email")
  }
}

export async function sendVideoReopenedEmail(params: {
  to: string
  submissionTitle: string
  reviewUrl: string
}) {
  const { to, submissionTitle, reviewUrl } = params
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:48px 48px 32px;">
        <h2 style="margin:0 0 16px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50; font-weight:600;">
          Submission reopened
        </h2>
        <p style="margin:0 0 24px; font-family:'Lexend Deca', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#333;">
          Darren reopened <strong>${submissionTitle}</strong> for revision. Check the comments
          and upload a new version when ready.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#0E3F50; border-radius:2px;">
            <a href="${reviewUrl}"
               style="display:inline-block; padding:14px 28px; font-family:'Lexend Exa', Georgia, serif; font-size:13px; color:#ffffff; text-decoration:none; letter-spacing:2px; text-transform:uppercase;">
              Open Submission
            </a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, subject: `Darren reopened ${submissionTitle}`,
    html: emailLayout(body),
  })
  if (error) {
    console.error("Failed to send reopened email:", error)
    throw new Error("Failed to send email")
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 3: Commit**

```bash
git add lib/email.ts
git commit -m "feat(email): team video lifecycle notification emails (4 new)"
```

---

## Task 22: Wire Emails into API Routes

**Files:**
- Modify: `app/api/editor/submissions/[id]/finalize/route.ts`
- Modify: `app/api/admin/team-videos/[id]/status/route.ts`

- [ ] **Step 1: Wire upload notification in finalize route**

Edit `app/api/editor/submissions/[id]/finalize/route.ts`. Replace the TODO line with:

```ts
// At the top, add imports:
import { sendVideoUploadedEmail } from "@/lib/email"
import { getBaseUrl } from "@/lib/url"
import { createServiceRoleClient } from "@/lib/supabase"
import type { User } from "@/types/database"

// Replace the TODO comment with this block (just before the final return):
try {
  const supabase = createServiceRoleClient()
  const { data: admins } = await supabase
    .from("users")
    .select("email, first_name")
    .eq("role", "admin")
  if (admins && admins.length > 0) {
    const editorName = session.user.name ?? "Your editor"
    await Promise.all(
      (admins as Array<Pick<User, "email" | "first_name">>).map((a) =>
        sendVideoUploadedEmail({
          to: a.email,
          editorName,
          submissionTitle: submission.title,
          reviewUrl: `${getBaseUrl()}/admin/team-videos/${submission.id}`,
        }),
      ),
    )
  }
} catch (err) {
  console.error("[finalize-email] failed:", err)
}
```

- [ ] **Step 2: Wire emails in status route**

Edit `app/api/admin/team-videos/[id]/status/route.ts`. Add imports at top:

```ts
import {
  sendVideoApprovedEmail,
  sendVideoReopenedEmail,
  sendVideoRevisionRequestedEmail,
} from "@/lib/email"
import { getBaseUrl } from "@/lib/url"
import { getUserById } from "@/lib/db/users"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { countOpenCommentsForVersion } from "@/lib/db/team-video-comments"
```

Replace each `// TODO(Task 22): ...` line with a call to the matching email helper. Wrap each in try/catch so an email failure doesn't fail the status update.

For `approve`:
```ts
try {
  const editor = await getUserById(submission.submitted_by)
  if (editor?.email) {
    await sendVideoApprovedEmail({
      to: editor.email,
      submissionTitle: submission.title,
      reviewUrl: `${getBaseUrl()}/editor/videos/${submission.id}`,
    })
  }
} catch (err) { console.error("[approve-email] failed:", err) }
```

For `request_revision`:
```ts
try {
  const editor = await getUserById(submission.submitted_by)
  const version = await getCurrentVersion(submission.id)
  const openCount = version ? await countOpenCommentsForVersion(version.id) : 0
  if (editor?.email) {
    await sendVideoRevisionRequestedEmail({
      to: editor.email,
      submissionTitle: submission.title,
      openCommentCount: openCount,
      reviewUrl: `${getBaseUrl()}/editor/videos/${submission.id}`,
    })
  }
} catch (err) { console.error("[revision-email] failed:", err) }
```

For `reopen`:
```ts
try {
  const editor = await getUserById(submission.submitted_by)
  if (editor?.email) {
    await sendVideoReopenedEmail({
      to: editor.email,
      submissionTitle: submission.title,
      reviewUrl: `${getBaseUrl()}/editor/videos/${submission.id}`,
    })
  }
} catch (err) { console.error("[reopen-email] failed:", err) }
```

- [ ] **Step 3: Re-run the relevant test files to confirm no regressions**

Run: `npm run test:run -- "team-videos|finalize"`
Expected: still all green (the tests mock these helpers, so adding real-call logic doesn't break them — but if a mock signature drifts, fix it).

- [ ] **Step 4: Commit**

```bash
git add app/api/editor/submissions/[id]/finalize/route.ts \
        app/api/admin/team-videos/[id]/status/route.ts
git commit -m "feat(email): wire team video lifecycle notifications into API routes"
```

---

## Task 23: Sidebar Link with Badge

**Files:**
- Create: `lib/team-videos/badge-count.ts`
- Modify: `components/admin/AdminSidebar.tsx` — add Team Videos item with badge count
- Modify: `components/admin/AdminMobileSidebar.tsx` — same item (no badge if not supported)

- [ ] **Step 1: Create the badge-count helper**

Create `lib/team-videos/badge-count.ts`:

```ts
import { countSubmissionsByStatus } from "@/lib/db/team-video-submissions"

/** Count of "submitted" submissions waiting for admin review. */
export async function getTeamVideoReviewBadgeCount(): Promise<number> {
  return countSubmissionsByStatus("submitted")
}
```

- [ ] **Step 2: Add Team Videos link to AdminSidebar**

Find the navigation section in `components/admin/AdminSidebar.tsx` where the "Team" item lives. Add a new sibling item ABOVE Team:

```tsx
{
  title: "Team Videos",
  items: [{ label: "Team Videos", href: "/admin/team-videos", icon: Video }],
},
```

Add `Video` to the existing lucide import.

If the sidebar's items support a badge count (check the existing item shape), wire it via a server-fetched count. If not, skip the badge for now — adding badge support is out of scope.

- [ ] **Step 3: Add the same item to AdminMobileSidebar**

Edit `components/admin/AdminMobileSidebar.tsx` similarly — add the Team Videos section in the same relative position.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 5: Commit**

```bash
git add lib/team-videos/badge-count.ts \
        components/admin/AdminSidebar.tsx \
        components/admin/AdminMobileSidebar.tsx
git commit -m "feat(admin): Team Videos sidebar link"
```

---

## Task 24: E2E Happy-Path Test

**Files:**
- Create: `__tests__/e2e/team-video-flow.spec.ts`

- [ ] **Step 1: Write the spec**

Create `__tests__/e2e/team-video-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const EDITOR_EMAIL = process.env.E2E_EDITOR_EMAIL
const EDITOR_PASSWORD = process.env.E2E_EDITOR_PASSWORD
const FIXTURE_PATH = join(process.cwd(), "__tests__/fixtures/sample-video.mp4")

test.describe("Team video review flow", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !EDITOR_EMAIL || !EDITOR_PASSWORD || !existsSync(FIXTURE_PATH),
    "Requires E2E_ADMIN_EMAIL/PASSWORD, E2E_EDITOR_EMAIL/PASSWORD, and __tests__/fixtures/sample-video.mp4",
  )

  let submissionId: string

  test.afterAll(async () => {
    if (!submissionId) return
    const supabase = createServiceRoleClient()
    // Cascades will clean up versions, comments, annotations
    await supabase.from("team_video_submissions").delete().eq("id", submissionId)
  })

  test("editor uploads → admin reviews → approve → send to Content Studio", async ({ browser }) => {
    // EDITOR — upload
    const editorCtx = await browser.newContext()
    const editorPage = await editorCtx.newPage()
    await editorPage.goto("/login")
    await editorPage.getByLabel(/email/i).fill(EDITOR_EMAIL!)
    await editorPage.getByLabel(/password/i).fill(EDITOR_PASSWORD!)
    await editorPage.getByRole("button", { name: /log in/i }).click()
    await editorPage.waitForURL("**/editor")

    await editorPage.goto("/editor/upload")
    await editorPage.getByLabel(/title/i).fill(`E2E test video ${Date.now()}`)
    await editorPage.setInputFiles('input[type="file"]', FIXTURE_PATH)
    await editorPage.getByRole("button", { name: /submit for review/i }).click()
    await editorPage.waitForURL("**/editor/videos/**")

    // Capture the submission id from the URL
    const url = new URL(editorPage.url())
    submissionId = url.pathname.split("/").pop()!
    expect(submissionId).toBeTruthy()
    await editorCtx.close()

    // ADMIN — review + approve + send
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto("/login")
    await adminPage.getByLabel(/email/i).fill(ADMIN_EMAIL!)
    await adminPage.getByLabel(/password/i).fill(ADMIN_PASSWORD!)
    await adminPage.getByRole("button", { name: /log in/i }).click()
    await adminPage.waitForURL("**/admin/**")

    await adminPage.goto(`/admin/team-videos/${submissionId}`)
    await expect(adminPage.getByRole("heading", { level: 1 })).toBeVisible()

    await adminPage.getByRole("button", { name: /^approve$/i }).click()
    await expect(adminPage.getByText(/Submission approved/i)).toBeVisible()

    await adminPage.getByRole("button", { name: /send to content studio/i }).click()
    await adminPage.waitForURL("**/admin/content**")
  })
})
```

- [ ] **Step 2: Note about the fixture**

The test depends on `__tests__/fixtures/sample-video.mp4` existing. The user will need to drop a small MP4 there (a few seconds of any video — public-domain sample fine). Without the fixture file, the test skips. Document this in the test's skip condition.

- [ ] **Step 3: Add E2E env vars (DO NOT add yourself)**

Confirm `E2E_EDITOR_EMAIL` and `E2E_EDITOR_PASSWORD` should be added to `.env.local`. Like Plan 1's invite-flow test, do NOT add them — report.

- [ ] **Step 4: Verify the test file is syntactically valid**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 5: Commit**

```bash
git add __tests__/e2e/team-video-flow.spec.ts
git commit -m "test(e2e): full team video upload + approve + handoff flow"
```

---

## Final Verification

- [ ] **Run the full test suite**

```bash
npm run test:run
```

Expected: all team-video tests pass (~25 new tests across DAL/API/validators); pre-existing failures in unrelated files (Resend mock, revalidatePath invariants) remain unchanged.

- [ ] **Run the production build**

```bash
npm run build
```

Expected: Turbopack compile succeeds. The TS phase may still hit the pre-existing `scripts/test-publish-fb.ts` issue (out of scope).

- [ ] **Push to remote**

```bash
git push
```

---

## What's Next (Plan 3)

Plan 3 will add the **on-frame drawing layer** spec'd in §5 of the design doc:

- Add `react-konva` dependency
- Build admin-side drawing tools (pen / arrow / rectangle / 4-color picker) overlaid on the player when paused
- Persist drawings as `drawing_json` in the existing `team_video_annotations` table
- Render annotations on both editor and admin sides during the ±0.5s window around their pinned timestamp
- Hide annotations when the parent comment is resolved
- API: extend the comment-create endpoint (or add a sibling) to accept an `annotation` payload alongside the text

Plan 3 is purely additive — Plan 2's review flow keeps working with text-only comments, and drawings become a polish layer Darren can use when he wants more visual specificity.
