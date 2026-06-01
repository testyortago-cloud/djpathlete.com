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

A **new** function `videoColumnForWithEdit(video, posts, signals)` where `signals =
{ hasCut: boolean, isRendering: boolean }` (the existing `videoColumnFor` / 5-column
function and its tests are left untouched for the flag-off path):

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
label/tone/help maps, plus the two derivation functions (`videoColumnFor` +
`videosByColumn` for 5-col; `videoColumnForWithEdit` + `videosByColumnWithEdit` for
7-col). `VideosLane` selects the set + function from `data.captionedCutEnabled`. The
original 5-col functions and their pinned tests are not modified.

## Data layer

### `lib/content-studio/pipeline-data.ts` — `PipelineData` additions

Only populated when the flag is on:

- `captionedCutEnabled: boolean` — from `getSetting<boolean>("feature_captioned_cut_enabled", false)`
- `renderJobIdByVideo: Record<string, string>` — for each video with an in-flight
  render, its `ai_jobs` job id. The **keys** are the rendering set (drives the
  `isRendering` signal); the **values** are the job ids the client live-listens to.
- `failedRenderVideoIds: Set<string>` — videos whose **latest** render `failed` and
  that have no cut (drives the "render failed" badge)

`cutVideoIds` already exists. When the flag is off, the render fields are empty and
no extra queries run.

### `lib/ai-jobs.ts` — one new batch query

`listRecentCaptionRenders(limit ≈ 300)` — Firestore query: `type ==
"video_caption_render"`, ordered by `createdAt desc`, returning
`{ jobId, videoUploadId, status }[]`. `pipeline-data` reduces it to
latest-per-`videoUploadId` (first occurrence wins, since ordered desc) and derives:

- `renderJobIdByVideo` — latest job `status` ∈ `{pending, processing}` → `videoUploadId → jobId`
- `failedRenderVideoIds` — latest job `status === "failed"` **and** the video is not
  in `cutVideoIds`

`findInFlightCaptionRender(videoUploadId)` stays as-is for the single-video detail
route.

## Components

### `components/admin/content-studio/pipeline/VideoCard.tsx` (becomes a client component)

Structural refactor: the whole card is currently one `<Link>`. Nesting `<button>`s
inside an `<a>` is invalid, so the card becomes a `<div class="relative …">` with a
**stretched link** overlay (`<Link className="absolute inset-0" aria-label={title}>`
→ `/admin/content/[id]`) so clicking anywhere still opens detail, and an **action
row** rendered above it (`relative z-10`, buttons call `preventDefault()` +
`stopPropagation()`). Existing badges/content keep rendering in the div.

`VideoCard` gains `"use client"` and `useRouter`. New optional props: `column`,
`renderJobId`, `renderFailed`, plus existing `hasCut`. **When `column` is omitted
(the existing tests and any non-edit-lane use), the card renders exactly as today —
no action row, no rendering UI.** When `column` is provided:

| Column / state            | Card affordances                                                              |
|---------------------------|-------------------------------------------------------------------------------|
| `needs_edit` (no fail)    | `Render cut` (primary) + `Mark ready` (ghost)                                 |
| `needs_edit` + `renderFailed` | red "render failed" badge + `Retry render` + `Open`                       |
| `rendering`               | spinner + elapsed timer (`mm:ss`, counted from mount via `formatElapsed`); no buttons |
| `edited`                  | "Cut ready" badge (`hasCut`) or "Marked ready" badge; no buttons, card links to detail |

The render completion *detection* is **not** in VideoCard — VideoCard's rendering
state is purely presentational (CSS spinner + a mount-anchored timer, matching
`CaptionedCutPanel`'s "counts from reopen" behavior). No Firebase import in
VideoCard, so its tests stay simple.

### `components/admin/content-studio/pipeline/RenderWatcher.tsx` (new)

Isolates all Firebase live-listening. `RenderWatcher` takes `jobIds: string[]` and
renders one invisible `<JobWatch jobId={id} onDone={refresh} />` per id; `JobWatch`
calls `useAiJob(jobId)` and, in an effect, fires `onDone()` once `status` is
`"completed"` or `"failed"`. `RenderWatcher` owns `useRouter` and passes
`onDone={() => router.refresh()}`. Mounted once by `VideosLane` with
`Object.values(data.renderJobIdByVideo)`. When `router.refresh()` re-derives columns,
the finished video leaves the rendering set and its `JobWatch` unmounts.

### `components/admin/content-studio/pipeline/VideosLane.tsx`

Select column-key array / tone map / help map / derivation function from
`data.captionedCutEnabled`. Pass `column`, `renderJobId` (from `renderJobIdByVideo`),
and `renderFailed` (from `failedRenderVideoIds`) into each `VideoCard`. Render one
`<RenderWatcher>` for the in-flight job ids.

### Action wiring (existing endpoints, called from VideoCard)

- **Render cut / Retry render** → `POST /api/admin/content-studio/captioned-cut`
  with `{ videoUploadId }`. On ok → toast + `router.refresh()` (server then places
  the card in Rendering). Handle `422` (no speech transcript) and `403` (flag off)
  with a Sonner `toast.error`; card stays in Needs Edit.
- **Mark ready** → `PATCH /api/admin/videos/[id]` with `{ needs_edit: false }`. On ok
  → toast + `router.refresh()` (card moves to Edited).

## Live updates

The board is already a client tree and `PipelineBoard` already calls `router.refresh()`
(for bulk approve), which re-runs the server component and feeds fresh `PipelineData`
back through as `initialData`. We reuse that:

- `VideosLane` mounts `RenderWatcher` with the in-flight render job ids.
- Each `JobWatch` **live-listens** to its job via the existing `useAiJob` hook
  (Firestore `onSnapshot` — real-time, no polling endpoint).
- On `completed`/`failed`, `RenderWatcher` calls `router.refresh()`; the server
  re-derives columns and the card auto-advances to Edited (or back to Needs Edit with
  a "render failed" badge).
- The Rendering card's elapsed timer ticks client-side from mount.

No new API endpoint is required — this replaces the poll-endpoint sketch from earlier
drafting with the codebase's existing live-job pattern.

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

- **Unit — `pipeline-columns`:** `videoColumnForWithEdit` for each new state
  (`needs_edit`, `rendering`, `edited`) given the right `signals`; existing
  `videoColumnFor` 5-column tests remain unchanged and green.
- **Unit — reduction helper:** latest-per-video reduction produces correct
  `renderJobIdByVideo` / `failedRenderVideoIds` (including the "failed but has cut →
  not failed" and "latest is success after an earlier failure" cases). Extracted as a
  pure function so it needs no Firestore mock.
- **Component — `VideoCard`:** correct buttons per `column`/state; clicking
  `Render cut` calls the captioned-cut POST; `Mark ready` calls the videos PATCH;
  legacy render (no `column`) is unchanged.
- **Component — `JobWatch`:** calls `onDone` when `useAiJob` reports
  `completed`/`failed` (with `useAiJob` mocked).

## Out of scope (YAGNI)

- Drag-and-drop in edit columns (state is derived, not draggable).
- "Generate posts" button on Edited cards (lives in the detail page).
- `submissionId` / team-submission render path (Milestone 2).
- Bulk / multi-select render.

## Touched files (anticipated)

- `lib/content-studio/pipeline-columns.ts` — `*WithEdit` column array, labels, tones, derivation (originals untouched)
- `lib/content-studio/pipeline-data.ts` — render signals + flag in `PipelineData`; pure reduction helper
- `lib/ai-jobs.ts` — `listRecentCaptionRenders`
- `lib/help-copy.ts` — help copy for the three new columns
- `components/admin/content-studio/pipeline/VideosLane.tsx` — column set + props + `RenderWatcher`
- `components/admin/content-studio/pipeline/VideoCard.tsx` — stretched-link refactor + action row + per-state UI
- `components/admin/content-studio/pipeline/RenderWatcher.tsx` — new; isolates `useAiJob` live-listening + `router.refresh()`
- `__tests__/` — unit + component coverage above

No new API endpoint, no database migration.

No database migration required.
