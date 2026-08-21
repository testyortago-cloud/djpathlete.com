# Content Scheduling — Blog Posts and Newsletters

**Date:** 2026-08-21
**Branch:** `worktree-content-scheduling` (worktree `.claude/worktrees/content-scheduling`, base `bc97ff2b`)
**Status:** Approved in chat, pending implementation plan

---

## 1. Problem

Blog posts and newsletters can only go out by clicking a button while you are
sitting at the keyboard. `blog_posts.status` is `draft | published` and
`newsletters.status` is `draft | sent`; neither table records an intended
future time. A coach who writes on Saturday and wants the post live at 7am
Sunday has to be awake at 7am Sunday.

Social posts already solved this. `social_posts` carries `scheduled_at`, has a
`/schedule` + `/unschedule` route pair, and `publishDuePostsCron` runs every
five minutes hitting `/api/admin/internal/publish-due`, which calls
`runScheduledPublish()`. Blog and newsletter get the same treatment, built on
the same shape, so there is one mental model rather than three.

## 2. Goals

- Pick a future date and time for a blog post to publish itself.
- Pick a future date and time for a newsletter to send itself.
- See what is queued, cancel it, or move it.
- Scheduled blog and newsletter items appear on the existing `/admin/content`
  calendar next to the social chips already there.

## 3. Non-goals

- **Recurring schedules** ("every Monday"). One-off only. Explicitly deferred.
- **Per-recipient send-time optimisation.** A newsletter goes to everyone at
  once, as it does today.
- **Scheduling any other content type** (events, funnels, social — social
  already has its own).
- **Changing who receives a newsletter.** The audience is resolved at send
  time from the live subscriber list, exactly as the manual send does.

## 4. Decisions

### 4.1 `scheduled` is a real status value

Three representations were considered:

| | Approach | Cost |
|---|---|---|
| A | Third value on `blog_posts.status` / `newsletters.status`, plus `scheduled_at` | ~20 existing readers of those columns must be audited |
| B | `scheduled_at` only; status stays `draft` until it fires | No enum breakage, but the list paints a "Draft" badge on an armed newsletter, and any other code path can publish or edit it without knowing it is armed |
| C | Separate `content_schedule` table `(kind, ref_id, run_at, state)` | Neither content table changes, but "when is this going out" lives in two places and every list needs a join |

**Chosen: A.** A "Scheduled" tab and an honest badge are the point of the
feature, so the status column has to tell the truth. It also matches
`social_posts.approval_status`, which already has a real `scheduled` value.

The audit A demands is the main risk of this work and is enumerated in §7.

### 4.2 Times are the admin's local time

The picker is a `datetime-local` input, converted with `new Date(value).toISOString()`
on submit and stored as `timestamptz`. This is exactly what
[TimePickerPopover.tsx:43](../../../components/admin/content-studio/calendar/TimePickerPopover.tsx#L43)
already does for social posts, so the two schedulers cannot disagree about
what "7am" means.

The scheduled time must be in the future at the moment of scheduling.

### 4.3 Late is fine within 24 hours; older than that is a miss

The checker runs every five minutes, so exact-second firing was never on the
table. The question is what happens when the checker itself is down.

- `scheduled_at <= now` and `now - scheduled_at < 24h` → **it fires.**
- `now - scheduled_at >= 24h` → **it does not fire.** The row returns to
  `draft`, `schedule_failed_reason` records that it missed its slot, and it
  surfaces in the Daily Pulse.

Rationale: a two-hour outage should not cost you the post, but a newsletter
that has been sitting armed for a week must not land in inboxes unannounced
the moment service returns.

A send or publish that fails for any other reason gets the same treatment:
back to `draft`, reason recorded, surfaced.

### 4.4 The feature flag defaults ON, and the routes refuse when it is OFF

House pattern for a new cron is `system_settings` flag defaulting `false`.
This one defaults **`true`** (`cron_content_schedule_enabled`), because a
scheduler whose checker is off is not a dormant feature — it is a UI that
accepts your time and then silently does nothing.

Belt and braces: the `/schedule` routes return `409` with a plain-language
message while the flag is off. It is therefore impossible for the UI to accept
a schedule that nothing will ever act on.

### 4.5 Firing reuses the existing publish/send code

A scheduled blog post firing must do **exactly** what clicking Publish does
today: flip the `content_calendar` row, queue the `newsletter_from_blog` AI
job, queue `seo_enhance`, ping IndexNow, and `revalidatePath` both `/blog` and
`/blog/[slug]`. That logic is extracted from
[app/api/admin/blog/[id]/publish/route.ts](../../../app/api/admin/blog/[id]/publish/route.ts)
into a shared function that both the route and the runner call, so the two
paths cannot drift.

A scheduled newsletter firing flips the row to `sent` **before** queuing the
Firebase `newsletter_send` job — preserving the existing double-send guard and
its ordering.

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Admin UI                                                     │
│  blog list · newsletter list · both editors · /admin/content │
│  calendar chips (drag to move)                               │
└───────────────┬──────────────────────────────────────────────┘
                │ POST /schedule  ·  POST /unschedule
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Routes (4)                                                   │
│  /api/admin/blog/[id]/schedule      · /unschedule            │
│  /api/admin/newsletter/[id]/schedule · /unschedule           │
│  guard: flag on, future time, schedulable status, content ok │
└───────────────┬──────────────────────────────────────────────┘
                │ status = 'scheduled', scheduled_at = <utc>
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Postgres                                                     │
│  blog_posts  : draft | scheduled | published                 │
│  newsletters : draft | scheduled | sent                      │
└───────────────▲──────────────────────────────────────────────┘
                │ reads due rows, writes terminal state
                │
┌───────────────┴──────────────────────────────────────────────┐
│ lib/content-schedule/run-due.ts   (pure, unit-tested)        │
│  due = scheduled_at <= now  AND  now - scheduled_at < 24h    │
│  older → back to draft + reason                              │
└───────────────▲──────────────────────────────────────────────┘
                │
      POST /api/admin/internal/content-schedule-due  (bearer token)
                ▲
                │
      contentScheduleCron  —  every 5 min, UTC  (Firebase onSchedule)
```

### 5.1 Units and their boundaries

| Unit | Does | Depends on |
|---|---|---|
| `lib/content-schedule/due.ts` | Pure. Given rows and a `now`, returns `{ fire, missed, waiting }`. No I/O. | nothing |
| `lib/content-schedule/run-due.ts` | Loads scheduled rows, calls `due.ts`, dispatches each to the blog or newsletter firer, writes terminal state. | DAL, the two firers |
| `lib/blog/publish-post.ts` | The publish side-effects, extracted from the route. | blog DAL, ai-jobs, indexnow, revalidate |
| `lib/newsletter/send-newsletter.ts` | The send side-effects, extracted from the route. | newsletter DAL, firebase-admin, email |
| Routes | Auth, validation, audit, delegate. | the above |

`due.ts` being pure and I/O-free is what makes the 24-hour boundary cheap to
test exhaustively.

## 6. Data model

Migration `00224_content_scheduling.sql`.

```sql
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_failed_reason TEXT;

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'published'));

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

INSERT INTO system_settings (key, value, description)
VALUES ('cron_content_schedule_enabled', 'true'::jsonb,
        'Publish scheduled blog posts and send scheduled newsletters when their time arrives')
ON CONFLICT (key) DO NOTHING;
```

Type changes in `types/database.ts`:

```ts
export type BlogPostStatus = "draft" | "scheduled" | "published"
export type NewsletterStatus = "draft" | "scheduled" | "sent"
```

plus `scheduled_at: string | null` and `schedule_failed_reason: string | null`
on both `BlogPost` and `Newsletter`.

## 7. The reader audit

Extending these two enums changes what every existing filter on them returns.
Each of the following is a task, not an assumption. Newsletter readers are the
dangerous ones: nearly all are written as a **binary** `status === "sent" ? … : "Draft"`,
so a third value silently falls into the Draft branch.

### 7.1 Must change

| File | Line | Today | Problem |
|---|---|---|---|
| [components/admin/newsletter/NewsletterList.tsx](../../../components/admin/newsletter/NewsletterList.tsx#L148) | 145-148 | `status === "sent" ? "Sent" : "Draft"` | Paints a scheduled newsletter as a **Draft** |
| [components/admin/newsletter/NewsletterList.tsx](../../../components/admin/newsletter/NewsletterList.tsx#L35) | 34-35 | tabs `All / Draft / Sent` | No Scheduled tab; scheduled rows hide under Draft |
| [components/admin/newsletter/NewsletterForm.tsx](../../../components/admin/newsletter/NewsletterForm.tsx#L40) | 40, 294 | `isSent = status === "sent"` | A scheduled newsletter reads as an editable draft with no hint it is armed |
| [app/(admin)/admin/newsletter/page.tsx](../../../app/(admin)/admin/newsletter/page.tsx#L17) | 17-18 | counts `sent` and `draft` | Scheduled vanishes from **both** tallies |
| [app/(admin)/admin/blog/page.tsx](../../../app/(admin)/admin/blog/page.tsx#L14) | 13-15 | counts `published` and `draft` | Same — scheduled vanishes from both |
| [components/admin/blog/BlogPostList.tsx](../../../components/admin/blog/BlogPostList.tsx#L24) | 24, 36-37 | tabs `All / Draft / Published` | No Scheduled tab |
| [lib/validators/blog-post.ts](../../../lib/validators/blog-post.ts#L98) | 98 | `z.enum(["draft","published"])` | **Rejects** the new value outright on PATCH |
| [lib/db/blog-posts.ts](../../../lib/db/blog-posts.ts#L16) | 16 | `getBlogPosts(status?: BlogPostStatus)` | Widens automatically with the type; verify no caller assumes two values |
| [app/api/admin/blog/route.ts](../../../app/api/admin/blog/route.ts#L62) | 56-62 | `published_at = status === "published" ? now : null` | Must not stamp `published_at` for a scheduled post |
| [app/api/admin/newsletter/[id]/route.ts](../../../app/api/admin/newsletter/[id]/route.ts#L33) | 33 | blocks edits when `status === "sent"` | Stays as-is by design — see §8.1 |
| [lib/analytics/daily-pulse.ts](../../../lib/analytics/daily-pulse.ts#L118) | 118 | `blogsInDraft = status === "draft"` | Should not count scheduled posts as drafts; add scheduled + missed counts |

### 7.2 Verified safe, no change needed

| File | Why |
|---|---|
| [lib/db/blog-posts.ts](../../../lib/db/blog-posts.ts) `getPublishedBlogPosts`, `getPublishedBlogPostBySlug`, `getRelatedPostsByCategory` | All `.eq("status","published")` — a scheduled post correctly stays off the public site |
| [lib/db/content-attribution.ts](../../../lib/db/content-attribution.ts#L17) | `.eq("status","published")` |
| [app/api/admin/blog/[id]/sweep-links/route.ts](../../../app/api/admin/blog/[id]/sweep-links/route.ts#L41) | `.eq("status","published")` — link sweeps ignore unpublished posts, correct |
| [functions/src/ai/admin-tools.ts](../../../functions/src/ai/admin-tools.ts#L1489) | Counts `sent` only; a scheduled newsletter is genuinely not sent |
| `lib/db/events.ts`, `lib/db/faqs.ts`, `lib/ads/agent.ts`, `app/(marketing)/camps`, `app/(marketing)/clinics` | Different tables (`events`, `faqs`) that happen to use the word "published" |

### 7.3 Needs a decision recorded

[lib/ghl-blog.ts](../../../lib/ghl-blog.ts#L34) declares its own
`"draft" | "published" | "archived"` for the **GoHighLevel** API and filters
GHL's own posts at line 205. It is a separate vocabulary on the read side and
does not consume `blog_posts.status`. **No change**, but the implementation
must confirm by reading rather than by assuming the name match is meaningful.

## 8. Routes

All four require an admin session via `canAccessAdminPath`, mirroring the
existing blog and newsletter routes.

### `POST /api/admin/blog/[id]/schedule`
Body `{ scheduled_at: ISO }`. Rejects: flag off (`409`), unparseable or
past time (`400`), already `published` (`409`). Writes `status='scheduled'`,
`scheduled_at`, clears `schedule_failed_reason`. Audits `blog.scheduled`.

### `POST /api/admin/blog/[id]/unschedule`
Returns to `draft`, clears `scheduled_at`. Audits `blog.schedule_cancelled`.

### `POST /api/admin/newsletter/[id]/schedule`
Same, plus the content-length check the manual send already does
(`content.length >= 10`) moved to schedule time, so you find out now rather
than at 7am. Rejects when already `sent`. Audits `newsletter.scheduled`.

### `POST /api/admin/newsletter/[id]/unschedule`
Returns to `draft`. Audits `newsletter.schedule_cancelled`.

### 8.1 Editing something that is already scheduled

**Editing a scheduled item is allowed, and the schedule survives the edit.**
Fixing a typo at 9pm on a post queued for 7am should not silently disarm it.
The existing edit block on `status === "sent"` is unchanged — a sent
newsletter is still immutable.

The editors show a banner naming the queued time so nobody edits an armed
item believing it is an ordinary draft, with "Cancel schedule" alongside it.

This is the one place the design accepts a real risk: an edit that makes a
newsletter unsendable (emptying the body) leaves it queued, and it will be
marked missed at fire time rather than sent. The content check therefore runs
**again** in the runner, not only at schedule time.

New slugs in [lib/audit/actions.ts](../../../lib/audit/actions.ts), all
category `marketing`: `blog.scheduled`, `blog.schedule_cancelled`,
`blog.published_on_schedule`, `newsletter.scheduled`,
`newsletter.schedule_cancelled`, `newsletter.sent_on_schedule`,
`content.schedule_missed`.

The two cron-fired slugs are recorded with an `actor` override
(`system`/cron), which `recordAudit()` already supports.

## 9. The checker

`contentScheduleCron` — `*/5 * * * *`, UTC, `us-central1`, mirroring
`publishDuePostsCron` in [functions/src/index.ts](../../../functions/src/index.ts#L1167).
POSTs to `/api/admin/internal/content-schedule-due` with the
`INTERNAL_CRON_TOKEN` bearer.

The runner:

1. `isCronSkipped({ enabledKey: "cron_content_schedule_enabled", defaultEnabled: true })`.
   Skipped → return `{ skipped: true, reason }` without touching a row.
2. Load `blog_posts` and `newsletters` where `status = 'scheduled'`.
3. Partition with the pure `due.ts`:
   - `fire` — `scheduled_at <= now < scheduled_at + 24h`
   - `missed` — `now >= scheduled_at + 24h`
   - `waiting` — everything else
4. Fire each, sequentially, isolating failures per item.
5. Mark each `missed` back to `draft` with a reason.
6. Return `{ considered, published, sent, missed, failed }`.

Registered in [lib/cron-catalog.ts](../../../lib/cron-catalog.ts) with a
plain-language description, and in `EXPECTED_CRONS` in
[lib/automation/automation-health-scanner.ts](../../../lib/automation/automation-health-scanner.ts)
so a silent scheduler raises the daily watchdog rather than failing quietly:

```ts
{
  name: "contentScheduleCron",          // every 5 min
  sla_hours: 1,                          // matches publishDuePostsCron / sequenceTickCron
  reports_to_cron_runs: true,
  watch_from: "<merge date>",
  enabled_flag: "cron_content_schedule_enabled",
  enabled_flag_default: true,
}
```

`sla_hours: 1` is the established value for a five-minute cron here —
`publishDuePostsCron` and `sequenceTickCron` both use it.

Because this cron is new, it wires in `logCronStart` / `logCronEnd` from
[lib/db/cron-runs.ts](../../../lib/db/cron-runs.ts) rather than deferring it
(CLAUDE.md calls for doing this opportunistically). That earns
`reports_to_cron_runs: true`, which lets the watchdog judge it on "never
succeeded even once" and not only on staleness. `watch_from` is set to the
date this merges, so the clock does not open on a window that predates the
cron.

## 10. UI

Every list and badge uses the house `DataTable` components per CLAUDE.md.
Both lists currently hand-roll their status pill as a `<span>`; those become
`DataTableBadge` (`info` for Scheduled, `success` for Published/Sent,
`warning` for Draft, `danger` for a missed item).

- **Blog list, newsletter list** — a `Scheduled` tab; the badge; the queued
  date and time in the Date column; row actions to cancel or move.
- **Both editors** — a "Schedule" control beside the existing Publish/Send
  button, opening the same `datetime-local` picker.
- **Both stat rows** — a Scheduled tile; the Drafts tile stops swallowing
  scheduled items.
- **A missed item** — shows a `danger` badge with `schedule_failed_reason` as
  its tooltip and reverts to being an ordinary draft you can reschedule.
- **`/admin/content` calendar** — blog and newsletter chips beside the social
  ones. `CalendarChip` gains `BlogPostChip` and `NewsletterChip` variants;
  `getCalendarData` loads both alongside `listSocialPostsForPipeline()`.
  Since that calendar already drags social posts to reschedule, blog and
  newsletter chips drag too, hitting the same `/schedule` routes.
  `isLocked()` returns true for `published` / `sent` chips.

## 11. Error handling

| Failure | Behaviour |
|---|---|
| Checker down, back within 24h | Fires late. Normal. |
| Checker down, back after 24h | Back to `draft`, reason recorded, Daily Pulse. |
| Flag off at fire time | Nothing fires **and nothing is marked missed** — the runner returns before reading a row, so queued items simply wait. New schedules are refused at the route with an explanation. Note the consequence: if the flag stays off for more than 24h, everything queued in that window is marked missed on the first run after it is switched back on. That is the intended reading of §4.3 — an item nobody saw go out for a day does not get to surprise anyone. |
| Blog publish throws | That post back to `draft` + reason. Other items in the batch still fire. |
| Newsletter Firebase enqueue throws | Row already flipped to `sent` by the guard ordering — record the failure loudly and do **not** revert, because a revert risks a double send. Surfaces as a failure in the audit trail and Daily Pulse. |
| Post deleted between schedule and fire | Row is gone; the loop skips it. |
| Two checker runs overlap | The status flip is the guard: the second run no longer sees the row as `scheduled`. |

## 12. Testing

Targeted Vitest suites, plus `tsc --noEmit` compared against the recorded
baseline error count. Not the full suite.

**`__tests__/content-schedule/due.test.ts`** — the pure partitioner:
- exactly at `scheduled_at` → fire
- one second before → wait
- 23h59m late → fire
- exactly 24h late → missed (boundary is `>=`)
- 24h01m late → missed
- null `scheduled_at` on a `scheduled` row → missed, not a crash
- rows in other statuses are never considered

**`__tests__/content-schedule/run-due.test.ts`** — the runner, mocked DAL:
- a due blog post publishes and calls the shared publish path
- a due newsletter flips to `sent` **before** the job is queued
- one item throwing does not stop the others
- flag off → returns skipped, writes nothing
- a missed item returns to `draft` with a reason

**`__tests__/api/content-schedule-routes.test.ts`**:
- past time → 400; unparseable → 400
- flag off → 409 with a readable message
- scheduling an already-published post → 409
- a too-short newsletter → 400 at schedule time
- unschedule returns to `draft` and clears the timestamp
- non-admin → 401

**Regression cover for §7** — a test that a `scheduled` newsletter renders a
Scheduled badge and not a Draft one, and that the stat tiles account for it.
This is the check that the audit actually landed.

## 13. Deploy order

Migrations and Vercel race on merge to `main` here, so for one deploy the code
may run against the old schema.

1. Ship the §7 reader fixes and the type widening **first**; they tolerate a
   row with no `scheduled_at` column (`row.scheduled_at ?? null`, never a bare
   `!== null` on a column that may not exist).
2. Migration `00224` applies.
3. Only then does anything write `'scheduled'` — the routes are the only
   writers, and they are gated on the flag.

The cron is additive and harmless before the migration: it queries
`status='scheduled'`, which returns nothing until the constraint allows it.

## 14. Verification items carried into the plan

These are things the implementation must confirm by reading code, not assume.
They are not unresolved design questions.

- `lib/ghl-blog.ts` never round-trips `blog_posts.status` (§7.3).
- The `content_calendar` status flip inside the publish path behaves the same
  when the actor is the cron rather than a signed-in admin — the current code
  takes `session.user.id` for the AI-job `userId`, and the runner has no
  session. The extracted `publishPost()` therefore takes an explicit
  `actorId`, and the runner passes the post's `author_id`.
- The recorded `tsc --noEmit` baseline on this branch's base (`bc97ff2b`) is
  **251 errors**. Any comparison is against that number, in both directions —
  a falling count can hide new errors as easily as a rising one.
