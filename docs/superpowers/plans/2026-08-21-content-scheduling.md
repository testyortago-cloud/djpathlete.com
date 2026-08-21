# Content Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pick a future date and time for a blog post to publish itself and for a newsletter to send itself, cancel or move it, and see both on the existing content calendar.

**Architecture:** `scheduled` becomes a real third value of `blog_posts.status` and `newsletters.status`, paired with a `scheduled_at` timestamp. Four thin admin routes write that state; a pure partitioner decides what is due; a runner fires each due item through the *same* publish/send code the manual buttons use; a five-minute Firebase cron drives the runner. This mirrors `social_posts` + `publishDuePostsCron` deliberately, so the codebase has one scheduling shape and not three.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (service-role DAL in `lib/db/`), Zod validators, NextAuth v5, Firebase `onSchedule` functions, Vitest, Tailwind v4 + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-08-21-content-scheduling-design.md](../specs/2026-08-21-content-scheduling-design.md)

## Global Constraints

- **Tables always use the house `DataTable` components** (`DataTableCard` → `DataTable` / `DataTableHeader` / `DataTableHead` / `DataTableRow` / `DataTableCell`, with `DataTableBadge` for status pills). Never hand-roll a `<table>` or a status `<span>`. Exceptions: `components/emails/*` and `*/print/*`.
- **`DataTableBadge` tones** are exactly `neutral | success | warning | info | danger`. For this feature: Scheduled = `info`, Published/Sent = `success`, Draft = `warning`, Missed = `danger`.
- **Colors are semantic classes only** (`text-primary`, `bg-accent`, `text-muted-foreground`). Never a hardcoded hex.
- **The admin UI is light-only.** Do not add `.dark` variants and do not produce dark screenshots of `/admin/*`.
- **`tsc --noEmit` baseline on this branch's base (`bc97ff2b`) is exactly 251 errors.** Compare against 251 in *both* directions — a falling count can hide new errors as easily as a rising one.
- **Run targeted tests only** (`npx vitest run <path>`). Never the full suite.
- **`functions/` cannot import from `lib/`** (`rootDir: "src"`). Anything both runtimes need exists as twin copies.
- **No Claude attribution** in any commit message.
- **Feature flag key:** `cron_content_schedule_enabled`, default **`true`**.
- **Grace window:** `MISSED_GRACE_MS = 24 * 60 * 60 * 1000`. Boundary is `>=` — exactly 24h late is missed, not fired.

---

## File Structure

**Created**
| File | Responsibility |
|---|---|
| `supabase/migrations/00223_content_scheduling.sql` | Columns, CHECK constraints, partial indexes, flag row |
| `lib/content-schedule/due.ts` | Pure: rows + `now` → `{ fire, missed, waiting }`. No I/O. |
| `lib/content-schedule/run-due.ts` | Loads rows, partitions, dispatches, writes terminal state |
| `lib/blog/publish-post.ts` | The publish side-effects, extracted from the route |
| `lib/newsletter/send-newsletter.ts` | The send side-effects, extracted from the route |
| `app/api/admin/internal/content-schedule-due/route.ts` | Bearer-token cron endpoint |
| `app/api/admin/blog/[id]/schedule/route.ts` | Arm a blog post |
| `app/api/admin/blog/[id]/unschedule/route.ts` | Disarm a blog post |
| `app/api/admin/newsletter/[id]/schedule/route.ts` | Arm a newsletter |
| `app/api/admin/newsletter/[id]/unschedule/route.ts` | Disarm a newsletter |
| `components/admin/shared/SchedulePicker.tsx` | The shared `datetime-local` dialog |

**Modified**
| File | Change |
|---|---|
| `types/database.ts` | Widen both status unions; add two fields to each interface |
| `lib/validators/blog-post.ts:98` | Widen the Zod enum |
| `lib/db/blog-posts.ts` | Add `listScheduledBlogPosts()` |
| `lib/db/newsletters.ts` | Add `listScheduledNewsletters()` |
| `app/api/admin/blog/[id]/publish/route.ts` | Delegate to `publishBlogPost()` |
| `app/api/admin/newsletter/[id]/send/route.ts` | Delegate to `sendNewsletterNow()` |
| `app/api/admin/blog/route.ts:56-62` | Don't stamp `published_at` for a scheduled post |
| `lib/audit/actions.ts` | Seven new slugs |
| `lib/cron-catalog.ts` | New catalog entry |
| `lib/automation/automation-health-scanner.ts` | New `EXPECTED_CRONS` row |
| `functions/src/index.ts` | New `contentScheduleCron` |
| `components/admin/blog/BlogPostList.tsx` | Scheduled tab, badge, actions |
| `components/admin/newsletter/NewsletterList.tsx` | Scheduled tab, badge, actions |
| `components/admin/blog/BlogPostForm.tsx` | Schedule control + armed banner |
| `components/admin/newsletter/NewsletterForm.tsx` | Schedule control + armed banner |
| `app/(admin)/admin/blog/page.tsx` | Scheduled tile; Drafts stops swallowing |
| `app/(admin)/admin/newsletter/page.tsx` | Scheduled tile; Drafts stops swallowing |
| `lib/analytics/daily-pulse.ts:118` | Scheduled/missed counts |
| `lib/content-studio/calendar-chips.ts` | `BlogPostChip` + `NewsletterChip` |
| `lib/content-studio/calendar-data.ts` | Load both alongside social |
| `components/admin/content-studio/calendar/CalendarContainer.tsx` | Drag the new chip kinds |

---

## Task 1: Schema and types

**Files:**
- Create: `supabase/migrations/00223_content_scheduling.sql`
- Modify: `types/database.ts:35-36`, `types/database.ts:1202-1230` (`BlogPost`), `types/database.ts:1282-1295` (`Newsletter`)
- Modify: `lib/validators/blog-post.ts:98`
- Test: `__tests__/migrations/content-scheduling.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `BlogPostStatus = "draft" | "scheduled" | "published"`, `NewsletterStatus = "draft" | "scheduled" | "sent"`; both `BlogPost` and `Newsletter` gain `scheduled_at: string | null` and `schedule_failed_reason: string | null`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00223_content_scheduling.sql`:

```sql
-- Content scheduling for blog posts and newsletters.
-- Adds a third lifecycle state to each table plus the intended fire time.
-- Mirrors social_posts.scheduled_at, which has worked this way since Phase 5.

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_failed_reason TEXT;

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'published'));

-- Partial index: the every-5-min checker only ever reads scheduled rows.
CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled
  ON blog_posts (scheduled_at) WHERE status = 'scheduled';

ALTER TABLE newsletters
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_failed_reason TEXT;

ALTER TABLE newsletters DROP CONSTRAINT IF EXISTS newsletters_status_check;
ALTER TABLE newsletters ADD CONSTRAINT newsletters_status_check
  CHECK (status IN ('draft', 'scheduled', 'sent'));

CREATE INDEX IF NOT EXISTS idx_newsletters_scheduled
  ON newsletters (scheduled_at) WHERE status = 'scheduled';

-- Defaults TRUE, unlike most new cron flags. A scheduler whose checker is
-- off is not a dormant feature — it is a UI that accepts a time and then
-- does nothing. The /schedule routes refuse while this is false, so the
-- combination "accepts schedules, never fires them" cannot occur.
INSERT INTO system_settings (key, value, description)
VALUES ('cron_content_schedule_enabled', 'true'::jsonb,
        'Publish scheduled blog posts and send scheduled newsletters when their time arrives')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/migrations/content-scheduling.test.ts`. Look at a sibling in `__tests__/migrations/` first and match its idiom for reading migration SQL off disk.

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/00223_content_scheduling.sql"),
  "utf8",
)

describe("00223_content_scheduling", () => {
  it("allows the scheduled status on both tables", () => {
    expect(sql).toContain("CHECK (status IN ('draft', 'scheduled', 'published'))")
    expect(sql).toContain("CHECK (status IN ('draft', 'scheduled', 'sent'))")
  })

  it("drops the old CHECK before adding the new one on both tables", () => {
    // Without the DROP, ADD CONSTRAINT fails on an existing database and the
    // whole migration aborts — the table keeps its two-value constraint and
    // every /schedule write 400s in production.
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS blog_posts_status_check")
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS newsletters_status_check")
  })

  it("adds scheduled_at and a failure reason to both tables", () => {
    const blogBlock = sql.slice(sql.indexOf("ALTER TABLE blog_posts"), sql.indexOf("ALTER TABLE newsletters"))
    expect(blogBlock).toContain("scheduled_at TIMESTAMPTZ")
    expect(blogBlock).toContain("schedule_failed_reason TEXT")
    const nlBlock = sql.slice(sql.indexOf("ALTER TABLE newsletters"))
    expect(nlBlock).toContain("scheduled_at TIMESTAMPTZ")
    expect(nlBlock).toContain("schedule_failed_reason TEXT")
  })

  it("seeds the cron flag defaulting to true", () => {
    expect(sql).toContain("cron_content_schedule_enabled")
    expect(sql).toMatch(/'true'::jsonb/)
  })

  it("is idempotent — every statement is guarded", () => {
    expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
    expect(sql).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run __tests__/migrations/content-scheduling.test.ts`
Expected: PASS (the migration was written in Step 1; this test pins its shape against later edits).

- [ ] **Step 4: Widen the types**

In `types/database.ts`, lines 35-36:

```ts
export type BlogPostStatus = "draft" | "scheduled" | "published"
export type NewsletterStatus = "draft" | "scheduled" | "sent"
```

Add to the `BlogPost` interface (after `published_at`):

```ts
  scheduled_at: string | null
  schedule_failed_reason: string | null
```

Add the same two lines to the `Newsletter` interface (after `sent_at`).

- [ ] **Step 5: Keep the new fields off the INSERT types**

**This step is why Step 8's tsc check would otherwise fail.** Both tables'
insert types are `Omit<Row, …>`, so adding two *required* fields to the
interfaces makes them required on every insert, breaking existing callers:

- `types/database.ts:1649` — `newsletters.Insert` is `Omit<Newsletter, "id" | "created_at" | "updated_at" | "sent_at" | "sent_count" | "failed_count">`
- `lib/db/newsletters.ts:22` — `createNewsletter()` takes that same Omit; its caller is `app/api/admin/newsletter/route.ts:36`
- `lib/db/blog-posts.ts:10` — `CreateBlogPostInput`

Both new columns are nullable with no default value needed at insert, so
follow the precedent already in `lib/db/blog-posts.ts` (the comment there
about migrations 00080 & 00084 describes exactly this situation): optional on
insert, required on read.

In `types/database.ts:1649`, add both to the Omit:

```ts
        Insert: Omit<
          Newsletter,
          | "id" | "created_at" | "updated_at" | "sent_at" | "sent_count" | "failed_count"
          | "scheduled_at" | "schedule_failed_reason"
        >
```

In `lib/db/newsletters.ts`, widen `createNewsletter`'s parameter the same way.

In `lib/db/blog-posts.ts`, extend the existing `Omit … & Partial<Pick …>` pair
so both new fields appear in **both** halves:

```ts
type CreateBlogPostInput = Omit<
  BlogPost,
  "id" | "created_at" | "updated_at" | "source_video_id" | "seo_metadata" | "tavily_research" | "fact_check_status" | "fact_check_details" | "last_refreshed_at" | "refresh_count" | "scheduled_at" | "schedule_failed_reason"
> &
  Partial<Pick<BlogPost, "source_video_id" | "seo_metadata" | "tavily_research" | "fact_check_status" | "fact_check_details" | "last_refreshed_at" | "refresh_count" | "scheduled_at" | "schedule_failed_reason">>
```

- [ ] **Step 6: Widen the blog validator**

`lib/validators/blog-post.ts:98` — this Zod enum would otherwise **reject** the new value on PATCH:

```ts
  status: z.enum(["draft", "scheduled", "published"]).optional(),
```

- [ ] **Step 7: Apply the migration to the dev clone**

Standing instruction: new migrations go onto the dev database as part of the work. The repo applier (`scripts/migrations/apply.mjs`) **refuses on dev** — `public.repo_migrations` doesn't exist there and `baseline.sql` only covers through `00205`, so do not baseline. Use the narrow path: POST the file's SQL to the Management API.

```bash
node -r dotenv/config -e '
  const fs = require("fs");
  const ref = "anjvztjiokcgiyhobknq";           // dev clone
  if (ref === "epzuvzkokzqtzomeyoha") throw new Error("refusing to touch prod");
  const sql = fs.readFileSync("supabase/migrations/00223_content_scheduling.sql", "utf8");
  fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  }).then(r => r.text()).then(t => console.log(t));
' dotenv_config_path=.env.local dotenv_config_quiet=true
```

`dotenv_config_quiet=true` matters: without it dotenv prints a tip containing a non-ASCII character to stdout, which corrupts the token if captured into a shell variable.

- [ ] **Step 8: Verify the migration actually landed**

```bash
node -r dotenv/config -e '
  const ref = "anjvztjiokcgiyhobknq";
  fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `
      SELECT table_name, column_name FROM information_schema.columns
      WHERE column_name IN (`+"'scheduled_at','schedule_failed_reason'"+`)
        AND table_name IN (`+"'blog_posts','newsletters'"+`) ORDER BY 1,2;` }),
  }).then(r => r.json()).then(j => console.log(JSON.stringify(j)));
' dotenv_config_path=.env.local dotenv_config_quiet=true
```

Expected: four rows — `blog_posts`/`newsletters` × `scheduled_at`/`schedule_failed_reason`. **If it returns fewer, stop and report.** Do not proceed on an assumption the DDL applied.

- [ ] **Step 9: Check tsc**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: **251**. Widening a union is additive, so nothing should break. If the count moved, read the new errors — a `switch` somewhere may be exhaustive over the old two values.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/00223_content_scheduling.sql types/database.ts lib/db/blog-posts.ts lib/db/newsletters.ts lib/validators/blog-post.ts __tests__/migrations/content-scheduling.test.ts
git commit -m "feat(content-schedule): a third state for a post that is neither written-and-waiting nor live"
```

---

## Task 2: The pure partitioner

**Files:**
- Create: `lib/content-schedule/due.ts`
- Test: `__tests__/lib/content-schedule/due.test.ts`

**Interfaces:**
- Consumes: nothing (deliberately — this file does no I/O so the 24h boundary is cheap to test exhaustively)
- Produces:
```ts
export interface SchedulableRow { id: string; scheduled_at: string | null }
export interface DuePartition<T> { fire: T[]; missed: Array<{ row: T; reason: string }>; waiting: T[] }
export const MISSED_GRACE_MS: number
export function partitionDue<T extends SchedulableRow>(rows: T[], now: Date): DuePartition<T>
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-schedule/due.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { partitionDue, MISSED_GRACE_MS } from "@/lib/content-schedule/due"

const NOW = new Date("2026-08-21T12:00:00.000Z")
const at = (iso: string) => ({ id: iso, scheduled_at: iso })

describe("partitionDue", () => {
  it("fires a row whose time is exactly now", () => {
    const r = at("2026-08-21T12:00:00.000Z")
    expect(partitionDue([r], NOW).fire).toEqual([r])
  })

  it("waits on a row one second in the future", () => {
    const r = at("2026-08-21T12:00:01.000Z")
    const out = partitionDue([r], NOW)
    expect(out.waiting).toEqual([r])
    expect(out.fire).toEqual([])
    expect(out.missed).toEqual([])
  })

  it("fires a row 23h59m late — an outage should not cost you the post", () => {
    const r = at("2026-08-20T12:01:00.000Z")
    expect(partitionDue([r], NOW).fire).toEqual([r])
  })

  it("misses a row exactly 24h late — the boundary is >=, not >", () => {
    const r = at("2026-08-20T12:00:00.000Z")
    const out = partitionDue([r], NOW)
    expect(out.fire).toEqual([])
    expect(out.missed).toHaveLength(1)
    expect(out.missed[0].row).toEqual(r)
  })

  it("misses a row 24h01m late", () => {
    const r = at("2026-08-20T11:59:00.000Z")
    expect(partitionDue([r], NOW).missed).toHaveLength(1)
  })

  it("gives a missed row a reason naming how late it was", () => {
    const r = at("2026-08-19T12:00:00.000Z")
    const { missed } = partitionDue([r], NOW)
    expect(missed[0].reason).toMatch(/missed/i)
    expect(missed[0].reason).toMatch(/2026-08-19/)
  })

  it("treats a scheduled row with no time as missed, not as a crash", () => {
    // A NULL scheduled_at on a scheduled row is corrupt state. Firing it
    // would publish at an arbitrary moment; ignoring it would strand the row
    // as permanently scheduled. Missed is the only honest answer.
    const r = { id: "x", scheduled_at: null }
    const out = partitionDue([r], NOW)
    expect(out.missed).toHaveLength(1)
    expect(out.missed[0].reason).toMatch(/no scheduled time/i)
    expect(out.fire).toEqual([])
  })

  it("partitions a mixed batch without losing a row", () => {
    const rows = [
      at("2026-08-21T11:59:00.000Z"), // fire
      at("2026-08-21T12:30:00.000Z"), // waiting
      at("2026-08-18T12:00:00.000Z"), // missed
    ]
    const out = partitionDue(rows, NOW)
    expect(out.fire).toHaveLength(1)
    expect(out.waiting).toHaveLength(1)
    expect(out.missed).toHaveLength(1)
    expect(out.fire.length + out.waiting.length + out.missed.length).toBe(rows.length)
  })

  it("exports the grace window as 24 hours", () => {
    expect(MISSED_GRACE_MS).toBe(24 * 60 * 60 * 1000)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/lib/content-schedule/due.test.ts`
Expected: FAIL — cannot resolve `@/lib/content-schedule/due`.

- [ ] **Step 3: Implement**

Create `lib/content-schedule/due.ts`:

```ts
// lib/content-schedule/due.ts
// Pure partitioner for scheduled content. No I/O, no DAL, no clock of its
// own — `now` is always passed in, which is what makes the 24-hour boundary
// exhaustively testable.

/** The window inside which a late item still goes out. */
export const MISSED_GRACE_MS = 24 * 60 * 60 * 1000

export interface SchedulableRow {
  id: string
  scheduled_at: string | null
}

export interface DuePartition<T> {
  /** Due now, and late by less than the grace window. */
  fire: T[]
  /** Late by at least the grace window, or unusable. Never fired. */
  missed: Array<{ row: T; reason: string }>
  /** Still in the future. */
  waiting: T[]
}

/**
 * Splits scheduled rows three ways against `now`.
 *
 * The grace window exists because the checker runs every five minutes and can
 * itself be down. A two-hour outage should not cost you the post; a newsletter
 * armed for a week must not land in inboxes the moment service returns. The
 * boundary is `>=` — exactly 24h late is missed.
 */
export function partitionDue<T extends SchedulableRow>(rows: T[], now: Date): DuePartition<T> {
  const out: DuePartition<T> = { fire: [], missed: [], waiting: [] }
  const nowMs = now.getTime()

  for (const row of rows) {
    if (!row.scheduled_at) {
      out.missed.push({ row, reason: "Had no scheduled time — reschedule it to send." })
      continue
    }

    const whenMs = new Date(row.scheduled_at).getTime()
    if (Number.isNaN(whenMs)) {
      out.missed.push({ row, reason: "Had no scheduled time we could read — reschedule it to send." })
      continue
    }

    if (whenMs > nowMs) {
      out.waiting.push(row)
      continue
    }

    if (nowMs - whenMs >= MISSED_GRACE_MS) {
      out.missed.push({
        row,
        reason: `Missed its slot — it was set for ${row.scheduled_at} and that is more than 24 hours ago. Pick a new time.`,
      })
      continue
    }

    out.fire.push(row)
  }

  return out
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/content-schedule/due.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutate one test to prove it can fail**

Temporarily change `MISSED_GRACE_MS` to `>` instead of `>=` in the comparison. The "exactly 24h late" test MUST fail. Revert. A green-on-first-run boundary test that cannot fail is pinning nothing.

- [ ] **Step 6: Commit**

```bash
git add lib/content-schedule/due.ts __tests__/lib/content-schedule/due.test.ts
git commit -m "feat(content-schedule): late is forgivable for a day, and then it is not"
```

---

## Task 3: Extract the blog publish path

The runner must do *exactly* what the Publish button does. The only way to guarantee that is to have one function and two callers.

**Files:**
- Create: `lib/blog/publish-post.ts`
- Modify: `app/api/admin/blog/[id]/publish/route.ts`
- Test: `__tests__/lib/blog/publish-post.test.ts`

**Interfaces:**
- Consumes: `BlogPost` from Task 1
- Produces:
```ts
export interface PublishBlogPostResult { id: string; slug: string | null; published_at: string | null }
export async function publishBlogPost(args: { id: string; actorId: string }): Promise<PublishBlogPostResult>
```

`actorId` is explicit because the cron has **no session**. The current route reads `session.user.id` for the AI-job `userId`; the runner passes the post's `author_id` instead.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/blog/publish-post.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const createAiJobMock = vi.fn()
const submitUrlToIndexNowMock = vi.fn()
const revalidatePathMock = vi.fn()
const calendarUpdateMock = vi.fn()

vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (j: unknown) => createAiJobMock(j) }))
vi.mock("@/lib/indexnow", () => ({ submitUrlToIndexNow: (u: string) => submitUrlToIndexNowMock(u) }))
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePathMock(p) }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ update: (v: unknown) => ({ eq: (c: string, id: string) => calendarUpdateMock(v, c, id) }) }),
  }),
}))

import { publishBlogPost } from "@/lib/blog/publish-post"

describe("publishBlogPost", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBlogPostByIdMock.mockResolvedValue({ id: "p1", slug: "speed-work", published_at: null, author_id: "author-1" })
    updateBlogPostMock.mockImplementation((id, u) => Promise.resolve({ id, slug: "speed-work", ...u }))
    createAiJobMock.mockResolvedValue({ id: "job" })
    submitUrlToIndexNowMock.mockResolvedValue(undefined)
  })

  it("marks the post published and stamps published_at", async () => {
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("published")
    expect(updates.published_at).toBeTruthy()
  })

  it("preserves an existing published_at rather than re-stamping it", async () => {
    getBlogPostByIdMock.mockResolvedValue({
      id: "p1", slug: "speed-work", published_at: "2026-01-01T00:00:00.000Z", author_id: "author-1",
    })
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.published_at).toBe("2026-01-01T00:00:00.000Z")
  })

  it("clears any schedule bookkeeping as it publishes", async () => {
    const [, updates] = (await publishBlogPost({ id: "p1", actorId: "admin-1" }), updateBlogPostMock.mock.calls[0])
    expect(updates.scheduled_at).toBeNull()
    expect(updates.schedule_failed_reason).toBeNull()
  })

  it("queues both AI jobs under the supplied actor, not a session", async () => {
    await publishBlogPost({ id: "p1", actorId: "cron-actor" })
    const types = createAiJobMock.mock.calls.map((c) => c[0].type)
    expect(types).toContain("newsletter_from_blog")
    expect(types).toContain("seo_enhance")
    for (const call of createAiJobMock.mock.calls) expect(call[0].userId).toBe("cron-actor")
  })

  it("pings IndexNow and revalidates both blog paths", async () => {
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    expect(submitUrlToIndexNowMock).toHaveBeenCalledWith("/blog/speed-work")
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog")
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog/speed-work")
  })

  it("still resolves when a fire-and-forget side effect rejects", async () => {
    // These are best-effort. A dead IndexNow endpoint must not strand a post
    // as scheduled-but-unpublished at 7am with nobody watching.
    createAiJobMock.mockRejectedValue(new Error("queue down"))
    submitUrlToIndexNowMock.mockRejectedValue(new Error("indexnow down"))
    await expect(publishBlogPost({ id: "p1", actorId: "admin-1" })).resolves.toMatchObject({ id: "p1" })
    expect(updateBlogPostMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/lib/blog/publish-post.test.ts`
Expected: FAIL — cannot resolve `@/lib/blog/publish-post`.

- [ ] **Step 3: Implement by moving the route body**

Create `lib/blog/publish-post.ts`. Move the body of `app/api/admin/blog/[id]/publish/route.ts` verbatim, changing only: `session.user.id` → `args.actorId`, and adding the two schedule-clearing fields.

```ts
// lib/blog/publish-post.ts
// The one publish path. Called by the Publish button's route and by the
// scheduled-content runner, so the two can never drift apart.

import { revalidatePath } from "next/cache"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { createAiJob } from "@/lib/ai-jobs"
import { submitUrlToIndexNow } from "@/lib/indexnow"

export interface PublishBlogPostResult {
  id: string
  slug: string | null
  published_at: string | null
}

/**
 * Publishes a blog post and runs every side effect the manual button runs.
 *
 * `actorId` is explicit rather than read from the session because the cron
 * has no session — it passes the post's own author_id.
 */
export async function publishBlogPost(args: {
  id: string
  actorId: string
}): Promise<PublishBlogPostResult> {
  const post = await getBlogPostById(args.id)

  const updated = await updateBlogPost(args.id, {
    status: "published",
    published_at: post.published_at ?? new Date().toISOString(),
    // A published post is no longer queued for anything.
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  // Flip any linked content_calendar row so the SEO agent's outcome tracker
  // sees the lifecycle terminate. Fire-and-forget.
  try {
    const { createServiceRoleClient } = await import("@/lib/supabase")
    await createServiceRoleClient()
      .from("content_calendar")
      .update({ status: "published" })
      .eq("reference_id", args.id)
  } catch (err) {
    console.error("[Blog publish] content_calendar status flip failed:", err)
  }

  createAiJob({
    type: "newsletter_from_blog",
    userId: args.actorId,
    input: { blog_post_id: args.id },
  }).catch((err) => console.error("[Blog] newsletter_from_blog queue failed:", err))

  createAiJob({
    type: "seo_enhance",
    userId: args.actorId,
    input: { blog_post_id: args.id },
  }).catch((err) => console.error("[Blog] seo_enhance queue failed:", err))

  if (updated.slug) {
    submitUrlToIndexNow(`/blog/${updated.slug}`).catch((err) =>
      console.error("[Blog] IndexNow submit failed:", err),
    )
  }

  revalidatePath("/blog")
  if (updated.slug) revalidatePath(`/blog/${updated.slug}`)

  return { id: updated.id, slug: updated.slug, published_at: updated.published_at }
}
```

- [ ] **Step 4: Make the route delegate**

Replace the body of `app/api/admin/blog/[id]/publish/route.ts` so it keeps its auth guard and returns the full updated row, but delegates the work:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { publishBlogPost } from "@/lib/blog/publish-post"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    await publishBlogPost({ id, actorId: session.user.id })
    return NextResponse.json(await getBlogPostById(id))
  } catch (error) {
    console.error("Blog publish error:", error)
    return NextResponse.json({ error: "Failed to publish post" }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/lib/blog/publish-post.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the existing blog tests for regressions**

Run: `npx vitest run __tests__/lib/blog __tests__/api/admin 2>&1 | tail -20`
Expected: no new failures. Record the pass count.

- [ ] **Step 7: Commit**

```bash
git add lib/blog/publish-post.ts "app/api/admin/blog/[id]/publish/route.ts" __tests__/lib/blog/publish-post.test.ts
git commit -m "refactor(blog): one publish path, so the button and the clock cannot disagree"
```

---

## Task 4: Extract the newsletter send path

**Files:**
- Create: `lib/newsletter/send-newsletter.ts`
- Modify: `app/api/admin/newsletter/[id]/send/route.ts`
- Test: `__tests__/lib/newsletter/send-newsletter.test.ts`

**Interfaces:**
- Consumes: `Newsletter` from Task 1
- Produces:
```ts
export class NewsletterNotSendableError extends Error { readonly code: "already_sent" | "too_short" }
export interface SendNewsletterResult { id: string; queued: true }
export async function sendNewsletterNow(args: { id: string; actorId: string }): Promise<SendNewsletterResult>
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/newsletter/send-newsletter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getNewsletterByIdMock = vi.fn()
const updateNewsletterMock = vi.fn()
const buildNewsletterHtmlMock = vi.fn()
const firestoreSetMock = vi.fn()

vi.mock("@/lib/db/newsletters", () => ({
  getNewsletterById: (id: string) => getNewsletterByIdMock(id),
  updateNewsletter: (id: string, u: unknown) => updateNewsletterMock(id, u),
}))
vi.mock("@/lib/email", () => ({ buildNewsletterHtml: (c: string) => buildNewsletterHtmlMock(c) }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ set: (d: unknown) => firestoreSetMock(d) }) }) }),
}))

import { sendNewsletterNow, NewsletterNotSendableError } from "@/lib/newsletter/send-newsletter"

const READY = { id: "n1", subject: "August round-up", content: "x".repeat(50), status: "scheduled" }

describe("sendNewsletterNow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getNewsletterByIdMock.mockResolvedValue(READY)
    updateNewsletterMock.mockResolvedValue(READY)
    buildNewsletterHtmlMock.mockReturnValue("<html/>")
    firestoreSetMock.mockResolvedValue(undefined)
  })

  it("refuses a newsletter that was already sent", async () => {
    getNewsletterByIdMock.mockResolvedValue({ ...READY, status: "sent" })
    await expect(sendNewsletterNow({ id: "n1", actorId: "a" })).rejects.toThrow(NewsletterNotSendableError)
    expect(firestoreSetMock).not.toHaveBeenCalled()
  })

  it("refuses a newsletter whose body is too short", async () => {
    // Re-checked here and not only at schedule time: a scheduled newsletter
    // stays editable, so it can be emptied after it was armed.
    getNewsletterByIdMock.mockResolvedValue({ ...READY, content: "hi" })
    await expect(sendNewsletterNow({ id: "n1", actorId: "a" })).rejects.toMatchObject({ code: "too_short" })
    expect(firestoreSetMock).not.toHaveBeenCalled()
  })

  it("marks the row sent BEFORE queuing the job", async () => {
    const order: string[] = []
    updateNewsletterMock.mockImplementation(async (_id, u) => {
      if ((u as { status?: string }).status === "sent") order.push("marked")
      return READY
    })
    firestoreSetMock.mockImplementation(async () => { order.push("queued") })
    await sendNewsletterNow({ id: "n1", actorId: "a" })
    expect(order).toEqual(["marked", "queued"])
  })

  it("clears the schedule bookkeeping as it sends", async () => {
    await sendNewsletterNow({ id: "n1", actorId: "a" })
    const [, updates] = updateNewsletterMock.mock.calls[0]
    expect(updates.scheduled_at).toBeNull()
    expect(updates.schedule_failed_reason).toBeNull()
  })

  it("queues the send job with the rendered html and the actor", async () => {
    await sendNewsletterNow({ id: "n1", actorId: "cron-actor" })
    const doc = firestoreSetMock.mock.calls[0][0]
    expect(doc.type).toBe("newsletter_send")
    expect(doc.status).toBe("pending")
    expect(doc.input).toMatchObject({ newsletterId: "n1", subject: "August round-up", html: "<html/>" })
    expect(doc.userId).toBe("cron-actor")
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/lib/newsletter/send-newsletter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/newsletter/send-newsletter.ts`, moving the body of the send route:

```ts
// lib/newsletter/send-newsletter.ts
// The one send path. Called by the Send button's route and by the
// scheduled-content runner.

import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { buildNewsletterHtml } from "@/lib/email"

export class NewsletterNotSendableError extends Error {
  readonly code: "already_sent" | "too_short"
  constructor(code: "already_sent" | "too_short", message: string) {
    super(message)
    this.name = "NewsletterNotSendableError"
    this.code = code
  }
}

export interface SendNewsletterResult {
  id: string
  queued: true
}

/**
 * Sends a newsletter to the live subscriber list.
 *
 * Ordering is load-bearing: the row is marked `sent` BEFORE the Firebase job
 * is queued. That is the double-send guard — a second caller sees `sent` and
 * refuses. Consequently a failure to queue must NOT revert the row, because
 * reverting risks two sends of the same newsletter.
 */
export async function sendNewsletterNow(args: {
  id: string
  actorId: string
}): Promise<SendNewsletterResult> {
  const newsletter = await getNewsletterById(args.id)

  if (newsletter.status === "sent") {
    throw new NewsletterNotSendableError("already_sent", "Newsletter has already been sent")
  }
  if (!newsletter.content || newsletter.content.length < 10) {
    throw new NewsletterNotSendableError("too_short", "Newsletter content is too short")
  }

  await updateNewsletter(args.id, {
    status: "sent",
    sent_at: new Date().toISOString(),
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  const html = buildNewsletterHtml(newsletter.content)

  const db = getAdminFirestore()
  await db.collection("ai_jobs").doc().set({
    type: "newsletter_send",
    status: "pending",
    input: { newsletterId: args.id, subject: newsletter.subject, html },
    result: null,
    error: null,
    userId: args.actorId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { id: args.id, queued: true }
}
```

- [ ] **Step 4: Make the route delegate, preserving its audit wrapper**

`app/api/admin/newsletter/[id]/send/route.ts` keeps its `withAudit({ action: "newsletter.sent", … })` wrapper and its auth guard; the body becomes:

```ts
    const { id } = await params
    try {
      await sendNewsletterNow({ id, actorId: session.user.id })
    } catch (err) {
      if (err instanceof NewsletterNotSendableError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }
    return NextResponse.json({ success: true })
```

Keep the outer `try/catch` that returns the 500. The two guards that used to be inline now live in `sendNewsletterNow`, and both still surface as 400s — same status codes as before.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run __tests__/lib/newsletter __tests__/api/newsletter`
Expected: PASS. Note the existing newsletter API tests — if any assert the old inline 400 messages, they should still pass because the messages were copied verbatim.

- [ ] **Step 6: Commit**

```bash
git add lib/newsletter/send-newsletter.ts "app/api/admin/newsletter/[id]/send/route.ts" __tests__/lib/newsletter/send-newsletter.test.ts
git commit -m "refactor(newsletter): one send path, and the double-send guard keeps its ordering"
```

---

## Task 5: The runner

**Files:**
- Create: `lib/content-schedule/run-due.ts`
- Modify: `lib/db/blog-posts.ts`, `lib/db/newsletters.ts` (add the two list functions)
- Test: `__tests__/lib/content-schedule/run-due.test.ts`

**Interfaces:**
- Consumes: `partitionDue`, `MISSED_GRACE_MS` (Task 2); `publishBlogPost` (Task 3); `sendNewsletterNow`, `NewsletterNotSendableError` (Task 4); `isCronSkipped` from `lib/db/system-settings.ts`
- Produces:
```ts
export interface RunContentScheduleResult {
  skipped?: "paused" | "disabled"
  considered: number
  published: number
  sent: number
  missed: number
  failed: number
}
export async function runContentSchedule(options?: { now?: Date }): Promise<RunContentScheduleResult>
```
- Also produces, in the DAL:
```ts
// lib/db/blog-posts.ts
export async function listScheduledBlogPosts(): Promise<BlogPost[]>
// lib/db/newsletters.ts
export async function listScheduledNewsletters(): Promise<Newsletter[]>
```

- [ ] **Step 1: Add the two DAL functions**

In `lib/db/blog-posts.ts`:

```ts
/** Rows the scheduled-content checker considers. Ordered oldest-first so a
 *  backlog fires in the order it was queued. */
export async function listScheduledBlogPosts(): Promise<BlogPost[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true })
  if (error) throw error
  return data as BlogPost[]
}
```

In `lib/db/newsletters.ts`, the same shape against `newsletters`:

```ts
/** Rows the scheduled-content checker considers. Ordered oldest-first. */
export async function listScheduledNewsletters(): Promise<Newsletter[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("newsletters")
    .select("*")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true })
  if (error) throw error
  return data as Newsletter[]
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/content-schedule/run-due.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const listScheduledBlogPostsMock = vi.fn()
const listScheduledNewslettersMock = vi.fn()
const updateBlogPostMock = vi.fn()
const updateNewsletterMock = vi.fn()
const publishBlogPostMock = vi.fn()
const sendNewsletterNowMock = vi.fn()
const isCronSkippedMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/db/blog-posts", () => ({
  listScheduledBlogPosts: () => listScheduledBlogPostsMock(),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/db/newsletters", () => ({
  listScheduledNewsletters: () => listScheduledNewslettersMock(),
  updateNewsletter: (id: string, u: unknown) => updateNewsletterMock(id, u),
}))
vi.mock("@/lib/blog/publish-post", () => ({ publishBlogPost: (a: unknown) => publishBlogPostMock(a) }))
vi.mock("@/lib/newsletter/send-newsletter", () => ({
  sendNewsletterNow: (a: unknown) => sendNewsletterNowMock(a),
  NewsletterNotSendableError: class extends Error {},
}))
vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (a: unknown) => isCronSkippedMock(a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }))

import { runContentSchedule } from "@/lib/content-schedule/run-due"

const NOW = new Date("2026-08-21T12:00:00.000Z")
const DUE = "2026-08-21T11:55:00.000Z"
const LONG_AGO = "2026-08-18T12:00:00.000Z"

describe("runContentSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCronSkippedMock.mockResolvedValue({ skipped: false })
    listScheduledBlogPostsMock.mockResolvedValue([])
    listScheduledNewslettersMock.mockResolvedValue([])
    publishBlogPostMock.mockResolvedValue({ id: "b1", slug: "s", published_at: NOW.toISOString() })
    sendNewsletterNowMock.mockResolvedValue({ id: "n1", queued: true })
  })

  it("does nothing at all when the flag is off — and does not mark anything missed", async () => {
    // Critical: a switched-off checker must not consume the backlog by
    // declaring it missed. The rows have to survive the flag being flipped on.
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    const out = await runContentSchedule({ now: NOW })
    expect(out.skipped).toBe("disabled")
    expect(listScheduledBlogPostsMock).not.toHaveBeenCalled()
    expect(listScheduledNewslettersMock).not.toHaveBeenCalled()
    expect(updateBlogPostMock).not.toHaveBeenCalled()
  })

  it("publishes a due blog post through the shared publish path", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: DUE, author_id: "author-1" }])
    const out = await runContentSchedule({ now: NOW })
    expect(publishBlogPostMock).toHaveBeenCalledWith({ id: "b1", actorId: "author-1" })
    expect(out.published).toBe(1)
    expect(out.considered).toBe(1)
  })

  it("sends a due newsletter through the shared send path", async () => {
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: DUE, author_id: "author-2" }])
    const out = await runContentSchedule({ now: NOW })
    expect(sendNewsletterNowMock).toHaveBeenCalledWith({ id: "n1", actorId: "author-2" })
    expect(out.sent).toBe(1)
  })

  it("leaves a not-yet-due item alone", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([
      { id: "b1", scheduled_at: "2026-08-21T18:00:00.000Z", author_id: "a" },
    ])
    const out = await runContentSchedule({ now: NOW })
    expect(publishBlogPostMock).not.toHaveBeenCalled()
    expect(out.published).toBe(0)
    expect(out.missed).toBe(0)
  })

  it("returns a long-overdue post to draft with a reason instead of publishing it", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: LONG_AGO, author_id: "a" }])
    const out = await runContentSchedule({ now: NOW })
    expect(publishBlogPostMock).not.toHaveBeenCalled()
    expect(out.missed).toBe(1)
    const [id, updates] = updateBlogPostMock.mock.calls[0]
    expect(id).toBe("b1")
    expect(updates.status).toBe("draft")
    expect(updates.scheduled_at).toBeNull()
    expect(updates.schedule_failed_reason).toMatch(/missed/i)
  })

  it("returns a long-overdue newsletter to draft rather than surprising subscribers", async () => {
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: LONG_AGO, author_id: "a" }])
    const out = await runContentSchedule({ now: NOW })
    expect(sendNewsletterNowMock).not.toHaveBeenCalled()
    expect(out.missed).toBe(1)
    expect(updateNewsletterMock.mock.calls[0][1].status).toBe("draft")
  })

  it("isolates a failure — one bad item does not stop the rest of the batch", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([
      { id: "b1", scheduled_at: DUE, author_id: "a" },
      { id: "b2", scheduled_at: DUE, author_id: "a" },
    ])
    publishBlogPostMock.mockRejectedValueOnce(new Error("boom"))
    const out = await runContentSchedule({ now: NOW })
    expect(out.failed).toBe(1)
    expect(out.published).toBe(1)
  })

  it("returns a failed post to draft with the error as its reason", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: DUE, author_id: "a" }])
    publishBlogPostMock.mockRejectedValue(new Error("supabase unreachable"))
    await runContentSchedule({ now: NOW })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("draft")
    expect(updates.schedule_failed_reason).toMatch(/supabase unreachable/)
  })

  it("does NOT revert a newsletter whose send threw after the row was marked sent", async () => {
    // sendNewsletterNow marks sent before queuing. If the queue throws, the
    // row may already say sent — reverting it to draft would risk a second
    // send of the same newsletter to the whole list.
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: DUE, author_id: "a" }])
    sendNewsletterNowMock.mockRejectedValue(new Error("firestore down"))
    const out = await runContentSchedule({ now: NOW })
    expect(out.failed).toBe(1)
    expect(updateNewsletterMock).not.toHaveBeenCalled()
  })

  it("counts both kinds in one run", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: DUE, author_id: "a" }])
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: DUE, author_id: "a" }])
    const out = await runContentSchedule({ now: NOW })
    expect(out).toMatchObject({ considered: 2, published: 1, sent: 1, missed: 0, failed: 0 })
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run __tests__/lib/content-schedule/run-due.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/content-schedule/run-due.ts`:

```ts
// lib/content-schedule/run-due.ts
// Drives scheduled blog posts and newsletters. Called by
// /api/admin/internal/content-schedule-due every five minutes.
//
// Deliberately thin: partitionDue() decides WHAT fires, publishBlogPost() and
// sendNewsletterNow() decide WHAT HAPPENS. This file only orchestrates and
// records outcomes.

import { listScheduledBlogPosts, updateBlogPost } from "@/lib/db/blog-posts"
import { listScheduledNewsletters, updateNewsletter } from "@/lib/db/newsletters"
import { publishBlogPost } from "@/lib/blog/publish-post"
import { sendNewsletterNow } from "@/lib/newsletter/send-newsletter"
import { isCronSkipped } from "@/lib/db/system-settings"
import { recordAudit } from "@/lib/audit/record"
import { partitionDue } from "@/lib/content-schedule/due"

export const CONTENT_SCHEDULE_FLAG = "cron_content_schedule_enabled"

export interface RunContentScheduleResult {
  skipped?: "paused" | "disabled"
  considered: number
  published: number
  sent: number
  missed: number
  failed: number
}

const CRON_ACTOR = { id: null, email: null, role: "system" as const }

export async function runContentSchedule(
  options: { now?: Date } = {},
): Promise<RunContentScheduleResult> {
  const now = options.now ?? new Date()

  // Checked BEFORE reading a single row. A switched-off checker must not
  // consume the backlog by declaring it missed — the rows have to survive the
  // flag being flipped back on.
  const gate = await isCronSkipped({ enabledKey: CONTENT_SCHEDULE_FLAG, defaultEnabled: true })
  if (gate.skipped) {
    return { skipped: gate.reason, considered: 0, published: 0, sent: 0, missed: 0, failed: 0 }
  }

  const [posts, newsletters] = await Promise.all([
    listScheduledBlogPosts(),
    listScheduledNewsletters(),
  ])

  const postParts = partitionDue(posts, now)
  const newsletterParts = partitionDue(newsletters, now)

  let published = 0
  let sent = 0
  let missed = 0
  let failed = 0

  for (const post of postParts.fire) {
    try {
      await publishBlogPost({ id: post.id, actorId: post.author_id })
      published++
      await recordAudit({
        action: "blog.published_on_schedule",
        category: "marketing",
        target: { type: "blog_post", id: post.id },
        actor: CRON_ACTOR,
        metadata: { scheduled_at: post.scheduled_at },
      })
    } catch (err) {
      failed++
      await failPost(post.id, (err as Error).message)
    }
  }

  for (const newsletter of newsletterParts.fire) {
    try {
      await sendNewsletterNow({ id: newsletter.id, actorId: newsletter.author_id })
      sent++
      await recordAudit({
        action: "newsletter.sent_on_schedule",
        category: "marketing",
        target: { type: "newsletter", id: newsletter.id },
        actor: CRON_ACTOR,
        metadata: { scheduled_at: newsletter.scheduled_at },
      })
    } catch (err) {
      failed++
      // Deliberately NOT reverted to draft. sendNewsletterNow marks the row
      // sent before queuing, so a throw may land after the mark — reverting
      // would risk a second send to the entire list. Record it loudly instead.
      console.error(`[content-schedule] newsletter ${newsletter.id} send failed:`, err)
      await recordAudit({
        action: "content.schedule_missed",
        category: "marketing",
        outcome: "failure",
        target: { type: "newsletter", id: newsletter.id },
        actor: CRON_ACTOR,
        error: { message: (err as Error).message },
        metadata: { not_reverted: true, reason: "send may have been queued before the throw" },
      })
    }
  }

  for (const { row, reason } of postParts.missed) {
    missed++
    await failPost(row.id, reason)
  }

  for (const { row, reason } of newsletterParts.missed) {
    missed++
    await updateNewsletter(row.id, {
      status: "draft",
      scheduled_at: null,
      schedule_failed_reason: reason,
    })
    await recordAudit({
      action: "content.schedule_missed",
      category: "marketing",
      target: { type: "newsletter", id: row.id },
      actor: CRON_ACTOR,
      metadata: { reason },
    })
  }

  return {
    considered: posts.length + newsletters.length,
    published,
    sent,
    missed,
    failed,
  }
}

async function failPost(id: string, reason: string): Promise<void> {
  await updateBlogPost(id, {
    status: "draft",
    scheduled_at: null,
    schedule_failed_reason: reason,
  })
  await recordAudit({
    action: "content.schedule_missed",
    category: "marketing",
    target: { type: "blog_post", id },
    actor: CRON_ACTOR,
    metadata: { reason },
  })
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/lib/content-schedule/run-due.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/content-schedule/run-due.ts lib/db/blog-posts.ts lib/db/newsletters.ts __tests__/lib/content-schedule/run-due.test.ts
git commit -m "feat(content-schedule): the checker fires what is due and refuses what is stale"
```

---

## Task 6: The cron endpoint and the scheduled function

**Files:**
- Create: `app/api/admin/internal/content-schedule-due/route.ts`
- Modify: `functions/src/index.ts` (new export near `publishDuePostsCron` at ~line 1167)
- Modify: `lib/cron-catalog.ts`
- Modify: `lib/automation/automation-health-scanner.ts`
- Test: `__tests__/api/admin/internal/content-schedule-due.test.ts`

**Interfaces:**
- Consumes: `runContentSchedule` (Task 5)
- Produces: `POST /api/admin/internal/content-schedule-due` returning `{ ok: true, ...RunContentScheduleResult }`; Firebase export `contentScheduleCron`; `CronJobName` gains `"content-schedule"`.

- [ ] **Step 1: Write the failing route test**

Create `__tests__/api/admin/internal/content-schedule-due.test.ts`. Match the idiom of the sibling `__tests__/api/admin/internal/sequence-tick.test.ts`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const runContentScheduleMock = vi.fn()
vi.mock("@/lib/content-schedule/run-due", () => ({
  runContentSchedule: (o: unknown) => runContentScheduleMock(o),
}))

import { POST } from "@/app/api/admin/internal/content-schedule-due/route"

function req(auth?: string) {
  return new Request("http://localhost/api/admin/internal/content-schedule-due", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  }) as unknown as Parameters<typeof POST>[0]
}

describe("POST /api/admin/internal/content-schedule-due", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_CRON_TOKEN = "secret"
    runContentScheduleMock.mockResolvedValue({ considered: 0, published: 0, sent: 0, missed: 0, failed: 0 })
  })

  it("rejects a request with no bearer token", async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(runContentScheduleMock).not.toHaveBeenCalled()
  })

  it("rejects a wrong bearer token", async () => {
    const res = await POST(req("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("rejects everything when the server has no token configured", async () => {
    // Otherwise an unset env var makes `Bearer ` match and the endpoint opens.
    delete process.env.INTERNAL_CRON_TOKEN
    const res = await POST(req("Bearer "))
    expect(res.status).toBe(401)
    expect(runContentScheduleMock).not.toHaveBeenCalled()
  })

  it("runs the checker for a valid token and returns its counts", async () => {
    runContentScheduleMock.mockResolvedValue({ considered: 3, published: 1, sent: 1, missed: 1, failed: 0 })
    const res = await POST(req("Bearer secret"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, considered: 3, published: 1, sent: 1, missed: 1, failed: 0 })
  })

  it("returns 500 with the message when the checker throws", async () => {
    runContentScheduleMock.mockRejectedValue(new Error("db down"))
    const res = await POST(req("Bearer secret"))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db down/)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/api/admin/internal/content-schedule-due.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/internal/content-schedule-due/route.ts`, mirroring `app/api/admin/internal/publish-due/route.ts`:

```ts
// app/api/admin/internal/content-schedule-due/route.ts
// Cron endpoint hit by contentScheduleCron every 5 minutes. Guarded by the
// shared bearer token (INTERNAL_CRON_TOKEN). Delegates to runContentSchedule().

import { NextRequest, NextResponse } from "next/server"
import { runContentSchedule } from "@/lib/content-schedule/run-due"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runContentSchedule()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[content-schedule-due] Error:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "Unknown content-schedule error" },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
```

- [ ] **Step 4: Add the Firebase cron**

In `functions/src/index.ts`, directly after the `publishDuePostsCron` block (~line 1195), add:

```ts
// ─── Content Schedule (every 5 min) ──────────────────────────────────────────
// Publishes blog posts and sends newsletters whose scheduled_at has arrived.
// Sibling of publishDuePostsCron, which does the same for social posts.

export const contentScheduleCron = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[contentScheduleCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/content-schedule-due`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      console.log("[contentScheduleCron]", res.status, body)
    } catch (err) {
      console.error("[contentScheduleCron] failed:", err)
    }
  },
)
```

- [ ] **Step 5: Register in the cron catalog**

In `lib/cron-catalog.ts`, add `"content-schedule"` to the `CronJobName` union, and this entry to `CRON_CATALOG`. The description is read by non-technical users on `/admin/automation` — no jargon:

```ts
  {
    name: "content-schedule",
    label: "Scheduled posts and newsletters",
    description:
      "Every five minutes, checks whether any blog post or newsletter you scheduled has reached its time — and publishes or sends it for you. If one is more than a day overdue (for example the site was down), it is put back to draft and flagged instead of going out late.",
    schedule: "*/5 * * * *",
    timezone: "UTC",
    humanSchedule: "Every 5 minutes",
    firebaseFunction: "contentScheduleCron",
    phase: "content",
    enabledKey: "cron_content_schedule_enabled",
    defaultEnabled: true,
  },
```

- [ ] **Step 6: Register in the health watchdog**

In `lib/automation/automation-health-scanner.ts`, add to `EXPECTED_CRONS` in the "call logCronStart" group. Replace `<TODAY>` with the actual date you run this (`date -u +%F`):

```ts
  {
    name: "contentScheduleCron", // every 5 min
    sla_hours: 1,                // matches publishDuePostsCron and sequenceTickCron
    reports_to_cron_runs: true,
    watch_from: "<TODAY>",
    enabled_flag: "cron_content_schedule_enabled",
    enabled_flag_default: true, // a silent scheduler is worse than a dormant one
  },
```

- [ ] **Step 7: Wire cron_runs logging into the route**

Because the entry above claims `reports_to_cron_runs: true`, the route must actually write those rows or the watchdog will report it as never having succeeded. In `app/api/admin/internal/content-schedule-due/route.ts`, wrap the run:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
// …
  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "contentScheduleCron")
  try {
    const result = await runContentSchedule()
    await logCronEnd(supabase, runId, "success", result as Record<string, unknown>)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    await logCronEnd(supabase, runId, "failed", { message: (error as Error).message })
    console.error("[content-schedule-due] Error:", error)
    return NextResponse.json({ error: (error as Error).message ?? "Unknown content-schedule error" }, { status: 500 })
  }
```

Add a mock for `@/lib/db/cron-runs` and `@/lib/supabase` to the route test so it still passes.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run __tests__/api/admin/internal/content-schedule-due.test.ts __tests__/lib/automation/automation-health-scanner.test.ts __tests__/api/admin/automation/toggle-cron.test.ts`
Expected: PASS.

Note: `__tests__/lib/feature-flag-catalog.test.ts` covers `FEATURE_FLAG_CATALOG` (`feature_*` keys) and is **not** the right suite here — cron flags live in `CRON_CATALOG`. The two suites above are the ones that read cron entries. `toggle-cron.test.ts` in particular may enumerate `CRON_CATALOG`; if it fails, the new entry disagrees with the migration's flag key. Fix the code, not the test.

- [ ] **Step 8b: Assert the catalog and the runner agree on the flag key**

Add this to the route test file. A catalog entry whose key is a typo renders a
toggle that flips a row nothing reads — a switch that appears to work and
changes nothing:

```ts
import { CRON_CATALOG } from "@/lib/cron-catalog"
import { CONTENT_SCHEDULE_FLAG } from "@/lib/content-schedule/run-due"

it("catalogs the cron under the exact key the runner reads", () => {
  const entry = CRON_CATALOG.find((c) => c.name === "content-schedule")
  expect(entry).toBeDefined()
  expect(entry?.enabledKey).toBe(CONTENT_SCHEDULE_FLAG)   // never a copied string
  expect(entry?.defaultEnabled).toBe(true)
  expect(entry?.firebaseFunction).toBe("contentScheduleCron")
})
```

- [ ] **Step 9: Typecheck the functions package separately**

`functions/` has its own tsconfig and cannot import from `lib/`.

Run: `cd functions && npx tsc --noEmit; cd ..`
Expected: no new errors. The new cron uses only `onSchedule`, `fetch`, and the two existing secrets — no `lib/` import.

- [ ] **Step 10: Commit**

```bash
git add app/api/admin/internal/content-schedule-due functions/src/index.ts lib/cron-catalog.ts lib/automation/automation-health-scanner.ts __tests__/api/admin/internal/content-schedule-due.test.ts
git commit -m "feat(content-schedule): a five-minute heartbeat, watched so its silence is loud"
```

---

## Task 7: The four schedule routes

**Files:**
- Create: `app/api/admin/blog/[id]/schedule/route.ts`, `app/api/admin/blog/[id]/unschedule/route.ts`, `app/api/admin/newsletter/[id]/schedule/route.ts`, `app/api/admin/newsletter/[id]/unschedule/route.ts`
- Create: `lib/content-schedule/validate.ts`
- Modify: `lib/audit/actions.ts`, `app/api/admin/blog/route.ts:56-62`
- Test: `__tests__/api/admin/content-schedule-routes.test.ts`

**Interfaces:**
- Consumes: `CONTENT_SCHEDULE_FLAG` (Task 5), `getSetting` from `lib/db/system-settings.ts`
- Produces:
```ts
// lib/content-schedule/validate.ts
export type ScheduleRejection = { status: 400 | 409; error: string }
export async function validateScheduleRequest(raw: unknown):
  Promise<{ ok: true; scheduledAt: Date } | { ok: false } & ScheduleRejection>
```

- [ ] **Step 1: Add the audit slugs**

In `lib/audit/actions.ts`, in the `// marketing — public / outbound` block, after `newsletter.sent`:

```ts
  { slug: "blog.scheduled", category: "marketing", description: "Blog post scheduled to publish later" },
  { slug: "blog.schedule_cancelled", category: "marketing", description: "Blog post schedule cancelled" },
  { slug: "blog.published_on_schedule", category: "marketing", description: "Blog post published by the scheduler" },
  { slug: "newsletter.scheduled", category: "marketing", description: "Newsletter scheduled to send later" },
  { slug: "newsletter.schedule_cancelled", category: "marketing", description: "Newsletter schedule cancelled" },
  { slug: "newsletter.sent_on_schedule", category: "marketing", description: "Newsletter sent by the scheduler" },
  { slug: "content.schedule_missed", category: "marketing", description: "Scheduled item missed its slot and returned to draft" },
```

- [ ] **Step 2: Write the shared validator**

Create `lib/content-schedule/validate.ts`:

```ts
// lib/content-schedule/validate.ts
// Shared request validation for the four schedule routes. Kept out of the
// route files so all four reject identically.

import { getSetting } from "@/lib/db/system-settings"
import { CONTENT_SCHEDULE_FLAG } from "@/lib/content-schedule/run-due"

export type ScheduleRejection = { status: 400 | 409; error: string }

export async function validateScheduleRequest(
  raw: unknown,
): Promise<{ ok: true; scheduledAt: Date } | ({ ok: false } & ScheduleRejection)> {
  // Refuse while the checker is off. Without this the UI would accept a time
  // that nothing will ever act on — the exact failure the flag default is
  // meant to prevent.
  const enabled = await getSetting<boolean>(CONTENT_SCHEDULE_FLAG, true)
  if (!enabled) {
    return {
      ok: false,
      status: 409,
      error:
        "Scheduling is switched off right now, so this would never go out. Turn on “Scheduled posts and newsletters” on the Automation page first.",
    }
  }

  const value = (raw as { scheduled_at?: string } | null)?.scheduled_at?.trim()
  if (!value) {
    return { ok: false, status: 400, error: "Pick a date and time first." }
  }

  const scheduledAt = new Date(value)
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, status: 400, error: "That date and time could not be read." }
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return { ok: false, status: 400, error: "Pick a time in the future." }
  }

  return { ok: true, scheduledAt }
}
```

- [ ] **Step 3: Write the failing route tests**

Create `__tests__/api/admin/content-schedule-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessAdminPathMock = vi.fn()
const getSettingMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const getNewsletterByIdMock = vi.fn()
const updateNewsletterMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (u: unknown) => canAccessAdminPathMock(u) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (k: string, d: unknown) => getSettingMock(k, d) }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/db/newsletters", () => ({
  getNewsletterById: (id: string) => getNewsletterByIdMock(id),
  updateNewsletter: (id: string, u: unknown) => updateNewsletterMock(id, u),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }))

import { POST as scheduleBlog } from "@/app/api/admin/blog/[id]/schedule/route"
import { POST as unscheduleBlog } from "@/app/api/admin/blog/[id]/unschedule/route"
import { POST as scheduleNewsletter } from "@/app/api/admin/newsletter/[id]/schedule/route"

const FUTURE = new Date(Date.now() + 3_600_000).toISOString()
const PAST = new Date(Date.now() - 3_600_000).toISOString()
const params = { params: Promise.resolve({ id: "x1" }) }

function req(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }) as never
}

describe("content schedule routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    canAccessAdminPathMock.mockResolvedValue(true)
    getSettingMock.mockResolvedValue(true)
    getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "draft" })
    updateBlogPostMock.mockImplementation((id, u) => Promise.resolve({ id, ...u }))
    getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "draft", content: "x".repeat(50) })
    updateNewsletterMock.mockImplementation((id, u) => Promise.resolve({ id, ...u }))
  })

  it("rejects a signed-out caller", async () => {
    authMock.mockResolvedValue(null)
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(401)
  })

  it("rejects a non-admin caller", async () => {
    canAccessAdminPathMock.mockResolvedValue(false)
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(401)
  })

  it("rejects a time in the past", async () => {
    const res = await scheduleBlog(req({ scheduled_at: PAST }), params)
    expect(res.status).toBe(400)
  })

  it("rejects an unreadable time", async () => {
    const res = await scheduleBlog(req({ scheduled_at: "next tuesday-ish" }), params)
    expect(res.status).toBe(400)
  })

  it("rejects with a readable message while the checker is switched off", async () => {
    getSettingMock.mockResolvedValue(false)
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/switched off/i)
  })

  it("refuses to schedule a post that is already published", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "published" })
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(409)
  })

  it("arms a draft post and records an audit row", async () => {
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(200)
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("scheduled")
    expect(updates.scheduled_at).toBe(new Date(FUTURE).toISOString())
    expect(updates.schedule_failed_reason).toBeNull()
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "blog.scheduled" }))
  })

  it("unschedules back to draft and clears the time", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "scheduled" })
    const res = await unscheduleBlog(req({}), params)
    expect(res.status).toBe(200)
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("draft")
    expect(updates.scheduled_at).toBeNull()
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "blog.schedule_cancelled" }),
    )
  })

  it("refuses to schedule a newsletter whose body is too short — at schedule time, not at 7am", async () => {
    getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "draft", content: "hi" })
    const res = await scheduleNewsletter(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too short|more text/i)
  })

  it("refuses to schedule a newsletter that was already sent", async () => {
    getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "sent", content: "x".repeat(50) })
    const res = await scheduleNewsletter(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(409)
  })

  it("arms a draft newsletter", async () => {
    const res = await scheduleNewsletter(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(200)
    expect(updateNewsletterMock.mock.calls[0][1].status).toBe("scheduled")
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "newsletter.scheduled" }))
  })
})
```

- [ ] **Step 4: Run and confirm failure**

Run: `npx vitest run __tests__/api/admin/content-schedule-routes.test.ts`
Expected: FAIL — the four route modules don't exist.

- [ ] **Step 5: Implement the blog schedule route**

Create `app/api/admin/blog/[id]/schedule/route.ts`:

```ts
// app/api/admin/blog/[id]/schedule/route.ts
// POST { scheduled_at: ISO } — arms a post for automatic publishing.
// The contentScheduleCron picks it up when scheduled_at <= now.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { validateScheduleRequest } from "@/lib/content-schedule/validate"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const validated = await validateScheduleRequest(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status })
  }

  const { id } = await params
  const post = await getBlogPostById(id)
  if (post.status === "published") {
    return NextResponse.json(
      { error: "This post is already live. Unpublish it first if you want to schedule it." },
      { status: 409 },
    )
  }

  const updated = await updateBlogPost(id, {
    status: "scheduled",
    scheduled_at: validated.scheduledAt.toISOString(),
    schedule_failed_reason: null,
  })

  await recordAudit({
    action: "blog.scheduled",
    category: "marketing",
    target: { type: "blog_post", id },
    request,
    metadata: { scheduled_at: validated.scheduledAt.toISOString() },
  })

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    scheduled_at: updated.scheduled_at,
  })
}
```

- [ ] **Step 6: Implement the blog unschedule route**

Create `app/api/admin/blog/[id]/unschedule/route.ts`:

```ts
// app/api/admin/blog/[id]/unschedule/route.ts
// POST — takes a scheduled post back to draft and clears its time.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getBlogPostById(id)
  if (post.status !== "scheduled") {
    return NextResponse.json({ error: "That post is not scheduled." }, { status: 409 })
  }

  const updated = await updateBlogPost(id, {
    status: "draft",
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  await recordAudit({
    action: "blog.schedule_cancelled",
    category: "marketing",
    target: { type: "blog_post", id },
    request,
  })

  return NextResponse.json({ id: updated.id, status: updated.status, scheduled_at: null })
}
```

- [ ] **Step 7: Implement the two newsletter routes**

`app/api/admin/newsletter/[id]/schedule/route.ts` is the blog schedule route with these differences: it reads `getNewsletterById` / `updateNewsletter`, refuses `status === "sent"` with 409 (`"This newsletter has already gone out."`), audits `newsletter.scheduled`, and adds the content check **before** arming:

```ts
  if (!newsletter.content || newsletter.content.length < 10) {
    return NextResponse.json(
      { error: "This newsletter needs more text before it can be scheduled." },
      { status: 400 },
    )
  }
```

`app/api/admin/newsletter/[id]/unschedule/route.ts` is the blog unschedule route with `getNewsletterById` / `updateNewsletter` and the `newsletter.schedule_cancelled` slug.

- [ ] **Step 8: Fix the create route's published_at stamping**

`app/api/admin/blog/route.ts:56-62` currently stamps `published_at` from a binary. A post created directly as `scheduled` must not get a `published_at`:

```ts
      const status = (body.status as BlogPostStatus) ?? "draft"
      // …
        published_at: status === "published" ? new Date().toISOString() : null,
```

This line is already correct for the new value (`scheduled` → `null`). **Verify by reading, then leave it alone** — and note in the commit that it was checked.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run __tests__/api/admin/content-schedule-routes.test.ts __tests__/lib/audit`
Expected: PASS, 12 route tests. The audit suite may have a test asserting every recorded slug exists in `AUDIT_ACTIONS` — if it fails, a slug is misspelled.

- [ ] **Step 10: Commit**

```bash
git add "app/api/admin/blog/[id]/schedule" "app/api/admin/blog/[id]/unschedule" "app/api/admin/newsletter/[id]/schedule" "app/api/admin/newsletter/[id]/unschedule" lib/content-schedule/validate.ts lib/audit/actions.ts __tests__/api/admin/content-schedule-routes.test.ts
git commit -m "feat(content-schedule): four routes that refuse a time nothing would honour"
```

---

## Task 8: The reader audit

This is the task that stops a scheduled newsletter from wearing a Draft badge. Every item here is a real defect introduced by Task 1's enum widening.

**Files:**
- Modify: `components/admin/blog/BlogPostList.tsx`, `components/admin/newsletter/NewsletterList.tsx`
- Modify: `app/(admin)/admin/blog/page.tsx`, `app/(admin)/admin/newsletter/page.tsx`
- Modify: `lib/analytics/daily-pulse.ts`
- Create: `components/admin/shared/SchedulePicker.tsx`
- Test: `__tests__/components/content-schedule-lists.test.tsx`, `__tests__/lib/analytics/daily-pulse-scheduled.test.ts`

**Interfaces:**
- Consumes: widened types (Task 1), the four routes (Task 7)
- Produces:
```tsx
export function SchedulePicker(props: {
  open: boolean
  title: string
  initial?: string | null
  busy?: boolean
  onConfirm: (isoUtc: string) => void | Promise<void>
  onCancel: () => void
}): React.ReactElement | null
```

- [ ] **Step 1: Build the shared picker**

Create `components/admin/shared/SchedulePicker.tsx`. The conversion is deliberately the same as `TimePickerPopover`: a `datetime-local` value is browser-local, `new Date(value).toISOString()` turns it into UTC.

```tsx
"use client"

import { useState, useEffect } from "react"

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Default: tomorrow at 07:00 local — the coach's usual publishing hour. */
function defaultWhen(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(7, 0, 0, 0)
  return d
}

export function SchedulePicker({
  open,
  title,
  initial,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  initial?: string | null
  busy?: boolean
  onConfirm: (isoUtc: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(() => toLocalInputValue(initial ? new Date(initial) : defaultWhen()))

  useEffect(() => {
    if (open) setValue(toLocalInputValue(initial ? new Date(initial) : defaultWhen()))
  }, [open, initial])

  if (!open) return null

  const parsed = new Date(value)
  const invalid = Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="rounded-xl bg-white border border-border shadow-lg p-4 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-sm text-primary mb-2">{title}</h3>
        <label className="block text-xs text-muted-foreground">
          Date and time
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          This is your own local time. {invalid ? "Pick a time in the future." : ""}
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(parsed.toISOString())}
            disabled={busy || invalid}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the failing list tests**

Create `__tests__/components/content-schedule-lists.test.tsx`. Look at a sibling in `__tests__/components/` for the render idiom.

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NewsletterList } from "@/components/admin/newsletter/NewsletterList"
import { BlogPostList } from "@/components/admin/blog/BlogPostList"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const baseNewsletter = {
  id: "n1", subject: "August round-up", preview_text: "", content: "x".repeat(50),
  sent_at: null, sent_count: 0, failed_count: 0, source_blog_post_id: null,
  author_id: "a", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
  schedule_failed_reason: null,
}

const basePost = {
  id: "b1", title: "Off-season speed work", slug: "speed", excerpt: "", content: "",
  category: "Performance", cover_image_url: null, tags: [], meta_description: null,
  author_id: "a", published_at: null, created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z", source_video_id: null, seo_metadata: {},
  tavily_research: null, fact_check_status: null, fact_check_details: null,
  inline_images: [], primary_keyword: null, secondary_keywords: [], search_intent: null,
  faq: [], subcategory: null, last_refreshed_at: null, refresh_count: 0,
  schedule_failed_reason: null,
}

describe("scheduled items in the admin lists", () => {
  it("shows a scheduled newsletter as Scheduled, NOT as Draft", () => {
    // The bug this pins: every reader was `status === "sent" ? "Sent" : "Draft"`,
    // so a third value silently rendered as Draft.
    render(<NewsletterList newsletters={[{ ...baseNewsletter, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" }] as never} />)
    expect(screen.getByText("Scheduled")).toBeTruthy()
    expect(screen.queryByText("Draft")).toBeNull()
  })

  it("shows a scheduled blog post as Scheduled, NOT as Draft", () => {
    render(<BlogPostList posts={[{ ...basePost, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" }] as never} />)
    expect(screen.getByText("Scheduled")).toBeTruthy()
  })

  it("offers a Scheduled tab in both lists", () => {
    render(<NewsletterList newsletters={[] as never} />)
    expect(screen.getByRole("button", { name: "Scheduled" })).toBeTruthy()
  })

  it("shows a missed item as needing attention, with its reason", () => {
    render(
      <BlogPostList
        posts={[{ ...basePost, status: "draft", scheduled_at: null, schedule_failed_reason: "Missed its slot — pick a new time." }] as never}
      />,
    )
    expect(screen.getByText(/missed its slot/i)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run __tests__/components/content-schedule-lists.test.tsx`
Expected: FAIL — "Scheduled" is not rendered; the badge says "Draft".

- [ ] **Step 4: Fix NewsletterList**

Three changes in `components/admin/newsletter/NewsletterList.tsx`:

1. Tabs (line ~24): `const statusTabs = ["All", "Draft", "Scheduled", "Sent"] as const`
2. Filter (line ~34): add `if (tab === "Scheduled" && n.status !== "scheduled") return false`
3. Replace the hand-rolled pill span (lines ~143-149) with `DataTableBadge` — this also brings the file onto the house standard:

```tsx
<DataTableBadge
  tone={nl.status === "sent" ? "success" : nl.status === "scheduled" ? "info" : "warning"}
>
  {nl.status === "sent" ? "Sent" : nl.status === "scheduled" ? "Scheduled" : "Draft"}
</DataTableBadge>
```

4. In the Date cell, show the queued time for a scheduled row: `nl.status === "scheduled" ? formatDateTime(nl.scheduled_at) : formatDate(nl.sent_at ?? nl.created_at)`. Add a `formatDateTime` helper beside the existing `formatDate` that includes hour and minute.
5. Show a missed reason when `schedule_failed_reason` is set and the row is a draft — a `danger` badge reading "Missed" plus the reason text in the subject cell.
6. Add `DataTableBadge` to the import from `@/components/ui/data-table`.

- [ ] **Step 5: Fix BlogPostList**

The same five changes in `components/admin/blog/BlogPostList.tsx`, with `published`/`Published` in place of `sent`/`Sent`, plus the `Schedule` row action described in Step 7.

- [ ] **Step 6: Fix both stat rows**

`app/(admin)/admin/blog/page.tsx` — add a scheduled count and stop the drafts tile swallowing it:

```tsx
  const published = posts.filter((p) => p.status === "published").length
  const scheduled = posts.filter((p) => p.status === "scheduled").length
  const drafts = posts.filter((p) => p.status === "draft").length
```

Change the grid from `grid-cols-3` to `grid-cols-2 sm:grid-cols-4` and add a Scheduled tile using the `CalendarClock` icon from lucide, `bg-primary/10` / `text-primary`, matching the existing tiles' markup exactly.

`app/(admin)/admin/newsletter/page.tsx` — same, adding `scheduled` alongside `sent` and `drafts`. That grid is already `grid-cols-2 sm:grid-cols-4`; make it `sm:grid-cols-5`.

- [ ] **Step 7: Add the Schedule row action**

In both lists, add a `CalendarClock` button next to Edit for a row that is `draft`, opening `SchedulePicker`. For a `scheduled` row, show an `X` button that POSTs to the unschedule route. Wire both with the existing `toast` + `router.refresh()` idiom already in the file:

```tsx
async function handleSchedule(id: string, iso: string) {
  const res = await fetch(`/api/admin/blog/${id}/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduled_at: iso }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    toast.error(body.error ?? "Could not schedule this post")
    return
  }
  toast.success(`Scheduled for ${new Date(iso).toLocaleString()}`)
  setSchedulingId(null)
  router.refresh()
}
```

(The newsletter version differs only in the URL and the toast wording.)

- [ ] **Step 8: Fix the Daily Pulse**

`lib/analytics/daily-pulse.ts:118` — `blogsInDraft` must stop counting scheduled posts, and a missed item needs to surface. Add to `DailyContentPipelinePayload` and to the builder:

```ts
  const blogsInDraft = blogs.filter((b) => b.status === "draft" && !b.schedule_failed_reason).length
  const blogsScheduled = blogs.filter((b) => b.status === "scheduled").length
  const contentMissedSlot = blogs.filter((b) => Boolean(b.schedule_failed_reason)).length
```

Return all three. Update the payload interface and whichever email/report template renders it — grep for `blogsInDraft` and follow every reader.

- [ ] **Step 9: Write the daily-pulse test**

Create `__tests__/lib/analytics/daily-pulse-scheduled.test.ts` asserting a `scheduled` post is NOT counted in `blogsInDraft`, IS counted in `blogsScheduled`, and that a draft carrying `schedule_failed_reason` is counted in `contentMissedSlot` and excluded from `blogsInDraft`. Follow the existing daily-pulse test's construction idiom for the three input arrays.

- [ ] **Step 10: Run everything for this task**

Run: `npx vitest run __tests__/components/content-schedule-lists.test.tsx __tests__/lib/analytics`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add components/admin app/\(admin\)/admin/blog/page.tsx app/\(admin\)/admin/newsletter/page.tsx lib/analytics/daily-pulse.ts __tests__/components/content-schedule-lists.test.tsx __tests__/lib/analytics/daily-pulse-scheduled.test.ts
git commit -m "fix(content-schedule): a queued newsletter stops wearing a draft's badge"
```

---

## Task 9: The editors

**Files:**
- Modify: `components/admin/blog/BlogPostForm.tsx`, `components/admin/newsletter/NewsletterForm.tsx`
- Test: `__tests__/components/content-schedule-editors.test.tsx`

**Interfaces:**
- Consumes: `SchedulePicker` (Task 8), the four routes (Task 7)
- Produces: nothing consumed downstream

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/content-schedule-editors.test.tsx` asserting:
- an editor for a `scheduled` item renders a banner naming the queued time
- that banner offers "Cancel schedule"
- an editor for a `draft` item renders a "Schedule" button beside Publish/Send
- an editor for a `sent` newsletter renders **neither** (it is immutable)

Use the same render idiom and fixture shapes as Task 8's test.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run __tests__/components/content-schedule-editors.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the armed banner**

In both forms, above the editing surface, when `status === "scheduled"`:

```tsx
{isScheduled && (
  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
    <p className="text-sm text-primary">
      Scheduled to go out on{" "}
      <span className="font-medium">{new Date(scheduledAt).toLocaleString()}</span>. Edits you save
      here will be included.
    </p>
    <button type="button" onClick={handleCancelSchedule} className="text-xs text-muted-foreground hover:text-primary underline">
      Cancel schedule
    </button>
  </div>
)}
```

The second sentence is the point: it tells the coach the schedule survives the edit, which is the decision recorded in spec §8.1.

- [ ] **Step 4: Add the Schedule button**

Beside the existing Publish (blog) / Send (newsletter) button, for a `draft` item, a secondary "Schedule" button opening `SchedulePicker`. Reuse the same `handleSchedule` shape as Task 8 Step 7.

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/components/content-schedule-editors.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/admin/blog/BlogPostForm.tsx components/admin/newsletter/NewsletterForm.tsx __tests__/components/content-schedule-editors.test.tsx
git commit -m "feat(content-schedule): the editor says out loud that this one is already queued"
```

---

## Task 10: Calendar chips

**Files:**
- Modify: `lib/content-studio/calendar-chips.ts`, `lib/content-studio/calendar-data.ts`
- Modify: `components/admin/content-studio/calendar/CalendarContainer.tsx`
- Test: `__tests__/lib/content-studio/calendar-chips-content.test.ts`

**Interfaces:**
- Consumes: `listScheduledBlogPosts`, `listScheduledNewsletters` (Task 5); the schedule routes (Task 7)
- Produces:
```ts
export interface BlogPostChip { kind: "blog"; id: string; label: string; scheduledAt: Date | null; status: BlogPostStatus; raw: BlogPost }
export interface NewsletterChip { kind: "newsletter"; id: string; label: string; scheduledAt: Date | null; status: NewsletterStatus; raw: Newsletter }
export type CalendarChip = SocialPostChip | CalendarEntryChip | BlogPostChip | NewsletterChip
export function blogToChip(post: BlogPost): BlogPostChip
export function newsletterToChip(nl: Newsletter): NewsletterChip
```

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/calendar-chips-content.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { blogToChip, newsletterToChip, isLocked } from "@/lib/content-studio/calendar-chips"

describe("blog and newsletter calendar chips", () => {
  it("uses scheduled_at as the chip time for a scheduled post", () => {
    const chip = blogToChip({ id: "b1", title: "Speed work", status: "scheduled",
      scheduled_at: "2026-09-01T07:00:00Z", published_at: null } as never)
    expect(chip.kind).toBe("blog")
    expect(chip.scheduledAt?.toISOString()).toBe("2026-09-01T07:00:00.000Z")
    expect(chip.label).toBe("Speed work")
  })

  it("uses published_at once the post is live", () => {
    const chip = blogToChip({ id: "b1", title: "Speed work", status: "published",
      scheduled_at: null, published_at: "2026-08-30T07:00:00Z" } as never)
    expect(chip.scheduledAt?.toISOString()).toBe("2026-08-30T07:00:00.000Z")
  })

  it("labels a newsletter by its subject", () => {
    const chip = newsletterToChip({ id: "n1", subject: "August round-up", status: "scheduled",
      scheduled_at: "2026-09-02T09:00:00Z", sent_at: null } as never)
    expect(chip.kind).toBe("newsletter")
    expect(chip.label).toBe("August round-up")
  })

  it("locks a published post and a sent newsletter against dragging", () => {
    expect(isLocked(blogToChip({ id: "b", title: "t", status: "published", scheduled_at: null, published_at: "2026-08-30T07:00:00Z" } as never))).toBe(true)
    expect(isLocked(newsletterToChip({ id: "n", subject: "s", status: "sent", scheduled_at: null, sent_at: "2026-08-30T07:00:00Z" } as never))).toBe(true)
    expect(isLocked(blogToChip({ id: "b", title: "t", status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z", published_at: null } as never))).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run __tests__/lib/content-studio/calendar-chips-content.test.ts`
Expected: FAIL — `blogToChip` is not exported.

- [ ] **Step 3: Add the chip kinds**

In `lib/content-studio/calendar-chips.ts`, add the two interfaces, widen `CalendarChip`, add the two builders (mirroring `postToChip`'s "use the terminal timestamp once terminal, else the scheduled one" rule), and extend `isLocked`:

```ts
export function isLocked(chip: CalendarChip): boolean {
  if (chip.kind === "blog") return chip.status === "published"
  if (chip.kind === "newsletter") return chip.status === "sent"
  return chip.status === "published"
}
```

- [ ] **Step 4: Load them in calendar-data**

In `lib/content-studio/calendar-data.ts`, add both to the `Promise.all`, map to chips, apply the same window filter used for social posts, and concatenate into `chips`. Import `listScheduledBlogPosts` / `listScheduledNewsletters` — but note these return only `scheduled` rows, and the calendar also wants **published/sent** ones inside the window. Use `getBlogPosts()` and `getNewsletters()` and filter in memory by window, matching how `listSocialPostsForPipeline()` is already used.

- [ ] **Step 5: Make the new chips draggable**

In `CalendarContainer.tsx`, `rescheduleExistingChip` currently matches `/^chip-(post|entry)-(.+)$/`. Widen to `/^chip-(post|entry|blog|newsletter)-(.+)$/` and route the two new kinds to their own endpoints:

```ts
    if (kind === "blog" || kind === "newsletter") {
      const chip = data.chips.find((c) => c.kind === kind && c.id === id)
      if (!chip || !chip.scheduledAt) {
        toast.error("Missing scheduled time for this item")
        return
      }
      const next = new Date(`${dayKey}T00:00:00Z`)
      next.setUTCHours(chip.scheduledAt.getUTCHours(), chip.scheduledAt.getUTCMinutes(), 0, 0)
      if (next.getTime() <= Date.now()) {
        toast.error("Cannot reschedule to the past")
        return
      }
      const base = kind === "blog" ? "blog" : "newsletter"
      const res = await fetch(`/api/admin/${base}/${id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_at: next.toISOString() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Reschedule failed")
        return
      }
      toast.success(`Moved to ${next.toLocaleString()}`)
      router.refresh()
      return
    }
```

Also check `chipsFiltered` (line ~63): it currently splits chips into `post` and everything-else. Make sure the new kinds land in the pass-through branch rather than being dropped — the current `entryChips` filter is `c.kind === "entry"`, which would **silently drop** blog and newsletter chips. Change it to `c.kind !== "post"`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run __tests__/lib/content-studio`
Expected: PASS. Existing content-studio tests must not regress — the `CalendarChip` union widened, so any exhaustive `switch` on `kind` will surface here.

- [ ] **Step 7: Commit**

```bash
git add lib/content-studio components/admin/content-studio/calendar/CalendarContainer.tsx __tests__/lib/content-studio/calendar-chips-content.test.ts
git commit -m "feat(content-schedule): the month view stops pretending only social exists"
```

---

## Task 11: Whole-branch verification

**Files:** none created; this task produces evidence.

- [ ] **Step 1: Run every suite this branch touched**

```bash
npx vitest run \
  __tests__/migrations/content-scheduling.test.ts \
  __tests__/lib/content-schedule \
  __tests__/lib/blog/publish-post.test.ts \
  __tests__/lib/newsletter/send-newsletter.test.ts \
  __tests__/api/admin/internal/content-schedule-due.test.ts \
  __tests__/api/admin/content-schedule-routes.test.ts \
  __tests__/components/content-schedule-lists.test.tsx \
  __tests__/components/content-schedule-editors.test.tsx \
  __tests__/lib/content-studio \
  __tests__/lib/analytics \
  __tests__/api/newsletter \
  __tests__/lib/audit \
  2>&1 | tail -25
```

Record the exact pass count. **Run this command yourself and read its output** — do not accept a count reconstructed from memory or from a subagent's summary.

- [ ] **Step 2: Compare tsc against the baseline**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after.txt
wc -l < /tmp/tsc-after.txt
```

Expected: **251**. Then diff the *sets*, not just the counts — a falling count can hide new errors:

```bash
diff <(grep "error TS" /path/to/tsc-baseline.txt | sort) /tmp/tsc-after.txt
```

Expected: empty output in both directions.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -30
```

Expected: clean. Grep the output for the files this branch touched rather than reading the whole log.

- [ ] **Step 4: Typecheck functions/**

```bash
cd functions && npx tsc --noEmit; cd ..
```

- [ ] **Step 5: Confirm no Claude attribution on any commit**

```bash
git log bc97ff2b..HEAD --format='%B' | grep -iE 'co-authored-by:.*claude|generated with.*claude' && echo "FOUND — fix before finishing" || echo "clean"
```

Expected: `clean`.

---

## Task 12: Annotated screenshots of the real app

House rule: any new feature with UI is captured by driving the real app, with annotations burned into the PNG.

**Files:**
- Create: `screenshots/content-scheduling/*.png`, `screenshots/content-scheduling/README.md`

- [ ] **Step 1: Start the dev server**

`npm run dev` (port 3050). It reads `.env.local`, which points at the **dev clone** — the database Task 1 Step 6 migrated. Verify the server is up before driving it.

- [ ] **Step 2: Assert the session BEFORE anything else**

The harness's first navigation must be `/api/auth/session`, asserting the body carries `role: "admin"`, and must fail loudly there. A minted admin JWT (`encode()` from `next-auth/jwt`, `salt` = the cookie name `authjs.session-token`) expires in about an hour; without this check the harness cheerfully screenshots the login page and the failure looks like a feature bug.

- [ ] **Step 3: Reach the states by driving the real flow**

Seed real-looking content through the app or the dev DB, then drive the UI to produce:
1. `/admin/blog` — a Scheduled tab with a real post showing its queued date and time
2. The `SchedulePicker` open over the blog list
3. `/admin/newsletter` — a scheduled newsletter carrying a **Scheduled** badge (the bug Task 8 fixes)
4. A blog editor showing the armed banner
5. A missed item showing its `danger` badge and reason
6. `/admin/content` calendar with blog and newsletter chips beside social chips

Never a harness, never a storybook, never an isolated mount — the real route in the real page. Never an empty state; never `lorem`.

- [ ] **Step 4: Light theme only**

The admin UI is light-only: dark is a `.dark` class variant the admin components were never built against, so forcing it breaks existing pages too. Capture light, and say so in the README rather than shipping a mislabelled shot.

- [ ] **Step 5: Burn the annotations into the PNGs**

Numbered markers and captions composited into the image file itself, at the capture's exact pixel width so nothing is upscaled. Not an HTML wrapper drawing callouts around a clean screenshot.

- [ ] **Step 6: Write the README**

`screenshots/content-scheduling/README.md` — one line per shot, plus the note about light-only, plus which database the shots came from (the dev clone).

- [ ] **Step 7: Verify by looking**

Open each PNG and confirm the annotations are present and the UI is the real admin page. Then commit.

```bash
git add screenshots/content-scheduling
git commit -m "docs(content-schedule): the feature, photographed in the real app"
```

---

## Self-Review Notes

Checked against the spec:

- §4.1 (status representation) → Task 1
- §4.2 (local time) → Task 8 Step 1, `SchedulePicker`
- §4.3 (24h grace) → Task 2
- §4.4 (flag on, routes refuse) → Task 1 Step 1, Task 7 Step 2, Task 5 Step 4
- §4.5 / §5.1 (shared publish/send) → Tasks 3, 4
- §6 (data model) → Task 1
- §7 (reader audit) → Task 8, plus Task 1 Step 5 (validator) and Task 7 Step 8 (`published_at`)
- §8 (routes) + §8.1 (edits keep the schedule) → Task 7, Task 9 Step 3
- §9 (cron, catalog, watchdog, cron_runs) → Task 6
- §10 (UI) → Tasks 8, 9, 10
- §11 (error handling) → Task 5's tests, one per row of the table
- §12 (testing) → distributed; consolidated in Task 11
- §13 (deploy order) → Task 1 lands types + migration together; nothing writes `scheduled` until Task 7
- §14 (verification items) → Task 7 Step 8 (`published_at`), Task 3 (`actorId`), Task 11 Step 2 (the 251 baseline)

**One spec item deliberately re-scoped:** §7.3 asks the implementer to confirm `lib/ghl-blog.ts` never round-trips `blog_posts.status`. Read it during Task 8 and record the finding in the commit message; it needs no code change if the reading holds.
