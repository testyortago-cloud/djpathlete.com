# Team Video Drawing Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Frame.io-style on-frame drawing annotations to the team-video review workflow — admin can pause and draw arrows/lines/rectangles on the video frame, those drawings persist 1:1 with comments, and editors see them automatically when playback is within ±0.5 seconds of the pinned timecode.

**Architecture:** Purely additive on top of Plan 2. Drawings are stored as normalized 0-1 coordinate paths in the existing `team_video_annotations` jsonb column. A shared `<DrawingCanvas>` component (react-konva) overlays the video element in two modes: `view` (read-only, for editors and admins outside drawing tool mode) and `edit` (admin-only, when a tool is active). The shared `TeamVideoPlayer` gets one new prop (`onTimeUpdate`) so its parent can decide which annotations are within the visibility window. Comment creation and annotation creation happen in a single API call to keep the UX atomic.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase Postgres · Firebase Storage · NextAuth v5 · Zod · **react-konva + konva** (new) · Vitest + Playwright · shadcn/ui · Lucide

**Spec:** [docs/superpowers/specs/2026-05-03-team-invites-and-video-review-design.md](docs/superpowers/specs/2026-05-03-team-invites-and-video-review-design.md) §5 (Player & Annotation UI)

**Plans 1 + 2 are shipped:** editor role + invites + full video review workflow with timecoded text comments.

---

## File Map

**New files:**
- `lib/db/team-video-annotations.ts` — DAL (createForComment, listForVersion)
- `components/shared/DrawingCanvas.tsx` — react-konva overlay, view + edit modes
- `components/admin/team-videos/DrawingToolbar.tsx` — pen / arrow / rectangle + 4-color picker
- `__tests__/lib/db/team-video-annotations.test.ts`

**Modified files:**
- `package.json` — add `react-konva` + `konva`
- `types/database.ts` — narrow `drawing_json: unknown` → `DrawingJson` shape; add `TeamVideoCommentWithAnnotation` for the API response shape
- `lib/validators/team-video.ts` — extend `createCommentSchema` with optional `annotation` field; new `drawingJsonSchema`
- `app/api/admin/team-videos/[id]/comments/route.ts` — POST persists annotation when provided; GET returns each comment with `annotation` merged in
- `__tests__/api/admin/team-videos/comments.test.ts` — add cases for annotation create + GET shape
- `components/shared/TeamVideoPlayer.tsx` — add optional `onTimeUpdate(seconds)` prop; wrap `<video>` in a positioning container so an overlay can be rendered as a sibling
- `components/admin/team-videos/CommentEditor.tsx` — wire optional drawing payload into the POST body
- `components/admin/team-videos/ReviewSurface.tsx` — render `<DrawingCanvas mode="view">` for visible annotations + admin-only `<DrawingToolbar>` + admin-only `<DrawingCanvas mode="edit">`
- `components/editor/EditorVideoView.tsx` — render `<DrawingCanvas mode="view">` for visible annotations (read-only)

**Storage:** No schema migration needed — `team_video_annotations` table was created in Plan 2's Task 1 with `drawing_json jsonb NOT NULL` and `comment_id uuid REFERENCES team_video_comments(id) ON DELETE CASCADE`.

---

## Drawing JSON Shape (Reference)

Used throughout the plan. Coordinates are normalized 0-1 fractions of player width/height so they re-project at any size.

```ts
type DrawingTool = "pen" | "arrow" | "rectangle"

interface DrawingPath {
  tool: DrawingTool
  color: string          // one of the 4 picker colors
  width: number          // stroke width in pixels (2-8)
  points: Array<[number, number]>  // normalized [0,1] coords
}

interface DrawingJson {
  paths: DrawingPath[]
}
```

- **pen**: `points` is N vertices (rendered as a polyline)
- **arrow**: `points` is exactly 2 vertices `[start, end]`
- **rectangle**: `points` is exactly 2 vertices `[topLeft, bottomRight]`

Visibility window: `Math.abs(currentTime - comment.timecode_seconds) <= 0.5` AND `comment.status === "open"` AND `comment.timecode_seconds != null`.

---

## Task 1: Install react-konva + konva

**Files:**
- Modify: `package.json` (via `npm install`)

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install react-konva konva
```

Expected: both packages added to `dependencies`. The current React version in this project is 19 — `react-konva@^19` is required (the most recent versions support React 19).

- [ ] **Step 2: Verify install**

Confirm:

```bash
node -e "console.log(require('react-konva/package.json').version)"
node -e "console.log(require('konva/package.json').version)"
```

Both should print version strings (any modern version — `react-konva` ≥ 19.0.0, `konva` ≥ 9.0.0).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add react-konva + konva for drawing annotations"
```

---

## Task 2: Type Narrowing for DrawingJson

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Add types and narrow `drawing_json`**

In `types/database.ts`, find the existing block from Plan 2 Task 3:

```ts
export interface TeamVideoAnnotation {
  id: string
  comment_id: string
  drawing_json: unknown  // typed in Plan 3
  created_at: string
}
```

Replace it with:

```ts
export type DrawingTool = "pen" | "arrow" | "rectangle"

export interface DrawingPath {
  tool: DrawingTool
  color: string                       // hex like "#FF3B30"
  width: number                       // stroke width px (2-8)
  points: Array<[number, number]>     // normalized 0-1 coords
}

export interface DrawingJson {
  paths: DrawingPath[]
}

export interface TeamVideoAnnotation {
  id: string
  comment_id: string
  drawing_json: DrawingJson
  created_at: string
}

/** API response shape: a comment plus its (optional) annotation drawing. */
export interface TeamVideoCommentWithAnnotation extends TeamVideoComment {
  annotation: DrawingJson | null
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134. (No callers of `drawing_json` exist yet — this is just narrowing for future code.)

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): narrow DrawingJson + TeamVideoCommentWithAnnotation"
```

---

## Task 3: Annotations DAL (TDD)

**Files:**
- Create: `lib/db/team-video-annotations.ts`
- Create: `__tests__/lib/db/team-video-annotations.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/team-video-annotations.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const selectMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      select: selectMock,
    }),
  }),
}))

import {
  createAnnotationForComment,
  listAnnotationsForCommentIds,
} from "@/lib/db/team-video-annotations"

beforeEach(() => vi.clearAllMocks())

describe("createAnnotationForComment", () => {
  it("inserts a drawing for a comment and returns the row", async () => {
    const drawing = { paths: [{ tool: "arrow", color: "#FF3B30", width: 3,
                                 points: [[0.1, 0.1], [0.9, 0.9]] }] }
    const row = { id: "ann1", comment_id: "c1", drawing_json: drawing }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
    const result = await createAnnotationForComment("c1", drawing as never)
    expect(result).toEqual(row)
    const args = insertMock.mock.calls[0][0]
    expect(args.comment_id).toBe("c1")
    expect(args.drawing_json).toEqual(drawing)
  })
})

describe("listAnnotationsForCommentIds", () => {
  it("returns a map keyed by comment_id", async () => {
    selectMock.mockReturnValue({
      in: () => Promise.resolve({
        data: [
          { comment_id: "c1", drawing_json: { paths: [{ tool: "pen", color: "#000", width: 2, points: [[0,0],[1,1]] }] } },
          { comment_id: "c2", drawing_json: { paths: [] } },
        ],
        error: null,
      }),
    })
    const result = await listAnnotationsForCommentIds(["c1", "c2", "c3"])
    expect(result.size).toBe(2)
    expect(result.get("c1")?.paths[0].tool).toBe("pen")
    expect(result.get("c2")?.paths).toHaveLength(0)
    expect(result.get("c3")).toBeUndefined()
  })
  it("returns empty map for empty input", async () => {
    const result = await listAnnotationsForCommentIds([])
    expect(result.size).toBe(0)
    expect(selectMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-video-annotations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/team-video-annotations.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { DrawingJson, TeamVideoAnnotation } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createAnnotationForComment(
  commentId: string,
  drawing: DrawingJson,
): Promise<TeamVideoAnnotation> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_annotations")
    .insert({
      comment_id: commentId,
      drawing_json: drawing,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamVideoAnnotation
}

/**
 * Fetch annotations for many comments in one query and return them keyed
 * by comment_id. Empty input → empty map (no DB call).
 */
export async function listAnnotationsForCommentIds(
  commentIds: string[],
): Promise<Map<string, DrawingJson>> {
  if (commentIds.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_video_annotations")
    .select("comment_id, drawing_json")
    .in("comment_id", commentIds)
  if (error) throw error
  const map = new Map<string, DrawingJson>()
  for (const row of (data ?? []) as Array<{ comment_id: string; drawing_json: DrawingJson }>) {
    map.set(row.comment_id, row.drawing_json)
  }
  return map
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-video-annotations`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/team-video-annotations.ts __tests__/lib/db/team-video-annotations.test.ts
git commit -m "feat(db): team video annotations DAL"
```

---

## Task 4: Validator Extension

**Files:**
- Modify: `lib/validators/team-video.ts`
- Modify: `__tests__/lib/validators/team-video.test.ts` (add cases)

- [ ] **Step 1: Add `drawingJsonSchema` and extend `createCommentSchema`**

Edit `lib/validators/team-video.ts`. Add this near the top, after the existing constants:

```ts
const ALLOWED_DRAWING_COLORS = [
  "#FF3B30", // red
  "#FFCC00", // yellow
  "#34C759", // green
  "#000000", // black
] as const

const drawingPathSchema = z.object({
  tool: z.enum(["pen", "arrow", "rectangle"]),
  color: z.enum(ALLOWED_DRAWING_COLORS),
  width: z.number().int().min(2).max(8),
  points: z
    .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
    .min(2),
})

export const drawingJsonSchema = z.object({
  paths: z.array(drawingPathSchema).min(1, "At least one path required").max(50),
})

export type DrawingJsonInput = z.infer<typeof drawingJsonSchema>
```

Then update `createCommentSchema`:

```ts
export const createCommentSchema = z.object({
  timecodeSeconds: z.number().min(0).nullable(),
  commentText: z.string().trim().min(1, "Comment cannot be empty").max(2000),
  annotation: drawingJsonSchema.optional(),
})
```

- [ ] **Step 2: Add tests for the new schema and extension**

Edit `__tests__/lib/validators/team-video.test.ts`. Append after the existing `describe("createCommentSchema", ...)` block (or inside it):

```ts
describe("drawingJsonSchema", () => {
  const goodPath = {
    tool: "arrow", color: "#FF3B30", width: 3,
    points: [[0.1, 0.1], [0.9, 0.9]],
  }
  it("accepts a valid drawing", () => {
    const r = drawingJsonSchema.safeParse({ paths: [goodPath] })
    expect(r.success).toBe(true)
  })
  it("rejects unknown color", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ ...goodPath, color: "#123456" }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects coords > 1", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ ...goodPath, points: [[0, 0], [1.5, 0.5]] }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects single-point path", () => {
    const r = drawingJsonSchema.safeParse({
      paths: [{ ...goodPath, points: [[0.5, 0.5]] }],
    })
    expect(r.success).toBe(false)
  })
  it("rejects empty paths array", () => {
    const r = drawingJsonSchema.safeParse({ paths: [] })
    expect(r.success).toBe(false)
  })
})

describe("createCommentSchema with annotation", () => {
  it("accepts a comment without annotation (backwards compat)", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 1, commentText: "x",
    })
    expect(r.success).toBe(true)
  })
  it("accepts a comment with valid annotation", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 1, commentText: "x",
      annotation: { paths: [{ tool: "pen", color: "#000000", width: 2,
                              points: [[0, 0], [1, 1]] }] },
    })
    expect(r.success).toBe(true)
  })
  it("rejects a comment with invalid annotation", () => {
    const r = createCommentSchema.safeParse({
      timecodeSeconds: 1, commentText: "x",
      annotation: { paths: [{ tool: "scribble", color: "#000000", width: 2,
                               points: [[0, 0], [1, 1]] }] },
    })
    expect(r.success).toBe(false)
  })
})
```

Also add `drawingJsonSchema` to the import block at the top of the test file.

- [ ] **Step 3: Run all team-video validator tests**

Run: `npm run test:run -- team-video`
Expected: original 11 + new 8 = 19/19 PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/validators/team-video.ts __tests__/lib/validators/team-video.test.ts
git commit -m "feat(validators): drawingJsonSchema + annotation field on createCommentSchema"
```

---

## Task 5: API — Persist Annotation on Comment Create

**Files:**
- Modify: `app/api/admin/team-videos/[id]/comments/route.ts`
- Modify: `__tests__/api/admin/team-videos/comments.test.ts` (add cases)

- [ ] **Step 1: Add a failing test**

Edit `__tests__/api/admin/team-videos/comments.test.ts`. Add to the imports at top (the test file already mocks `team-video-comments`; we need to add a mock for the new annotations DAL):

```ts
vi.mock("@/lib/db/team-video-annotations", () => ({
  createAnnotationForComment: vi.fn(),
  listAnnotationsForCommentIds: vi.fn().mockResolvedValue(new Map()),
}))
```

Add this import:

```ts
import { createAnnotationForComment } from "@/lib/db/team-video-annotations"
```

Then add a new test inside the `describe("POST ...")` block (after the existing 5 cases):

```ts
it("creates annotation when annotation payload is included", async () => {
  ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "admin1", role: "admin" },
  })
  ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "sub1", status: "in_review",
  })
  ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
  ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c1" })

  const drawing = {
    paths: [{ tool: "arrow", color: "#FF3B30", width: 3,
              points: [[0.1, 0.1], [0.9, 0.9]] }],
  }
  const res = await POST(
    post({ timecodeSeconds: 10, commentText: "Note", annotation: drawing }),
    { params },
  )
  expect(res.status).toBe(201)
  expect(createAnnotationForComment).toHaveBeenCalledWith("c1", drawing)
})

it("does NOT create annotation when payload is absent", async () => {
  ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "admin1", role: "admin" },
  })
  ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "sub1", status: "in_review",
  })
  ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
  ;(createComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "c2" })

  const res = await POST(
    post({ timecodeSeconds: 10, commentText: "No drawing" }),
    { params },
  )
  expect(res.status).toBe(201)
  expect(createAnnotationForComment).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- team-videos/comments`
Expected: FAIL — `createAnnotationForComment` is mocked but not called by the route yet (the new tests will fail on the assertion).

- [ ] **Step 3: Update the POST handler**

Edit `app/api/admin/team-videos/[id]/comments/route.ts`. Add this import at the top:

```ts
import { createAnnotationForComment, listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
```

In the POST handler, after the line `const comment = await createComment({...})`, insert:

```ts
  // Persist annotation drawing alongside the comment, if provided.
  if (parsed.data.annotation) {
    try {
      await createAnnotationForComment(comment.id, parsed.data.annotation)
    } catch (err) {
      console.error("[comment-annotation] failed to persist:", err)
      // Don't fail the comment create — the text comment still exists and is useful.
    }
  }
```

(The status-bump and 201 return logic stays the same.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-videos/comments`
Expected: 9/9 PASS (7 originals + 2 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/team-videos/[id]/comments/route.ts \
        __tests__/api/admin/team-videos/comments.test.ts
git commit -m "feat(api): persist drawing annotation alongside comment"
```

---

## Task 6: API — Return Annotations with GET Comments

**Files:**
- Modify: `app/api/admin/team-videos/[id]/comments/route.ts`
- Modify: `__tests__/api/admin/team-videos/comments.test.ts` (add a case)

- [ ] **Step 1: Add a failing test for the GET shape**

Add to `__tests__/api/admin/team-videos/comments.test.ts` inside the `describe("GET ...")` block:

```ts
it("returns comments with annotation field merged in", async () => {
  ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "admin1", role: "admin" },
  })
  ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sub1" })
  ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "v1" })
  ;(listCommentsForVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "c1", timecode_seconds: 10, comment_text: "with drawing" },
    { id: "c2", timecode_seconds: null, comment_text: "general, no drawing" },
  ])
  const drawing = { paths: [{ tool: "pen", color: "#000000", width: 2,
                              points: [[0, 0], [1, 1]] }] }
  ;(listAnnotationsForCommentIds as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Map([["c1", drawing]]),
  )
  const res = await GET(new Request("http://x"), { params })
  expect(res.status).toBe(200)
  const json = await res.json()
  expect(json.comments).toHaveLength(2)
  expect(json.comments[0].annotation).toEqual(drawing)
  expect(json.comments[1].annotation).toBeNull()
})
```

Also import `listAnnotationsForCommentIds` at the top:

```ts
import { createAnnotationForComment, listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npm run test:run -- team-videos/comments`
Expected: 9/10 pass (the new one fails — current GET doesn't return annotations).

- [ ] **Step 3: Update the GET handler**

In `app/api/admin/team-videos/[id]/comments/route.ts`, replace the GET handler's body with:

```ts
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
  const annotationMap = await listAnnotationsForCommentIds(comments.map((c) => c.id))
  const merged = comments.map((c) => ({
    ...c,
    annotation: annotationMap.get(c.id) ?? null,
  }))
  return NextResponse.json({ comments: merged })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- team-videos/comments`
Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/team-videos/[id]/comments/route.ts \
        __tests__/api/admin/team-videos/comments.test.ts
git commit -m "feat(api): GET comments returns annotation field per row"
```

---

## Task 7: Page-Level Annotation Loading

The admin review page (`app/(admin)/admin/team-videos/[id]/page.tsx`) and the editor video page (`app/(editor)/editor/videos/[id]/page.tsx`) both load comments server-side via `listCommentsForVersion`. Now they need to also load annotations and merge them, so the props passed to the client components include drawings.

**Files:**
- Modify: `app/(admin)/admin/team-videos/[id]/page.tsx`
- Modify: `app/(editor)/editor/videos/[id]/page.tsx`

- [ ] **Step 1: Update the admin page to merge annotations**

In `app/(admin)/admin/team-videos/[id]/page.tsx`, add this import:

```ts
import { listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
```

Replace the `listCommentsForVersion` line and what follows with:

```ts
  const rawComments = version ? await listCommentsForVersion(version.id) : []
  const annotationMap = await listAnnotationsForCommentIds(rawComments.map((c) => c.id))
  const comments = rawComments.map((c) => ({
    ...c,
    annotation: annotationMap.get(c.id) ?? null,
  }))
```

- [ ] **Step 2: Update the editor page to merge annotations the same way**

In `app/(editor)/editor/videos/[id]/page.tsx`, make the same change (add the import + replace the comment-loading block).

- [ ] **Step 3: Update the prop type on both client components**

In `components/admin/team-videos/ReviewSurface.tsx` and `components/editor/EditorVideoView.tsx`, change the `comments` prop type from `TeamVideoComment[]` to `TeamVideoCommentWithAnnotation[]`. Also update the import:

```ts
import type {
  TeamVideoSubmission, TeamVideoVersion, TeamVideoCommentWithAnnotation,
} from "@/types/database"
```

(Drop `TeamVideoComment` if it's no longer used in these files. The `CommentThread` and `TeamVideoPlayer` props are typed `TeamVideoComment[]` — that's fine because `TeamVideoCommentWithAnnotation extends TeamVideoComment`, so it's assignable.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/team-videos/\[id\]/page.tsx \
        app/\(editor\)/editor/videos/\[id\]/page.tsx \
        components/admin/team-videos/ReviewSurface.tsx \
        components/editor/EditorVideoView.tsx
git commit -m "feat(pages): load annotations server-side for review surfaces"
```

---

## Task 8: TeamVideoPlayer — onTimeUpdate + Overlay Container

The shared player needs two small changes so a parent can render an overlay positioned over the video and react to playback time changes.

**Files:**
- Modify: `components/shared/TeamVideoPlayer.tsx`

- [ ] **Step 1: Add the `onTimeUpdate` callback prop**

In `components/shared/TeamVideoPlayer.tsx`, update the Props interface to add an optional callback:

```ts
interface Props {
  /** Signed read URL for the video file. */
  src: string
  /** Comments to render as markers on the timeline. */
  comments: TeamVideoComment[]
  /** Called when a marker is clicked. Parent typically scrolls comment thread to it. */
  onMarkerClick?: (commentId: string, timecodeSeconds: number) => void
  /** Called on every `timeupdate` event with the current playback position (seconds). */
  onTimeUpdate?: (currentSeconds: number) => void
  /** Optional render-prop for content that should overlay the <video> element. */
  renderOverlay?: () => React.ReactNode
}
```

In the `useEffect` that wires the `<video>` event listeners, change:

```ts
const onTimeUpdate = () => setCurrentTime(v.currentTime)
```

to (rename the local handler to avoid shadowing the prop):

```ts
const onTimeUpdateHandler = () => {
  setCurrentTime(v.currentTime)
  onTimeUpdate?.(v.currentTime)
}
```

And update the `addEventListener`/`removeEventListener` calls accordingly:

```ts
v.addEventListener("timeupdate", onTimeUpdateHandler)
// ... and the matching removeEventListener
v.removeEventListener("timeupdate", onTimeUpdateHandler)
```

Add `onTimeUpdate` to the `useEffect` dependency array.

- [ ] **Step 2: Wrap the `<video>` in a positioning container and render overlay**

In the JSX, change:

```tsx
<div className="overflow-hidden rounded-md bg-black">
  <video
    ref={videoRef}
    src={src}
    className="aspect-video w-full"
    preload="metadata"
    controls={false}
  />
</div>
```

to:

```tsx
<div className="relative overflow-hidden rounded-md bg-black">
  <video
    ref={videoRef}
    src={src}
    className="aspect-video w-full"
    preload="metadata"
    controls={false}
  />
  {renderOverlay && (
    <div className="pointer-events-none absolute inset-0">
      {renderOverlay()}
    </div>
  )}
</div>
```

(The `pointer-events-none` lets clicks pass through to the video by default; the DrawingCanvas in edit mode will set `pointer-events-auto` on its own root.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134.

- [ ] **Step 4: Commit**

```bash
git add components/shared/TeamVideoPlayer.tsx
git commit -m "feat(player): add onTimeUpdate callback + renderOverlay slot"
```

---

## Task 9: Shared DrawingCanvas Component

The Konva-based canvas component. Two modes:
- `view` — renders existing paths read-only; ignores pointer events
- `edit` — renders existing paths AND captures new pen strokes / shapes; emits new path on completion

**Files:**
- Create: `components/shared/DrawingCanvas.tsx`

- [ ] **Step 1: Implement the component**

Create `components/shared/DrawingCanvas.tsx`:

```tsx
"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import type Konva from "konva"
import type { DrawingJson, DrawingPath, DrawingTool } from "@/types/database"

// react-konva is canvas-only — disable SSR to avoid hydration issues.
const Stage = dynamic(() => import("react-konva").then((m) => m.Stage), { ssr: false })
const Layer = dynamic(() => import("react-konva").then((m) => m.Layer), { ssr: false })
const Line = dynamic(() => import("react-konva").then((m) => m.Line), { ssr: false })
const Arrow = dynamic(() => import("react-konva").then((m) => m.Arrow), { ssr: false })
const Rect = dynamic(() => import("react-konva").then((m) => m.Rect), { ssr: false })

interface ViewProps {
  mode: "view"
  width: number
  height: number
  drawing: DrawingJson | null
}

interface EditProps {
  mode: "edit"
  width: number
  height: number
  /** Active drawing tool. New strokes use this tool until it changes. */
  tool: DrawingTool
  /** Active stroke color (must be one of the picker's hex values). */
  color: string
  /** Stroke width in pixels (2-8). */
  strokeWidth: number
  /** The drawing being authored. Parent owns state. */
  drawing: DrawingJson
  /** Called whenever the drawing's paths change. */
  onChange: (drawing: DrawingJson) => void
}

type Props = ViewProps | EditProps

/** Project a normalized [0,1] point to pixel coords for the current size. */
function project(p: [number, number], w: number, h: number): [number, number] {
  return [p[0] * w, p[1] * h]
}

/** Inverse: pixel → normalized [0,1]. */
function normalize(x: number, y: number, w: number, h: number): [number, number] {
  return [
    Math.max(0, Math.min(1, x / w)),
    Math.max(0, Math.min(1, y / h)),
  ]
}

function flatten(points: Array<[number, number]>, w: number, h: number): number[] {
  const out: number[] = []
  for (const p of points) {
    const [px, py] = project(p, w, h)
    out.push(px, py)
  }
  return out
}

function renderPath(path: DrawingPath, idx: number, w: number, h: number) {
  const flat = flatten(path.points, w, h)
  const common = {
    key: idx,
    stroke: path.color,
    strokeWidth: path.width,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  }
  if (path.tool === "pen") {
    return <Line {...common} points={flat} />
  }
  if (path.tool === "arrow") {
    return <Arrow {...common} fill={path.color} points={flat} />
  }
  // rectangle: 2 points → x/y/width/height
  const [x1, y1] = [flat[0], flat[1]]
  const [x2, y2] = [flat[2], flat[3]]
  return (
    <Rect
      {...common}
      x={Math.min(x1, x2)}
      y={Math.min(y1, y2)}
      width={Math.abs(x2 - x1)}
      height={Math.abs(y2 - y1)}
      fillEnabled={false}
    />
  )
}

export function DrawingCanvas(props: Props) {
  const { mode, width, height } = props
  const drawing = props.drawing ?? { paths: [] }

  // Edit-mode state for the in-progress path
  const [draftPath, setDraftPath] = useState<DrawingPath | null>(null)
  const drawingRef = useRef<DrawingJson>(drawing)
  drawingRef.current = drawing

  function pointerXY(e: Konva.KonvaEventObject<PointerEvent>): [number, number] | null {
    const stage = e.target.getStage()
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    return normalize(pos.x, pos.y, width, height)
  }

  function onPointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
    if (mode !== "edit") return
    const xy = pointerXY(e)
    if (!xy) return
    setDraftPath({
      tool: props.tool,
      color: props.color,
      width: props.strokeWidth,
      points: [xy, xy],
    })
  }

  function onPointerMove(e: Konva.KonvaEventObject<PointerEvent>) {
    if (mode !== "edit" || !draftPath) return
    const xy = pointerXY(e)
    if (!xy) return
    setDraftPath((prev) => {
      if (!prev) return prev
      if (prev.tool === "pen") {
        return { ...prev, points: [...prev.points, xy] }
      }
      // arrow + rectangle: keep first point, update second
      return { ...prev, points: [prev.points[0], xy] }
    })
  }

  function onPointerUp() {
    if (mode !== "edit" || !draftPath) return
    const next: DrawingJson = {
      paths: [...drawingRef.current.paths, draftPath],
    }
    setDraftPath(null)
    if (mode === "edit") props.onChange(next)
  }

  // Re-render when window resizes or container size changes (parent passes new w/h)
  useEffect(() => { /* width/height props drive reflow */ }, [width, height])

  return (
    <div
      className={mode === "edit" ? "pointer-events-auto" : "pointer-events-none"}
      style={{ width, height }}
    >
      <Stage
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <Layer>
          {drawing.paths.map((p, i) => renderPath(p, i, width, height))}
          {draftPath && renderPath(draftPath, drawing.paths.length, width, height)}
        </Layer>
      </Stage>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134.

If `Konva` import errors: change `import type Konva from "konva"` to `import type { KonvaEventObject } from "konva/lib/Node"` and update the event types accordingly. Different `konva` versions expose types from different paths.

- [ ] **Step 3: Commit**

```bash
git add components/shared/DrawingCanvas.tsx
git commit -m "feat(shared): DrawingCanvas with view/edit modes (react-konva)"
```

---

## Task 10: Admin DrawingToolbar Component

Floating toolbar visible only when admin enables drawing mode. Lets admin pick a tool, color, and width.

**Files:**
- Create: `components/admin/team-videos/DrawingToolbar.tsx`

- [ ] **Step 1: Implement the toolbar**

Create `components/admin/team-videos/DrawingToolbar.tsx`:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Pencil, ArrowUpRight, Square, X } from "lucide-react"
import type { DrawingTool } from "@/types/database"

const COLORS = [
  { name: "red",    hex: "#FF3B30" },
  { name: "yellow", hex: "#FFCC00" },
  { name: "green",  hex: "#34C759" },
  { name: "black",  hex: "#000000" },
] as const

const TOOL_BUTTONS: Array<{ tool: DrawingTool; label: string; Icon: typeof Pencil }> = [
  { tool: "pen",       label: "Pen",       Icon: Pencil },
  { tool: "arrow",     label: "Arrow",     Icon: ArrowUpRight },
  { tool: "rectangle", label: "Rectangle", Icon: Square },
]

interface Props {
  active: boolean
  tool: DrawingTool
  color: string
  strokeWidth: number
  onToolChange: (tool: DrawingTool) => void
  onColorChange: (hex: string) => void
  onStrokeWidthChange: (px: number) => void
  onCancel: () => void
}

export function DrawingToolbar({
  active, tool, color, strokeWidth,
  onToolChange, onColorChange, onStrokeWidthChange, onCancel,
}: Props) {
  if (!active) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 shadow-sm">
      <div className="flex items-center gap-1">
        {TOOL_BUTTONS.map(({ tool: t, label, Icon }) => (
          <Button
            key={t}
            type="button"
            size="sm"
            variant={tool === t ? "default" : "outline"}
            onClick={() => onToolChange(t)}
            aria-label={label}
            aria-pressed={tool === t}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>

      <div className="mx-2 h-6 w-px bg-border" aria-hidden />

      <div className="flex items-center gap-1">
        {COLORS.map(({ name, hex }) => (
          <button
            key={hex}
            type="button"
            onClick={() => onColorChange(hex)}
            aria-label={`${name} color`}
            aria-pressed={color === hex}
            className={`size-6 rounded-full border-2 ${
              color === hex ? "border-primary" : "border-border"
            }`}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>

      <div className="mx-2 h-6 w-px bg-border" aria-hidden />

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Width
        <input
          type="range"
          min={2}
          max={8}
          value={strokeWidth}
          onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
          className="w-20"
        />
        <span className="w-4 text-right tabular-nums">{strokeWidth}</span>
      </label>

      <div className="ml-auto">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel drawing">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → should still be 134.

- [ ] **Step 3: Commit**

```bash
git add components/admin/team-videos/DrawingToolbar.tsx
git commit -m "feat(admin): drawing toolbar (pen/arrow/rect + 4 colors)"
```

---

## Task 11: Wire Drawing into Admin ReviewSurface

The admin review surface gets:
- A "Draw" toggle button (next to the comment editor) that enters drawing mode
- The DrawingToolbar visible when drawing mode is on
- Two DrawingCanvas instances overlayed via the player's `renderOverlay` slot:
  - One in `view` mode showing all CURRENTLY VISIBLE annotations (within ±0.5s of currentTime)
  - One in `edit` mode (only when drawing mode is on) capturing the in-progress drawing
- The CommentEditor extended to include the drawing in its POST when present

**Files:**
- Modify: `components/admin/team-videos/ReviewSurface.tsx`
- Modify: `components/admin/team-videos/CommentEditor.tsx`

- [ ] **Step 1: Update CommentEditor to accept an optional drawing**

Edit `components/admin/team-videos/CommentEditor.tsx`. Update the Props interface and the POST body:

```tsx
interface Props {
  submissionId: string
  getCurrentTimecode: () => number | null
  onCreated: () => void
  /** Optional drawing payload. When non-null, posted alongside the comment. */
  drawing?: import("@/types/database").DrawingJson | null
  /** Called after a successful POST so the parent can clear its drawing state. */
  onAfterSubmit?: () => void
}

// ... inside the component:
async function submit(e: React.FormEvent) {
  e.preventDefault()
  if (!text.trim()) return
  setSubmitting(true)
  try {
    const timecodeSeconds = general ? null : getCurrentTimecode()
    const body: Record<string, unknown> = {
      timecodeSeconds,
      commentText: text.trim(),
    }
    if (drawing && drawing.paths.length > 0 && timecodeSeconds != null) {
      body.annotation = drawing
    }
    const res = await fetch(`/api/admin/team-videos/${submissionId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? "Comment failed")
    }
    setText("")
    onCreated()
    onAfterSubmit?.()
    router.refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Comment failed")
  } finally {
    setSubmitting(false)
  }
}
```

(Annotations only attach to timecoded comments, not general comments — enforced by the `timecodeSeconds != null` guard.)

- [ ] **Step 2: Update ReviewSurface to wire the drawing flow**

Edit `components/admin/team-videos/ReviewSurface.tsx`. The overall structure changes substantially. Replace the file with:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Brush } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { TeamVideoPlayer, type TeamVideoPlayerHandle } from "@/components/shared/TeamVideoPlayer"
import { CommentThread } from "@/components/shared/CommentThread"
import { DrawingCanvas } from "@/components/shared/DrawingCanvas"
import { StatusActions } from "./StatusActions"
import { CommentEditor } from "./CommentEditor"
import { DrawingToolbar } from "./DrawingToolbar"
import type {
  TeamVideoSubmission, TeamVideoVersion, TeamVideoCommentWithAnnotation,
  DrawingJson, DrawingTool,
} from "@/types/database"

const VISIBILITY_WINDOW_S = 0.5

interface Props {
  submission: TeamVideoSubmission
  version: TeamVideoVersion | null
  comments: TeamVideoCommentWithAnnotation[]
  videoUrl: string | null
}

export function ReviewSurface({ submission, version, comments, videoUrl }: Props) {
  const router = useRouter()
  const playerRef = useRef<TeamVideoPlayerHandle>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 })
  const [currentTime, setCurrentTime] = useState(0)

  // Drawing-mode state
  const [drawingMode, setDrawingMode] = useState(false)
  const [tool, setTool] = useState<DrawingTool>("arrow")
  const [color, setColor] = useState("#FF3B30")
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [draftDrawing, setDraftDrawing] = useState<DrawingJson>({ paths: [] })

  // Track the rendered video size so the canvas matches it pixel-for-pixel
  useEffect(() => {
    if (!overlayRef.current) return
    const el = overlayRef.current
    const ro = new ResizeObserver(() => {
      setOverlaySize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [videoUrl])

  // Visible annotations: open + timecoded + within window
  const visibleAnnotations = comments.filter((c) =>
    c.status === "open"
    && c.timecode_seconds != null
    && c.annotation
    && Math.abs(currentTime - c.timecode_seconds) <= VISIBILITY_WINDOW_S
  )
  const mergedView: DrawingJson = {
    paths: visibleAnnotations.flatMap((c) => c.annotation?.paths ?? []),
  }

  function startDrawing() {
    playerRef.current?.pause()
    setDraftDrawing({ paths: [] })
    setDrawingMode(true)
  }

  function cancelDrawing() {
    setDraftDrawing({ paths: [] })
    setDrawingMode(false)
  }

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

  function renderOverlay() {
    if (overlaySize.width === 0 || overlaySize.height === 0) return null
    return (
      <div ref={overlayRef} className="absolute inset-0">
        {/* Read-only annotations from existing visible comments */}
        {!drawingMode && visibleAnnotations.length > 0 && (
          <DrawingCanvas
            mode="view"
            width={overlaySize.width}
            height={overlaySize.height}
            drawing={mergedView}
          />
        )}
        {/* Active drawing canvas in edit mode */}
        {drawingMode && (
          <DrawingCanvas
            mode="edit"
            width={overlaySize.width}
            height={overlaySize.height}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            drawing={draftDrawing}
            onChange={setDraftDrawing}
          />
        )}
      </div>
    )
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
              Version {version.version_number} &middot; status: {submission.status}
            </p>
          )}
        </div>
        <StatusActions submission={submission} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {videoUrl ? (
            <div ref={overlayRef} className="relative">
              <TeamVideoPlayer
                ref={playerRef}
                src={videoUrl}
                comments={comments}
                onTimeUpdate={setCurrentTime}
                renderOverlay={renderOverlay}
              />
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
              {version ? "Video upload not finalized." : "No video uploaded yet."}
            </div>
          )}

          {videoUrl && (
            <DrawingToolbar
              active={drawingMode}
              tool={tool}
              color={color}
              strokeWidth={strokeWidth}
              onToolChange={setTool}
              onColorChange={setColor}
              onStrokeWidthChange={setStrokeWidth}
              onCancel={cancelDrawing}
            />
          )}

          {videoUrl && (
            <div className="flex items-center gap-2">
              {!drawingMode ? (
                <Button type="button" size="sm" variant="outline" onClick={startDrawing}>
                  <Brush className="mr-1 size-4" /> Draw on frame
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Draw on the video, then add a comment to save the drawing with it.
                </p>
              )}
            </div>
          )}

          {videoUrl && (
            <CommentEditor
              submissionId={submission.id}
              getCurrentTimecode={() => playerRef.current?.getCurrentTime() ?? null}
              onCreated={() => router.refresh()}
              drawing={drawingMode ? draftDrawing : null}
              onAfterSubmit={cancelDrawing}
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

(Note: `overlayRef` does double-duty — it's the wrapper around the `<TeamVideoPlayer>` so `ResizeObserver` can read the rendered video size. The actual render of the overlay happens inside the player via `renderOverlay`.)

- [ ] **Step 3: Build verify**

Run: `npm run build`. Compile phase should succeed. (TS phase will still fail on the pre-existing `scripts/test-publish-fb.ts` issue — unrelated.) Confirm Turbopack compile is clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/team-videos/ReviewSurface.tsx \
        components/admin/team-videos/CommentEditor.tsx
git commit -m "feat(admin): drawing mode + overlay in review surface"
```

---

## Task 12: Editor Read-Only Drawing Display

The editor sees drawings in pure view mode — no toolbar, no editing, just the overlay synced to currentTime.

**Files:**
- Modify: `components/editor/EditorVideoView.tsx`

- [ ] **Step 1: Add read-only annotation overlay**

Edit `components/editor/EditorVideoView.tsx`. Add imports:

```tsx
import { useEffect, useRef, useState } from "react"  // useEffect, useState may be new
import { DrawingCanvas } from "@/components/shared/DrawingCanvas"
import type { DrawingJson, TeamVideoCommentWithAnnotation } from "@/types/database"
```

Update Props (replace `comments: TeamVideoComment[]` with):

```tsx
comments: TeamVideoCommentWithAnnotation[]
```

Inside the component (right after the existing `useState`/`useRef` lines), add:

```tsx
const overlayRef = useRef<HTMLDivElement | null>(null)
const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 })
const [currentTime, setCurrentTime] = useState(0)

useEffect(() => {
  if (!overlayRef.current) return
  const el = overlayRef.current
  const ro = new ResizeObserver(() => {
    setOverlaySize({ width: el.clientWidth, height: el.clientHeight })
  })
  ro.observe(el)
  return () => ro.disconnect()
}, [videoUrl])

const VISIBILITY_WINDOW_S = 0.5
const visibleAnnotations = comments.filter((c) =>
  c.status === "open"
  && c.timecode_seconds != null
  && c.annotation
  && Math.abs(currentTime - c.timecode_seconds) <= VISIBILITY_WINDOW_S
)
const mergedView: DrawingJson = {
  paths: visibleAnnotations.flatMap((c) => c.annotation?.paths ?? []),
}

function renderOverlay() {
  if (overlaySize.width === 0 || overlaySize.height === 0) return null
  if (visibleAnnotations.length === 0) return null
  return (
    <DrawingCanvas
      mode="view"
      width={overlaySize.width}
      height={overlaySize.height}
      drawing={mergedView}
    />
  )
}
```

Update the player render block. Find the existing block:

```tsx
{videoUrl ? (
  <TeamVideoPlayer
    ref={playerRef}
    src={videoUrl}
    comments={comments}
    onMarkerClick={() => { /* parent could scroll thread; v1 just seeks */ }}
  />
) : (
  ...
)}
```

Replace with:

```tsx
{videoUrl ? (
  <div ref={overlayRef} className="relative">
    <TeamVideoPlayer
      ref={playerRef}
      src={videoUrl}
      comments={comments}
      onMarkerClick={() => { /* parent could scroll thread; v1 just seeks */ }}
      onTimeUpdate={setCurrentTime}
      renderOverlay={renderOverlay}
    />
  </div>
) : (
  <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center text-sm text-muted-foreground">
    No video uploaded yet.
  </div>
)}
```

- [ ] **Step 2: Build verify**

Run: `npm run build`. Turbopack compile should succeed.

- [ ] **Step 3: Commit**

```bash
git add components/editor/EditorVideoView.tsx
git commit -m "feat(editor): render annotations overlay in read-only mode"
```

---

## Task 13: Update E2E Test (Optional)

If the existing E2E spec was being skipped (likely — env vars + fixture missing), this stays a no-op until those are in place. When they are, this extends the happy-path with one additional drawing+comment step.

**Files:**
- Modify: `__tests__/e2e/team-video-flow.spec.ts`

- [ ] **Step 1: Add a drawing step to the admin section**

In the admin section of the test, between the page load and the Approve click, insert:

```ts
// Optional: enable drawing mode and create one annotated comment.
// Skipped if the "Draw on frame" button isn't visible (e.g., the player
// hasn't loaded video metadata yet — Playwright will retry up to default timeout).
const drawButton = adminPage.getByRole("button", { name: /draw on frame/i })
if (await drawButton.isVisible({ timeout: 5000 }).catch(() => false)) {
  await drawButton.click()
  // Click the red color (it's the default but click anyway to assert it's wired)
  await adminPage.getByLabel(/red color/i).click()
  // Drag across the video container to draw something
  const videoBox = await adminPage.locator("video").first().boundingBox()
  if (videoBox) {
    await adminPage.mouse.move(videoBox.x + 50, videoBox.y + 50)
    await adminPage.mouse.down()
    await adminPage.mouse.move(videoBox.x + 200, videoBox.y + 200, { steps: 10 })
    await adminPage.mouse.up()
  }
  // Type a comment text and submit
  await adminPage.getByPlaceholder(/comment at current time/i).fill("E2E annotated note")
  await adminPage.getByRole("button", { name: /^add comment$/i }).click()
  await expect(adminPage.getByText("E2E annotated note")).toBeVisible()
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → still 134.

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/team-video-flow.spec.ts
git commit -m "test(e2e): cover drawing+annotated comment in team-video flow"
```

---

## Final Verification

- [ ] **Run the full team-video test suite**

```bash
npm run test:run -- "team-video"
```

Expected: all DAL + API + validator tests pass (Plan 1 + 2 + 3 surfaces). Pre-existing unrelated failures elsewhere remain unchanged.

- [ ] **Run production build**

```bash
npm run build
```

Expected: Turbopack compile succeeds. The TS phase may still hit the pre-existing `scripts/test-publish-fb.ts` issue (out of scope, not introduced by this plan).

- [ ] **Push to remote**

```bash
git push
```

---

## What's After Plan 3

Plan 3 ships the full Frame.io-style review experience. After this:

- The full team-video review workflow is feature-complete per the spec.
- Future enhancements (in-app notification center, multi-editor scaling, audit log, video processing pipeline) are listed in the spec's "Open Questions / Future Work" section and can be picked up as standalone improvements.
- Sidebar badge wiring (the `lib/team-videos/badge-count.ts` helper from Plan 2) is the single remaining nice-to-have from prior plans.
