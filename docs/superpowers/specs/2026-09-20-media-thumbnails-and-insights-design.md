# Media thumbnails + Content Studio Insights — design

**Date:** 2026-09-20
**Branch:** `worktree-media-thumbnails-and-insights`
**Status:** approved design, ready for an implementation plan

## Where this came from

The owner asked, over WhatsApp:

> "You think we could get the ability to put a thumbnail on the video creation stuff as well as
> some basic metrics of analysis?" … "Yep. The media management side of things. Think that would
> make it complete."

Two features, both scoped to the media surfaces: Content Studio (`/admin/content`) and Team Media
(`/admin/team-media`).

## What already exists — measured, not assumed

Checked against **production** on 2026-09-20, not against the migration files.

### Thumbnails

`video_uploads.thumbnail_path` has existed since migration `00088`. It is written by a browser-side
canvas capture in [lib/firebase-client-thumbnail.ts](../../../lib/firebase-client-thumbnail.ts):
seek the video to **1.0 s**, `drawImage` to a canvas, `toBlob` as JPEG at quality 0.75, max width
480 px, then PUT to a signed URL. Two callers: the Content Studio uploader, and
[StatusActions.tsx](../../../components/admin/team-videos/StatusActions.tsx) when a team submission
is promoted.

| Fact | Value |
|---|---|
| `video_uploads` rows | 9 |
| …with a `thumbnail_path` | **9** (all) |
| `media_assets` rows | 7 — all `kind='image'`, 0 video |
| `team_video_versions.thumbnail_path` | **column does not exist** |

Rendered on the Videos list and the pipeline kanban cards. **Not** rendered on the video detail
page. There is no way to change it.

### Metrics

A complete pipeline exists and has never carried a row:

- `social_analytics` (migration `00089`) — time-series, one row per post per sync.
- `syncPlatformAnalytics` — nightly Firebase `onSchedule` at 03:00 UTC →
  `/api/admin/internal/sync-post-analytics` → the platform plugin's `fetchAnalytics()`.
- The plugins are **real**, not stubs: Instagram hits the Graph API `insights` edge, YouTube hits
  `videos?part=statistics`, TikTok resolves a `publish_id` to a post id then queries video stats.
- `/admin/analytics` already has a Social tab fed by
  [lib/analytics/social.ts](../../../lib/analytics/social.ts).

| Fact | Value |
|---|---|
| `social_analytics` rows | **0** |
| `social_posts` rows | 54 |
| …`approval_status='published'` | **0** — every row is a draft |
| …with a `platform_post_id` | 0 |
| Connected platforms | Instagram, TikTok, YouTube, YouTube Shorts |
| Not connected | Facebook, LinkedIn |
| `platform_connections.last_sync_at` | null on **every** row |

The 54 posts are 9 videos × 6 platforms. Nothing has ever been published, so the analytics cron has
nothing to measure. Content Studio itself displays no metrics of any kind.

**This is the single most important fact in this spec.** The performance half of the feature will
open empty, and the design has to make that honest rather than render a misleading `0`.

## Decisions taken

### D1 — Compute metrics live; no snapshot table, no new cron

Two house patterns exist. The Insights subsystem (`/admin/insights/*`) uses cron → aggregator →
per-phase snapshot table. `/admin/analytics` computes live from existing tables.

**Live wins here.** `social_analytics` *is* the time series; a snapshot table on top of it caches a
cache. With 9 videos and 54 posts there is nothing to cache. A snapshot layer stays a contained
change if the library reaches the thousands.

### D2 — Custom thumbnails get their own storage path

Today every thumbnail is written to one fixed path, `${storage_path}.thumb.jpg`, and the row is
updated **before** the bytes are uploaded — the route says so in a comment, and reasons that a
failed PUT only costs a fallback icon.

That reasoning holds for an auto-capture and **breaks for a custom one**:

1. A failed upload would destroy a thumbnail that was previously working.
2. Rewriting the same path means the signed READ URL is unchanged, so browsers keep serving the old
   image out of cache. The thumbnail would appear not to have changed.

So a custom thumbnail is written to `${storage_path}.thumb-custom-${epochMs}.jpg`. A new path means
a new signed URL, which sidesteps caching entirely, and it leaves the auto thumbnail untouched at
its original deterministic path — which is what makes "revert to auto" a row update rather than a
re-render.

### D3 — Commit the row after the upload, not before

The custom flow is two calls:

1. `POST /api/admin/videos/[id]/thumbnail/custom` → returns `{ uploadUrl, thumbnailPath }`.
   **Writes nothing.**
2. `PUT /api/admin/videos/[id]/thumbnail` with `{ thumbnailPath, source }` → asserts the blob
   exists in the bucket (`file.exists()`), asserts the path matches the expected prefix for this
   video, then writes `thumbnail_path` + `thumbnail_source`.

The existing `POST /api/admin/videos/[id]/thumbnail` keeps its current write-ahead behaviour
unchanged. It has two callers and nothing to gain from the change, and leaving it alone keeps this
work off the upload path.

**The existence check is the point.** A PUT to a signed URL that does not throw is not proof the
bytes landed; step 2 asks the bucket.

**Revert takes the same route and the same check.** `PUT { source: 'auto' }` carries no
`thumbnailPath`; the server derives `${storage_path}.thumb.jpg` itself and asserts *that* blob
exists. If it does not — the auto capture failed at upload time, which is a real state for any
video whose codec the browser could not decode — the route answers **409 and writes nothing**, and
the UI keeps the custom thumbnail and says the original frame is no longer available. Silently
pointing the row at a missing blob would turn Revert into "delete my thumbnail".

### D4 — `thumbnail_source` has a reader before it has a writer

New column `video_uploads.thumbnail_source text` — `'auto' | 'frame' | 'upload'`, nullable, no
default. The UI reads it to label the thumbnail and to decide whether "Revert to auto" is offered.
Existing rows stay null, which reads as "auto / unknown" and offers no Revert.

### D5 — Team Media thumbnails hang off the version, not the submission

The file lives on `team_video_versions.storage_path`, so `thumbnail_path` goes there. Generated
lazily on first view with the existing best-effort helper — the same pattern `StatusActions`
already uses — so no backfill migration and no blocking work on the upload path.

Image-set submissions (`team_video_submissions.kind`) have no video to seek, so their thumbnail is
the `position = 0` row of `team_submission_images`.

### D6 — Four distinct empty states, never a bare zero

A zero and an absence are different answers. The performance panel must distinguish:

| Situation | Message |
|---|---|
| Video has no published posts | "Not published yet — performance appears once posts go live." |
| Published, no snapshot yet | "Published {date} · first metrics arrive after tonight's 03:00 sync." |
| Platform not connected | "{Platform} isn't connected." |
| Synced and genuinely zero | `0` |

Production today hits row 1 for all 9 videos. That is the correct, honest reading of where the
studio actually is.

## Architecture

### Thumbnails

```
VideoDetailSidebar (already renders <video src={previewUrl}>)
  └── ThumbnailPanel  (new, client)
        ├── "Use this frame"  → captureFrameAt(videoEl.currentTime) → Blob
        ├── "Upload an image" → <input type=file accept=image/*>    → Blob
        └── "Revert to auto"  → PUT { source: 'auto' }
                 │
                 ├─ 1. POST /api/admin/videos/[id]/thumbnail/custom  → { uploadUrl, thumbnailPath }
                 ├─ 2. PUT uploadUrl (the bytes)
                 └─ 3. PUT /api/admin/videos/[id]/thumbnail { thumbnailPath, source }
                          └─ bucket.file(path).exists() → updateVideoUpload(...)
```

`lib/firebase-client-thumbnail.ts` grows one exported function, `captureFrameFromElement(videoEl)`,
which reuses the existing canvas/encode block. The existing `captureFrame` seek-to-1s path is
refactored to call it, so there is exactly one encoder.

**Server-side guard:** step 3 recomputes the legal prefix from the video's own `storage_path` and
rejects any `thumbnailPath` that does not match. Without it the route would accept an arbitrary
path and point a row at someone else's blob.

### Insights

```
/admin/content?tab=insights
  └── app/(admin)/admin/content/page.tsx  → case "insights"
        └── getInsightsData()            lib/content-studio/insights-data.ts   (I/O)
              └── computeStudioInsights() lib/content-studio/insights.ts       (pure, tested)
                    ├── Band A — production, from video_uploads / social_posts /
                    │            media_assets / team_video_submissions
                    └── Band B — performance, from social_analytics
```

The split matters: `insights.ts` takes rows and returns numbers with no Supabase, Firebase or
`Date.now()` reach-around, so it is unit-testable without fakes. `insights-data.ts` does the
fetching. This mirrors `computeSocialMetrics` / the analytics page.

**Band A** — videos uploaded (period vs previous), posts by stage, media library by kind and
origin, videos blocked by the edit gate (`needs_edit = true`), team submissions by status, and the
**oldest item in each stage**, which is the number that prompts action.

**Band B** — per video: each published post's latest `social_analytics` snapshot (views, likes,
comments, shares), plus a roll-up. Rendered on the Insights tab and as a Performance section on the
video detail page.

`latest snapshot per post` = max `recorded_at`, matching the existing `latestByPost` reduction in
`lib/analytics/social.ts`. Do not sum across snapshots — they are cumulative totals, not deltas.

**No feature flag.** Several Content Studio features sit behind `system_settings` flags
(`feature_split_reel_enabled`, `feature_reel_editor_enabled`) because they spend money or render
video. Insights is read-only, additive, and spends nothing; a flag would be one more thing to
remember to turn on. The thumbnail picker is likewise unflagged.

**Placement of Band B.** Two renders of the same data, one component:
`<VideoPerformance videoId>` appears (a) on the Insights tab as a roll-up across all videos, and
(b) as a new section on the video detail page, below Posts and above Details. The detail-page
instance is what makes "how did this video do" answerable without leaving the video.

## Data model

One migration, `00265_media_thumbnails.sql`:

```sql
ALTER TABLE video_uploads       ADD COLUMN thumbnail_source text;
ALTER TABLE team_video_versions ADD COLUMN thumbnail_path  text;
```

Both nullable, no default, no backfill — existing rows read as "auto / unknown" and "no thumbnail
yet", which are the states the UI already handles.

A `CHECK` on `thumbnail_source` is deliberately omitted: the column is written only by one route
that validates with Zod first, and a CHECK would make the "code tolerates the old schema for one
deploy" window sharper for no gain.

**Migration number collision is a live risk.** Two peer Claude sessions are working this repo.
`00264` is the highest on `main` at the time of writing; re-check immediately before merge.

## Testing

| Unit | How it is tested |
|---|---|
| `computeStudioInsights` | pure — fixtures in, numbers out. Includes the four empty-state branches. |
| Empty-state selection | its own table-driven test; this is the requirement most likely to regress into a bare `0`. |
| `PUT .../thumbnail` | blob-missing → 409 and **no row write**; wrong-prefix path → 400; happy path → row written. |
| `POST .../thumbnail/custom` | writes nothing (asserted against the DAL mock, not just the response). |
| `captureFrameFromElement` | the refactor keeps the 1s auto path byte-identical in behaviour — pinned by the existing tests. |
| Team Media thumbnail | image-set submissions take image `position = 0`, not a video frame. |

**Mutation checks to run** (this repo's own standard): delete the `exists()` check; invert the
prefix guard; change "no published posts" to fall through to the zero branch; drop
`.order('recorded_at')`. Each must turn a test red.

## Explicitly out of scope, and why

- **`business_id` on the media tables.** None of `video_uploads`, `media_assets`, `social_posts`,
  `social_analytics`, `team_video_submissions`, `team_video_versions`, `video_transcripts`,
  `content_calendar` carry one. That predates this work. The columns added here sit on tables that
  are already untenanted, so this does not make it worse — but retrofitting the content subsystem
  for multi-tenancy is its own project and is not being smuggled in. **Flagged, not taken.**
- **A snapshot table + cron for insights.** See D1.
- **Fixing Instagram's `impressions` metric.** The plugin asks the Graph API for `impressions`,
  which Meta has been retiring on media insights in favour of `views`. Worth verifying against the
  live API — but it cannot be verified while zero posts are published, and guessing at a
  replacement metric without being able to observe the response would be worse than leaving it.
  **Recorded, not changed.**
- **Publishing anything to make metrics appear.** Outward-facing. Not done unsupervised.

## Open question for the owner

`platform_connections.last_sync_at` is null on every row, which is consistent with "no published
posts to sync" but would look identical to "the cron has never successfully run". Once the first
post publishes, one observed run should be confirmed before the performance numbers are trusted.
