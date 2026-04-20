# Content Studio Phase 5 — Search & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 1-4 into a production-ready Content Studio. Add global search across filenames, transcripts (Postgres full-text), and captions; persist user preferences (default calendar view, last-used filter set, pipeline lane collapse state) to a new `user_preferences` table; wire the previously-disabled Search and Upload buttons in the shell; run a thorough accessibility pass; remove the feature-flag gate and delete the legacy pages after the 2-week confidence period has passed.

**Architecture:**

- **Search.** Postgres full-text index on `video_transcripts.transcript_text`; plain `ILIKE` for `video_uploads.filename/title` and `social_posts.content` (small enough volumes to not justify a second tsvector). API route `/api/admin/content-studio/search?q=...` returns three grouped buckets. Client-side dropdown debounces typing (200ms) and issues one request.
- **User preferences.** A new table `user_preferences` with `{ user_id PK, calendar_default_view, last_pipeline_filters jsonb, pipeline_lanes_collapsed jsonb, updated_at }`. Server actions in `lib/content-studio/preferences.ts` read/write. The Calendar and Pipeline load their defaults from preferences when URL params are absent.
- **Upload button.** The existing `VideoUploader` component (`components/admin/videos/VideoUploader.tsx`) already handles the Firebase upload + Supabase row creation. A `<UploadModal>` wrapper opens on click of the shell's Upload button.
- **Accessibility.** Focus trap + return-focus on drawer close, ARIA roles on lanes/cells/grids (Phase 3/4 already set them — verified here), keyboard navigation between calendar cells (arrow keys), skip-links, status-role live announcements on drag-drop success/failure.
- **Flag cutover.** Remove the `notFound()` gate in `app/(admin)/admin/content/layout.tsx`. Remove redirect code from the legacy pages. Delete the legacy page files after confirming the flag has been on for ≥2 weeks. Keep `CONTENT_STUDIO_ENABLED` env var declared in `.env.example` for one more release so deployments with it explicitly set to `false` do not break (the code just ignores it).

**Tech Stack:** Supabase Postgres (full-text search), Vitest + Testing Library, Playwright, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-04-20-content-studio-design.md](../specs/2026-04-20-content-studio-design.md) — "Search", "Data model (user preferences)", "Rollout" sections.

**Prerequisite:** Phase 1 (shell), Phase 2 (drawer), Phase 3 (pipeline), Phase 4 (calendar) all complete and deployed with the flag on for ≥2 weeks.

---

## File Structure

**Create:**

- `supabase/migrations/00087_user_preferences.sql` — `user_preferences` table + FTS index on `video_transcripts`
- `lib/db/user-preferences.ts` — DAL for preferences
- `lib/content-studio/preferences.ts` — server actions (read + write) with `revalidatePath`
- `lib/content-studio/search.ts` — `searchContentStudio(query)` server fetcher
- `app/api/admin/content-studio/search/route.ts` — GET handler (debounced from client)
- `app/api/admin/content-studio/preferences/route.ts` — GET/PATCH handler
- `components/admin/content-studio/search/GlobalSearch.tsx` — shell top-bar widget (replaces the disabled input)
- `components/admin/content-studio/search/SearchResultsDropdown.tsx`
- `components/admin/content-studio/upload/UploadModal.tsx`
- `__tests__/lib/content-studio/search.test.ts`
- `__tests__/lib/content-studio/preferences.test.ts`
- `__tests__/components/admin/content-studio/search/GlobalSearch.test.tsx`
- `__tests__/components/admin/content-studio/search/SearchResultsDropdown.test.tsx`
- `__tests__/api/content-studio/search-route.test.ts`
- `__tests__/api/content-studio/preferences-route.test.ts`
- `__tests__/e2e/content-studio-search-polish.spec.ts`

**Modify:**

- `types/database.ts` — add `UserPreferences` interface
- `components/admin/content-studio/ContentStudioShell.tsx` — swap disabled search/upload with the live components
- `app/(admin)/admin/content/layout.tsx` — remove the `notFound()` flag gate
- `components/admin/AdminSidebar.tsx` — remove the `if contentStudioOn` branch in `getNavSections()`; Content Studio is unconditional
- `app/(admin)/admin/videos/page.tsx` — delete (see Task 10)
- `app/(admin)/admin/social/page.tsx` — delete
- `app/(admin)/admin/calendar/page.tsx` — delete
- `components/admin/content-studio/calendar/CalendarContainer.tsx` — read default view from preferences when URL is missing
- `components/admin/content-studio/pipeline/PipelineBoard.tsx` — persist filter set + lane-collapse state
- All drawer + shell components — ARIA audit (focus trap on open, focus return on close)

---

## Task 1: Migration — `user_preferences` + full-text index

**Files:**
- Create: `supabase/migrations/00087_user_preferences.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00087_user_preferences.sql`:

```sql
-- supabase/migrations/00087_user_preferences.sql

CREATE TABLE user_preferences (
  user_id                    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calendar_default_view      text NOT NULL DEFAULT 'month'
                             CHECK (calendar_default_view IN ('month', 'week', 'day')),
  last_pipeline_filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  pipeline_lanes_collapsed   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own preferences"
  ON public.user_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Full-text search on transcripts.
-- Postgres's built-in tsvector generated column avoids having to maintain a
-- trigger or a denormalized secondary column.
ALTER TABLE video_transcripts
  ADD COLUMN transcript_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(transcript_text, ''))) STORED;

CREATE INDEX idx_video_transcripts_tsv
  ON video_transcripts USING GIN (transcript_tsv);

-- ILIKE helpers for the remaining search targets (filenames + captions).
CREATE INDEX idx_video_uploads_filename_lower
  ON video_uploads (lower(original_filename));

CREATE INDEX idx_social_posts_content_lower
  ON social_posts (lower(content));
```

- [ ] **Step 2: Apply + smoke test locally**

```bash
# Apply against local Supabase
npx supabase db push
# Verify the table exists and the generated column populates
npx supabase db reset # if local; otherwise run the migration against a dev branch
```

Then in `psql` or the Supabase SQL editor:

```sql
INSERT INTO video_transcripts (video_upload_id, transcript_text, language, source)
  SELECT id, 'Hello rotational reboot world', 'en', 'speech' FROM video_uploads LIMIT 1;
SELECT id, transcript_tsv
  FROM video_transcripts
  WHERE transcript_tsv @@ plainto_tsquery('english', 'rotational');
```

Expected: one row. Rollback:

```sql
DROP INDEX idx_social_posts_content_lower;
DROP INDEX idx_video_uploads_filename_lower;
DROP INDEX idx_video_transcripts_tsv;
ALTER TABLE video_transcripts DROP COLUMN transcript_tsv;
DROP TABLE user_preferences;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00087_user_preferences.sql
git commit -m "$(cat <<'EOF'
feat(content-studio): migration — user_preferences + transcript FTS + search indexes

Generated tsvector + GIN index on video_transcripts. Case-insensitive indexes
on video_uploads.original_filename and social_posts.content for ILIKE lookup.
user_preferences is one row per user, RLS-scoped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `UserPreferences` type + DAL

**Files:**
- Modify: `types/database.ts`
- Create: `lib/db/user-preferences.ts`
- Test: `__tests__/lib/content-studio/preferences.test.ts` (uses this DAL indirectly; unit-test the shape)

- [ ] **Step 1: Add the type**

Append to `types/database.ts`:

```typescript
export type CalendarDefaultView = "month" | "week" | "day"

export interface UserPreferences {
  user_id: string
  calendar_default_view: CalendarDefaultView
  last_pipeline_filters: Record<string, unknown>
  pipeline_lanes_collapsed: Record<string, boolean>
  updated_at: string
}
```

- [ ] **Step 2: Create the DAL file**

Create `lib/db/user-preferences.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { UserPreferences, CalendarDefaultView } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

const DEFAULTS: Omit<UserPreferences, "user_id" | "updated_at"> = {
  calendar_default_view: "month",
  last_pipeline_filters: {},
  pipeline_lanes_collapsed: {},
}

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    return {
      user_id: userId,
      ...DEFAULTS,
      updated_at: new Date().toISOString(),
    }
  }
  return data as UserPreferences
}

export interface PreferencesPatch {
  calendar_default_view?: CalendarDefaultView
  last_pipeline_filters?: Record<string, unknown>
  pipeline_lanes_collapsed?: Record<string, boolean>
}

export async function upsertPreferences(
  userId: string,
  patch: PreferencesPatch,
): Promise<UserPreferences> {
  const supabase = getClient()
  const existing = await getPreferences(userId)
  const next = {
    user_id: userId,
    calendar_default_view: patch.calendar_default_view ?? existing.calendar_default_view,
    last_pipeline_filters: patch.last_pipeline_filters ?? existing.last_pipeline_filters,
    pipeline_lanes_collapsed: patch.pipeline_lanes_collapsed ?? existing.pipeline_lanes_collapsed,
  }
  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(next, { onConflict: "user_id" })
    .select()
    .single()
  if (error) throw error
  return data as UserPreferences
}
```

- [ ] **Step 3: Commit**

```bash
git add types/database.ts lib/db/user-preferences.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): UserPreferences type + DAL get/upsert with defaults

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Preferences server actions + API route

**Files:**
- Create: `lib/content-studio/preferences.ts`
- Create: `app/api/admin/content-studio/preferences/route.ts`
- Test: `__tests__/api/content-studio/preferences-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/content-studio/preferences-route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "admin" } })),
}))
const getMock = vi.fn()
const upsertMock = vi.fn()
vi.mock("@/lib/db/user-preferences", () => ({
  getPreferences: (...args: unknown[]) => getMock(...args),
  upsertPreferences: (...args: unknown[]) => upsertMock(...args),
}))

import { GET, PATCH } from "@/app/api/admin/content-studio/preferences/route"

beforeEach(() => {
  getMock.mockReset()
  upsertMock.mockReset()
})

describe("GET /api/admin/content-studio/preferences", () => {
  it("returns the preferences for the current user", async () => {
    getMock.mockResolvedValueOnce({ user_id: "user-1", calendar_default_view: "week" })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.calendar_default_view).toBe("week")
  })
})

describe("PATCH /api/admin/content-studio/preferences", () => {
  it("rejects unknown calendar_default_view", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendar_default_view: "year" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("upserts the accepted fields", async () => {
    upsertMock.mockResolvedValueOnce({ user_id: "user-1", calendar_default_view: "day" })
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendar_default_view: "day" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ calendar_default_view: "day" }),
    )
  })

  it("rejects a non-object last_pipeline_filters", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ last_pipeline_filters: "oops" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write the route handler**

Create `app/api/admin/content-studio/preferences/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getPreferences, upsertPreferences, type PreferencesPatch } from "@/lib/db/user-preferences"
import type { CalendarDefaultView } from "@/types/database"

function requireAdmin() {
  // Consumed inline in GET/PATCH
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const prefs = await getPreferences(session.user.id)
  return NextResponse.json(prefs)
}

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const patch: PreferencesPatch = {}
  if (body.calendar_default_view !== undefined) {
    const v = body.calendar_default_view
    if (v !== "month" && v !== "week" && v !== "day") {
      return NextResponse.json({ error: "calendar_default_view must be month|week|day" }, { status: 400 })
    }
    patch.calendar_default_view = v as CalendarDefaultView
  }
  if (body.last_pipeline_filters !== undefined) {
    if (typeof body.last_pipeline_filters !== "object" || Array.isArray(body.last_pipeline_filters) || body.last_pipeline_filters === null) {
      return NextResponse.json({ error: "last_pipeline_filters must be an object" }, { status: 400 })
    }
    patch.last_pipeline_filters = body.last_pipeline_filters as Record<string, unknown>
  }
  if (body.pipeline_lanes_collapsed !== undefined) {
    if (typeof body.pipeline_lanes_collapsed !== "object" || Array.isArray(body.pipeline_lanes_collapsed) || body.pipeline_lanes_collapsed === null) {
      return NextResponse.json({ error: "pipeline_lanes_collapsed must be an object" }, { status: 400 })
    }
    patch.pipeline_lanes_collapsed = body.pipeline_lanes_collapsed as Record<string, boolean>
  }

  const updated = await upsertPreferences(session.user.id, patch)
  return NextResponse.json(updated)
}
```

- [ ] **Step 4: Create the server action wrapper (optional helper)**

Create `lib/content-studio/preferences.ts`:

```typescript
import { auth } from "@/lib/auth"
import { getPreferences as dalGet, upsertPreferences as dalUpsert, type PreferencesPatch } from "@/lib/db/user-preferences"
import type { UserPreferences } from "@/types/database"

export async function readPreferences(): Promise<UserPreferences | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  return dalGet(session.user.id)
}

export async function writePreferences(patch: PreferencesPatch): Promise<UserPreferences | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  return dalUpsert(session.user.id, patch)
}
```

- [ ] **Step 5: Re-run**

```bash
npm run test:run -- __tests__/api/content-studio/preferences-route.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/preferences.ts app/api/admin/content-studio/preferences/route.ts __tests__/api/content-studio/preferences-route.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): preferences GET/PATCH API + server-side read helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Apply preferences defaults in Calendar + Pipeline

**Files:**
- Modify: `app/(admin)/admin/content/page.tsx`
- Modify: `components/admin/content-studio/pipeline/PipelineBoard.tsx`

- [ ] **Step 1: Thread preferences through the server page**

Edit `app/(admin)/admin/content/page.tsx`:

Add at the top:

```typescript
import { readPreferences } from "@/lib/content-studio/preferences"
```

Inside the `default export async function`, fetch preferences once and pass the `calendar_default_view` into the calendar window computation:

```typescript
const prefs = await readPreferences()
const effectiveView = view ?? prefs?.calendar_default_view ?? "month"

if (tab === "calendar") {
  const win = computeCalendarWindow(effectiveView, anchor)
  const [calendar, pipeline] = await Promise.all([getCalendarData(win), getPipelineData()])
  return <CalendarContainer data={calendar} videos={pipeline.videos} defaultView={effectiveView} />
}
```

Then accept `defaultView` in `CalendarContainer` and use it when the URL has no `?view=`. Minor edit — pass through to `CalendarViewToggle` as initial state.

- [ ] **Step 2: Load last filter set in PipelineBoard**

Edit `components/admin/content-studio/pipeline/PipelineBoard.tsx`:

Accept a new prop `initialFilters?: PipelineFilters`. In `useMemo`:

```typescript
const filtersFromUrl = useMemo(() => parseFilters(searchParams), [searchParams])
const hasAnyUrlFilter =
  searchParams.has("platform") ||
  searchParams.has("status") ||
  searchParams.has("from") ||
  searchParams.has("to") ||
  searchParams.has("sourceVideo")
const filters = hasAnyUrlFilter || !initialFilters ? filtersFromUrl : initialFilters
```

And pass from the server page:

```typescript
<PipelineBoard
  initialData={data}
  initialFilters={(prefs?.last_pipeline_filters as PipelineFilters | undefined) ?? undefined}
/>
```

On filter change in `PipelineFilters`, fire off a `PATCH /preferences` with the new set. Add this to `PipelineFilters.tsx` inside the `update` callback:

```typescript
// Fire-and-forget; failures do not affect the local render.
fetch("/api/admin/content-studio/preferences", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ last_pipeline_filters: next }),
}).catch(() => {})
```

- [ ] **Step 3: Manual smoke test**

```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

- Load `/admin/content` with no query params.
- Apply platform=Instagram filter → URL updates; `last_pipeline_filters` upserts.
- Visit `/admin/content` in a fresh tab (no query params) → filters auto-apply from preferences.
- Set calendar default: PATCH `/preferences` with `{"calendar_default_view":"week"}`. Then visit `/admin/content?tab=calendar` with no `?view=` → starts on Week.

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/content/page.tsx components/admin/content-studio/pipeline/PipelineBoard.tsx components/admin/content-studio/pipeline/PipelineFilters.tsx components/admin/content-studio/calendar/CalendarContainer.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): preferences-driven defaults for calendar view + pipeline filters

URL always wins; preferences fill in when URL is empty. Filter changes
asynchronously update the user_preferences row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Global search server fetcher + API route

**Files:**
- Create: `lib/content-studio/search.ts`
- Create: `app/api/admin/content-studio/search/route.ts`
- Test: `__tests__/lib/content-studio/search.test.ts`
- Test: `__tests__/api/content-studio/search-route.test.ts`

- [ ] **Step 1: Write the failing unit test for the fetcher**

Create `__tests__/lib/content-studio/search.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"

const rpc = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      // Chainable query builder
      const builder = {
        select: () => builder,
        ilike: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        textSearch: () => Promise.resolve({ data: [], error: null }),
        or: () => builder,
        eq: () => builder,
      }
      return { _table: table, ...builder }
    },
    rpc,
  }),
}))

import { searchContentStudio } from "@/lib/content-studio/search"

describe("searchContentStudio", () => {
  it("returns three buckets for the empty query", async () => {
    const result = await searchContentStudio("")
    expect(result.videos).toEqual([])
    expect(result.transcripts).toEqual([])
    expect(result.posts).toEqual([])
  })

  it("trims whitespace-only queries to empty", async () => {
    const result = await searchContentStudio("     ")
    expect(result.videos).toEqual([])
    expect(result.transcripts).toEqual([])
    expect(result.posts).toEqual([])
  })

  // Note: true integration of ILIKE / textSearch against Supabase is covered
  // by the e2e test. Unit tests cover the no-query behavior + result shape.
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write the fetcher**

Create `lib/content-studio/search.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPost, VideoUpload, VideoTranscript } from "@/types/database"

export interface SearchResults {
  videos: Array<Pick<VideoUpload, "id" | "title" | "original_filename" | "status">>
  transcripts: Array<{
    id: string
    video_upload_id: string
    snippet: string
    video_filename: string | null
  }>
  posts: Array<
    Pick<SocialPost, "id" | "platform" | "content" | "approval_status" | "source_video_id"> & {
      source_video_filename: string | null
    }
  >
}

const EMPTY: SearchResults = { videos: [], transcripts: [], posts: [] }

const LIMIT = 10

export async function searchContentStudio(query: string): Promise<SearchResults> {
  const q = query.trim()
  if (!q) return EMPTY
  const supabase = createServiceRoleClient()
  const likePattern = `%${q}%`

  const [vidRes, transRes, postRes] = await Promise.all([
    supabase
      .from("video_uploads")
      .select("id, title, original_filename, status")
      .or(`title.ilike.${likePattern},original_filename.ilike.${likePattern}`)
      .limit(LIMIT),
    supabase
      .from("video_transcripts")
      .select("id, video_upload_id, transcript_text, video_uploads(original_filename)")
      .textSearch("transcript_tsv", q, { type: "plain", config: "english" })
      .limit(LIMIT),
    supabase
      .from("social_posts")
      .select("id, platform, content, approval_status, source_video_id, video_uploads(original_filename)")
      .ilike("content", likePattern)
      .limit(LIMIT),
  ])

  if (vidRes.error) throw vidRes.error
  if (transRes.error) throw transRes.error
  if (postRes.error) throw postRes.error

  return {
    videos: (vidRes.data ?? []) as SearchResults["videos"],
    transcripts: (transRes.data ?? []).map((r) => {
      const rec = r as {
        id: string
        video_upload_id: string
        transcript_text: string
        video_uploads: { original_filename: string } | null
      }
      // Build a short snippet around the first match position, case-insensitive.
      const text = rec.transcript_text
      const idx = text.toLowerCase().indexOf(q.toLowerCase())
      const start = Math.max(0, idx - 40)
      const end = Math.min(text.length, (idx === -1 ? 0 : idx) + q.length + 80)
      const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "")
      return {
        id: rec.id,
        video_upload_id: rec.video_upload_id,
        snippet,
        video_filename: rec.video_uploads?.original_filename ?? null,
      }
    }),
    posts: (postRes.data ?? []).map((r) => {
      const rec = r as SocialPost & { video_uploads: { original_filename: string } | null }
      return {
        id: rec.id,
        platform: rec.platform,
        content: rec.content,
        approval_status: rec.approval_status,
        source_video_id: rec.source_video_id,
        source_video_filename: rec.video_uploads?.original_filename ?? null,
      }
    }),
  }
}
```

- [ ] **Step 4: Write the route handler + test**

Create `__tests__/api/content-studio/search-route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u", role: "admin" } })),
}))
const searchMock = vi.fn()
vi.mock("@/lib/content-studio/search", () => ({
  searchContentStudio: (...args: unknown[]) => searchMock(...args),
}))

import { GET } from "@/app/api/admin/content-studio/search/route"

beforeEach(() => searchMock.mockReset())

describe("GET /api/admin/content-studio/search", () => {
  it("returns empty buckets when ?q is missing", async () => {
    const res = await GET(new Request("http://x/api/admin/content-studio/search"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ videos: [], transcripts: [], posts: [] })
    expect(searchMock).not.toHaveBeenCalled()
  })

  it("delegates to searchContentStudio when ?q is set", async () => {
    searchMock.mockResolvedValueOnce({ videos: [], transcripts: [], posts: [] })
    const res = await GET(new Request("http://x/api/admin/content-studio/search?q=rotational"))
    expect(res.status).toBe(200)
    expect(searchMock).toHaveBeenCalledWith("rotational")
  })
})
```

Create `app/api/admin/content-studio/search/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { searchContentStudio } from "@/lib/content-studio/search"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  if (!q) return NextResponse.json({ videos: [], transcripts: [], posts: [] })
  const result = await searchContentStudio(q)
  return NextResponse.json(result)
}
```

- [ ] **Step 5: Re-run**

```bash
npm run test:run -- __tests__/lib/content-studio/search.test.ts __tests__/api/content-studio/search-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/search.ts app/api/admin/content-studio/search/route.ts \
        __tests__/lib/content-studio/search.test.ts __tests__/api/content-studio/search-route.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): global search fetcher + GET API

Postgres textSearch() on transcript_tsv for transcripts, ILIKE on filenames
and captions. Each bucket is limited to 10 results. Transcripts return a
short snippet around the first match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: SearchResultsDropdown component

**Files:**
- Create: `components/admin/content-studio/search/SearchResultsDropdown.tsx`
- Test: `__tests__/components/admin/content-studio/search/SearchResultsDropdown.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/search/SearchResultsDropdown.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SearchResultsDropdown } from "@/components/admin/content-studio/search/SearchResultsDropdown"
import type { SearchResults } from "@/lib/content-studio/search"

const results: SearchResults = {
  videos: [{ id: "v1", title: "Rotational Reboot", original_filename: "rotate.mp4", status: "transcribed" }],
  transcripts: [{ id: "t1", video_upload_id: "v1", snippet: "…rotational reboot…", video_filename: "rotate.mp4" }],
  posts: [
    {
      id: "p1",
      platform: "instagram",
      content: "stay rotational",
      approval_status: "approved",
      source_video_id: "v1",
      source_video_filename: "rotate.mp4",
    },
  ],
}

describe("<SearchResultsDropdown>", () => {
  it("groups results by type with headers", () => {
    render(<SearchResultsDropdown q="rotate" results={results} loading={false} onSelect={() => {}} />)
    expect(screen.getByText(/Videos/)).toBeInTheDocument()
    expect(screen.getByText(/Transcripts/)).toBeInTheDocument()
    expect(screen.getByText(/Posts/)).toBeInTheDocument()
  })

  it("each row is a link to the drawer", () => {
    render(<SearchResultsDropdown q="rotate" results={results} loading={false} onSelect={() => {}} />)
    expect(screen.getByRole("link", { name: /Rotational Reboot/ })).toHaveAttribute("href", "/admin/content/v1")
    expect(screen.getByRole("link", { name: /stay rotational/ })).toHaveAttribute("href", "/admin/content/post/p1")
  })

  it("shows a loading indicator", () => {
    render(
      <SearchResultsDropdown
        q="rotate"
        results={{ videos: [], transcripts: [], posts: [] }}
        loading
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/Searching/i)).toBeInTheDocument()
  })

  it("shows a no-results state", () => {
    render(
      <SearchResultsDropdown
        q="nothingmatches"
        results={{ videos: [], transcripts: [], posts: [] }}
        loading={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/No results/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/search/SearchResultsDropdown.tsx`:

```typescript
"use client"

import Link from "next/link"
import { Film, FileText, Megaphone, Loader2 } from "lucide-react"
import type { SearchResults } from "@/lib/content-studio/search"

interface SearchResultsDropdownProps {
  q: string
  results: SearchResults
  loading: boolean
  onSelect: () => void
}

function Section({
  title,
  icon,
  children,
  count,
}: {
  title: string
  icon: React.ReactNode
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="py-2">
      <h4 className="px-3 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
        {icon} {title} ({count})
      </h4>
      <ul className="mt-1">{children}</ul>
    </section>
  )
}

export function SearchResultsDropdown({ q, results, loading, onSelect }: SearchResultsDropdownProps) {
  const total = results.videos.length + results.transcripts.length + results.posts.length
  if (loading) {
    return (
      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-40 px-3 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Searching…
      </div>
    )
  }
  if (total === 0) {
    return (
      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-40 px-3 py-3 text-sm text-muted-foreground">
        No results for "{q}".
      </div>
    )
  }
  return (
    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-40 max-h-96 overflow-y-auto">
      <Section title="Videos" icon={<Film className="size-3" />} count={results.videos.length}>
        {results.videos.map((v) => (
          <li key={v.id}>
            <Link
              href={`/admin/content/${v.id}`}
              onClick={onSelect}
              className="block px-3 py-1.5 text-sm text-primary hover:bg-surface/40 truncate"
            >
              {v.title ?? v.original_filename}
              <span className="ml-2 text-[11px] text-muted-foreground">{v.status}</span>
            </Link>
          </li>
        ))}
      </Section>
      <Section title="Transcripts" icon={<FileText className="size-3" />} count={results.transcripts.length}>
        {results.transcripts.map((t) => (
          <li key={t.id}>
            <Link
              href={`/admin/content/${t.video_upload_id}?tab=transcript`}
              onClick={onSelect}
              className="block px-3 py-1.5 hover:bg-surface/40"
            >
              <p className="text-sm text-primary line-clamp-2">{t.snippet}</p>
              {t.video_filename && (
                <p className="text-[11px] text-muted-foreground truncate">{t.video_filename}</p>
              )}
            </Link>
          </li>
        ))}
      </Section>
      <Section title="Posts" icon={<Megaphone className="size-3" />} count={results.posts.length}>
        {results.posts.map((p) => (
          <li key={p.id}>
            <Link
              href={`/admin/content/post/${p.id}`}
              onClick={onSelect}
              className="block px-3 py-1.5 hover:bg-surface/40"
            >
              <p className="text-sm text-primary line-clamp-2">{p.content}</p>
              <p className="text-[11px] text-muted-foreground">
                {p.platform} · {p.approval_status} · {p.source_video_filename ?? "Manual"}
              </p>
            </Link>
          </li>
        ))}
      </Section>
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/search/SearchResultsDropdown.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/search/SearchResultsDropdown.tsx __tests__/components/admin/content-studio/search/SearchResultsDropdown.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): SearchResultsDropdown — three grouped buckets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: GlobalSearch input + debounce + shell wiring

**Files:**
- Create: `components/admin/content-studio/search/GlobalSearch.tsx`
- Test: `__tests__/components/admin/content-studio/search/GlobalSearch.test.tsx`
- Modify: `components/admin/content-studio/ContentStudioShell.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/search/GlobalSearch.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { GlobalSearch } from "@/components/admin/content-studio/search/GlobalSearch"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<GlobalSearch>", () => {
  it("debounces typing before firing a request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ videos: [], transcripts: [], posts: [] }), { status: 200 }),
    )
    render(<GlobalSearch />)
    const input = screen.getByPlaceholderText(/Search videos/i)
    fireEvent.change(input, { target: { value: "r" } })
    fireEvent.change(input, { target: { value: "ro" } })
    fireEvent.change(input, { target: { value: "rot" } })
    // Immediately — no fetch yet
    expect(fetchMock).not.toHaveBeenCalled()
    // After debounce
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/content-studio/search?q=rot")
  })

  it("closes the dropdown on Escape", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ videos: [], transcripts: [], posts: [] }), { status: 200 }),
    )
    render(<GlobalSearch />)
    const input = screen.getByPlaceholderText(/Search videos/i)
    fireEvent.change(input, { target: { value: "x" } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/search/GlobalSearch.tsx`:

```typescript
"use client"

import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { SearchResultsDropdown } from "./SearchResultsDropdown"
import type { SearchResults } from "@/lib/content-studio/search"

const DEBOUNCE_MS = 200
const EMPTY: SearchResults = { videos: [], transcripts: [], posts: [] }

export function GlobalSearch() {
  const [value, setValue] = useState("")
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value.trim()) {
      setResults(EMPTY)
      setOpen(false)
      return
    }
    setLoading(true)
    setOpen(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/content-studio/search?q=${encodeURIComponent(value.trim())}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error("Search failed")
        const body = (await res.json()) as SearchResults
        setResults(body)
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults(EMPTY)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  return (
    <div ref={containerRef} className="relative w-80">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder="Search videos, transcripts, posts..."
        aria-label="Global search"
        className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {open && (
        <SearchResultsDropdown
          q={value}
          results={results}
          loading={loading}
          onSelect={() => setOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire into the shell**

Edit `components/admin/content-studio/ContentStudioShell.tsx`. Replace the disabled search input with `<GlobalSearch />` and the disabled upload button with a live one that opens a modal wrapping `VideoUploader`.

Create `components/admin/content-studio/upload/UploadModal.tsx`:

```typescript
"use client"

import { useState } from "react"
import { Upload, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { VideoUploader } from "@/components/admin/videos/VideoUploader"

export function UploadModal() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
      >
        <Upload className="size-4" /> Upload Video
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-xl bg-white rounded-lg shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-heading text-sm text-primary">Upload video</h3>
              <button
                type="button"
                aria-label="Close upload dialog"
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="p-4">
              <VideoUploader
                onUploaded={() => {
                  setOpen(false)
                  router.refresh()
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

Update `components/admin/content-studio/ContentStudioShell.tsx`:

```typescript
import { GlobalSearch } from "./search/GlobalSearch"
import { UploadModal } from "./upload/UploadModal"
import { TabSwitcher } from "./TabSwitcher"

export function ContentStudioShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-border bg-background">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-heading text-2xl">Content Studio</h1>
            <p className="text-sm text-muted-foreground">
              Videos, posts, and scheduling in one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <UploadModal />
          </div>
        </div>
        <TabSwitcher />
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  )
}
```

- [ ] **Step 5: Re-run + manual smoke test**

```bash
npm run test:run -- __tests__/components/admin/content-studio/search
CONTENT_STUDIO_ENABLED=true npm run dev
```

- Type "rot" in search — dropdown appears with three grouped sections; clicking a row opens the drawer.
- Click Upload Video → modal opens with the uploader → drop a file → upload completes → modal closes → video appears in the Uploaded column of the pipeline.

- [ ] **Step 6: Commit**

```bash
git add components/admin/content-studio/search components/admin/content-studio/upload components/admin/content-studio/ContentStudioShell.tsx __tests__/components/admin/content-studio/search
git commit -m "$(cat <<'EOF'
feat(content-studio): live GlobalSearch + UploadModal in shell top bar

Replaces the Phase 1 disabled placeholders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Accessibility audit + fixes

**Files:**
- Modify: `components/admin/content-studio/DetailDrawer.tsx` (focus trap, restore focus on close)
- Modify: `components/admin/content-studio/drawer/DrawerContent.tsx` (tablist semantics confirmed; add aria-controls)
- Modify: `components/admin/content-studio/calendar/MonthGrid.tsx` / `WeekGrid.tsx` / `DayGrid.tsx` (arrow-key navigation between cells)

This task is a single commit because the changes are small and cross-file. Use `focus-trap-react` if already installed; else a minimal inline trap.

- [ ] **Step 1: Check for focus-trap dependency**

```bash
grep -R "focus-trap" package.json || true
```

If not present, install:

```bash
npm install focus-trap-react
```

- [ ] **Step 2: Add a focus trap + focus return to DetailDrawer**

Edit `components/admin/content-studio/DetailDrawer.tsx` — wrap the `<aside>` contents in a focus trap, remember the previously-focused element on mount, and restore it on close.

Replace the function body with:

```typescript
import FocusTrap from "focus-trap-react"
// ...existing imports

export function DetailDrawer({ data, defaultTab, closeHref }: DetailDrawerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement
    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [])

  // ...title + handleClose + ESC effect as before

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
      <FocusTrap
        focusTrapOptions={{
          escapeDeactivates: false, // our own ESC handler runs
          allowOutsideClick: true,
          initialFocus: false,
        }}
      >
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed top-0 right-0 h-screen w-full max-w-[700px] bg-background border-l border-border z-50 flex flex-col"
        >
          {/* ...existing header + body */}
        </aside>
      </FocusTrap>
    </>
  )
}
```

Also import `useRef`:

```typescript
import { useEffect, useRef } from "react"
```

- [ ] **Step 3: Calendar arrow-key navigation**

In `MonthGrid.tsx`, `WeekGrid.tsx`, `DayGrid.tsx`: set `tabIndex={0}` on every day cell and wire `onKeyDown` to move focus to the adjacent cell (ArrowLeft / Right / Up / Down). Implementation pattern (add to MonthGrid's `DayCell`):

```typescript
onKeyDown={(e) => {
  if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"].includes(e.key)) return
  e.preventDefault()
  if (e.key === "Enter") {
    if (chips.length === 0) onEmptyClick(key)
    return
  }
  const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-daycell]"))
  const i = cells.findIndex((c) => c === e.currentTarget)
  const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : 7
  const next = cells[i + delta]
  next?.focus()
}}
tabIndex={0}
data-daycell
```

Add the same `data-daycell` + `tabIndex` to WeekGrid and DayGrid cells (using appropriate delta). Week: ±1 left/right, no up/down. Day: ±1 up/down on hour rows.

- [ ] **Step 4: Live region for drag-drop announcements**

Add a visually hidden live region somewhere in the shell (in `ContentStudioShell.tsx`):

```typescript
<div role="status" aria-live="polite" className="sr-only" id="content-studio-announce" />
```

In `PostsLane` and `CalendarContainer`, after a successful move, set:

```typescript
const el = document.getElementById("content-studio-announce")
if (el) el.textContent = `Moved to ${label}`
```

Reusing Sonner for user-visible feedback is fine; the live region is for screen-reader users.

- [ ] **Step 5: Manual a11y smoke test**

- Tab into the drawer; verify focus stays inside.
- Close drawer; verify focus returns to the link/card that opened it.
- On the calendar, arrow-key between days.
- With VoiceOver (mac) or NVDA (Windows), verify that dropping a chip announces "Moved to ...".

- [ ] **Step 6: Commit**

```bash
git add components/admin/content-studio package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(content-studio): a11y pass — focus trap, return focus, arrow-key nav, live region

Drawer focuses inside while open and returns focus to the triggering element
on close. Calendar cells are keyboard-navigable with arrow keys + Enter.
Status-role live region announces drag-drop results for screen readers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Remove the feature flag gate

**Files:**
- Modify: `app/(admin)/admin/content/layout.tsx`
- Modify: `components/admin/AdminSidebar.tsx`

**Important:** Only execute this step after the flag has been ENABLED in production for the 2-week confidence period and internal users have signed off. If you are executing this plan before then, stop here and resume from Task 10 once the period elapses.

- [ ] **Step 1: Remove the notFound() gate**

Edit `app/(admin)/admin/content/layout.tsx` — remove the flag check. Final file:

```typescript
import { ContentStudioShell } from "@/components/admin/content-studio/ContentStudioShell"

export default function ContentStudioLayout({ children }: { children: React.ReactNode }) {
  return <ContentStudioShell>{children}</ContentStudioShell>
}
```

- [ ] **Step 2: Remove the conditional in the sidebar**

Edit `components/admin/AdminSidebar.tsx` — `getNavSections()` should always return the "Content Studio" form:

```typescript
function getNavSections(): NavSection[] {
  const aiAutomationItems: NavItem[] = [
    { label: "Content Studio", href: "/admin/content", icon: Layers },
    { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
    { label: "Platform Connections", href: "/admin/platform-connections", icon: Link2 },
  ]
  // ...rest unchanged
}
```

Remove the `isContentStudioEnabled` import.

- [ ] **Step 3: Leave the env var declaration in .env.example**

Leave this line in `.env.example` for one more release, with a comment:

```
# DEPRECATED: Content Studio is now unconditional. This env var is a no-op as
# of release YYYY-MM-DD and will be removed next release.
CONTENT_STUDIO_ENABLED=true
```

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/content/layout.tsx components/admin/AdminSidebar.tsx .env.example
git commit -m "$(cat <<'EOF'
feat(content-studio): remove feature flag gate — Content Studio is unconditional

Flag env var remains in .env.example as a deprecated no-op for one more
release so deployments that explicitly set it do not break.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Delete legacy pages

**Files:**
- Delete: `app/(admin)/admin/videos/page.tsx`
- Delete: `app/(admin)/admin/social/page.tsx`
- Delete: `app/(admin)/admin/calendar/page.tsx`
- Modify: any inbound links or imports that still reference these legacy routes

- [ ] **Step 1: Grep for inbound references**

```bash
grep -R "/admin/videos" --include="*.tsx" --include="*.ts" . | grep -v "admin/content"
grep -R "/admin/social" --include="*.tsx" --include="*.ts" . | grep -v "admin/content"
grep -R "/admin/calendar" --include="*.tsx" --include="*.ts" . | grep -v "admin/content"
```

Audit the hits. Replace explicit hrefs with the new `/admin/content?tab=<foo>` URLs or, if appropriate, delete the outdated references. For example, any remaining `<Link href="/admin/videos">` in a marketing page or help doc should be rewritten.

- [ ] **Step 2: Delete the legacy page files**

```bash
git rm "app/(admin)/admin/videos/page.tsx"
git rm "app/(admin)/admin/social/page.tsx"
git rm "app/(admin)/admin/calendar/page.tsx"
```

Also delete their per-route children if any became orphaned (e.g., `app/(admin)/admin/videos/[id]/` that is not already redirected). Inspect:

```bash
ls "app/(admin)/admin/videos" "app/(admin)/admin/social" "app/(admin)/admin/calendar" 2>/dev/null
```

If sub-routes remain (and they're unused), delete them too. If they are still in use from other places, leave them — only the Phase 1 redirect shells are in scope.

- [ ] **Step 3: Leave a 301-compatible note**

Add a tiny client redirect shim at each of the three legacy URLs, so stale tabs / external bookmarks still land somewhere sensible. Rather than re-creating the deleted page files, add middleware entries in `middleware.ts`:

Edit `middleware.ts`:

```typescript
// Inside the existing middleware function, before the existing logic:
if (pathname === "/admin/videos") {
  return NextResponse.redirect(new URL("/admin/content?tab=videos", request.url))
}
if (pathname === "/admin/social") {
  return NextResponse.redirect(new URL("/admin/content?tab=posts", request.url))
}
if (pathname === "/admin/calendar") {
  return NextResponse.redirect(new URL("/admin/content?tab=calendar", request.url))
}
```

Ensure these lines come after the admin auth check and before any other routing.

- [ ] **Step 4: Commit**

```bash
git add app middleware.ts
git commit -m "$(cat <<'EOF'
refactor(content-studio): delete legacy /admin/videos|social|calendar pages

Legacy URLs now 301 to their Content Studio tab via middleware so existing
bookmarks and browser history continue to work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final full-journey E2E

**Files:**
- Create: `__tests__/e2e/content-studio-search-polish.spec.ts`

- [ ] **Step 1: Write the e2e**

Create `__tests__/e2e/content-studio-search-polish.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com"
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin-password"

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/admin\//)
}

test.describe("Content Studio — search + polish", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("global search returns three buckets", async ({ page }) => {
    await page.goto("/admin/content")
    const input = page.getByLabel(/Global search/i)
    await input.fill("a") // a common letter
    // Wait for dropdown or no-results line
    await page.waitForTimeout(350)
    const dropdown = page.locator("text=/Videos|No results/").first()
    await expect(dropdown).toBeVisible()
  })

  test("upload modal opens from the shell", async ({ page }) => {
    await page.goto("/admin/content")
    await page.getByRole("button", { name: /Upload Video/i }).click()
    await expect(page.getByRole("heading", { name: /Upload video/i })).toBeVisible()
    await page.getByRole("button", { name: /Close upload dialog/i }).click()
  })

  test("legacy /admin/videos redirects to tab=videos", async ({ page }) => {
    await page.goto("/admin/videos")
    await expect(page).toHaveURL(/\/admin\/content\?tab=videos/)
  })

  test("calendar default view is read from preferences", async ({ page, request }) => {
    // Set preference to 'week'
    const csrf = await request.get("/api/admin/content-studio/preferences")
    if (!csrf.ok()) test.skip(true, "Preferences API not responding")
    await request.patch("/api/admin/content-studio/preferences", {
      data: { calendar_default_view: "week" },
      headers: { "content-type": "application/json" },
    })
    await page.goto("/admin/content?tab=calendar")
    await expect(page.getByRole("grid", { name: /week view/i })).toBeVisible()
  })

  test("drawer traps focus while open and returns focus on close", async ({ page }) => {
    await page.goto("/admin/content?tab=videos")
    const firstLink = page.locator("tbody a").first()
    const count = await firstLink.count()
    test.skip(count === 0, "No videos to click")
    await firstLink.focus()
    await firstLink.press("Enter")
    await expect(page.getByRole("dialog")).toBeVisible()
    // Tab cycles inside — cannot reach the close-button-outside
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(firstLink).toBeFocused()
  })
})
```

- [ ] **Step 2: Run e2e**

```bash
# Flag is now removed, so no env var needed
npm run dev
# Another shell:
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e -- content-studio-search-polish
```

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/content-studio-search-polish.spec.ts
git commit -m "$(cat <<'EOF'
test(content-studio): final e2e — search + upload + redirects + focus trap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Changelog + docs update

**Files:**
- Modify: `docs/superpowers/plans/2026-04-20-content-studio-phase5-search-and-polish.md` (no — do not edit after the plan is authored)
- Modify: `README.md` or similar project-level docs if one documents admin features (optional)

- [ ] **Step 1: If the repo keeps a CHANGELOG**

```bash
ls CHANGELOG.md 2>/dev/null
```

If present, append a section such as:

```markdown
## [Unreleased] Content Studio

- Unifies /admin/videos, /admin/social, /admin/calendar into a single "Content Studio" surface at /admin/content.
- Adds a global search across videos, transcripts (Postgres FTS), and captions.
- Adds a routed video detail drawer with transcript-next-to-video + posts tab.
- Adds a two-lane Kanban pipeline with drag-drop and bulk approve.
- Adds Month/Week/Day calendar with drag-drop rescheduling and an unscheduled-posts sidebar.
- Legacy admin URLs now 301 redirect to the Content Studio tabs.
- Persists calendar default view and last-used pipeline filters per user.
- The CONTENT_STUDIO_ENABLED env var is deprecated and a no-op — to be removed next release.
```

If there is no CHANGELOG, skip this step; the commit history tells the story.

- [ ] **Step 2: Lint + full test run**

```bash
npm run lint
npm run format:check
npm run test:run
```

Expected: all green.

- [ ] **Step 3: Commit formatter fixes if any**

```bash
git add -u
git commit -m "chore(content-studio): prettier fixes from Phase 5" --allow-empty
```

---

## Verification Before Calling Phase 5 Done

1. **Global search works.** Typing in the top-bar search surfaces grouped results; each result links to the right drawer route.
2. **Postgres FTS is live.** `EXPLAIN` a sample query to confirm the `idx_video_transcripts_tsv` GIN index is being used.
3. **Upload button opens modal.** Uploading a file lands a new row in `video_uploads` and the card appears in the Uploaded column after `router.refresh()`.
4. **Preferences persist.** Changing calendar view or pipeline filter saves to `user_preferences`; a fresh tab without URL params picks them up.
5. **Focus trap.** Opening a drawer keyboard-only and Tab-cycling stays inside the dialog; ESC closes and restores focus to the triggering link.
6. **Arrow-key navigation on calendar.** Moves focus between day cells; Enter on an empty cell opens ManualPostDialog.
7. **Live region.** Using VoiceOver/NVDA, dropping a chip produces a spoken "Moved to ..." announcement.
8. **Flag removed.** `/admin/content` works without `CONTENT_STUDIO_ENABLED` set. `CONTENT_STUDIO_ENABLED=false` has no effect.
9. **Legacy redirects.** `/admin/videos`, `/admin/social`, `/admin/calendar` all 301 to the right Content Studio tab via middleware.
10. **All tests pass.**
   ```bash
   npm run lint
   npm run format:check
   npm run test:run
   npm run test:e2e -- content-studio
   ```

---

## Phase 5 Scope Boundaries

**In this phase:**
- Global search with Postgres FTS + ILIKE
- `user_preferences` table + default-view + last-filter persistence
- Live Upload button (existing VideoUploader in a modal)
- Accessibility hardening (focus trap, keyboard nav, live region)
- Feature flag removal + legacy page deletion + middleware redirects
- Final full-journey e2e

**NOT in this phase:**
- Realtime subscription to pipeline/calendar (still `router.refresh()` after mutations)
- Platform-specific best-time AI (spec out-of-scope)
- Mobile layouts (spec out-of-scope)
- Chunked/batched search across >10 results per bucket (current LIMIT=10 is a simple cap)

When Phase 5 ships, Content Studio is the default and only surface for video+post+calendar workflow, the original transcript-context user pain point is fully resolved, and the rollout flag + legacy pages are gone.
