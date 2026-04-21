# Starter AI Automation — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the complete foundation for the DJP Athlete Starter AI automation build — migrations, types, DAL, plugin framework, admin scaffolds, Firebase Functions project, and the Next.js ↔ Firebase bridge — so every subsequent phase has the infrastructure it needs.

**Architecture:** Additive-only extensions to the existing Next.js 16 / Supabase / NextAuth codebase. New `lib/social/` directory for the plugin framework. New `functions/` subproject for Firebase Cloud Functions 2nd gen. Supabase tables 00076–00081 added. Existing `blog_posts` table gets ALTER-added columns, no schema breaks.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres, Firebase Functions (2nd gen, Cloud Run backed), Vitest, Tailwind v4 (CSS-config), shadcn/ui new-york. All new code matches existing `lib/db/` DAL conventions (service-role client, cast-on-return, throw-on-error).

**Existing systems this plan builds on (reference only — no changes):**

- DAL pattern: [lib/db/blog-posts.ts](../../../lib/db/blog-posts.ts)
- Type conventions: [types/database.ts](../../../types/database.ts)
- Migration conventions: [supabase/migrations/00075_prompt_templates.sql](../../../supabase/migrations/00075_prompt_templates.sql)
- Admin sidebar: [components/admin/AdminSidebar.tsx](../../../components/admin/AdminSidebar.tsx)
- Admin page scaffold: [app/(admin)/admin/blog/page.tsx](<../../../app/(admin)/admin/blog/page.tsx>)
- Test pattern (DAL): [**tests**/db/prompt-templates.test.ts](../../../__tests__/db/prompt-templates.test.ts)
- Test pattern (migration): [**tests**/migrations/00067_shop_product_type.test.ts](../../../__tests__/migrations/00067_shop_product_type.test.ts)

---

## File Structure

### Migrations (new files)

- `supabase/migrations/00076_social_posts_and_captions.sql` — social_posts + social_captions tables
- `supabase/migrations/00077_content_calendar.sql` — content_calendar table
- `supabase/migrations/00078_platform_connections.sql` — platform_connections table
- `supabase/migrations/00079_video_uploads_and_transcripts.sql` — video_uploads + video_transcripts
- `supabase/migrations/00080_blog_posts_ai_extensions.sql` — ALTER blog_posts (add 4 columns)
- `supabase/migrations/00081_extend_prompt_templates_categories.sql` — extend prompt_templates CHECK + seed default voice profile

### Types (extend existing file)

- `types/database.ts` — add new enums + interfaces at end of file

### DAL (new files)

- `lib/db/social-posts.ts`
- `lib/db/social-captions.ts`
- `lib/db/content-calendar.ts`
- `lib/db/platform-connections.ts`
- `lib/db/video-uploads.ts`
- `lib/db/video-transcripts.ts`
- `lib/db/index.ts` — add exports (modify)

### Plugin framework (new files)

- `lib/social/plugins/types.ts` — `PublishPlugin` interface + all supporting types
- `lib/social/registry.ts` — plugin registry + state machine

### Admin (new files + modify)

- `app/(admin)/admin/social/page.tsx`
- `app/(admin)/admin/videos/page.tsx`
- `app/(admin)/admin/platform-connections/page.tsx`
- `components/admin/AdminSidebar.tsx` — add 3 nav items (modify)

### Firebase Functions (new subproject at repo root)

- `firebase.json`
- `.firebaserc`
- `functions/package.json`
- `functions/tsconfig.json`
- `functions/.gitignore`
- `functions/src/index.ts`
- `functions/src/lib/supabase.ts`
- `functions/src/lib/claude.ts`
- `functions/src/lib/resend.ts`

### Next.js ↔ Firebase bridge (new file)

- `lib/firebase-functions.ts` — `invokeFunction(name, payload)` helper

### Environment documentation

- `.env.example` — add new vars (modify)

### Tests (new files)

- `__tests__/migrations/00076_social_posts.test.ts`
- `__tests__/migrations/00078_platform_connections.test.ts`
- `__tests__/migrations/00080_blog_posts_ai_extensions.test.ts`
- `__tests__/db/social-posts.test.ts`
- `__tests__/db/platform-connections.test.ts`
- `__tests__/db/video-uploads.test.ts`
- `__tests__/lib/social-registry.test.ts`
- `__tests__/lib/firebase-functions.test.ts`

---

## Tasks

### Task 1: Migration 00076 — social_posts + social_captions tables

**Files:**

- Create: `supabase/migrations/00076_social_posts_and_captions.sql`
- Test: `__tests__/migrations/00076_social_posts.test.ts`

- [ ] **Step 1: Write the failing migration test**

```typescript
// __tests__/migrations/00076_social_posts.test.ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00076 — social_posts + social_captions", () => {
  const supabase = createServiceRoleClient()

  it("creates a social_posts row with expected columns", async () => {
    const { data, error } = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "test",
        approval_status: "draft",
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    expect(data?.platform).toBe("instagram")
    expect(data?.approval_status).toBe("draft")
    expect(data?.scheduled_at).toBeNull()

    if (data?.id) {
      await supabase.from("social_posts").delete().eq("id", data.id)
    }
  })

  it("creates a social_captions row linked to a social_post", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "parent", approval_status: "draft" })
      .select()
      .single()

    const caption = await supabase
      .from("social_captions")
      .insert({
        social_post_id: post.data!.id,
        caption_text: "hello world",
        hashtags: ["#fit", "#dj"],
      })
      .select()
      .single()

    expect(caption.error).toBeNull()
    expect(caption.data?.caption_text).toBe("hello world")
    expect(caption.data?.hashtags).toEqual(["#fit", "#dj"])

    await supabase.from("social_posts").delete().eq("id", post.data!.id)
  })

  it("rejects invalid platform value via CHECK constraint", async () => {
    const { error } = await supabase
      .from("social_posts")
      .insert({ platform: "myspace", content: "x", approval_status: "draft" })

    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/migrations/00076_social_posts.test.ts`
Expected: FAIL with "relation social_posts does not exist" or equivalent

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/00076_social_posts_and_captions.sql
CREATE TABLE social_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          text NOT NULL CHECK (platform IN (
                      'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin'
                    )),
  content           text NOT NULL,
  media_url         text,
  approval_status   text NOT NULL DEFAULT 'draft' CHECK (approval_status IN (
                      'draft', 'edited', 'approved', 'scheduled', 'published', 'rejected', 'awaiting_connection', 'failed'
                    )),
  scheduled_at      timestamptz,
  published_at      timestamptz,
  source_video_id   uuid,
  rejection_notes   text,
  platform_post_id  text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_posts_platform ON social_posts(platform);
CREATE INDEX idx_social_posts_approval_status ON social_posts(approval_status);
CREATE INDEX idx_social_posts_scheduled_at ON social_posts(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_social_posts_source_video ON social_posts(source_video_id) WHERE source_video_id IS NOT NULL;

CREATE TABLE social_captions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id    uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  caption_text      text NOT NULL,
  hashtags          text[] NOT NULL DEFAULT '{}',
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_captions_post ON social_captions(social_post_id);

-- Reuse existing updated_at trigger pattern (see 00012_create_updated_at_trigger.sql)
CREATE TRIGGER trg_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_captions ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db push` (or run the SQL in Supabase SQL editor if db push is not configured)
Expected: `Applied migration 00076_social_posts_and_captions`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/migrations/00076_social_posts.test.ts`
Expected: 3 passing tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00076_social_posts_and_captions.sql __tests__/migrations/00076_social_posts.test.ts
git commit -m "feat(db): migration 00076 — social_posts + social_captions tables"
```

---

### Task 2: Migration 00077 — content_calendar table

**Files:**

- Create: `supabase/migrations/00077_content_calendar.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00077_content_calendar.sql
CREATE TABLE content_calendar (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type        text NOT NULL CHECK (entry_type IN (
                      'social_post', 'blog_post', 'newsletter', 'topic_suggestion'
                    )),
  reference_id      uuid,
  title             text NOT NULL,
  scheduled_for     date NOT NULL,
  scheduled_time    time,
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN (
                      'planned', 'in_progress', 'published', 'cancelled'
                    )),
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_calendar_date ON content_calendar(scheduled_for);
CREATE INDEX idx_content_calendar_status ON content_calendar(status);
CREATE INDEX idx_content_calendar_entry_type ON content_calendar(entry_type);
CREATE INDEX idx_content_calendar_reference ON content_calendar(reference_id) WHERE reference_id IS NOT NULL;

CREATE TRIGGER trg_content_calendar_updated_at
  BEFORE UPDATE ON content_calendar
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: `Applied migration 00077_content_calendar`

- [ ] **Step 3: Verify schema exists**

Run this quick sanity check in a node REPL or a throwaway script:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
const sb = createServiceRoleClient()
const { error } = await sb.from("content_calendar").select("id").limit(1)
console.log("content_calendar accessible:", error === null)
```

Expected: `content_calendar accessible: true`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00077_content_calendar.sql
git commit -m "feat(db): migration 00077 — content_calendar table"
```

---

### Task 3: Migration 00078 — platform_connections table

**Files:**

- Create: `supabase/migrations/00078_platform_connections.sql`
- Test: `__tests__/migrations/00078_platform_connections.test.ts`

- [ ] **Step 1: Write the failing migration test**

```typescript
// __tests__/migrations/00078_platform_connections.test.ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00078 — platform_connections", () => {
  const supabase = createServiceRoleClient()

  it("inserts a connection row with status=not_connected by default", async () => {
    const { data, error } = await supabase
      .from("platform_connections")
      .upsert({ plugin_name: "meta" }, { onConflict: "plugin_name" })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.plugin_name).toBe("meta")
    expect(data?.status).toBe("not_connected")
    expect(data?.credentials).toEqual({})

    await supabase.from("platform_connections").delete().eq("plugin_name", "meta")
  })

  it("rejects invalid plugin_name via CHECK constraint", async () => {
    const { error } = await supabase.from("platform_connections").insert({ plugin_name: "bogus" })
    expect(error).not.toBeNull()
  })

  it("enforces unique plugin_name", async () => {
    await supabase.from("platform_connections").insert({ plugin_name: "tiktok" })
    const { error } = await supabase.from("platform_connections").insert({ plugin_name: "tiktok" })
    expect(error).not.toBeNull()

    await supabase.from("platform_connections").delete().eq("plugin_name", "tiktok")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/migrations/00078_platform_connections.test.ts`
Expected: FAIL with "relation platform_connections does not exist"

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/00078_platform_connections.sql
CREATE TABLE platform_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_name       text NOT NULL UNIQUE CHECK (plugin_name IN (
                      'meta', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin'
                    )),
  status            text NOT NULL DEFAULT 'not_connected' CHECK (status IN (
                      'not_connected', 'connected', 'paused', 'error'
                    )),
  credentials       jsonb NOT NULL DEFAULT '{}',
  account_handle    text,
  last_sync_at      timestamptz,
  last_error        text,
  connected_at      timestamptz,
  connected_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_connections_status ON platform_connections(status);

CREATE TRIGGER trg_platform_connections_updated_at
  BEFORE UPDATE ON platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;

-- Seed one row per supported plugin, all in not_connected state
INSERT INTO platform_connections (plugin_name, status) VALUES
  ('meta', 'not_connected'),
  ('instagram', 'not_connected'),
  ('tiktok', 'not_connected'),
  ('youtube', 'not_connected'),
  ('youtube_shorts', 'not_connected'),
  ('linkedin', 'not_connected')
ON CONFLICT (plugin_name) DO NOTHING;
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db push`
Expected: `Applied migration 00078_platform_connections`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/migrations/00078_platform_connections.test.ts`
Expected: 3 passing tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00078_platform_connections.sql __tests__/migrations/00078_platform_connections.test.ts
git commit -m "feat(db): migration 00078 — platform_connections with seed rows"
```

---

### Task 4: Migration 00079 — video_uploads + video_transcripts

**Files:**

- Create: `supabase/migrations/00079_video_uploads_and_transcripts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00079_video_uploads_and_transcripts.sql
CREATE TABLE video_uploads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  duration_seconds    integer,
  size_bytes          bigint,
  mime_type           text,
  title               text,
  uploaded_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                        'uploaded', 'transcribing', 'transcribed', 'analyzed', 'failed'
                      )),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_uploads_status ON video_uploads(status);
CREATE INDEX idx_video_uploads_created ON video_uploads(created_at DESC);

CREATE TRIGGER trg_video_uploads_updated_at
  BEFORE UPDATE ON video_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE video_transcripts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_upload_id     uuid NOT NULL REFERENCES video_uploads(id) ON DELETE CASCADE,
  transcript_text     text NOT NULL,
  language            text NOT NULL DEFAULT 'en',
  assemblyai_job_id   text,
  analysis            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_transcripts_video ON video_transcripts(video_upload_id);

ALTER TABLE video_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_transcripts ENABLE ROW LEVEL SECURITY;

-- Add FK from social_posts.source_video_id to video_uploads(id)
ALTER TABLE social_posts
  ADD CONSTRAINT fk_social_posts_source_video
  FOREIGN KEY (source_video_id)
  REFERENCES video_uploads(id)
  ON DELETE SET NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: `Applied migration 00079_video_uploads_and_transcripts`

- [ ] **Step 3: Quick sanity check**

```typescript
const sb = createServiceRoleClient()
const up = await sb
  .from("video_uploads")
  .insert({
    storage_path: "video-uploads/test.mp4",
    original_filename: "test.mp4",
  })
  .select()
  .single()
const t = await sb
  .from("video_transcripts")
  .insert({
    video_upload_id: up.data!.id,
    transcript_text: "hello",
  })
  .select()
  .single()
console.log("linked:", t.data?.video_upload_id === up.data?.id)
await sb.from("video_uploads").delete().eq("id", up.data!.id)
```

Expected: `linked: true` and the cascade delete removes the transcript row too.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00079_video_uploads_and_transcripts.sql
git commit -m "feat(db): migration 00079 — video_uploads + video_transcripts"
```

---

### Task 5: Migration 00080 — blog_posts AI extensions

**Files:**

- Create: `supabase/migrations/00080_blog_posts_ai_extensions.sql`
- Test: `__tests__/migrations/00080_blog_posts_ai_extensions.test.ts`

- [ ] **Step 1: Write the failing migration test**

```typescript
// __tests__/migrations/00080_blog_posts_ai_extensions.test.ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00080 — blog_posts AI extensions", () => {
  const supabase = createServiceRoleClient()

  it("accepts new AI columns on blog_posts", async () => {
    const { data, error } = await supabase
      .from("blog_posts")
      .insert({
        title: "test-00080",
        slug: `test-00080-${Date.now()}`,
        category: "Performance",
        status: "draft",
        content: "test body",
        source_video_id: null,
        seo_metadata: { meta_title: "x", keywords: ["a"] },
        tavily_research: { summary: "s" },
        fact_check_status: "passed",
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.seo_metadata).toEqual({ meta_title: "x", keywords: ["a"] })
    expect(data?.fact_check_status).toBe("passed")

    if (data?.id) await supabase.from("blog_posts").delete().eq("id", data.id)
  })

  it("rejects invalid fact_check_status via CHECK", async () => {
    const { error } = await supabase.from("blog_posts").insert({
      title: "test-00080-bad",
      slug: `test-00080-bad-${Date.now()}`,
      category: "Performance",
      status: "draft",
      content: "x",
      fact_check_status: "made-up-value",
    })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/migrations/00080_blog_posts_ai_extensions.test.ts`
Expected: FAIL — columns don't exist yet

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/00080_blog_posts_ai_extensions.sql
ALTER TABLE blog_posts
  ADD COLUMN source_video_id    uuid REFERENCES video_uploads(id) ON DELETE SET NULL,
  ADD COLUMN seo_metadata       jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN tavily_research    jsonb,
  ADD COLUMN fact_check_status  text CHECK (fact_check_status IN (
                                   'pending', 'passed', 'flagged', 'failed'
                                 ));

CREATE INDEX idx_blog_posts_source_video ON blog_posts(source_video_id) WHERE source_video_id IS NOT NULL;
CREATE INDEX idx_blog_posts_fact_check ON blog_posts(fact_check_status) WHERE fact_check_status IS NOT NULL;
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db push`
Expected: `Applied migration 00080_blog_posts_ai_extensions`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/migrations/00080_blog_posts_ai_extensions.test.ts`
Expected: 2 passing tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00080_blog_posts_ai_extensions.sql __tests__/migrations/00080_blog_posts_ai_extensions.test.ts
git commit -m "feat(db): migration 00080 — blog_posts AI extensions (source_video_id, seo_metadata, tavily_research, fact_check_status)"
```

---

### Task 6: Migration 00081 — extend prompt_templates categories + seed voice profile

**Files:**

- Create: `supabase/migrations/00081_extend_prompt_templates_categories.sql`

- [ ] **Step 1: Check the current CHECK constraint on prompt_templates**

Read [supabase/migrations/00075_prompt_templates.sql](../../../supabase/migrations/00075_prompt_templates.sql) to confirm the existing categories: `structure`, `session`, `periodization`, `sport`, `rehab`, `conditioning`, `specialty`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/00081_extend_prompt_templates_categories.sql

-- Drop the existing CHECK constraint on category, add a broader one that includes AI automation categories
ALTER TABLE prompt_templates DROP CONSTRAINT prompt_templates_category_check;

ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_category_check
  CHECK (category IN (
    'structure', 'session', 'periodization', 'sport', 'rehab', 'conditioning', 'specialty',
    'voice_profile', 'social_caption', 'blog_generation', 'blog_research', 'newsletter'
  ));

-- Extend scope CHECK to include AI automation scopes
ALTER TABLE prompt_templates DROP CONSTRAINT prompt_templates_scope_check;

ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_scope_check
  CHECK (scope IN (
    'week', 'day', 'both',
    'global', 'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin', 'blog', 'newsletter'
  ));

-- Seed one default voice profile row (coach edits it during Phase 1 brand voice session)
INSERT INTO prompt_templates (name, category, scope, description, prompt)
VALUES (
  'DJP Athlete — Default Voice Profile',
  'voice_profile',
  'global',
  'Brand voice profile applied to every AI-generated piece of content. Edit during kickoff session.',
  'You write as DJP Athlete — a strength coach focused on rotational power, comeback training, and performance development for athletes. Voice: direct, confident, technically precise. Prefer active voice. Avoid hype language and generic fitness tropes. Reference specific exercises, programs (Comeback Code, Rotational Reboot), and training concepts from the exercise library when relevant. Never use client names or personal details without explicit permission.'
);
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: `Applied migration 00081_extend_prompt_templates_categories`

- [ ] **Step 4: Sanity check**

```typescript
const sb = createServiceRoleClient()
const { data } = await sb
  .from("prompt_templates")
  .select("id, name, category, scope")
  .eq("category", "voice_profile")
  .single()
console.log("voice profile seeded:", data?.name)
```

Expected: `voice profile seeded: DJP Athlete — Default Voice Profile`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00081_extend_prompt_templates_categories.sql
git commit -m "feat(db): migration 00081 — extend prompt_templates categories + seed voice profile"
```

---

### Task 7: Extend types/database.ts with new types

**Files:**

- Modify: `types/database.ts` (append to end)

- [ ] **Step 1: Add the new types**

Append to [types/database.ts](../../../types/database.ts):

```typescript
// ─────────────────────────────────────────────────────────────────
// Starter AI Automation types (Phase 1 — migrations 00076–00081)
// ─────────────────────────────────────────────────────────────────

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "youtube" | "youtube_shorts" | "linkedin"

export type SocialApprovalStatus =
  | "draft"
  | "edited"
  | "approved"
  | "scheduled"
  | "published"
  | "rejected"
  | "awaiting_connection"
  | "failed"

export type PlatformConnectionStatus = "not_connected" | "connected" | "paused" | "error"

export type CalendarEntryType = "social_post" | "blog_post" | "newsletter" | "topic_suggestion"
export type CalendarStatus = "planned" | "in_progress" | "published" | "cancelled"

export type VideoUploadStatus = "uploaded" | "transcribing" | "transcribed" | "analyzed" | "failed"

export type FactCheckStatus = "pending" | "passed" | "flagged" | "failed"

export interface SocialPost {
  id: string
  platform: SocialPlatform
  content: string
  media_url: string | null
  approval_status: SocialApprovalStatus
  scheduled_at: string | null
  published_at: string | null
  source_video_id: string | null
  rejection_notes: string | null
  platform_post_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SocialCaption {
  id: string
  social_post_id: string
  caption_text: string
  hashtags: string[]
  version: number
  created_at: string
}

export interface ContentCalendarEntry {
  id: string
  entry_type: CalendarEntryType
  reference_id: string | null
  title: string
  scheduled_for: string
  scheduled_time: string | null
  status: CalendarStatus
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PlatformConnection {
  id: string
  plugin_name: SocialPlatform
  status: PlatformConnectionStatus
  credentials: Record<string, unknown>
  account_handle: string | null
  last_sync_at: string | null
  last_error: string | null
  connected_at: string | null
  connected_by: string | null
  created_at: string
  updated_at: string
}

export interface VideoUpload {
  id: string
  storage_path: string
  original_filename: string
  duration_seconds: number | null
  size_bytes: number | null
  mime_type: string | null
  title: string | null
  uploaded_by: string | null
  status: VideoUploadStatus
  created_at: string
  updated_at: string
}

export interface VideoTranscript {
  id: string
  video_upload_id: string
  transcript_text: string
  language: string
  assemblyai_job_id: string | null
  analysis: Record<string, unknown> | null
  created_at: string
}
```

Also extend the existing `BlogPost` interface to include the new columns. Find the existing `BlogPost` interface in [types/database.ts](../../../types/database.ts) (search for `export interface BlogPost {`) and add these fields:

```typescript
source_video_id: string | null
seo_metadata: Record<string, unknown>
tavily_research: Record<string, unknown> | null
fact_check_status: FactCheckStatus | null
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to the new types.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): add types for social posts, captions, calendar, connections, videos; extend BlogPost"
```

---

### Task 8: DAL — social-posts + social-captions

**Files:**

- Create: `lib/db/social-posts.ts`
- Create: `lib/db/social-captions.ts`
- Test: `__tests__/db/social-posts.test.ts`

- [ ] **Step 1: Write the failing DAL test**

```typescript
// __tests__/db/social-posts.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  createSocialPost,
  getSocialPostById,
  listSocialPosts,
  updateSocialPost,
  deleteSocialPost,
} from "@/lib/db/social-posts"
import { addCaptionToPost, listCaptionsForPost } from "@/lib/db/social-captions"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_SOCIAL_POST__"

describe("social-posts + social-captions DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("social_posts").delete().like("content", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("creates, reads, updates, deletes a social post", async () => {
    const created = await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}hello`,
      approval_status: "draft",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })
    expect(created.id).toBeTruthy()

    const fetched = await getSocialPostById(created.id)
    expect(fetched?.platform).toBe("instagram")

    const updated = await updateSocialPost(created.id, { approval_status: "approved" })
    expect(updated.approval_status).toBe("approved")

    await deleteSocialPost(created.id)
    const gone = await getSocialPostById(created.id)
    expect(gone).toBeNull()
  })

  it("lists with platform + status filters", async () => {
    await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}a`,
      approval_status: "draft",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })
    await createSocialPost({
      platform: "tiktok",
      content: `${TEST_TAG}b`,
      approval_status: "approved",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })

    const ig = await listSocialPosts({ platform: "instagram" })
    const approved = await listSocialPosts({ approval_status: "approved" })
    expect(ig.some((p) => p.content === `${TEST_TAG}a`)).toBe(true)
    expect(approved.some((p) => p.content === `${TEST_TAG}b`)).toBe(true)
  })

  it("adds captions linked to a post and lists them", async () => {
    const post = await createSocialPost({
      platform: "instagram",
      content: `${TEST_TAG}p`,
      approval_status: "draft",
      media_url: null,
      scheduled_at: null,
      source_video_id: null,
      created_by: null,
    })
    await addCaptionToPost({
      social_post_id: post.id,
      caption_text: "caption v1",
      hashtags: ["#fit", "#dj"],
      version: 1,
    })
    await addCaptionToPost({
      social_post_id: post.id,
      caption_text: "caption v2",
      hashtags: [],
      version: 2,
    })
    const captions = await listCaptionsForPost(post.id)
    expect(captions.length).toBe(2)
    expect(captions.find((c) => c.version === 2)?.caption_text).toBe("caption v2")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/db/social-posts.test.ts`
Expected: FAIL — "Cannot find module '@/lib/db/social-posts'"

- [ ] **Step 3: Write the DAL files**

```typescript
// lib/db/social-posts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPost, SocialPlatform, SocialApprovalStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createSocialPost(
  post: Omit<SocialPost, "id" | "created_at" | "updated_at" | "published_at" | "platform_post_id" | "rejection_notes">,
): Promise<SocialPost> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_posts").insert(post).select().single()
  if (error) throw error
  return data as SocialPost
}

export async function getSocialPostById(id: string): Promise<SocialPost | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_posts").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as SocialPost | null) ?? null
}

export interface ListSocialPostsFilters {
  platform?: SocialPlatform
  approval_status?: SocialApprovalStatus
}

export async function listSocialPosts(filters: ListSocialPostsFilters = {}): Promise<SocialPost[]> {
  const supabase = getClient()
  let query = supabase.from("social_posts").select("*").order("created_at", { ascending: false })
  if (filters.platform) query = query.eq("platform", filters.platform)
  if (filters.approval_status) query = query.eq("approval_status", filters.approval_status)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SocialPost[]
}

export async function updateSocialPost(
  id: string,
  updates: Partial<Omit<SocialPost, "id" | "created_at">>,
): Promise<SocialPost> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_posts").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as SocialPost
}

export async function deleteSocialPost(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("social_posts").delete().eq("id", id)
  if (error) throw error
}
```

```typescript
// lib/db/social-captions.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialCaption } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function addCaptionToPost(caption: Omit<SocialCaption, "id" | "created_at">): Promise<SocialCaption> {
  const supabase = getClient()
  const { data, error } = await supabase.from("social_captions").insert(caption).select().single()
  if (error) throw error
  return data as SocialCaption
}

export async function listCaptionsForPost(socialPostId: string): Promise<SocialCaption[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_captions")
    .select("*")
    .eq("social_post_id", socialPostId)
    .order("version", { ascending: true })
  if (error) throw error
  return (data ?? []) as SocialCaption[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/social-posts.test.ts`
Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/db/social-posts.ts lib/db/social-captions.ts __tests__/db/social-posts.test.ts
git commit -m "feat(db): DAL for social_posts and social_captions with integration tests"
```

---

### Task 9: DAL — content-calendar

**Files:**

- Create: `lib/db/content-calendar.ts`

- [ ] **Step 1: Write the DAL file**

```typescript
// lib/db/content-calendar.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ContentCalendarEntry, CalendarEntryType, CalendarStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createCalendarEntry(
  entry: Omit<ContentCalendarEntry, "id" | "created_at" | "updated_at">,
): Promise<ContentCalendarEntry> {
  const supabase = getClient()
  const { data, error } = await supabase.from("content_calendar").insert(entry).select().single()
  if (error) throw error
  return data as ContentCalendarEntry
}

export async function getCalendarEntryById(id: string): Promise<ContentCalendarEntry | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("content_calendar").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as ContentCalendarEntry | null) ?? null
}

export interface ListCalendarFilters {
  entry_type?: CalendarEntryType
  status?: CalendarStatus
  from_date?: string // ISO date
  to_date?: string // ISO date
}

export async function listCalendarEntries(filters: ListCalendarFilters = {}): Promise<ContentCalendarEntry[]> {
  const supabase = getClient()
  let query = supabase.from("content_calendar").select("*").order("scheduled_for", { ascending: true })
  if (filters.entry_type) query = query.eq("entry_type", filters.entry_type)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.from_date) query = query.gte("scheduled_for", filters.from_date)
  if (filters.to_date) query = query.lte("scheduled_for", filters.to_date)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ContentCalendarEntry[]
}

export async function updateCalendarEntry(
  id: string,
  updates: Partial<Omit<ContentCalendarEntry, "id" | "created_at">>,
): Promise<ContentCalendarEntry> {
  const supabase = getClient()
  const { data, error } = await supabase.from("content_calendar").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as ContentCalendarEntry
}

export async function deleteCalendarEntry(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("content_calendar").delete().eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 2: Quick smoke check (no dedicated test file — covered by Phase 3 tests when calendar UI lands)**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/content-calendar.ts
git commit -m "feat(db): DAL for content_calendar"
```

---

### Task 10: DAL — platform-connections

**Files:**

- Create: `lib/db/platform-connections.ts`
- Test: `__tests__/db/platform-connections.test.ts`

- [ ] **Step 1: Write the failing DAL test**

```typescript
// __tests__/db/platform-connections.test.ts
import { describe, it, expect, beforeAll } from "vitest"
import {
  listPlatformConnections,
  getPlatformConnection,
  connectPlatform,
  pausePlatform,
  disconnectPlatform,
} from "@/lib/db/platform-connections"
import { createServiceRoleClient } from "@/lib/supabase"

describe("platform-connections DAL", () => {
  const supabase = createServiceRoleClient()

  beforeAll(async () => {
    // Ensure seed row exists for meta (migration 00078 seeded all 6)
    await supabase
      .from("platform_connections")
      .update({ status: "not_connected", credentials: {}, account_handle: null })
      .eq("plugin_name", "meta")
  })

  it("lists all 6 seeded plugins", async () => {
    const all = await listPlatformConnections()
    const names = all.map((c) => c.plugin_name).sort()
    expect(names).toEqual(["instagram", "linkedin", "meta", "tiktok", "youtube", "youtube_shorts"])
  })

  it("getPlatformConnection returns one connection by name", async () => {
    const meta = await getPlatformConnection("meta")
    expect(meta?.plugin_name).toBe("meta")
  })

  it("connectPlatform transitions to connected state", async () => {
    const c = await connectPlatform("meta", {
      credentials: { access_token: "tok" },
      account_handle: "@djpathlete",
    })
    expect(c.status).toBe("connected")
    expect(c.account_handle).toBe("@djpathlete")
    expect((c.credentials as { access_token: string }).access_token).toBe("tok")
    expect(c.connected_at).not.toBeNull()
  })

  it("pausePlatform keeps credentials but sets paused", async () => {
    const c = await pausePlatform("meta")
    expect(c.status).toBe("paused")
    expect((c.credentials as { access_token?: string }).access_token).toBe("tok")
  })

  it("disconnectPlatform clears credentials and sets not_connected", async () => {
    const c = await disconnectPlatform("meta")
    expect(c.status).toBe("not_connected")
    expect(c.credentials).toEqual({})
    expect(c.account_handle).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/db/platform-connections.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the DAL file**

```typescript
// lib/db/platform-connections.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { PlatformConnection, SocialPlatform } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listPlatformConnections(): Promise<PlatformConnection[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .select("*")
    .order("plugin_name", { ascending: true })
  if (error) throw error
  return (data ?? []) as PlatformConnection[]
}

export async function getPlatformConnection(pluginName: SocialPlatform): Promise<PlatformConnection | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .select("*")
    .eq("plugin_name", pluginName)
    .maybeSingle()
  if (error) throw error
  return (data as PlatformConnection | null) ?? null
}

export interface ConnectPayload {
  credentials: Record<string, unknown>
  account_handle?: string | null
  connected_by?: string | null
}

export async function connectPlatform(
  pluginName: SocialPlatform,
  payload: ConnectPayload,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({
      status: "connected",
      credentials: payload.credentials,
      account_handle: payload.account_handle ?? null,
      connected_at: new Date().toISOString(),
      connected_by: payload.connected_by ?? null,
      last_error: null,
    })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}

export async function pausePlatform(pluginName: SocialPlatform): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({ status: "paused" })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}

export async function disconnectPlatform(pluginName: SocialPlatform): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({
      status: "not_connected",
      credentials: {},
      account_handle: null,
      connected_at: null,
      connected_by: null,
      last_error: null,
    })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}

export async function setConnectionError(
  pluginName: SocialPlatform,
  errorMessage: string,
): Promise<PlatformConnection> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("platform_connections")
    .update({ status: "error", last_error: errorMessage })
    .eq("plugin_name", pluginName)
    .select()
    .single()
  if (error) throw error
  return data as PlatformConnection
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/platform-connections.test.ts`
Expected: 5 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/db/platform-connections.ts __tests__/db/platform-connections.test.ts
git commit -m "feat(db): DAL for platform_connections (list/get/connect/pause/disconnect/error)"
```

---

### Task 11: DAL — video-uploads + video-transcripts

**Files:**

- Create: `lib/db/video-uploads.ts`
- Create: `lib/db/video-transcripts.ts`
- Test: `__tests__/db/video-uploads.test.ts`

- [ ] **Step 1: Write the failing DAL test**

```typescript
// __tests__/db/video-uploads.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  createVideoUpload,
  getVideoUploadById,
  listVideoUploads,
  updateVideoUploadStatus,
} from "@/lib/db/video-uploads"
import { saveTranscript, getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_VIDEO__"

describe("video-uploads + video-transcripts DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("video_uploads").delete().like("original_filename", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("creates a video upload and transitions status", async () => {
    const created = await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}a.mp4`,
      original_filename: `${TEST_TAG}a.mp4`,
      duration_seconds: 90,
      size_bytes: 1024,
      mime_type: "video/mp4",
      title: "Test Upload",
      uploaded_by: null,
      status: "uploaded",
    })
    expect(created.id).toBeTruthy()

    const updated = await updateVideoUploadStatus(created.id, "transcribing")
    expect(updated.status).toBe("transcribing")
  })

  it("saves and retrieves a transcript", async () => {
    const upload = await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}b.mp4`,
      original_filename: `${TEST_TAG}b.mp4`,
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      title: null,
      uploaded_by: null,
      status: "uploaded",
    })

    await saveTranscript({
      video_upload_id: upload.id,
      transcript_text: "Hello this is a test coaching video",
      language: "en",
      assemblyai_job_id: "aa_test_123",
      analysis: null,
    })

    const t = await getTranscriptForVideo(upload.id)
    expect(t?.transcript_text).toContain("coaching video")
    expect(t?.assemblyai_job_id).toBe("aa_test_123")
  })

  it("lists video uploads ordered by most recent", async () => {
    await createVideoUpload({
      storage_path: `video-uploads/${TEST_TAG}c1.mp4`,
      original_filename: `${TEST_TAG}c1.mp4`,
      duration_seconds: null,
      size_bytes: null,
      mime_type: null,
      title: null,
      uploaded_by: null,
      status: "uploaded",
    })
    const list = await listVideoUploads({ limit: 50 })
    expect(list.some((v) => v.original_filename === `${TEST_TAG}c1.mp4`)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/db/video-uploads.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the DAL files**

```typescript
// lib/db/video-uploads.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { VideoUpload, VideoUploadStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createVideoUpload(
  upload: Omit<VideoUpload, "id" | "created_at" | "updated_at">,
): Promise<VideoUpload> {
  const supabase = getClient()
  const { data, error } = await supabase.from("video_uploads").insert(upload).select().single()
  if (error) throw error
  return data as VideoUpload
}

export async function getVideoUploadById(id: string): Promise<VideoUpload | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("video_uploads").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as VideoUpload | null) ?? null
}

export async function listVideoUploads(options: { limit?: number } = {}): Promise<VideoUpload[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_uploads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50)
  if (error) throw error
  return (data ?? []) as VideoUpload[]
}

export async function updateVideoUploadStatus(id: string, status: VideoUploadStatus): Promise<VideoUpload> {
  const supabase = getClient()
  const { data, error } = await supabase.from("video_uploads").update({ status }).eq("id", id).select().single()
  if (error) throw error
  return data as VideoUpload
}
```

```typescript
// lib/db/video-transcripts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { VideoTranscript } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function saveTranscript(transcript: Omit<VideoTranscript, "id" | "created_at">): Promise<VideoTranscript> {
  const supabase = getClient()
  const { data, error } = await supabase.from("video_transcripts").insert(transcript).select().single()
  if (error) throw error
  return data as VideoTranscript
}

export async function getTranscriptForVideo(videoUploadId: string): Promise<VideoTranscript | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("video_transcripts")
    .select("*")
    .eq("video_upload_id", videoUploadId)
    .maybeSingle()
  if (error) throw error
  return (data as VideoTranscript | null) ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/video-uploads.test.ts`
Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/db/video-uploads.ts lib/db/video-transcripts.ts __tests__/db/video-uploads.test.ts
git commit -m "feat(db): DAL for video_uploads + video_transcripts"
```

---

### Task 12: Register new DAL files in lib/db/index.ts

**Files:**

- Modify: `lib/db/index.ts`

- [ ] **Step 1: Add exports**

Append to [lib/db/index.ts](../../../lib/db/index.ts):

```typescript
export * from "./social-posts"
export * from "./social-captions"
export * from "./content-calendar"
export * from "./platform-connections"
export * from "./video-uploads"
export * from "./video-transcripts"
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/index.ts
git commit -m "chore(db): export new Starter AI DAL modules from index"
```

---

### Task 13: Plugin framework — types + registry

**Files:**

- Create: `lib/social/plugins/types.ts`
- Create: `lib/social/registry.ts`
- Test: `__tests__/lib/social-registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

```typescript
// __tests__/lib/social-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { createPluginRegistry } from "@/lib/social/registry"
import type { PublishPlugin, PublishResult } from "@/lib/social/plugins/types"

function makeStubPlugin(
  name: "meta" | "instagram" | "tiktok" | "youtube" | "youtube_shorts" | "linkedin",
): PublishPlugin {
  return {
    name,
    displayName: name,
    async connect(_creds) {
      return { status: "connected", account_handle: `@${name}` }
    },
    async publish(_input): Promise<PublishResult> {
      return { success: true, platform_post_id: `${name}_post_1` }
    },
    async fetchAnalytics(_postId) {
      return { impressions: 100, engagement: 10 }
    },
    async disconnect() {
      // no-op
    },
    async getSetupInstructions() {
      return `Set up ${name}`
    },
  }
}

describe("plugin registry", () => {
  let registry: ReturnType<typeof createPluginRegistry>

  beforeEach(() => {
    registry = createPluginRegistry()
  })

  it("registers and retrieves a plugin", () => {
    const meta = makeStubPlugin("meta")
    registry.register(meta)
    expect(registry.get("meta")).toBe(meta)
  })

  it("lists all registered plugin names", () => {
    registry.register(makeStubPlugin("meta"))
    registry.register(makeStubPlugin("tiktok"))
    expect(registry.list().sort()).toEqual(["meta", "tiktok"])
  })

  it("throws when registering the same plugin twice", () => {
    registry.register(makeStubPlugin("meta"))
    expect(() => registry.register(makeStubPlugin("meta"))).toThrow(/already registered/i)
  })

  it("returns undefined for unregistered plugin", () => {
    expect(registry.get("linkedin")).toBeUndefined()
  })

  it("invokes plugin.publish and returns its result", async () => {
    registry.register(makeStubPlugin("instagram"))
    const result = await registry.get("instagram")!.publish({
      content: "hi",
      mediaUrl: null,
      scheduledAt: null,
    })
    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("instagram_post_1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/social-registry.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the plugin types**

```typescript
// lib/social/plugins/types.ts
import type { SocialPlatform, PlatformConnection } from "@/types/database"

export interface PublishInput {
  content: string
  mediaUrl: string | null
  scheduledAt: string | null
  metadata?: Record<string, unknown>
}

export interface PublishResult {
  success: boolean
  platform_post_id?: string
  error?: string
}

export interface AnalyticsResult {
  impressions?: number
  engagement?: number
  likes?: number
  comments?: number
  shares?: number
  views?: number
  [key: string]: number | undefined
}

export interface ConnectResult {
  status: PlatformConnection["status"]
  account_handle?: string
  error?: string
}

export interface PublishPlugin {
  name: SocialPlatform
  displayName: string
  connect(credentials: Record<string, unknown>): Promise<ConnectResult>
  publish(input: PublishInput): Promise<PublishResult>
  fetchAnalytics(platformPostId: string): Promise<AnalyticsResult>
  disconnect(): Promise<void>
  getSetupInstructions(): Promise<string>
}
```

- [ ] **Step 4: Write the registry**

```typescript
// lib/social/registry.ts
import type { SocialPlatform } from "@/types/database"
import type { PublishPlugin } from "./plugins/types"

export interface PluginRegistry {
  register(plugin: PublishPlugin): void
  get(name: SocialPlatform): PublishPlugin | undefined
  list(): SocialPlatform[]
  all(): PublishPlugin[]
}

export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map<SocialPlatform, PublishPlugin>()

  return {
    register(plugin: PublishPlugin) {
      if (plugins.has(plugin.name)) {
        throw new Error(`Plugin "${plugin.name}" is already registered`)
      }
      plugins.set(plugin.name, plugin)
    },

    get(name: SocialPlatform): PublishPlugin | undefined {
      return plugins.get(name)
    },

    list(): SocialPlatform[] {
      return Array.from(plugins.keys())
    },

    all(): PublishPlugin[] {
      return Array.from(plugins.values())
    },
  }
}

// Singleton registry for the Next.js app. Plugin implementations (Phase 2)
// will self-register by importing this module.
export const pluginRegistry = createPluginRegistry()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/social-registry.test.ts`
Expected: 5 passing tests

- [ ] **Step 6: Commit**

```bash
git add lib/social/plugins/types.ts lib/social/registry.ts __tests__/lib/social-registry.test.ts
git commit -m "feat(social): PublishPlugin interface + plugin registry with tests"
```

---

### Task 14: Admin sidebar — add Social / Videos / Platform Connections items

**Files:**

- Modify: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Read the existing nav sections**

Open [components/admin/AdminSidebar.tsx](../../../components/admin/AdminSidebar.tsx). Locate the `navSections` array. Identify a good section to append the new items — the "Coaching" or "Content" section (whichever contains the blog/newsletter items), or add a new section.

- [ ] **Step 2: Add new nav items**

Find the import line for icons near the top of the file and extend it. Look for the line starting with `import { ... } from "lucide-react"` and add these icons to the same destructured import:

```typescript
import {
  LayoutDashboard,
  Bot,
  Users,
  Dumbbell,
  ClipboardList,
  FileText,
  Mail,
  CreditCard,
  BarChart3,
  Brain,
  CalendarDays,
  Sparkles,
  Lightbulb,
  Star,
  MessageSquareQuote,
  Video,
  ClipboardCheck,
  CalendarCheck,
  Scale,
  ChevronDown,
  Settings,
  LogOut,
  ShoppingBag,
  Package,
  // New:
  Megaphone,
  Link2,
  Film,
} from "lucide-react"
```

Find the `navSections` array. Add a new section right after the existing "Content" or "Coaching" section (wherever blog/newsletter live). Insert:

```typescript
  {
    title: "AI Automation",
    items: [
      { label: "Social", href: "/admin/social", icon: Megaphone },
      { label: "Videos", href: "/admin/videos", icon: Film },
      { label: "Platform Connections", href: "/admin/platform-connections", icon: Link2 },
    ],
  },
```

- [ ] **Step 3: Verify it renders**

Run: `npm run dev` (on port 3050)
Open `http://localhost:3050/admin/dashboard` in a browser.
Expected: Three new sidebar items appear under an "AI Automation" heading. Clicking them 404s for now (pages scaffolded in Task 15).

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdminSidebar.tsx
git commit -m "feat(admin): add AI Automation section to sidebar (Social, Videos, Platform Connections)"
```

---

### Task 15: Admin page scaffolds — Social, Videos, Platform Connections

**Files:**

- Create: `app/(admin)/admin/social/page.tsx`
- Create: `app/(admin)/admin/videos/page.tsx`
- Create: `app/(admin)/admin/platform-connections/page.tsx`

- [ ] **Step 1: Write the Social page scaffold**

```tsx
// app/(admin)/admin/social/page.tsx
import { Megaphone, Clock, CheckCircle, Sparkles } from "lucide-react"
import { listSocialPosts } from "@/lib/db/social-posts"
import type { SocialPost } from "@/types/database"

export const metadata = { title: "Social" }

export default async function SocialPage() {
  const posts: SocialPost[] = await listSocialPosts()

  const drafts = posts.filter((p) => p.approval_status === "draft").length
  const scheduled = posts.filter((p) => p.approval_status === "scheduled").length
  const published = posts.filter((p) => p.approval_status === "published").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Social</h1>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Sparkles className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Drafts</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{drafts}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Clock className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Scheduled</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{scheduled}</p>
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

      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Megaphone className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No social posts yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a coaching video in the Videos tab and the system will generate captions for every connected platform.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the Videos page scaffold**

```tsx
// app/(admin)/admin/videos/page.tsx
import { Film, Upload, CheckCircle } from "lucide-react"
import { listVideoUploads } from "@/lib/db/video-uploads"
import type { VideoUpload } from "@/types/database"

export const metadata = { title: "Videos" }

export default async function VideosPage() {
  const videos: VideoUpload[] = await listVideoUploads({ limit: 50 })

  const uploaded = videos.filter((v) => v.status === "uploaded" || v.status === "transcribing").length
  const ready = videos.filter((v) => v.status === "transcribed" || v.status === "analyzed").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Videos</h1>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Upload className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Processing</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{uploaded}</p>
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
      </div>

      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Film className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No videos uploaded yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">Video upload UI ships in Phase 3 of the Starter build.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the Platform Connections page scaffold**

```tsx
// app/(admin)/admin/platform-connections/page.tsx
import { Link2, CheckCircle, XCircle, Pause } from "lucide-react"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import type { PlatformConnection } from "@/types/database"

export const metadata = { title: "Platform Connections" }

const PLUGIN_LABELS: Record<string, string> = {
  meta: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  linkedin: "LinkedIn",
}

function statusBadge(status: PlatformConnection["status"]) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle className="size-3.5" /> Connected
      </span>
    )
  }
  if (status === "paused") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
        <Pause className="size-3.5" /> Paused
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-error">
        <XCircle className="size-3.5" /> Error
      </span>
    )
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">Not connected</span>
}

export default async function PlatformConnectionsPage() {
  const connections: PlatformConnection[] = await listPlatformConnections()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-2">Platform Connections</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Activate each platform when you're ready. You can do this at any time — the AI keeps generating captions whether
        a platform is connected or not.
      </p>

      <div className="bg-white rounded-xl border border-border divide-y divide-border">
        {connections.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Link2 className="size-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-primary">{PLUGIN_LABELS[c.plugin_name] ?? c.plugin_name}</p>
                <p className="text-xs text-muted-foreground">{c.account_handle ?? "No account linked"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {statusBadge(c.status)}
              <button
                type="button"
                disabled
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground cursor-not-allowed"
                title="OAuth connect flow ships in Phase 2"
              >
                Connect
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify pages render**

Run: `npm run dev`
Open in browser:

- `http://localhost:3050/admin/social` — shows stat cards with zeros, empty state card
- `http://localhost:3050/admin/videos` — shows stat cards with zeros, empty state card
- `http://localhost:3050/admin/platform-connections` — lists all 6 seeded plugins, all "Not connected", disabled Connect buttons
  Expected: All three pages load without error.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/social/page.tsx app/\(admin\)/admin/videos/page.tsx app/\(admin\)/admin/platform-connections/page.tsx
git commit -m "feat(admin): scaffold Social, Videos, Platform Connections admin pages"
```

---

### Task 16: Firebase Functions project initialization

**Files:**

- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `functions/.gitignore`
- Create: `functions/src/index.ts`

- [ ] **Step 1: Create `firebase.json` at repo root**

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs20",
    "codebase": "default",
    "ignore": ["node_modules", ".git", "firebase-debug.log", "firebase-debug.*.log", "*.local"],
    "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"]
  }
}
```

- [ ] **Step 2: Create `.firebaserc` at repo root**

```json
{
  "projects": {
    "default": "djpathlete"
  }
}
```

> Note: Replace `djpathlete` with the actual Firebase project ID once you create the Firebase project. If you haven't yet, run `firebase projects:create djpathlete-ai-automation` or use an existing project.

- [ ] **Step 3: Create `functions/package.json`**

```json
{
  "name": "djpathlete-functions",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "npm run build && firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log"
  },
  "engines": {
    "node": "20"
  },
  "main": "lib/index.js",
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0",
    "@supabase/supabase-js": "^2.97.0",
    "@anthropic-ai/sdk": "^0.77.0",
    "resend": "^4.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 4: Create `functions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "ES2022",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["lib", "node_modules"]
}
```

- [ ] **Step 5: Create `functions/.gitignore`**

```
node_modules/
lib/
*.log
.env
```

- [ ] **Step 6: Create `functions/src/index.ts` (placeholder — real functions added in Phase 2+)**

```typescript
// Firebase Functions entry point for DJP Athlete AI Automation
// Functions added in Phase 2 (plugin publishing), Phase 3 (social fanout),
// Phase 4 (blog + Tavily), Phase 5 (scheduled reports + analytics sync).
//
// Each function is exported individually so Firebase deploys them as separate
// cloud functions. Schema mirroring from lib/ai/schemas.ts happens via a build
// script added in a later phase.

export const _phase1Stub = () => "Starter AI Automation Phase 1 — Firebase Functions project initialized"
```

- [ ] **Step 7: Install Firebase Functions deps**

Run:

```bash
cd functions && npm install && cd ..
```

Expected: Dependencies install into `functions/node_modules/`.

- [ ] **Step 8: Verify it builds**

Run:

```bash
cd functions && npm run build && cd ..
```

Expected: `functions/lib/index.js` is created, no errors.

- [ ] **Step 9: Commit**

```bash
git add firebase.json .firebaserc functions/package.json functions/tsconfig.json functions/.gitignore functions/src/index.ts
git commit -m "feat(functions): initialize Firebase Functions project (Node 20, 2nd gen)"
```

---

### Task 17: Firebase Functions shared libs (supabase, claude, resend)

**Files:**

- Create: `functions/src/lib/supabase.ts`
- Create: `functions/src/lib/claude.ts`
- Create: `functions/src/lib/resend.ts`

- [ ] **Step 1: Write `functions/src/lib/supabase.ts`**

```typescript
// functions/src/lib/supabase.ts
// Service-role Supabase client for Firebase Functions. Pattern mirrors
// lib/supabase.ts in the main Next.js app, but without SSR cookie handling
// (Functions never run in a user request context).

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { defineSecret } from "firebase-functions/params"

const supabaseUrlSecret = defineSecret("SUPABASE_URL")
const supabaseServiceRoleKeySecret = defineSecret("SUPABASE_SERVICE_ROLE_KEY")

let cachedClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient

  const url = supabaseUrlSecret.value()
  const key = supabaseServiceRoleKeySecret.value()
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets must be set")
  }

  cachedClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedClient
}

export const supabaseSecrets = [supabaseUrlSecret, supabaseServiceRoleKeySecret]
```

- [ ] **Step 2: Write `functions/src/lib/claude.ts`**

```typescript
// functions/src/lib/claude.ts
// Claude API wrapper for Firebase Functions.

import Anthropic from "@anthropic-ai/sdk"
import { defineSecret } from "firebase-functions/params"

const claudeApiKeySecret = defineSecret("CLAUDE_API_KEY")

let cachedClient: Anthropic | null = null

export function getClaudeClient(): Anthropic {
  if (cachedClient) return cachedClient

  const apiKey = claudeApiKeySecret.value()
  if (!apiKey) throw new Error("CLAUDE_API_KEY secret must be set")

  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

export const claudeSecrets = [claudeApiKeySecret]

export const CLAUDE_MODELS = {
  OPUS_LATEST: "claude-opus-4-7",
  SONNET_LATEST: "claude-sonnet-4-6",
  HAIKU_LATEST: "claude-haiku-4-5-20251001",
} as const
```

- [ ] **Step 3: Write `functions/src/lib/resend.ts`**

```typescript
// functions/src/lib/resend.ts
// Resend client for transactional email from Firebase Functions.

import { Resend } from "resend"
import { defineSecret } from "firebase-functions/params"

const resendApiKeySecret = defineSecret("RESEND_API_KEY")

let cachedClient: Resend | null = null

export function getResendClient(): Resend {
  if (cachedClient) return cachedClient

  const apiKey = resendApiKeySecret.value()
  if (!apiKey) throw new Error("RESEND_API_KEY secret must be set")

  cachedClient = new Resend(apiKey)
  return cachedClient
}

export const resendSecrets = [resendApiKeySecret]
```

- [ ] **Step 4: Update `functions/src/index.ts` to import the libs (verifies they compile)**

Replace the content of `functions/src/index.ts` with:

```typescript
// Firebase Functions entry point for DJP Athlete AI Automation

export { supabaseSecrets } from "./lib/supabase.js"
export { claudeSecrets } from "./lib/claude.js"
export { resendSecrets } from "./lib/resend.js"

export const _phase1Stub = () => "Starter AI Automation Phase 1 — Firebase Functions project initialized"
```

- [ ] **Step 5: Verify it builds**

Run:

```bash
cd functions && npm run build && cd ..
```

Expected: No TypeScript errors; `functions/lib/lib/supabase.js`, `claude.js`, `resend.js` generated.

- [ ] **Step 6: Commit**

```bash
git add functions/src/lib/supabase.ts functions/src/lib/claude.ts functions/src/lib/resend.ts functions/src/index.ts
git commit -m "feat(functions): shared libs — Supabase service-role, Claude, Resend with secret bindings"
```

---

### Task 18: Next.js ↔ Firebase bridge helper

**Files:**

- Create: `lib/firebase-functions.ts`
- Test: `__tests__/lib/firebase-functions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/firebase-functions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { invokeFunction } from "@/lib/firebase-functions"

describe("invokeFunction bridge helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("FIREBASE_FUNCTIONS_URL", "https://us-central1-djpathlete.cloudfunctions.net")
    vi.stubEnv("FIREBASE_FUNCTIONS_INVOKE_TOKEN", "test-token")
  })

  it("POSTs to the functions URL with the given name and payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await invokeFunction("generateSocialCaption", { videoId: "v1" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://us-central1-djpathlete.cloudfunctions.net/generateSocialCaption")
    expect((init as RequestInit).method).toBe("POST")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ videoId: "v1" })
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    })
    expect(result).toEqual({ result: "ok" })
  })

  it("throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      }),
    )

    await expect(invokeFunction("generateSocialCaption", {})).rejects.toThrow(/500/)
  })

  it("throws when FIREBASE_FUNCTIONS_URL is not set", async () => {
    vi.stubEnv("FIREBASE_FUNCTIONS_URL", "")
    await expect(invokeFunction("any", {})).rejects.toThrow(/FIREBASE_FUNCTIONS_URL/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/firebase-functions.test.ts`
Expected: FAIL — "Cannot find module '@/lib/firebase-functions'"

- [ ] **Step 3: Write the helper**

```typescript
// lib/firebase-functions.ts
// Thin wrapper around fetch that invokes HTTPS-callable Firebase Functions.
// Called from Next.js API routes (and server components) to offload heavy
// async work (Claude, Tavily, AssemblyAI orchestration) to Firebase.

export async function invokeFunction<TResult = unknown>(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<TResult> {
  const baseUrl = process.env.FIREBASE_FUNCTIONS_URL
  const token = process.env.FIREBASE_FUNCTIONS_INVOKE_TOKEN

  if (!baseUrl) {
    throw new Error("FIREBASE_FUNCTIONS_URL env var is not set")
  }

  const url = `${baseUrl.replace(/\/$/, "")}/${functionName}`

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Firebase Function "${functionName}" failed (${response.status}): ${body}`)
  }

  return (await response.json()) as TResult
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/firebase-functions.test.ts`
Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/firebase-functions.ts __tests__/lib/firebase-functions.test.ts
git commit -m "feat(functions): Next.js invokeFunction helper for HTTPS-callable Firebase Functions"
```

---

### Task 19: Environment variables documentation

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Append new env vars**

Read the current `.env.example` to see what's already there, then append (at the end):

```bash
# ─────────────────────────────────────────────────────────────────
# Starter AI Automation — Phase 1
# ─────────────────────────────────────────────────────────────────

# Firebase project
FIREBASE_PROJECT_ID=djpathlete
FIREBASE_FUNCTIONS_REGION=us-central1
FIREBASE_FUNCTIONS_URL=https://us-central1-djpathlete.cloudfunctions.net
FIREBASE_FUNCTIONS_INVOKE_TOKEN=

# Social platform OAuth client IDs (public-ish — these go in Vercel env)
# Secrets (CLIENT_SECRET, APP_SECRET) stay in Firebase secrets, NOT in Vercel
META_APP_ID=
TIKTOK_APP_ID=
YOUTUBE_CLIENT_ID=
LINKEDIN_CLIENT_ID=

# Firebase Secrets (set via: firebase functions:secrets:set <NAME>)
# Do NOT put these in Vercel — they live only in Firebase secret manager:
#   CLAUDE_API_KEY
#   TAVILY_API_KEY
#   ASSEMBLYAI_API_KEY
#   META_APP_SECRET
#   TIKTOK_APP_SECRET
#   YOUTUBE_CLIENT_SECRET
#   LINKEDIN_CLIENT_SECRET
#   RESEND_API_KEY           (already in Vercel env; also needed in Firebase secrets)
#   SUPABASE_URL             (already in Vercel env; also needed in Firebase secrets)
#   SUPABASE_SERVICE_ROLE_KEY (already in Vercel env; also needed in Firebase secrets)
```

- [ ] **Step 2: Verify the file is valid (no shell injection)**

Run: `head -100 .env.example`
Expected: New section appears at end, properly commented.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): document Starter AI Automation env vars + Firebase secrets split"
```

---

## Post-Phase-1 Verification

After all 19 tasks complete, run this final verification:

- [ ] **Run full test suite**

Run: `npm run test:run`
Expected: All tests pass, including new tests for migrations, DAL, registry, and bridge helper.

- [ ] **Build the Next.js app**

Run: `npm run build`
Expected: Build succeeds. No type errors. All new pages listed in the build output.

- [ ] **Build the Firebase Functions project**

Run: `cd functions && npm run build && cd ..`
Expected: Builds cleanly.

- [ ] **Verify admin pages**

Run: `npm run dev` and click through the three new sidebar items. All three pages render. Platform Connections shows all 6 seeded plugins.

- [ ] **Verify migration list**

Run this quick check:

```bash
ls supabase/migrations/0007[6-9]*.sql supabase/migrations/0008[01]*.sql
```

Expected: 6 new migration files listed (00076 through 00081).

---

## What Phase 1 Unblocks

After Phase 1 completes, these become possible in subsequent phases:

- **Phase 2:** Platform plugins (`meta.ts`, `youtube.ts`, `tiktok.ts`, `linkedin.ts`) self-register against the plugin registry and persist OAuth tokens in `platform_connections`.
- **Phase 3:** Video uploads write to `video_uploads`; AssemblyAI Firebase Function writes to `video_transcripts`; social fanout writes to `social_posts` + `social_captions`.
- **Phase 4:** `blog_posts` AI columns power the video-to-blog pipeline; `prompt_templates` (now with `voice_profile`/`social_caption`/`blog_generation` categories) stores all AI prompts.
- **Phase 5:** `social_posts.approval_status = published` rows + `platform_post_id` enable analytics sync; the scheduled publishing Firebase Function reads from `social_posts` where `scheduled_at <= now()`.

---

## Self-Review Notes

This plan covers:

- ✅ Every table in the Codebase Integration Map's "What We're Building New" (social_posts, social_captions, content_calendar, platform_connections, video_uploads, video_transcripts)
- ✅ blog_posts ALTER from the Integration Map
- ✅ Plugin framework files
- ✅ Admin page scaffolds
- ✅ Firebase Functions init + shared libs
- ✅ Next.js bridge helper
- ✅ Env var documentation

No placeholders. Every code step shows complete code. Every test step shows complete test code. Type names are consistent across tasks (e.g., `PublishPlugin`, `PlatformConnection`, `SocialPost`).
