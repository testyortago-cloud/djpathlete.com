# Video Edit Gate — Design Spec

**Date:** 2026-05-31
**Status:** Approved (user lgtm)

## Problem

Content Studio has no way to tell a **finished/already-edited** video apart from
**raw footage that still needs editing**. Every upload is treated identically, so
nothing stops a raw clip from being scheduled/published before it has been turned
into a captioned cut. The coach wants to mark, **at upload time**, whether a video
still needs editing, and have "needs edit" videos **blocked from posting/scheduling**
until they're handled.

## Decision

Add a single boolean `needs_edit` to `video_uploads`, set from a toggle in the
upload dialog (default **on**). A video is **postable** when it is no longer
gated — i.e. `needs_edit === false` **OR** it already has a rendered captioned
cut. The "auto-clear when a cut is rendered" behaviour falls out of the existing
cut signal (`ai_analysis->>'origin' = 'captioned_cut'`, already surfaced as the
**Cut** badge via [listCaptionedCutVideoIds](../../../lib/db/media-assets.ts)) — so
**the render-worker needs no changes**. A manual "Mark as ready" override covers
videos edited elsewhere.

Rejected alternative: having the render-worker write `needs_edit = false` on cut
completion. It touches the separate render-worker codebase + its twin, adds a write
that can be missed, and buys nothing over deriving postability from the cut signal
we already query.

## Data model

Migration `00160_video_uploads_needs_edit.sql`:

```sql
alter table video_uploads
  add column needs_edit boolean not null default true;
```

- **No backfill.** Existing rows take the `true` default (gated). This is
  acceptable because Content Studio contents will be wiped during testing.
- Add `needs_edit: boolean` to the `VideoUpload` interface in
  [types/database.ts](../../../types/database.ts). It is **required** on the row
  but optional on insert (DB default applies) — same pattern as `thumbnail_path` /
  `source_submission_id`. Mark it optional on the `createVideoUpload` insert type so
  existing callers compile.

## The gate

A small pure unit plus an async guard, both in a new
`lib/content-studio/edit-gate.ts`:

```ts
// Pure, unit-testable: the whole gate rule in one place.
export function isVideoPostable(
  video: Pick<VideoUpload, "needs_edit">,
  hasCut: boolean,
): boolean {
  return video.needs_edit === false || hasCut
}

// Async guard for route handlers. Returns ok when the post is NOT gated.
// - sourceVideoId null  → ok (manual / image / carousel posts are never gated)
// - video not found     → ok (let the route's own 404/validation handle it)
export async function assertSourceVideoPostable(
  sourceVideoId: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }>
```

`assertSourceVideoPostable` fetches the video (`getVideoUploadById`) and the latest
cut (`getLatestCaptionedCutForVideo`, already in
[lib/db/media-assets.ts](../../../lib/db/media-assets.ts)), then applies
`isVideoPostable`. The not-ok `reason` is a user-facing string:
*"Source video still needs editing — render a captioned cut or mark it ready."*

### Enforcement points (four chokepoints)

1. **Create** — [app/api/admin/content-studio/posts/route.ts](../../../app/api/admin/content-studio/posts/route.ts).
   After `initialStatus` is computed (currently `approved`/`scheduled`/`draft`),
   if `sourceVideoId` is set and the source video is **not** postable, **downgrade
   to `draft`** and null `scheduledAt`. Drafts are always allowed (the Cut flow and
   text fan-out both create drafts). Return `{ id, approval_status, gated: true }`
   so the UI can toast *"Saved as draft — video still needs editing."*

2. **Approve** — [app/api/admin/content-studio/posts/[id]/status/route.ts](../../../app/api/admin/content-studio/posts/[id]/status/route.ts).
   When `target === "approved"`, run the guard on `post.source_video_id`; if not
   ok, return `409` with `reason`. (`needs_review`/`failed` transitions stay open —
   moving a gated post *back* to draft must always work.)

3. **Schedule** — [app/api/admin/social/posts/[id]/schedule/route.ts](../../../app/api/admin/social/posts/[id]/schedule/route.ts).
   After the post is fetched and passes `SCHEDULABLE_STATUSES`, run the guard; if
   not ok, return `409` with `reason` before any platform-native scheduling call.

4. **Publish Now** — [app/api/admin/social/posts/[id]/publish-now/route.ts](../../../app/api/admin/social/posts/[id]/publish-now/route.ts).
   Same guard, same `409`, before the connection check.

This is intentionally enforced server-side at every transition into
approved/scheduled/published rather than only in the UI, so the gate can't be
bypassed by hitting the API directly.

## Upload control

- **`VideoUploader`** ([components/admin/videos/VideoUploader.tsx](../../../components/admin/videos/VideoUploader.tsx))
  gains a checkbox: **"Needs editing — gate from posting until a cut is rendered"**,
  default **checked**. Shared by the Content Studio `UploadModal` and the standalone
  `VideosPageClient`, so both get it. State lives in the uploader; the value is
  passed to `uploadVideoFile(file, { ..., needsEdit })`.
- **`uploadVideoFile` / `requestSignedUpload`**
  ([lib/firebase-client-upload.ts](../../../lib/firebase-client-upload.ts)) accept
  an optional `needsEdit?: boolean` and forward it in the request body.
- **`POST /api/admin/videos`** ([app/api/admin/videos/route.ts](../../../app/api/admin/videos/route.ts))
  reads `body.needsEdit` and passes `needs_edit: body?.needsEdit ?? true` to
  `createVideoUpload`. Absent → `true` (safe default).
- **`ManualPostDialog`** ([components/admin/content-studio/calendar/ManualPostDialog.tsx](../../../components/admin/content-studio/calendar/ManualPostDialog.tsx))
  uploads a video inline as part of composing a post the coach intends to publish
  now — it passes **`needsEdit: false`** so that flow is not accidentally gated.

## Manual override + UI

- **`PATCH /api/admin/videos/[id]`** (new route) — admin-only, body
  `{ needs_edit: boolean }`, calls the existing
  `updateVideoUpload(id, { needs_edit })`
  ([lib/db/video-uploads.ts](../../../lib/db/video-uploads.ts)). One direction in
  practice (Mark as ready → `false`); accepting the boolean keeps it general without
  extra surface.
- **"Mark as ready"** action lives in the **video drawer** (header area, near the
  Captioned Cut panel), **not** on the `VideoCard` — the card is a `<Link>` and we
  avoid nesting an interactive button inside it. Hidden once the video is already
  postable.
- **"Needs edit" badge** on `VideoCard`
  ([components/admin/content-studio/pipeline/VideoCard.tsx](../../../components/admin/content-studio/pipeline/VideoCard.tsx)):
  shown when `needs_edit && !hasCut`. The existing **Cut** badge already covers the
  ready/edited side, so a gated, un-cut video reads "Needs edit" and a cut video
  reads "Cut". `hasCut` is already threaded to `VideoCard`; `needs_edit` rides along
  on the `video` prop, so no new pipeline plumbing is required.

## Testing

- **`isVideoPostable`** unit test — all four combos of
  `needs_edit ∈ {true,false}` × `hasCut ∈ {true,false}`.
- **`assertSourceVideoPostable`** — null source → ok; gated+no-cut → not ok with
  reason; gated+cut → ok; not-gated → ok.
- **Create route** — gated source video + `scheduled_at` ⇒ persisted as `draft`,
  `scheduledAt` nulled, `gated: true`; non-gated ⇒ unchanged behaviour.
- **Status route** — approve a post whose source video is gated ⇒ `409`; moving it
  to `needs_review` ⇒ still allowed.
- **Schedule + Publish-Now routes** — gated source ⇒ `409` before connection/
  platform work; non-gated ⇒ unchanged.
- **Upload route** — `needsEdit: false` ⇒ row `needs_edit=false`; omitted ⇒ `true`.
- **VideoUploader** render test — checkbox present, default checked.
- **VideoCard** render test — `needs_edit && !hasCut` ⇒ "Needs edit" badge; cut ⇒
  no "Needs edit" badge.

DB tests use real Supabase with TAG-prefixed cleanup, mirroring existing
video-uploads / media-assets DB tests.

## Out of scope

- No render-worker / Cloud Run Job changes (postability is derived from the cut).
- No "send a ready video back to needs-edit" direction (override is one-way per the
  agreed behaviour: auto-clear on cut + manual mark-ready).
- No gate on posts without a `source_video_id` (image/carousel/manual-only posts).
- No retroactive backfill (existing rows default to gated; data will be wiped in
  testing).
