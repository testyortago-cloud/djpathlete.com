# Video-editing columns on the Content Studio Pipeline — Design

**Date:** 2026-06-01
**Status:** Approved (design); pending implementation plan

## Problem

The Content Studio **Pipeline** page shows two kanban boards — **Videos**
(`Uploaded → Transcribing → Transcribed → Generated → Complete`) and **Posts**
(`Needs Review → Approved → Scheduled → Published → Failed`). The captioned-cut
**video-editing stage** — which sits between transcription and post fanout and is
gated by `video_uploads.needs_edit` — is **invisible on the board**. A transcribed
video just sits in `Transcribed` whether it is awaiting an edit, mid-render, or
already cut. The only edit-state cues today are a small "Needs edit"/"Cut" badge on
the card and the render panel inside the video detail page.

**Goal:** surface the edit stage as first-class kanban columns, with quick actions
and live render progress, so editing status is visible and actionable at a glance.

## Decisions (from brainstorming)

1. **Structure:** three edit columns inside the existing Videos lane; **Needs Edit
   replaces Transcribed** (a transcribed video is `needs_edit=true` by default, so a
   standalone `Transcribed` column would always be empty). → 7-column lane.
2. **Failed renders:** shown as a red **badge inside Needs Edit**, not a separate
   column.
3. **Card behavior:** **quick actions on the cards** (Render cut / Mark ready /
   Retry render), not read-only.
4. **Liveness:** **live while rendering** — poll in-flight renders, tick an elapsed
   timer, and auto-advance the card when the render finishes.
5. **Edited cards stay link-only** — no "Generate posts" button on the board (that
   flow stays in the detail page).
6. **Flag-off** keeps today's 5-column lane unchanged.

## Column model

Flag **on** — the Videos lane is 7 columns:

```
Uploaded → Transcribing → Needs Edit → Rendering → Edited → Generated → Complete
```

Tones (all already defined in `components/admin/content-studio/pipeline/Lane.tsx`,
`LaneTone`):

| Column        | Tone        |
|---------------|-------------|
| Uploaded      | `neutral`   |
| Transcribing  | `progress`  |
| Needs Edit    | `warning`   |
| Rendering     | `progress`  |
| Edited        | `success`   |
| Generated     | `progress`  |
| Complete      | `published` |

All Videos columns keep `accepts={false}` (read-only placement — state is derived,
not drag-driven), matching the lane's existing "Auto-advance" behavior.

### State derivation

`videoColumnFor(video, posts, signals)` where `signals = { hasCut: boolean,
isRendering: boolean }`:

1. has posts + every post `published` → **complete**
2. has posts (any unpublished) → **generated**
3. no posts, `status === "uploaded"` → **uploaded**
4. no posts, `status` is `"transcribing"` or `"failed"` → **transcribing**
   *(transcription failure — unchanged; surfaced by the existing red "Error" badge.
   This is distinct from a captioned-cut render failure.)*
5. no posts, `status` is `"transcribed"` or `"analyzed"`:
   - `isRendering` (an in-flight `video_caption_render` job exists) → **rendering**
     *(checked first so re-renders of an already-cut video also show here)*
   - else `isVideoPostable(video, hasCut)` — i.e. `hasCut` **or**
     `needs_edit === false` (per `lib/content-studio/edit-gate.ts`) → **edited**
   - else → **needs_edit**

A captioned-cut render only requires a **speech transcript** (word timings), not the
`analyzed` status, so a transcribed video can be edited immediately — confirming the
`Transcribed → Needs Edit` rename.

## Feature-flag behavior

Gated by the existing DB-backed flag **`feature_captioned_cut_enabled`**
(`system_settings`, default false).

- **On** → 7-column lane above; render signals fetched; action buttons shown.
- **Off** → today's 5-column lane (`Uploaded → Transcribing → Transcribed →
  Generated → Complete`) unchanged; no render signals fetched; no action buttons.

Implementation: `lib/content-studio/pipeline-columns.ts` exports two column-key
arrays (`VIDEO_COLUMNS` = current 5, `VIDEO_COLUMNS_WITH_EDIT` = 7) with matching
label/tone/help maps. `VideosLane` selects the set from `data.captionedCutEnabled`.

## Data layer

### `lib/content-studio/pipeline-data.ts` — `PipelineData` additions

Only populated when the flag is on:

- `captionedCutEnabled: boolean` — from `getSetting<boolean>("feature_captioned_cut_enabled", false)`
- `renderingVideoIds: Set<string>` — videos with an in-flight render
- `renderStartedAtByVideo: Record<string, string>` — job start time, for the elapsed timer
- `failedRenderVideoIds: Set<string>` — videos whose **latest** render `failed` and
  that have no cut (drives the "render failed" badge)

`cutVideoIds` already exists. When the flag is off, the render fields are empty /
omitted and no extra queries run.

### `lib/ai-jobs.ts` — one new batch query

`listRecentCaptionRenders(limit ≈ 200)` — Firestore query: `type ==
"video_caption_render"`, ordered by `createdAt desc`. `pipeline-data` reduces it to
latest-per-`videoUploadId` and derives:

- `renderingVideoIds` / `renderStartedAtByVideo` — latest job `status` ∈
  `{pending, processing}`
- `failedRenderVideoIds` — latest job `status === "failed"` **and** the video is not
  in `cutVideoIds`

`findInFlightCaptionRender(videoUploadId)` stays as-is for the single-video detail
route.

## Components

### `components/admin/content-studio/pipeline/VideoCard.tsx`

Small structural refactor: the whole card is currently one `<Link>`. To host action
buttons without nesting interactive elements inside an anchor, split into:

- a link region (thumbnail + title + filename + meta badges) → `/admin/content/[id]`
- an **action row** below it, with buttons that call `preventDefault()` /
  `stopPropagation()`.

New props: `column`, `isRendering`, `renderStartedAt`, `renderFailed`. Buttons by
column:

| Column / state            | Card affordances                                            |
|---------------------------|-------------------------------------------------------------|
| `needs_edit`              | `Render cut` (primary) + `Mark ready` (ghost)               |
| `needs_edit` + failed     | red "render failed" badge + `Retry render` + `Open`         |
| `rendering`               | elapsed timer (`mm:ss` from `renderStartedAt`) + animated bar; no buttons |
| `edited`                  | "Cut ready" badge (or "Marked ready" if `needs_edit===false` && no cut); card links to detail |

The existing "Needs edit" (Scissors) and "Cut" (Clapperboard) badges are folded into
this per-column treatment.

### `components/admin/content-studio/pipeline/VideosLane.tsx`

Select column-key array / tone map / help map from `data.captionedCutEnabled`. Pass
render signals and action handlers into each `VideoCard`.

### Action wiring (existing endpoints)

- **Render cut / Retry render** → `POST /api/admin/content-studio/captioned-cut`
  with `{ videoUploadId }`. On `202`/`200`, optimistically move the card to
  Rendering and start the timer; polling takes over. Handle `422` (no speech
  transcript) and `403` (flag off) with a Sonner toast; card stays in Needs Edit.
- **Mark ready** → `PATCH /api/admin/videos/[id]` with `{ needs_edit: false }`.
  Optimistically move the card to Edited.

## Live updates

The Videos lane is already a client component. When `renderingVideoIds.size > 0` (or
immediately after a Render action), a poll hits a new lightweight endpoint:

**`GET /api/admin/content-studio/render-status?ids=<csv>`** — admin-only, returns
`{ id, status, hasCut }[]` for the requested videos.

- Poll interval ≈ 4s; stop when no renders are active.
- The elapsed timer ticks client-side from `renderStartedAt`.
- On any transition (rendering → completed/failed), call `router.refresh()` so the
  server component re-derives columns from fresh data (card auto-advances to Edited,
  or back to Needs Edit with a failed badge).

## Edge cases

- **Re-render with an existing cut** → Rendering (precedence rule above).
- **Render fails** → Needs Edit + "render failed" badge + Retry render.
- **No spoken-audio transcript** → `Render cut` returns `422`; toast explains; card
  stays in Needs Edit.
- **Mark ready with no cut** → Edited with a "Marked ready" badge (postable via the
  `needs_edit=false` gate override).
- **Transcription failure** (`status === "failed"`) → stays in Transcribing with the
  existing red "Error" badge; unrelated to render failures.

## Testing

- **Unit — `pipeline-columns`:** each new state (`needs_edit`, `rendering`,
  `edited`) given the right `signals`; flag-off path still yields the 5-column
  mapping.
- **Unit — `pipeline-data`:** latest-per-video reduction produces correct
  `renderingVideoIds` / `failedRenderVideoIds` / `renderStartedAtByVideo` (including
  the "failed but has cut → not failed" case).
- **Component — `VideoCard`:** correct buttons per column/state; clicking calls the
  expected endpoint and applies the optimistic move.

## Out of scope (YAGNI)

- Drag-and-drop in edit columns (state is derived, not draggable).
- "Generate posts" button on Edited cards (lives in the detail page).
- `submissionId` / team-submission render path (Milestone 2).
- Bulk / multi-select render.

## Touched files (anticipated)

- `lib/content-studio/pipeline-columns.ts` — column arrays, labels, tones, derivation
- `lib/content-studio/pipeline-data.ts` — render signals + flag in `PipelineData`
- `lib/ai-jobs.ts` — `listRecentCaptionRenders`
- `lib/help-copy.ts` — help copy for the three new columns
- `components/admin/content-studio/pipeline/VideosLane.tsx` — column set + handlers
- `components/admin/content-studio/pipeline/VideoCard.tsx` — action row + per-state UI
- `app/api/admin/content-studio/render-status/route.ts` — new batch poll endpoint
- `__tests__/` — unit + component coverage above

No database migration required.
