# Content Studio — Unified Admin Surface for Videos, Social Posts, and Calendar

**Date:** 2026-04-20
**Status:** Design approved, pending implementation plan
**Scope:** Admin UI redesign — unifies `/admin/videos`, `/admin/social`, `/admin/calendar` into a single "Content Studio" shell. No changes to transcription/fanout pipelines, no client-side changes, no new publishing integrations.

---

## Problem

Today the three admin pages are functionally connected in the data model (`social_posts.source_video_id` references `video_uploads.id`) but visually and informationally disconnected:

- The transcript modal on the Videos page shows a transcript with only the filename as context. A user viewing a transcript has no idea which generated posts came from it, whether they are scheduled, or when they publish.
- The Social page hides the source video entirely — a reviewer cannot verify a caption against the clip it came from.
- The Calendar shows platform icons and times but no caption preview, no video reference, no way to drill in.
- Navigation between the three areas requires sidebar clicks and loses context every time.

## Goal

One admin surface ("Content Studio") where a video, its transcript, its 6 generated posts, and their scheduled publish dates are always reachable in at most one click from any starting point. Every transcript is shown next to its source video. Every post is shown next to its source video. Every calendar chip can drill into its source video.

## Non-goals

- Changing the AssemblyAI transcription pipeline
- Changing the Claude Vision fallback pipeline
- Changing the fanout prompts or the six-caption generation logic
- Adding new publishing integrations
- Any client-facing (non-admin) changes
- Mobile-optimized layouts (desktop-first; mobile is a later concern)

---

## Architecture

### Information architecture

- `/admin/content` — Pipeline board (new default home of Content Studio)
- `/admin/content/[videoId]` — Deep link that opens Content Studio with the detail drawer open on that video
- `/admin/videos` → 301/redirect to Content Studio with Videos tab active
- `/admin/social` → redirect to Content Studio with Posts tab active
- `/admin/calendar` → redirect to Content Studio with Calendar tab active

### Sidebar

The existing "Content Management" section collapses from three entries (Videos / Social / Calendar) to one entry: **Content Studio**. Child links expand below it for Pipeline / Calendar / Videos / Posts so users who type or click by habit still get where they expected.

### Shell

A persistent top bar and tab switcher render on all four tabs:

- Left: tab switcher — `Pipeline` · `Calendar` · `Videos` · `Posts`
- Center: global search — queries video filenames, transcript text (full-text), and caption text. Results are grouped by type.
- Right: primary `Upload Video` button, plus a filter-summary chip when non-default filters are active

A single `<ContentStudioShell>` wraps all four tabs so state (selected filters, search query, open drawer) persists when switching tabs.

### Detail drawer

The drawer is the heart of the fix for the transcript-context problem. It is routed: opening the drawer pushes `/admin/content/[videoId]` so the URL is shareable and the back button works. Closing reverts to the previous tab URL.

- Opens from: any video card in Pipeline, any post card in Pipeline, any Calendar chip, any row in the Videos or Posts list views
- Layout: right-side panel ~700px wide over a dimmed backdrop
- Top: video player + filename + upload date + size/duration metadata (or "Manual post (no source video)" placeholder for video-less posts)
- Tabs inside the drawer: `Transcript` (default) · `Posts (N)` · `Meta`
- Transcript tab: full transcript text, `Vision description` badge if the source was Claude Vision fallback, `Copy` / `Regenerate` / `Edit` actions
- Posts tab: inline list of all fanned-out posts with status pills, schedule times, and inline-expand rows for editing captions, adjusting schedule, retrying failed sends
- Meta tab: upload info, AssemblyAI job id, fanout history, publishing errors

Opening from a post card auto-selects the `Posts` tab and auto-expands the clicked post. Opening from a video card defaults to the `Transcript` tab.

---

## Feature: Pipeline Board (`/admin/content`)

Two horizontal swim lanes, stacked top-to-bottom. This reflects the real data flow: a video moves through one lifecycle; its child posts each move through a separate lifecycle.

### Videos lane (top)

Columns: `Uploaded` → `Transcribing` → `Transcribed` → `Generated` → `Complete` (collapsed, archive).

- Video cards are **auto-advanced by backend state** (upload webhook, AssemblyAI webhook, fanout completion). Users do not drag video cards.
- Card content: thumbnail, filename, duration, status badge, mini-summary "6 posts · ✓4 approved · ⏱2 scheduled"
- A video moves to `Complete` only when all child posts are in `Published`.

### Posts lane (bottom)

Columns: `Needs Review` → `Approved` → `Scheduled` → `Published`, plus a collapsed `Failed` column on the far right.

- Post cards are **manually advanced by user action** (approve button, drag across columns, schedule picker).
- Card content: platform icon (IG/TT/FB/YT/X), 2-line caption preview, small source-video thumbnail + filename in corner, scheduled time if set.
- Dragging a post from `Approved` onto the Calendar tab opens a time-picker and schedules it on the drop target day.
- Failed posts show a red border and a one-click retry button.

### Bulk actions

Selecting multiple post cards reveals a `Approve N` button. This preserves the batch-approval workflow from the existing social page.

### Filters (top bar)

Platform, status, date range, source video. Filters apply to both lanes simultaneously — the top lane filters to only videos whose child posts match the filter.

---

## Feature: Full Calendar View

Three-column layout: filters (left) · calendar (center) · unscheduled posts (right).

### Center — calendar grid

- View toggle top-right: `Month` · `Week` · `Day`
- Month is the default for planning; Week for active scheduling; Day for precise hourly placement
- Post chips are color-coded by platform: IG purple, TikTok black, YouTube red, Facebook blue, X neutral
- Chip content: platform icon + first ~30 chars of caption, plus a tiny video-thumbnail dot if sourced from a video
- Hovering a chip shows a mini-card: full caption, source video thumbnail, `Open` button (opens detail drawer)
- Click empty day → `+ New post` creates a manual post (no source video) scheduled on that day
- Drag-drop rescheduling works in all three views
- Published chips render in a darker/locked style and cannot be dragged
- Failed chips show a red badge and an inline retry action
- Keyboard: `m` / `w` / `d` switches view, `←` / `→` navigates periods, `t` jumps to today

### Right panel — unscheduled posts

- Lists posts in `Approved` status with no `scheduled_for` value, ordered by source-video upload date
- Collapsible groups by source video: "Rotational Reboot teaser (6 posts, 4 unscheduled)" so a fanout batch stays visually together
- Drag any card onto a day cell to schedule; on drop, a time-picker popover opens (default: next free slot on that day per platform best-time rules — best-time logic is out of scope for this spec and can start as a fixed default time per platform)

### Left panel — filters

- Checkbox filters: platform, status
- Search-by-source-video input
- Selected filter state persists per user (see Data Model section)
- Active filters surface as a summary chip in the shell top bar

---

## Feature: Detail Drawer

See "Detail drawer" under Architecture. The drawer is the transcript-context fix: every entry point into the drawer places the transcript next to the video player and next to the generated posts.

### Routing behavior

- Opening pushes `/admin/content/[videoId]?tab={transcript|posts|meta}&postId={id?}`
- The query params survive refresh and can be shared
- Closing pops the URL back to the underlying tab (Pipeline/Calendar/Videos/Posts)

### Per-entry-point defaults

| Opened from | Default tab | Pre-selection |
|---|---|---|
| Pipeline video card | Transcript | — |
| Pipeline post card | Posts | that post expanded |
| Calendar chip | Posts | that post expanded |
| Videos list row | Transcript | — |
| Posts list row | Posts | that post expanded |
| Direct URL | Whatever `?tab=` says | Whatever `?postId=` says |

---

## Data flow

1. User uploads video → existing pipeline creates `video_uploads` row → AssemblyAI webhook populates `video_transcripts` → fanout creates 6 `social_posts` rows with `source_video_id` set.
2. Pipeline board subscribes to `video_uploads` and `social_posts` (via Supabase realtime or polling; decide in implementation plan) and renders cards in the correct column based on status.
3. User clicks any card → URL updates → `<ContentStudioDrawer>` mounts and fetches `video_uploads`, `video_transcripts`, and all `social_posts WHERE source_video_id = $1` in a single RPC or parallel queries.
4. User drags a post chip to a new calendar day → client optimistically updates → mutation writes `social_posts.scheduled_for` → realtime (or refetch) updates other clients.
5. Publishing happens via existing pipelines (unchanged). Published chips reflect new `status = 'published'` + `published_at`.

---

## Data model

Most columns needed already exist. Verify during implementation:

- `social_posts.source_video_id` — **exists** ✓ (confirmed in types/database.ts line 1120)
- `social_posts.scheduled_for` — verify; used by Calendar drag-drop and unscheduled panel. If missing, add a nullable `timestamptz` column.
- `social_posts.status` enum — must cover: `draft | needs_review | approved | scheduled | published | failed | rejected`. Verify the current enum and add missing values via migration if needed.
- `content_calendar_entry` — the existing generic calendar table. **Decision: keep for backward compatibility and for calendar items that are not social posts (e.g., content planning notes). The Calendar view reads from both `social_posts.scheduled_for` AND `content_calendar_entry`, merging into a single chip stream.**

### New: user preferences

Persist per-user UI state: default calendar view (`month` / `week` / `day`), last-used filter set, Pipeline lane collapse state.

Two options, decide in implementation plan:

- JSON column on `users` (simpler, single-row update)
- New `user_preferences` table (cleaner if preferences grow)

---

## Edge cases

- **Post with no source video** (manual post, or blog-originated): shows in Posts lane and Calendar normally. Detail drawer opens in a "post-only" mode — no video player, just a placeholder block reading "Manual post (no source video)" and the caption editor filling the available space.
- **Transcription failure**: video sits in `Transcribing` column with a red error badge and a retry button. It cannot advance to `Transcribed` until retry succeeds OR the user uses a new "Add transcript manually" action (paste text, skip AI).
- **Claude Vision fallback** (commit ab1b937 in the repo): the Transcript tab of the drawer displays a `Vision description` badge so the reviewer knows the text is AI-described from frames, not speech-transcribed.
- **Post publishing failure**: red badge in Pipeline `Failed` column and on the Calendar chip. Drawer's Meta tab surfaces the error detail and a retry button.
- **Bulk approve**: selecting N post cards reveals `Approve N` — moves all selected to `Approved` in a single transaction.
- **Search**: global search in the shell top bar queries three sources in parallel: `video_uploads.filename`, `video_transcripts.text` (Postgres full-text), `social_posts.caption`. Results are grouped by type in the dropdown.
- **Permissions**: admin-only, enforced by existing `middleware.ts` which already gates `/admin/*` on role.

---

## Rollout

Behind a global feature flag `content_studio_enabled` (env var or config row; not per-user, since this is an internal-admin-only surface and per-user flags add needless complexity). While the flag is off, the existing three pages remain live unchanged. While the flag is on:

- Sidebar shows the new single `Content Studio` entry
- The three legacy URLs redirect into the shell
- Legacy page files are not deleted yet

After a 2-week confidence period with the flag on, the legacy page files and sidebar entries are removed in a follow-up PR.

---

## Testing

**Unit tests**

- Calendar chip drag-drop reducer (source day → target day, status transitions, validation against locked/published chips)
- Filter logic (combining platform + status + source-video filters, persisting in URL and user preferences)
- Drawer routing (tab/postId query params, open/close, back button behavior)
- Pipeline column derivation (given a video status and its posts' statuses, which columns should cards render in?)

**Integration tests**

- Post fanout → posts appear in Pipeline `Needs Review` column
- Approve all posts for a video → video card moves to `Complete` archive column
- Drag post from unscheduled panel onto day → `scheduled_for` is written + chip appears on calendar

**E2E (Playwright)**

- Golden path: upload video → wait for transcription → wait for fanout → open drawer → verify video player + transcript + 6 posts visible → approve all → drag one onto calendar day → verify chip → click chip → verify drawer reopens with that post pre-expanded and the source video visible
- Redirect test: hit `/admin/calendar` while flag on → lands on shell with Calendar tab active
- Failure path: simulate AssemblyAI webhook failure → video shows red badge in Pipeline → retry button works

---

## Open questions (decide during implementation plan, not now)

- Realtime vs polling for Pipeline/Calendar updates — depends on existing Supabase realtime usage in the codebase.
- Exact shape of the time-picker popover when dropping an unscheduled post onto a day (platform-specific defaults vs generic).
- Whether to migrate existing `content_calendar_entry` rows into `social_posts` or keep them separate forever.
- User preferences storage: JSON column vs dedicated table.

---

## Implementation phasing note

This spec is cohesive (one redesign, one user-facing story) but large. The implementation plan should split execution into phases that each ship independently under the feature flag:

1. **Phase 1 — Shell + routing skeleton** (tab switcher, redirects, placeholder tabs, feature flag wiring, URL-routed drawer shell)
2. **Phase 2 — Detail drawer + data loading** (video player, transcript, posts tab, meta tab — the transcript-context fix lands here)
3. **Phase 3 — Pipeline board** (two-lane Kanban with drag-drop, bulk approve, filters)
4. **Phase 4 — Full Calendar** (month/week/day views, filter sidebar, unscheduled panel, drag-drop scheduling)
5. **Phase 5 — Search + polish** (global search, user preferences persistence, keyboard shortcuts, legacy page cleanup)

Each phase is reviewable in isolation and the flag can be enabled at any phase boundary for internal dogfooding.

## Scope summary

**In:** new `/admin/content` shell, pipeline board, full calendar with 3 views + filter sidebar + unscheduled panel, routed detail drawer, redirects from legacy URLs, feature flag rollout.

**Out:** pipeline changes (transcription, fanout, publishing), client UI, mobile layout, cross-platform publishing best-time AI, new integrations.
